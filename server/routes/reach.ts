import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, actor, assertMinistry, ministryScope } from '../lib/auth.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, withSystem, type Db } from '../db/pool.js';
import { audienceDonors, audienceWhere, renderEmailHtml, donorVars, requireTransport, personalize, type AudienceFilters, type Block } from '../services/email.js';
import { generateText } from '../services/ai.js';
import { config } from '../config.js';
import { DONOR_NAME_SQL, fmtMoney, round2 } from '../lib/util.js';
import { sendTable } from '../services/exporter.js';
import { createDonor } from './donors.js';

export const reachRouter = Router();

const campaignSchema = z.object({ name: z.string().min(1), subject: z.string().nullish(), preview_text: z.string().nullish(), from_name: z.string().nullish(),
  blocks: z.array(z.record(z.string(), z.any())).default([]), audience_id: z.string().uuid().nullish(), campaign_id: z.string().uuid().nullish(), ministry_id: z.string().uuid().nullish() });

reachRouter.get('/campaigns', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const p: unknown[] = []; const sc = ministryScope(req.auth!, 'ec.ministry_id', p);
  res.json(await tx(req, (db) => many(db, `SELECT ec.*, a.name audience_name,
      (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='open')::int opens,
      (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='click')::int clicks,
      (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.email_campaign_id=ec.id AND NOT g.refunded)::float gifts_attributed
    FROM email_campaigns ec LEFT JOIN audiences a ON a.id=ec.audience_id WHERE ${sc} AND ($${p.length + 1}::text IS NULL OR ec.status=$${p.length + 1}) ORDER BY ec.created_at DESC`, [...p, req.query.status ?? null])));
}));
reachRouter.get('/campaigns/:id', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const c = await tx(req, (db) => one(db, `SELECT * FROM email_campaigns WHERE id=$1`, [req.params.id]));
  if (!c) throw notFound('Email campaign');
  res.json(c);
}));
reachRouter.post('/campaigns', h(async (req, res) => {
  requirePerm(req.auth, 'email.write');
  const b = parse(campaignSchema, req.body); assertMinistry(req.auth!, b.ministry_id);
  res.status(201).json(await tx(req, async (db) => {
    const c = await one(db, `INSERT INTO email_campaigns(tenant_id, ministry_id, name, subject, preview_text, from_name, blocks, audience_id, campaign_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id ?? null, b.name, b.subject ?? null, b.preview_text ?? null, b.from_name ?? null, JSON.stringify(b.blocks), b.audience_id ?? null, b.campaign_id ?? null, req.auth!.userId]);
    await audit(db, actor(req), 'email', 'create', `Created email campaign “${b.name}”`, { type: 'email_campaign', id: c.id });
    return c;
  }));
}));
reachRouter.patch('/campaigns/:id', h(async (req, res) => {
  requirePerm(req.auth, 'email.write');
  const b = parse(campaignSchema.partial().extend({ status: z.enum(['draft', 'paused', 'archived']).optional() }), req.body);
  res.json(await tx(req, async (db) => {
    const cur = await one(db, `SELECT status FROM email_campaigns WHERE id=$1`, [req.params.id]);
    if (!cur) throw notFound('Email campaign');
    if (['sent', 'sending'].includes(cur.status) && Object.keys(b).some((k) => k !== 'status')) throw conflict('This campaign has already been sent; duplicate it to make changes.');
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    const vals = keys.map((k) => (k === 'blocks' ? JSON.stringify((b as any)[k]) : (b as any)[k]));
    return one(db, `UPDATE email_campaigns SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
  }));
}));
reachRouter.post('/campaigns/:id/duplicate', h(async (req, res) => {
  requirePerm(req.auth, 'email.write');
  res.status(201).json(await tx(req, (db) => one(db, `INSERT INTO email_campaigns(tenant_id, ministry_id, name, subject, preview_text, from_name, blocks, audience_id, campaign_id, created_by)
    SELECT tenant_id, ministry_id, name || ' (copy)', subject, preview_text, from_name, blocks, audience_id, campaign_id, $2 FROM email_campaigns WHERE id=$1 RETURNING *`, [req.params.id, req.auth!.userId])));
}));

async function campaignAudience(db: Db, c: any) {
  const a = c.audience_id ? await one(db, `SELECT filters FROM audiences WHERE id=$1`, [c.audience_id]) : null;
  if (!a) throw badRequest('Choose an audience before sending.');
  return audienceDonors(db, a.filters as AudienceFilters);
}

reachRouter.post('/audiences/preview', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const f = (req.body?.filters ?? {}) as AudienceFilters;
  res.json(await tx(req, async (db) => {
    const p: unknown[] = []; const w = audienceWhere(f, p);
    const count = await one(db, `SELECT count(*)::int n FROM donors d WHERE ${w}`, p);
    const sample = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.email, d.health_status FROM donors d WHERE ${w} ORDER BY d.score DESC LIMIT 10`, p);
    return { count: count!.n, sample };
  }));
}));

reachRouter.get('/campaigns/:id/preview', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const html = await tx(req, async (db) => {
    const c = await one(db, `SELECT * FROM email_campaigns WHERE id=$1`, [req.params.id]); if (!c) throw notFound('Email campaign');
    const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const sample = { first_name: 'Jordan', name: 'Jordan Sample', stats: { lastAmount: 100, lastGift: '2026-01-15', lifetime: 1250 } };
    return renderEmailHtml(c.blocks, donorVars(sample, t.name, t.currency), { orgName: t.name, previewText: c.preview_text ?? '' });
  });
  res.type('html').send(html);
}));

reachRouter.post('/campaigns/:id/test', h(async (req, res) => {
  requirePerm(req.auth, 'email.write');
  const { to } = parse(z.object({ to: z.string().email() }), req.body);
  await tx(req, async (db) => {
    const c = await one(db, `SELECT * FROM email_campaigns WHERE id=$1`, [req.params.id]); if (!c) throw notFound('Email campaign');
    if (!c.subject) throw badRequest('Add a subject line first.');
    const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const tr = await requireTransport(db, req.auth!.userId);
    const vars = donorVars({ first_name: req.auth!.name.split(' ')[0], name: req.auth!.name, stats: { lastAmount: 100, lastGift: '2026-01-15', lifetime: 1250 } }, t.name, t.currency);
    await tr.t.sendMail({ from: tr.from, to, subject: `[TEST] ${personalize(c.subject, vars)}`, html: renderEmailHtml(c.blocks, vars, { orgName: t.name, previewText: c.preview_text ?? '' }) });
    await audit(db, actor(req), 'email', 'test_send', `Sent test of “${c.name}” to ${to}`, { type: 'email_campaign', id: c.id });
  });
  res.json({ ok: true });
}));

/** Explicit Send Now / Schedule. Delivery runs in the background job queue. */
reachRouter.post('/campaigns/:id/send', h(async (req, res) => {
  requirePerm(req.auth, 'email.send');
  const { scheduled_at } = parse(z.object({ scheduled_at: z.string().datetime().nullish() }), req.body ?? {});
  const out = await tx(req, async (db) => {
    const c = await one(db, `SELECT * FROM email_campaigns WHERE id=$1 FOR UPDATE`, [req.params.id]); if (!c) throw notFound('Email campaign');
    if (!['draft', 'paused', 'scheduled'].includes(c.status)) throw conflict(`Campaign is ${c.status}.`);
    if (!c.subject) throw badRequest('Add a subject line.');
    if (!(c.blocks as Block[]).length) throw badRequest('Add content blocks to the email.');
    await requireTransport(db, req.auth!.userId);
    const recipients = await campaignAudience(db, c);
    if (!recipients.length) throw badRequest('This audience has no reachable recipients (missing emails, opted out, or suppressed).');
    const when = scheduled_at ? new Date(scheduled_at) : new Date();
    await db.query(`UPDATE email_campaigns SET status=$2, scheduled_at=$3, recipient_count=$4 WHERE id=$1`, [c.id, scheduled_at ? 'scheduled' : 'sending', when, recipients.length]);
    await db.query(`INSERT INTO job_queue(tenant_id, kind, payload, run_at) VALUES ($1,'email.send_campaign',$2,$3)`, [req.auth!.tenantId, { campaignId: c.id, senderId: req.auth!.userId }, when]);
    await audit(db, actor(req), 'email', scheduled_at ? 'schedule' : 'send', `${scheduled_at ? `Scheduled for ${when.toISOString()}` : 'Started sending'} “${c.name}” to ${recipients.length} recipients`, { type: 'email_campaign', id: c.id });
    return { recipients: recipients.length, status: scheduled_at ? 'scheduled' : 'sending' };
  });
  res.json(out);
}));
reachRouter.post('/campaigns/:id/pause', h(async (req, res) => {
  requirePerm(req.auth, 'email.send');
  await tx(req, async (db) => {
    const r = await db.query(`UPDATE email_campaigns SET status='paused' WHERE id=$1 AND status IN ('scheduled','sending')`, [req.params.id]);
    if (!r.rowCount) throw conflict('Only scheduled or sending campaigns can be paused.');
    await audit(db, actor(req), 'email', 'pause', 'Paused email campaign', { type: 'email_campaign', id: String(req.params.id) });
  });
  res.json({ ok: true });
}));

/** Background worker: deliver one campaign (called by job runner). */
export async function deliverCampaign(db: Db, tenantId: string, campaignId: string, senderId: string | null) {
  const c = await one(db, `SELECT * FROM email_campaigns WHERE id=$1`, [campaignId]);
  if (!c || !['sending', 'scheduled'].includes(c.status)) return;
  await db.query(`UPDATE email_campaigns SET status='sending' WHERE id=$1`, [c.id]);
  const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [tenantId]);
  const tr = await requireTransport(db, senderId);
  const recipients = await campaignAudience(db, c);
  let sent = 0;
  for (const d of recipients) {
    const already = await one(db, `SELECT 1 FROM email_messages WHERE email_campaign_id=$1 AND donor_id=$2`, [c.id, d.id]);
    if (already) continue;
    const st = await one(db, `SELECT status FROM email_campaigns WHERE id=$1`, [c.id]);
    if (st.status === 'paused') return;
    const msg = await one(db, `INSERT INTO email_messages(tenant_id, email_campaign_id, donor_id, to_email) VALUES ($1,$2,$3,$4) RETURNING *`, [tenantId, c.id, d.id, d.email]);
    const vars = donorVars(d, t.name, t.currency);
    try {
      const info = await tr.t.sendMail({ from: c.from_name ? `${c.from_name} <${String(tr.from).replace(/.*<|>.*/g, '')}>` : tr.from, to: d.email, subject: personalize(c.subject, vars),
        html: renderEmailHtml(c.blocks, vars, { orgName: t.name, trackingBase: config.apiUrl, token: msg.tracking_token, unsubscribeUrl: `${config.apiUrl}/t/u/${msg.tracking_token}`, previewText: c.preview_text ?? '' }),
        headers: { 'List-Unsubscribe': `<${config.apiUrl}/t/u/${msg.tracking_token}>` } });
      await db.query(`UPDATE email_messages SET status='delivered', sent_at=now(), provider_message_id=$2 WHERE id=$1`, [msg.id, info.messageId ?? null]);
      await db.query(`INSERT INTO email_events(tenant_id, email_campaign_id, message_id, donor_id, type) VALUES ($1,$2,$3,$4,'delivered')`, [tenantId, c.id, msg.id, d.id]);
      await db.query(`INSERT INTO communications(tenant_id, ministry_id, donor_id, user_id, type, subject) VALUES ($1,$2,$3,$4,'email',$5)`, [tenantId, d.ministry_id, d.id, senderId, `Campaign: ${c.name}`]);
      sent++;
    } catch (e: any) {
      const bounce = /5\d\d|invalid|does not exist|rejected/i.test(e.message);
      await db.query(`UPDATE email_messages SET status=$2, error=$3 WHERE id=$1`, [msg.id, bounce ? 'bounced' : 'failed', e.message.slice(0, 500)]);
      if (bounce) {
        await db.query(`INSERT INTO email_events(tenant_id, email_campaign_id, message_id, donor_id, type) VALUES ($1,$2,$3,$4,'bounce')`, [tenantId, c.id, msg.id, d.id]);
        await db.query(`INSERT INTO email_suppressions(tenant_id,email,reason) VALUES ($1,lower($2),'bounce') ON CONFLICT DO NOTHING`, [tenantId, d.email]);
      }
    }
  }
  await db.query(`UPDATE email_campaigns SET status='sent', sent_at=now() WHERE id=$1`, [c.id]);
  return sent;
}

// ───────── Analytics ─────────
reachRouter.get('/analytics', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const out = await tx(req, async (db) => {
    const t = await one(db, `SELECT attribution_window_days FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const totals = await one(db, `SELECT count(*) FILTER (WHERE type='delivered')::int delivered, count(DISTINCT message_id) FILTER (WHERE type='open')::int opens,
        count(DISTINCT message_id) FILTER (WHERE type='click')::int clicks, count(*) FILTER (WHERE type='unsubscribe')::int unsubscribes, count(*) FILTER (WHERE type='bounce')::int bounces,
        count(*) FILTER (WHERE type='complaint')::int complaints FROM email_events WHERE occurred_at > now() - interval '365 days'`);
    const sentMsgs = await one(db, `SELECT count(*)::int n FROM email_messages WHERE sent_at > now() - interval '365 days' OR status IN ('bounced','failed')`);
    // Attribution: explicit email_campaign_id on gift, OR gift by a recipient within N days after send (configurable window).
    const attributed = await many(db, `SELECT ec.id, ec.name, ec.sent_at, ec.recipient_count,
        (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='delivered')::int delivered,
        (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='open')::int opens,
        (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='click')::int clicks,
        (SELECT count(*) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='unsubscribe')::int unsubscribes,
        (SELECT count(*) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='bounce')::int bounces,
        (SELECT coalesce(sum(g.amount),0) FROM gifts g WHERE NOT g.refunded AND (g.email_campaign_id=ec.id OR (g.email_campaign_id IS NULL AND g.donor_id IN (SELECT donor_id FROM email_messages m WHERE m.email_campaign_id=ec.id AND m.status='delivered')
           AND g.gift_date BETWEEN ec.sent_at::date AND ec.sent_at::date + $1::int)))::float gifts_attributed,
        (SELECT count(*) FROM gifts g WHERE NOT g.refunded AND (g.email_campaign_id=ec.id OR (g.email_campaign_id IS NULL AND g.donor_id IN (SELECT donor_id FROM email_messages m WHERE m.email_campaign_id=ec.id AND m.status='delivered')
           AND g.gift_date BETWEEN ec.sent_at::date AND ec.sent_at::date + $1::int)))::int gift_count
      FROM email_campaigns ec WHERE ec.status='sent' ORDER BY ec.sent_at DESC LIMIT 50`, [t.attribution_window_days]);
    const trend = await many(db, `SELECT to_char(date_trunc('month', occurred_at),'YYYY-MM') AS month, count(*) FILTER (WHERE type='delivered')::int delivered,
        count(DISTINCT message_id) FILTER (WHERE type='open')::int opens, count(DISTINCT message_id) FILTER (WHERE type='click')::int clicks FROM email_events WHERE occurred_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
    const d = totals!.delivered || 0;
    const bounceRate = sentMsgs!.n ? totals!.bounces / sentMsgs!.n : 0;
    const complaintRate = d ? totals!.complaints / d : 0;
    const health = bounceRate > 0.05 || complaintRate > 0.003 ? 'Poor' : bounceRate > 0.02 || complaintRate > 0.001 ? 'Fair' : 'Good';
    return { ...totals, openRate: d ? round2((totals!.opens / d) * 100) : 0, clickRate: d ? round2((totals!.clicks / d) * 100) : 0, clickToOpen: totals!.opens ? round2((totals!.clicks / totals!.opens) * 100) : 0,
      giftsAttributed: round2(attributed.reduce((a, c) => a + c.gifts_attributed, 0)), inboxHealth: { rating: health, bounceRate: round2(bounceRate * 100), complaintRate: round2(complaintRate * 100) },
      attributionWindowDays: t.attribution_window_days, campaigns: attributed, trend, note: 'Opens are estimated (many email clients block tracking pixels). Gift attribution uses an explicit campaign link or a gift by a recipient within the attribution window.' };
  });
  res.json(out);
}));

reachRouter.get('/campaigns/:id/attributed-gifts', h(async (req, res) => {
  requirePerm(req.auth, 'email.read', 'donors.read');
  res.json(await tx(req, async (db) => {
    const t = await one(db, `SELECT attribution_window_days w FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    return many(db, `SELECT g.id, g.amount::float, g.gift_date, d.id donor_id, ${DONOR_NAME_SQL()} AS donor_name, CASE WHEN g.email_campaign_id IS NOT NULL THEN 'Linked to email' ELSE 'Within ' || $2 || ' days of send' END basis
      FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN email_campaigns ec ON ec.id=$1 WHERE NOT g.refunded AND (g.email_campaign_id=ec.id OR (g.email_campaign_id IS NULL AND g.donor_id IN (SELECT donor_id FROM email_messages m WHERE m.email_campaign_id=ec.id AND m.status='delivered') AND g.gift_date BETWEEN ec.sent_at::date AND ec.sent_at::date + $2::int)) ORDER BY g.gift_date`, [req.params.id, t.w]);
  }));
}));

/** Predicted impact: estimate from historical response rates — clearly labeled as an estimate. */
reachRouter.post('/predict', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  const f = (req.body?.filters ?? {}) as AudienceFilters;
  res.json(await tx(req, async (db) => {
    const p: unknown[] = []; const w = audienceWhere(f, p);
    const aud = await one(db, `SELECT count(*)::int n, coalesce(avg((d.intelligence->'stats'->>'lastAmount')::numeric),0)::float avg_last FROM donors d WHERE ${w}`, p);
    const hist = await one(db, `SELECT coalesce(sum(m.n),0)::int sent, coalesce(sum(m.givers),0)::int givers FROM (
        SELECT ec.id, count(DISTINCT em.donor_id) n, count(DISTINCT g.donor_id) givers FROM email_campaigns ec JOIN email_messages em ON em.email_campaign_id=ec.id AND em.status='delivered'
        LEFT JOIN gifts g ON g.donor_id=em.donor_id AND NOT g.refunded AND g.gift_date BETWEEN ec.sent_at::date AND ec.sent_at::date + 7 WHERE ec.status='sent' GROUP BY ec.id) m`);
    if (hist!.sent < 200) return { available: false, reason: 'Not enough send history yet (need about 200 delivered emails) to estimate fundraising impact.', audience: aud!.n };
    const rate = hist!.givers / hist!.sent;
    return { available: true, audience: aud!.n, responseRate: round2(rate * 100), expectedGifts: Math.round(aud!.n * rate), expectedRevenue: round2(aud!.n * rate * aud!.avg_last),
      explanation: `Estimate only: ${(rate * 100).toFixed(1)}% of past recipients gave within 7 days of a send; applied to ${aud!.n} recipients × their average last gift (${fmtMoney(aud!.avg_last)}).` };
  }));
}));

reachRouter.post('/subject-lines', h(async (req, res) => {
  requirePerm(req.auth, 'email.write', 'ai.ask');
  const { topic } = parse(z.object({ topic: z.string().min(2).max(1000) }), req.body);
  const ai = await generateText({ prompt: `Suggest 6 short, honest email subject lines for a nonprofit email about: ${topic}. One per line, no numbering, no quotes.`, effort: 'low' }).catch(() => null);
  const lines = (ai ?? `A quick update on ${topic}\nYou made this possible\nWhat your gift did this month\nWill you join us?\nOne story we had to share\nThank you — here's what happened`).split('\n').map((s) => s.replace(/^[-*\d.\s"]+|"$/g, '').trim()).filter(Boolean).slice(0, 6);
  res.json({ suggestions: lines, generator: ai ? 'claude' : 'template' });
}));

// ───────── Journeys ─────────
reachRouter.post('/journeys/:id/status', h(async (req, res) => {
  requirePerm(req.auth, 'email.send');
  const { status } = parse(z.object({ status: z.enum(['active', 'paused']) }), req.body);
  await tx(req, async (db) => {
    const j = await one(db, `SELECT * FROM journeys WHERE id=$1`, [req.params.id]); if (!j) throw notFound('Journey');
    if (status === 'active' && !(j.steps as any[]).length) throw badRequest('Add at least one step first.');
    await db.query(`UPDATE journeys SET status=$2 WHERE id=$1`, [j.id, status]);
    await audit(db, actor(req), 'email', `journey_${status}`, `${status === 'active' ? 'Activated' : 'Paused'} journey “${j.name}” (${j.mode})`, { type: 'journey', id: j.id });
  });
  res.json({ ok: true });
}));
reachRouter.get('/journeys/approvals', h(async (req, res) => {
  requirePerm(req.auth, 'email.read');
  res.json(await tx(req, (db) => many(db, `SELECT e.*, j.name journey_name, j.steps->e.step_index step, ${DONOR_NAME_SQL()} AS donor_name, d.email FROM journey_enrollments e JOIN journeys j ON j.id=e.journey_id JOIN donors d ON d.id=e.donor_id WHERE e.status='awaiting_approval' ORDER BY e.next_at`)));
}));
reachRouter.post('/journeys/enrollments/:id/:decision', h(async (req, res) => {
  requirePerm(req.auth, 'email.send');
  const decision = String(req.params.decision);
  if (!['approve', 'skip', 'cancel'].includes(decision)) throw badRequest('Unknown decision.');
  await tx(req, async (db) => {
    const e = await one(db, `SELECT * FROM journey_enrollments WHERE id=$1 AND status='awaiting_approval'`, [req.params.id]); if (!e) throw notFound('Pending journey step');
    if (decision === 'cancel') await db.query(`UPDATE journey_enrollments SET status='cancelled' WHERE id=$1`, [e.id]);
    else await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.step',$2)`, [req.auth!.tenantId, { enrollmentId: e.id, approvedBy: req.auth!.userId, skip: decision === 'skip' }]);
    await audit(db, actor(req), 'email', `journey_${decision}`, `Journey step ${decision}d`, { type: 'journey_enrollment', id: e.id });
  });
  res.json({ ok: true });
}));

// ───────── Events: attendee export & follow-up ─────────
reachRouter.get('/events/:id/attendees/export', h(async (req, res) => {
  requirePerm(req.auth, 'events.read', 'data.export');
  const rows = await tx(req, async (db) => {
    await audit(db, actor(req), 'export', 'export', 'Exported event attendees', { type: 'event', id: String(req.params.id) });
    return many(db, `SELECT r.name, r.email, r.phone, r.guests, r.status, r.registered_at, r.followed_up FROM registrations r WHERE r.event_id=$1 ORDER BY r.name`, [req.params.id]);
  });
  await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `attendees-${req.params.id}`, ['name', 'email', 'phone', 'guests', 'status', 'registered_at', 'followed_up'].map((k) => ({ key: k, label: k })), rows);
}));
reachRouter.post('/events/:id/follow-up-tasks', h(async (req, res) => {
  requirePerm(req.auth, 'events.write', 'work.write');
  const { status } = parse(z.object({ status: z.enum(['attended', 'no_show', 'registered']).default('attended') }), req.body ?? {});
  const n = await tx(req, async (db) => {
    const e = await one(db, `SELECT * FROM events WHERE id=$1`, [req.params.id]); if (!e) throw notFound('Event');
    const regs = await many(db, `SELECT * FROM registrations WHERE event_id=$1 AND status=$2 AND NOT followed_up`, [e.id, status]);
    for (const r of regs) {
      await db.query(`INSERT INTO tasks(tenant_id, ministry_id, title, due_date, donor_id, assignee_id, created_by, category) VALUES ($1,$2,$3,current_date+3,$4,$5,$5,'Event follow-up')`,
        [req.auth!.tenantId, e.ministry_id, `${status === 'no_show' ? 'Sorry we missed you' : 'Thank you for coming'} — follow up with ${r.name} (${e.name})`, r.donor_id, req.auth!.userId]);
      await db.query(`UPDATE registrations SET followed_up=true WHERE id=$1`, [r.id]);
    }
    await audit(db, actor(req), 'events', 'follow_up', `Created ${regs.length} follow-up tasks for ${e.name}`, { type: 'event', id: e.id });
    return regs.length;
  });
  res.json({ created: n });
}));

// ───────── Public endpoints (no auth): registration page and tracking ─────────
export const publicRouter = Router();

publicRouter.get('/events/:slug', h(async (req, res) => {
  const e = await withSystem((db) => one(db, `SELECT e.id, e.name, e.event_type, e.starts_at, e.ends_at, e.location, e.description, e.capacity, e.status, t.name org,
      (SELECT count(*) FROM registrations r WHERE r.event_id=e.id AND r.status<>'cancelled')::int registered FROM events e JOIN tenants t ON t.id=e.tenant_id WHERE e.slug=$1 AND e.is_public`, [req.params.slug]));
  if (!e) throw notFound('Event');
  res.json({ ...e, full: e.capacity ? e.registered >= e.capacity : false });
}));
publicRouter.post('/events/:slug/register', h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(200), email: z.string().email(), phone: z.string().max(40).optional(), guests: z.number().int().min(0).max(20).default(0), website: z.string().max(0).optional() }), req.body);
  const out = await withSystem(async (db) => {
    const e = await one(db, `SELECT * FROM events WHERE slug=$1 AND is_public AND status='published' FOR UPDATE`, [req.params.slug]);
    if (!e) throw badRequest('Registration is closed for this event.');
    const count = await one(db, `SELECT count(*)::int n FROM registrations WHERE event_id=$1 AND status<>'cancelled'`, [e.id]);
    if (e.capacity && count!.n >= e.capacity) throw conflict('This event is full.');
    await db.query(`SELECT set_config('app.tenant_id',$1,true)`, [e.tenant_id]);
    // Match to existing constituent by email, else create.
    let donor = await one(db, `SELECT id FROM donors WHERE tenant_id=$1 AND lower(email)=lower($2) AND NOT archived ORDER BY created_at LIMIT 1`, [e.tenant_id, b.email]);
    if (!donor) {
      const [first, ...rest] = b.name.trim().split(/\s+/);
      donor = await one(db, `INSERT INTO donors(tenant_id, ministry_id, first_name, last_name, email, phone, source) VALUES ($1,$2,$3,$4,lower($5),$6,$7) RETURNING id`,
        [e.tenant_id, e.ministry_id, first, rest.join(' ') || null, b.email, b.phone ?? null, `Event: ${e.name}`]);
    }
    const dup = await one(db, `SELECT id FROM registrations WHERE event_id=$1 AND donor_id=$2 AND status<>'cancelled'`, [e.id, donor.id]);
    if (dup) return { ok: true, already: true };
    await db.query(`INSERT INTO registrations(tenant_id, event_id, donor_id, name, email, phone, guests) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [e.tenant_id, e.id, donor.id, b.name, b.email, b.phone ?? null, b.guests]);
    await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.trigger',$2)`, [e.tenant_id, { trigger: 'event_registration', donorId: donor.id, eventId: e.id }]);
    await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'donor.recalc',$2)`, [e.tenant_id, { donorId: donor.id }]);
    return { ok: true };
  });
  res.status(201).json(out);
}));

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
async function trackEvent(token: string, type: 'open' | 'click' | 'unsubscribe', url?: string) {
  await withSystem(async (db) => {
    const m = await one(db, `SELECT * FROM email_messages WHERE tracking_token=$1`, [token]);
    if (!m) return;
    await db.query(`INSERT INTO email_events(tenant_id, email_campaign_id, message_id, donor_id, type, url) VALUES ($1,$2,$3,$4,$5,$6)`, [m.tenant_id, m.email_campaign_id, m.id, m.donor_id, type, url ?? null]);
    if (type === 'unsubscribe') {
      await db.query(`INSERT INTO email_suppressions(tenant_id,email,reason) VALUES ($1,lower($2),'unsubscribe') ON CONFLICT DO NOTHING`, [m.tenant_id, m.to_email]);
      if (m.donor_id) await db.query(`UPDATE donors SET comm_prefs = comm_prefs || '{"email":false}' WHERE id=$1`, [m.donor_id]);
    }
  });
}
publicRouter.get('/t/o/:token.gif', (req, res) => { trackEvent(String(req.params.token), 'open').catch(() => {}); res.set('Cache-Control', 'no-store').type('gif').send(GIF); });
publicRouter.get('/t/c/:token', h(async (req, res) => {
  const url = String(req.query.u ?? '');
  if (!/^https?:\/\//i.test(url)) throw badRequest('Invalid link.');
  await trackEvent(String(req.params.token), 'click', url).catch(() => {});
  res.redirect(302, url);
}));
publicRouter.get('/t/u/:token', h(async (req, res) => {
  await trackEvent(String(req.params.token), 'unsubscribe');
  res.type('html').send('<!doctype html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>You have been unsubscribed.</h2><p>You will no longer receive these emails.</p></body>');
}));
publicRouter.post('/t/u/:token', h(async (req, res) => { await trackEvent(String(req.params.token), 'unsubscribe'); res.json({ ok: true }); }));

export const _r = { createDonor };

/** Website signup form (Grow): adds/updates a constituent tagged "subscriber". Honeypot + basic validation. */
import { urlencoded } from 'express';
publicRouter.post('/subscribe/:tenantId', urlencoded({ extended: false, limit: '10kb' }), h(async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), first_name: z.string().max(100).optional(), last_name: z.string().max(100).optional(), website: z.string().max(0).optional() }), req.body);
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.tenantId))) throw notFound('Organization');
  await withSystem(async (db) => {
    const t = await one(db, `SELECT id FROM tenants WHERE id=$1`, [req.params.tenantId]);
    if (!t) throw notFound('Organization');
    const d = await one(db, `SELECT id FROM donors WHERE tenant_id=$1 AND lower(email)=lower($2) AND NOT archived LIMIT 1`, [t.id, b.email]);
    if (d) await db.query(`UPDATE donors SET tags = (SELECT array_agg(DISTINCT x) FROM unnest(tags || '{subscriber}'::text[]) x), comm_prefs = comm_prefs || '{"email":true}' WHERE id=$1`, [d.id]);
    else {
      const n = await one(db, `INSERT INTO donors(tenant_id, first_name, last_name, email, tags, source) VALUES ($1,$2,$3,lower($4),'{subscriber}','Website signup') RETURNING id`, [t.id, b.first_name ?? null, b.last_name ?? (b.first_name ? null : b.email), b.email]);
      await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.trigger',$2)`, [t.id, { trigger: 'donor_created', donorId: n.id }]);
    }
    await db.query(`DELETE FROM email_suppressions WHERE tenant_id=$1 AND email=lower($2) AND reason='unsubscribe'`, [t.id, b.email]);
  });
  if (req.is('application/json')) return res.json({ ok: true });
  res.type('html').send('<!doctype html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Thank you for subscribing!</h2></body>');
}));
