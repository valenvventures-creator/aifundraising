/**
 * Overview screens for Donors, Money, Work and Messages. Each pulls from every related area of the app
 * for a period and workspace, compares with the previous period of the same length, and only includes
 * areas the user's role can see. Figures are marked "auto" (counted from records) by the client.
 */
import { Router } from 'express';
import { h } from '../lib/http.js';
import { tx, requirePerm, can, ministryScope } from '../lib/auth.js';
import { many, one } from '../db/pool.js';
import { round2, DONOR_NAME_SQL } from '../lib/util.js';
import { readPeriod, scopedQuery, monthsFor, seriesStart, LEDGER_MINISTRY } from '../lib/period.js';

export const overviewsRouter = Router();
const fill = (months: string[], rows: any[], keys: string[]) => months.map((m) => {
  const r = rows.find((x) => x.month === m) ?? {};
  return Object.fromEntries([['month', m], ...keys.map((k) => [k, Number(r[k] ?? 0)])]);
});

// ───────────────────────── Donors ─────────────────────────
overviewsRouter.get('/overview/donors', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const a = req.auth!; const P = readPeriod(req); const { q, q1 } = scopedQuery(a, P.ministry);
  const cur = [P.from, P.to], both = [P.from, P.to, P.prevFrom, P.prevTo];
  const out = await tx(req, async (db) => {
    const r: any = { period: P };
    // Who gave, and how that compares with the previous period
    r.kpis = await q1(db, (s) => `WITH g AS (SELECT * FROM gifts g WHERE NOT g.refunded AND ${s('g.ministry_id')}),
      firsts AS (SELECT donor_id, min(gift_date) first FROM gifts WHERE NOT refunded GROUP BY donor_id),
      c AS (SELECT donor_id, sum(amount) amt FROM g WHERE gift_date BETWEEN $1 AND $2 GROUP BY donor_id),
      pv AS (SELECT donor_id, sum(amount) amt FROM g WHERE gift_date BETWEEN $3 AND $4 GROUP BY donor_id)
      SELECT coalesce((SELECT sum(amt) FROM c),0)::float raised, coalesce((SELECT sum(amt) FROM pv),0)::float raised_prev,
        (SELECT count(*) FROM g WHERE gift_date BETWEEN $1 AND $2)::int gifts, (SELECT count(*) FROM g WHERE gift_date BETWEEN $3 AND $4)::int gifts_prev,
        (SELECT count(*) FROM c)::int donors, (SELECT count(*) FROM pv)::int donors_prev,
        (SELECT count(*) FROM c JOIN firsts f USING (donor_id) WHERE f.first BETWEEN $1 AND $2)::int new_donors,
        (SELECT count(*) FROM c JOIN firsts f USING (donor_id) WHERE f.first < $1 AND donor_id NOT IN (SELECT donor_id FROM pv))::int reactivated,
        (SELECT count(*) FROM pv WHERE donor_id IN (SELECT donor_id FROM c))::int retained,
        (SELECT count(*) FROM c JOIN pv USING (donor_id) WHERE c.amt > pv.amt * 1.05)::int upgraded,
        (SELECT count(*) FROM c JOIN pv USING (donor_id) WHERE c.amt < pv.amt * 0.95)::int downgraded,
        (SELECT count(*) FROM pv WHERE donor_id NOT IN (SELECT donor_id FROM c))::int lapsed,
        coalesce((SELECT max(amount) FROM g WHERE gift_date BETWEEN $1 AND $2),0)::float largest`, both);
    const k = r.kpis;
    k.average = k.gifts ? round2(k.raised / k.gifts) : 0;
    k.average_prev = k.gifts_prev ? round2(k.raised_prev / k.gifts_prev) : 0;
    k.retention = k.donors_prev ? round2((k.retained / k.donors_prev) * 100) : null;
    const rec = await q1(db, (s) => `SELECT count(DISTINCT r.donor_id)::int donors, coalesce(sum(CASE r.frequency WHEN 'monthly' THEN r.amount WHEN 'quarterly' THEN r.amount/3 WHEN 'annually' THEN r.amount/12 WHEN 'weekly' THEN r.amount*52/12 ELSE r.amount END),0)::float monthly
      FROM recurring_gifts r JOIN donors d ON d.id=r.donor_id WHERE r.status='active' AND NOT d.archived AND ${s('d.ministry_id')}`);
    r.recurring = rec;
    r.queues = await q1(db, (s) => `SELECT count(*) FILTER (WHERE thank_you_status='pending')::int thank_yous, count(*) FILTER (WHERE receipt_status='pending')::int receipts
      FROM gifts g WHERE NOT g.refunded AND ${s('g.ministry_id')}`);

    // Where giving came from
    r.byType = await q(db, (s) => `SELECT gift_type AS key, sum(amount)::float amount, count(*)::int n FROM gifts g WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY 1 ORDER BY 2 DESC`, cur);
    r.byChannel = await q(db, (s) => `SELECT CASE WHEN provider IN ('stripe','square','paypal') THEN provider WHEN email_campaign_id IS NOT NULL THEN 'email' WHEN payment_method IN ('card','online','ach') THEN 'online' ELSE payment_method END AS key,
        sum(amount)::float amount, count(*)::int n FROM gifts g WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY 1 ORDER BY 2 DESC`, cur);
    r.campaigns = await q(db, (s) => `SELECT c.id, c.name, c.goal::float, coalesce(sum(g.amount) FILTER (WHERE g.gift_date BETWEEN $1 AND $2),0)::float raised, coalesce(sum(g.amount),0)::float raised_all,
        count(DISTINCT g.donor_id) FILTER (WHERE g.gift_date BETWEEN $1 AND $2)::int donors
      FROM campaigns c LEFT JOIN gifts g ON g.campaign_id=c.id AND NOT g.refunded WHERE ${s('c.ministry_id')} GROUP BY c.id HAVING coalesce(sum(g.amount) FILTER (WHERE g.gift_date BETWEEN $1 AND $2),0) > 0 OR c.status='active'
      ORDER BY raised DESC LIMIT 6`, cur);
    if (can(a, 'email.read')) r.emailGiving = await q1(db, (s) => `SELECT coalesce(sum(g.amount),0)::float amount, count(*)::int n, count(DISTINCT g.email_campaign_id)::int campaigns FROM gifts g WHERE NOT refunded AND g.email_campaign_id IS NOT NULL AND gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')}`, cur);
    if (can(a, 'events.read')) r.eventDonors = await q1(db, (s) => `SELECT count(DISTINCT r.donor_id)::int attendees,
        count(DISTINCT g.donor_id)::int gave_after, coalesce(sum(g.amount),0)::float amount
      FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN gifts g ON g.donor_id=r.donor_id AND NOT g.refunded AND g.gift_date BETWEEN e.starts_at::date AND e.starts_at::date + 60
      WHERE r.donor_id IS NOT NULL AND r.status='attended' AND e.starts_at::date BETWEEN $1 AND $2 AND ${s('e.ministry_id')}`, cur);

    // What donors supported
    r.funds = await q(db, (s) => `SELECT f.id, f.name, f.restriction, sum(g.amount)::float amount, count(DISTINCT g.donor_id)::int donors FROM gifts g JOIN funds f ON f.id=g.fund_id
      WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY f.id ORDER BY amount DESC LIMIT 8`, cur);
    r.projects = await q(db, (s) => `SELECT p.id, p.name, p.goal::float, sum(g.amount)::float amount, count(DISTINCT g.donor_id)::int donors FROM gifts g JOIN projects p ON p.id=g.project_id
      WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY p.id ORDER BY amount DESC LIMIT 6`, cur);

    // Relationship work with donors
    r.engagement = await q1(db, (s) => `SELECT count(*) FILTER (WHERE c.occurred_at::date BETWEEN $1 AND $2)::int contacts, count(*) FILTER (WHERE c.occurred_at::date BETWEEN $3 AND $4)::int contacts_prev,
        count(DISTINCT c.donor_id) FILTER (WHERE c.occurred_at::date BETWEEN $1 AND $2)::int donors_contacted
      FROM communications c WHERE c.donor_id IS NOT NULL AND ${s('c.ministry_id')}`, both);
    r.contactTypes = await q(db, (s) => `SELECT type AS key, count(*)::int n FROM communications c WHERE c.donor_id IS NOT NULL AND c.occurred_at::date BETWEEN $1 AND $2 AND ${s('c.ministry_id')} GROUP BY 1 ORDER BY 2 DESC`, cur);
    r.asks = await q1(db, (s) => `SELECT count(*)::int asks, coalesce(sum(amount),0)::float asked, count(*) FILTER (WHERE status='accepted')::int accepted, coalesce(sum(amount) FILTER (WHERE status='accepted'),0)::float accepted_amount,
        count(*) FILTER (WHERE status='open')::int open FROM asks x JOIN donors d ON d.id=x.donor_id WHERE x.asked_on BETWEEN $1 AND $2 AND ${s('d.ministry_id')}`, cur);
    if (can(a, 'email.read')) r.email = await q1(db, (s) => `SELECT count(*) FILTER (WHERE m.status='delivered')::int delivered,
        (SELECT count(DISTINCT ev.message_id) FROM email_events ev WHERE ev.type='open' AND ev.occurred_at::date BETWEEN $1 AND $2)::int opened,
        (SELECT count(DISTINCT ev.message_id) FROM email_events ev WHERE ev.type='click' AND ev.occurred_at::date BETWEEN $1 AND $2)::int clicked
      FROM email_messages m LEFT JOIN email_campaigns ec ON ec.id=m.email_campaign_id WHERE m.donor_id IS NOT NULL AND m.sent_at::date BETWEEN $1 AND $2 AND ${s('ec.ministry_id')}`, cur);

    const months = monthsFor(P);
    r.trend = fill(months, await q(db, (s) => `SELECT to_char(gift_date,'YYYY-MM') AS month, sum(amount)::float raised, count(DISTINCT donor_id)::int donors FROM gifts g
      WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY 1`, [seriesStart(months), P.to]), ['raised', 'donors']);
    r.topDonors = await q(db, (s) => `SELECT d.id, ${DONOR_NAME_SQL()} AS name, sum(g.amount)::float amount, count(*)::int gifts FROM gifts g JOIN donors d ON d.id=g.donor_id
      WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY d.id ORDER BY amount DESC LIMIT 5`, cur);
    return r;
  });
  res.json(out);
}));

// ───────────────────────── Money ─────────────────────────
overviewsRouter.get('/overview/money', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const a = req.auth!; const P = readPeriod(req); const { q, q1 } = scopedQuery(a, P.ministry);
  const cur = [P.from, P.to], both = [P.from, P.to, P.prevFrom, P.prevTo];
  const LM = LEDGER_MINISTRY;
  const posted = `journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts ac ON ac.id=jl.account_id`;
  const out = await tx(req, async (db) => {
    const r: any = { period: P };
    r.totals = await q1(db, (s) => `SELECT
        coalesce(sum(jl.credit-jl.debit) FILTER (WHERE ac.type='revenue' AND je.entry_date BETWEEN $1 AND $2),0)::float income,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense' AND je.entry_date BETWEEN $1 AND $2),0)::float expenses,
        coalesce(sum(jl.credit-jl.debit) FILTER (WHERE ac.type='revenue' AND je.entry_date BETWEEN $3 AND $4),0)::float income_prev,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense' AND je.entry_date BETWEEN $3 AND $4),0)::float expenses_prev,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.is_cash),0)::float cash,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense' AND je.entry_date > $2::date - 90 AND je.entry_date <= $2),0)::float expenses_90
      FROM ${posted} WHERE ${s(LM)}`, both);
    const t = r.totals;
    t.change = round2(t.income - t.expenses);
    t.runwayMonths = t.expenses_90 > 0 ? round2(t.cash / (t.expenses_90 / 3)) : null;

    // Money in, by where it came from
    r.incomeBySource = await q(db, (s) => `SELECT CASE je.source WHEN 'gift' THEN 'Donations' WHEN 'invoice' THEN 'Invoices & services' WHEN 'bank' THEN 'Bank deposits' WHEN 'import' THEN 'Imported' ELSE 'Other income' END AS key,
        sum(jl.credit-jl.debit)::float amount FROM ${posted} WHERE ac.type='revenue' AND je.entry_date BETWEEN $1 AND $2 AND ${s(LM)} GROUP BY 1 HAVING sum(jl.credit-jl.debit) <> 0 ORDER BY 2 DESC`, cur);
    r.incomeByAccount = await q(db, (s) => `SELECT ac.name AS key, sum(jl.credit-jl.debit)::float amount FROM ${posted} WHERE ac.type='revenue' AND je.entry_date BETWEEN $1 AND $2 AND ${s(LM)} GROUP BY ac.name HAVING sum(jl.credit-jl.debit) <> 0 ORDER BY 2 DESC LIMIT 8`, cur);
    r.online = await many(db, `SELECT provider AS key, coalesce(sum(amount) FILTER (WHERE kind='payment'),0)::float amount, count(*) FILTER (WHERE kind='payment')::int n,
        count(*) FILTER (WHERE kind='dispute')::int disputes, count(*) FILTER (WHERE kind='failure')::int failures FROM payment_transactions WHERE occurred_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`, cur);

    // Money out
    r.expenseByAccount = await q(db, (s) => `SELECT ac.name AS key, sum(jl.debit-jl.credit)::float amount FROM ${posted} WHERE ac.type='expense' AND je.entry_date BETWEEN $1 AND $2 AND ${s(LM)} GROUP BY ac.name HAVING sum(jl.debit-jl.credit) <> 0 ORDER BY 2 DESC LIMIT 8`, cur);
    r.expenseByProgram = await q(db, (s) => `SELECT coalesce(p.name, 'Not tied to a program') AS key, p.id, sum(jl.debit-jl.credit)::float amount FROM ${posted} LEFT JOIN projects p ON p.id=jl.project_id
      WHERE ac.type='expense' AND je.entry_date BETWEEN $1 AND $2 AND ${s(LM)} GROUP BY p.id, p.name ORDER BY 3 DESC LIMIT 8`, cur);
    r.payroll = await q1(db, (s) => `SELECT coalesce(sum(gross + employer_taxes + benefits) FILTER (WHERE pay_date BETWEEN $1 AND $2),0)::float total, count(DISTINCT staff_name) FILTER (WHERE pay_date BETWEEN $1 AND $2)::int people,
        coalesce(sum(gross + employer_taxes + benefits) FILTER (WHERE pay_date BETWEEN $3 AND $4),0)::float total_prev FROM payroll_entries pe WHERE ${s('pe.ministry_id')}`, both);

    // Funds
    r.funds = await q(db, (s) => `SELECT f.id, f.name, f.restriction,
        coalesce(sum(CASE WHEN ac.type IN ('revenue','net_assets','expense') THEN jl.credit-jl.debit ELSE 0 END),0)::float balance,
        coalesce(sum(jl.credit-jl.debit) FILTER (WHERE ac.type='revenue' AND je.entry_date BETWEEN $1 AND $2),0)::float received,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense' AND je.entry_date BETWEEN $1 AND $2),0)::float spent
      FROM funds f LEFT JOIN journal_lines jl ON jl.fund_id=f.id LEFT JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' LEFT JOIN accounts ac ON ac.id=jl.account_id AND je.id IS NOT NULL
      WHERE NOT f.archived AND ${s('f.ministry_id')} GROUP BY f.id ORDER BY f.restriction, f.name`, cur);
    r.restricted = round2(r.funds.filter((f: any) => f.restriction !== 'unrestricted').reduce((x: number, f: any) => x + f.balance, 0));
    r.unrestricted = round2(r.funds.filter((f: any) => f.restriction === 'unrestricted').reduce((x: number, f: any) => x + f.balance, 0));

    // Budgets overlapping the period
    r.budgets = await q(db, (s) => `SELECT b.id, b.name, b.period_start, b.period_end, coalesce((SELECT sum(amount) FROM budget_lines bl WHERE bl.budget_id=b.id),0)::float budget,
        coalesce((SELECT sum(jl.debit-jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts ac ON ac.id=jl.account_id
          WHERE ac.type='expense' AND je.entry_date BETWEEN b.period_start AND least(b.period_end, current_date) AND jl.account_id IN (SELECT account_id FROM budget_lines bl WHERE bl.budget_id=b.id)
          AND (b.fund_id IS NULL OR jl.fund_id=b.fund_id)),0)::float actual,
        greatest(0, least(1, (least(current_date, b.period_end) - b.period_start + 1)::float / greatest(1, b.period_end - b.period_start + 1)))::float elapsed
      FROM budgets b WHERE b.period_start <= $2 AND b.period_end >= $1 AND ${s('b.ministry_id')} ORDER BY b.period_start DESC LIMIT 5`, cur);

    // Invoices (receivables)
    r.invoices = await q1(db, (s) => `WITH inv AS (SELECT i.*, coalesce((SELECT sum(quantity*rate) FROM invoice_lines l WHERE l.invoice_id=i.id),0) * (1 + i.tax_rate/100) total FROM invoices i WHERE i.status NOT IN ('void','draft') AND ${s('i.ministry_id')})
      SELECT coalesce(sum(total - amount_paid) FILTER (WHERE status IN ('sent','partial')),0)::float outstanding, count(*) FILTER (WHERE status IN ('sent','partial'))::int open,
        coalesce(sum(total - amount_paid) FILTER (WHERE status IN ('sent','partial') AND due_date < current_date),0)::float overdue, count(*) FILTER (WHERE status IN ('sent','partial') AND due_date < current_date)::int overdue_count,
        coalesce(sum(total) FILTER (WHERE invoice_date BETWEEN $1 AND $2),0)::float invoiced FROM inv`, cur);

    // Things that need someone
    const attention: { level: string; text: string; link: string }[] = [];
    for (const f of r.funds) if (f.restriction !== 'unrestricted' && f.balance < 0) attention.push({ level: 'error', text: `Restricted fund “${f.name}” is overdrawn by ${Math.abs(f.balance).toFixed(2)}.`, link: `/money/accounting/funds/${f.id}` });
    const chk = await one(db, `SELECT (SELECT count(*) FROM bank_transactions WHERE status='unreviewed')::int bank, (SELECT count(*) FROM journal_entries WHERE status='pending_approval')::int approvals,
      (SELECT count(*) FROM journal_entries WHERE status='draft')::int drafts, (SELECT count(*) FROM payment_transactions WHERE status='unmatched')::int unmatched,
      (SELECT count(*) FROM sync_records WHERE status IN ('error','conflict'))::int sync`);
    if (chk.approvals) attention.push({ level: 'warn', text: `${chk.approvals} journal ${chk.approvals === 1 ? 'entry awaits' : 'entries await'} approval.`, link: '/money/accounting/journals' });
    if (chk.bank) attention.push({ level: 'warn', text: `${chk.bank} bank ${chk.bank === 1 ? 'transaction needs' : 'transactions need'} review.`, link: '/money/accounting/bank' });
    if (chk.unmatched) attention.push({ level: 'warn', text: `${chk.unmatched} online ${chk.unmatched === 1 ? 'payment' : 'payments'} could not be matched to a donor.`, link: '/money/accounting/integrations' });
    if (chk.sync) attention.push({ level: 'error', text: `${chk.sync} QuickBooks sync ${chk.sync === 1 ? 'item needs' : 'items need'} attention.`, link: '/money/accounting/sync' });
    if (r.invoices.overdue_count) attention.push({ level: 'warn', text: `${r.invoices.overdue_count} ${r.invoices.overdue_count === 1 ? 'invoice is' : 'invoices are'} past due.`, link: '/money/invoices' });
    if (chk.drafts) attention.push({ level: 'info', text: `${chk.drafts} draft journal ${chk.drafts === 1 ? 'entry' : 'entries'} not yet posted.`, link: '/money/accounting/journals' });
    if (can(a, 'donors.read')) {
      const qd = await q1(db, (s) => `SELECT count(*) FILTER (WHERE receipt_status='pending')::int n FROM gifts g WHERE NOT refunded AND ${s('g.ministry_id')}`);
      if (qd.n) attention.push({ level: 'info', text: `${qd.n} ${qd.n === 1 ? 'gift needs' : 'gifts need'} a receipt.`, link: '/donors/giving/receipts' });
    }
    r.attention = attention;

    const months = monthsFor(P);
    r.trend = fill(months, await q(db, (s) => `SELECT to_char(je.entry_date,'YYYY-MM') AS month, coalesce(sum(jl.credit-jl.debit) FILTER (WHERE ac.type='revenue'),0)::float income,
        coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense'),0)::float expenses FROM ${posted} WHERE je.entry_date BETWEEN $1 AND $2 AND ${s(LM)} GROUP BY 1`, [seriesStart(months), P.to]), ['income', 'expenses']);
    r.recent = await q(db, (s) => `SELECT je.id, je.entry_date, je.memo, je.source, je.status, (SELECT sum(debit) FROM journal_lines WHERE entry_id=je.id)::float amount FROM journal_entries je
      WHERE ${s('je.ministry_id')} ORDER BY je.entry_date DESC, je.created_at DESC LIMIT 8`);
    return r;
  });
  res.json(out);
}));

// ───────────────────────── Work ─────────────────────────
overviewsRouter.get('/overview/work', h(async (req, res) => {
  requirePerm(req.auth, 'work.read');
  const a = req.auth!; const P = readPeriod(req); const { q, q1 } = scopedQuery(a, P.ministry);
  const cur = [P.from, P.to], both = [P.from, P.to, P.prevFrom, P.prevTo];
  const out = await tx(req, async (db) => {
    const r: any = { period: P };
    r.tasks = await q1(db, (s) => `SELECT count(*) FILTER (WHERE status<>'completed')::int open, count(*) FILTER (WHERE status<>'completed' AND due_date < current_date)::int overdue,
        count(*) FILTER (WHERE status<>'completed' AND due_date BETWEEN current_date AND current_date + 7)::int due_week,
        count(*) FILTER (WHERE completed_at::date BETWEEN $1 AND $2)::int done, count(*) FILTER (WHERE completed_at::date BETWEEN $3 AND $4)::int done_prev,
        count(*) FILTER (WHERE status<>'completed' AND assignee_id=$5)::int mine FROM tasks t WHERE ${s('t.ministry_id')}`, [...both, a.userId]);
    r.time = await q1(db, (s) => `SELECT coalesce(sum(hours) FILTER (WHERE entry_date BETWEEN $1 AND $2),0)::float hours, coalesce(sum(hours) FILTER (WHERE entry_date BETWEEN $3 AND $4),0)::float hours_prev,
        coalesce(sum(hours) FILTER (WHERE entry_date BETWEEN $1 AND $2 AND billable),0)::float billable_hours,
        coalesce(sum(te.hours*coalesce(rt.hourly_rate,0)) FILTER (WHERE entry_date BETWEEN $1 AND $2 AND billable),0)::float billable_amount,
        count(DISTINCT user_id) FILTER (WHERE entry_date BETWEEN $1 AND $2)::int people FROM time_entries te LEFT JOIN rate_types rt ON rt.id=te.rate_type_id WHERE ${s('te.ministry_id')}`, both);
    r.timeByArea = await q(db, (s) => `SELECT CASE WHEN project_id IS NOT NULL THEN 'Programs & projects' WHEN grant_id IS NOT NULL THEN 'Grants' WHEN job_id IS NOT NULL THEN 'Client work'
          WHEN communication_id IS NOT NULL THEN 'Donor relationships' WHEN task_id IS NOT NULL THEN 'Tasks' ELSE coalesce(nullif(category,''), 'General') END AS key, sum(hours)::float hours
      FROM time_entries te WHERE entry_date BETWEEN $1 AND $2 AND ${s('te.ministry_id')} GROUP BY 1 ORDER BY 2 DESC`, cur);
    r.timeByWorkspace = await q(db, (s) => `SELECT coalesce(m.name, 'Organization-wide') AS key, m.color, sum(te.hours)::float hours FROM time_entries te LEFT JOIN ministries m ON m.id=te.ministry_id
      WHERE te.entry_date BETWEEN $1 AND $2 AND ${s('te.ministry_id')} GROUP BY m.name, m.color ORDER BY 3 DESC`, cur);
    r.contacts = await q1(db, (s) => `SELECT count(*) FILTER (WHERE occurred_at::date BETWEEN $1 AND $2)::int n, count(*) FILTER (WHERE occurred_at::date BETWEEN $3 AND $4)::int prev FROM communications c WHERE ${s('c.ministry_id')}`, both);
    r.contactTypes = await q(db, (s) => `SELECT type AS key, count(*)::int n FROM communications c WHERE occurred_at::date BETWEEN $1 AND $2 AND ${s('c.ministry_id')} GROUP BY 1 ORDER BY 2 DESC`, cur);
    r.team = await q(db, (s) => `SELECT u.id, u.name,
        (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status<>'completed' AND ${s('t.ministry_id')})::int open,
        (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status<>'completed' AND t.due_date < current_date AND ${s('t.ministry_id')})::int overdue,
        (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.completed_at::date BETWEEN $1 AND $2 AND ${s('t.ministry_id')})::int done,
        coalesce((SELECT sum(hours) FROM time_entries te WHERE te.user_id=u.id AND te.entry_date BETWEEN $1 AND $2 AND ${s('te.ministry_id')}),0)::float hours
      FROM users u JOIN memberships ms ON ms.user_id=u.id AND ms.tenant_id=$3 ORDER BY u.name`, [P.from, P.to, a.tenantId]);
    r.team = r.team.filter((u: any) => u.open || u.done || u.hours);
    if (a.permissions.has('work.read')) r.jobs = await q1(db, (s) => `SELECT count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int open, count(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date < current_date)::int overdue FROM jobs j WHERE ${s('j.ministry_id')}`);

    // Agenda: next 21 days across the app
    const agenda: any[] = [];
    const day = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const push = (rows: any[], kind: string, link: (x: any) => string) => rows.forEach((x) => agenda.push({ kind, date: day(x.d), title: x.title, sub: x.sub ?? null, link: link(x), overdue: day(x.d) < new Date().toISOString().slice(0, 10) }));
    push(await q(db, (s) => `SELECT t.id, t.due_date d, t.title, u.name sub FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.status<>'completed' AND t.due_date BETWEEN current_date - 14 AND current_date + 21 AND ${s('t.ministry_id')} ORDER BY t.due_date LIMIT 25`), 'Task', (x) => `/work/tasks?open=${x.id}`);
    if (can(a, 'grants.read')) {
      push(await q(db, (s) => `SELECT g.id, g.deadline d, g.title, 'Application deadline' sub FROM grants g WHERE g.status IN ('researching','qualified','preparing') AND g.deadline BETWEEN current_date AND current_date + 21 AND ${s('g.ministry_id')}`), 'Grant', (x) => `/donors/grants/${x.id}`);
      push(await q(db, (s) => `SELECT g.id, g.report_due d, g.title, 'Report due' sub FROM grants g WHERE g.status IN ('awarded','reporting') AND g.report_due BETWEEN current_date - 14 AND current_date + 21 AND ${s('g.ministry_id')}`), 'Grant', (x) => `/donors/grants/${x.id}`);
    }
    if (can(a, 'events.read')) push(await q(db, (s) => `SELECT e.id, e.starts_at d, e.name title, coalesce(e.location,'') sub FROM events e WHERE e.status<>'cancelled' AND e.starts_at::date BETWEEN current_date AND current_date + 21 AND ${s('e.ministry_id')}`), 'Event', (x) => `/donors/events/${x.id}`);
    if (can(a, 'finance.read')) push(await q(db, (s) => `SELECT i.id, i.due_date d, 'Invoice ' || i.number || ' · ' || i.customer_name title, 'Payment due' sub FROM invoices i WHERE i.status IN ('sent','partial') AND i.due_date BETWEEN current_date - 14 AND current_date + 21 AND ${s('i.ministry_id')}`), 'Invoice', (x) => `/money/invoices/${x.id}`);
    push(await q(db, (s) => `SELECT j.id, j.due_date d, j.title, j.client_name sub FROM jobs j WHERE j.status NOT IN ('completed','cancelled') AND j.due_date BETWEEN current_date - 14 AND current_date + 21 AND ${s('j.ministry_id')}`), 'Client work', () => '/work/client-work');
    agenda.sort((x, y) => x.date.localeCompare(y.date));
    r.agenda = agenda.slice(0, 30);

    const months = monthsFor(P); const start = seriesStart(months);
    const hrs = await q(db, (s) => `SELECT to_char(entry_date,'YYYY-MM') AS month, sum(hours)::float hours FROM time_entries te WHERE entry_date BETWEEN $1 AND $2 AND ${s('te.ministry_id')} GROUP BY 1`, [start, P.to]);
    const done = await q(db, (s) => `SELECT to_char(completed_at,'YYYY-MM') AS month, count(*)::int done FROM tasks t WHERE completed_at::date BETWEEN $1 AND $2 AND ${s('t.ministry_id')} GROUP BY 1`, [start, P.to]);
    r.trend = months.map((m) => ({ month: m, hours: Number(hrs.find((x: any) => x.month === m)?.hours ?? 0), done: Number(done.find((x: any) => x.month === m)?.done ?? 0) }));
    return r;
  });
  res.json(out);
}));

// ───────────────────────── Messages ─────────────────────────
overviewsRouter.get('/overview/messages', h(async (req, res) => {
  requirePerm(req.auth, 'messages.use');
  const a = req.auth!;
  const out = await tx(req, async (db) => {
    const p: unknown[] = [a.userId]; const sc = ministryScope(a, 'c.ministry_id', p);
    const me = await one(db, `SELECT name FROM users WHERE id=$1`, [a.userId]);
    const first = String(me?.name ?? '').split(' ')[0];
    const stats = await one(db, `SELECT count(*) FILTER (WHERE x.created_at > cm.last_read_at AND x.user_id<>$1)::int unread,
        count(DISTINCT c.id) FILTER (WHERE x.created_at > cm.last_read_at AND x.user_id<>$1)::int unread_threads,
        count(DISTINCT c.id) FILTER (WHERE c.status='open')::int open_threads,
        count(*) FILTER (WHERE x.created_at > now() - interval '7 days')::int week_messages
      FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 LEFT JOIN messages x ON x.conversation_id=c.id WHERE ${sc}`, p);
    p.push(first ? `%@${first}%` : '%@\u0000%');
    const mentions = await many(db, `SELECT x.id, x.body, x.created_at, c.id conversation_id, coalesce(c.name, 'Direct message') conversation, u.name author FROM messages x
      JOIN conversations c ON c.id=x.conversation_id JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 JOIN users u ON u.id=x.user_id
      WHERE x.user_id<>$1 AND x.body ILIKE $${p.length} AND x.created_at > now() - interval '30 days' AND ${sc} ORDER BY x.created_at DESC LIMIT 5`, p);
    const p2: unknown[] = [a.userId]; const sc2 = ministryScope(a, 'c.ministry_id', p2);
    const byWorkspace = await many(db, `SELECT coalesce(m.name, 'Organization-wide') AS key, m.color, count(DISTINCT c.id)::int threads,
        count(x.id) FILTER (WHERE x.created_at > cm.last_read_at AND x.user_id<>$1)::int unread
      FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 LEFT JOIN ministries m ON m.id=c.ministry_id LEFT JOIN messages x ON x.conversation_id=c.id
      WHERE c.status='open' AND ${sc2} GROUP BY m.name, m.color ORDER BY threads DESC`, p2);

    // What needs this person across the app
    const needs: any[] = [];
    if (can(a, 'work.read')) {
      const t = await many(db, `SELECT id, title, due_date FROM tasks WHERE assignee_id=$1 AND status<>'completed' AND (due_date IS NULL OR due_date <= current_date + 7) ORDER BY due_date NULLS LAST LIMIT 6`, [a.userId]);
      t.forEach((x) => needs.push({ kind: 'Task', title: x.title, date: x.due_date ? (x.due_date instanceof Date ? x.due_date.toISOString().slice(0, 10) : String(x.due_date).slice(0, 10)) : null, link: `/work/tasks?open=${x.id}` }));
    }
    if (can(a, 'finance.approve')) {
      const n = await one(db, `SELECT count(*)::int n FROM journal_entries WHERE status='pending_approval' AND coalesce(created_by,'00000000-0000-0000-0000-000000000000')<>$1`, [a.userId]);
      if (n.n) needs.push({ kind: 'Approval', title: `${n.n} journal ${n.n === 1 ? 'entry' : 'entries'} waiting for your approval`, date: null, link: '/money/accounting/journals' });
    }
    if (can(a, 'donors.read')) {
      const d = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.intelligence->>'nextStep' step, d.intelligence->>'followUpOn' due FROM donors d
        WHERE d.owner_user_id=$1 AND NOT d.archived AND d.intelligence->>'priority'='High' ORDER BY d.intelligence->>'followUpOn' NULLS LAST LIMIT 4`, [a.userId]);
      d.forEach((x) => needs.push({ kind: 'Donor', title: `${x.name}: ${x.step ?? 'follow up'}`, date: x.due ? String(x.due).slice(0, 10) : null, link: `/donors/${x.id}` }));
    }
    if (can(a, 'grants.read')) {
      const g = await many(db, `SELECT id, title, coalesce(CASE WHEN status IN ('awarded','reporting') THEN report_due END, deadline) d, CASE WHEN status IN ('awarded','reporting') THEN 'report' ELSE 'deadline' END what
        FROM grants WHERE assignee_id=$1 AND status NOT IN ('declined','closed','submitted','under_review') AND coalesce(CASE WHEN status IN ('awarded','reporting') THEN report_due END, deadline) <= current_date + 21 ORDER BY 3 LIMIT 4`, [a.userId]);
      g.forEach((x) => needs.push({ kind: 'Grant', title: `${x.title} (${x.what})`, date: x.d ? String(x.d).slice(0, 10) : null, link: `/donors/grants/${x.id}` }));
    }
    const notes = await many(db, `SELECT id, type, title, body, link, created_at FROM notifications WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 6`, [a.userId]);
    return { stats, mentions, byWorkspace, needs, notifications: notes };
  });
  res.json(out);
}));

// ───────────────────────── Admin & Access ─────────────────────────
overviewsRouter.get('/overview/admin', h(async (req, res) => {
  const a = req.auth!;
  if (!can(a, 'admin.users') && !can(a, 'audit.read')) requirePerm(a, 'admin.users');
  const out = await tx(req, async (db) => {
    const r: any = {};
    if (can(a, 'admin.users')) {
      r.people = await one(db, `SELECT count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='invited')::int invited, count(*) FILTER (WHERE status='inactive')::int inactive,
          count(*) FILTER (WHERE status='active' AND seat)::int seats, count(*) FILTER (WHERE status='active' AND all_ministries)::int all_access,
          count(*) FILTER (WHERE status='active' AND NOT all_ministries AND cardinality(ministry_ids)=0)::int no_access FROM memberships WHERE tenant_id=$1`, [a.tenantId]);
      r.roles = await many(db, `SELECT r.id, r.name, count(m.id) FILTER (WHERE m.status='active')::int people, cardinality(r.permissions)::int permissions FROM roles r LEFT JOIN memberships m ON m.role_id=r.id AND m.tenant_id=$1
        WHERE r.tenant_id=$1 OR r.tenant_id IS NULL GROUP BY r.id ORDER BY people DESC, r.name`, [a.tenantId]).catch(() => []);
      r.admins = (await one(db, `SELECT count(*)::int n FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=$1 AND m.status='active' AND 'admin.users' = ANY(r.permissions)`, [a.tenantId]).catch(() => ({ n: null }))).n;
      r.workspaces = await many(db, `SELECT w.id, w.name, w.color, (SELECT count(*) FROM memberships m WHERE m.tenant_id=$1 AND m.status='active' AND (m.all_ministries OR w.id = ANY(m.ministry_ids)))::int people
        FROM ministries w WHERE NOT w.archived ORDER BY w.name`, [a.tenantId]);
      r.users = await many(db, `SELECT u.id, u.name, u.email, r.name role, m.status, m.all_ministries, cardinality(m.ministry_ids)::int workspaces,
          (SELECT max(created_at) FROM audit_events e WHERE e.user_id=u.id AND e.action='login') last_login,
          (SELECT count(*) FROM audit_events e WHERE e.user_id=u.id AND e.created_at > now() - interval '30 days')::int actions_30
        FROM memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=$1 AND m.status='active' ORDER BY last_login DESC NULLS LAST`, [a.tenantId]);
      r.pendingInvites = await many(db, `SELECT m.id, m.invited_email, r.name role, m.created_at FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=$1 AND m.status='invited' ORDER BY m.created_at DESC LIMIT 6`, [a.tenantId]);
      const checks: { ok: boolean; text: string; link?: string }[] = [];
      const stale = r.users.filter((u: any) => !u.last_login || Date.now() - new Date(u.last_login).getTime() > 60 * 86400000);
      checks.push({ ok: (r.admins ?? 2) >= 2, text: (r.admins ?? 0) >= 2 ? `${r.admins} people can manage users, so access is never locked to one person.` : 'Only one person can manage users. Consider a second administrator as a backup.' });
      checks.push({ ok: !stale.length, text: stale.length ? `${stale.length} ${stale.length === 1 ? 'person has' : 'people have'} not signed in for 60+ days. Review whether they still need access.` : 'Everyone with access has signed in within 60 days.' });
      checks.push({ ok: !r.people.no_access, text: r.people.no_access ? `${r.people.no_access} ${r.people.no_access === 1 ? 'person has' : 'people have'} no workspace access, so they will see very little.` : 'Everyone has access to at least one workspace.' });
      checks.push({ ok: !r.pendingInvites.some((i: any) => Date.now() - new Date(i.created_at).getTime() > 14 * 86400000), text: r.pendingInvites.length ? `${r.pendingInvites.length} ${r.pendingInvites.length === 1 ? 'invitation is' : 'invitations are'} waiting to be accepted.` : 'No invitations are waiting.' });
      r.checks = checks;
    }
    if (can(a, 'audit.read')) {
      r.activity = await many(db, `SELECT category AS key, count(*)::int n FROM audit_events WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`);
      r.recent = await many(db, `SELECT e.id, e.category, e.action, e.description, e.created_at, u.name user_name FROM audit_events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT 8`);
      r.sensitive = await one(db, `SELECT count(*) FILTER (WHERE action='export' OR category='export')::int exports, count(*) FILTER (WHERE category='ai')::int ai_drafts,
          count(*) FILTER (WHERE category IN ('access','admin','users') OR action IN ('invite','role_change','access_change'))::int access_changes, count(*) FILTER (WHERE action='login')::int logins
        FROM audit_events WHERE created_at > now() - interval '30 days'`);
    }
    return r;
  });
  res.json(out);
}));

// ───────────────────────── Settings ─────────────────────────
overviewsRouter.get('/overview/settings', h(async (req, res) => {
  const a = req.auth!;
  const { config } = await import('../config.js');
  const out = await tx(req, async (db) => {
    const t = await one(db, `SELECT name, legal_name, email, phone, address1, city, region, postal_code, tax_id, receipt_settings, opportunity_rules, workspace_term_plural, onboarding FROM tenants WHERE id=$1`, [a.tenantId]);
    const c = await one(db, `SELECT (SELECT count(*) FROM ministries WHERE NOT archived)::int workspaces, (SELECT count(*) FROM funds WHERE NOT archived)::int funds, (SELECT count(*) FROM accounts WHERE NOT archived)::int accounts,
      (SELECT count(*) FROM donors WHERE NOT archived)::int donors, (SELECT count(*) FROM gifts)::int gifts, (SELECT count(*) FROM memberships WHERE tenant_id=$1 AND status='active')::int people,
      (SELECT count(*) FROM voice_profiles)::int voices, (SELECT max(created_at) FROM audit_events WHERE description ILIKE '%backup%')::text last_backup,
      (SELECT max(created_at) FROM audit_events WHERE category='import' OR action='import')::text last_import`, [a.tenantId]);
    const ints = await many(db, `SELECT provider, status, last_sync_at, last_error FROM integrations WHERE user_id IS NULL OR user_id=$1`, [a.userId]);
    const conn = (p: string) => ints.find((i) => i.provider === p && i.status === 'connected');
    const profile = ['legal_name', 'email', 'phone', 'address1', 'city', 'tax_id'].filter((k) => t[k]).length;
    const rs = t.receipt_settings ?? {};
    const items = [
      { area: 'Organization', key: 'profile', ok: profile >= 5, text: profile >= 5 ? 'Organization profile is complete.' : `Organization profile is ${Math.round((profile / 6) * 100)}% complete (legal name, contact details, address and tax number).`, tab: 'organization' },
      { area: 'Organization', key: 'workspaces', ok: c.workspaces > 0, text: `${c.workspaces} ${t.workspace_term_plural?.toLowerCase() ?? 'workspaces'} set up.`, tab: 'organization' },
      { area: 'Receipts & tax', key: 'receipts', ok: Boolean(t.tax_id && (rs.signature_name || rs.signer || rs.footer || Object.keys(rs).length)), text: t.tax_id ? 'Tax number is on file for receipts.' : 'Add your tax number (EIN or CRA charity number) so receipts are valid.', tab: 'receipts' },
      { area: 'Fundraising', key: 'rules', ok: true, text: Object.keys(t.opportunity_rules ?? {}).length ? 'Custom fundraising rules are in use.' : 'Using the standard donor health and opportunity rules. You can adjust them anytime.', tab: 'fundraising' },
      { area: 'Email', key: 'email', ok: Boolean(config.resend || config.smtp || conn('google')), text: config.resend ? 'Email delivery is on (Resend).' : config.smtp ? 'Email delivery is on (SMTP).' : conn('google') ? 'Your Gmail is connected for sending.' : 'Email delivery is not set up, so invitations, receipts and password resets cannot be emailed.', tab: 'google' },
      { area: 'A.I.', key: 'ai', ok: config.aiEnabled, text: config.aiEnabled ? 'A.I. answers and drafts are on.' : 'A.I. is off: Ask and drafts use built-in reports and templates. Add ANTHROPIC_API_KEY in Netlify to turn it on.', tab: null },
      { area: 'Money', key: 'funds', ok: c.funds > 0 && c.accounts > 0, text: `${c.funds} funds and ${c.accounts} accounts in your chart of accounts.`, link: '/money/accounting/funds' },
      { area: 'Connections', key: 'quickbooks', ok: Boolean(conn('quickbooks')), optional: true, text: conn('quickbooks') ? `QuickBooks connected${conn('quickbooks').last_sync_at ? `, last sync ${String(conn('quickbooks').last_sync_at).slice(0, 10)}` : ''}.` : 'QuickBooks is not connected (optional).', link: '/money/accounting/integrations' },
      { area: 'Connections', key: 'payments', ok: Boolean(conn('stripe') || conn('square') || conn('paypal')), optional: true, text: ['stripe', 'square', 'paypal'].filter(conn).length ? `Online giving connected: ${['stripe', 'square', 'paypal'].filter(conn).map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')}.` : 'No online giving platform connected (optional).', link: '/money/accounting/integrations' },
      { area: 'Connections', key: 'google', ok: Boolean(conn('google')), optional: true, text: conn('google') ? 'Your Google account is connected (Gmail & Calendar).' : 'Your Google account is not connected (optional).', tab: 'google' },
      { area: 'Team', key: 'team', ok: c.people > 1, text: `${c.people} ${c.people === 1 ? 'person has' : 'people have'} access.`, tab: 'team' },
      { area: 'Data', key: 'data', ok: c.donors > 0, text: `${c.donors.toLocaleString()} donors and ${c.gifts.toLocaleString()} gifts on file${c.last_import ? `; last import ${c.last_import.slice(0, 10)}` : ''}.`, tab: 'data' },
      { area: 'Data', key: 'backup', ok: Boolean(c.last_backup && Date.now() - Date.parse(c.last_backup) < 90 * 86400000), optional: true, text: c.last_backup ? `Last backup downloaded ${c.last_backup.slice(0, 10)}.` : 'No backup downloaded yet. Download one from Account & Data.', tab: 'data' },
      { area: 'Writing', key: 'voice', ok: c.voices > 0, optional: true, text: c.voices ? `${c.voices} voice ${c.voices === 1 ? 'profile' : 'profiles'} guide A.I. drafts.` : 'No voice profile yet, so drafts use a general tone.', link: '/donors/giving/outreach' },
      { area: 'Errors', key: 'integration_errors', ok: !ints.some((i) => i.status === 'error'), text: ints.some((i) => i.status === 'error') ? `A connection has an error: ${ints.filter((i) => i.status === 'error').map((i) => i.provider).join(', ')}.` : 'No connection errors.', link: '/money/accounting/integrations' },
    ];
    const required = items.filter((i) => !i.optional);
    return { items, score: Math.round((required.filter((i) => i.ok).length / required.length) * 100), counts: c };
  });
  res.json(out);
}));

// ───────────────────────── Ask A.I. Fundraising ─────────────────────────
overviewsRouter.get('/overview/ask', h(async (req, res) => {
  requirePerm(req.auth, 'ai.ask');
  const a = req.auth!;
  const out = await tx(req, async (db) => {
    const s: { q: string; why: string; area: string }[] = [];
    if (can(a, 'donors.read')) {
      const p: unknown[] = []; const sc = ministryScope(a, 'd.ministry_id', p);
      const d = await one(db, `SELECT count(*) FILTER (WHERE health_status IN ('lapsing','cooling'))::int at_risk, count(*) FILTER (WHERE health_status='lapsed')::int lapsed,
        count(*) FILTER (WHERE intelligence->>'priority'='High')::int high FROM donors d WHERE NOT archived AND merged_into IS NULL AND ${sc}`, p);
      const p2: unknown[] = []; const sc2 = ministryScope(a, 'g.ministry_id', p2);
      const g = await one(db, `SELECT count(*) FILTER (WHERE thank_you_status='pending')::int thanks, count(*) FILTER (WHERE receipt_status='pending')::int receipts FROM gifts g WHERE NOT refunded AND ${sc2}`, p2);
      if (d.high) s.push({ q: 'Who should I call today?', why: `${d.high} donors are marked high priority right now.`, area: 'Donors' });
      if (d.at_risk) s.push({ q: 'Which donors are at risk of lapsing?', why: `${d.at_risk} donors are cooling or lapsing.`, area: 'Donors' });
      if (g.thanks) s.push({ q: 'Which donors have not been thanked?', why: `${g.thanks} gifts are waiting for a thank-you.`, area: 'Giving' });
      if (g.receipts) s.push({ q: 'What receipts still need to be sent?', why: `${g.receipts} gifts need a receipt.`, area: 'Giving' });
      s.push({ q: 'Where could our next $100,000 come from?', why: 'Ranks upgrades, lapsed donors and first-time givers by opportunity.', area: 'Donors' });
      s.push({ q: 'Compare this month with last month.', why: 'Giving this month against last month.', area: 'Giving' });
    }
    if (can(a, 'finance.read')) {
      const f = await one(db, `SELECT count(*)::int n FROM funds WHERE restriction<>'unrestricted' AND NOT archived`);
      if (f.n) s.push({ q: 'Show our restricted-fund balances.', why: `${f.n} restricted funds to keep in balance.`, area: 'Money' });
      const b = await one(db, `SELECT count(*)::int n FROM budgets WHERE current_date BETWEEN period_start AND period_end`);
      if (b.n) s.push({ q: 'Which programs are over budget?', why: `${b.n} ${b.n === 1 ? 'budget covers' : 'budgets cover'} today.`, area: 'Money' });
    }
    if (can(a, 'grants.read')) {
      const g = await one(db, `SELECT count(*)::int n FROM grants WHERE (deadline BETWEEN current_date AND current_date + 45) OR (report_due BETWEEN current_date AND current_date + 45)`);
      if (g.n) s.push({ q: 'What grant deadlines are coming up?', why: `${g.n} grant deadlines or reports in the next 45 days.`, area: 'Grants' });
    }
    if (can(a, 'work.read')) {
      const t = await one(db, `SELECT count(*)::int n FROM tasks WHERE status<>'completed' AND due_date < current_date`);
      if (t.n) s.push({ q: 'Which tasks are overdue?', why: `${t.n} tasks are past due.`, area: 'Work' });
    }
    if (can(a, 'donors.read')) s.push({ q: 'Which campaigns generated gifts?', why: 'Campaign results from recorded gifts.', area: 'Giving' });
    const areas = [
      ['Donors & giving', can(a, 'donors.read')], ['Private donor notes', can(a, 'donors.private_notes')], ['Accounting & funds', can(a, 'finance.read')], ['Grants', can(a, 'grants.read')],
      ['Projects', can(a, 'projects.read')], ['Events', can(a, 'events.read')], ['Email', can(a, 'email.read')], ['Tasks & time', can(a, 'work.read')], ['Impact', can(a, 'impact.read')],
    ].map(([name, ok]) => ({ name, ok }));
    const usage = await one(db, `SELECT count(*) FILTER (WHERE category='ai' AND created_at > now() - interval '30 days' AND user_id=$1)::int mine FROM audit_events`, [a.userId]);
    return { suggestions: s.slice(0, 8), areas, usage };
  });
  res.json(out);
}));
