import { Router, type Request } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, actor, assertMinistry, ministryScope } from '../lib/auth.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, type Db } from '../db/pool.js';
import { createEntry, voidEntry, postExpense, postPayroll, fundSummaries, restrictedOverdraftCheck, accountByCode, generalFundId } from '../services/ledger.js';
import { renderPdf } from '../services/pdf.js';
import { sendTable } from '../services/exporter.js';
import { fmtMoney, fmtMoney2, round2, today, addDays, DONOR_NAME_SQL } from '../lib/util.js';
import { config } from '../config.js';
import { requireTransport } from '../services/email.js';
import { generateText } from '../services/ai.js';

export const moneyRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export async function saveAttachment(db: Db, req: Request, file: Express.Multer.File, entityType: string, entityId: string | null) {
  const allowed = /^(image\/(png|jpe?g|webp|heic|gif)|application\/pdf|text\/(plain|csv)|message\/rfc822|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-outlook))$/;
  if (!allowed.test(file.mimetype)) throw badRequest(`File type ${file.mimetype} is not allowed.`);
  const key = path.join(req.auth!.tenantId, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 8)}`);
  const full = path.join(config.storageDir, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, file.buffer);
  return one(db, `INSERT INTO attachments(tenant_id, entity_type, entity_id, filename, mime, size, storage_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime, size`,
    [req.auth!.tenantId, entityType, entityId, file.originalname.slice(0, 200), file.mimetype, file.size, key, req.auth!.userId]);
}

// ───────── Overview ─────────
moneyRouter.get('/overview', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const from = String(req.query.from ?? `${new Date().getFullYear()}-01-01`), to = String(req.query.to ?? today());
  const out = await tx(req, async (db) => {
    const totals = await one(db, `SELECT
        coalesce(sum(jl.credit - jl.debit) FILTER (WHERE a.type='revenue'),0)::float income,
        coalesce(sum(jl.debit - jl.credit) FILTER (WHERE a.type='expense'),0)::float expenses
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id
      WHERE je.entry_date BETWEEN $1 AND $2`, [from, to]);
    const cash = await one(db, `SELECT coalesce(sum(jl.debit - jl.credit),0)::float cash FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id WHERE a.is_cash`);
    const funds = await fundSummaries(db, from, to);
    const monthly = await many(db, `SELECT to_char(je.entry_date,'YYYY-MM') AS month,
        coalesce(sum(jl.credit - jl.debit) FILTER (WHERE a.type='revenue'),0)::float income, coalesce(sum(jl.debit - jl.credit) FILTER (WHERE a.type='expense'),0)::float expenses
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id
      WHERE je.entry_date > current_date - interval '12 months' GROUP BY 1 ORDER BY 1`);
    const recent = await many(db, `SELECT je.id, je.entry_date, je.memo, je.source, je.status, (SELECT sum(debit) FROM journal_lines WHERE entry_id=je.id)::float amount FROM journal_entries je ORDER BY je.entry_date DESC, je.created_at DESC LIMIT 10`);
    const bank = await one(db, `SELECT count(*) FILTER (WHERE status='unreviewed')::int unreviewed, count(*) FILTER (WHERE NOT reconciled AND status='posted')::int unreconciled FROM bank_transactions`);
    const alerts: { level: string; text: string; link: string }[] = [];
    for (const f of funds) if (f.restriction !== 'unrestricted' && f.balance < 0) alerts.push({ level: 'error', text: `Restricted fund “${f.name}” is overdrawn (${f.balance.toFixed(2)}).`, link: `/money/accounting/funds/${f.id}` });
    if (bank!.unreviewed) alerts.push({ level: 'warn', text: `${bank!.unreviewed} bank transactions need review.`, link: '/money/accounting/bank' });
    const pending = await one(db, `SELECT count(*)::int n FROM journal_entries WHERE status='pending_approval'`);
    if (pending!.n) alerts.push({ level: 'warn', text: `${pending!.n} journal entries await approval.`, link: '/money/accounting/journals' });
    const sync = await one(db, `SELECT count(*) FILTER (WHERE status='error')::int errors, count(*) FILTER (WHERE status='conflict')::int conflicts FROM sync_records`);
    if (sync!.errors || sync!.conflicts) alerts.push({ level: 'error', text: `QuickBooks sync: ${sync!.errors} errors, ${sync!.conflicts} conflicts.`, link: '/money/accounting/sync' });
    const unposted = await one(db, `SELECT count(*)::int n FROM payment_transactions WHERE status='unmatched'`);
    if (unposted!.n) alerts.push({ level: 'warn', text: `${unposted!.n} online payments could not be matched to a donor.`, link: '/money/accounting/integrations' });
    return { from, to, income: totals!.income, expenses: totals!.expenses, change: round2(totals!.income - totals!.expenses), cash: cash!.cash, funds, monthly, recent, alerts,
      restrictedTotal: round2(funds.filter((f) => f.restriction !== 'unrestricted').reduce((a, f) => a + f.balance, 0)),
      unrestrictedTotal: round2(funds.filter((f) => f.restriction === 'unrestricted').reduce((a, f) => a + f.balance, 0)) };
  });
  res.json(out);
}));

// ───────── Transactions / journals ─────────
moneyRouter.get('/journals', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const p: unknown[] = []; const w: string[] = ['TRUE'];
  const qv = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
  if (qv('from')) { p.push(qv('from')); w.push(`je.entry_date >= $${p.length}`); }
  if (qv('to')) { p.push(qv('to')); w.push(`je.entry_date <= $${p.length}`); }
  if (qv('status')) { p.push(qv('status')); w.push(`je.status = $${p.length}`); }
  if (qv('source')) { p.push(qv('source')); w.push(`je.source = $${p.length}`); }
  if (qv('fund_id')) { p.push(qv('fund_id')); w.push(`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id=je.id AND x.fund_id=$${p.length})`); }
  if (qv('account_id')) { p.push(qv('account_id')); w.push(`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id=je.id AND x.account_id=$${p.length})`); }
  if (qv('project_id')) { p.push(qv('project_id')); w.push(`EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id=je.id AND x.project_id=$${p.length})`); }
  if (qv('q')) { p.push(`%${qv('q')}%`); w.push(`(je.memo ILIKE $${p.length} OR je.reference ILIKE $${p.length} OR EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id=je.id AND (x.debit::text LIKE $${p.length} OR x.credit::text LIKE $${p.length} OR x.description ILIKE $${p.length})))`); }
  const limit = Math.min(Number(req.query.limit ?? 50), 500), offset = Number(req.query.offset ?? 0);
  const out = await tx(req, async (db) => {
    const rows = await many(db, `SELECT je.*, u.name created_by_name, a2.name approved_by_name,
        (SELECT sum(debit) FROM journal_lines WHERE entry_id=je.id)::float amount,
        (SELECT json_agg(json_build_object('id',jl.id,'account_id',jl.account_id,'account',a.code||' '||a.name,'fund_id',jl.fund_id,'fund',f.name,'restriction',f.restriction,'project_id',jl.project_id,'debit',jl.debit,'credit',jl.credit,'description',jl.description) ORDER BY jl.debit DESC)
           FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id WHERE jl.entry_id=je.id) lines,
        (SELECT count(*) FROM attachments at WHERE at.entity_type='journal' AND at.entity_id=je.id)::int attachments
      FROM journal_entries je LEFT JOIN users u ON u.id=je.created_by LEFT JOIN users a2 ON a2.id=je.approved_by
      WHERE ${w.join(' AND ')} ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ${limit} OFFSET ${offset}`, p);
    const total = await one(db, `SELECT count(*)::int n FROM journal_entries je WHERE ${w.join(' AND ')}`, p);
    return { rows, total: total!.n, limit, offset };
  });
  res.json(out);
}));

const lineSchema = z.object({ account_id: z.string().uuid(), fund_id: z.string().uuid(), project_id: z.string().uuid().nullish(), debit: z.coerce.number().min(0).default(0), credit: z.coerce.number().min(0).default(0), description: z.string().nullish() });
const journalSchema = z.object({ entry_date: z.string(), memo: z.string().min(1, 'Description is required'), reference: z.string().nullish(), ministry_id: z.string().uuid().nullish(), lines: z.array(lineSchema).min(2), submit: z.enum(['draft', 'post', 'approval']).default('post') });

moneyRouter.post('/journals', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(journalSchema, req.body);
  assertMinistry(req.auth!, b.ministry_id);
  const t = await tx(req, (db) => one(db, `SELECT receipt_settings FROM tenants WHERE id=$1`, [req.auth!.tenantId]));
  const requireApproval = Boolean(t.receipt_settings?.journalApprovalRequired);
  let status: 'draft' | 'pending_approval' | 'posted' = b.submit === 'draft' ? 'draft' : b.submit === 'approval' ? 'pending_approval' : 'posted';
  if (status === 'posted' && (requireApproval || !req.auth!.permissions.has('finance.approve'))) status = 'pending_approval';
  const e = await tx(req, async (db) => {
    const entry = await createEntry(db, req.auth!.tenantId, req.auth!.userId, { ...b, status, source: 'manual' });
    await audit(db, actor(req), 'accounting', 'journal_create', `Created journal entry “${b.memo}” (${status})`, { type: 'journal', id: entry.id }, { lines: b.lines });
    return entry;
  });
  res.status(201).json(e);
}));

moneyRouter.post('/journals/:id/approve', h(async (req, res) => {
  requirePerm(req.auth, 'finance.approve');
  await tx(req, async (db) => {
    const e = await one(db, `SELECT * FROM journal_entries WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!e) throw notFound('Journal entry');
    if (!['draft', 'pending_approval'].includes(e.status)) throw conflict(`This entry is ${e.status}.`);
    if (e.created_by === req.auth!.userId && e.status === 'pending_approval') {
      const others = await one(db, `SELECT count(*)::int n FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.status='active' AND 'finance.approve' = ANY(r.permissions) AND m.user_id<>$1`, [req.auth!.userId]);
      if (others!.n > 0) throw conflict('Another approver must approve entries you created (separation of duties).');
    }
    await db.query(`UPDATE journal_entries SET status='posted', approved_by=$2, posted_at=now() WHERE id=$1`, [e.id, req.auth!.userId]);
    await audit(db, actor(req), 'accounting', 'journal_approve', `Approved and posted journal “${e.memo}”`, { type: 'journal', id: e.id });
  });
  res.json({ ok: true });
}));

moneyRouter.post('/journals/:id/void', h(async (req, res) => {
  requirePerm(req.auth, 'finance.approve');
  const { reason } = parse(z.object({ reason: z.string().min(3, 'Give a reason for voiding') }), req.body);
  await tx(req, async (db) => {
    const e = await one(db, `SELECT * FROM journal_entries WHERE id=$1`, [req.params.id]);
    if (!e) throw notFound('Journal entry');
    if (e.source === 'gift') throw badRequest('This entry belongs to a gift. Edit, refund or delete the gift instead so donor records stay accurate.');
    await voidEntry(db, e.id);
    await audit(db, actor(req), 'accounting', 'journal_void', `Voided journal “${e.memo}”: ${reason}`, { type: 'journal', id: e.id });
  });
  res.json({ ok: true });
}));

moneyRouter.post('/journals/:id/attachments', upload.single('file'), h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  if (!req.file) throw badRequest('Choose a file.');
  res.status(201).json(await tx(req, async (db) => {
    if (!(await one(db, `SELECT 1 FROM journal_entries WHERE id=$1`, [req.params.id]))) throw notFound('Journal entry');
    return saveAttachment(db, req, req.file!, 'journal', String(req.params.id));
  }));
}));

// ───────── Funds ─────────
moneyRouter.get('/funds', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => fundSummaries(db, req.query.from as string | undefined, req.query.to as string | undefined)));
}));

moneyRouter.get('/funds/:id/ledger', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const out = await tx(req, async (db) => {
    const fund = await one(db, `SELECT * FROM funds WHERE id=$1`, [req.params.id]);
    if (!fund) throw notFound('Fund');
    const lines = await many(db, `SELECT jl.*, je.entry_date, je.memo, je.source, je.source_id, a.code, a.name account_name, a.type account_type, p.name project_name
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id LEFT JOIN projects p ON p.id=jl.project_id
      WHERE jl.fund_id=$1 AND a.type IN ('revenue','expense','net_assets') ORDER BY je.entry_date, je.created_at`, [fund.id]);
    let bal = 0;
    const rows = lines.map((l) => { const delta = round2(Number(l.credit) - Number(l.debit)); bal = round2(bal + delta); return { ...l, change: delta, balance: bal }; });
    return { fund, rows: rows.reverse(), balance: bal };
  });
  res.json(out);
}));

/** Interfund transfer / release from restriction — balanced per fund via net-asset transfer account. */
moneyRouter.post('/funds/transfer', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write', 'finance.approve');
  const b = parse(z.object({ from_fund_id: z.string().uuid(), to_fund_id: z.string().uuid(), amount: z.number().positive(), date: z.string(), memo: z.string().min(3) }), req.body);
  if (b.from_fund_id === b.to_fund_id) throw badRequest('Choose two different funds.');
  const e = await tx(req, async (db) => {
    const from = await one(db, `SELECT * FROM funds WHERE id=$1`, [b.from_fund_id]);
    if (from?.restriction === 'permanent') throw badRequest('Endowment / permanently restricted principal cannot be transferred out.');
    const warn = await restrictedOverdraftCheck(db, b.from_fund_id, b.amount);
    if (warn) throw badRequest(warn);
    const transfer = await accountByCode(db, '3900'); const cash = await accountByCode(db, '1000');
    const entry = await createEntry(db, req.auth!.tenantId, req.auth!.userId, { entry_date: b.date, memo: `Interfund transfer: ${b.memo}`, source: 'manual', lines: [
      { account_id: transfer, fund_id: b.from_fund_id, debit: b.amount, description: 'Transfer out' }, { account_id: cash, fund_id: b.from_fund_id, credit: b.amount },
      { account_id: cash, fund_id: b.to_fund_id, debit: b.amount }, { account_id: transfer, fund_id: b.to_fund_id, credit: b.amount, description: 'Transfer in' },
    ] });
    await audit(db, actor(req), 'accounting', 'fund_transfer', `Transferred ${b.amount} between funds: ${b.memo}`, { type: 'journal', id: entry.id });
    return entry;
  });
  res.status(201).json(e);
}));

// ───────── Spend (expenses) & Snap & Receipt ─────────
const expenseSchema = z.object({ vendor: z.string().min(1), expense_date: z.string(), amount: z.coerce.number().positive(), account_id: z.string().uuid(), fund_id: z.string().uuid(),
  project_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null), payment_account_id: z.string().uuid(), notes: z.string().nullish(), ministry_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  override_restriction: z.coerce.boolean().optional() });

moneyRouter.get('/expenses', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const p: unknown[] = []; const sc = ministryScope(req.auth!, 'x.ministry_id', p);
  res.json(await tx(req, (db) => many(db, `SELECT x.*, a.code||' '||a.name account_name, f.name fund_name, f.restriction, p.name project_name, pa.name payment_account_name, at.filename receipt_filename
    FROM expenses x JOIN accounts a ON a.id=x.account_id JOIN funds f ON f.id=x.fund_id LEFT JOIN projects p ON p.id=x.project_id JOIN accounts pa ON pa.id=x.payment_account_id LEFT JOIN attachments at ON at.id=x.attachment_id
    WHERE ${sc} ORDER BY x.expense_date DESC LIMIT 500`, p)));
}));

moneyRouter.post('/expenses', upload.single('receipt'), h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(expenseSchema, req.body);
  assertMinistry(req.auth!, b.ministry_id);
  const out = await tx(req, async (db) => {
    const warn = await restrictedOverdraftCheck(db, b.fund_id, b.amount);
    if (warn && !(b.override_restriction && req.auth!.permissions.has('finance.approve'))) throw badRequest(`${warn} An approver can override after confirming the spend is allowed by the restriction.`);
    const att = req.file ? await saveAttachment(db, req, req.file, 'expense', null) : null;
    const x = await one(db, `INSERT INTO expenses(tenant_id, ministry_id, vendor, expense_date, amount, account_id, fund_id, project_id, payment_account_id, notes, attachment_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id, b.vendor, b.expense_date, b.amount, b.account_id, b.fund_id, b.project_id, b.payment_account_id, b.notes ?? null, att?.id ?? null, req.auth!.userId]);
    if (att) await db.query(`UPDATE attachments SET entity_id=$2 WHERE id=$1`, [att.id, x.id]);
    await postExpense(db, req.auth!.tenantId, req.auth!.userId, x.id);
    await audit(db, actor(req), 'accounting', 'expense', `Recorded expense ${b.vendor} ${b.amount}${warn ? ' (restricted-fund override)' : ''}`, { type: 'expense', id: x.id });
    return x;
  });
  res.status(201).json(out);
}));

/** Attach a receipt image to an existing expense or journal (Snap & Receipt). */
moneyRouter.post('/receipt-capture', upload.single('file'), h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  if (!req.file) throw badRequest('Upload or photograph a receipt.');
  const { entity_type, entity_id } = parse(z.object({ entity_type: z.enum(['expense', 'journal', 'bank_transaction']).optional(), entity_id: z.string().uuid().optional() }), req.body);
  const att = await tx(req, async (db) => {
    const a = await saveAttachment(db, req, req.file!, entity_type ?? 'unfiled_receipt', entity_id ?? null);
    if (entity_type === 'expense' && entity_id) await db.query(`UPDATE expenses SET attachment_id=$2 WHERE id=$1`, [entity_id, a.id]);
    return a;
  });
  res.status(201).json(att);
}));

moneyRouter.get('/receipt-capture/unfiled', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT id, filename, mime, size, created_at FROM attachments WHERE entity_type='unfiled_receipt' ORDER BY created_at DESC`)));
}));

// ───────── Payroll ─────────
moneyRouter.get('/payroll', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT p.*, a.code||' '||a.name account_name, f.name fund_name, m.name ministry_name FROM payroll_entries p JOIN accounts a ON a.id=p.account_id JOIN funds f ON f.id=p.fund_id LEFT JOIN ministries m ON m.id=p.ministry_id ORDER BY pay_date DESC LIMIT 500`)));
}));
moneyRouter.post('/payroll', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(z.object({ staff_name: z.string().min(1), user_id: z.string().uuid().nullish(), pay_date: z.string(), gross: z.coerce.number().positive(), employer_taxes: z.coerce.number().min(0).default(0),
    benefits: z.coerce.number().min(0).default(0), department: z.string().nullish(), account_id: z.string().uuid().optional(), fund_id: z.string().uuid().optional(), ministry_id: z.string().uuid().nullish() }), req.body);
  const out = await tx(req, async (db) => {
    const account = b.account_id ?? await accountByCode(db, '5000');
    const fund = b.fund_id ?? await generalFundId(db);
    const p = await one(db, `INSERT INTO payroll_entries(tenant_id, ministry_id, staff_name, user_id, pay_date, gross, employer_taxes, benefits, department, account_id, fund_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id ?? null, b.staff_name, b.user_id ?? null, b.pay_date, b.gross, b.employer_taxes, b.benefits, b.department ?? null, account, fund]);
    await postPayroll(db, req.auth!.tenantId, req.auth!.userId, p.id);
    await audit(db, actor(req), 'accounting', 'payroll', `Recorded payroll for ${b.staff_name}`, { type: 'payroll', id: p.id });
    return one(db, `SELECT * FROM payroll_entries WHERE id=$1`, [p.id]);
  });
  res.status(201).json(out);
}));

// ───────── Budgets ─────────
moneyRouter.get('/budgets', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT b.*, f.name fund_name, (SELECT coalesce(sum(amount),0) FROM budget_lines bl WHERE bl.budget_id=b.id)::float total FROM budgets b LEFT JOIN funds f ON f.id=b.fund_id ORDER BY period_start DESC`)));
}));
moneyRouter.post('/budgets', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(z.object({ name: z.string().min(1), period_start: z.string(), period_end: z.string(), fund_id: z.string().uuid().nullish(), ministry_id: z.string().uuid().nullish(),
    lines: z.array(z.object({ account_id: z.string().uuid(), fund_id: z.string().uuid().nullish(), project_id: z.string().uuid().nullish(), amount: z.coerce.number() })).default([]),
    copy_actuals_from_year: z.number().int().optional() }), req.body);
  if (b.period_end < b.period_start) throw badRequest('Budget end must be after start.');
  const out = await tx(req, async (db) => {
    const bud = await one(db, `INSERT INTO budgets(tenant_id,name,period_start,period_end,fund_id,ministry_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.auth!.tenantId, b.name, b.period_start, b.period_end, b.fund_id ?? null, b.ministry_id ?? null]);
    let lines = b.lines;
    if (!lines.length && b.copy_actuals_from_year) {
      lines = (await many(db, `SELECT jl.account_id, sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END)::float amount FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id
        WHERE a.type IN ('revenue','expense') AND extract(year from je.entry_date)=$1 GROUP BY 1`, [b.copy_actuals_from_year])).map((l) => ({ ...l, fund_id: b.fund_id ?? null }));
    }
    for (const l of lines) await db.query(`INSERT INTO budget_lines(tenant_id,budget_id,account_id,fund_id,project_id,amount) VALUES ($1,$2,$3,$4,$5,$6)`, [req.auth!.tenantId, bud.id, l.account_id, l.fund_id ?? b.fund_id ?? null, (l as any).project_id ?? null, round2(l.amount)]);
    await audit(db, actor(req), 'accounting', 'budget', `Created budget “${b.name}”`, { type: 'budget', id: bud.id });
    return bud;
  });
  res.status(201).json(out);
}));

async function budgetVsActual(db: Db, id: string) {
  const b = await one(db, `SELECT * FROM budgets WHERE id=$1`, [id]);
  if (!b) throw notFound('Budget');
  const lines = await many(db, `SELECT bl.*, a.code, a.name account_name, a.type, f.name fund_name, p.name project_name,
      coalesce((SELECT sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END) FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted'
        WHERE jl.account_id=bl.account_id AND (bl.fund_id IS NULL OR jl.fund_id=bl.fund_id) AND (bl.project_id IS NULL OR jl.project_id=bl.project_id) AND je.entry_date BETWEEN $2 AND $3),0)::float actual
    FROM budget_lines bl JOIN accounts a ON a.id=bl.account_id LEFT JOIN funds f ON f.id=bl.fund_id LEFT JOIN projects p ON p.id=bl.project_id WHERE bl.budget_id=$1 ORDER BY a.code`, [id, b.period_start, b.period_end]);
  const rows = lines.map((l) => ({ ...l, amount: Number(l.amount), remaining: round2(Number(l.amount) - l.actual), variance: round2(l.type === 'expense' ? Number(l.amount) - l.actual : l.actual - Number(l.amount)), pct: Number(l.amount) ? Math.round((l.actual / Number(l.amount)) * 100) : null }));
  return { budget: b, rows };
}
moneyRouter.get('/budgets/:id', h(async (req, res) => { requirePerm(req.auth, 'finance.read'); res.json(await tx(req, (db) => budgetVsActual(db, String(req.params.id)))); }));
moneyRouter.put('/budgets/:id/lines', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const { lines } = parse(z.object({ lines: z.array(z.object({ account_id: z.string().uuid(), fund_id: z.string().uuid().nullish(), project_id: z.string().uuid().nullish(), amount: z.coerce.number() })) }), req.body);
  await tx(req, async (db) => {
    if (!(await one(db, `SELECT 1 FROM budgets WHERE id=$1`, [req.params.id]))) throw notFound('Budget');
    await db.query(`DELETE FROM budget_lines WHERE budget_id=$1`, [req.params.id]);
    for (const l of lines) await db.query(`INSERT INTO budget_lines(tenant_id,budget_id,account_id,fund_id,project_id,amount) VALUES ($1,$2,$3,$4,$5,$6)`, [req.auth!.tenantId, req.params.id, l.account_id, l.fund_id ?? null, l.project_id ?? null, round2(l.amount)]);
    await audit(db, actor(req), 'accounting', 'budget', `Updated budget lines`, { type: 'budget', id: String(req.params.id) });
  });
  res.json({ ok: true });
}));

// ───────── Bank feed & reconciliation ─────────
moneyRouter.get('/bank/transactions', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT b.*, ba.name bank_name, a.code||' '||a.name category_name, f.name fund_name FROM bank_transactions b JOIN bank_accounts ba ON ba.id=b.bank_account_id
    LEFT JOIN accounts a ON a.id=b.category_account_id LEFT JOIN funds f ON f.id=b.fund_id WHERE ($1::text IS NULL OR b.status=$1) AND ($2::uuid IS NULL OR b.bank_account_id=$2) ORDER BY b.txn_date DESC LIMIT 1000`,
    [req.query.status ?? null, req.query.bank_account_id ?? null])));
}));

/** Import a bank statement CSV (date, description, amount). Dedupes by a content hash external id. */
moneyRouter.post('/bank/import', upload.single('file'), h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  if (!req.file) throw badRequest('Choose a CSV bank statement.');
  const { bank_account_id } = parse(z.object({ bank_account_id: z.string().uuid() }), req.body);
  const recs: Record<string, string>[] = csvParse(req.file.buffer.toString('utf8'), { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  const pick = (r: Record<string, string>, ...names: string[]) => names.map((n) => r[n]).find((v) => v !== undefined && v !== '');
  const out = await tx(req, async (db) => {
    let added = 0, dup = 0; const errors: string[] = [];
    for (const [i, r] of recs.entries()) {
      const date = pick(r, 'date', 'posted date', 'transaction date', 'posting date');
      const desc = pick(r, 'description', 'memo', 'payee', 'name') ?? '';
      let amt = Number(String(pick(r, 'amount') ?? '').replace(/[$,]/g, ''));
      if (!pick(r, 'amount')) { const dr = Number(String(pick(r, 'debit', 'withdrawal') ?? '0').replace(/[$,]/g, '')); const cr = Number(String(pick(r, 'credit', 'deposit') ?? '0').replace(/[$,]/g, '')); amt = cr - dr; }
      const d = date ? new Date(date) : null;
      if (!d || Number.isNaN(d.getTime()) || !Number.isFinite(amt)) { errors.push(`Row ${i + 2}: could not read date/amount`); continue; }
      const iso = d.toISOString().slice(0, 10);
      const ext = pick(r, 'id', 'transaction id', 'fitid') ?? crypto.createHash('sha1').update(`${iso}|${desc}|${amt}|${i}`).digest('hex');
      const ins = await db.query(`INSERT INTO bank_transactions(tenant_id, bank_account_id, txn_date, description, amount, external_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [req.auth!.tenantId, bank_account_id, iso, desc, round2(amt), ext]);
      if (ins.rowCount) added++; else dup++;
    }
    // Flag likely duplicates of already-posted ledger activity (same date ±3 days and amount).
    await db.query(`UPDATE bank_transactions b SET status='duplicate' WHERE b.status='unreviewed' AND EXISTS (
      SELECT 1 FROM bank_transactions o WHERE o.id<>b.id AND o.bank_account_id=b.bank_account_id AND o.amount=b.amount AND abs(o.txn_date - b.txn_date) <= 1 AND o.description=b.description AND o.status IN ('posted','matched'))`);
    await audit(db, actor(req), 'accounting', 'bank_import', `Imported ${added} bank transactions (${dup} already present)`, { type: 'bank_account', id: bank_account_id });
    return { added, duplicates: dup, errors };
  });
  res.json(out);
}));

/** Suggest ledger matches for a bank transaction (gift deposits / expenses with same amount near date). */
moneyRouter.get('/bank/transactions/:id/matches', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, async (db) => {
    const b = await one(db, `SELECT b.*, ba.account_id FROM bank_transactions b JOIN bank_accounts ba ON ba.id=b.bank_account_id WHERE b.id=$1`, [req.params.id]);
    if (!b) throw notFound('Bank transaction');
    return many(db, `SELECT je.id, je.entry_date, je.memo, je.source, sum(jl.debit)::float amount FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id
      WHERE je.status='posted' AND abs(je.entry_date - $1::date) <= 5 AND NOT EXISTS (SELECT 1 FROM bank_transactions x WHERE x.journal_entry_id=je.id)
      GROUP BY je.id HAVING sum(jl.debit) = abs($2::numeric) ORDER BY abs(je.entry_date - $1::date) LIMIT 10`, [b.txn_date, b.amount]);
  }));
}));

moneyRouter.post('/bank/transactions/:id/review', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(z.object({ action: z.enum(['post', 'match', 'exclude', 'reconcile', 'unreconcile']), category_account_id: z.string().uuid().optional(), fund_id: z.string().uuid().optional(), journal_entry_id: z.string().uuid().optional(), project_id: z.string().uuid().optional() }), req.body);
  if (['reconcile', 'unreconcile'].includes(b.action)) requirePerm(req.auth, 'finance.approve');
  await tx(req, async (db) => {
    const t = await one(db, `SELECT b.*, ba.account_id bank_ledger FROM bank_transactions b JOIN bank_accounts ba ON ba.id=b.bank_account_id WHERE b.id=$1 FOR UPDATE`, [req.params.id]);
    if (!t) throw notFound('Bank transaction');
    if (b.action === 'post') {
      if (t.status === 'posted') throw conflict('Already posted.');
      if (!b.category_account_id || !b.fund_id) throw badRequest('Choose a category account and fund.');
      const amt = Math.abs(Number(t.amount));
      const lines = Number(t.amount) >= 0
        ? [{ account_id: t.bank_ledger, fund_id: b.fund_id, debit: amt }, { account_id: b.category_account_id, fund_id: b.fund_id, credit: amt, project_id: b.project_id }]
        : [{ account_id: b.category_account_id, fund_id: b.fund_id, debit: amt, project_id: b.project_id }, { account_id: t.bank_ledger, fund_id: b.fund_id, credit: amt }];
      const e = await createEntry(db, req.auth!.tenantId, req.auth!.userId, { entry_date: t.txn_date, memo: `Bank: ${t.description}`, source: 'bank', source_id: t.id, lines });
      await db.query(`UPDATE bank_transactions SET status='posted', category_account_id=$2, fund_id=$3, journal_entry_id=$4 WHERE id=$1`, [t.id, b.category_account_id, b.fund_id, e.id]);
    } else if (b.action === 'match') {
      if (!b.journal_entry_id) throw badRequest('Choose the ledger entry to match.');
      await db.query(`UPDATE bank_transactions SET status='matched', journal_entry_id=$2 WHERE id=$1`, [t.id, b.journal_entry_id]);
    } else if (b.action === 'exclude') {
      await db.query(`UPDATE bank_transactions SET status='excluded' WHERE id=$1`, [t.id]);
    } else {
      if (b.action === 'reconcile' && !['posted', 'matched'].includes(t.status)) throw badRequest('Post or match the transaction before reconciling.');
      await db.query(`UPDATE bank_transactions SET reconciled=$2 WHERE id=$1`, [t.id, b.action === 'reconcile']);
    }
    await audit(db, actor(req), 'accounting', `bank_${b.action}`, `Bank transaction “${t.description}” ${b.action}`, { type: 'bank_transaction', id: t.id });
  });
  res.json({ ok: true });
}));

moneyRouter.get('/bank/reconciliation/:bankAccountId', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const asOf = String(req.query.as_of ?? today());
  res.json(await tx(req, async (db) => {
    const ba = await one(db, `SELECT * FROM bank_accounts WHERE id=$1`, [req.params.bankAccountId]);
    if (!ba) throw notFound('Bank account');
    const ledger = await one(db, `SELECT coalesce(sum(jl.debit-jl.credit),0)::float bal FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=$1 AND je.entry_date <= $2`, [ba.account_id, asOf]);
    const cleared = await one(db, `SELECT coalesce(sum(amount),0)::float bal, count(*)::int n FROM bank_transactions WHERE bank_account_id=$1 AND reconciled AND txn_date <= $2`, [ba.id, asOf]);
    const statement = req.query.statement_balance !== undefined ? Number(req.query.statement_balance) : null;
    return { bankAccount: ba, asOf, ledgerBalance: ledger!.bal, clearedBalance: cleared!.bal, clearedCount: cleared!.n, statementBalance: statement, difference: statement === null ? null : round2(statement - cleared!.bal) };
  }));
}));

// ───────── Invoices ─────────
async function invoiceTotals(db: Db, id: string) {
  const inv = await one(db, `SELECT i.*, j.title job_title, p.name project_name FROM invoices i LEFT JOIN jobs j ON j.id=i.job_id LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=$1`, [id]);
  if (!inv) throw notFound('Invoice');
  const lines = await many(db, `SELECT l.*, rt.name rate_type_name FROM invoice_lines l LEFT JOIN rate_types rt ON rt.id=l.rate_type_id WHERE invoice_id=$1 ORDER BY description`, [id]);
  const subtotal = round2(lines.reduce((a, l) => a + Number(l.quantity) * Number(l.rate), 0));
  const tax = round2(subtotal * Number(inv.tax_rate) / 100);
  return { ...inv, lines, subtotal, tax, total: round2(subtotal + tax), balance: round2(subtotal + tax - Number(inv.amount_paid)) };
}
moneyRouter.get('/invoices', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT i.*, (SELECT coalesce(sum(quantity*rate),0) FROM invoice_lines l WHERE l.invoice_id=i.id)*(1+i.tax_rate/100) AS total, m.name ministry_name
    FROM invoices i LEFT JOIN ministries m ON m.id=i.ministry_id WHERE ($1::text IS NULL OR i.status=$1) ORDER BY i.invoice_date DESC LIMIT 500`, [req.query.status ?? null])));
}));
moneyRouter.get('/invoices/:id', h(async (req, res) => { requirePerm(req.auth, 'finance.read'); res.json(await tx(req, (db) => invoiceTotals(db, String(req.params.id)))); }));

const invoiceSchema = z.object({ customer_name: z.string().min(1), customer_email: z.string().email().nullish().or(z.literal('')), invoice_date: z.string(), terms: z.string().default('Net 30'),
  due_date: z.string().optional(), tax_rate: z.coerce.number().min(0).max(100).default(0), notes: z.string().nullish(), job_id: z.string().uuid().nullish(), project_id: z.string().uuid().nullish(), ministry_id: z.string().uuid().nullish(),
  lines: z.array(z.object({ description: z.string().min(1), quantity: z.coerce.number().positive(), rate: z.coerce.number().min(0), rate_type_id: z.string().uuid().nullish() })).min(1) });
function dueFromTerms(date: string, terms: string) { const m = terms.match(/(\d+)/); return addDays(date, m ? Number(m[1]) : 0); }

moneyRouter.post('/invoices', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(invoiceSchema, req.body);
  const inv = await tx(req, async (db) => {
    const n = await one(db, `SELECT count(*)::int n FROM invoices`);
    const i = await one(db, `INSERT INTO invoices(tenant_id, ministry_id, number, customer_name, customer_email, invoice_date, due_date, terms, tax_rate, notes, job_id, project_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id ?? null, `INV-${String(n!.n + 1001)}`, b.customer_name, b.customer_email || null, b.invoice_date, b.due_date ?? dueFromTerms(b.invoice_date, b.terms), b.terms, b.tax_rate, b.notes ?? null, b.job_id ?? null, b.project_id ?? null]);
    for (const l of b.lines) await db.query(`INSERT INTO invoice_lines(tenant_id, invoice_id, description, quantity, rate, rate_type_id) VALUES ($1,$2,$3,$4,$5,$6)`, [req.auth!.tenantId, i.id, l.description, l.quantity, l.rate, l.rate_type_id ?? null]);
    await audit(db, actor(req), 'accounting', 'invoice', `Created invoice ${i.number} for ${b.customer_name}`, { type: 'invoice', id: i.id });
    return i;
  });
  res.status(201).json(inv);
}));

/** Build invoice lines from unbilled billable time on a job. */
moneyRouter.get('/invoices/from-job/:jobId', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, (db) => many(db, `SELECT rt.id rate_type_id, coalesce(rt.name,'Services') || ' — ' || j.title description, sum(te.hours)::float quantity, coalesce(rt.hourly_rate,0)::float rate
    FROM time_entries te JOIN jobs j ON j.id=te.job_id LEFT JOIN rate_types rt ON rt.id=te.rate_type_id WHERE te.job_id=$1 AND te.billable GROUP BY rt.id, rt.name, j.title`, [req.params.jobId])));
}));

moneyRouter.post('/invoices/:id/status', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(z.object({ action: z.enum(['mark_sent', 'record_payment', 'void']), amount: z.coerce.number().positive().optional(), date: z.string().optional(), deposit_account_id: z.string().uuid().optional() }), req.body);
  await tx(req, async (db) => {
    const inv = await invoiceTotals(db, String(req.params.id));
    const fund = await generalFundId(db);
    if (b.action === 'mark_sent') {
      if (inv.status !== 'draft') throw conflict('Only draft invoices can be marked sent.');
      await createEntry(db, req.auth!.tenantId, req.auth!.userId, { entry_date: inv.invoice_date, memo: `Invoice ${inv.number} — ${inv.customer_name}`, source: 'invoice', source_id: inv.id, lines: [
        { account_id: await accountByCode(db, '1100'), fund_id: fund, debit: inv.total, project_id: inv.project_id }, { account_id: await accountByCode(db, '4400'), fund_id: fund, credit: inv.total, project_id: inv.project_id }] });
      await db.query(`UPDATE invoices SET status='sent' WHERE id=$1`, [inv.id]);
    } else if (b.action === 'record_payment') {
      if (!['sent', 'partial'].includes(inv.status)) throw conflict('Mark the invoice as sent before recording payment.');
      const amt = round2(Math.min(b.amount ?? inv.balance, inv.balance));
      if (amt <= 0) throw badRequest('Invoice is already paid.');
      await createEntry(db, req.auth!.tenantId, req.auth!.userId, { entry_date: b.date ?? today(), memo: `Payment — invoice ${inv.number}`, source: 'invoice', source_id: inv.id, lines: [
        { account_id: b.deposit_account_id ?? await accountByCode(db, '1000'), fund_id: fund, debit: amt }, { account_id: await accountByCode(db, '1100'), fund_id: fund, credit: amt }] });
      const paid = round2(Number(inv.amount_paid) + amt);
      await db.query(`UPDATE invoices SET amount_paid=$2::numeric, status=CASE WHEN $2::numeric >= $3::numeric THEN 'paid' ELSE 'partial' END WHERE id=$1`, [inv.id, paid, inv.total]);
    } else {
      if (Number(inv.amount_paid) > 0) throw conflict('Invoices with payments cannot be voided.');
      const entries = await many(db, `SELECT id FROM journal_entries WHERE source='invoice' AND source_id=$1 AND status='posted'`, [inv.id]);
      for (const e of entries) await voidEntry(db, e.id);
      await db.query(`UPDATE invoices SET status='void' WHERE id=$1`, [inv.id]);
    }
    await audit(db, actor(req), 'accounting', `invoice_${b.action}`, `Invoice ${inv.number}: ${b.action.replace('_', ' ')}`, { type: 'invoice', id: inv.id });
  });
  res.json({ ok: true });
}));

function invoicePdfBlocks(inv: any, t: any) {
  const m = (n: number) => fmtMoney2(n, t.currency, t.locale);
  return [
    { type: 'kv' as const, rows: [['Bill to', [inv.customer_name, inv.customer_email].filter(Boolean).join(' · ')], ['Invoice #', inv.number], ['Invoice date', inv.invoice_date], ['Terms', inv.terms], ['Due date', inv.due_date], ['Status', inv.status.toUpperCase()]] as [string, string][] },
    { type: 'table' as const, columns: ['Description', 'Qty / Hours', 'Rate', 'Amount'], rows: inv.lines.map((l: any) => [l.description, Number(l.quantity), m(Number(l.rate)), m(Number(l.quantity) * Number(l.rate))]), widths: [262, 80, 80, 90], align: ['left', 'right', 'right', 'right'] as ('left' | 'right')[] },
    { type: 'kv' as const, rows: [['Subtotal', m(inv.subtotal)], [`Tax (${inv.tax_rate}%)`, m(inv.tax)], ['Total', m(inv.total)], ['Paid', m(Number(inv.amount_paid))], ['Balance due', m(inv.balance)]] as [string, string][] },
    ...(inv.notes ? [{ type: 'p' as const, text: inv.notes }] : []),
  ];
}
moneyRouter.get('/invoices/:id/pdf', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const { inv, t } = await tx(req, async (db) => ({ inv: await invoiceTotals(db, String(req.params.id)), t: await one(db, `SELECT * FROM tenants WHERE id=$1`, [req.auth!.tenantId]) }));
  renderPdf(res, `${inv.number}.pdf`, { title: `Invoice ${inv.number}`, subtitle: t.legal_name ?? t.name, org: [t.email, t.phone].filter(Boolean).join(' · '), blocks: invoicePdfBlocks(inv, t) });
}));
moneyRouter.post('/invoices/:id/email', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  await tx(req, async (db) => {
    const inv = await invoiceTotals(db, String(req.params.id));
    if (!inv.customer_email) throw badRequest('Add a customer email to the invoice first.');
    const t = await one(db, `SELECT * FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const transport = await requireTransport(db, req.auth!.userId);
    const html = `<p>Hello ${inv.customer_name},</p><p>Please find invoice <b>${inv.number}</b> for ${fmtMoney2(inv.total, t.currency, t.locale)}, due ${inv.due_date} (${inv.terms}).</p><p>Thank you,<br/>${t.name}</p>`;
    await transport.t.sendMail({ from: transport.from, to: inv.customer_email, subject: `Invoice ${inv.number} from ${t.name}`, html });
    await audit(db, actor(req), 'accounting', 'invoice_email', `Emailed invoice ${inv.number} to ${inv.customer_email}`, { type: 'invoice', id: inv.id });
  });
  res.json({ ok: true });
}));

// ───────── Financial reports ─────────
async function reportData(db: Db, kind: string, from: string, to: string, opts: { fundId?: string; accountId?: string; budgetId?: string } = {}) {
  const posted = `je.status='posted'`;
  switch (kind) {
    case 'financial-position': {
      const rows = await many(db, `SELECT a.type, a.code, a.name, f.restriction, sum(jl.debit - jl.credit)::float bal FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND ${posted}
        JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id WHERE je.entry_date <= $1 GROUP BY 1,2,3,4 ORDER BY a.code`, [to]);
      const sum = (t: string) => round2(rows.filter((r) => r.type === t).reduce((a, r) => a + r.bal, 0));
      const assets = new Map<string, number>(), liabilities = new Map<string, number>();
      for (const r of rows) {
        if (r.type === 'asset') assets.set(`${r.code} ${r.name}`, round2((assets.get(`${r.code} ${r.name}`) ?? 0) + r.bal));
        if (r.type === 'liability') liabilities.set(`${r.code} ${r.name}`, round2((liabilities.get(`${r.code} ${r.name}`) ?? 0) - r.bal));
      }
      const naWithout = -round2(rows.filter((r) => ['revenue', 'expense', 'net_assets'].includes(r.type) && r.restriction === 'unrestricted').reduce((a, r) => a + r.bal, 0));
      const naWith = -round2(rows.filter((r) => ['revenue', 'expense', 'net_assets'].includes(r.type) && r.restriction !== 'unrestricted').reduce((a, r) => a + r.bal, 0));
      return { asOf: to, assets: [...assets].map(([k, v]) => ({ account: k, amount: v })), totalAssets: sum('asset'), liabilities: [...liabilities].map(([k, v]) => ({ account: k, amount: v })), totalLiabilities: -sum('liability'),
        netAssetsWithoutRestrictions: naWithout, netAssetsWithRestrictions: naWith, totalNetAssets: round2(naWith + naWithout), check: round2(sum('asset') + sum('liability') - (naWith + naWithout)) };
    }
    case 'activities': {
      const rows = await many(db, `SELECT a.type, a.code, a.name, CASE WHEN f.restriction='unrestricted' THEN 'without' ELSE 'with' END col, sum(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE jl.debit-jl.credit END)::float amt
        FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND ${posted} JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id
        WHERE je.entry_date BETWEEN $1 AND $2 AND a.type IN ('revenue','expense') GROUP BY 1,2,3,4 ORDER BY a.code`, [from, to]);
      const fold = (type: string) => { const m = new Map<string, { account: string; without: number; with: number; total: number }>();
        for (const r of rows.filter((x) => x.type === type)) { const k = `${r.code} ${r.name}`; const o = m.get(k) ?? { account: k, without: 0, with: 0, total: 0 }; o[r.col as 'with' | 'without'] = round2(o[r.col as 'with' | 'without'] + r.amt); o.total = round2(o.with + o.without); m.set(k, o); }
        return [...m.values()]; };
      const revenue = fold('revenue'), expenses = fold('expense');
      const tot = (arr: any[], k: string) => round2(arr.reduce((a, r) => a + r[k], 0));
      return { from, to, revenue, expenses, totals: { revenueWithout: tot(revenue, 'without'), revenueWith: tot(revenue, 'with'), expensesWithout: tot(expenses, 'without'), expensesWith: tot(expenses, 'with'),
        changeWithout: round2(tot(revenue, 'without') - tot(expenses, 'without')), changeWith: round2(tot(revenue, 'with') - tot(expenses, 'with')), change: round2(tot(revenue, 'total') - tot(expenses, 'total')) } };
    }
    case 'trial-balance': {
      const rows = await many(db, `SELECT a.code, a.name, a.type, sum(jl.debit)::float debits, sum(jl.credit)::float credits FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND ${posted}
        JOIN accounts a ON a.id=jl.account_id WHERE je.entry_date <= $1 GROUP BY 1,2,3 ORDER BY a.code`, [to]);
      const out = rows.map((r) => { const net = round2(r.debits - r.credits); return { ...r, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }; });
      return { asOf: to, rows: out, totalDebit: round2(out.reduce((a, r) => a + r.debit, 0)), totalCredit: round2(out.reduce((a, r) => a + r.credit, 0)) };
    }
    case 'general-ledger': {
      const rows = await many(db, `SELECT je.entry_date, je.memo, je.source, je.id entry_id, a.code, a.name account, f.name fund, jl.debit::float, jl.credit::float, jl.description
        FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND ${posted} JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id
        WHERE je.entry_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.id=$3) AND ($4::uuid IS NULL OR f.id=$4) ORDER BY a.code, je.entry_date, je.created_at LIMIT 20000`, [from, to, opts.accountId ?? null, opts.fundId ?? null]);
      return { from, to, rows };
    }
    case 'fund-activity': {
      const rows = await many(db, `SELECT f.id, f.name, f.restriction,
          coalesce(sum(CASE WHEN a.type IN ('revenue','expense','net_assets') AND je.entry_date < $1 THEN jl.credit-jl.debit END),0)::float opening,
          coalesce(sum(CASE WHEN a.type='revenue' AND je.entry_date BETWEEN $1 AND $2 THEN jl.credit-jl.debit END),0)::float income,
          coalesce(sum(CASE WHEN a.type='expense' AND je.entry_date BETWEEN $1 AND $2 THEN jl.debit-jl.credit END),0)::float expenses,
          coalesce(sum(CASE WHEN a.type='net_assets' AND je.entry_date BETWEEN $1 AND $2 THEN jl.credit-jl.debit END),0)::float transfers
        FROM funds f LEFT JOIN journal_lines jl ON jl.fund_id=f.id LEFT JOIN journal_entries je ON je.id=jl.entry_id AND ${posted} AND je.entry_date <= $2 LEFT JOIN accounts a ON a.id=jl.account_id AND je.id IS NOT NULL
        GROUP BY f.id ORDER BY f.restriction, f.name`, [from, to]);
      return { from, to, rows: rows.map((r) => ({ ...r, closing: round2(r.opening + r.income - r.expenses + r.transfers) })) };
    }
    case 'restricted-funds': {
      const d: any = await reportData(db, 'fund-activity', from, to);
      return { ...d, rows: d.rows.filter((r: any) => r.restriction !== 'unrestricted') };
    }
    case 'giving': {
      const byMonth = await many(db, `SELECT to_char(gift_date,'YYYY-MM') AS month, sum(amount)::float total, count(*)::int gifts, count(DISTINCT donor_id)::int donors FROM gifts WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]);
      const byFund = await many(db, `SELECT f.name fund, f.restriction, sum(g.amount)::float total, count(*)::int gifts FROM gifts g JOIN funds f ON f.id=g.fund_id WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 GROUP BY 1,2 ORDER BY 3 DESC`, [from, to]);
      const topDonors = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, sum(g.amount)::float total, count(*)::int gifts FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 GROUP BY d.id ORDER BY 3 DESC LIMIT 25`, [from, to]);
      return { from, to, byMonth, byFund, topDonors, total: round2(byMonth.reduce((a, r) => a + r.total, 0)) };
    }
    case 'campaigns': {
      const rows = await many(db, `SELECT c.id, c.name, c.goal::float, c.status, coalesce(sum(g.amount),0)::float raised, count(g.id)::int gifts, count(DISTINCT g.donor_id)::int donors
        FROM campaigns c LEFT JOIN gifts g ON g.campaign_id=c.id AND NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 GROUP BY c.id ORDER BY raised DESC`, [from, to]);
      return { from, to, rows };
    }
    case 'budget-vs-actual': {
      if (!opts.budgetId) { const b = await one(db, `SELECT id FROM budgets WHERE $1 BETWEEN period_start AND period_end ORDER BY period_start DESC LIMIT 1`, [to]); if (!b) throw badRequest('No budget covers this period. Create one under Money › Budgets.'); opts.budgetId = b.id; }
      return budgetVsActual(db, opts.budgetId!);
    }
    default: throw badRequest('Unknown report.');
  }
}

moneyRouter.get('/reports/:kind', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read', 'reports.read');
  const kind = String(req.params.kind);
  if (['giving', 'campaigns'].includes(kind)) requirePerm(req.auth, 'donors.read');
  const from = String(req.query.from ?? `${new Date().getFullYear()}-01-01`), to = String(req.query.to ?? today());
  const data: any = await tx(req, (db) => reportData(db, kind, from, to, { fundId: req.query.fund_id as string, accountId: req.query.account_id as string, budgetId: req.query.budget_id as string }));
  const format = String(req.query.format ?? 'json');
  if (format === 'json') return res.json(data);
  requirePerm(req.auth, 'data.export');
  const t = await tx(req, async (db) => { await audit(db, actor(req), 'export', 'report', `Exported ${kind} report (${format})`); return one(db, `SELECT name, currency, locale FROM tenants WHERE id=$1`, [req.auth!.tenantId]); });
  const m = (n: number) => fmtMoney2(n ?? 0, t.currency, t.locale);
  const title: Record<string, string> = { 'financial-position': 'Statement of Financial Position', activities: 'Statement of Activities', 'trial-balance': 'Trial Balance', 'general-ledger': 'General Ledger',
    'fund-activity': 'Fund Activity', 'restricted-funds': 'Restricted Funds', giving: 'Giving Report', campaigns: 'Campaign Report', 'budget-vs-actual': 'Budget vs. Actual' };
  // Tabular rows for CSV/XLSX
  const table = (): { cols: string[]; rows: any[] } => {
    switch (kind) {
      case 'financial-position': return { cols: ['section', 'account', 'amount'], rows: [...data.assets.map((r: any) => ({ section: 'Assets', ...r })), ...data.liabilities.map((r: any) => ({ section: 'Liabilities', ...r })),
        { section: 'Net assets', account: 'Without donor restrictions', amount: data.netAssetsWithoutRestrictions }, { section: 'Net assets', account: 'With donor restrictions', amount: data.netAssetsWithRestrictions }] };
      case 'activities': return { cols: ['section', 'account', 'without', 'with', 'total'], rows: [...data.revenue.map((r: any) => ({ section: 'Revenue', ...r })), ...data.expenses.map((r: any) => ({ section: 'Expenses', ...r }))] };
      case 'trial-balance': return { cols: ['code', 'name', 'type', 'debit', 'credit'], rows: data.rows };
      case 'general-ledger': return { cols: ['entry_date', 'code', 'account', 'fund', 'memo', 'description', 'debit', 'credit', 'source'], rows: data.rows };
      case 'fund-activity': case 'restricted-funds': return { cols: ['name', 'restriction', 'opening', 'income', 'expenses', 'transfers', 'closing'], rows: data.rows };
      case 'giving': return { cols: ['month', 'total', 'gifts', 'donors'], rows: data.byMonth };
      case 'campaigns': return { cols: ['name', 'status', 'goal', 'raised', 'gifts', 'donors'], rows: data.rows };
      case 'budget-vs-actual': return { cols: ['code', 'account_name', 'fund_name', 'amount', 'actual', 'remaining', 'variance', 'pct'], rows: data.rows };
      default: return { cols: [], rows: [] };
    }
  };
  if (format === 'csv' || format === 'xlsx') { const tb = table(); return sendTable(res, format, `${kind}-${from}-${to}`, tb.cols.map((c) => ({ key: c, label: c })), tb.rows); }
  const tb = table();
  const isMoney = (c: string) => ['amount', 'without', 'with', 'total', 'debit', 'credit', 'opening', 'income', 'expenses', 'transfers', 'closing', 'goal', 'raised', 'actual', 'remaining', 'variance'].includes(c);
  const metrics = kind === 'financial-position' ? [{ label: 'Total assets', value: m(data.totalAssets) }, { label: 'Total liabilities', value: m(data.totalLiabilities) }, { label: 'Net assets', value: m(data.totalNetAssets) }]
    : kind === 'activities' ? [{ label: 'Revenue', value: m(data.totals.revenueWith + data.totals.revenueWithout) }, { label: 'Expenses', value: m(data.totals.expensesWith + data.totals.expensesWithout) }, { label: 'Change in net assets', value: m(data.totals.change) }]
    : kind === 'trial-balance' ? [{ label: 'Total debits', value: m(data.totalDebit) }, { label: 'Total credits', value: m(data.totalCredit) }]
    : kind === 'giving' ? [{ label: 'Total giving', value: m(data.total) }] : [];
  renderPdf(res, `${title[kind]} ${from} to ${to}.pdf`, { title: title[kind] ?? kind, subtitle: ['financial-position', 'trial-balance'].includes(kind) ? `As of ${to}` : `${from} to ${to}`, org: t.name,
    blocks: [...(metrics.length ? [{ type: 'metrics' as const, items: metrics }] : []),
      { type: 'table', columns: tb.cols.map((c) => c.replace(/_/g, ' ')), rows: tb.rows.map((r) => tb.cols.map((c) => (isMoney(c) && typeof r[c] === 'number' ? m(r[c]) : r[c] ?? ''))), align: tb.cols.map((c) => (isMoney(c) ? 'right' : 'left')) }] });
}));

// ───────── Weekly updates ─────────
moneyRouter.post('/updates/generate', h(async (req, res) => {
  requirePerm(req.auth, 'reports.read');
  const b = parse(z.object({ ministry_id: z.string().uuid().nullish(), period_start: z.string(), period_end: z.string(), exclude_private: z.boolean().default(true) }), req.body);
  assertMinistry(req.auth!, b.ministry_id);
  const out = await tx(req, async (db) => {
    const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const mn = b.ministry_id ? await one(db, `SELECT name FROM ministries WHERE id=$1`, [b.ministry_id]) : null;
    const ms = `($3::uuid IS NULL OR ministry_id=$3)`;
    const P = [b.period_start, b.period_end, b.ministry_id ?? null];
    const gifts = await one(db, `SELECT coalesce(sum(amount),0)::float total, count(*)::int n, count(DISTINCT donor_id)::int donors FROM gifts WHERE NOT refunded AND gift_date BETWEEN $1 AND $2 AND ${ms}`, P);
    const newDonors = await one(db, `SELECT count(*)::int n FROM donors WHERE created_at::date BETWEEN $1 AND $2 AND ${ms}`, P);
    const top = await many(db, `SELECT ${DONOR_NAME_SQL()} AS name, g.amount::float FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE NOT g.refunded AND g.gift_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR g.ministry_id=$3) ORDER BY g.amount DESC LIMIT 5`, P);
    const tasksDone = await many(db, `SELECT title FROM tasks WHERE completed_at::date BETWEEN $1 AND $2 AND ${ms} LIMIT 15`, P);
    const tasksOverdue = await one(db, `SELECT count(*)::int n FROM tasks WHERE $1::date IS NOT NULL AND status<>'completed' AND due_date < $2 AND ${ms}`, P);
    const comms = await one(db, `SELECT count(*)::int n FROM communications WHERE occurred_at::date BETWEEN $1 AND $2 AND ${ms} ${b.exclude_private ? 'AND NOT is_private' : ''}`, P);
    const camps = await many(db, `SELECT c.name, c.goal::float, coalesce(sum(g.amount),0)::float raised FROM campaigns c LEFT JOIN gifts g ON g.campaign_id=c.id AND NOT g.refunded WHERE c.status='active' AND ($3::uuid IS NULL OR c.ministry_id=$3) AND $1::date IS NOT NULL AND $2::date IS NOT NULL GROUP BY c.id`, P);
    const grants = await many(db, `SELECT title, status, deadline FROM grants WHERE (deadline BETWEEN $2::date AND $2::date + 21 OR (status='awarded' AND decision_on BETWEEN $1 AND $2)) AND ${ms}`, P);
    const fin = await one(db, `SELECT coalesce(sum(jl.credit-jl.debit) FILTER (WHERE a.type='revenue'),0)::float income, coalesce(sum(jl.debit-jl.credit) FILTER (WHERE a.type='expense'),0)::float expenses
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id WHERE je.entry_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR je.ministry_id=$3)`, P);
    const events = await many(db, `SELECT name, starts_at FROM events WHERE starts_at::date BETWEEN $1::date AND $2::date + 14 AND ${ms}`, P);
    const impact = await many(db, `SELECT m.name, sum(e.value)::float v, m.unit FROM impact_entries e JOIN impact_metrics m ON m.id=e.metric_id WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR m.ministry_id=$3) GROUP BY m.id`, P);
    const p2: unknown[] = []; const opp = await one(db, `SELECT count(*)::int n FROM donors d WHERE d.intelligence->>'priority'='High' AND NOT d.archived AND ${ministryScope(req.auth!, 'd.ministry_id', p2)}`, p2);
    const money = (n: number) => fmtMoney(n, t.currency);
    const facts = `Organization: ${mn?.name ?? t.name}. Period ${b.period_start} to ${b.period_end}.
Gifts: ${money(gifts!.total)} from ${gifts!.n} gifts by ${gifts!.donors} donors. New donors: ${newDonors!.n}. Top gifts: ${top.map((x) => `${x.name} ${money(x.amount)}`).join('; ') || 'none'}.
Income ${money(fin!.income)}, expenses ${money(fin!.expenses)}.
Campaigns: ${camps.map((c) => `${c.name} ${money(c.raised)}${c.goal ? ` of ${money(c.goal)}` : ''}`).join('; ') || 'none active'}.
Tasks completed: ${tasksDone.map((x) => x.title).join('; ') || 'none'}. Overdue tasks: ${tasksOverdue!.n}. Donor contacts logged: ${comms!.n}.
Grants: ${grants.map((g) => `${g.title} (${g.status}${g.deadline ? `, deadline ${g.deadline}` : ''})`).join('; ') || 'none'}.
Upcoming events: ${events.map((e) => `${e.name} ${String(e.starts_at instanceof Date ? e.starts_at.toISOString() : e.starts_at).slice(0, 10)}`).join('; ') || 'none'}.
Impact: ${impact.map((i) => `${i.name}: ${i.v} ${i.unit ?? ''}`).join('; ') || 'none recorded'}.
High-priority fundraising moves waiting: ${opp!.n}.`;
    const ai = await generateText({ prompt: `Write an editable weekly update for leadership from these facts. Use headings: Highlights, Giving, Work, Grants & Events, Finances, Impact, Recommendations (label recommendations as suggestions). Only use these facts.\n\n${facts}` }).catch(() => null);
    const content = ai ?? `WEEKLY UPDATE — ${mn?.name ?? t.name}\n${b.period_start} to ${b.period_end}\n\nGIVING\n• ${money(gifts!.total)} received from ${gifts!.n} gifts (${gifts!.donors} donors); ${newDonors!.n} new donors.\n${top.map((x) => `• ${x.name}: ${money(x.amount)}`).join('\n')}\n\nCAMPAIGNS\n${camps.map((c) => `• ${c.name}: ${money(c.raised)}${c.goal ? ` of ${money(c.goal)} (${Math.round((c.raised / c.goal) * 100)}%)` : ''}`).join('\n') || '• No active campaigns'}\n\nWORK\n• ${tasksDone.length} tasks completed; ${tasksOverdue!.n} overdue.\n• ${comms!.n} donor contacts logged.\n\nGRANTS & EVENTS\n${grants.map((g) => `• ${g.title} — ${g.status}${g.deadline ? `, deadline ${g.deadline}` : ''}`).join('\n') || '• Nothing due'}\n${events.map((e) => `• Event: ${e.name}`).join('\n')}\n\nFINANCES\n• Income ${money(fin!.income)} · Expenses ${money(fin!.expenses)}\n\nIMPACT\n${impact.map((i) => `• ${i.name}: ${i.v} ${i.unit ?? ''}`).join('\n') || '• No impact entries this period'}\n\nRECOMMENDATIONS (suggestions)\n• Work through the ${opp!.n} high-priority fundraising moves on the Donors overview.\n${tasksOverdue!.n ? `• Clear ${tasksOverdue!.n} overdue tasks.\n` : ''}`;
    const row = await one(db, `INSERT INTO weekly_updates(tenant_id, ministry_id, period_start, period_end, content, generator, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id ?? null, b.period_start, b.period_end, content, ai ? 'claude' : 'template', req.auth!.userId]);
    await audit(db, actor(req), 'reports', 'weekly_update', `Generated weekly update ${b.period_start}–${b.period_end}`, { type: 'weekly_update', id: row.id });
    return row;
  });
  res.json(out);
}));
moneyRouter.get('/updates', h(async (req, res) => {
  requirePerm(req.auth, 'reports.read');
  res.json(await tx(req, (db) => many(db, `SELECT w.*, m.name ministry_name, u.name author FROM weekly_updates w LEFT JOIN ministries m ON m.id=w.ministry_id LEFT JOIN users u ON u.id=w.created_by ORDER BY w.created_at DESC LIMIT 50`)));
}));
moneyRouter.patch('/updates/:id', h(async (req, res) => {
  requirePerm(req.auth, 'reports.read');
  const b = parse(z.object({ content: z.string().min(1), status: z.enum(['draft', 'final']).optional() }), req.body);
  res.json(await tx(req, (db) => one(db, `UPDATE weekly_updates SET content=$2, status=coalesce($3,status) WHERE id=$1 RETURNING *`, [req.params.id, b.content, b.status ?? null])));
}));
moneyRouter.get('/updates/:id/pdf', h(async (req, res) => {
  requirePerm(req.auth, 'reports.read', 'data.export');
  const { u, t } = await tx(req, async (db) => ({ u: await one(db, `SELECT * FROM weekly_updates WHERE id=$1`, [req.params.id]), t: await one(db, `SELECT name FROM tenants WHERE id=$1`, [req.auth!.tenantId]) }));
  if (!u) throw notFound('Update');
  renderPdf(res, `Weekly update ${u.period_start}.pdf`, { title: 'Weekly Update', subtitle: `${u.period_start} → ${u.period_end}`, org: t.name, blocks: u.content.split(/\n{2,}/).map((p: string) => ({ type: 'p' as const, text: p })) });
}));

/** Post Giving: move undeposited gift funds into a bank account, preserving fund balances. */
moneyRouter.get('/undeposited', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, async (db) => {
    const und = await accountByCode(db, '1050');
    return many(db, `SELECT f.id fund_id, f.name fund, f.restriction, sum(jl.debit-jl.credit)::float amount FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN funds f ON f.id=jl.fund_id
      WHERE jl.account_id=$1 GROUP BY f.id HAVING round(sum(jl.debit-jl.credit),2) <> 0 ORDER BY f.name`, [und]);
  }));
}));
moneyRouter.post('/deposit', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  const b = parse(z.object({ date: z.string(), bank_account_id: z.string().uuid(), memo: z.string().optional() }), req.body);
  const e = await tx(req, async (db) => {
    const und = await accountByCode(db, '1050');
    const rows = await many(db, `SELECT jl.fund_id, round(sum(jl.debit-jl.credit),2)::float amt FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=$1 GROUP BY 1 HAVING round(sum(jl.debit-jl.credit),2) > 0`, [und]);
    if (!rows.length) throw badRequest('There are no undeposited gifts.');
    const lines = rows.flatMap((r) => [{ account_id: b.bank_account_id, fund_id: r.fund_id, debit: r.amt }, { account_id: und, fund_id: r.fund_id, credit: r.amt }]);
    const entry = await createEntry(db, req.auth!.tenantId, req.auth!.userId, { entry_date: b.date, memo: b.memo || 'Bank deposit of gifts', source: 'manual', lines });
    await audit(db, actor(req), 'accounting', 'deposit', `Deposited ${rows.reduce((a, r) => a + r.amt, 0).toFixed(2)} of gifts`, { type: 'journal', id: entry.id });
    return entry;
  });
  res.status(201).json(e);
}));
