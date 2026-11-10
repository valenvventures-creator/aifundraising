import type { Db } from '../db/pool.js';
import { one, many } from '../db/pool.js';
import { badRequest, conflict } from '../lib/errors.js';
import { round2 } from '../lib/util.js';

export interface LineInput {
  account_id: string;
  fund_id: string;
  project_id?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
}
export interface EntryInput {
  entry_date: string;
  memo?: string | null;
  reference?: string | null;
  ministry_id?: string | null;
  source?: string;
  source_id?: string | null;
  status?: 'draft' | 'pending_approval' | 'posted';
  lines: LineInput[];
}

/**
 * Validates double-entry rules plus the fund-accounting rule that every fund
 * self-balances (debits = credits within each fund), so fund balances are
 * always traceable to ledger lines.
 */
export function validateLines(lines: LineInput[]) {
  if (lines.length < 2) throw badRequest('A journal entry needs at least two lines.');
  let d = 0, c = 0;
  const perFund = new Map<string, number>();
  lines.forEach((l, i) => {
    const debit = round2(l.debit ?? 0), credit = round2(l.credit ?? 0);
    if (debit < 0 || credit < 0) throw badRequest(`Line ${i + 1}: amounts cannot be negative.`);
    if ((debit > 0) === (credit > 0)) throw badRequest(`Line ${i + 1}: enter either a debit or a credit (not both, not neither).`);
    if (!l.account_id) throw badRequest(`Line ${i + 1}: choose an account.`);
    if (!l.fund_id) throw badRequest(`Line ${i + 1}: choose a fund — every dollar must belong to a fund.`);
    d += debit; c += credit;
    perFund.set(l.fund_id, round2((perFund.get(l.fund_id) ?? 0) + debit - credit));
  });
  if (round2(d) !== round2(c)) throw badRequest(`Debits (${round2(d).toFixed(2)}) must equal credits (${round2(c).toFixed(2)}).`);
  for (const [fund, diff] of perFund) {
    if (diff !== 0) throw badRequest(`Each fund must balance on its own. Fund ${fund.slice(0, 8)}… is off by ${diff.toFixed(2)}. Use an interfund transfer (net assets) line to move money between funds.`);
  }
}

export async function createEntry(db: Db, tenantId: string, userId: string | null, e: EntryInput) {
  validateLines(e.lines);
  // Make sure every account/fund belongs to this tenant (RLS already guarantees, but give clear errors).
  const accIds = [...new Set(e.lines.map((l) => l.account_id))];
  const fundIds = [...new Set(e.lines.map((l) => l.fund_id))];
  const accs = await many(db, `SELECT id, archived FROM accounts WHERE id = ANY($1::uuid[])`, [accIds]);
  if (accs.length !== accIds.length) throw badRequest('One or more accounts were not found.');
  if (accs.some((a) => a.archived)) throw badRequest('One or more accounts are archived.');
  const funds = await many(db, `SELECT id FROM funds WHERE id = ANY($1::uuid[])`, [fundIds]);
  if (funds.length !== fundIds.length) throw badRequest('One or more funds were not found.');

  const status = e.status ?? 'posted';
  const entry = await one(db,
    `INSERT INTO journal_entries(tenant_id, ministry_id, entry_date, memo, reference, source, source_id, status, created_by, posted_at, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $8='posted' THEN now() END, CASE WHEN $8='posted' THEN $9::uuid END) RETURNING *`,
    [tenantId, e.ministry_id ?? null, e.entry_date, e.memo ?? null, e.reference ?? null, e.source ?? 'manual', e.source_id ?? null, status, userId]);
  for (const l of e.lines) {
    await db.query(
      `INSERT INTO journal_lines(tenant_id, entry_id, account_id, fund_id, project_id, debit, credit, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, entry.id, l.account_id, l.fund_id, l.project_id ?? null, round2(l.debit ?? 0), round2(l.credit ?? 0), l.description ?? null]);
  }
  if (e.source === 'manual' || !e.source) {
    await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'qbo.push',$2)`, [tenantId, { entity: 'journal', id: entry.id }]);
  }
  return entry;
}

export async function voidEntry(db: Db, entryId: string) {
  const e = await one(db, `SELECT * FROM journal_entries WHERE id=$1 FOR UPDATE`, [entryId]);
  if (!e) throw badRequest('Entry not found.');
  if (e.status === 'void') throw conflict('This entry is already void.');
  await db.query(`UPDATE journal_entries SET status='void' WHERE id=$1`, [entryId]);
}

export async function accountByCode(db: Db, code: string) {
  const a = await one(db, `SELECT id FROM accounts WHERE code=$1`, [code]);
  if (!a) throw badRequest(`Account ${code} is missing from the chart of accounts. Add it under Money › Chart of Accounts.`);
  return a.id as string;
}

export async function generalFundId(db: Db) {
  const f = await one(db, `SELECT id FROM funds WHERE restriction='unrestricted' AND NOT archived ORDER BY created_at LIMIT 1`);
  if (!f) throw badRequest('Create an unrestricted (General) fund first.');
  return f.id as string;
}

/** Post a gift to the ledger: Dr deposit (undeposited funds by default), Cr contribution revenue — both in the gift's fund. */
export async function postGift(db: Db, tenantId: string, userId: string | null, giftId: string) {
  const g = await one(db, `SELECT g.*, d.donor_type, f.revenue_account_id FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN funds f ON f.id=g.fund_id WHERE g.id=$1`, [giftId]);
  if (!g) throw badRequest('Gift not found.');
  const deposit = g.deposit_account_id ?? await accountByCode(db, '1050');
  const revenue = g.revenue_account_id ?? await accountByCode(db, g.gift_type === 'grant' ? '4100' : (['individual', 'household'].includes(g.donor_type) ? '4000' : '4010'));
  const entry = await createEntry(db, tenantId, userId, {
    entry_date: g.gift_date, memo: `Gift ${g.provider ? `(${g.provider}) ` : ''}— ${g.payment_method}`, ministry_id: g.ministry_id,
    source: 'gift', source_id: g.id,
    lines: [
      { account_id: deposit, fund_id: g.fund_id, project_id: g.project_id, debit: g.amount, description: 'Gift deposit' },
      { account_id: revenue, fund_id: g.fund_id, project_id: g.project_id, credit: g.amount, description: 'Contribution revenue' },
    ],
  });
  await db.query(`UPDATE gifts SET journal_entry_id=$2 WHERE id=$1`, [giftId, entry.id]);
  await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'qbo.push',$2)`, [tenantId, { entity: 'gift', id: giftId }]);
  return entry;
}

/** Re-post a gift after an edit: void the old entry and post a fresh one so history is preserved. */
export async function repostGift(db: Db, tenantId: string, userId: string | null, giftId: string) {
  const g = await one(db, `SELECT journal_entry_id FROM gifts WHERE id=$1`, [giftId]);
  if (g?.journal_entry_id) await voidEntry(db, g.journal_entry_id);
  return postGift(db, tenantId, userId, giftId);
}

export async function postRefund(db: Db, tenantId: string, userId: string | null, giftId: string, amount?: number) {
  const g = await one(db, `SELECT * FROM gifts WHERE id=$1`, [giftId]);
  if (!g?.journal_entry_id) throw badRequest('Gift has no ledger entry to reverse.');
  const lines = await many(db, `SELECT * FROM journal_lines WHERE entry_id=$1`, [g.journal_entry_id]);
  const ratio = amount ? Math.min(1, amount / g.amount) : 1;
  const entry = await createEntry(db, tenantId, userId, {
    entry_date: new Date().toISOString().slice(0, 10), memo: `Refund of gift ${giftId.slice(0, 8)}`, source: 'refund', source_id: giftId,
    ministry_id: g.ministry_id,
    lines: lines.map((l) => ({ account_id: l.account_id, fund_id: l.fund_id, project_id: l.project_id,
      debit: round2(l.credit * ratio), credit: round2(l.debit * ratio), description: 'Refund reversal' })),
  });
  if (ratio === 1) await db.query(`UPDATE gifts SET refunded=true WHERE id=$1`, [giftId]);
  return entry;
}

export async function restrictedOverdraftCheck(db: Db, fundId: string, amount: number) {
  const f = await one(db, `SELECT name, restriction FROM funds WHERE id=$1`, [fundId]);
  if (!f || f.restriction === 'unrestricted') return null;
  const bal = await fundBalance(db, fundId);
  if (bal - amount < 0) {
    return `“${f.name}” is a ${f.restriction === 'permanent' ? 'permanently restricted' : 'donor-restricted'} fund with ${bal.toFixed(2)} available; this spend of ${amount.toFixed(2)} would overdraw it.`;
  }
  return null;
}

export async function postExpense(db: Db, tenantId: string, userId: string | null, expenseId: string) {
  const x = await one(db, `SELECT * FROM expenses WHERE id=$1`, [expenseId]);
  const entry = await createEntry(db, tenantId, userId, {
    entry_date: x.expense_date, memo: `Expense — ${x.vendor}`, ministry_id: x.ministry_id, source: 'expense', source_id: x.id,
    lines: [
      { account_id: x.account_id, fund_id: x.fund_id, project_id: x.project_id, debit: x.amount, description: x.notes ?? x.vendor },
      { account_id: x.payment_account_id, fund_id: x.fund_id, project_id: x.project_id, credit: x.amount, description: `Paid to ${x.vendor}` },
    ],
  });
  await db.query(`UPDATE expenses SET journal_entry_id=$2 WHERE id=$1`, [expenseId, entry.id]);
  await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'qbo.push',$2)`, [tenantId, { entity: 'expense', id: expenseId }]);
  return entry;
}

export async function postPayroll(db: Db, tenantId: string, userId: string | null, payrollId: string) {
  const p = await one(db, `SELECT * FROM payroll_entries WHERE id=$1`, [payrollId]);
  const cash = await accountByCode(db, '1000');
  const lines: LineInput[] = [{ account_id: p.account_id, fund_id: p.fund_id, debit: p.gross, description: `Wages — ${p.staff_name}` }];
  if (p.employer_taxes > 0) lines.push({ account_id: await accountByCode(db, '5010'), fund_id: p.fund_id, debit: p.employer_taxes, description: 'Employer payroll taxes' });
  if (p.benefits > 0) lines.push({ account_id: await accountByCode(db, '5020'), fund_id: p.fund_id, debit: p.benefits, description: 'Benefits' });
  lines.push({ account_id: cash, fund_id: p.fund_id, credit: round2(p.gross + p.employer_taxes + p.benefits), description: 'Payroll disbursement' });
  const entry = await createEntry(db, tenantId, userId, { entry_date: p.pay_date, memo: `Payroll — ${p.staff_name}`, ministry_id: p.ministry_id, source: 'payroll', source_id: p.id, lines });
  await db.query(`UPDATE payroll_entries SET journal_entry_id=$2 WHERE id=$1`, [payrollId, entry.id]);
  return entry;
}

export async function fundBalance(db: Db, fundId: string, asOf?: string) {
  const r = await one(db, `
    SELECT coalesce(sum(CASE WHEN a.type IN ('revenue','net_assets','liability') THEN jl.credit - jl.debit
                             WHEN a.type = 'expense' THEN -(jl.debit - jl.credit) ELSE 0 END),0) AS net,
           coalesce(sum(CASE WHEN a.type IN ('revenue','net_assets') THEN jl.credit - jl.debit
                             WHEN a.type = 'expense' THEN -(jl.debit - jl.credit) ELSE 0 END),0) AS net_assets
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted'
      JOIN accounts a ON a.id=jl.account_id
     WHERE jl.fund_id=$1 AND ($2::date IS NULL OR je.entry_date <= $2::date)`, [fundId, asOf ?? null]);
  return Number(r?.net_assets ?? 0);
}

/** Fund ledger summary: balance = net assets attributable to the fund (revenue − expense + opening/transfers). */
export async function fundSummaries(db: Db, from?: string, to?: string) {
  return many(db, `
    SELECT f.id, f.name, f.code, f.restriction, f.description, f.ministry_id, f.archived,
      coalesce(sum(CASE WHEN a.type IN ('revenue','net_assets') THEN jl.credit - jl.debit
                        WHEN a.type='expense' THEN jl.credit - jl.debit ELSE 0 END),0)::float AS balance,
      coalesce(sum(CASE WHEN a.type='revenue' AND je.entry_date BETWEEN coalesce($1::date,'1900-01-01') AND coalesce($2::date,'2999-12-31') THEN jl.credit - jl.debit ELSE 0 END),0)::float AS period_income,
      coalesce(sum(CASE WHEN a.type='expense' AND je.entry_date BETWEEN coalesce($1::date,'1900-01-01') AND coalesce($2::date,'2999-12-31') THEN jl.debit - jl.credit ELSE 0 END),0)::float AS period_expense,
      count(DISTINCT je.id)::int AS entry_count
    FROM funds f
    LEFT JOIN journal_lines jl ON jl.fund_id=f.id
    LEFT JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted'
    LEFT JOIN accounts a ON a.id=jl.account_id AND je.id IS NOT NULL
    GROUP BY f.id ORDER BY f.restriction, f.name`, [from ?? null, to ?? null]);
}
