/**
 * Impact hub: one view of results across the whole organization for a date range and workspace.
 *
 * Every figure is labelled by where it comes from:
 *  - "auto"    counted from records elsewhere in the app (gifts, ledger, time log, tasks, events, grants, email)
 *  - "entered" recorded by the team on the Impact page (metric results and stories)
 * Each block is only included when the user has permission to see that area.
 */
import { Router } from 'express';
import { h } from '../lib/http.js';
import { tx, requirePerm, ministryScope, assertMinistry, can } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { many, one, type Db } from '../db/pool.js';
import { round2 } from '../lib/util.js';

export const impactRouter = Router();

const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayMs = 86400000;
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

impactRouter.get('/impact/hub', h(async (req, res) => {
  requirePerm(req.auth, 'impact.read');
  const a = req.auth!;
  const year = new Date().getUTCFullYear();
  const from = isDay(req.query.from) ? String(req.query.from) : `${year}-01-01`;
  const to = isDay(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  if (from > to) throw badRequest('The start date must be before the end date.');
  const span = Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
  if (span > 3700) throw badRequest('Choose a range of ten years or less.');
  const prevTo = shift(from, -1), prevFrom = shift(from, -span);
  const ministry = typeof req.query.ministry_id === 'string' && req.query.ministry_id ? req.query.ministry_id : null;
  if (ministry) assertMinistry(a, ministry);

  /** WHERE fragment limiting a ministry column to what the user may see and the chosen workspace. */
  const scope = (col: string, p: unknown[]) => { // col may be an expression

    const parts = [ministryScope(a, col, p)];
    if (ministry) { p.push(ministry); parts.push(`${col} = $${p.length}::uuid`); }
    return parts.join(' AND ');
  };
  const q = async (db: Db, sql: (s: (col: string) => string) => string, base: unknown[]) => {
    const p = [...base];
    const text = sql((col) => scope(col, p));
    return many(db, text, p);
  };
  const q1 = async (db: Db, sql: (s: (col: string) => string) => string, base: unknown[]) => (await q(db, sql, base))[0];

  const out = await tx(req, async (db) => {
    const r: any = { period: { from, to, prevFrom, prevTo, days: span }, ministry, sections: [] as string[] };
    const P = [from, to];

    // ── Results the team recorded (entered) ──
    r.results = await q(db, (s) => `SELECT m.id, m.name, m.unit, m.target::float, p.name project_name, mi.name ministry_name, f.name fund_name,
        coalesce((SELECT sum(e.value) FROM impact_entries e WHERE e.metric_id=m.id AND e.entry_date BETWEEN $1 AND $2),0)::float actual,
        coalesce((SELECT sum(e.value) FROM impact_entries e WHERE e.metric_id=m.id AND e.entry_date BETWEEN $3 AND $4),0)::float previous,
        (SELECT max(e.entry_date) FROM impact_entries e WHERE e.metric_id=m.id) last_entry
      FROM impact_metrics m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN ministries mi ON mi.id=m.ministry_id LEFT JOIN funds f ON f.id=m.fund_id
      WHERE ${s('m.ministry_id')} ORDER BY actual DESC, m.name`, [from, to, prevFrom, prevTo]);
    r.stories = await q(db, (s) => `SELECT st.id, st.title, left(st.story, 280) story, st.beneficiaries, st.story_date, st.shareable, p.name project_name, mi.name ministry_name
      FROM impact_stories st LEFT JOIN projects p ON p.id=st.project_id LEFT JOIN ministries mi ON mi.id=st.ministry_id
      WHERE st.story_date BETWEEN $1 AND $2 AND ${s('st.ministry_id')} ORDER BY st.story_date DESC LIMIT 6`, P);
    const served = await q1(db, (s) => `SELECT coalesce(sum(beneficiaries) FILTER (WHERE story_date BETWEEN $1 AND $2),0)::int now, coalesce(sum(beneficiaries) FILTER (WHERE story_date BETWEEN $3 AND $4),0)::int prev,
      count(*) FILTER (WHERE story_date BETWEEN $1 AND $2)::int stories FROM impact_stories st WHERE ${s('st.ministry_id')}`, [from, to, prevFrom, prevTo]);
    r.served = served;

    // ── Giving (auto) ──
    if (can(a, 'donors.read') || can(a, 'finance.read')) {
      r.sections.push('giving');
      r.giving = await q1(db, (s) => `WITH g AS (SELECT * FROM gifts g WHERE NOT g.refunded AND ${s('g.ministry_id')}),
        firsts AS (SELECT donor_id, min(gift_date) first FROM gifts WHERE NOT refunded GROUP BY donor_id),
        cur AS (SELECT DISTINCT donor_id FROM g WHERE gift_date BETWEEN $1 AND $2),
        prev AS (SELECT DISTINCT donor_id FROM g WHERE gift_date BETWEEN $3 AND $4)
        SELECT coalesce((SELECT sum(amount) FROM g WHERE gift_date BETWEEN $1 AND $2),0)::float raised,
          coalesce((SELECT sum(amount) FROM g WHERE gift_date BETWEEN $3 AND $4),0)::float raised_prev,
          (SELECT count(*) FROM g WHERE gift_date BETWEEN $1 AND $2)::int gifts,
          (SELECT count(*) FROM cur)::int donors, (SELECT count(*) FROM prev)::int donors_prev,
          (SELECT count(*) FROM cur JOIN firsts f USING (donor_id) WHERE f.first BETWEEN $1 AND $2)::int new_donors,
          (SELECT count(*) FROM prev WHERE donor_id IN (SELECT donor_id FROM cur))::int retained`, [from, to, prevFrom, prevTo]);
      r.giving.retention = r.giving.donors_prev ? round2((r.giving.retained / r.giving.donors_prev) * 100) : null;
    }

    // ── Money put to work, by fund (auto, from the posted ledger) ──
    if (can(a, 'finance.read')) {
      r.sections.push('funds');
      r.funds = await q(db, (s) => `SELECT f.id, f.name, f.restriction,
          coalesce(sum(jl.credit-jl.debit) FILTER (WHERE ac.type='revenue'),0)::float received,
          coalesce(sum(jl.debit-jl.credit) FILTER (WHERE ac.type='expense'),0)::float spent
        FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' AND je.entry_date BETWEEN $1 AND $2
        JOIN accounts ac ON ac.id=jl.account_id JOIN funds f ON f.id=jl.fund_id
        WHERE ${s('coalesce(je.ministry_id, (SELECT pp.ministry_id FROM projects pp WHERE pp.id=jl.project_id), (SELECT ff.ministry_id FROM funds ff WHERE ff.id=jl.fund_id))')} GROUP BY f.id, f.name, f.restriction HAVING sum(jl.debit+jl.credit) > 0 ORDER BY spent DESC, received DESC`, P);
      r.spent = r.funds.reduce((x: number, f: any) => x + f.spent, 0);
      r.spentRestricted = r.funds.filter((f: any) => f.restriction !== 'unrestricted').reduce((x: number, f: any) => x + f.spent, 0);
    }

    // ── People & time (auto) ──
    if (can(a, 'work.read')) {
      r.sections.push('work');
      r.work = await q1(db, (s) => `SELECT coalesce(sum(hours) FILTER (WHERE entry_date BETWEEN $1 AND $2),0)::float hours,
          coalesce(sum(hours) FILTER (WHERE entry_date BETWEEN $3 AND $4),0)::float hours_prev,
          count(DISTINCT user_id) FILTER (WHERE entry_date BETWEEN $1 AND $2)::int people
        FROM time_entries t WHERE ${s('t.ministry_id')}`, [from, to, prevFrom, prevTo]);
      r.work.tasks = (await q1(db, (s) => `SELECT count(*)::int n FROM tasks t WHERE t.completed_at::date BETWEEN $1 AND $2 AND ${s('t.ministry_id')}`, P)).n;
    }

    // ── Events (auto) ──
    if (can(a, 'events.read')) {
      r.sections.push('events');
      r.events = await q1(db, (s) => `SELECT count(DISTINCT e.id)::int events,
          count(r.id) FILTER (WHERE r.status<>'cancelled')::int registered,
          coalesce(sum(1 + r.guests) FILTER (WHERE r.status='attended'),0)::int attended,
          count(r.id) FILTER (WHERE r.status='attended')::int checked_in
        FROM events e LEFT JOIN registrations r ON r.event_id=e.id
        WHERE e.status<>'cancelled' AND e.starts_at::date BETWEEN $1 AND $2 AND ${s('e.ministry_id')}`, P);
      r.events.list = await q(db, (s) => `SELECT e.id, e.name, e.starts_at, count(r.id) FILTER (WHERE r.status<>'cancelled')::int registered, count(r.id) FILTER (WHERE r.status='attended')::int attended
        FROM events e LEFT JOIN registrations r ON r.event_id=e.id WHERE e.status<>'cancelled' AND e.starts_at::date BETWEEN $1 AND $2 AND ${s('e.ministry_id')}
        GROUP BY e.id ORDER BY e.starts_at DESC LIMIT 5`, P);
    }

    // ── Grants (auto) ──
    if (can(a, 'grants.read')) {
      r.sections.push('grants');
      r.grants = await q1(db, (s) => `SELECT coalesce(sum(awarded_amount) FILTER (WHERE status IN ('awarded','reporting','closed') AND decision_on BETWEEN $1 AND $2),0)::float awarded,
          count(*) FILTER (WHERE status IN ('awarded','reporting','closed') AND decision_on BETWEEN $1 AND $2)::int awarded_count,
          count(*) FILTER (WHERE status IN ('submitted','under_review'))::int pending,
          count(*) FILTER (WHERE status IN ('awarded','reporting'))::int active
        FROM grants g WHERE ${s('g.ministry_id')}`, P);
      r.grants.reports = await q(db, (s) => `SELECT g.id, g.title, g.report_due, f.name funder FROM grants g LEFT JOIN funders f ON f.id=g.funder_id
        WHERE g.report_due IS NOT NULL AND g.report_due >= current_date - 30 AND g.status IN ('awarded','reporting') AND ${s('g.ministry_id')} ORDER BY g.report_due LIMIT 5`, []);
    }

    // ── Reach (auto) ──
    if (can(a, 'email.read')) {
      r.sections.push('reach');
      r.reach = await q1(db, (s) => `SELECT count(*) FILTER (WHERE m.status='delivered')::int delivered, count(DISTINCT m.donor_id) FILTER (WHERE m.status='delivered')::int people,
          (SELECT count(DISTINCT ev.message_id) FROM email_events ev WHERE ev.type='open' AND ev.occurred_at::date BETWEEN $1 AND $2 AND ev.message_id IN (SELECT id FROM email_messages mm WHERE mm.sent_at::date BETWEEN $1 AND $2))::int opened
        FROM email_messages m LEFT JOIN email_campaigns c ON c.id=m.email_campaign_id WHERE m.sent_at::date BETWEEN $1 AND $2 AND ${s('c.ministry_id')}`, P);
    }

    // ── Where the impact happened: by workspace ──
    const ws = await q(db, (s) => `SELECT mi.id, mi.name, mi.color FROM ministries mi WHERE NOT mi.archived AND ${s('mi.id')} ORDER BY mi.name`, []);
    const rows = [...ws, ...(ministry ? [] : [{ id: null, name: 'Organization-wide', color: '#94a3b8' }])];
    const sum = async (sql: string, id: string | null) => Number((await one(db, sql.replace('$M', id ? '= $3::uuid' : 'IS NULL'), id ? [from, to, id] : [from, to]))?.v ?? 0);
    r.workspaces = [];
    for (const w of rows) {
      const x: any = { id: w.id, name: w.name, color: w.color };
      x.results = await sum(`SELECT count(DISTINCT e.metric_id) v FROM impact_entries e JOIN impact_metrics m ON m.id=e.metric_id WHERE e.entry_date BETWEEN $1 AND $2 AND m.ministry_id $M`, w.id);
      x.served = await sum(`SELECT coalesce(sum(beneficiaries),0) v FROM impact_stories WHERE story_date BETWEEN $1 AND $2 AND ministry_id $M`, w.id);
      if (r.sections.includes('giving')) x.raised = await sum(`SELECT coalesce(sum(amount),0) v FROM gifts WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ministry_id $M`, w.id);
      if (r.sections.includes('funds')) x.spent = await sum(`SELECT coalesce(sum(jl.debit-jl.credit),0) v FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts ac ON ac.id=jl.account_id AND ac.type='expense' WHERE je.entry_date BETWEEN $1 AND $2 AND coalesce(je.ministry_id, (SELECT pp.ministry_id FROM projects pp WHERE pp.id=jl.project_id), (SELECT ff.ministry_id FROM funds ff WHERE ff.id=jl.fund_id)) $M`, w.id);
      if (r.sections.includes('work')) x.hours = await sum(`SELECT coalesce(sum(hours),0) v FROM time_entries WHERE entry_date BETWEEN $1 AND $2 AND ministry_id $M`, w.id);
      if (r.sections.includes('events')) x.attended = await sum(`SELECT coalesce(sum(1+r.guests),0) v FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.status='attended' AND e.starts_at::date BETWEEN $1 AND $2 AND e.ministry_id $M`, w.id);
      if (r.sections.includes('grants')) x.awarded = await sum(`SELECT coalesce(sum(awarded_amount),0) v FROM grants WHERE status IN ('awarded','reporting','closed') AND decision_on BETWEEN $1 AND $2 AND ministry_id $M`, w.id);
      const any = Object.entries(x).some(([k, v]) => !['id', 'name', 'color'].includes(k) && Number(v) > 0);
      if (any || w.id) r.workspaces.push(x);
    }

    // ── Programs: money in → money out → results → stories ──
    r.projects = await q(db, (s) => `SELECT p.id, p.name, p.status, p.goal::float, p.budget::float, f.name fund_name, mi.name ministry_name,
        coalesce((SELECT sum(amount) FROM gifts g WHERE g.project_id=p.id AND NOT g.refunded AND g.gift_date BETWEEN $1 AND $2),0)::float raised,
        coalesce((SELECT sum(jl.debit-jl.credit) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' AND je.entry_date BETWEEN $1 AND $2 JOIN accounts ac ON ac.id=jl.account_id AND ac.type='expense' WHERE jl.project_id=p.id),0)::float spent,
        coalesce((SELECT sum(hours) FROM time_entries t WHERE t.project_id=p.id AND t.entry_date BETWEEN $1 AND $2),0)::float hours,
        (SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.completed_at::date BETWEEN $1 AND $2)::int tasks_done,
        coalesce((SELECT sum(awarded_amount) FROM grants gr WHERE gr.project_id=p.id AND gr.status IN ('awarded','reporting','closed')),0)::float grants_awarded,
        coalesce((SELECT sum(beneficiaries) FROM impact_stories st WHERE st.project_id=p.id AND st.story_date BETWEEN $1 AND $2),0)::int served,
        (SELECT count(*) FROM impact_stories st WHERE st.project_id=p.id AND st.story_date BETWEEN $1 AND $2)::int stories,
        (SELECT coalesce(json_agg(json_build_object('name',m.name,'unit',m.unit,'target',m.target,
            'actual',(SELECT coalesce(sum(e.value),0) FROM impact_entries e WHERE e.metric_id=m.id AND e.entry_date BETWEEN $1 AND $2)) ORDER BY m.name),'[]') FROM impact_metrics m WHERE m.project_id=p.id) metrics
      FROM projects p LEFT JOIN funds f ON f.id=p.fund_id LEFT JOIN ministries mi ON mi.id=p.ministry_id
      WHERE p.status<>'archived' AND ${s('p.ministry_id')} ORDER BY p.name`, P);
    if (!r.sections.includes('giving')) r.projects.forEach((p: any) => { delete p.raised; });
    if (!r.sections.includes('funds')) r.projects.forEach((p: any) => { delete p.spent; delete p.budget; });
    r.projects.forEach((p: any) => {
      p.metrics = (p.metrics ?? []).map((m: any) => ({ ...m, actual: Number(m.actual), costPer: p.spent && Number(m.actual) ? round2(p.spent / Number(m.actual)) : null }));
    });

    // ── Monthly trend ──
    const months = Math.min(24, Math.max(1, Math.ceil(span / 30.4)));
    const trend = await many(db, `SELECT to_char(m, 'YYYY-MM') AS month FROM generate_series(date_trunc('month', $2::date) - (($1::int - 1) || ' months')::interval, date_trunc('month', $2::date), interval '1 month') m`, [months, to]);
    const series = async (sql: (s: (col: string) => string) => string) => Object.fromEntries((await q(db, sql, [shift(to, -months * 31), to])).map((x: any) => [x.month, Number(x.v)]));
    const results = await series((s) => `SELECT to_char(e.entry_date,'YYYY-MM') AS month, count(*) v FROM impact_entries e JOIN impact_metrics m ON m.id=e.metric_id WHERE e.entry_date BETWEEN $1 AND $2 AND ${s('m.ministry_id')} GROUP BY 1`);
    const raised = r.sections.includes('giving') ? await series((s) => `SELECT to_char(gift_date,'YYYY-MM') AS month, sum(amount) v FROM gifts g WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ${s('g.ministry_id')} GROUP BY 1`) : null;
    const spent = r.sections.includes('funds') ? await series((s) => `SELECT to_char(je.entry_date,'YYYY-MM') AS month, sum(jl.debit-jl.credit) v FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts ac ON ac.id=jl.account_id AND ac.type='expense' WHERE je.entry_date BETWEEN $1 AND $2 AND ${s('coalesce(je.ministry_id, (SELECT pp.ministry_id FROM projects pp WHERE pp.id=jl.project_id), (SELECT ff.ministry_id FROM funds ff WHERE ff.id=jl.fund_id))')} GROUP BY 1`) : null;
    const hours = r.sections.includes('work') ? await series((s) => `SELECT to_char(entry_date,'YYYY-MM') AS month, sum(hours) v FROM time_entries t WHERE entry_date BETWEEN $1 AND $2 AND ${s('t.ministry_id')} GROUP BY 1`) : null;
    r.trend = trend.map((t: any) => ({ month: t.month, results: results[t.month] ?? 0, ...(raised && { raised: raised[t.month] ?? 0 }), ...(spent && { spent: spent[t.month] ?? 0 }), ...(hours && { hours: hours[t.month] ?? 0 }) }));
    return r;
  });
  res.json(out);
}));
