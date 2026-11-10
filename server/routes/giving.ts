import { Router, type Request } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, ministryScope, assertMinistry, actor } from '../lib/auth.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, type Db } from '../db/pool.js';
import { DONOR_NAME_SQL, fmtMoney2, today, donorName } from '../lib/util.js';
import { postGift, repostGift, postRefund, voidEntry } from '../services/ledger.js';
import { recalcDonors } from '../services/intelligence.js';
import { createDonor } from './donors.js';
import { renderPdf } from '../services/pdf.js';
import { sendTable } from '../services/exporter.js';
import { requireTransport } from '../services/email.js';
import PDFDocument from 'pdfkit';

export const givingRouter = Router();

const giftSchema = z.object({
  donor_id: z.string().uuid().optional(),
  new_donor: z.record(z.string(), z.any()).optional(),
  amount: z.coerce.number().positive('Gift amount must be greater than zero'),
  gift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Gift date must be YYYY-MM-DD'),
  fund_id: z.string().uuid({ message: 'Choose a designation / fund' }),
  campaign_id: z.string().uuid().nullish(), project_id: z.string().uuid().nullish(), email_campaign_id: z.string().uuid().nullish(),
  gift_type: z.string().default('one_time'), payment_method: z.string().default('check'),
  follow_up_user_id: z.string().uuid().nullish(),
  receipt_status: z.enum(['pending', 'sent', 'not_required']).default('pending'),
  thank_you_status: z.enum(['pending', 'sent', 'not_required']).default('pending'),
  notes: z.string().nullish(), ministry_id: z.string().uuid().nullish(), batch_id: z.string().uuid().nullish(),
  deposit_account_id: z.string().uuid().nullish(),
  recurring: z.object({ frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']) }).optional(),
});

/** Create a gift, its donor if new, the ledger entry, and refresh donor intelligence — atomically. */
export async function createGift(db: Db, req: Request, raw: unknown, opts: { forceNewDonor?: boolean; provider?: string; providerTxnId?: string } = {}) {
  const g = parse(giftSchema, raw);
  let donorId = g.donor_id;
  if (!donorId) {
    if (!g.new_donor) throw badRequest('Choose a donor or enter a new donor.');
    donorId = (await createDonor(db, req, { ...g.new_donor, ministry_id: g.new_donor.ministry_id ?? g.ministry_id }, { skipDuplicateCheck: opts.forceNewDonor })).id;
  }
  const donor = await one(db, `SELECT id, ministry_id FROM donors WHERE id=$1 AND NOT archived`, [donorId]);
  if (!donor) throw badRequest('That donor was not found (or is archived).');
  const ministryId = g.ministry_id ?? donor.ministry_id ?? null;
  assertMinistry(req.auth!, ministryId);
  const fund = await one(db, `SELECT id, archived FROM funds WHERE id=$1`, [g.fund_id]);
  if (!fund || fund.archived) throw badRequest('Choose an active fund / designation.');
  let recurringId: string | null = null;
  if (!g.recurring && g.gift_type === 'recurring') {
    // A payment on an existing plan: link to the donor's active plan for this fund (or any active plan).
    const plan = await one(db, `SELECT id FROM recurring_gifts WHERE donor_id=$1 AND status='active' ORDER BY (fund_id=$2) DESC, created_at LIMIT 1`, [donorId, g.fund_id]);
    recurringId = plan?.id ?? null;
  }
  if (g.recurring) {
    const r = await one(db, `INSERT INTO recurring_gifts(tenant_id, donor_id, amount, frequency, fund_id, started_on, next_date, provider, provider_ref)
      VALUES ($1,$2,$3,$4,$5,$6,($6::date + CASE $4 WHEN 'weekly' THEN 7 WHEN 'monthly' THEN 30 WHEN 'quarterly' THEN 91 ELSE 365 END), $7, $8) RETURNING id`,
      [req.auth!.tenantId, donorId, g.amount, g.recurring?.frequency ?? 'monthly', g.fund_id, g.gift_date, opts.provider ?? null, opts.providerTxnId ? `sub_${opts.providerTxnId}` : null]);
    recurringId = r.id;
  }
  const gift = await one(db, `INSERT INTO gifts(tenant_id, ministry_id, donor_id, amount, gift_date, fund_id, campaign_id, project_id, email_campaign_id, gift_type, payment_method, recurring_gift_id,
      batch_id, follow_up_user_id, receipt_status, thank_you_status, notes, provider, provider_txn_id, deposit_account_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [req.auth!.tenantId, ministryId, donorId, g.amount, g.gift_date, g.fund_id, g.campaign_id ?? null, g.project_id ?? null, g.email_campaign_id ?? null, g.gift_type, g.payment_method, recurringId,
     g.batch_id ?? null, g.follow_up_user_id ?? null, g.receipt_status, g.thank_you_status, g.notes ?? null, opts.provider ?? 'manual', opts.providerTxnId ?? null, g.deposit_account_id ?? null, req.auth!.userId]);
  await postGift(db, req.auth!.tenantId, req.auth!.userId, gift.id);
  const prior = await one(db, `SELECT count(*)::int n FROM gifts WHERE donor_id=$1 AND id<>$2`, [donorId, gift.id]);
  await recalcDonors(db, donorId);
  if (g.follow_up_user_id) {
    await db.query(`INSERT INTO notifications(tenant_id,user_id,type,title,body,link) VALUES ($1,$2,'follow_up','Gift follow-up assigned to you',$3,$4)`,
      [req.auth!.tenantId, g.follow_up_user_id, `A gift of ${g.amount} needs your follow-up.`, `/donors/${donorId}`]);
  }
  await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.trigger',$2)`, [req.auth!.tenantId,
    { trigger: prior!.n === 0 ? 'first_gift' : g.campaign_id ? 'campaign_gift' : 'gift', donorId, giftId: gift.id }]);
  if (recurringId) await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.trigger',$2)`, [req.auth!.tenantId, { trigger: 'recurring_started', donorId }]);
  await audit(db, actor(req), 'giving', 'create', `Recorded gift of ${g.amount.toFixed(2)} on ${g.gift_date}`, { type: 'gift', id: gift.id }, { donorId });
  return gift;
}

function giftListQuery(req: Request) {
  const p: unknown[] = []; const w = [ministryScope(req.auth!, 'g.ministry_id', p)];
  const qv = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
  if (qv('from')) { p.push(qv('from')); w.push(`g.gift_date >= $${p.length}`); }
  if (qv('to')) { p.push(qv('to')); w.push(`g.gift_date <= $${p.length}`); }
  for (const f of ['fund_id', 'campaign_id', 'project_id', 'donor_id', 'batch_id', 'ministry_id', 'payment_method', 'gift_type', 'receipt_status', 'thank_you_status', 'provider', 'email_campaign_id']) {
    if (qv(f)) { p.push(qv(f)); w.push(`g.${f}::text = $${p.length}`); }
  }
  if (qv('q')) { p.push(`%${qv('q')}%`); w.push(`(${DONOR_NAME_SQL()} ILIKE $${p.length} OR g.notes ILIKE $${p.length} OR g.amount::text LIKE $${p.length} OR g.provider_txn_id ILIKE $${p.length})`); }
  if (req.query.include_refunded !== 'true') w.push('NOT g.refunded');
  return { where: w.join(' AND '), params: p };
}
const GIFT_COLS = `g.*, ${DONOR_NAME_SQL()} AS donor_name, f.name fund_name, f.restriction, c.name campaign_name, p.name project_name, m.name ministry_name, je.status ledger_status`;
const GIFT_JOINS = `FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN funds f ON f.id=g.fund_id LEFT JOIN campaigns c ON c.id=g.campaign_id LEFT JOIN projects p ON p.id=g.project_id LEFT JOIN ministries m ON m.id=g.ministry_id LEFT JOIN journal_entries je ON je.id=g.journal_entry_id`;

givingRouter.get('/gifts', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const { where, params } = giftListQuery(req);
  const limit = Math.min(Number(req.query.limit ?? 50), 1000), offset = Number(req.query.offset ?? 0);
  const out = await tx(req, async (db) => ({
    rows: await many(db, `SELECT ${GIFT_COLS} ${GIFT_JOINS} WHERE ${where} ORDER BY g.gift_date DESC, g.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
    ...(await one(db, `SELECT count(*)::int total, coalesce(sum(g.amount),0)::float sum ${GIFT_JOINS} WHERE ${where}`, params)), limit, offset,
  }));
  res.json(out);
}));

givingRouter.get('/gifts/export', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read', 'data.export');
  const { where, params } = giftListQuery(req);
  const rows = await tx(req, async (db) => {
    const r = await many(db, `SELECT ${GIFT_COLS} ${GIFT_JOINS} WHERE ${where} ORDER BY g.gift_date DESC LIMIT 100000`, params);
    await audit(db, actor(req), 'export', 'export', `Exported ${r.length} gifts`, { type: 'gift' });
    return r;
  });
  const cols = ['gift_date', 'donor_name', 'amount', 'fund_name', 'restriction', 'campaign_name', 'project_name', 'gift_type', 'payment_method', 'receipt_status', 'thank_you_status', 'provider', 'provider_txn_id', 'ministry_name', 'notes'];
  await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `gifts-${today()}`, cols.map((k) => ({ key: k, label: k })), rows);
}));

givingRouter.post('/gifts', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const gift = await tx(req, (db) => createGift(db, req, req.body, { forceNewDonor: req.query.force === 'true' }));
  res.status(201).json(gift);
}));

/** Batch gift entry — all gifts post together or none do. */
givingRouter.post('/gifts/batch', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const b = parse(z.object({ name: z.string().min(1), gifts: z.array(z.record(z.string(), z.any())).min(1).max(500) }), req.body);
  const out = await tx(req, async (db) => {
    const batch = await one(db, `INSERT INTO gift_batches(tenant_id,name,status,created_by) VALUES ($1,$2,'closed',$3) RETURNING *`, [req.auth!.tenantId, b.name, req.auth!.userId]);
    const ids: string[] = [];
    for (let i = 0; i < b.gifts.length; i++) {
      try { ids.push((await createGift(db, req, { ...b.gifts[i], batch_id: batch.id }, { forceNewDonor: true })).id); }
      catch (e: any) { throw badRequest(`Row ${i + 1}: ${e.message}`); }
    }
    await audit(db, actor(req), 'giving', 'batch', `Posted batch “${b.name}” with ${ids.length} gifts`, { type: 'gift_batch', id: batch.id });
    return { batch, count: ids.length };
  });
  res.status(201).json(out);
}));

givingRouter.get('/gifts/:id', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const g = await tx(req, async (db) => {
    const p: unknown[] = [req.params.id];
    const gift = await one(db, `SELECT ${GIFT_COLS} ${GIFT_JOINS} WHERE g.id=$1 AND ${ministryScope(req.auth!, 'g.ministry_id', p)}`, p);
    if (!gift) throw notFound('Gift');
    gift.ledger = gift.journal_entry_id ? await many(db, `SELECT jl.*, a.code, a.name account_name, f.name fund_name FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id WHERE jl.entry_id=$1`, [gift.journal_entry_id]) : [];
    gift.payment = await one(db, `SELECT * FROM payment_transactions WHERE gift_id=$1 LIMIT 1`, [gift.id]);
    gift.receipts = await many(db, `SELECT * FROM receipts WHERE gift_id=$1 ORDER BY issued_at DESC`, [gift.id]);
    return gift;
  });
  res.json(g);
}));

givingRouter.patch('/gifts/:id', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const b = parse(giftSchema.partial().omit({ new_donor: true, recurring: true }), req.body);
  const out = await tx(req, async (db) => {
    const cur = await one(db, `SELECT * FROM gifts WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!cur) throw notFound('Gift');
    assertMinistry(req.auth!, cur.ministry_id);
    if (cur.refunded) throw conflict('Refunded gifts cannot be edited.');
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (!keys.length) throw badRequest('Nothing to update.');
    const g = await one(db, `UPDATE gifts SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [cur.id, ...keys.map((k) => (b as any)[k])]);
    const ledgerFields = ['amount', 'gift_date', 'fund_id', 'project_id', 'donor_id', 'deposit_account_id', 'gift_type'];
    if (keys.some((k) => ledgerFields.includes(k))) {
      await repostGift(db, req.auth!.tenantId, req.auth!.userId, g.id);
      const rc = await one(db, `SELECT id FROM receipts WHERE gift_id=$1 AND status IN ('created','delivered') LIMIT 1`, [g.id]);
      if (rc) await db.query(`UPDATE gifts SET receipt_status='pending' WHERE id=$1`, [g.id]); // amount/date changed — needs corrected receipt
    }
    await recalcDonors(db, g.donor_id);
    if (cur.donor_id !== g.donor_id) await recalcDonors(db, cur.donor_id);
    await audit(db, actor(req), 'giving', 'update', `Edited gift ${g.id.slice(0, 8)} (${keys.join(', ')})`, { type: 'gift', id: g.id }, { before: Object.fromEntries(keys.map((k) => [k, cur[k]])) });
    return g;
  });
  res.json(out);
}));

givingRouter.post('/gifts/:id/refund', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write', 'finance.write');
  const { amount, reason } = parse(z.object({ amount: z.number().positive().optional(), reason: z.string().optional() }), req.body ?? {});
  await tx(req, async (db) => {
    const g = await one(db, `SELECT * FROM gifts WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!g) throw notFound('Gift'); if (g.refunded) throw conflict('Gift is already refunded.');
    assertMinistry(req.auth!, g.ministry_id);
    if (g.provider && g.provider !== 'manual') throw badRequest(`This gift came from ${g.provider}. Issue the refund in ${g.provider}; it will sync back automatically.`);
    await postRefund(db, req.auth!.tenantId, req.auth!.userId, g.id, amount);
    await recalcDonors(db, g.donor_id);
    await audit(db, actor(req), 'giving', 'refund', `Recorded refund of gift ${g.id.slice(0, 8)}${reason ? `: ${reason}` : ''}`, { type: 'gift', id: g.id }, { amount });
  });
  res.json({ ok: true });
}));

givingRouter.delete('/gifts/:id', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write', 'finance.approve');
  await tx(req, async (db) => {
    const g = await one(db, `SELECT * FROM gifts WHERE id=$1`, [req.params.id]);
    if (!g) throw notFound('Gift');
    if (await one(db, `SELECT 1 FROM receipts WHERE gift_id=$1 AND status<>'void'`, [g.id])) throw conflict('This gift has an issued receipt. Void the receipt first, or record a refund instead.');
    if (g.journal_entry_id) await voidEntry(db, g.journal_entry_id);
    await db.query(`UPDATE payment_transactions SET gift_id=NULL, status='unmatched' WHERE gift_id=$1`, [g.id]);
    await db.query(`DELETE FROM gifts WHERE id=$1`, [g.id]);
    await recalcDonors(db, g.donor_id);
    await audit(db, actor(req), 'giving', 'delete', `Deleted gift of ${g.amount} on ${g.gift_date} (ledger entry voided)`, { type: 'gift', id: g.id }, { gift: g });
  });
  res.json({ ok: true });
}));

// ───────── Receipts ─────────
async function nextReceiptNumber(db: Db) {
  const r = await one(db, `SELECT count(*)::int n FROM receipts`);
  return `R-${new Date().getFullYear()}-${String((r!.n ?? 0) + 1).padStart(5, '0')}`;
}

givingRouter.post('/receipts/generate', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const b = parse(z.object({ giftIds: z.array(z.string().uuid()).min(1).max(1000) }), req.body);
  const created = await tx(req, async (db) => {
    const t = await one(db, `SELECT tax_jurisdiction FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const out: any[] = [];
    for (const id of b.giftIds) {
      const g = await one(db, `SELECT * FROM gifts WHERE id=$1 AND NOT refunded`, [id]);
      if (!g) continue;
      const existing = await one(db, `SELECT * FROM receipts WHERE gift_id=$1 AND status IN ('created','delivered') ORDER BY issued_at DESC LIMIT 1`, [id]);
      if (existing && Number(existing.amount) === Number(g.amount)) { out.push(existing); continue; }
      if (existing) await db.query(`UPDATE receipts SET status='corrected' WHERE id=$1`, [existing.id]);
      out.push(await one(db, `INSERT INTO receipts(tenant_id, gift_id, donor_id, number, amount, jurisdiction, replaces_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.auth!.tenantId, g.id, g.donor_id, await nextReceiptNumber(db), g.amount, t.tax_jurisdiction, existing?.id ?? null]));
    }
    await audit(db, actor(req), 'giving', 'receipts', `Generated ${out.length} receipt(s)`, { type: 'receipt' });
    return out;
  });
  res.json({ receipts: created });
}));

givingRouter.post('/receipts/annual', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const { year } = parse(z.object({ year: z.number().int().min(2000).max(2100) }), req.body);
  const n = await tx(req, async (db) => {
    const t = await one(db, `SELECT tax_jurisdiction FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const rows = await many(db, `SELECT donor_id, sum(amount)::float total FROM gifts WHERE NOT refunded AND extract(year from gift_date)=$1 GROUP BY donor_id`, [year]);
    let c = 0;
    for (const r of rows) {
      if (await one(db, `SELECT 1 FROM receipts WHERE donor_id=$1 AND kind='annual' AND period_start=$2 AND status<>'void'`, [r.donor_id, `${year}-01-01`])) continue;
      await db.query(`INSERT INTO receipts(tenant_id, donor_id, number, kind, period_start, period_end, amount, jurisdiction) VALUES ($1,$2,$3,'annual',$4,$5,$6,$7)`,
        [req.auth!.tenantId, r.donor_id, await nextReceiptNumber(db), `${year}-01-01`, `${year}-12-31`, r.total, t.tax_jurisdiction]); c++;
    }
    await audit(db, actor(req), 'giving', 'receipts', `Generated ${c} annual giving statements for ${year}`, { type: 'receipt' });
    return c;
  });
  res.json({ created: n });
}));

givingRouter.get('/receipts', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const rows = await tx(req, (db) => many(db, `SELECT r.*, ${DONOR_NAME_SQL()} AS donor_name, d.email FROM receipts r JOIN donors d ON d.id=r.donor_id
    WHERE ($1::text IS NULL OR r.status=$1) AND ($2::uuid IS NULL OR r.donor_id=$2) ORDER BY r.issued_at DESC LIMIT 500`, [req.query.status ?? null, req.query.donor_id ?? null]));
  res.json({ rows });
}));

async function receiptData(db: Db, id: string) {
  const r = await one(db, `SELECT r.*, d.*, r.id receipt_id, r.amount::float receipt_amount, ${DONOR_NAME_SQL()} AS donor_name FROM receipts r JOIN donors d ON d.id=r.donor_id WHERE r.id=$1`, [id]);
  if (!r) throw notFound('Receipt');
  const t = await one(db, `SELECT * FROM tenants WHERE id = current_setting('app.tenant_id')::uuid`);
  const gifts = r.kind === 'annual'
    ? await many(db, `SELECT g.gift_date, g.amount::float, f.name fund, g.gift_type, g.payment_method FROM gifts g JOIN funds f ON f.id=g.fund_id WHERE g.donor_id=$1 AND NOT g.refunded AND g.gift_date BETWEEN $2 AND $3 ORDER BY g.gift_date`, [r.donor_id, r.period_start, r.period_end])
    : await many(db, `SELECT g.gift_date, g.amount::float, f.name fund, g.gift_type, g.payment_method FROM gifts g JOIN funds f ON f.id=g.fund_id WHERE g.id=$1`, [r.gift_id]);
  return { r, t, gifts };
}

/** Jurisdiction-specific receipt wording (US IRS / Canada CRA / generic). */
function receiptLanguage(t: any, r: any) {
  const rs = t.receipt_settings ?? {};
  if (t.tax_jurisdiction === 'CA-CRA') {
    return [`Official receipt for income tax purposes. Charitable registration number: ${t.tax_id ?? '[set in Settings]'}.`,
      `Eligible amount of gift for tax purposes: ${fmtMoney2(r.receipt_amount, t.currency, t.locale)}. Advantage: ${fmtMoney2(rs.advantage ?? 0, t.currency, t.locale)}.`,
      `Canada Revenue Agency: www.canada.ca/charities-giving`, `Location issued: ${t.city ?? '—'}, ${t.region ?? ''}`];
  }
  if (t.tax_jurisdiction === 'US-IRS') {
    return [`${t.legal_name ?? t.name} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. EIN: ${t.tax_id ?? '[set in Settings]'}.`,
      rs.goodsServicesStatement ?? 'No goods or services were provided in exchange for this contribution.',
      'Please retain this receipt for your tax records.'];
  }
  return [rs.statement ?? 'Thank you for your contribution. Please retain this receipt for your records.'];
}

function drawReceipt(doc: PDFKit.PDFDocument, d: Awaited<ReturnType<typeof receiptData>>) {
  const { r, t, gifts } = d;
  doc.fillColor('#4f46e5').font('Helvetica-Bold').fontSize(18).text(t.legal_name ?? t.name);
  doc.fillColor('#6b7280').font('Helvetica').fontSize(9).text([t.address1, [t.city, t.region, t.postal_code].filter(Boolean).join(' '), t.email, t.phone].filter(Boolean).join(' · '));
  doc.moveDown(1.5).fillColor('#111827').font('Helvetica-Bold').fontSize(14).text(r.kind === 'annual' ? `Annual Giving Statement ${String(r.period_start).slice(0, 4)}` : 'Donation Receipt');
  if (r.status === 'void') doc.fillColor('#dc2626').fontSize(12).text('VOID');
  if (r.replaces_id) doc.fillColor('#b45309').fontSize(9).text('Corrected receipt — replaces a previously issued receipt.');
  doc.moveDown(0.5).fillColor('#111827').font('Helvetica').fontSize(10);
  doc.text(`Receipt #: ${r.number}`).text(`Date issued: ${new Date(r.issued_at).toISOString().slice(0, 10)}`).moveDown(0.5);
  doc.font('Helvetica-Bold').text(r.donor_name).font('Helvetica').text([r.address1, r.address2, [r.city, r.region, r.postal_code].filter(Boolean).join(' '), r.country].filter(Boolean).join('\n'));
  doc.moveDown(1);
  for (const g of gifts) doc.text(`${g.gift_date}   ${fmtMoney2(g.amount, t.currency, t.locale).padStart(14)}   ${g.fund} · ${g.payment_method}`);
  doc.moveDown(0.5).font('Helvetica-Bold').text(`Total: ${fmtMoney2(r.receipt_amount, t.currency, t.locale)}`).font('Helvetica').moveDown(1);
  for (const line of receiptLanguage(t, r)) doc.fontSize(9).fillColor('#374151').text(line).moveDown(0.3);
  doc.moveDown(1).fontSize(9).fillColor('#6b7280').text(t.receipt_settings?.signatory ? `Authorized signature: ${t.receipt_settings.signatory}` : '');
}

givingRouter.get('/receipts/:id/pdf', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const d = await tx(req, (db) => receiptData(db, String(req.params.id)));
  const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${d.r.number}.pdf"`);
  doc.pipe(res); drawReceipt(doc, d); doc.end();
}));

/** Batch PDF: all receipts in one printable document. */
givingRouter.post('/receipts/batch-pdf', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }), req.body);
  const data = await tx(req, async (db) => { const out = []; for (const id of ids) out.push(await receiptData(db, id)); return out; });
  const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipts-${today()}.pdf"`);
  doc.pipe(res);
  data.forEach((d, i) => { if (i) doc.addPage(); drawReceipt(doc, d); });
  doc.end();
}));

/** Deliver receipts by email (explicit user action). */
givingRouter.post('/receipts/deliver', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }), req.body);
  const result = await tx(req, async (db) => {
    const transport = await requireTransport(db, req.auth!.userId);
    let sent = 0; const skipped: string[] = [];
    for (const id of ids) {
      const d = await receiptData(db, id);
      if (!d.r.email || d.r.status === 'void') { skipped.push(`${d.r.donor_name}: ${d.r.email ? 'void' : 'no email'}`); continue; }
      const pdf = await new Promise<Buffer>((resolve) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 60 }); const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); drawReceipt(doc, d); doc.end();
      });
      await transport.t.sendMail({ from: transport.from, to: d.r.email, subject: `Your receipt from ${d.t.name} (${d.r.number})`,
        text: `Dear ${d.r.first_name ?? 'friend'},\n\nThank you for your generosity. Your receipt is attached.\n\n${d.t.name}`, attachments: [{ filename: `receipt-${d.r.number}.pdf`, content: pdf }] });
      await db.query(`UPDATE receipts SET status='delivered', delivered_at=now() WHERE id=$1`, [id]);
      if (d.r.gift_id) await db.query(`UPDATE gifts SET receipt_status='sent' WHERE id=$1`, [d.r.gift_id]);
      sent++;
    }
    await audit(db, actor(req), 'giving', 'receipts_delivered', `Emailed ${sent} receipt(s)`, { type: 'receipt' }, { skipped });
    return { sent, skipped };
  });
  res.json(result);
}));

givingRouter.post('/receipts/:id/status', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const { status } = parse(z.object({ status: z.enum(['delivered', 'void']) }), req.body);
  await tx(req, async (db) => {
    const r = await one(db, `UPDATE receipts SET status=$2, delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END WHERE id=$1 RETURNING *`, [req.params.id, status]);
    if (!r) throw notFound('Receipt');
    if (r.gift_id) await db.query(`UPDATE gifts SET receipt_status=$2 WHERE id=$1`, [r.gift_id, status === 'delivered' ? 'sent' : 'pending']);
    await audit(db, actor(req), 'giving', `receipt_${status}`, `Marked receipt ${r.number} ${status}`, { type: 'receipt', id: r.id });
  });
  res.json({ ok: true });
}));

export const _n = { donorName };
