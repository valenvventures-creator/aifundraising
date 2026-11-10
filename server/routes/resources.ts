/**
 * Generic, permission-aware CRUD for straightforward entities. Complex workflows
 * (gifts, journals, invoices, email sending, …) live in dedicated routers.
 */
import { Router, type Request } from 'express';
import { h } from '../lib/http.js';
import { tx, requirePerm, ministryScope, assertMinistry, actor } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one } from '../db/pool.js';
import type { Permission } from '../lib/permissions.js';
import { sendTable } from '../services/exporter.js';
import { DONOR_NAME_SQL } from '../lib/util.js';

type FieldType = 'text' | 'number' | 'int' | 'bool' | 'date' | 'datetime' | 'uuid' | 'json' | 'text[]';
interface Field { type: FieldType; required?: boolean; enum?: string[]; label?: string }
export interface Resource {
  table: string; label: string;
  read: Permission; write: Permission;
  ministryCol?: string;              // column used for workspace scoping
  fields: Record<string, Field>;
  select?: string;                   // SELECT list with joins (alias main table as t)
  joins?: string;
  search?: string[];                 // columns (qualified) for ?q=
  filters?: string[];                // allowed equality filters
  order?: string;
  ownerField?: string;               // set to current user on create
  softDelete?: string;               // column set true instead of delete
  category: string;                  // audit category
  afterWrite?: (db: any, req: Request, row: any) => Promise<void>;
}

const F = (type: FieldType, extra: Partial<Field> = {}): Field => ({ type, ...extra });

export const RESOURCES: Record<string, Resource> = {
  campaigns: { table: 'campaigns', label: 'Campaign', read: 'donors.read', write: 'donors.write', ministryCol: 'ministry_id', category: 'fundraising',
    fields: { name: F('text', { required: true }), description: F('text'), goal: F('number'), starts_on: F('date'), ends_on: F('date'), status: F('text', { enum: ['active', 'planned', 'completed', 'archived'] }), ministry_id: F('uuid') },
    select: `t.*, m.name ministry_name, (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.campaign_id=t.id AND NOT g.refunded)::float raised, (SELECT count(*) FROM gifts g WHERE g.campaign_id=t.id)::int gift_count`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id', search: ['t.name'], filters: ['status', 'ministry_id'], order: 't.starts_on DESC NULLS LAST' },
  projects: { table: 'projects', label: 'Project', read: 'projects.read', write: 'projects.write', ministryCol: 'ministry_id', category: 'projects',
    fields: { name: F('text', { required: true }), description: F('text'), goal: F('number'), budget: F('number'), fund_id: F('uuid'), campaign_id: F('uuid'), owner_user_id: F('uuid'), starts_on: F('date'), ends_on: F('date'), status: F('text', { enum: ['planning', 'active', 'on_hold', 'completed', 'archived'] }), ministry_id: F('uuid') },
    select: `t.*, m.name ministry_name, f.name fund_name, f.restriction fund_restriction, u.name owner_name, c.name campaign_name,
      (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.project_id=t.id AND NOT g.refunded)::float raised,
      (SELECT coalesce(sum(jl.debit-jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id AND a.type='expense' WHERE jl.project_id=t.id)::float spent`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN funds f ON f.id=t.fund_id LEFT JOIN users u ON u.id=t.owner_user_id LEFT JOIN campaigns c ON c.id=t.campaign_id',
    search: ['t.name', 't.description'], filters: ['status', 'ministry_id', 'fund_id'], order: 't.created_at DESC' },
  funders: { table: 'funders', label: 'Funder', read: 'grants.read', write: 'grants.write', category: 'grants',
    fields: { name: F('text', { required: true }), contact_name: F('text'), email: F('text'), phone: F('text'), website: F('text'), focus_areas: F('text'), notes: F('text'), donor_id: F('uuid') },
    select: `t.*, (SELECT count(*) FROM grants g WHERE g.funder_id=t.id)::int grant_count, (SELECT coalesce(sum(awarded_amount),0) FROM grants g WHERE g.funder_id=t.id)::float awarded_total`,
    search: ['t.name', 't.contact_name', 't.email'], order: 't.name' },
  grants: { table: 'grants', label: 'Grant', read: 'grants.read', write: 'grants.write', ministryCol: 'ministry_id', category: 'grants',
    fields: { title: F('text', { required: true }), funder_id: F('uuid'), request_amount: F('number'), awarded_amount: F('number'), deadline: F('date'), submitted_on: F('date'), decision_on: F('date'), report_due: F('date'),
      status: F('text', { enum: ['researching', 'qualified', 'preparing', 'submitted', 'under_review', 'awarded', 'declined', 'reporting', 'closed'] }), assignee_id: F('uuid'), project_id: F('uuid'), fund_id: F('uuid'), requirements: F('text'), notes: F('text'), ministry_id: F('uuid') },
    select: `t.*, fu.name funder_name, u.name assignee_name, p.name project_name, m.name ministry_name, f.name fund_name`,
    joins: 'LEFT JOIN funders fu ON fu.id=t.funder_id LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN funds f ON f.id=t.fund_id',
    search: ['t.title', 'fu.name'], filters: ['status', 'ministry_id', 'funder_id', 'assignee_id'], order: 't.deadline NULLS LAST' },
  tasks: { table: 'tasks', label: 'Task', read: 'work.read', write: 'work.write', ministryCol: 'ministry_id', category: 'work', ownerField: 'created_by',
    fields: { title: F('text', { required: true }), category: F('text'), rate_type_id: F('uuid'), due_date: F('date'), est_hours: F('number'), actual_hours: F('number'), progress: F('int'),
      status: F('text', { enum: ['todo', 'in_progress', 'waiting', 'completed'] }), assignee_id: F('uuid'), notes: F('text'), next_step: F('text'), billable: F('bool'),
      donor_id: F('uuid'), job_id: F('uuid'), grant_id: F('uuid'), project_id: F('uuid'), ministry_id: F('uuid') },
    select: `t.*, m.name ministry_name, u.name assignee_name, rt.name rate_type_name, rt.hourly_rate::float rate, ${DONOR_NAME_SQL('d')} donor_name,
      (SELECT coalesce(sum(hours),0) FROM time_entries te WHERE te.task_id=t.id)::float logged_hours`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN rate_types rt ON rt.id=t.rate_type_id LEFT JOIN donors d ON d.id=t.donor_id',
    search: ['t.title', 't.notes'], filters: ['status', 'ministry_id', 'assignee_id', 'donor_id', 'job_id', 'grant_id', 'project_id'], order: `(t.status='completed'), t.due_date NULLS LAST`,
    afterWrite: async (db, _req, row) => { await db.query(`UPDATE tasks SET completed_at = CASE WHEN status='completed' THEN coalesce(completed_at, now()) ELSE NULL END, progress = CASE WHEN status='completed' THEN 100 ELSE progress END WHERE id=$1`, [row.id]); } },
  jobs: { table: 'jobs', label: 'Job', read: 'work.read', write: 'work.write', ministryCol: 'ministry_id', category: 'work',
    fields: { title: F('text', { required: true }), client_name: F('text'), status: F('text', { enum: ['open', 'in_progress', 'waiting', 'completed', 'cancelled'] }), engagement_type: F('text', { enum: ['hourly', 'fixed_fee', 'retainer'] }),
      assignee_id: F('uuid'), due_date: F('date'), fixed_fee: F('number'), retainer: F('number'), billed: F('bool'), notes: F('text'), ministry_id: F('uuid') },
    select: `t.*, m.name ministry_name, u.name assignee_name,
      (SELECT coalesce(sum(te.hours),0) FROM time_entries te WHERE te.job_id=t.id)::float hours,
      (SELECT coalesce(sum(te.hours*coalesce(rt.hourly_rate,0)),0) FROM time_entries te LEFT JOIN rate_types rt ON rt.id=te.rate_type_id WHERE te.job_id=t.id AND te.billable)::float unbilled_amount,
      (SELECT count(*) FROM tasks tk WHERE tk.job_id=t.id AND tk.status<>'completed')::int open_tasks`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN users u ON u.id=t.assignee_id',
    search: ['t.title', 't.client_name'], filters: ['status', 'ministry_id', 'assignee_id', 'engagement_type'], order: 't.due_date NULLS LAST' },
  communications: { table: 'communications', label: 'Communication', read: 'work.read', write: 'work.write', ministryCol: 'ministry_id', category: 'communications', ownerField: 'user_id',
    fields: { type: F('text', { required: true }), direction: F('text', { enum: ['inbound', 'outbound'] }), subject: F('text'), body: F('text'), occurred_at: F('datetime'), duration_hours: F('number'),
      rate_type_id: F('uuid'), billable: F('bool'), is_private: F('bool'), donor_id: F('uuid'), job_id: F('uuid'), grant_id: F('uuid'), ministry_id: F('uuid') },
    select: `t.*, m.name ministry_name, u.name user_name, rt.name rate_type_name, ${DONOR_NAME_SQL('d')} donor_name, (SELECT count(*) FROM attachments a WHERE a.entity_type='communication' AND a.entity_id=t.id)::int attachment_count`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN users u ON u.id=t.user_id LEFT JOIN rate_types rt ON rt.id=t.rate_type_id LEFT JOIN donors d ON d.id=t.donor_id',
    search: ['t.subject', 't.body'], filters: ['type', 'ministry_id', 'donor_id', 'job_id', 'grant_id', 'user_id'], order: 't.occurred_at DESC' },
  time_entries: { table: 'time_entries', label: 'Time entry', read: 'work.read', write: 'work.write', ministryCol: 'ministry_id', category: 'work', ownerField: 'user_id',
    fields: { entry_date: F('date', { required: true }), hours: F('number', { required: true }), description: F('text'), rate_type_id: F('uuid'), billable: F('bool'), category: F('text'),
      task_id: F('uuid'), job_id: F('uuid'), project_id: F('uuid'), grant_id: F('uuid'), communication_id: F('uuid'), ministry_id: F('uuid') },
    select: `t.*, u.name user_name, m.name ministry_name, rt.name rate_type_name, rt.hourly_rate::float rate, tk.title task_title, j.title job_title`,
    joins: 'LEFT JOIN users u ON u.id=t.user_id LEFT JOIN ministries m ON m.id=t.ministry_id LEFT JOIN rate_types rt ON rt.id=t.rate_type_id LEFT JOIN tasks tk ON tk.id=t.task_id LEFT JOIN jobs j ON j.id=t.job_id',
    search: ['t.description'], filters: ['user_id', 'ministry_id', 'task_id', 'job_id', 'project_id'], order: 't.entry_date DESC',
    afterWrite: async (db, _req, row) => { if (row.task_id) await db.query(`UPDATE tasks SET actual_hours=(SELECT coalesce(sum(hours),0) FROM time_entries WHERE task_id=$1) WHERE id=$1`, [row.task_id]); } },
  rate_types: { table: 'rate_types', label: 'Rate type', read: 'work.read', write: 'settings.manage', category: 'settings',
    fields: { name: F('text', { required: true }), hourly_rate: F('number', { required: true }), archived: F('bool') }, order: 't.name' },
  events: { table: 'events', label: 'Event', read: 'events.read', write: 'events.write', ministryCol: 'ministry_id', category: 'events',
    fields: { name: F('text', { required: true }), event_type: F('text', { enum: ['conference', 'seminar', 'webinar', 'gathering', 'fundraiser', 'other'] }), starts_at: F('datetime', { required: true }), ends_at: F('datetime'),
      location: F('text'), description: F('text'), capacity: F('int'), is_public: F('bool'), status: F('text', { enum: ['draft', 'published', 'closed', 'cancelled'] }), campaign_id: F('uuid'), ministry_id: F('uuid'), slug: F('text') },
    select: `t.*, m.name ministry_name, (SELECT count(*) FROM registrations r WHERE r.event_id=t.id AND r.status<>'cancelled')::int registered,
      (SELECT count(*) FROM registrations r WHERE r.event_id=t.id AND r.status='attended')::int attended, (SELECT count(*) FROM registrations r WHERE r.event_id=t.id AND r.status='no_show')::int no_shows`,
    joins: 'LEFT JOIN ministries m ON m.id=t.ministry_id', search: ['t.name', 't.location'], filters: ['status', 'event_type', 'ministry_id'], order: 't.starts_at DESC' },
  registrations: { table: 'registrations', label: 'Registration', read: 'events.read', write: 'events.write', category: 'events',
    fields: { event_id: F('uuid', { required: true }), donor_id: F('uuid'), name: F('text', { required: true }), email: F('text'), phone: F('text'), guests: F('int'), status: F('text', { enum: ['registered', 'attended', 'no_show', 'cancelled'] }), followed_up: F('bool') },
    select: `t.*, ${DONOR_NAME_SQL('d')} donor_name`, joins: 'LEFT JOIN donors d ON d.id=t.donor_id', search: ['t.name', 't.email'], filters: ['event_id', 'status', 'donor_id'], order: 't.registered_at DESC',
    // Staff-entered registrations feed the constituent database just like the public page: match by email or create.
    afterWrite: async (db, req, row) => {
      if (row.donor_id) return;
      let donor = row.email ? await one(db, `SELECT id FROM donors WHERE lower(email)=lower($1) AND NOT archived LIMIT 1`, [row.email]) : null;
      if (!donor) {
        const ev = await one(db, `SELECT ministry_id, name FROM events WHERE id=$1`, [row.event_id]);
        const [first, ...rest] = String(row.name).trim().split(/\s+/);
        donor = await one(db, `INSERT INTO donors(tenant_id, ministry_id, first_name, last_name, email, phone, source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [req.auth!.tenantId, ev?.ministry_id ?? null, first, rest.join(' ') || null, row.email ? String(row.email).toLowerCase() : null, row.phone, `Event: ${ev?.name ?? ''}`]);
      }
      await db.query(`UPDATE registrations SET donor_id=$2 WHERE id=$1`, [row.id, donor.id]);
    } },
  audiences: { table: 'audiences', label: 'Audience', read: 'email.read', write: 'email.write', ministryCol: 'ministry_id', category: 'email',
    fields: { name: F('text', { required: true }), description: F('text'), filters: F('json'), ministry_id: F('uuid') }, search: ['t.name'], order: 't.created_at DESC' },
  email_templates: { table: 'email_templates', label: 'Template', read: 'email.read', write: 'email.write', category: 'email',
    fields: { name: F('text', { required: true }), subject: F('text'), blocks: F('json') }, search: ['t.name'], order: 't.name' },
  journeys: { table: 'journeys', label: 'Journey', read: 'email.read', write: 'email.write', ministryCol: 'ministry_id', category: 'email',
    fields: { name: F('text', { required: true }), trigger: F('text', { required: true, enum: ['donor_created', 'first_gift', 'donor_lapsed', 'recurring_started', 'event_registration', 'campaign_gift'] }), mode: F('text', { enum: ['automatic', 'approval'] }), steps: F('json'), ministry_id: F('uuid') },
    select: `t.*, jsonb_array_length(t.steps) step_count, (SELECT count(*) FROM journey_enrollments e WHERE e.journey_id=t.id AND e.status IN ('waiting','awaiting_approval'))::int in_progress, (SELECT count(*) FROM journey_enrollments e WHERE e.journey_id=t.id AND e.status='awaiting_approval')::int awaiting_approval`,
    search: ['t.name'], order: 't.created_at DESC' },
  impact_metrics: { table: 'impact_metrics', label: 'Impact metric', read: 'impact.read', write: 'impact.write', ministryCol: 'ministry_id', category: 'impact',
    fields: { name: F('text', { required: true }), unit: F('text'), target: F('number'), period_start: F('date'), period_end: F('date'), project_id: F('uuid'), fund_id: F('uuid'), ministry_id: F('uuid') },
    select: `t.*, p.name project_name, f.name fund_name, m.name ministry_name, (SELECT coalesce(sum(value),0) FROM impact_entries e WHERE e.metric_id=t.id AND (t.period_start IS NULL OR e.entry_date >= t.period_start) AND (t.period_end IS NULL OR e.entry_date <= t.period_end))::float actual`,
    joins: 'LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN funds f ON f.id=t.fund_id LEFT JOIN ministries m ON m.id=t.ministry_id', search: ['t.name'], filters: ['project_id', 'ministry_id'], order: 't.name' },
  impact_entries: { table: 'impact_entries', label: 'Impact entry', read: 'impact.read', write: 'impact.write', category: 'impact',
    fields: { metric_id: F('uuid', { required: true }), value: F('number', { required: true }), entry_date: F('date'), notes: F('text') }, filters: ['metric_id'], order: 't.entry_date DESC' },
  impact_stories: { table: 'impact_stories', label: 'Impact story', read: 'impact.read', write: 'impact.write', ministryCol: 'ministry_id', category: 'impact',
    fields: { title: F('text', { required: true }), story: F('text', { required: true }), beneficiaries: F('int'), story_date: F('date'), project_id: F('uuid'), attachment_id: F('uuid'), shareable: F('bool'), ministry_id: F('uuid') },
    select: 't.*, p.name project_name, m.name ministry_name', joins: 'LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN ministries m ON m.id=t.ministry_id', search: ['t.title', 't.story'], filters: ['project_id', 'ministry_id'], order: 't.story_date DESC' },
  growth_goals: { table: 'growth_goals', label: 'Goal', read: 'reports.read', write: 'settings.manage', ministryCol: 'ministry_id', category: 'growth',
    fields: { name: F('text', { required: true }), metric: F('text', { required: true, enum: ['giving_total', 'new_donors', 'retention_rate', 'recurring_donors', 'major_donors'] }), target: F('number', { required: true }), period_start: F('date', { required: true }), period_end: F('date', { required: true }), ministry_id: F('uuid') },
    order: 't.period_end' },
  accounts: { table: 'accounts', label: 'Account', read: 'finance.read', write: 'finance.write', category: 'accounting', softDelete: 'archived',
    fields: { code: F('text', { required: true }), name: F('text', { required: true }), type: F('text', { required: true, enum: ['asset', 'liability', 'net_assets', 'revenue', 'expense'] }), subtype: F('text'), is_cash: F('bool'), description: F('text'), archived: F('bool') },
    select: `t.*, (SELECT coalesce(sum(jl.debit - jl.credit),0) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=t.id)::float debit_balance,
      (SELECT external_name FROM integration_mappings im WHERE im.entity_type='account' AND im.internal_id=t.id AND im.provider='quickbooks') qbo_name`,
    search: ['t.code', 't.name'], filters: ['type', 'archived'], order: 't.code' },
  funds: { table: 'funds', label: 'Fund', read: 'finance.read', write: 'finance.write', ministryCol: 'ministry_id', category: 'accounting', softDelete: 'archived',
    fields: { name: F('text', { required: true }), code: F('text'), restriction: F('text', { required: true, enum: ['unrestricted', 'purpose', 'time', 'permanent'] }), description: F('text'), revenue_account_id: F('uuid'), ministry_id: F('uuid'), archived: F('bool') },
    search: ['t.name', 't.code'], filters: ['restriction', 'archived'], order: 't.name' },
  bank_accounts: { table: 'bank_accounts', label: 'Bank account', read: 'finance.read', write: 'finance.write', category: 'accounting',
    fields: { name: F('text', { required: true }), account_id: F('uuid', { required: true }), provider: F('text'), last4: F('text') },
    select: `t.*, a.code||' '||a.name ledger_account, (SELECT count(*) FROM bank_transactions b WHERE b.bank_account_id=t.id AND b.status='unreviewed')::int unreviewed`,
    joins: 'LEFT JOIN accounts a ON a.id=t.account_id', order: 't.name' },
  asks: { table: 'asks', label: 'Ask', read: 'donors.read', write: 'donors.write', category: 'fundraising', ownerField: 'user_id',
    fields: { donor_id: F('uuid', { required: true }), amount: F('number', { required: true }), asked_on: F('date'), purpose: F('text'), status: F('text', { enum: ['open', 'accepted', 'declined', 'deferred'] }), notes: F('text') },
    select: 't.*, u.name user_name', joins: 'LEFT JOIN users u ON u.id=t.user_id', filters: ['donor_id', 'status'], order: 't.asked_on DESC' },
  recurring_gifts: { table: 'recurring_gifts', label: 'Recurring gift', read: 'donors.read', write: 'gifts.write', category: 'giving',
    fields: { donor_id: F('uuid', { required: true }), amount: F('number', { required: true }), frequency: F('text', { enum: ['weekly', 'monthly', 'quarterly', 'annually'] }), fund_id: F('uuid'), status: F('text', { enum: ['active', 'paused', 'cancelled', 'failed'] }), started_on: F('date'), next_date: F('date') },
    select: `t.*, ${DONOR_NAME_SQL('d')} donor_name, f.name fund_name`, joins: 'LEFT JOIN donors d ON d.id=t.donor_id LEFT JOIN funds f ON f.id=t.fund_id', filters: ['donor_id', 'status'], order: 't.created_at DESC' },
  gift_batches: { table: 'gift_batches', label: 'Gift batch', read: 'donors.read', write: 'gifts.write', category: 'giving', ownerField: 'created_by',
    fields: { name: F('text', { required: true }), status: F('text', { enum: ['open', 'closed'] }) },
    select: `t.*, (SELECT count(*) FROM gifts g WHERE g.batch_id=t.id)::int gift_count, (SELECT coalesce(sum(amount),0) FROM gifts g WHERE g.batch_id=t.id)::float total`, order: 't.created_at DESC' },
  drafts: { table: 'drafts', label: 'Draft', read: 'ai.ask', write: 'ai.ask', ministryCol: 'ministry_id', category: 'ai', ownerField: 'user_id',
    fields: { kind: F('text', { required: true }), title: F('text'), content: F('text', { required: true }), donor_id: F('uuid'), ministry_id: F('uuid'), status: F('text'), context: F('json') },
    select: `t.*, ${DONOR_NAME_SQL('d')} donor_name`, joins: 'LEFT JOIN donors d ON d.id=t.donor_id', search: ['t.title', 't.content'], filters: ['kind', 'donor_id'], order: 't.created_at DESC' },
  saved_filters: { table: 'saved_filters', label: 'Saved filter', read: 'donors.read', write: 'donors.read', category: 'settings', ownerField: 'user_id',
    fields: { scope: F('text', { required: true }), name: F('text', { required: true }), filters: F('json', { required: true }) }, filters: ['scope'], order: 't.name' },
};

function coerce(f: Field, v: unknown, name: string) {
  if (v === '' || v === undefined) return v === '' && f.type !== 'text' ? null : v;
  if (v === null) return null;
  switch (f.type) {
    case 'number': case 'int': {
      const n = Number(v); if (!Number.isFinite(n)) throw badRequest(`${name} must be a number.`);
      return f.type === 'int' ? Math.round(n) : n;
    }
    case 'bool': return v === true || v === 'true' || v === 1 || v === 'on';
    case 'date': if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw badRequest(`${name} must be a date (YYYY-MM-DD).`); return String(v).slice(0, 10);
    case 'datetime': if (Number.isNaN(Date.parse(String(v)))) throw badRequest(`${name} must be a date/time.`); return new Date(String(v)).toISOString();
    case 'uuid': if (!/^[0-9a-f-]{36}$/i.test(String(v))) throw badRequest(`${name} must be a valid id.`); return v;
    case 'text[]': return Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean);
    case 'json': return typeof v === 'string' ? JSON.parse(v) : v;
    default: {
      const s = String(v);
      if (f.enum && !f.enum.includes(s)) throw badRequest(`${name} must be one of: ${f.enum.join(', ')}.`);
      return s;
    }
  }
}

export function cleanBody(r: Resource, body: any, creating: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(r.fields)) {
    if (!(k in (body ?? {}))) { if (creating && f.required) throw badRequest(`${f.label ?? k.replace(/_/g, ' ')} is required.`); continue; }
    const v = coerce(f, body[k], f.label ?? k.replace(/_/g, ' '));
    if (f.required && (v === null || v === '')) throw badRequest(`${f.label ?? k.replace(/_/g, ' ')} is required.`);
    out[k] = v;
  }
  return out;
}

export function listQuery(r: Resource, req: Request) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (r.ministryCol) where.push(ministryScope(req.auth!, `t.${r.ministryCol}`, params));
  const q = String(req.query.q ?? '').trim();
  if (q && r.search?.length) { params.push(`%${q}%`); where.push(`(${r.search.map((c) => `${c}::text ILIKE $${params.length}`).join(' OR ')})`); }
  for (const f of r.filters ?? []) {
    const v = req.query[f];
    if (v === undefined || v === '') continue;
    if (v === 'null') { where.push(`t.${f} IS NULL`); continue; }
    params.push(Array.isArray(v) ? v : String(v));
    where.push(Array.isArray(v) ? `t.${f}::text = ANY($${params.length})` : `t.${f}::text = $${params.length}`);
  }
  if (r.softDelete && req.query.include_archived !== 'true' && !('archived' in req.query)) where.push(`NOT t.${r.softDelete}`);
  if (req.query.from && r.fields.entry_date) { params.push(req.query.from); where.push(`t.entry_date >= $${params.length}`); }
  if (req.query.to && r.fields.entry_date) { params.push(req.query.to); where.push(`t.entry_date <= $${params.length}`); }
  const sortable = new Set(Object.keys(r.fields).concat(['created_at']));
  const sortKey = String(req.query.sort ?? '');
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const order = sortable.has(sortKey) ? `t.${sortKey} ${dir} NULLS LAST` : (r.order ?? 't.created_at DESC');
  const sql = `SELECT ${r.select ?? 't.*'} FROM ${r.table} t ${r.joins ?? ''} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return { sql, params };
}

export const resourcesRouter = Router();

function getRes(name: string) { const r = RESOURCES[name]; if (!r) throw notFound('Resource type'); return r; }

resourcesRouter.get('/:res', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.read);
  const { sql, params } = listQuery(r, req);
  const limit = Math.min(Number(req.query.limit ?? 50), 500); const offset = Math.max(0, Number(req.query.offset ?? 0));
  const out = await tx(req, async (db) => {
    const total = await one(db, `SELECT count(*)::int n FROM (${sql}) x`, params);
    const rows = await many(db, `${sql} LIMIT ${limit} OFFSET ${offset}`, params);
    return { rows, total: total?.n ?? 0, limit, offset };
  });
  res.json(out);
}));

resourcesRouter.get('/:res/export', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.read, 'data.export');
  const { sql, params } = listQuery(r, req);
  const rows = await tx(req, async (db) => {
    const x = await many(db, `${sql} LIMIT 50000`, params);
    await audit(db, actor(req), 'export', 'export', `Exported ${x.length} ${r.label.toLowerCase()} records`, { type: r.table });
    return x;
  });
  const keys = rows[0] ? Object.keys(rows[0]).filter((k) => !['tenant_id'].includes(k)) : Object.keys(r.fields);
  await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `${r.table}-${new Date().toISOString().slice(0, 10)}`, keys.map((k) => ({ key: k, label: k })), rows);
}));

resourcesRouter.get('/:res/:id', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.read);
  const params: unknown[] = [req.params.id];
  const scope = r.ministryCol ? ministryScope(req.auth!, `t.${r.ministryCol}`, params) : 'TRUE';
  const row = await tx(req, (db) => one(db, `SELECT ${r.select ?? 't.*'} FROM ${r.table} t ${r.joins ?? ''} WHERE t.id=$1 AND ${scope}`, params));
  if (!row) throw notFound(r.label);
  res.json(row);
}));

resourcesRouter.post('/:res', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.write);
  const data = cleanBody(r, req.body, true);
  if (r.ministryCol) assertMinistry(req.auth!, data[r.ministryCol] as string);
  if (r.ownerField && !data[r.ownerField]) data[r.ownerField] = req.auth!.userId;
  if (r.table === 'events' && !data.slug) data.slug = `${String(data.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
  const row = await tx(req, async (db) => {
    const cols = ['tenant_id', ...Object.keys(data)];
    const vals = [req.auth!.tenantId, ...Object.values(data)];
    const inserted = await one(db, `INSERT INTO ${r.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
    await r.afterWrite?.(db, req, inserted);
    await audit(db, actor(req), r.category, 'create', `Created ${r.label.toLowerCase()} “${inserted.name ?? inserted.title ?? inserted.id.slice(0, 8)}”`, { type: r.table, id: inserted.id });
    return inserted;
  });
  res.status(201).json(row);
}));

resourcesRouter.patch('/:res/:id', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.write);
  const data = cleanBody(r, req.body, false);
  if (!Object.keys(data).length) throw badRequest('Nothing to update.');
  if (r.ministryCol && data[r.ministryCol]) assertMinistry(req.auth!, data[r.ministryCol] as string);
  const row = await tx(req, async (db) => {
    const p: unknown[] = [req.params.id];
    const scope = r.ministryCol ? ministryScope(req.auth!, r.ministryCol, p) : 'TRUE';
    const sets = Object.keys(data).map((k) => { p.push(data[k]); return `${k}=$${p.length}`; });
    const updated = await one(db, `UPDATE ${r.table} SET ${sets.join(',')} WHERE id=$1 AND ${scope} RETURNING *`, p);
    if (!updated) throw notFound(r.label);
    await r.afterWrite?.(db, req, updated);
    await audit(db, actor(req), r.category, 'update', `Updated ${r.label.toLowerCase()} “${updated.name ?? updated.title ?? updated.id.slice(0, 8)}”`, { type: r.table, id: updated.id }, { fields: Object.keys(data) });
    return updated;
  });
  res.json(row);
}));

resourcesRouter.delete('/:res/:id', h(async (req, res) => {
  const r = getRes(String(req.params.res)); requirePerm(req.auth, r.write);
  await tx(req, async (db) => {
    const p: unknown[] = [req.params.id];
    const scope = r.ministryCol ? ministryScope(req.auth!, r.ministryCol, p) : 'TRUE';
    const row = r.softDelete
      ? await one(db, `UPDATE ${r.table} SET ${r.softDelete}=true WHERE id=$1 AND ${scope} RETURNING *`, p)
      : await one(db, `DELETE FROM ${r.table} WHERE id=$1 AND ${scope} RETURNING *`, p);
    if (!row) throw notFound(r.label);
    await audit(db, actor(req), r.category, r.softDelete ? 'archive' : 'delete', `${r.softDelete ? 'Archived' : 'Deleted'} ${r.label.toLowerCase()} “${row.name ?? row.title ?? row.id.slice(0, 8)}”`, { type: r.table, id: row.id });
  });
  res.json({ ok: true });
}));
