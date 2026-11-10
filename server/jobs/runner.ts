/**
 * Background automations. These are deterministic workflows (not AI agents):
 * receipts queue checks, donor-health recalculation, reminders, journeys,
 * scheduled email, integration sync and budget alerts. Each can be disabled
 * per organization in Settings › Automations, and records its last status.
 */
import { pool, withSystem, withTenant, many, one, type Db } from '../db/pool.js';
import { recalcDonors } from '../services/intelligence.js';
import { qboPushEntry, getIntegration } from '../services/integrations.js';
import { deliverCampaign } from '../routes/reach.js';
import { renderEmailHtml, donorVars, transportFor, personalize } from '../services/email.js';
import { config } from '../config.js';
import { DONOR_NAME_SQL } from '../lib/util.js';

let running = false;

async function enabled(db: Db, key: string) {
  const a = await one(db, `SELECT enabled FROM automations WHERE key=$1`, [key]);
  return a?.enabled !== false;
}
async function mark(db: Db, key: string, status: string, error: string | null = null) {
  await db.query(`UPDATE automations SET last_run_at=now(), last_status=$2, last_error=$3 WHERE key=$1`, [key, status, error]);
}
async function notify(db: Db, tenantId: string, userId: string, type: string, title: string, body: string, link: string, dedupe: string) {
  await db.query(`INSERT INTO notifications(tenant_id,user_id,type,title,body,link,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,user_id,dedupe_key) DO NOTHING`, [tenantId, userId, type, title, body, link, dedupe]);
}
async function usersWith(db: Db, perm: string) {
  return many(db, `SELECT m.user_id FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.status='active' AND m.user_id IS NOT NULL AND $1 = ANY(r.permissions)`, [perm]);
}

// ───────── Journeys ─────────
export async function enrollJourneys(db: Db, trigger: string, donorId: string) {
  const js = await many(db, `SELECT * FROM journeys WHERE status='active' AND trigger=$1`, [trigger]);
  for (const j of js) {
    const steps = j.steps as any[]; if (!steps.length) continue;
    await db.query(`INSERT INTO journey_enrollments(tenant_id, journey_id, donor_id, next_at) VALUES ($1,$2,$3, now() + make_interval(days => $4)) ON CONFLICT (journey_id, donor_id) DO NOTHING`,
      [j.tenant_id, j.id, donorId, Number(steps[0].delayDays ?? 0)]);
  }
}
async function sendJourneyStep(db: Db, tenantId: string, enrollmentId: string, senderId: string | null, skip = false) {
  const e = await one(db, `SELECT e.*, j.steps, j.name journey_name, j.status journey_status FROM journey_enrollments e JOIN journeys j ON j.id=e.journey_id WHERE e.id=$1 FOR UPDATE OF e`, [enrollmentId]);
  if (!e || ['completed', 'cancelled'].includes(e.status)) return;
  const steps = e.steps as any[]; const step = steps[e.step_index];
  if (step && !skip) {
    const d = await one(db, `SELECT d.id, d.email, d.first_name, ${DONOR_NAME_SQL()} AS name, d.intelligence->'stats' stats, d.comm_prefs, d.ministry_id FROM donors d WHERE d.id=$1`, [e.donor_id]);
    const suppressed = d?.email ? await one(db, `SELECT 1 FROM email_suppressions WHERE email=lower($1)`, [d.email]) : null;
    if (d?.email && d.comm_prefs?.email !== false && !suppressed) {
      const tr = await transportFor(db, senderId);
      if (!tr) throw new Error('Email delivery is not configured (connect Gmail or configure SMTP).');
      const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [tenantId]);
      const msg = await one(db, `INSERT INTO email_messages(tenant_id, journey_id, donor_id, to_email) VALUES ($1,$2,$3,$4) RETURNING *`, [tenantId, e.journey_id, d.id, d.email]);
      const vars = donorVars(d, t.name, t.currency);
      await tr.t.sendMail({ from: tr.from, to: d.email, subject: personalize(step.subject ?? e.journey_name, vars),
        html: renderEmailHtml(step.blocks ?? [{ type: 'text', text: step.body ?? '' }], vars, { orgName: t.name, trackingBase: config.apiUrl, token: msg.tracking_token, unsubscribeUrl: `${config.apiUrl}/t/u/${msg.tracking_token}` }) });
      await db.query(`UPDATE email_messages SET status='delivered', sent_at=now() WHERE id=$1`, [msg.id]);
      await db.query(`INSERT INTO communications(tenant_id, ministry_id, donor_id, user_id, type, subject) VALUES ($1,$2,$3,$4,'email',$5)`, [tenantId, d.ministry_id, d.id, senderId, `Journey: ${e.journey_name} — ${step.subject ?? ''}`]);
    }
  }
  const next = e.step_index + 1;
  if (next >= steps.length) await db.query(`UPDATE journey_enrollments SET status='completed', step_index=$2 WHERE id=$1`, [e.id, next]);
  else await db.query(`UPDATE journey_enrollments SET status='waiting', step_index=$2, next_at=now() + make_interval(days => $3) WHERE id=$1`, [e.id, next, Number(steps[next].delayDays ?? 0)]);
}
async function advanceJourneys(db: Db, tenantId: string) {
  const due = await many(db, `SELECT e.id, j.mode, j.name FROM journey_enrollments e JOIN journeys j ON j.id=e.journey_id WHERE e.status='waiting' AND e.next_at <= now() AND j.status='active' LIMIT 200`);
  let approvals = 0;
  for (const e of due) {
    if (e.mode === 'approval') { await db.query(`UPDATE journey_enrollments SET status='awaiting_approval' WHERE id=$1`, [e.id]); approvals++; }
    else {
      await db.query('SAVEPOINT js');
      try { await sendJourneyStep(db, tenantId, e.id, null); await db.query('RELEASE SAVEPOINT js'); }
      catch (err: any) { await db.query('ROLLBACK TO SAVEPOINT js'); await mark(db, 'journeys', 'error', err.message); return; }
    }
  }
  if (approvals) for (const u of await usersWith(db, 'email.send')) await notify(db, tenantId, u.user_id, 'journey', 'Journey emails awaiting approval', `${approvals} step(s) need review before sending.`, '/donors/email/journeys', `journey-approval-${new Date().toISOString().slice(0, 13)}`);
}

// ───────── Queue processing ─────────
async function processQueue(): Promise<number> {
  // Recover jobs whose worker was stopped mid-run (e.g. a serverless time limit); handlers are idempotent.
  await withSystem((db) => db.query(`UPDATE job_queue SET status='queued', locked_at=NULL WHERE status='running' AND locked_at < now() - interval '5 minutes'`));
  const jobs = await withSystem((db) => many(db, `UPDATE job_queue SET status='running', locked_at=now(), attempts=attempts+1 WHERE id IN (
      SELECT id FROM job_queue WHERE status='queued' AND run_at <= now() ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`));
  for (const j of jobs) {
    try {
      await withTenant(j.tenant_id, async (db) => {
        const p = j.payload;
        switch (j.kind) {
          case 'donor.recalc': await recalcDonors(db, p.donorId); break;
          case 'journey.trigger': if (await enabled(db, 'journeys')) await enrollJourneys(db, p.trigger, p.donorId); break;
          case 'journey.step': await sendJourneyStep(db, j.tenant_id, p.enrollmentId, p.approvedBy, p.skip); break;
          case 'email.send_campaign': await deliverCampaign(db, j.tenant_id, p.campaignId, p.senderId); break;
          case 'qbo.push': {
            const i = await getIntegration(db, 'quickbooks');
            if (!i || i.status !== 'connected' || !i.enabled || i.config.auto_sync === false || !(await enabled(db, 'integration_sync'))) break;
            const id = p.entity === 'journal' ? p.id : (await one(db, `SELECT journal_entry_id id FROM ${p.entity === 'gift' ? 'gifts' : 'expenses'} WHERE id=$1`, [p.id]))?.id;
            if (id) await qboPushEntry(db, j.tenant_id, id);
            break;
          }
        }
      });
      await withSystem((db) => db.query(`UPDATE job_queue SET status='done' WHERE id=$1`, [j.id]));
    } catch (e: any) {
      const retry = j.attempts < 5;
      await withSystem((db) => db.query(`UPDATE job_queue SET status=$2, last_error=$3, run_at=now() + make_interval(mins => $4) WHERE id=$1`, [j.id, retry ? 'queued' : 'error', e.message?.slice(0, 1000), 2 ** j.attempts]));
      if (j.kind === 'email.send_campaign' && !retry) await withTenant(j.tenant_id, (db) => db.query(`UPDATE email_campaigns SET status='paused' WHERE id=$1`, [j.payload.campaignId]));
    }
  }
  return jobs.length;
}

// ───────── Periodic automations (per tenant) ─────────
const INTERVALS: Record<string, number> = { donor_health: 24 * 60, receipt_queue: 6 * 60, grant_reminders: 12 * 60, task_reminders: 12 * 60, journeys: 10, integration_sync: 30, budget_alerts: 24 * 60 };

async function periodic() {
  const tenants = await withSystem((db) => many(db, `SELECT id FROM tenants`));
  for (const t of tenants) {
    await withTenant(t.id, async (db) => {
      const autos = await many(db, `SELECT * FROM automations WHERE enabled`);
      const due = (key: string) => { const a = autos.find((x) => x.key === key); return a && (!a.last_run_at || Date.now() - new Date(a.last_run_at).getTime() >= INTERVALS[key] * 60_000); };
      try {
        if (due('donor_health')) {
          const before = new Map((await many(db, `SELECT id, health_status FROM donors WHERE NOT archived`)).map((d) => [d.id, d.health_status]));
          await recalcDonors(db);
          const nowLapsed = await many(db, `SELECT id FROM donors WHERE NOT archived AND health_status='lapsed'`);
          for (const d of nowLapsed) if (before.get(d.id) !== 'lapsed') await enrollJourneys(db, 'donor_lapsed', d.id);
          await mark(db, 'donor_health', 'ok');
        }
        if (due('receipt_queue')) {
          const q = await one(db, `SELECT count(*) FILTER (WHERE receipt_status='pending')::int r, count(*) FILTER (WHERE thank_you_status='pending' AND gift_date < current_date - 2)::int t FROM gifts WHERE NOT refunded`);
          if (q!.r || q!.t) for (const u of await usersWith(db, 'gifts.write')) await notify(db, t.id, u.user_id, 'receipts', 'Receipts and thank-yous need attention', `${q!.r} receipts and ${q!.t} thank-yous (older than 48h) are pending.`, '/donors/giving', `rq-${new Date().toISOString().slice(0, 10)}`);
          await mark(db, 'receipt_queue', 'ok');
        }
        if (due('grant_reminders')) {
          const gs = await many(db, `SELECT g.*, (g.deadline - current_date) days_d, (g.report_due - current_date) days_r FROM grants g WHERE g.status NOT IN ('declined','closed') AND ((g.deadline - current_date) IN (14,7,1) OR (g.report_due - current_date) IN (14,7,1))`);
          for (const g of gs) {
            const recips = g.assignee_id ? [{ user_id: g.assignee_id }] : await usersWith(db, 'grants.write');
            for (const u of recips) await notify(db, t.id, u.user_id, 'grant', `Grant ${[14, 7, 1].includes(g.days_d) ? 'deadline' : 'report'} in ${[14, 7, 1].includes(g.days_d) ? g.days_d : g.days_r} day(s)`, g.title, `/donors/grants/${g.id}`, `grant-${g.id}-${g.days_d}-${g.days_r}`);
          }
          await mark(db, 'grant_reminders', 'ok');
        }
        if (due('task_reminders')) {
          for (const tk of await many(db, `SELECT id, title, assignee_id, due_date FROM tasks WHERE status<>'completed' AND due_date < current_date AND assignee_id IS NOT NULL LIMIT 500`))
            await notify(db, t.id, tk.assignee_id, 'task', 'Overdue task', `${tk.title} (due ${tk.due_date})`, `/work/tasks?open=${tk.id}`, `task-overdue-${tk.id}-${new Date().toISOString().slice(0, 10)}`);
          for (const tk of await many(db, `SELECT t.id, t.title, t.donor_id, t.assignee_id FROM tasks t WHERE t.status<>'completed' AND t.donor_id IS NOT NULL AND t.due_date = current_date AND t.assignee_id IS NOT NULL`))
            await notify(db, t.id, tk.assignee_id, 'follow_up', 'Donor follow-up due today', tk.title, `/donors/${tk.donor_id}`, `fu-${tk.id}`);
          for (const ev of await many(db, `SELECT id, name FROM events WHERE starts_at::date = current_date + 2`))
            for (const u of await usersWith(db, 'events.write')) await notify(db, t.id, u.user_id, 'event', 'Upcoming event in 2 days', ev.name, `/donors/events/${ev.id}`, `ev-${ev.id}`);
          await mark(db, 'task_reminders', 'ok');
        }
        if (due('journeys')) { await advanceJourneys(db, t.id); await mark(db, 'journeys', 'ok'); }
        if (due('integration_sync')) {
          const i = await getIntegration(db, 'quickbooks');
          if (i?.status === 'connected' && i.enabled && i.config.auto_sync !== false) {
            for (const r of await many(db, `SELECT internal_id FROM sync_records WHERE provider='quickbooks' AND status='queued' LIMIT 100`)) await qboPushEntry(db, t.id, r.internal_id);
            await db.query(`UPDATE integrations SET last_sync_at=now() WHERE id=$1`, [i.id]);
          }
          const errs = await one(db, `SELECT count(*)::int n FROM sync_records WHERE status IN ('error','conflict')`);
          if (errs!.n) for (const u of await usersWith(db, 'integrations.manage')) await notify(db, t.id, u.user_id, 'integration', 'Accounting sync needs attention', `${errs!.n} sync errors or conflicts.`, '/money/accounting/sync', `sync-${new Date().toISOString().slice(0, 10)}`);
          await mark(db, 'integration_sync', 'ok');
        }
        if (due('budget_alerts')) {
          const over = await many(db, `SELECT b.id, b.name, a.name account, bl.amount::float budget, coalesce((SELECT sum(jl.debit-jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=bl.account_id AND (bl.fund_id IS NULL OR jl.fund_id=bl.fund_id) AND je.entry_date BETWEEN b.period_start AND b.period_end),0)::float actual
            FROM budget_lines bl JOIN budgets b ON b.id=bl.budget_id JOIN accounts a ON a.id=bl.account_id AND a.type='expense' WHERE current_date BETWEEN b.period_start AND b.period_end AND bl.amount > 0`);
          for (const o of over.filter((x) => x.actual / x.budget >= 0.9))
            for (const u of await usersWith(db, 'finance.read')) await notify(db, t.id, u.user_id, 'budget', `Budget alert: ${o.account}`, `${Math.round((o.actual / o.budget) * 100)}% of budget used in “${o.name}”.`, `/money/accounting/budgets/${o.id}`, `budget-${o.id}-${o.account}-${Math.floor((o.actual / o.budget) * 10)}`);
          await mark(db, 'budget_alerts', 'ok');
        }
      } catch (e: any) {
        console.error(`automation error for tenant ${t.id}:`, e.message);
      }
    }).catch((e) => console.error('periodic tenant error', e.message));
  }
}

export function startJobs() {
  if (!config.runJobs) return;
  setInterval(() => { if (running) return; running = true; processQueue().catch((e) => console.error('queue', e)).finally(() => { running = false; }); }, 2000);
  setInterval(() => periodic().catch((e) => console.error('periodic', e)), 60_000);
  setTimeout(() => periodic().catch((e) => console.error('periodic', e)), 5_000);
}
export { processQueue, periodic, pool };
