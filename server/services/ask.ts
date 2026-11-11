/**
 * Ask A.I. Fundraising — permission-aware question answering.
 *
 * The assistant can only READ through the tools below. Every tool runs inside
 * the caller's tenant transaction (RLS) and applies the caller's workspace and
 * permission scope. There are no write tools: it cannot send, post, move money,
 * or modify records. Answers carry citations linking to the underlying records.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import type { AuthContext } from '../lib/auth.js';
import { ministryScope } from '../lib/auth.js';
import { DONOR_NAME_SQL, fmtMoney, miles, round2, today, addDays } from '../lib/util.js';
import { fundSummaries } from './ledger.js';
import { opportunityReport, CATEGORY_META } from './intelligence.js';
import { claude, BASE_SYSTEM } from './ai.js';
import { config } from '../config.js';
import { geocodeCity } from './geo.js';

export interface Citation { label: string; href: string }
export interface ToolResult { data: unknown; citations: Citation[]; summary?: string }
type ToolFn = (db: Db, ctx: AuthContext, input: any) => Promise<ToolResult>;

interface ToolDef { name: string; description: string; perm: string; input_schema: any; run: ToolFn }

const money = (n: number) => fmtMoney(n);
const donorCite = (r: any): Citation => ({ label: r.name, href: `/donors/${r.id}` });

function scope(ctx: AuthContext, col: string, params: unknown[]) { return ministryScope(ctx, col, params); }

const TOOLS: ToolDef[] = [
  {
    name: 'search_donors', perm: 'donors.read',
    description: 'Find donors by name/email, donor health, opportunity category, giving level, location or tags. Returns donor names, lifetime giving, last gift, health, score and suggested next step.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Name, email or phone fragment' },
      health: { type: 'array', items: { type: 'string', enum: ['active', 'engaged', 'cooling', 'lapsing', 'lapsed'] } },
      category: { type: 'string', enum: Object.keys(CATEGORY_META) },
      min_lifetime: { type: 'number' }, tag: { type: 'string' },
      near_city: { type: 'string', description: 'City (optionally "City, ST") to find donors nearby' }, radius_miles: { type: 'number' },
      recurring_only: { type: 'boolean' }, not_thanked: { type: 'boolean', description: 'Only donors with gifts not yet thanked' },
      sort: { type: 'string', enum: ['score', 'lifetime', 'last_gift', 'opportunity'] }, limit: { type: 'number' },
    } },
    run: async (db, ctx, i) => {
      const p: unknown[] = []; const w: string[] = ['NOT d.archived', 'd.merged_into IS NULL', scope(ctx, 'd.ministry_id', p)];
      if (i.query) { p.push(`%${i.query}%`); w.push(`(${DONOR_NAME_SQL()} ILIKE $${p.length} OR d.email ILIKE $${p.length} OR d.phone ILIKE $${p.length})`); }
      if (i.health?.length) { p.push(i.health); w.push(`d.health_status = ANY($${p.length})`); }
      if (i.category) { p.push(i.category); w.push(`d.intelligence->>'category' = $${p.length}`); }
      if (i.min_lifetime) { p.push(i.min_lifetime); w.push(`(d.intelligence->'stats'->>'lifetime')::numeric >= $${p.length}`); }
      if (i.tag) { p.push(i.tag); w.push(`$${p.length} = ANY(d.tags)`); }
      if (i.recurring_only) w.push(`EXISTS (SELECT 1 FROM recurring_gifts r WHERE r.donor_id=d.id AND r.status='active')`);
      if (i.not_thanked) w.push(`EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.thank_you_status='pending' AND NOT g.refunded)`);
      const order = { score: 'd.score DESC', lifetime: `(d.intelligence->'stats'->>'lifetime')::numeric DESC NULLS LAST`,
        last_gift: `d.intelligence->'stats'->>'lastGift' DESC NULLS LAST`, opportunity: `(d.intelligence->>'opportunityValue')::numeric DESC NULLS LAST` }[i.sort as string] ?? 'd.score DESC';
      let rows = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.city, d.region, d.lat, d.lng, d.health_status, d.score, d.email, d.phone,
          d.intelligence->'stats'->>'lifetime' lifetime, d.intelligence->'stats'->>'lastGift' last_gift, d.intelligence->>'categoryLabel' opportunity,
          d.intelligence->>'nextStep' next_step, d.intelligence->>'suggestedAsk' suggested_ask
        FROM donors d WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT 500`, p);
      if (i.near_city) {
        const geo = await geocodeCity(db, i.near_city);
        if (!geo) return { data: { error: `Could not locate “${i.near_city}”. Donors need city/state or coordinates.` }, citations: [] };
        const r = i.radius_miles ?? 50;
        rows = rows.filter((d) => d.lat != null && miles(geo.lat, geo.lng, d.lat, d.lng) <= r)
          .map((d) => ({ ...d, distance_miles: Math.round(miles(geo.lat, geo.lng, d.lat, d.lng)) }));
      }
      rows = rows.slice(0, Math.min(i.limit ?? 15, 50));
      return { data: rows.map(({ lat, lng, ...r }) => r), citations: rows.map(donorCite) };
    },
  },
  {
    name: 'donor_profile', perm: 'donors.read',
    description: 'Full profile for one donor: contact info, giving history, recent communications, open tasks, score breakdown and suggested next step. Use before summarizing a donor for a meeting.',
    input_schema: { type: 'object', properties: { donor_id: { type: 'string' }, name: { type: 'string', description: 'Use if id unknown' } } },
    run: async (db, ctx, i) => {
      const p: unknown[] = []; const sc = scope(ctx, 'd.ministry_id', p);
      let d: any;
      if (i.donor_id) { p.push(i.donor_id); d = await one(db, `SELECT d.*, ${DONOR_NAME_SQL()} AS name FROM donors d WHERE ${sc} AND d.id=$${p.length}`, p); }
      else { p.push(`%${i.name ?? ''}%`); d = await one(db, `SELECT d.*, ${DONOR_NAME_SQL()} AS name FROM donors d WHERE ${sc} AND NOT d.archived AND ${DONOR_NAME_SQL()} ILIKE $${p.length} ORDER BY d.score DESC LIMIT 1`, p); }
      if (!d) return { data: { error: 'Donor not found or not accessible.' }, citations: [] };
      if (!ctx.permissions.has('donors.private_notes')) delete d.private_notes;
      const gifts = await many(db, `SELECT g.id, g.gift_date, g.amount, f.name fund, c.name campaign FROM gifts g JOIN funds f ON f.id=g.fund_id LEFT JOIN campaigns c ON c.id=g.campaign_id WHERE g.donor_id=$1 AND NOT g.refunded ORDER BY g.gift_date DESC LIMIT 15`, [d.id]);
      const comms = await many(db, `SELECT type, subject, occurred_at, left(body, 300) body FROM communications WHERE donor_id=$1 ${ctx.permissions.has('donors.private_notes') ? '' : 'AND NOT is_private'} ORDER BY occurred_at DESC LIMIT 8`, [d.id]);
      const tasks = await many(db, `SELECT title, due_date, status FROM tasks WHERE donor_id=$1 AND status <> 'completed' ORDER BY due_date NULLS LAST LIMIT 5`, [d.id]);
      const { lat, lng, custom, ...rest } = d;
      return { data: { donor: rest, gifts, communications: comms, open_tasks: tasks }, citations: [donorCite(d), ...gifts.slice(0, 3).map((g) => ({ label: `Gift ${g.gift_date} ${money(g.amount)}`, href: `/donors/${d.id}#gifts` }))] };
    },
  },
  {
    name: 'giving_summary', perm: 'donors.read',
    description: 'Totals of gifts for a date range, optionally grouped by month, fund, campaign, project, workspace, or payment method. Use for YTD, month-over-month comparison, campaign results.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string' },
      group_by: { type: 'string', enum: ['none', 'month', 'fund', 'campaign', 'project', 'ministry', 'payment_method'] } }, required: ['from', 'to'] },
    run: async (db, ctx, i) => {
      const p: unknown[] = [i.from, i.to]; const sc = scope(ctx, 'g.ministry_id', p);
      const key = { month: `to_char(g.gift_date,'YYYY-MM')`, fund: 'f.name', campaign: `coalesce(c.name,'(no campaign)')`, project: `coalesce(pr.name,'(no project)')`,
        ministry: `coalesce(m.name,'(none)')`, payment_method: 'g.payment_method', none: `'total'` }[i.group_by as string ?? 'none'] ?? `'total'`;
      const rows = await many(db, `SELECT ${key} AS grp, round(sum(g.amount),2)::float total, count(*)::int gifts, count(DISTINCT g.donor_id)::int donors
        FROM gifts g JOIN funds f ON f.id=g.fund_id LEFT JOIN campaigns c ON c.id=g.campaign_id LEFT JOIN projects pr ON pr.id=g.project_id LEFT JOIN ministries m ON m.id=g.ministry_id
        WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 AND ${sc} GROUP BY 1 ORDER BY 1`, p);
      return { data: rows, citations: [{ label: `Gifts ${i.from} → ${i.to}`, href: `/money/accounting/giving?from=${i.from}&to=${i.to}` }] };
    },
  },
  {
    name: 'action_queues', perm: 'donors.read',
    description: 'Thank-yous to send and receipts to send (gifts with pending status).',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
    run: async (db, ctx, i) => {
      const p: unknown[] = []; const sc = scope(ctx, 'g.ministry_id', p);
      const q = (col: string) => many(db, `SELECT g.id, g.donor_id, ${DONOR_NAME_SQL()} AS donor, g.amount::float, g.gift_date, f.name fund
        FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN funds f ON f.id=g.fund_id WHERE g.${col}='pending' AND NOT g.refunded AND ${sc} ORDER BY g.gift_date LIMIT ${Math.min(i.limit ?? 25, 100)}`, p);
      const [thanks, receipts] = await Promise.all([q('thank_you_status'), q('receipt_status')]);
      return { data: { thank_yous_to_send: thanks, receipts_to_send: receipts }, citations: [{ label: 'Thank-yous & receipts queues', href: '/donors/giving' }] };
    },
  },
  {
    name: 'fundraising_opportunities', perm: 'donors.read',
    description: 'The Next $100K opportunity report: estimated reachable giving grouped by category (lapsed major donors, upgrades, year-end, etc.) with donor counts and recommended actions. Also returns top donors to call today.',
    input_schema: { type: 'object', properties: {} },
    run: async (db, ctx) => {
      const p: unknown[] = []; const sc = scope(ctx, 'd.ministry_id', p);
      const rep = await opportunityReport(db, sc, p);
      const p2: unknown[] = []; const sc2 = scope(ctx, 'd.ministry_id', p2);
      const top = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.score, d.intelligence->>'categoryLabel' category, d.intelligence->>'suggestedAsk' ask, d.intelligence->>'nextStep' next_step, d.phone
        FROM donors d WHERE NOT d.archived AND ${sc2} AND d.intelligence->>'channel'='Call' ORDER BY (d.intelligence->>'opportunityValue')::numeric DESC NULLS LAST LIMIT 10`, p2);
      return { data: { total: rep.total, method: rep.method, categories: rep.categories.map(({ donorIds, ...c }) => c), call_today: top },
        citations: [{ label: 'Next $100K report', href: '/donors/giving/priorities' }, ...top.slice(0, 5).map(donorCite)] };
    },
  },
  {
    name: 'fund_balances', perm: 'finance.read',
    description: 'Balances of every fund (General/unrestricted, donor-restricted purpose/time, endowment) and income/expense for an optional period.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: async (db, _ctx, i) => {
      const rows = await fundSummaries(db, i.from, i.to);
      return { data: rows.map((r) => ({ fund: r.name, restriction: r.restriction, balance: round2(r.balance), period_income: round2(r.period_income), period_expense: round2(r.period_expense) })),
        citations: rows.map((r) => ({ label: `${r.name} fund ledger`, href: `/money/accounting/funds/${r.id}` })) };
    },
  },
  {
    name: 'spending', perm: 'finance.read',
    description: 'Expenses for a date range, optionally filtered by fund name or account, grouped by account, fund, project or month.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, fund: { type: 'string' }, group_by: { type: 'string', enum: ['account', 'fund', 'project', 'month'] } }, required: ['from', 'to'] },
    run: async (db, _ctx, i) => {
      const p: unknown[] = [i.from, i.to]; let fw = '';
      if (i.fund) { p.push(`%${i.fund}%`); fw = `AND f.name ILIKE $${p.length}`; }
      const key = { account: `a.code||' '||a.name`, fund: 'f.name', project: `coalesce(pr.name,'(none)')`, month: `to_char(je.entry_date,'YYYY-MM')` }[i.group_by as string] ?? `a.code||' '||a.name`;
      const rows = await many(db, `SELECT ${key} grp, round(sum(jl.debit - jl.credit),2)::float spent FROM journal_lines jl
        JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id AND a.type='expense'
        JOIN funds f ON f.id=jl.fund_id LEFT JOIN projects pr ON pr.id=jl.project_id
        WHERE je.entry_date BETWEEN $1 AND $2 ${fw} GROUP BY 1 ORDER BY 2 DESC`, p);
      return { data: rows, citations: [{ label: `Transactions ${i.from} → ${i.to}`, href: `/money/accounting/transactions?from=${i.from}&to=${i.to}` }] };
    },
  },
  {
    name: 'budget_vs_actual', perm: 'finance.read',
    description: 'Budget versus actual by budget line for active budgets, including variance and percent used; identifies over-budget programs.',
    input_schema: { type: 'object', properties: {} },
    run: async (db) => {
      const rows = await many(db, `SELECT b.id budget_id, b.name budget, a.code||' '||a.name account, bl.amount::float budget_amount,
        coalesce((SELECT sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted'
          WHERE jl.account_id=bl.account_id AND (bl.fund_id IS NULL OR jl.fund_id=bl.fund_id) AND (bl.project_id IS NULL OR jl.project_id=bl.project_id) AND je.entry_date BETWEEN b.period_start AND b.period_end),0)::float actual
        FROM budget_lines bl JOIN budgets b ON b.id=bl.budget_id JOIN accounts a ON a.id=bl.account_id WHERE current_date BETWEEN b.period_start AND b.period_end + 90`);
      const data = rows.map((r) => ({ ...r, variance: round2(r.budget_amount - r.actual), pct_used: r.budget_amount ? Math.round((r.actual / r.budget_amount) * 100) : null }));
      return { data, citations: [...new Map(rows.map((r) => [r.budget_id, { label: `Budget: ${r.budget}`, href: `/money/accounting/budgets/${r.budget_id}` }])).values()] };
    },
  },
  {
    name: 'grant_deadlines', perm: 'grants.read',
    description: 'Grant applications with upcoming deadlines or report due dates within N days, and pipeline totals by status.',
    input_schema: { type: 'object', properties: { days: { type: 'number' } } },
    run: async (db, ctx, i) => {
      const p: unknown[] = [i.days ?? 60]; const sc = scope(ctx, 'g.ministry_id', p);
      const rows = await many(db, `SELECT g.id, g.title, fu.name funder, g.status, g.deadline, g.report_due, g.request_amount::float, g.awarded_amount::float
        FROM grants g LEFT JOIN funders fu ON fu.id=g.funder_id WHERE ${sc} AND ((g.deadline BETWEEN current_date AND current_date + $1::int AND g.status NOT IN ('submitted','under_review','awarded','declined','closed'))
          OR (g.report_due BETWEEN current_date AND current_date + $1::int)) ORDER BY least(g.deadline, g.report_due)`, p);
      const p2: unknown[] = []; const sc2 = scope(ctx, 'g.ministry_id', p2);
      const pipeline = await many(db, `SELECT status, count(*)::int n, coalesce(sum(request_amount),0)::float requested, coalesce(sum(awarded_amount),0)::float awarded FROM grants g WHERE ${sc2} GROUP BY status`, p2);
      return { data: { upcoming: rows, pipeline }, citations: rows.map((r) => ({ label: r.title, href: `/donors/grants/${r.id}` })) };
    },
  },
  {
    name: 'tasks', perm: 'work.read',
    description: 'Tasks — overdue, due soon, or assigned to the current user.',
    input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['overdue', 'due_this_week', 'mine', 'all_open'] } } },
    run: async (db, ctx, i) => {
      const p: unknown[] = [ctx.userId]; const sc = scope(ctx, 't.ministry_id', p);
      const f = { overdue: `t.due_date < current_date`, due_this_week: `t.due_date BETWEEN current_date AND current_date + 7`, mine: `t.assignee_id = $1`, all_open: 'TRUE' }[i.filter as string] ?? `t.due_date < current_date`;
      const rows = await many(db, `SELECT t.id, t.title, t.due_date, t.status, t.progress, u.name assignee, m.name ministry FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN ministries m ON m.id=t.ministry_id
        WHERE t.status <> 'completed' AND ${f} AND ${sc} AND ($1::uuid IS NOT NULL) ORDER BY t.due_date NULLS LAST LIMIT 50`, p);
      return { data: rows, citations: [{ label: 'Tasks', href: '/work/tasks' }] };
    },
  },
  {
    name: 'campaign_performance', perm: 'donors.read',
    description: 'Fundraising campaigns and email campaigns with gifts attributed, goals, opens and clicks.',
    input_schema: { type: 'object', properties: {} },
    run: async (db, ctx) => {
      const p: unknown[] = []; const sc = scope(ctx, 'c.ministry_id', p);
      const camps = await many(db, `SELECT c.id, c.name, c.goal::float, c.status, coalesce(sum(g.amount) FILTER (WHERE NOT g.refunded),0)::float raised, count(g.id)::int gifts
        FROM campaigns c LEFT JOIN gifts g ON g.campaign_id=c.id WHERE ${sc} GROUP BY c.id ORDER BY raised DESC`, p);
      const emails = await many(db, `SELECT ec.id, ec.name, ec.status, ec.recipient_count,
          (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='open')::int opens,
          (SELECT count(DISTINCT message_id) FROM email_events e WHERE e.email_campaign_id=ec.id AND e.type='click')::int clicks,
          (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.email_campaign_id=ec.id)::float gifts_attributed
        FROM email_campaigns ec WHERE ec.status='sent' ORDER BY ec.sent_at DESC LIMIT 10`);
      return { data: { campaigns: camps, email_campaigns: emails }, citations: camps.slice(0, 5).map((c) => ({ label: c.name, href: `/donors/giving/campaigns/${c.id}` })) };
    },
  },
  {
    name: 'org_snapshot', perm: 'donors.read',
    description: 'High-level counts: donors by health, YTD giving, last-year-to-date giving, new donors this year, recurring donors.',
    input_schema: { type: 'object', properties: {} },
    run: async (db, ctx) => {
      const p: unknown[] = []; const sc = scope(ctx, 'd.ministry_id', p);
      const health = await many(db, `SELECT health_status, count(*)::int n FROM donors d WHERE NOT archived AND merged_into IS NULL AND ${sc} GROUP BY 1`, p);
      const p2: unknown[] = []; const sc2 = scope(ctx, 'g.ministry_id', p2);
      const g = await one(db, `SELECT
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('year', current_date)),0)::float ytd,
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('year', current_date) - interval '1 year' AND gift_date <= current_date - interval '1 year'),0)::float last_ytd,
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('month', current_date)),0)::float this_month,
        coalesce(sum(amount) FILTER (WHERE gift_date >= date_trunc('month', current_date) - interval '1 month' AND gift_date < date_trunc('month', current_date)),0)::float last_month,
        coalesce(sum(amount),0)::float lifetime
        FROM gifts g WHERE NOT refunded AND ${sc2}`, p2);
      return { data: { donors_by_health: health, giving: g, as_of: today() }, citations: [{ label: 'Dashboard', href: '/' }] };
    },
  },
];

export function toolsFor(ctx: AuthContext) { return TOOLS.filter((t) => ctx.permissions.has(t.perm)); }

const ASK_SYSTEM = `${BASE_SYSTEM}
You are “Ask A.I. Fundraising”, a question-answering portal. Use the provided read-only tools to look up the organization's data
before answering. Today is ${'{TODAY}'}. Rules:
- Only answer from tool results. If data is missing or the user lacks access, say so plainly.
- Show key numbers and name the records you used. Keep answers concise and scannable (short paragraphs or bullet lists).
- Clearly label recommendations as suggestions. Never claim you took an action; you cannot send, post, edit or move money.
- If asked to do something consequential (send an email, post an entry, change a record), explain which button in A.I. Fundraising does it.`;

export interface AskAnswer { answer: string; citations: Citation[]; engine: 'claude' | 'rules'; toolsUsed: string[]; data?: unknown }

export async function askQuestion(db: Db, ctx: AuthContext, question: string, history: { role: 'user' | 'assistant'; content: string }[] = []): Promise<AskAnswer> {
  const tools = toolsFor(ctx);
  const c = claude();
  if (!c) return rulesAnswer(db, ctx, question, tools);

  const citations: Citation[] = []; const toolsUsed: string[] = [];
  const messages: Anthropic.MessageParam[] = [...history.slice(-6).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: question }];
  const apiTools: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  for (let turn = 0; turn < 8; turn++) {
    const params: any = {
      model: config.anthropicModel, max_tokens: 16000, system: ASK_SYSTEM.replace('{TODAY}', today()),
      thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, tools: apiTools, messages,
    };
    if (config.anthropicModel === 'claude-opus-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    const res: any = params.betas ? await (c.beta.messages as any).create(params) : await c.messages.create(params);
    if (res.stop_reason === 'refusal') return { answer: 'I can’t help with that question.', citations, engine: 'claude', toolsUsed };
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b: any) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      return { answer: text, citations: dedupe(citations), engine: 'claude', toolsUsed };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const t = tools.find((x) => x.name === u.name);
      if (!t) { results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Tool not available for your role.', is_error: true }); continue; }
      try {
        const input = typeof u.input === 'object' && u.input ? u.input : {};
        const r = await t.run(db, ctx, input);
        toolsUsed.push(t.name); citations.push(...r.citations);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.data).slice(0, 60000) });
      } catch (e: any) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'I could not finish answering within the step limit. Try a more specific question.', citations: dedupe(citations), engine: 'claude', toolsUsed };
}

function dedupe(c: Citation[]) { return [...new Map(c.map((x) => [x.href + x.label, x])).values()].slice(0, 20); }

// ───────────── Deterministic fallback (no AI credentials) ─────────────
function ytdRange() { const y = new Date().getFullYear(); return { from: `${y}-01-01`, to: today() }; }
function quarterRange() { const d = new Date(); const q = Math.floor(d.getMonth() / 3); return { from: new Date(Date.UTC(d.getFullYear(), q * 3, 1)).toISOString().slice(0, 10), to: today() }; }

async function rulesAnswer(db: Db, ctx: AuthContext, q: string, tools: ToolDef[]): Promise<AskAnswer> {
  const t = (n: string) => tools.find((x) => x.name === n);
  const ql = q.toLowerCase();
  const run = async (n: string, input: any) => {
    const tool = t(n);
    if (!tool) return null;
    return tool.run(db, ctx, input);
  };
  const noAccess = (area: string): AskAnswer => ({ answer: `Your role does not include access to ${area}, so I can’t answer that.`, citations: [], engine: 'rules', toolsUsed: [] });
  const list = (rows: any[], f: (r: any) => string) => rows.length ? rows.map((r) => `• ${f(r)}`).join('\n') : '• None found.';

  if (/thank|thanked/.test(ql) || /receipt/.test(ql)) {
    const r = await run('action_queues', { limit: 25 }); if (!r) return noAccess('donor gifts');
    const d: any = r.data; const wantReceipts = /receipt/.test(ql) && !/thank/.test(ql);
    const rows = wantReceipts ? d.receipts_to_send : d.thank_yous_to_send;
    return { answer: `${wantReceipts ? 'Receipts' : 'Thank-yous'} still to send: ${rows.length}${rows.length >= 25 ? '+' : ''}\n\n${list(rows, (x) => `${x.donor} — ${money(x.amount)} on ${x.gift_date} (${x.fund})`)}`,
      citations: [...r.citations, ...rows.slice(0, 8).map((x: any) => ({ label: x.donor, href: `/donors/${x.donor_id}` }))], engine: 'rules', toolsUsed: ['action_queues'], data: rows };
  }
  if (/lapse|lapsing|at risk|recover|re-?engage/.test(ql)) {
    const r = await run('search_donors', { health: ['lapsing', 'lapsed'], sort: 'lifetime', limit: 15 }); if (!r) return noAccess('donors');
    const rows = r.data as any[];
    return { answer: `Donors lapsing or lapsed, highest lifetime giving first:\n\n${list(rows, (x) => `${x.name} — ${x.health_status}, lifetime ${money(Number(x.lifetime ?? 0))}, last gift ${x.last_gift ?? 'never'}. Suggested: ${x.next_step ?? 're-engage'}`)}\n\nSuggestion (estimate): prioritize the highest lifetime donors for personal calls.`,
      citations: r.citations, engine: 'rules', toolsUsed: ['search_donors'], data: rows };
  }
  if (/call|who should i|today/.test(ql) || /next \$?100|where could|opportunit/.test(ql)) {
    const r = await run('fundraising_opportunities', {}); if (!r) return noAccess('fundraising intelligence');
    const d: any = r.data;
    const wantsCalls = /call|who should|today/.test(ql);
    const body = wantsCalls
      ? `Top people to contact today (by estimated opportunity):\n\n${list(d.call_today, (x) => `${x.name} — ${x.category}; suggested ask ${money(Number(x.ask))}. ${x.next_step}`)}`
      : `Estimated reachable opportunity: ${money(d.total)}\n\n${list(d.categories, (c) => `${c.label}: ${money(c.potential)} across ${c.donors} donors — ${c.action} (${c.priority}, ${c.timeline})`)}\n\nHow this is estimated: ${d.method}`;
    return { answer: `${body}\n\nThese are estimates from giving history, not certainties.`, citations: r.citations, engine: 'rules', toolsUsed: ['fundraising_opportunities'], data: d };
  }
  if (/restricted|fund balance|balances|fund/.test(ql) && /spend|spent|expense/.test(ql)) {
    const range = /quarter/.test(ql) ? quarterRange() : /month/.test(ql) ? { from: today().slice(0, 8) + '01', to: today() } : ytdRange();
    const fm = ql.match(/from the ([a-z ]+?) fund|([a-z]+) fund/);
    const fund = fm ? (fm[1] ?? fm[2]).trim() : undefined;
    const r = await run('spending', { ...range, fund, group_by: 'account' }); if (!r) return noAccess('finance');
    const rows = r.data as any[]; const total = rows.reduce((a, x) => a + x.spent, 0);
    return { answer: `Spending${fund ? ` from the ${fund} fund` : ''} ${range.from} → ${range.to}: ${money(total)}\n\n${list(rows, (x) => `${x.grp}: ${money(x.spent)}`)}`, citations: r.citations, engine: 'rules', toolsUsed: ['spending'], data: rows };
  }
  if (/fund|restricted/.test(ql)) {
    const r = await run('fund_balances', {}); if (!r) return noAccess('finance');
    const rows = r.data as any[];
    const restricted = rows.filter((x) => x.restriction !== 'unrestricted');
    const show = /restricted/.test(ql) ? restricted : rows;
    return { answer: `${/restricted/.test(ql) ? 'Restricted fund' : 'Fund'} balances:\n\n${list(show, (x) => `${x.fund} (${x.restriction}) — ${money(x.balance)}`)}\n\nTotal restricted: ${money(restricted.reduce((a, x) => a + x.balance, 0))}`, citations: r.citations, engine: 'rules', toolsUsed: ['fund_balances'], data: show };
  }
  if (/over budget|budget/.test(ql)) {
    const r = await run('budget_vs_actual', {}); if (!r) return noAccess('finance');
    const rows = (r.data as any[]).sort((a, b) => (b.pct_used ?? 0) - (a.pct_used ?? 0));
    const over = rows.filter((x) => x.actual > x.budget_amount);
    return { answer: `${over.length} budget line(s) over budget.\n\n${list(rows.slice(0, 15), (x) => `${x.budget} · ${x.account}: ${money(x.actual)} of ${money(x.budget_amount)} (${x.pct_used ?? '—'}%)`)}`, citations: r.citations, engine: 'rules', toolsUsed: ['budget_vs_actual'], data: rows };
  }
  if (/grant|deadline/.test(ql)) {
    const r = await run('grant_deadlines', { days: 60 }); if (!r) return noAccess('grants');
    const d: any = r.data;
    return { answer: `Grant deadlines and reports due in the next 60 days:\n\n${list(d.upcoming, (x) => `${x.title}${x.funder ? ` (${x.funder})` : ''} — ${x.status}; deadline ${x.deadline ?? '—'}${x.report_due ? `, report due ${x.report_due}` : ''}`)}`, citations: r.citations, engine: 'rules', toolsUsed: ['grant_deadlines'], data: d };
  }
  if (/task|overdue/.test(ql)) {
    const r = await run('tasks', { filter: /mine|my /.test(ql) ? 'mine' : 'overdue' }); if (!r) return noAccess('tasks');
    const rows = r.data as any[];
    return { answer: `${rows.length} ${/mine|my /.test(ql) ? 'open tasks assigned to you' : 'overdue tasks'}:\n\n${list(rows, (x) => `${x.title} — due ${x.due_date ?? '—'}${x.assignee ? `, ${x.assignee}` : ''} (${x.status}, ${x.progress}%)`)}`, citations: r.citations, engine: 'rules', toolsUsed: ['tasks'], data: rows };
  }
  if (/campaign/.test(ql)) {
    const r = await run('campaign_performance', {}); if (!r) return noAccess('campaigns');
    const d: any = r.data;
    return { answer: `Campaign results:\n\n${list(d.campaigns, (x) => `${x.name} — raised ${money(x.raised)} from ${x.gifts} gifts${x.goal ? ` (goal ${money(x.goal)})` : ''}`)}\n\nEmail campaigns:\n${list(d.email_campaigns, (x) => `${x.name} — ${x.recipient_count} recipients, ${x.opens} opens, ${x.clicks} clicks, ${money(x.gifts_attributed)} attributed`)}`, citations: r.citations, engine: 'rules', toolsUsed: ['campaign_performance'], data: d };
  }
  const near = ql.match(/near ([a-z .]+?)(?:\?|$| should| to | i )/);
  if (near) {
    const r = await run('search_donors', { near_city: near[1].trim(), radius_miles: 50, sort: 'opportunity', limit: 15 }); if (!r) return noAccess('donors');
    const rows = r.data as any;
    if (rows.error) return { answer: rows.error, citations: [], engine: 'rules', toolsUsed: ['search_donors'] };
    return { answer: `Donors within 50 miles of ${near[1].trim()}:\n\n${list(rows, (x) => `${x.name} (${x.city ?? ''}${x.region ? ', ' + x.region : ''}, ~${x.distance_miles} mi) — score ${x.score}, suggested ask ${money(Number(x.suggested_ask ?? 0))}`)}\n\nTip: use Donors › Trips to build a full meeting schedule and route.`, citations: r.citations, engine: 'rules', toolsUsed: ['search_donors'], data: rows };
  }
  const summarize = q.match(/(?:summarize|summary of|brief(?: me)? on|about)\s+(.+?)(?:\s+before.*)?[?.]?$/i);
  if (summarize) {
    const r = await run('donor_profile', { name: summarize[1].replace(/^(donor|this donor)\s*/i, '') }); if (!r) return noAccess('donors');
    const d: any = r.data;
    if (d.error) return { answer: d.error, citations: [], engine: 'rules', toolsUsed: ['donor_profile'] };
    const i = d.donor.intelligence ?? {}; const s = i.stats ?? {};
    return { answer: `${d.donor.name} — ${d.donor.health_status}, score ${d.donor.score}/100\n\n• Lifetime giving ${money(s.lifetime ?? 0)} across ${s.giftCount ?? 0} gifts; last gift ${s.lastGift ?? 'never'}${s.lastAmount ? ` (${money(s.lastAmount)})` : ''}\n• Recent contacts: ${d.communications.length ? d.communications.slice(0, 3).map((c: any) => `${c.type} ${String(c.occurred_at).slice(0, 10)}${c.subject ? ` “${c.subject}”` : ''}`).join('; ') : 'none logged'}\n• Open tasks: ${d.open_tasks.length ? d.open_tasks.map((x: any) => x.title).join('; ') : 'none'}\n\nSuggested (estimate): ${i.nextStep ?? '—'} · Ask ${money(i.askLow ?? 0)}–${money(i.askHigh ?? 0)} (${i.askBasis ?? ''})`,
      citations: r.citations, engine: 'rules', toolsUsed: ['donor_profile'], data: d };
  }
  if (/ytd|year.to.date|this year|compare|month|giving|raised|how much/.test(ql)) {
    const r = await run('org_snapshot', {}); if (!r) return noAccess('giving');
    const g: any = (r.data as any).giving;
    const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : 'n/a');
    return { answer: `Giving snapshot (as of ${today()}):\n\n• Year-to-date: ${money(g.ytd)} (same period last year ${money(g.last_ytd)}, ${pct(g.ytd, g.last_ytd)})\n• This month: ${money(g.this_month)} vs last month ${money(g.last_month)} (${pct(g.this_month, g.last_month)} — note this month may be partial)\n• Lifetime: ${money(g.lifetime)}`,
      citations: r.citations, engine: 'rules', toolsUsed: ['org_snapshot'], data: r.data };
  }
  return {
    answer: `I can answer questions about donors, giving, thank-yous and receipts, fundraising opportunities, funds and spending, budgets, grants, tasks and campaigns. Try:\n• “Who should I call today?”\n• “Which donors are at risk of lapsing?”\n• “Show our restricted-fund balances.”\n• “What grant deadlines are coming up?”\n\n${config.aiEnabled ? '' : 'Note: natural-language AI is not configured on this server (set ANTHROPIC_API_KEY), so questions are matched to built-in reports.'}`,
    citations: [], engine: 'rules', toolsUsed: [],
  };
}

export { addDays };
