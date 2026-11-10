import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import { SYSTEM_ROLES } from '../lib/permissions.js';

export const DEFAULT_ACCOUNTS: [string, string, string, string?, boolean?][] = [
  ['1000', 'Operating Checking', 'asset', 'bank', true],
  ['1010', 'Savings', 'asset', 'bank', true],
  ['1050', 'Undeposited Funds', 'asset', 'undeposited', true],
  ['1100', 'Accounts Receivable', 'asset', 'receivable'],
  ['1200', 'Pledges Receivable', 'asset', 'receivable'],
  ['1500', 'Furniture & Equipment', 'asset', 'fixed'],
  ['2000', 'Accounts Payable', 'liability', 'payable'],
  ['2100', 'Payroll Liabilities', 'liability', 'payroll'],
  ['2200', 'Credit Card Payable', 'liability', 'credit_card'],
  ['3000', 'Net Assets Without Donor Restrictions', 'net_assets', 'unrestricted'],
  ['3100', 'Net Assets With Donor Restrictions', 'net_assets', 'restricted'],
  ['3900', 'Interfund Transfers', 'net_assets', 'transfer'],
  ['4000', 'Contributions — Individuals', 'revenue', 'contributions'],
  ['4010', 'Contributions — Organizations & Foundations', 'revenue', 'contributions'],
  ['4100', 'Grant Revenue', 'revenue', 'grants'],
  ['4200', 'Event Revenue', 'revenue', 'events'],
  ['4300', 'Program Service Fees', 'revenue', 'program'],
  ['4400', 'Consulting & Service Revenue', 'revenue', 'services'],
  ['4900', 'Other Income', 'revenue', 'other'],
  ['5000', 'Salaries & Wages', 'expense', 'personnel'],
  ['5010', 'Payroll Taxes', 'expense', 'personnel'],
  ['5020', 'Employee Benefits', 'expense', 'personnel'],
  ['5100', 'Rent & Occupancy', 'expense', 'occupancy'],
  ['5200', 'Program Supplies', 'expense', 'program'],
  ['5300', 'Missions & Outreach', 'expense', 'program'],
  ['5400', 'Travel', 'expense', 'travel'],
  ['5500', 'Marketing & Communications', 'expense', 'fundraising'],
  ['5600', 'Technology & Software', 'expense', 'admin'],
  ['5700', 'Professional Fees', 'expense', 'admin'],
  ['5800', 'Payment Processing Fees', 'expense', 'fundraising'],
  ['5900', 'Office & Administrative', 'expense', 'admin'],
  ['5950', 'Benevolence Assistance', 'expense', 'program'],
];

export const DEFAULT_FUNDS: [string, string, string][] = [
  ['General', 'GEN', 'unrestricted'],
  ['Building', 'BLD', 'purpose'],
  ['Missions', 'MIS', 'purpose'],
  ['Benevolence', 'BEN', 'purpose'],
  ['Youth', 'YTH', 'purpose'],
  ['Scholarships', 'SCH', 'purpose'],
  ['Staff Support', 'STF', 'purpose'],
  ['Endowment', 'END', 'permanent'],
];

export const AUTOMATIONS = [
  ['donor_health', 'Recalculate donor health and opportunity scores nightly'],
  ['receipt_queue', 'Flag gifts that still need receipts and thank-yous'],
  ['grant_reminders', 'Notify owners 14 / 7 / 1 days before grant deadlines and report due dates'],
  ['task_reminders', 'Notify assignees of overdue tasks'],
  ['journeys', 'Advance active email journeys (approval-mode steps wait for a person)'],
  ['scheduled_email', 'Send email campaigns at their scheduled time'],
  ['integration_sync', 'Push queued records to QuickBooks and pull payment provider data'],
  ['budget_alerts', 'Alert finance users when a budget line exceeds 90% of plan'],
] as const;

/** Create a tenant with system roles, default chart of accounts, funds, automations and a first workspace. */
export async function bootstrapTenant(db: Db, opts: { name: string; ownerUserId: string; workspaceTerm?: string; workspaceTermPlural?: string;
  currency?: string; country?: string; faithBased?: boolean; firstWorkspace?: string }) {
  await db.query(`SELECT set_config('app.bypass_rls','on',true)`);
  const t = await one(db, `INSERT INTO tenants(name, legal_name, workspace_term, workspace_term_plural, currency, country, faith_based, tax_jurisdiction)
    VALUES ($1,$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [opts.name, opts.workspaceTerm ?? 'Ministry', opts.workspaceTermPlural ?? 'Ministries', opts.currency ?? 'USD', opts.country ?? 'US',
     opts.faithBased ?? true, (opts.country ?? 'US') === 'CA' ? 'CA-CRA' : 'US-IRS']);
  await db.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.id]);
  let adminRoleId = '';
  for (const r of SYSTEM_ROLES) {
    const row = await one(db, `INSERT INTO roles(tenant_id,name,description,permissions,is_system) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [t.id, r.name, r.description, r.permissions]);
    if (r.name === 'Organization Admin') adminRoleId = row.id;
  }
  await db.query(`INSERT INTO memberships(tenant_id,user_id,role_id,status,all_ministries) VALUES ($1,$2,$3,'active',true)`, [t.id, opts.ownerUserId, adminRoleId]);
  const accIds: Record<string, string> = {};
  for (const [code, name, type, subtype, isCash] of DEFAULT_ACCOUNTS) {
    const a = await one(db, `INSERT INTO accounts(tenant_id,code,name,type,subtype,is_cash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [t.id, code, name, type, subtype ?? null, Boolean(isCash)]);
    accIds[code] = a.id;
  }
  for (const [name, code, restriction] of DEFAULT_FUNDS) {
    await db.query(`INSERT INTO funds(tenant_id,name,code,restriction) VALUES ($1,$2,$3,$4)`, [t.id, name, code, restriction]);
  }
  for (const [key] of AUTOMATIONS) await db.query(`INSERT INTO automations(tenant_id,key,enabled) VALUES ($1,$2,true)`, [t.id, key]);
  await db.query(`INSERT INTO rate_types(tenant_id,name,hourly_rate) VALUES ($1,'Marketing & Design',95),($1,'Web & Technology',125),($1,'Executive/Strategy',175)`, [t.id]);
  await db.query(`INSERT INTO bank_accounts(tenant_id,name,account_id,provider) VALUES ($1,'Operating Checking',$2,'manual')`, [t.id, accIds['1000']]);
  const ws = await one(db, `INSERT INTO ministries(tenant_id,name) VALUES ($1,$2) RETURNING id`, [t.id, opts.firstWorkspace ?? opts.name]);
  await db.query(`INSERT INTO voice_profiles(tenant_id, ministry_id, tone, faith_enabled) VALUES ($1,$2,'Warm, grateful and hopeful',$3)`, [t.id, ws.id, opts.faithBased ?? true]);
  const conv = await one(db, `INSERT INTO conversations(tenant_id,name,is_channel,created_by) VALUES ($1,'general',true,$2) RETURNING id`, [t.id, opts.ownerUserId]);
  await db.query(`INSERT INTO conversation_members(tenant_id,conversation_id,user_id) VALUES ($1,$2,$3)`, [t.id, conv.id, opts.ownerUserId]);
  return t;
}
