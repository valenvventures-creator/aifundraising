/** Home dashboard, admin & access, settings, search, notifications, messages, imports, backups, growth, impact, calendar, attachments. */
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { parse as csvParse } from 'csv-parse/sync';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, actor, ministryScope, assertMinistry, can } from '../lib/auth.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, type Db } from '../db/pool.js';
import { DONOR_NAME_SQL, round2, today, addDays } from '../lib/util.js';
import { newInviteToken } from './auth.js';
import { config } from '../config.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { AUTOMATIONS } from '../services/tenant.js';
import { recalcDonors } from '../services/intelligence.js';
import { sendTable } from '../services/exporter.js';
import { createDonor } from './donors.js';
import { createGift } from './giving.js';
import { saveAttachment } from './money.js';
import { getFile } from '../lib/storage.js';
import { transportFor } from '../services/email.js';
import { fundSummaries } from '../services/ledger.js';

export const platformRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ───────── Workspaces (ministries) ─────────
platformRouter.get('/workspaces', h(async (req, res) => {
  const out = await tx(req, async (db) => {
    const p: unknown[] = []; const sc = ministryScope(req.auth!, 'm.id', p);
    return many(db, `SELECT m.*,
      (SELECT count(*) FROM donors d WHERE d.ministry_id=m.id AND NOT d.archived AND d.merged_into IS NULL)::int donor_count,
      (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.ministry_id=m.id AND NOT g.refunded AND g.gift_date >= date_trunc('year', current_date))::float giving_ytd,
      (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.ministry_id=m.id AND NOT g.refunded)::float lifetime
      FROM ministries m WHERE ${sc} AND ($${p.length + 1}::boolean OR NOT m.archived) ORDER BY m.name`, [...p, req.query.include_archived === 'true']);
  });
  res.json(out);
}));
platformRouter.post('/workspaces', h(async (req, res) => {
  requirePerm(req.auth, 'settings.manage');
  const b = parse(z.object({ name: z.string().min(1), description: z.string().nullish(), color: z.string().nullish() }), req.body);
  res.status(201).json(await tx(req, async (db) => {
    const m = await one(db, `INSERT INTO ministries(tenant_id,name,description,color) VALUES ($1,$2,$3,coalesce($4,'#6366f1')) RETURNING *`, [req.auth!.tenantId, b.name, b.description ?? null, b.color ?? null]);
    await db.query(`INSERT INTO voice_profiles(tenant_id, ministry_id, faith_enabled) SELECT $1,$2,faith_based FROM tenants WHERE id=$1`, [req.auth!.tenantId, m.id]);
    await audit(db, actor(req), 'admin', 'workspace_create', `Created workspace “${b.name}”`, { type: 'ministry', id: m.id });
    return m;
  }));
}));
platformRouter.patch('/workspaces/:id', h(async (req, res) => {
  requirePerm(req.auth, 'settings.manage');
  const b = parse(z.object({ name: z.string().min(1).optional(), description: z.string().nullish(), color: z.string().nullish(), archived: z.boolean().optional() }), req.body);
  res.json(await tx(req, async (db) => {
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    const m = await one(db, `UPDATE ministries SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...keys.map((k) => (b as any)[k])]);
    if (!m) throw notFound('Workspace');
    await audit(db, actor(req), 'admin', 'workspace_update', `Updated workspace “${m.name}”`, { type: 'ministry', id: m.id });
    return m;
  }));
}));

// ───────── Home dashboard (permission-aware, aggregated across authorized workspaces) ─────────
platformRouter.get('/dashboard', h(async (req, res) => {
  const a = req.auth!; const ministry = req.query.ministry_id ? String(req.query.ministry_id) : null;
  assertMinistry(a, ministry);
  const out = await tx(req, async (db) => {
    const r: any = { sections: [] };
    if (can(a, 'donors.read')) {
      const p: unknown[] = [ministry]; const sc = ministryScope(a, 'g.ministry_id', p);
      r.giving = await one(db, `SELECT coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('year',current_date)),0)::float ytd, coalesce(sum(amount),0)::float lifetime,
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('month',current_date)),0)::float mtd,
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('year',current_date) - interval '1 year' AND gift_date <= current_date - interval '1 year'),0)::float last_ytd,
        count(*) FILTER (WHERE receipt_status='pending')::int receipts_pending, count(*) FILTER (WHERE thank_you_status='pending')::int thanks_pending
        FROM gifts g WHERE NOT refunded AND ($1::uuid IS NULL OR g.ministry_id=$1) AND ${sc}`, p);
      const p2: unknown[] = [ministry]; const sc2 = ministryScope(a, 'd.ministry_id', p2);
      r.donors = await one(db, `SELECT count(*)::int total, count(*) FILTER (WHERE health_status IN ('active','engaged'))::int active, count(*) FILTER (WHERE health_status='lapsed')::int lapsed,
        count(*) FILTER (WHERE health_status='lapsing')::int lapsing, count(*) FILTER (WHERE created_at >= date_trunc('year',current_date))::int new_ytd,
        coalesce(sum((intelligence->>'opportunityValue')::numeric) FILTER (WHERE intelligence->>'category' NOT IN ('cultivate','thank_you')),0)::float pipeline
        FROM donors d WHERE NOT archived AND merged_into IS NULL AND ($1::uuid IS NULL OR d.ministry_id=$1) AND ${sc2}`, p2);
      r.recurring = await one(db, `SELECT coalesce(sum(CASE frequency WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount/3 WHEN 'annually' THEN amount/12 WHEN 'weekly' THEN amount*52/12 END),0)::float monthly, count(*)::int n
        FROM recurring_gifts r JOIN donors d ON d.id=r.donor_id WHERE r.status='active' AND ($1::uuid IS NULL OR d.ministry_id=$1) AND ${sc2}`, p2);
      r.monthly = await many(db, `SELECT to_char(gift_date,'YYYY-MM') AS month, sum(amount)::float total FROM gifts g WHERE NOT refunded AND gift_date > current_date - interval '12 months' AND ($1::uuid IS NULL OR g.ministry_id=$1) AND ${sc} GROUP BY 1 ORDER BY 1`, p);
      r.campaigns = await many(db, `SELECT c.id, c.name, c.goal::float, coalesce(sum(g.amount),0)::float raised FROM campaigns c LEFT JOIN gifts g ON g.campaign_id=c.id AND NOT g.refunded WHERE c.status='active' AND ($1::uuid IS NULL OR c.ministry_id=$1) GROUP BY c.id ORDER BY raised DESC LIMIT 5`, [ministry]);
    }
    if (can(a, 'finance.read')) {
      const funds = await fundSummaries(db);
      r.finance = { restricted: round2(funds.filter((f) => f.restriction !== 'unrestricted').reduce((s, f) => s + f.balance, 0)), unrestricted: round2(funds.filter((f) => f.restriction === 'unrestricted').reduce((s, f) => s + f.balance, 0)),
        funds: funds.slice(0, 8), ...(await one(db, `SELECT coalesce(sum(jl.debit-jl.credit) FILTER (WHERE a.type='expense'),0)::float expenses_ytd FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id WHERE je.entry_date >= date_trunc('year',current_date)`)) };
      r.budgetAlerts = await many(db, `SELECT b.id, b.name, a.name account, bl.amount::float budget, coalesce((SELECT sum(jl.debit-jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=bl.account_id AND (bl.fund_id IS NULL OR jl.fund_id=bl.fund_id) AND je.entry_date BETWEEN b.period_start AND b.period_end),0)::float actual
        FROM budget_lines bl JOIN budgets b ON b.id=bl.budget_id JOIN accounts a ON a.id=bl.account_id AND a.type='expense' WHERE current_date BETWEEN b.period_start AND b.period_end`).then((rows) => rows.filter((x) => x.budget > 0 && x.actual / x.budget >= 0.9));
    }
    if (can(a, 'work.read')) {
      const p: unknown[] = [a.userId, ministry]; const sc = ministryScope(a, 't.ministry_id', p);
      r.tasks = await one(db, `SELECT count(*) FILTER (WHERE due_date < current_date)::int overdue, count(*) FILTER (WHERE due_date BETWEEN current_date AND current_date+7)::int due_week,
        count(*) FILTER (WHERE assignee_id=$1)::int mine FROM tasks t WHERE status<>'completed' AND ($2::uuid IS NULL OR t.ministry_id=$2) AND ${sc}`, p);
      r.myTasks = await many(db, `SELECT t.id, t.title, t.due_date, t.status, t.progress FROM tasks t WHERE t.assignee_id=$1 AND t.status<>'completed' AND ($2::uuid IS NULL OR t.ministry_id=$2) AND ${sc} ORDER BY t.due_date NULLS LAST LIMIT 8`, p);
    }
    if (can(a, 'grants.read')) r.grants = await many(db, `SELECT id, title, status, deadline, report_due, request_amount::float, awarded_amount::float FROM grants WHERE status NOT IN ('declined','closed') AND ($1::uuid IS NULL OR ministry_id=$1) ORDER BY least(deadline, report_due) NULLS LAST LIMIT 6`, [ministry]);
    if (can(a, 'grants.read')) r.grantTotals = await one(db, `SELECT coalesce(sum(request_amount) FILTER (WHERE status IN ('submitted','under_review')),0)::float pending, coalesce(sum(awarded_amount) FILTER (WHERE status IN ('awarded','reporting','closed') AND decision_on >= date_trunc('year',current_date)),0)::float awarded_ytd FROM grants WHERE ($1::uuid IS NULL OR ministry_id=$1)`, [ministry]);
    if (can(a, 'events.read')) r.events = await many(db, `SELECT e.id, e.name, e.starts_at, (SELECT count(*) FROM registrations r WHERE r.event_id=e.id AND r.status<>'cancelled')::int registered FROM events e WHERE starts_at >= now() AND ($1::uuid IS NULL OR ministry_id=$1) ORDER BY starts_at LIMIT 5`, [ministry]);
    if (can(a, 'impact.read')) r.impact = await many(db, `SELECT m.id, m.name, m.unit, m.target::float, (SELECT coalesce(sum(value),0) FROM impact_entries e WHERE e.metric_id=m.id AND (m.period_start IS NULL OR e.entry_date >= m.period_start) AND (m.period_end IS NULL OR e.entry_date <= m.period_end))::float actual FROM impact_metrics m WHERE ($1::uuid IS NULL OR m.ministry_id=$1) ORDER BY m.created_at DESC LIMIT 4`, [ministry]);
    if (can(a, 'email.read')) r.email = await one(db, `SELECT count(*) FILTER (WHERE status='sent' AND sent_at > now() - interval '30 days')::int sent_30, count(*) FILTER (WHERE status='scheduled')::int scheduled FROM email_campaigns`);
    const t = await one(db, `SELECT onboarding, workspace_term, workspace_term_plural FROM tenants WHERE id=$1`, [a.tenantId]);
    r.onboarding = await onboardingStatus(db, t.onboarding ?? {});
    return r;
  });
  res.json(out);
}));

async function onboardingStatus(db: Db, ob: any) {
  const c = await one(db, `SELECT (SELECT count(*) FROM donors)::int donors, (SELECT count(*) FROM gifts)::int gifts, (SELECT count(*) FROM memberships)::int members,
    (SELECT count(*) FROM integrations WHERE provider='quickbooks' AND status='connected')::int qbo,
    (SELECT count(*) FROM integrations WHERE provider IN ('stripe','square','paypal') AND status='connected')::int payments,
    (SELECT count(*) FROM integrations WHERE provider='google' AND status='connected')::int google`);
  const steps = [
    { key: 'organization', label: 'Create organization', done: true, link: '/settings' },
    { key: 'terminology', label: 'Configure workspace terminology', done: Boolean(ob.terminology), link: '/settings?tab=organization' },
    { key: 'donors', label: 'Add or import donors', done: c.donors > 0 || Boolean(ob.donors), link: '/donors/giving/donors' },
    { key: 'funds', label: 'Review funds', done: Boolean(ob.funds), link: '/money/accounting/funds' },
    { key: 'accounting', label: 'Configure accounting (chart of accounts)', done: Boolean(ob.accounting), link: '/money/accounting/accounts' },
    { key: 'quickbooks', label: 'Connect QuickBooks (optional)', done: c.qbo > 0 || Boolean(ob.skip_quickbooks), optional: true, link: '/money/accounting/integrations' },
    { key: 'payments', label: 'Connect payment platforms (optional)', done: c.payments > 0 || Boolean(ob.skip_payments), optional: true, link: '/money/accounting/integrations' },
    { key: 'google', label: 'Connect Google Workspace (optional)', done: c.google > 0 || Boolean(ob.skip_google), optional: true, link: '/settings?tab=google' },
    { key: 'gifts', label: 'Import historic gifts', done: c.gifts > 0 || Boolean(ob.gifts), link: '/settings?tab=data' },
    { key: 'team', label: 'Invite team members & set permissions', done: c.members > 1 || Boolean(ob.skip_team), link: '/admin' },
    { key: 'voice', label: 'Create a voice profile', done: Boolean(ob.voice), link: '/donors/giving/outreach' },
    { key: 'receipts', label: 'Configure receipts', done: Boolean(ob.receipts), link: '/settings?tab=receipts' },
    { key: 'dashboard', label: 'Review your dashboard', done: Boolean(ob.dashboard), link: '/' },
  ];
  return { steps, complete: steps.every((s) => s.done) };
}
platformRouter.post('/onboarding/:step', h(async (req, res) => {
  const step = String(req.params.step).replace(/[^a-z_]/g, '');
  await tx(req, (db) => db.query(`UPDATE tenants SET onboarding = onboarding || jsonb_build_object($2::text, true) WHERE id=$1`, [req.auth!.tenantId, step]));
  res.json({ ok: true });
}));

// ───────── Quick Find ─────────
platformRouter.get('/search', h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  const a = req.auth!; const like = `%${q}%`; const digits = q.replace(/\D/g, '');
  const out = await tx(req, async (db) => {
    const results: any[] = [];
    const push = (type: string, rows: any[], href: (r: any) => string, sub: (r: any) => string = () => '') => rows.forEach((r) => results.push({ type, id: r.id, title: r.title, subtitle: sub(r), href: href(r) }));
    if (can(a, 'donors.read')) {
      const p: unknown[] = [like, digits]; const sc = ministryScope(a, 'd.ministry_id', p);
      push('Donor', await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} title, concat_ws(' · ', d.email, d.phone, d.city) sub FROM donors d WHERE NOT d.archived AND d.merged_into IS NULL AND ${sc} AND (${DONOR_NAME_SQL()} ILIKE $1 OR d.email ILIKE $1 OR d.spouse_name ILIKE $1 OR (length($2)>=4 AND regexp_replace(coalesce(d.phone,''),'\\D','','g') LIKE '%'||$2||'%')) ORDER BY d.score DESC LIMIT 8`, p), (r) => `/donors/${r.id}`, (r) => r.sub);
      const p2: unknown[] = [like]; const sc2 = ministryScope(a, 'g.ministry_id', p2);
      push('Gift', await many(db, `SELECT g.id, '$' || g.amount || ' — ' || ${DONOR_NAME_SQL()} title, g.gift_date::text || ' · ' || coalesce(g.provider_txn_id,'') sub, g.donor_id FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE ${sc2} AND (g.amount::text LIKE $1 OR g.provider_txn_id ILIKE $1 OR g.notes ILIKE $1) LIMIT 5`, p2), (r) => `/donors/${r.donor_id}#gifts`, (r) => r.sub);
      push('Campaign', await many(db, `SELECT id, name title FROM campaigns WHERE name ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/giving/campaigns/${r.id}`);
      push('Receipt', await many(db, `SELECT r.id, r.number title, r.donor_id FROM receipts r WHERE r.number ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/${r.donor_id}#receipts`);
    }
    push('Ministry/Organization', await many(db, `SELECT id, name title FROM ministries m WHERE name ILIKE $1 AND ${a.allMinistries ? 'TRUE' : `id = ANY($2::uuid[])`} LIMIT 5`, a.allMinistries ? [like] : [like, a.ministryIds]), (r) => `/workspaces/${r.id}`);
    if (can(a, 'grants.read')) {
      push('Grant', await many(db, `SELECT id, title FROM grants WHERE title ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/grants/${r.id}`);
      push('Funder', await many(db, `SELECT id, name title FROM funders WHERE name ILIKE $1 OR contact_name ILIKE $1 LIMIT 5`, [like]), () => `/donors/grants?tab=funders`);
    }
    if (can(a, 'projects.read')) push('Project', await many(db, `SELECT id, name title FROM projects WHERE name ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/projects/${r.id}`);
    if (can(a, 'events.read')) push('Event', await many(db, `SELECT id, name title, starts_at::date::text sub FROM events WHERE name ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/events/${r.id}`, (r) => r.sub);
    if (can(a, 'email.read')) push('Email', await many(db, `SELECT id, name title, status sub FROM email_campaigns WHERE name ILIKE $1 OR subject ILIKE $1 LIMIT 5`, [like]), (r) => `/donors/email/campaigns/${r.id}`, (r) => r.sub);
    if (can(a, 'finance.read')) {
      push('Transaction', await many(db, `SELECT je.id, coalesce(je.memo,'Journal entry') title, je.entry_date::text || ' · ' || je.source sub FROM journal_entries je WHERE je.memo ILIKE $1 OR je.reference ILIKE $1 OR EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id AND (jl.debit::text LIKE $1)) LIMIT 5`, [like]), (r) => `/money/accounting/transactions?q=${encodeURIComponent(q)}`, (r) => r.sub);
      push('Fund', await many(db, `SELECT id, name title, restriction sub FROM funds WHERE name ILIKE $1 OR code ILIKE $1 LIMIT 5`, [like]), (r) => `/money/accounting/funds/${r.id}`, (r) => r.sub);
      push('Invoice', await many(db, `SELECT id, number || ' — ' || customer_name title, status sub FROM invoices WHERE number ILIKE $1 OR customer_name ILIKE $1 LIMIT 5`, [like]), (r) => `/money/invoices/${r.id}`, (r) => r.sub);
    }
    if (can(a, 'work.read')) {
      push('Task', await many(db, `SELECT id, title, status sub FROM tasks WHERE title ILIKE $1 LIMIT 5`, [like]), (r) => `/work/tasks?open=${r.id}`, (r) => r.sub);
      push('Job', await many(db, `SELECT id, title, client_name sub FROM jobs WHERE title ILIKE $1 OR client_name ILIKE $1 LIMIT 5`, [like]), () => `/work/client-work`, (r) => r.sub ?? '');
      push('Communication', await many(db, `SELECT id, coalesce(subject, type) title, occurred_at::date::text sub FROM communications WHERE subject ILIKE $1 OR body ILIKE $1 ${can(a, 'donors.private_notes') ? '' : 'AND NOT is_private'} LIMIT 5`, [like]), () => `/work/communications`, (r) => r.sub);
    }
    if (can(a, 'admin.users')) push('User', await many(db, `SELECT u.id, u.name title, u.email sub FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.name ILIKE $1 OR u.email ILIKE $1 LIMIT 5`, [like]), () => `/admin`, (r) => r.sub);
    return results;
  });
  res.json(out);
}));

// ───────── Notifications ─────────
platformRouter.get('/notifications', h(async (req, res) => {
  res.json(await tx(req, async (db) => ({
    rows: await many(db, `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.auth!.userId]),
    unread: (await one(db, `SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.auth!.userId]))!.n,
  })));
}));
platformRouter.post('/notifications/read', h(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).optional() }), req.body ?? {});
  await tx(req, (db) => db.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`, [req.auth!.userId, ids ?? null]));
  res.json({ ok: true });
}));
platformRouter.put('/notifications/preferences', h(async (req, res) => {
  const b = parse(z.object({ email: z.boolean(), types: z.record(z.string(), z.boolean()).optional() }), req.body);
  await tx(req, (db) => db.query(`UPDATE memberships SET notification_prefs=$2 WHERE id=$1`, [req.auth!.membershipId, b]));
  res.json({ ok: true });
}));
platformRouter.get('/notifications/preferences', h(async (req, res) => {
  res.json(await tx(req, async (db) => (await one(db, `SELECT notification_prefs FROM memberships WHERE id=$1`, [req.auth!.membershipId]))!.notification_prefs));
}));

// ───────── Messages (internal) ─────────
platformRouter.get('/conversations', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  const p: unknown[] = [req.auth!.userId]; const sc = ministryScope(req.auth!, 'c.ministry_id', p);
  res.json(await tx(req, (db) => many(db, `SELECT c.*, m.name ministry_name,
      (SELECT body FROM messages x WHERE x.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) last_message,
      (SELECT max(created_at) FROM messages x WHERE x.conversation_id=c.id) last_at,
      (SELECT count(*) FROM messages x WHERE x.conversation_id=c.id AND x.created_at > coalesce(cm.last_read_at,'epoch') AND x.user_id<>$1)::int unread,
      (SELECT string_agg(u.name, ', ') FROM conversation_members mm JOIN users u ON u.id=mm.user_id WHERE mm.conversation_id=c.id) members
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 LEFT JOIN ministries m ON m.id=c.ministry_id
    WHERE ${sc} ORDER BY last_at DESC NULLS LAST`, p)));
}));
platformRouter.post('/conversations', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  const b = parse(z.object({ name: z.string().nullish(), user_ids: z.array(z.string().uuid()).min(1), ministry_id: z.string().uuid().nullish(), is_channel: z.boolean().default(false), body: z.string().min(1) }), req.body);
  assertMinistry(req.auth!, b.ministry_id);
  res.status(201).json(await tx(req, async (db) => {
    const valid = await many(db, `SELECT user_id FROM memberships WHERE user_id = ANY($1::uuid[]) AND status='active'`, [b.user_ids]);
    if (valid.length !== b.user_ids.length) throw badRequest('One or more recipients are not active members.');
    const c = await one(db, `INSERT INTO conversations(tenant_id, ministry_id, name, is_channel, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.auth!.tenantId, b.ministry_id ?? null, b.name ?? null, b.is_channel, req.auth!.userId]);
    for (const u of new Set([req.auth!.userId, ...b.user_ids])) await db.query(`INSERT INTO conversation_members(tenant_id,conversation_id,user_id) VALUES ($1,$2,$3)`, [req.auth!.tenantId, c.id, u]);
    await db.query(`INSERT INTO messages(tenant_id, conversation_id, user_id, body) VALUES ($1,$2,$3,$4)`, [req.auth!.tenantId, c.id, req.auth!.userId, b.body]);
    for (const u of b.user_ids) if (u !== req.auth!.userId) await db.query(`INSERT INTO notifications(tenant_id,user_id,type,title,body,link) VALUES ($1,$2,'message',$3,$4,$5)`, [req.auth!.tenantId, u, `New message from ${req.auth!.name}`, b.body.slice(0, 140), `/messages/${c.id}`]);
    return c;
  }));
}));
async function memberOf(db: Db, convId: string, userId: string) {
  if (!(await one(db, `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, [convId, userId]))) throw forbidden('You are not part of this conversation.');
}
platformRouter.get('/conversations/:id/messages', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  res.json(await tx(req, async (db) => {
    await memberOf(db, String(req.params.id), req.auth!.userId);
    await db.query(`UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.auth!.userId]);
    return many(db, `SELECT m.*, u.name user_name FROM messages m JOIN users u ON u.id=m.user_id WHERE conversation_id=$1 ORDER BY created_at LIMIT 500`, [req.params.id]);
  }));
}));
platformRouter.post('/conversations/:id/messages', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  const { body } = parse(z.object({ body: z.string().min(1).max(10000) }), req.body);
  res.status(201).json(await tx(req, async (db) => {
    await memberOf(db, String(req.params.id), req.auth!.userId);
    const m = await one(db, `INSERT INTO messages(tenant_id, conversation_id, user_id, body) VALUES ($1,$2,$3,$4) RETURNING *`, [req.auth!.tenantId, req.params.id, req.auth!.userId, body]);
    await db.query(`UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, [req.params.id, req.auth!.userId]);
    const mentions = [...body.matchAll(/@([\w.]+)/g)].map((x) => x[1].toLowerCase());
    if (mentions.length) {
      const users = await many(db, `SELECT u.id, u.name, u.email FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=$1`, [req.params.id]);
      for (const u of users) if (u.id !== req.auth!.userId && mentions.some((mm) => u.name.toLowerCase().replace(/\s+/g, '.').startsWith(mm) || u.email.split('@')[0] === mm))
        await db.query(`INSERT INTO notifications(tenant_id,user_id,type,title,body,link) VALUES ($1,$2,'mention',$3,$4,$5)`, [req.auth!.tenantId, u.id, `${req.auth!.name} mentioned you`, body.slice(0, 140), `/messages/${req.params.id}`]);
    }
    return m;
  }));
}));
platformRouter.post('/conversations/:id/status', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  const { status } = parse(z.object({ status: z.enum(['open', 'closed']) }), req.body);
  await tx(req, async (db) => { await memberOf(db, String(req.params.id), req.auth!.userId); await db.query(`UPDATE conversations SET status=$2 WHERE id=$1`, [req.params.id, status]); });
  res.json({ ok: true });
}));

// ───────── Team (light list for pickers) ─────────
platformRouter.get('/team', h(async (req, res) => {
  res.json(await tx(req, (db) => many(db, `SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.status='active' ORDER BY u.name`)));
}));

// ───────── Admin & Access ─────────
platformRouter.get('/admin/users', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  res.json(await tx(req, (db) => many(db, `SELECT m.id membership_id, m.status, m.all_ministries, m.ministry_ids, m.seat, m.invited_email, m.created_at, r.id role_id, r.name role_name, u.id user_id, u.name, u.email,
      (SELECT max(created_at) FROM audit_events a WHERE a.user_id=u.id AND a.action='login') last_login
    FROM memberships m JOIN roles r ON r.id=m.role_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.status, u.name NULLS LAST`)));
}));
platformRouter.post('/admin/invite', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  const b = parse(z.object({ email: z.string().email(), role_id: z.string().uuid(), all_ministries: z.boolean().default(false), ministry_ids: z.array(z.string().uuid()).default([]) }), req.body);
  if (!b.all_ministries && !b.ministry_ids.length) throw badRequest('Grant access to at least one workspace (or all workspaces).');
  const out = await tx(req, async (db) => {
    const role = await one(db, `SELECT * FROM roles WHERE id=$1`, [b.role_id]); if (!role) throw badRequest('Choose a role.');
    if (role.permissions.includes('admin.users') && !req.auth!.allMinistries) throw forbidden('Only organization-wide admins can invite other admins.');
    const existing = await one(db, `SELECT m.id FROM memberships m LEFT JOIN users u ON u.id=m.user_id WHERE lower(coalesce(u.email, m.invited_email))=lower($1)`, [b.email]);
    if (existing) throw conflict('That person already has access or a pending invitation.');
    const token = newInviteToken();
    const m = await one(db, `INSERT INTO memberships(tenant_id, role_id, status, all_ministries, ministry_ids, invited_email, invite_token) VALUES ($1,$2,'invited',$3,$4,lower($5),$6) RETURNING id`,
      [req.auth!.tenantId, b.role_id, b.all_ministries, b.ministry_ids, b.email, token]);
    const link = `${config.appUrl}/invite/${token}`;
    let emailed = false;
    const tr = await transportFor(db, req.auth!.userId);
    if (tr) { const org = await one(db, `SELECT name FROM tenants WHERE id=$1`, [req.auth!.tenantId]); await tr.t.sendMail({ from: tr.from, to: b.email, subject: `You're invited to ${org.name} on A.I. Nonprofits`, text: `${req.auth!.name} invited you to join ${org.name}.\n\nAccept: ${link}` }).then(() => { emailed = true; }).catch(() => {}); }
    await audit(db, actor(req), 'admin', 'invite', `Invited ${b.email} as ${role.name}`, { type: 'membership', id: m.id });
    return { link, emailed };
  });
  res.status(201).json(out);
}));
platformRouter.patch('/admin/memberships/:id', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  const b = parse(z.object({ role_id: z.string().uuid().optional(), status: z.enum(['active', 'inactive']).optional(), all_ministries: z.boolean().optional(), ministry_ids: z.array(z.string().uuid()).optional(), seat: z.boolean().optional() }), req.body);
  await tx(req, async (db) => {
    const m = await one(db, `SELECT m.*, r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.id=$1`, [req.params.id]); if (!m) throw notFound('User');
    if (m.user_id === req.auth!.userId && (b.status === 'inactive' || b.role_id)) throw badRequest('You cannot change your own role or deactivate yourself.');
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    await db.query(`UPDATE memberships SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [m.id, ...keys.map((k) => (b as any)[k])]);
    const admins = await one(db, `SELECT count(*)::int n FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.status='active' AND 'admin.users' = ANY(r.permissions) AND m.all_ministries`);
    if (admins!.n === 0) throw badRequest('At least one active organization-wide administrator is required.');
    await audit(db, actor(req), 'admin', 'access_change', `Changed access for membership ${m.id.slice(0, 8)} (${keys.join(', ')})`, { type: 'membership', id: m.id }, b);
  });
  res.json({ ok: true });
}));
platformRouter.delete('/admin/memberships/:id', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  await tx(req, async (db) => {
    const m = await one(db, `SELECT * FROM memberships WHERE id=$1`, [req.params.id]); if (!m) throw notFound('User');
    if (m.status !== 'invited') throw badRequest('Deactivate active users instead of deleting them (keeps history).');
    await db.query(`DELETE FROM memberships WHERE id=$1`, [m.id]);
    await audit(db, actor(req), 'admin', 'invite_revoked', `Revoked invitation for ${m.invited_email}`, { type: 'membership', id: m.id });
  });
  res.json({ ok: true });
}));
platformRouter.get('/admin/roles', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  res.json(await tx(req, async (db) => ({ roles: await many(db, `SELECT r.*, (SELECT count(*) FROM memberships m WHERE m.role_id=r.id)::int members FROM roles r ORDER BY is_system DESC, name`), catalog: PERMISSIONS })));
}));
platformRouter.post('/admin/roles', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  const b = parse(z.object({ name: z.string().min(2), description: z.string().nullish(), permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [string, ...string[]])) }), req.body);
  res.status(201).json(await tx(req, async (db) => { const r = await one(db, `INSERT INTO roles(tenant_id,name,description,permissions) VALUES ($1,$2,$3,$4) RETURNING *`, [req.auth!.tenantId, b.name, b.description ?? null, b.permissions]); await audit(db, actor(req), 'admin', 'role_create', `Created role ${b.name}`, { type: 'role', id: r.id }, b); return r; }));
}));
platformRouter.patch('/admin/roles/:id', h(async (req, res) => {
  requirePerm(req.auth, 'admin.users');
  const b = parse(z.object({ name: z.string().min(2).optional(), description: z.string().nullish(), permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [string, ...string[]])).optional() }), req.body);
  res.json(await tx(req, async (db) => {
    const r = await one(db, `SELECT * FROM roles WHERE id=$1`, [req.params.id]); if (!r) throw notFound('Role');
    if (r.is_system && r.name === 'Organization Admin') throw badRequest('The Organization Admin role cannot be edited.');
    const u = await one(db, `UPDATE roles SET name=coalesce($2,name), description=coalesce($3,description), permissions=coalesce($4,permissions) WHERE id=$1 RETURNING *`, [r.id, b.name ?? null, b.description ?? null, b.permissions ?? null]);
    await audit(db, actor(req), 'admin', 'role_update', `Updated role ${u.name}`, { type: 'role', id: r.id }, { before: r.permissions, after: u.permissions });
    return u;
  }));
}));
platformRouter.get('/admin/audit', h(async (req, res) => {
  requirePerm(req.auth, 'audit.read');
  res.json(await tx(req, (db) => many(db, `SELECT a.*, u.name user_name FROM audit_events a LEFT JOIN users u ON u.id=a.user_id
    WHERE ($1::text IS NULL OR a.category=$1) AND ($2::text IS NULL OR a.description ILIKE '%'||$2||'%') ORDER BY a.created_at DESC LIMIT 500`, [req.query.category || null, req.query.q || null])));
}));

// ───────── Settings ─────────
platformRouter.get('/settings', h(async (req, res) => {
  res.json(await tx(req, async (db) => ({
    tenant: await one(db, `SELECT * FROM tenants WHERE id=$1`, [req.auth!.tenantId]),
    automations: (await many(db, `SELECT * FROM automations ORDER BY key`)).map((a) => ({ ...a, description: AUTOMATIONS.find(([k]) => k === a.key)?.[1] })),
  })));
}));
platformRouter.patch('/settings', h(async (req, res) => {
  requirePerm(req.auth, 'settings.manage');
  const b = parse(z.object({ name: z.string().min(1).optional(), legal_name: z.string().nullish(), email: z.string().email().nullish().or(z.literal('')), phone: z.string().nullish(), address1: z.string().nullish(), city: z.string().nullish(),
    region: z.string().nullish(), postal_code: z.string().nullish(), country: z.string().nullish(), currency: z.string().length(3).optional(), locale: z.string().optional(), workspace_term: z.string().min(1).optional(),
    workspace_term_plural: z.string().min(1).optional(), invoice_terms: z.string().optional(), tax_jurisdiction: z.enum(['US-IRS', 'CA-CRA', 'OTHER']).optional(), tax_id: z.string().nullish(),
    receipt_settings: z.record(z.string(), z.any()).optional(), faith_based: z.boolean().optional(), billing_enabled: z.boolean().optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
    health_rules: z.object({ activeDays: z.number().int().positive(), engagedDays: z.number().int().positive(), coolingDays: z.number().int().positive(), lapsingDays: z.number().int().positive() }).optional(),
    opportunity_rules: z.record(z.string(), z.any()).optional(), attribution_window_days: z.number().int().min(1).max(90).optional() }), req.body);
  if (b.health_rules) { const r = b.health_rules; if (!(r.activeDays < r.engagedDays && r.engagedDays < r.coolingDays && r.coolingDays < r.lapsingDays)) throw badRequest('Donor health thresholds must increase: active < engaged < cooling < lapsing.'); }
  const out = await tx(req, async (db) => {
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (!keys.length) throw badRequest('Nothing to update.');
    const t = await one(db, `UPDATE tenants SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [req.auth!.tenantId, ...keys.map((k) => ((b as any)[k] === '' ? null : (b as any)[k]))]);
    if (keys.includes('workspace_term')) await db.query(`UPDATE tenants SET onboarding = onboarding || '{"terminology":true}' WHERE id=$1`, [t.id]);
    if (keys.includes('receipt_settings') || keys.includes('tax_id')) await db.query(`UPDATE tenants SET onboarding = onboarding || '{"receipts":true}' WHERE id=$1`, [t.id]);
    if (keys.some((k) => ['health_rules', 'opportunity_rules'].includes(k))) await recalcDonors(db);
    await audit(db, actor(req), 'settings', 'update', `Updated organization settings (${keys.join(', ')})`);
    return t;
  });
  res.json(out);
}));
platformRouter.post('/settings/automations/:key', h(async (req, res) => {
  requirePerm(req.auth, 'settings.manage');
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  await tx(req, async (db) => { await db.query(`UPDATE automations SET enabled=$2 WHERE key=$1`, [req.params.key, enabled]); await audit(db, actor(req), 'settings', 'automation', `${enabled ? 'Enabled' : 'Disabled'} automation ${req.params.key}`); });
  res.json({ ok: true });
}));
platformRouter.post('/settings/recalculate', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  res.json({ donors: await tx(req, async (db) => { const n = await recalcDonors(db); await db.query(`UPDATE automations SET last_run_at=now(), last_status='ok' WHERE key='donor_health'`); return n; }) });
}));

// ───────── Backups ─────────
const BACKUP_TABLES = ['ministries', 'donors', 'campaigns', 'projects', 'funds', 'accounts', 'gifts', 'recurring_gifts', 'receipts', 'asks', 'communications', 'tasks', 'jobs', 'time_entries', 'rate_types', 'funders', 'grants',
  'events', 'registrations', 'audiences', 'email_campaigns', 'email_templates', 'journeys', 'journal_entries', 'journal_lines', 'budgets', 'budget_lines', 'bank_accounts', 'bank_transactions', 'expenses', 'invoices',
  'invoice_lines', 'payroll_entries', 'impact_metrics', 'impact_entries', 'impact_stories', 'growth_goals', 'voice_profiles', 'weekly_updates', 'trips', 'trip_stops'];
platformRouter.get('/backup', h(async (req, res) => {
  requirePerm(req.auth, 'data.export', 'settings.manage');
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  const table = req.query.table ? String(req.query.table) : null;
  if (table && !BACKUP_TABLES.includes(table)) throw badRequest('Unknown table.');
  const data = await tx(req, async (db) => {
    const out: Record<string, any[]> = {};
    for (const t of table ? [table] : BACKUP_TABLES) {
      const rows = await many(db, `SELECT * FROM ${t}`);
      out[t] = can(req.auth!, 'donors.private_notes') ? rows : rows.map(({ private_notes, ...r }) => r);
    }
    await audit(db, actor(req), 'export', 'backup', `Downloaded ${format.toUpperCase()} backup${table ? ` of ${table}` : ''}`);
    return out;
  });
  if (format === 'csv') {
    if (!table) throw badRequest('Choose a table for CSV backup (JSON includes everything).');
    const rows = data[table]; const cols = rows[0] ? Object.keys(rows[0]) : [];
    return sendTable(res, 'csv', `${table}-backup-${today()}`, cols.map((c) => ({ key: c, label: c })), rows);
  }
  res.setHeader('Content-Disposition', `attachment; filename="ai-nonprofits-backup-${today()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), version: 1, tables: data });
}));

// ───────── Imports (upload → map → preview → commit → rollback) ─────────
const IMPORT_FIELDS: Record<string, string[]> = {
  donors: ['donor_type', 'first_name', 'last_name', 'org_name', 'household_name', 'spouse_name', 'email', 'phone', 'address1', 'address2', 'city', 'region', 'postal_code', 'country', 'tags', 'source', 'notes', 'external_id'],
  gifts: ['donor_email', 'donor_external_id', 'donor_first_name', 'donor_last_name', 'amount', 'gift_date', 'fund', 'campaign', 'project', 'payment_method', 'gift_type', 'notes', 'reference'],
  funds: ['name', 'code', 'restriction', 'description'],
  accounts: ['code', 'name', 'type', 'subtype', 'description'],
  grants: ['title', 'funder', 'request_amount', 'awarded_amount', 'deadline', 'status', 'notes'],
  projects: ['name', 'description', 'goal', 'budget', 'status', 'starts_on', 'ends_on'],
  tasks: ['title', 'due_date', 'status', 'notes', 'category'],
};
const MIGRATION_PRESETS: Record<string, Record<string, string>> = {
  generic: {},
  'donor-crm-a': { 'First Name': 'first_name', 'Last Name': 'last_name', 'Email Address': 'email', 'Phone Number': 'phone', 'Address Line 1': 'address1', City: 'city', State: 'region', Zip: 'postal_code', 'Account ID': 'external_id' },
  'donor-crm-b': { FirstName: 'first_name', LastName: 'last_name', Email: 'email', Phone: 'phone', Street: 'address1', City: 'city', 'State/Province': 'region', 'ZIP/Postal Code': 'postal_code', 'Constituent ID': 'external_id', 'Organization Name': 'org_name' },
  'church-mgmt': { 'First': 'first_name', 'Last': 'last_name', 'Household': 'household_name', 'Email': 'email', 'Mobile Phone': 'phone', 'Address': 'address1', 'City': 'city', 'State': 'region', 'Zip': 'postal_code', 'Person ID': 'external_id' },
};
platformRouter.get('/imports/templates/:entity', h(async (req, res) => {
  const f = IMPORT_FIELDS[String(req.params.entity)]; if (!f) throw notFound('Template');
  await sendTable(res, 'csv', `${req.params.entity}-import-template`, f.map((k) => ({ key: k, label: k })), []);
}));
platformRouter.get('/imports/meta', (_req, res) => res.json({ fields: IMPORT_FIELDS, presets: Object.keys(MIGRATION_PRESETS) }));
platformRouter.post('/imports', upload.single('file'), h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  const { entity, preset } = parse(z.object({ entity: z.enum(Object.keys(IMPORT_FIELDS) as [string, ...string[]]), preset: z.string().optional() }), req.body);
  if (!req.file) throw badRequest('Choose a CSV file.');
  let rows: Record<string, string>[];
  try { rows = csvParse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }); }
  catch (e: any) { throw badRequest(`Could not read the CSV: ${e.message}`); }
  if (!rows.length) throw badRequest('The file has no data rows.');
  if (rows.length > 50000) throw badRequest('Import files are limited to 50,000 rows; split the file.');
  const headers = Object.keys(rows[0]);
  const presetMap = MIGRATION_PRESETS[preset ?? 'generic'] ?? {};
  const mapping: Record<string, string> = {};
  for (const hdr of headers) {
    const norm = hdr.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    mapping[hdr] = presetMap[hdr] ?? (IMPORT_FIELDS[entity].includes(norm) ? norm : { state: 'region', province: 'region', zip: 'postal_code', postal: 'postal_code', first: 'first_name', last: 'last_name', date: 'gift_date', designation: 'fund', email_address: 'email' }[norm] ?? '');
  }
  const s = await tx(req, (db) => one(db, `INSERT INTO import_sessions(tenant_id,user_id,entity,filename,headers,rows,mapping) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, entity, headers, mapping, status`,
    [req.auth!.tenantId, req.auth!.userId, entity, req.file!.originalname, headers, JSON.stringify(rows), mapping]));
  res.status(201).json({ ...s, rowCount: rows.length, sample: rows.slice(0, 5), fields: IMPORT_FIELDS[entity] });
}));

function mapRow(row: Record<string, string>, mapping: Record<string, string>) {
  const o: Record<string, string> = {};
  for (const [hdr, field] of Object.entries(mapping)) if (field && row[hdr] !== undefined && row[hdr] !== '') o[field] = row[hdr];
  return o;
}
function normDate(v?: string) { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
function normMoney(v?: string) { if (v === undefined) return NaN; return Number(String(v).replace(/[$,\s]/g, '')); }

async function validateImport(db: Db, s: any) {
  const errors: { row: number; message: string }[] = []; const dups: { row: number; message: string }[] = []; const valid: any[] = [];
  const funds = await many(db, `SELECT id, lower(name) n, lower(coalesce(code,'')) c FROM funds WHERE NOT archived`);
  const camps = await many(db, `SELECT id, lower(name) n FROM campaigns`);
  const projects = await many(db, `SELECT id, lower(name) n FROM projects`);
  const seenEmails = new Set<string>();
  for (const [i, raw] of (s.rows as any[]).entries()) {
    const r = mapRow(raw, s.mapping); const n = i + 2;
    if (s.entity === 'donors') {
      let type = (r.donor_type ?? (r.org_name && !r.first_name && !r.last_name ? 'organization' : 'individual')).toLowerCase();
      if (type === 'grantmaker') type = 'foundation'; // shown as “Grantmaker” in the app
      if (!['individual', 'household', 'foundation', 'business', 'church', 'organization'].includes(type)) { errors.push({ row: n, message: `Unknown donor type “${r.donor_type}”` }); continue; }
      if (!(r.first_name || r.last_name || r.org_name || r.household_name)) { errors.push({ row: n, message: 'Missing name' }); continue; }
      if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) { errors.push({ row: n, message: `Invalid email “${r.email}”` }); continue; }
      if (r.email) {
        const e = r.email.toLowerCase();
        if (seenEmails.has(e)) { dups.push({ row: n, message: `Duplicate email within file: ${e}` }); continue; }
        seenEmails.add(e);
        if (await one(db, `SELECT 1 FROM donors WHERE lower(email)=$1 AND NOT archived`, [e])) { dups.push({ row: n, message: `Already in database: ${e} (will be skipped)` }); continue; }
      } else if (r.first_name && r.last_name && await one(db, `SELECT 1 FROM donors WHERE lower(first_name)=lower($1) AND lower(last_name)=lower($2) AND coalesce(postal_code,'')=coalesce($3,'') AND NOT archived`, [r.first_name, r.last_name, r.postal_code ?? null])) {
        dups.push({ row: n, message: `Possible duplicate: ${r.first_name} ${r.last_name} (will be skipped)` }); continue;
      }
      valid.push({ ...r, donor_type: type });
    } else if (s.entity === 'gifts') {
      const amt = normMoney(r.amount); const date = normDate(r.gift_date);
      if (!(amt > 0)) { errors.push({ row: n, message: `Invalid amount “${r.amount}”` }); continue; }
      if (!date) { errors.push({ row: n, message: `Invalid date “${r.gift_date}”` }); continue; }
      const f = r.fund ? funds.find((x) => x.n === r.fund.toLowerCase() || x.c === r.fund.toLowerCase()) : funds[0];
      if (!f) { errors.push({ row: n, message: `Unknown fund “${r.fund}” — create it first or fix the name` }); continue; }
      let donor = r.donor_external_id ? await one(db, `SELECT id FROM donors WHERE custom->>'external_id'=$1 AND NOT archived`, [r.donor_external_id]) : null;
      donor ??= r.donor_email ? await one(db, `SELECT id FROM donors WHERE lower(email)=lower($1) AND NOT archived`, [r.donor_email]) : null;
      donor ??= r.donor_first_name && r.donor_last_name ? await one(db, `SELECT id FROM donors WHERE lower(first_name)=lower($1) AND lower(last_name)=lower($2) AND NOT archived LIMIT 1`, [r.donor_first_name, r.donor_last_name]) : null;
      if (!donor && !(r.donor_first_name || r.donor_last_name || r.donor_email)) { errors.push({ row: n, message: 'Cannot identify donor (email, external id or name required)' }); continue; }
      if (r.reference && await one(db, `SELECT 1 FROM gifts WHERE provider='import' AND provider_txn_id=$1`, [r.reference])) { dups.push({ row: n, message: `Gift reference ${r.reference} already imported (will be skipped)` }); continue; }
      valid.push({ donor_id: donor?.id, new_donor: donor ? undefined : { first_name: r.donor_first_name, last_name: r.donor_last_name ?? (r.donor_first_name ? null : r.donor_email), email: r.donor_email },
        amount: amt, gift_date: date, fund_id: f.id, campaign_id: r.campaign ? camps.find((c) => c.n === r.campaign.toLowerCase())?.id ?? null : null,
        project_id: r.project ? projects.find((c) => c.n === r.project.toLowerCase())?.id ?? null : null, payment_method: r.payment_method ?? 'other', gift_type: r.gift_type ?? 'one_time', notes: r.notes,
        receipt_status: 'not_required', thank_you_status: 'not_required', reference: r.reference });
    } else if (s.entity === 'funds') {
      const rest = (r.restriction ?? 'unrestricted').toLowerCase();
      if (!r.name) { errors.push({ row: n, message: 'Missing name' }); continue; }
      if (!['unrestricted', 'purpose', 'time', 'permanent'].includes(rest)) { errors.push({ row: n, message: `Restriction must be unrestricted/purpose/time/permanent` }); continue; }
      if (funds.some((f) => f.n === r.name.toLowerCase())) { dups.push({ row: n, message: `Fund “${r.name}” exists (will be skipped)` }); continue; }
      valid.push({ ...r, restriction: rest });
    } else if (s.entity === 'accounts') {
      if (!r.code || !r.name || !['asset', 'liability', 'net_assets', 'revenue', 'expense'].includes((r.type ?? '').toLowerCase())) { errors.push({ row: n, message: 'Code, name and a valid type are required' }); continue; }
      if (await one(db, `SELECT 1 FROM accounts WHERE code=$1`, [r.code])) { dups.push({ row: n, message: `Account ${r.code} exists (will be skipped)` }); continue; }
      valid.push({ ...r, type: r.type.toLowerCase() });
    } else if (s.entity === 'grants') {
      if (!r.title) { errors.push({ row: n, message: 'Missing title' }); continue; }
      valid.push({ ...r, request_amount: r.request_amount ? normMoney(r.request_amount) : null, awarded_amount: r.awarded_amount ? normMoney(r.awarded_amount) : null, deadline: normDate(r.deadline), status: (r.status ?? 'researching').toLowerCase().replace(/\s+/g, '_') });
    } else if (s.entity === 'projects') {
      if (!r.name) { errors.push({ row: n, message: 'Missing name' }); continue; }
      valid.push({ ...r, goal: r.goal ? normMoney(r.goal) : null, budget: r.budget ? normMoney(r.budget) : null, starts_on: normDate(r.starts_on), ends_on: normDate(r.ends_on), status: r.status ?? 'active' });
    } else if (s.entity === 'tasks') {
      if (!r.title) { errors.push({ row: n, message: 'Missing title' }); continue; }
      valid.push({ ...r, due_date: normDate(r.due_date), status: ['todo', 'in_progress', 'waiting', 'completed'].includes(r.status) ? r.status : 'todo' });
    }
  }
  return { valid, errors, duplicates: dups };
}

platformRouter.post('/imports/:id/preview', h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  const b = parse(z.object({ mapping: z.record(z.string(), z.string()) }), req.body);
  res.json(await tx(req, async (db) => {
    const s = await one(db, `UPDATE import_sessions SET mapping=$2, status='previewed' WHERE id=$1 AND status IN ('uploaded','previewed') RETURNING *`, [req.params.id, b.mapping]);
    if (!s) throw notFound('Import');
    const v = await validateImport(db, s);
    return { total: s.rows.length, valid: v.valid.length, preview: v.valid.slice(0, 10), errors: v.errors.slice(0, 500), errorCount: v.errors.length, duplicates: v.duplicates.slice(0, 500), duplicateCount: v.duplicates.length };
  }));
}));
platformRouter.get('/imports/:id/errors.csv', h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  const v = await tx(req, async (db) => { const s = await one(db, `SELECT * FROM import_sessions WHERE id=$1`, [req.params.id]); if (!s) throw notFound('Import'); return validateImport(db, s); });
  await sendTable(res, 'csv', `import-errors`, [{ key: 'row', label: 'Row' }, { key: 'kind', label: 'Kind' }, { key: 'message', label: 'Message' }], [...v.errors.map((e) => ({ ...e, kind: 'error' })), ...v.duplicates.map((e) => ({ ...e, kind: 'duplicate' }))]);
}));
platformRouter.post('/imports/:id/commit', h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  const out = await tx(req, async (db) => {
    const s = await one(db, `SELECT * FROM import_sessions WHERE id=$1 AND status='previewed' FOR UPDATE`, [req.params.id]);
    if (!s) throw badRequest('Preview the import before committing.');
    const v = await validateImport(db, s);
    const created: { table: string; id: string }[] = [];
    for (const r of v.valid) {
      if (s.entity === 'donors') {
        const { external_id, tags, ...rest } = r;
        const d = await createDonor(db, req, { ...rest, tags: tags ? String(tags).split(/[;,]/).map((x: string) => x.trim()).filter(Boolean) : undefined, custom: external_id ? { external_id } : undefined }, { skipDuplicateCheck: true });
        created.push({ table: 'donors', id: d.id });
      } else if (s.entity === 'gifts') {
        const { reference, ...g } = r;
        const gift = await createGift(db, req, g, { forceNewDonor: true, provider: 'import', providerTxnId: reference ?? undefined });
        created.push({ table: 'gifts', id: gift.id });
      } else if (s.entity === 'funds') created.push({ table: 'funds', id: (await one(db, `INSERT INTO funds(tenant_id,name,code,restriction,description) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [req.auth!.tenantId, r.name, r.code ?? null, r.restriction, r.description ?? null])).id });
      else if (s.entity === 'accounts') created.push({ table: 'accounts', id: (await one(db, `INSERT INTO accounts(tenant_id,code,name,type,subtype,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [req.auth!.tenantId, r.code, r.name, r.type, r.subtype ?? null, r.description ?? null])).id });
      else if (s.entity === 'grants') {
        const funder = r.funder ? (await one(db, `SELECT id FROM funders WHERE lower(name)=lower($1)`, [r.funder]))?.id ?? (await one(db, `INSERT INTO funders(tenant_id,name) VALUES ($1,$2) RETURNING id`, [req.auth!.tenantId, r.funder])).id : null;
        created.push({ table: 'grants', id: (await one(db, `INSERT INTO grants(tenant_id,title,funder_id,request_amount,awarded_amount,deadline,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [req.auth!.tenantId, r.title, funder, r.request_amount, r.awarded_amount, r.deadline, r.status, r.notes ?? null])).id });
      } else if (s.entity === 'projects') created.push({ table: 'projects', id: (await one(db, `INSERT INTO projects(tenant_id,name,description,goal,budget,status,starts_on,ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [req.auth!.tenantId, r.name, r.description ?? null, r.goal, r.budget, r.status, r.starts_on, r.ends_on])).id });
      else if (s.entity === 'tasks') created.push({ table: 'tasks', id: (await one(db, `INSERT INTO tasks(tenant_id,title,due_date,status,notes,category,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [req.auth!.tenantId, r.title, r.due_date, r.status, r.notes ?? null, r.category ?? null, req.auth!.userId])).id });
    }
    await db.query(`UPDATE import_sessions SET status='committed', created_ids=$2, result=$3, rows='[]' WHERE id=$1`, [s.id, JSON.stringify(created), { created: created.length, errors: v.errors.length, duplicates: v.duplicates.length }]);
    await audit(db, actor(req), 'import', 'commit', `Imported ${created.length} ${s.entity} from ${s.filename}`, { type: 'import', id: s.id });
    return { created: created.length, errors: v.errors.length, duplicates: v.duplicates.length };
  });
  res.json(out);
}));
platformRouter.post('/imports/:id/rollback', h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  const out = await tx(req, async (db) => {
    const s = await one(db, `SELECT * FROM import_sessions WHERE id=$1 AND status='committed' FOR UPDATE`, [req.params.id]);
    if (!s) throw badRequest('Only committed imports can be rolled back.');
    if (Date.now() - new Date(s.created_at).getTime() > 7 * 86400000) throw badRequest('Imports can only be rolled back within 7 days.');
    const ids: { table: string; id: string }[] = s.created_ids;
    let n = 0;
    for (const { table, id } of [...ids].reverse()) {
      if (table === 'gifts') {
        const g = await one(db, `SELECT journal_entry_id FROM gifts WHERE id=$1`, [id]);
        if (g?.journal_entry_id) await db.query(`UPDATE journal_entries SET status='void' WHERE id=$1`, [g.journal_entry_id]);
        await db.query(`DELETE FROM receipts WHERE gift_id=$1`, [id]);
        await db.query(`UPDATE payment_transactions SET gift_id=NULL WHERE gift_id=$1`, [id]);
        n += (await db.query(`DELETE FROM gifts WHERE id=$1`, [id])).rowCount ?? 0;
      } else if (table === 'donors') {
        const has = await one(db, `SELECT 1 FROM gifts WHERE donor_id=$1`, [id]);
        if (has) await db.query(`UPDATE donors SET archived=true WHERE id=$1`, [id]); else n += (await db.query(`DELETE FROM donors WHERE id=$1`, [id]).catch(() => db.query(`UPDATE donors SET archived=true WHERE id=$1`, [id]))).rowCount ?? 0;
      } else {
        await db.query('SAVEPOINT rb');
        try { n += (await db.query(`DELETE FROM ${table} WHERE id=$1`, [id])).rowCount ?? 0; await db.query('RELEASE SAVEPOINT rb'); }
        catch { await db.query('ROLLBACK TO SAVEPOINT rb'); }
      }
    }
    await db.query(`UPDATE import_sessions SET status='rolled_back' WHERE id=$1`, [s.id]);
    await recalcDonors(db);
    await audit(db, actor(req), 'import', 'rollback', `Rolled back import ${s.filename} (${n} records removed)`, { type: 'import', id: s.id });
    return { removed: n };
  });
  res.json(out);
}));
platformRouter.get('/imports', h(async (req, res) => {
  requirePerm(req.auth, 'data.import');
  res.json(await tx(req, (db) => many(db, `SELECT id, entity, filename, status, result, created_at FROM import_sessions ORDER BY created_at DESC LIMIT 50`)));
}));

// ───────── Calendar (aggregated) ─────────
platformRouter.get('/calendar', h(async (req, res) => {
  requirePerm(req.auth, 'work.read');
  const from = String(req.query.from ?? addDays(today(), -31)), to = String(req.query.to ?? addDays(today(), 62));
  const userFilter = req.query.user_id ? String(req.query.user_id) : null; const ministry = req.query.ministry_id ? String(req.query.ministry_id) : null;
  const types = String(req.query.types ?? 'task,follow_up,meeting,trip,event,grant,job').split(',');
  const a = req.auth!;
  const out = await tx(req, async (db) => {
    const items: any[] = [];
    const P = [from, to, userFilter, ministry];
    const p1 = [...P]; const sc = ministryScope(a, 't.ministry_id', p1);
    if (types.includes('task') || types.includes('follow_up')) for (const t of await many(db, `SELECT t.id, t.title, t.due_date, t.category, t.status, t.donor_id FROM tasks t WHERE t.due_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR t.assignee_id=$3) AND ($4::uuid IS NULL OR t.ministry_id=$4) AND ${sc}`, p1)) {
      const kind = t.donor_id ? 'follow_up' : 'task'; if (!types.includes(kind)) continue;
      items.push({ id: t.id, type: kind, title: t.title, start: t.due_date, allDay: true, done: t.status === 'completed', href: t.donor_id ? `/donors/${t.donor_id}` : `/work/tasks?open=${t.id}` });
    }
    if (types.includes('meeting') && can(a, 'donors.read')) for (const c of await many(db, `SELECT c.id, c.subject, c.occurred_at, c.donor_id, c.duration_hours FROM communications c WHERE c.type IN ('meeting','video') AND c.occurred_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR c.user_id=$3) AND ($4::uuid IS NULL OR c.ministry_id=$4)`, P))
      items.push({ id: c.id, type: 'meeting', title: c.subject ?? 'Meeting', start: c.occurred_at, href: c.donor_id ? `/donors/${c.donor_id}` : '/work/communications' });
    if (types.includes('trip') && can(a, 'donors.read')) for (const s of await many(db, `SELECT s.id, s.meeting_at, ${DONOR_NAME_SQL()} AS name, t.city, t.id trip_id FROM trip_stops s JOIN trips t ON t.id=s.trip_id JOIN donors d ON d.id=s.donor_id WHERE s.included AND s.meeting_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR t.created_by=$3) AND ($4::uuid IS NULL OR t.ministry_id=$4)`, P))
      items.push({ id: s.id, type: 'trip', title: `Trip meeting: ${s.name} (${s.city})`, start: s.meeting_at, href: `/donors/giving/trips/${s.trip_id}` });
    if (types.includes('event') && can(a, 'events.read')) for (const e of await many(db, `SELECT id, name, starts_at, ends_at FROM events WHERE starts_at::date BETWEEN $1 AND $2 AND ($4::uuid IS NULL OR ministry_id=$4) AND ($3::uuid IS NULL OR TRUE)`, P))
      items.push({ id: e.id, type: 'event', title: e.name, start: e.starts_at, end: e.ends_at, href: `/donors/events/${e.id}` });
    if (types.includes('grant') && can(a, 'grants.read')) for (const g of await many(db, `SELECT id, title, deadline, report_due FROM grants WHERE (deadline BETWEEN $1 AND $2 OR report_due BETWEEN $1 AND $2) AND ($3::uuid IS NULL OR assignee_id=$3) AND ($4::uuid IS NULL OR ministry_id=$4)`, P)) {
      if (g.deadline >= from && g.deadline <= to) items.push({ id: `${g.id}-d`, type: 'grant', title: `Grant deadline: ${g.title}`, start: g.deadline, allDay: true, href: `/donors/grants/${g.id}` });
      if (g.report_due && g.report_due >= from && g.report_due <= to) items.push({ id: `${g.id}-r`, type: 'grant', title: `Grant report due: ${g.title}`, start: g.report_due, allDay: true, href: `/donors/grants/${g.id}` });
    }
    if (types.includes('job')) for (const j of await many(db, `SELECT id, title, due_date FROM jobs WHERE due_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR assignee_id=$3) AND ($4::uuid IS NULL OR ministry_id=$4)`, P))
      items.push({ id: j.id, type: 'job', title: `Job due: ${j.title}`, start: j.due_date, allDay: true, href: '/work/client-work' });
    return items.sort((x, y) => String(x.start).localeCompare(String(y.start)));
  });
  res.json(out);
}));

// ───────── Time log summary & task report ─────────
platformRouter.get('/work/time-summary', h(async (req, res) => {
  requirePerm(req.auth, 'work.read');
  const from = String(req.query.from ?? today()), to = String(req.query.to ?? today());
  res.json(await tx(req, (db) => one(db, `SELECT coalesce(sum(hours) FILTER (WHERE user_id=$3),0)::float your_hours, coalesce(sum(hours),0)::float staff_hours,
      (SELECT count(*) FROM communications c WHERE c.occurred_at::date BETWEEN $1 AND $2)::int activities,
      coalesce(sum(te.hours * coalesce(rt.hourly_rate,0)) FILTER (WHERE te.billable),0)::float billable_amount
    FROM time_entries te LEFT JOIN rate_types rt ON rt.id=te.rate_type_id WHERE te.entry_date BETWEEN $1 AND $2`, [from, to, req.auth!.userId])));
}));
platformRouter.get('/work/task-summary', h(async (req, res) => {
  requirePerm(req.auth, 'work.read');
  const p: unknown[] = []; const sc = ministryScope(req.auth!, 't.ministry_id', p);
  res.json(await tx(req, (db) => one(db, `SELECT count(*)::int tasks, coalesce(sum(t.actual_hours),0)::float hours,
      coalesce(sum(t.actual_hours * coalesce(rt.hourly_rate,0)) FILTER (WHERE t.billable),0)::float billable FROM tasks t LEFT JOIN rate_types rt ON rt.id=t.rate_type_id WHERE ${sc} AND t.status<>'completed'`, p)));
}));
platformRouter.get('/work/jobs-summary', h(async (req, res) => {
  requirePerm(req.auth, 'work.read');
  res.json(await tx(req, (db) => one(db, `SELECT count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int open_jobs,
      count(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date BETWEEN current_date AND current_date+7)::int due_week,
      count(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date < current_date)::int overdue,
      coalesce((SELECT sum(te.hours*coalesce(rt.hourly_rate,0)) FROM time_entries te LEFT JOIN rate_types rt ON rt.id=te.rate_type_id JOIN jobs j2 ON j2.id=te.job_id WHERE te.billable AND NOT j2.billed),0)::float unbilled FROM jobs`)));
}));

// ───────── Growth (analytics over the same donor data) ─────────
platformRouter.get('/growth', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const ministry = req.query.ministry_id ? String(req.query.ministry_id) : null; assertMinistry(req.auth!, ministry);
  res.json(await tx(req, async (db) => {
    const P = [ministry];
    const years = await many(db, `WITH y AS (SELECT donor_id, extract(year from gift_date)::int yr, sum(amount) amt FROM gifts WHERE NOT refunded AND ($1::uuid IS NULL OR ministry_id=$1) GROUP BY 1,2)
      SELECT yr, count(*)::int donors, sum(amt)::float total,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM y p WHERE p.donor_id=y.donor_id AND p.yr < y.yr))::int new_donors,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM y p WHERE p.donor_id=y.donor_id AND p.yr = y.yr-1))::int retained,
        (SELECT count(*) FROM y p WHERE p.yr = y.yr-1)::int prior_donors,
        count(*) FILTER (WHERE amt >= 5000)::int major_donors
      FROM y GROUP BY yr ORDER BY yr DESC LIMIT 6`, P);
    const withRates = years.map((y) => ({ ...y, retention_rate: y.prior_donors ? round2((y.retained / y.prior_donors) * 100) : null, avg_gift_per_donor: y.donors ? round2(y.total / y.donors) : 0 }));
    const recurringTrend = await many(db, `SELECT to_char(date_trunc('month', started_on),'YYYY-MM') AS month, count(*)::int started FROM recurring_gifts WHERE started_on > current_date - interval '12 months' GROUP BY 1 ORDER BY 1`);
    const acquisition = await many(db, `SELECT coalesce(source,'(unknown)') source, count(*)::int donors FROM donors WHERE created_at > now() - interval '12 months' AND ($1::uuid IS NULL OR ministry_id=$1) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, P);
    const pipeline = await many(db, `SELECT intelligence->>'categoryLabel' category, count(*)::int donors, sum((intelligence->>'opportunityValue')::numeric)::float potential FROM donors WHERE NOT archived AND intelligence ? 'category' AND ($1::uuid IS NULL OR ministry_id=$1) GROUP BY 1 ORDER BY 3 DESC NULLS LAST`, P);
    const healthMove = await many(db, `SELECT health_status, count(*)::int n FROM donors WHERE NOT archived AND ($1::uuid IS NULL OR ministry_id=$1) GROUP BY 1`, P);
    const goals = await many(db, `SELECT * FROM growth_goals WHERE ($1::uuid IS NULL OR ministry_id=$1 OR ministry_id IS NULL) ORDER BY period_end`, P);
    const goalProgress = [];
    for (const g of goals) {
      const q: Record<string, string> = {
        giving_total: `SELECT coalesce(sum(amount),0)::float v FROM gifts WHERE NOT refunded AND gift_date BETWEEN $1 AND $2`,
        new_donors: `SELECT count(*)::float v FROM (SELECT donor_id, min(gift_date) f FROM gifts WHERE NOT refunded GROUP BY 1) x WHERE f BETWEEN $1 AND $2`,
        recurring_donors: `SELECT count(DISTINCT donor_id)::float v FROM recurring_gifts WHERE status='active' AND $1::date IS NOT NULL AND $2::date IS NOT NULL`,
        major_donors: `SELECT count(*)::float v FROM (SELECT donor_id, sum(amount) s FROM gifts WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 GROUP BY 1) x WHERE s >= 5000`,
        retention_rate: `SELECT CASE WHEN count(*)=0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM gifts g2 WHERE g2.donor_id=p.donor_id AND g2.gift_date BETWEEN $1 AND $2)) / count(*),1) END::float v
          FROM (SELECT DISTINCT donor_id FROM gifts WHERE gift_date BETWEEN ($1::date - interval '1 year') AND ($1::date - interval '1 day')) p`,
      };
      const v = await one(db, q[g.metric], [g.period_start, g.period_end]);
      goalProgress.push({ ...g, actual: v?.v ?? 0, pct: Number(g.target) ? Math.round(((v?.v ?? 0) / Number(g.target)) * 100) : null });
    }
    const recs: string[] = [];
    const cur = withRates[0]; const prev = withRates[1];
    if (cur?.retention_rate != null && cur.retention_rate < 45) recs.push(`Donor retention is ${cur.retention_rate}% — prioritize thank-you speed and first-time donor follow-up.`);
    if (cur && prev && cur.new_donors < prev.new_donors) recs.push(`New donor acquisition is behind last year (${cur.new_donors} vs ${prev.new_donors}). Consider events and peer invitations.`);
    const lapsing = healthMove.find((x) => x.health_status === 'lapsing')?.n ?? 0;
    if (lapsing) recs.push(`${lapsing} donors are lapsing; work the Recovery list before they lapse fully.`);
    if (!recurringTrend.length) recs.push('No new recurring donors in 12 months — add a monthly-giving ask to thank-you messages.');
    return { years: withRates, recurringTrend, acquisition, pipeline, health: healthMove, goals: goalProgress, recommendations: recs, recommendationsNote: 'Recommendations are rule-based suggestions from your data.' };
  }));
}));

// ───────── Impact summary & report ─────────
platformRouter.get('/impact/summary', h(async (req, res) => {
  requirePerm(req.auth, 'impact.read');
  res.json(await tx(req, async (db) => {
    const projects = await many(db, `SELECT p.id, p.name, p.goal::float, p.budget::float, f.name fund_name,
      (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.project_id=p.id AND NOT g.refunded)::float raised,
      (SELECT coalesce(sum(jl.debit-jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id AND a.type='expense' WHERE jl.project_id=p.id)::float spent,
      (SELECT json_agg(json_build_object('name',m.name,'unit',m.unit,'target',m.target,'actual',(SELECT coalesce(sum(value),0) FROM impact_entries e WHERE e.metric_id=m.id))) FROM impact_metrics m WHERE m.project_id=p.id) metrics,
      (SELECT coalesce(sum(beneficiaries),0) FROM impact_stories s WHERE s.project_id=p.id)::int beneficiaries
      FROM projects p LEFT JOIN funds f ON f.id=p.fund_id WHERE p.status<>'archived' ORDER BY p.name`);
    return { projects, costPerOutcome: projects.map((p) => ({ project: p.name, spent: p.spent, outcomes: (p.metrics ?? []).map((m: any) => ({ name: m.name, actual: Number(m.actual), costPer: Number(m.actual) ? round2(p.spent / Number(m.actual)) : null })) })) };
  }));
}));

// ───────── Attachments ─────────
platformRouter.post('/attachments', upload.single('file'), h(async (req, res) => {
  const b = parse(z.object({ entity_type: z.enum(['donor', 'communication', 'task', 'grant', 'project', 'job', 'impact_story', 'event', 'invoice']), entity_id: z.string().uuid() }), req.body);
  const permFor: Record<string, any> = { donor: 'donors.write', communication: 'work.write', task: 'work.write', grant: 'grants.write', project: 'projects.write', job: 'work.write', impact_story: 'impact.write', event: 'events.write', invoice: 'finance.write' };
  requirePerm(req.auth, permFor[b.entity_type]);
  if (!req.file) throw badRequest('Choose a file.');
  res.status(201).json(await tx(req, async (db) => { const a = await saveAttachment(db, req, req.file!, b.entity_type, b.entity_id); await audit(db, actor(req), 'files', 'upload', `Uploaded ${a.filename}`, { type: b.entity_type, id: b.entity_id }); return a; }));
}));
platformRouter.get('/attachments', h(async (req, res) => {
  res.json(await tx(req, (db) => many(db, `SELECT id, filename, mime, size, created_at FROM attachments WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC`, [req.query.entity_type, req.query.entity_id])));
}));
platformRouter.get('/attachments/:id', h(async (req, res) => {
  const a = await tx(req, (db) => one(db, `SELECT * FROM attachments WHERE id=$1`, [req.params.id]));
  if (!a) throw notFound('File');
  const permFor: Record<string, any> = { donor: 'donors.read', expense: 'finance.read', journal: 'finance.read', unfiled_receipt: 'finance.read', bank_transaction: 'finance.read', invoice: 'finance.read', grant: 'grants.read', project: 'projects.read', impact_story: 'impact.read', event: 'events.read' };
  requirePerm(req.auth, permFor[a.entity_type] ?? 'work.read');
  const data = await getFile(a.storage_key);
  if (!data) throw notFound('File');
  res.setHeader('Content-Type', a.mime ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `${/^image\/|pdf/.test(a.mime ?? '') ? 'inline' : 'attachment'}; filename="${a.filename.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}));
