/**
 * Integrations: QuickBooks Online, Stripe, Square, PayPal, Google (Gmail/Calendar), Plaid.
 * Secrets are AES-256-GCM encrypted at rest and never returned to the browser.
 * Payment events are idempotent (unique provider transaction ids) and every
 * sync action is recorded in sync_records + audit_events.
 */
import crypto from 'node:crypto';
import type { Request } from 'express';
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { config } from '../config.js';
import { encryptJson, decryptJson, timingSafeEqualStr } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { round2 } from '../lib/util.js';
import type { AuthContext } from '../lib/auth.js';
import { PERMISSIONS } from '../lib/permissions.js';

export const PROVIDERS = {
  quickbooks: { label: 'QuickBooks Online', kind: 'oauth', description: 'Two-way accounting sync: chart of accounts, classes (funds), and journal entries for gifts, expenses and journals.' },
  stripe: { label: 'Stripe', kind: 'apikey', description: 'Online donations, recurring gifts, refunds and failed payments via signed webhooks.' },
  square: { label: 'Square', kind: 'apikey', description: 'In-person and online payments via signed webhooks.' },
  paypal: { label: 'PayPal', kind: 'apikey', description: 'PayPal donations, refunds and disputes via verified webhooks.' },
  google: { label: 'Gmail & Calendar', kind: 'oauth', description: 'Send user-approved emails from your Gmail and add meetings/follow-ups to Google Calendar.' },
  plaid: { label: 'Bank feed (Plaid)', kind: 'oauth', description: 'Import bank transactions for review, matching and reconciliation.' },
} as const;
export type Provider = keyof typeof PROVIDERS;

export function systemReq(tenantId: string): Request {
  const auth: AuthContext = { userId: null as any, email: 'system', name: 'Integration', tenantId, membershipId: '', roleName: 'system',
    permissions: new Set(Object.keys(PERMISSIONS)), allMinistries: true, ministryIds: [], isPlatformOwner: false };
  return { auth, ip: 'integration' } as unknown as Request;
}

export async function getIntegration(db: Db, provider: string, userId: string | null = null) {
  return one(db, `SELECT * FROM integrations WHERE provider=$1 AND user_id IS NOT DISTINCT FROM $2`, [provider, userId]);
}
export async function upsertIntegration(db: Db, tenantId: string, provider: string, userId: string | null, data: { status?: string; config?: any; secrets?: any; connectedBy?: string | null; lastError?: string | null }) {
  const cur = await getIntegration(db, provider, userId);
  const secrets = data.secrets ? encryptJson({ ...(decryptJson(cur?.secrets_enc) ?? {}), ...data.secrets }) : cur?.secrets_enc ?? null;
  if (cur) {
    return one(db, `UPDATE integrations SET status=coalesce($2,status), config=config || $3::jsonb, secrets_enc=$4, connected_by=coalesce($5,connected_by), last_error=$6 WHERE id=$1 RETURNING *`,
      [cur.id, data.status ?? null, JSON.stringify(data.config ?? {}), secrets, data.connectedBy ?? null, data.lastError ?? null]);
  }
  return one(db, `INSERT INTO integrations(tenant_id, provider, user_id, status, config, secrets_enc, connected_by, last_error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenantId, provider, userId, data.status ?? 'disconnected', data.config ?? {}, secrets, data.connectedBy ?? null, data.lastError ?? null]);
}
export function publicView(i: any) {
  if (!i) return null;
  const { secrets_enc, ...rest } = i;
  return { ...rest, hasSecrets: Boolean(secrets_enc) };
}

// ── OAuth state (signed, short-lived) ──
export function signState(payload: object) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyState<T = any>(state: string): T {
  const [body, sig] = String(state).split('.');
  const expect = crypto.createHmac('sha256', config.jwtSecret).update(body ?? '').digest('base64url');
  if (!sig || !timingSafeEqualStr(sig, expect)) throw badRequest('Invalid OAuth state.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (p.exp < Date.now()) throw badRequest('The connection request expired. Please try again.');
  return p;
}

// ───────────────────────── QuickBooks Online ─────────────────────────
const QBO_AUTH = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const qboBase = () => (config.quickbooks.environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');

export function qboAuthUrl(tenantId: string, userId: string) {
  if (!config.quickbooks.clientId) throw badRequest('QuickBooks is not configured on this server (QBO_CLIENT_ID / QBO_CLIENT_SECRET).');
  const p = new URLSearchParams({ client_id: config.quickbooks.clientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: `${config.apiUrl}/api/integrations/quickbooks/callback`, state: signState({ tenantId, userId, p: 'quickbooks' }) });
  return `${QBO_AUTH}?${p}`;
}
async function qboTokenRequest(body: Record<string, string>) {
  const r = await fetch(QBO_TOKEN, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${config.quickbooks.clientId}:${config.quickbooks.clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw badRequest(`QuickBooks token error: ${j.error_description ?? j.error ?? r.status}`);
  return j;
}
export async function qboExchange(code: string) {
  return qboTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: `${config.apiUrl}/api/integrations/quickbooks/callback` });
}
async function qboAccess(db: Db, tenantId: string) {
  const i = await getIntegration(db, 'quickbooks');
  if (!i || i.status !== 'connected') throw badRequest('QuickBooks is not connected.');
  const s = decryptJson<any>(i.secrets_enc);
  if (!s?.refresh_token) throw badRequest('QuickBooks credentials are missing. Reconnect QuickBooks.');
  if (!s.access_token || !s.expires_at || s.expires_at < Date.now() + 60_000) {
    const t = await qboTokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh_token });
    await upsertIntegration(db, tenantId, 'quickbooks', null, { secrets: { access_token: t.access_token, refresh_token: t.refresh_token ?? s.refresh_token, expires_at: Date.now() + t.expires_in * 1000 } });
    s.access_token = t.access_token;
  }
  return { token: s.access_token as string, realmId: i.config.realmId as string, integration: i };
}
export async function qboFetch(db: Db, tenantId: string, path: string, init: RequestInit = {}) {
  const { token, realmId } = await qboAccess(db, tenantId);
  const r = await fetch(`${qboBase()}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=73`, { ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.Fault?.Error?.map((e: any) => `${e.Message}: ${e.Detail}`).join('; ') ?? `QuickBooks HTTP ${r.status}`);
  return j;
}
export async function qboListRefs(db: Db, tenantId: string) {
  const accounts = await qboFetch(db, tenantId, `/query?query=${encodeURIComponent('select Id, Name, AccountType, AcctNum from Account maxresults 1000')}`);
  const classes = await qboFetch(db, tenantId, `/query?query=${encodeURIComponent('select Id, Name from Class maxresults 1000')}`).catch(() => ({ QueryResponse: {} }));
  return { accounts: accounts.QueryResponse?.Account ?? [], classes: classes.QueryResponse?.Class ?? [] };
}

/** Push one ledger entry to QBO as a JournalEntry. Idempotent via sync_records + QBO requestid. */
export async function qboPushEntry(db: Db, tenantId: string, entryId: string) {
  const key = `journal:${entryId}`;
  const entry = await one(db, `SELECT * FROM journal_entries WHERE id=$1`, [entryId]);
  if (!entry) return;
  const rec = await one(db, `INSERT INTO sync_records(tenant_id, provider, entity_type, internal_id, idempotency_key, status) VALUES ($1,'quickbooks','journal',$2,$3,'queued')
    ON CONFLICT (tenant_id, provider, idempotency_key) DO UPDATE SET updated_at=now() RETURNING *`, [tenantId, entryId, key]);
  if (rec.status === 'synced' && entry.status !== 'void') return rec;
  if (rec.status === 'synced' && entry.status === 'void') {
    // Never silently delete in QBO: flag for human review.
    await db.query(`UPDATE sync_records SET status='conflict', error='Entry was voided after syncing. Void or delete the matching QuickBooks journal entry (Id ${rec.external_id}) manually, then mark resolved.', updated_at=now() WHERE id=$1`, [rec.id]);
    return;
  }
  if (entry.status !== 'posted') { await db.query(`UPDATE sync_records SET status='skipped', error='Not posted', updated_at=now() WHERE id=$1`, [rec.id]); return; }
  const lines = await many(db, `SELECT jl.*, a.code, a.name account_name, f.name fund_name,
      (SELECT external_id FROM integration_mappings m WHERE m.provider='quickbooks' AND m.entity_type='account' AND m.internal_id=jl.account_id) qbo_account,
      (SELECT external_id FROM integration_mappings m WHERE m.provider='quickbooks' AND m.entity_type='fund' AND m.internal_id=jl.fund_id) qbo_class
    FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id WHERE jl.entry_id=$1`, [entryId]);
  const unmapped = [...new Set(lines.filter((l) => !l.qbo_account).map((l) => `${l.code} ${l.account_name}`))];
  if (unmapped.length) {
    await db.query(`UPDATE sync_records SET status='error', error=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`, [rec.id, `Unmapped account(s): ${unmapped.join(', ')}. Map them in Import/Sync › QuickBooks mappings.`]);
    return;
  }
  const body = { TxnDate: entry.entry_date, PrivateNote: `${entry.memo ?? ''} [A.I. Fundraising ${entryId.slice(0, 8)}]`.slice(0, 4000), DocNumber: `AINP-${entryId.slice(0, 8)}`,
    Line: lines.map((l) => ({ DetailType: 'JournalEntryLineDetail', Amount: round2(Number(l.debit) || Number(l.credit)), Description: l.description ?? undefined,
      JournalEntryLineDetail: { PostingType: Number(l.debit) > 0 ? 'Debit' : 'Credit', AccountRef: { value: l.qbo_account }, ...(l.qbo_class ? { ClassRef: { value: l.qbo_class } } : {}) } })) };
  try {
    const r = await qboFetch(db, tenantId, `/journalentry?requestid=${encodeURIComponent(`${tenantId.slice(0, 8)}-${entryId}`)}`, { method: 'POST', body: JSON.stringify(body) });
    const id = r.JournalEntry?.Id;
    await db.query(`UPDATE sync_records SET status='synced', external_id=$2, error=NULL, attempts=attempts+1, updated_at=now() WHERE id=$1`, [rec.id, id]);
    await db.query(`INSERT INTO integration_mappings(tenant_id, provider, entity_type, internal_id, external_id) VALUES ($1,'quickbooks','journal',$2,$3) ON CONFLICT (tenant_id, provider, entity_type, internal_id) DO UPDATE SET external_id=EXCLUDED.external_id, updated_at=now()`, [tenantId, entryId, id]);
    await audit(db, { tenantId, userId: null }, 'integrations', 'qbo_push', `Synced journal ${entryId.slice(0, 8)} to QuickBooks (Id ${id})`, { type: 'journal', id: entryId });
  } catch (e: any) {
    await db.query(`UPDATE sync_records SET status='error', error=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`, [rec.id, e.message.slice(0, 1000)]);
  }
  return rec;
}

/** QBO journal-entry CSV for date-range export (fallback when not connected). */
export async function qboExportRows(db: Db, from: string, to: string) {
  return many(db, `SELECT 'AINP-' || left(je.id::text, 8) "JournalNo", je.entry_date "JournalDate", je.memo "Memo", a.code || ' ' || a.name "AccountName",
      nullif(jl.debit,0)::float "Debits", nullif(jl.credit,0)::float "Credits", jl.description "Description", f.name "Class", je.source "Source"
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' JOIN accounts a ON a.id=jl.account_id JOIN funds f ON f.id=jl.fund_id
    WHERE je.entry_date BETWEEN $1 AND $2 ORDER BY je.entry_date, je.id, jl.debit DESC`, [from, to]);
}

// ───────────────────────── Payment ingestion (shared) ─────────────────────────
export interface PaymentEvent {
  provider: 'stripe' | 'square' | 'paypal';
  txnId: string; kind: 'payment' | 'refund' | 'dispute' | 'failure' | 'subscription';
  amount: number; currency?: string; occurredAt?: Date; email?: string | null; name?: string | null;
  metadata?: Record<string, string>; recurring?: { frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually'; ref: string } | null;
  refundOf?: string | null; raw: unknown;
}

export async function ingestPayment(db: Db, tenantId: string, ev: PaymentEvent) {
  const { createGift } = await import('../routes/giving.js');
  const { recalcDonors } = await import('./intelligence.js');
  const pt = await one(db, `INSERT INTO payment_transactions(tenant_id, provider, provider_txn_id, kind, amount, currency, occurred_at, payer_name, payer_email, raw)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, provider, provider_txn_id, kind) DO NOTHING RETURNING *`,
    [tenantId, ev.provider, ev.txnId, ev.kind, ev.amount, ev.currency ?? null, ev.occurredAt ?? new Date(), ev.name ?? null, ev.email ?? null, JSON.stringify(ev.raw)]);
  if (!pt) return { duplicate: true };   // idempotent: already processed

  if (ev.kind === 'refund' || ev.kind === 'dispute') {
    const g = await one(db, `SELECT * FROM gifts WHERE provider=$1 AND provider_txn_id=$2`, [ev.provider, ev.refundOf ?? ev.txnId]);
    if (g && ev.kind === 'refund' && !g.refunded) {
      const { postRefund } = await import('./ledger.js');
      await postRefund(db, tenantId, null, g.id, ev.amount);
      await recalcDonors(db, g.donor_id);
      await db.query(`UPDATE payment_transactions SET status='refunded', gift_id=$2 WHERE id=$1`, [pt.id, g.id]);
    } else {
      await db.query(`UPDATE payment_transactions SET status=$2, gift_id=$3 WHERE id=$1`, [pt.id, ev.kind === 'dispute' ? 'disputed' : 'unmatched', g?.id ?? null]);
    }
    await notifyFinance(db, tenantId, ev.kind === 'dispute' ? 'Payment dispute opened' : 'Refund received', `${ev.provider} ${ev.kind} of ${ev.amount}`, '/money/accounting/integrations');
    return { ok: true };
  }
  if (ev.kind === 'failure') {
    if (ev.recurring?.ref) await db.query(`UPDATE recurring_gifts SET status='failed' WHERE provider=$1 AND provider_ref=$2`, [ev.provider, ev.recurring.ref]);
    await db.query(`UPDATE payment_transactions SET status='failed' WHERE id=$1`, [pt.id]);
    await notifyFinance(db, tenantId, 'Recurring gift payment failed', `${ev.email ?? 'A donor'}: ${ev.amount}`, '/money/accounting/integrations');
    return { ok: true };
  }
  // Payment: match donor by email, map fund/campaign/project from metadata or integration defaults.
  const integ = await getIntegration(db, ev.provider);
  const cfg = integ?.config ?? {};
  const donor = ev.email ? await one(db, `SELECT id, ministry_id FROM donors WHERE lower(email)=lower($1) AND NOT archived AND merged_into IS NULL ORDER BY created_at LIMIT 1`, [ev.email]) : null;
  const md = ev.metadata ?? {};
  const fund = md.fund_id ? await one(db, `SELECT id FROM funds WHERE id::text=$1`, [md.fund_id]) : md.fund ? await one(db, `SELECT id FROM funds WHERE lower(name)=lower($1) OR lower(code)=lower($1)`, [md.fund]) : null;
  const fundId = fund?.id ?? cfg.default_fund_id;
  const canAutoCreate = Boolean(ev.email && (ev.name || ev.email) && cfg.auto_create_donors !== false);
  if (!fundId || (!donor && !canAutoCreate)) {
    await db.query(`UPDATE payment_transactions SET status='unmatched' WHERE id=$1`, [pt.id]);
    await notifyFinance(db, tenantId, 'Online gift needs review', `${ev.provider} payment of ${ev.amount} from ${ev.email ?? 'unknown payer'} could not be matched automatically.`, '/money/accounting/integrations');
    return { ok: true, queued: true };
  }
  const [first, ...rest] = String(ev.name ?? '').trim().split(/\s+/);
  const req = systemReq(tenantId);
  const gift = await createGift(db, req, {
    donor_id: donor?.id, new_donor: donor ? undefined : { donor_type: 'individual', first_name: first || null, last_name: rest.join(' ') || (first ? null : ev.email), email: ev.email, source: ev.provider },
    amount: ev.amount, gift_date: (ev.occurredAt ?? new Date()).toISOString().slice(0, 10), fund_id: fundId,
    campaign_id: md.campaign_id ?? cfg.default_campaign_id ?? null, project_id: md.project_id ?? null, gift_type: ev.recurring ? 'recurring' : 'one_time',
    payment_method: ev.provider, deposit_account_id: cfg.deposit_account_id ?? null, recurring: undefined,
  }, { forceNewDonor: true, provider: ev.provider, providerTxnId: ev.txnId });
  if (ev.recurring) {
    const existing = await one(db, `SELECT id FROM recurring_gifts WHERE provider=$1 AND provider_ref=$2`, [ev.provider, ev.recurring.ref]);
    const rid = existing?.id ?? (await one(db, `INSERT INTO recurring_gifts(tenant_id, donor_id, amount, frequency, fund_id, provider, provider_ref, started_on) VALUES ($1,$2,$3,$4,$5,$6,$7,current_date) RETURNING id`,
      [tenantId, gift.donor_id, ev.amount, ev.recurring.frequency, fundId, ev.provider, ev.recurring.ref])).id;
    await db.query(`UPDATE gifts SET recurring_gift_id=$2 WHERE id=$1`, [gift.id, rid]);
    await db.query(`UPDATE recurring_gifts SET status='active' WHERE id=$1`, [rid]);
  }
  await db.query(`UPDATE payment_transactions SET status='matched', gift_id=$2 WHERE id=$1`, [pt.id, gift.id]);
  return { ok: true, giftId: gift.id };
}

/** Manually resolve an unmatched payment into a gift (explicit user action). */
export async function resolvePayment(db: Db, req: Request, paymentId: string, input: { donor_id?: string; new_donor?: any; fund_id: string; campaign_id?: string | null; project_id?: string | null }) {
  const { createGift } = await import('../routes/giving.js');
  const p = await one(db, `SELECT * FROM payment_transactions WHERE id=$1 FOR UPDATE`, [paymentId]);
  if (!p) throw badRequest('Payment not found.');
  if (p.status !== 'unmatched' || p.kind !== 'payment') throw badRequest('Only unmatched payments can be resolved.');
  const gift = await createGift(db, req, { ...input, amount: Number(p.amount), gift_date: new Date(p.occurred_at).toISOString().slice(0, 10), payment_method: p.provider, gift_type: 'one_time' },
    { forceNewDonor: true, provider: p.provider, providerTxnId: p.provider_txn_id });
  await db.query(`UPDATE payment_transactions SET status='matched', gift_id=$2 WHERE id=$1`, [p.id, gift.id]);
  return gift;
}

async function notifyFinance(db: Db, tenantId: string, title: string, body: string, link: string) {
  const users = await many(db, `SELECT m.user_id FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=$1 AND m.status='active' AND ('finance.write' = ANY(r.permissions) OR 'integrations.manage' = ANY(r.permissions))`, [tenantId]);
  for (const u of users) await db.query(`INSERT INTO notifications(tenant_id,user_id,type,title,body,link) VALUES ($1,$2,'integration',$3,$4,$5)`, [tenantId, u.user_id, title, body, link]);
}

// ── Stripe ──
export function verifyStripe(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300) {
  if (!header) throw badRequest('Missing Stripe-Signature header.');
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]).filter(([k]) => k === 't')) as Record<string, string>;
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) throw badRequest('Stripe signature timestamp outside tolerance.');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  if (!sigs.some((s) => timingSafeEqualStr(s, expected))) throw badRequest('Invalid Stripe signature.');
}
export function stripeToEvents(evt: any): PaymentEvent[] {
  const o = evt.data?.object ?? {};
  const cents = (n: number, cur?: string) => (['jpy', 'krw'].includes(String(cur).toLowerCase()) ? n : n / 100);
  switch (evt.type) {
    case 'charge.succeeded': return [{ provider: 'stripe', txnId: o.payment_intent ?? o.id, kind: 'payment', amount: cents(o.amount, o.currency), currency: o.currency, occurredAt: new Date(o.created * 1000),
      email: o.billing_details?.email ?? o.receipt_email, name: o.billing_details?.name, metadata: o.metadata,
      recurring: o.invoice ? { frequency: 'monthly', ref: String(o.customer ?? o.invoice) } : null, raw: evt }];
    case 'charge.refunded': return [{ provider: 'stripe', txnId: `${o.payment_intent ?? o.id}:refund:${o.amount_refunded}`, refundOf: o.payment_intent ?? o.id, kind: 'refund', amount: cents(o.amount_refunded, o.currency), raw: evt }];
    case 'charge.dispute.created': return [{ provider: 'stripe', txnId: o.id, refundOf: o.payment_intent ?? o.charge, kind: 'dispute', amount: cents(o.amount, o.currency), raw: evt }];
    case 'invoice.payment_failed': return [{ provider: 'stripe', txnId: o.id, kind: 'failure', amount: cents(o.amount_due, o.currency), email: o.customer_email, recurring: { frequency: 'monthly', ref: String(o.customer) }, raw: evt }];
    default: return [];
  }
}
export async function stripeImportRecent(db: Db, tenantId: string) {
  const i = await getIntegration(db, 'stripe'); const s = decryptJson<any>(i?.secrets_enc);
  if (!s?.api_key) throw badRequest('Add a Stripe restricted API key first.');
  const r = await fetch('https://api.stripe.com/v1/charges?limit=100', { headers: { Authorization: `Bearer ${s.api_key}` } });
  const j: any = await r.json();
  if (!r.ok) throw badRequest(`Stripe: ${j.error?.message ?? r.status}`);
  let n = 0;
  for (const ch of j.data ?? []) {
    if (ch.status !== 'succeeded' || ch.refunded) continue;
    const out = await ingestPayment(db, tenantId, stripeToEvents({ type: 'charge.succeeded', data: { object: ch } })[0]);
    if (!('duplicate' in out)) n++;
  }
  return n;
}

// ── Square ──
export function verifySquare(raw: Buffer, header: string | undefined, signatureKey: string, notificationUrl: string) {
  if (!header) throw badRequest('Missing Square signature.');
  const expected = crypto.createHmac('sha256', signatureKey).update(notificationUrl + raw.toString('utf8')).digest('base64');
  if (!timingSafeEqualStr(header, expected)) throw badRequest('Invalid Square signature.');
}
export function squareToEvents(evt: any): PaymentEvent[] {
  const p = evt.data?.object?.payment; const rf = evt.data?.object?.refund;
  if (p && p.status === 'COMPLETED') return [{ provider: 'square', txnId: p.id, kind: 'payment', amount: Number(p.amount_money?.amount ?? 0) / 100, currency: p.amount_money?.currency,
    occurredAt: new Date(p.created_at), email: p.buyer_email_address ?? null, name: null, metadata: p.note ? { note: p.note } : {}, raw: evt }];
  if (rf && rf.status === 'COMPLETED') return [{ provider: 'square', txnId: rf.id, refundOf: rf.payment_id, kind: 'refund', amount: Number(rf.amount_money?.amount ?? 0) / 100, raw: evt }];
  return [];
}

// ── PayPal ──
async function paypalToken(s: any, live: boolean) {
  const r = await fetch(`https://api-m.${live ? '' : 'sandbox.'}paypal.com/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${s.client_id}:${s.client_secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j: any = await r.json(); if (!r.ok) throw badRequest(`PayPal auth failed: ${j.error_description ?? r.status}`); return j.access_token as string;
}
export async function verifyPaypal(db: Db, headers: Record<string, any>, body: any) {
  const i = await getIntegration(db, 'paypal'); const s = decryptJson<any>(i?.secrets_enc);
  if (!s?.client_id || !s?.webhook_id) throw badRequest('PayPal is not configured.');
  const live = i.config.environment === 'live';
  const token = await paypalToken(s, live);
  const r = await fetch(`https://api-m.${live ? '' : 'sandbox.'}paypal.com/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'], webhook_id: s.webhook_id, webhook_event: body }) });
  const j: any = await r.json();
  if (j.verification_status !== 'SUCCESS') throw badRequest('PayPal webhook verification failed.');
}
export function paypalToEvents(evt: any): PaymentEvent[] {
  const r = evt.resource ?? {};
  switch (evt.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': return [{ provider: 'paypal', txnId: r.id, kind: 'payment', amount: Number(r.amount?.value ?? 0), currency: r.amount?.currency_code, occurredAt: new Date(r.create_time ?? Date.now()),
      email: r.payer?.email_address ?? evt.resource?.supplementary_data?.payer?.email_address ?? null, name: r.payer?.name ? `${r.payer.name.given_name ?? ''} ${r.payer.name.surname ?? ''}`.trim() : null, metadata: r.custom_id ? { fund: r.custom_id } : {}, raw: evt }];
    case 'PAYMENT.CAPTURE.REFUNDED': return [{ provider: 'paypal', txnId: `${r.id}:refund`, refundOf: r.links?.find((l: any) => l.rel === 'up')?.href?.split('/').pop() ?? r.id, kind: 'refund', amount: Number(r.amount?.value ?? 0), raw: evt }];
    case 'CUSTOMER.DISPUTE.CREATED': return [{ provider: 'paypal', txnId: r.dispute_id ?? evt.id, refundOf: r.disputed_transactions?.[0]?.seller_transaction_id, kind: 'dispute', amount: Number(r.dispute_amount?.value ?? 0), raw: evt }];
    default: return [];
  }
}

// ───────────────────────── Google (Gmail + Calendar) ─────────────────────────
export function googleAuthUrl(tenantId: string, userId: string) {
  if (!config.google.clientId) throw badRequest('Google is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  const p = new URLSearchParams({ client_id: config.google.clientId, redirect_uri: `${config.apiUrl}/api/integrations/google/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events', state: signState({ tenantId, userId, p: 'google' }) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function googleExchange(code: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.google.clientId!, client_secret: config.google.clientSecret!, redirect_uri: `${config.apiUrl}/api/integrations/google/callback`, grant_type: 'authorization_code' }) });
  const j: any = await r.json(); if (!r.ok) throw badRequest(`Google: ${j.error_description ?? j.error}`);
  const info: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${j.access_token}` } })).json();
  return { ...j, email: info.email };
}
async function googleAccess(db: Db, userId: string) {
  const i = await getIntegration(db, 'google', userId);
  const s = decryptJson<any>(i?.secrets_enc);
  if (!i || i.status !== 'connected' || !s?.refresh_token) throw badRequest('Connect your Google account in Settings › Gmail & Calendar first.');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId!, client_secret: config.google.clientSecret!, refresh_token: s.refresh_token, grant_type: 'refresh_token' }) });
  const j: any = await r.json(); if (!r.ok) throw badRequest(`Google token refresh failed: ${j.error_description ?? j.error}. Reconnect Google.`);
  return j.access_token as string;
}
export async function googleCreateEvent(db: Db, userId: string, ev: { summary: string; description?: string; start: string; end?: string; allDay?: boolean; location?: string }) {
  const token = await googleAccess(db, userId);
  const body = ev.allDay ? { summary: ev.summary, description: ev.description, location: ev.location, start: { date: ev.start.slice(0, 10) }, end: { date: (ev.end ?? ev.start).slice(0, 10) } }
    : { summary: ev.summary, description: ev.description, location: ev.location, start: { dateTime: new Date(ev.start).toISOString() }, end: { dateTime: new Date(ev.end ?? new Date(new Date(ev.start).getTime() + 3600_000)).toISOString() } };
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json(); if (!r.ok) throw badRequest(`Google Calendar: ${j.error?.message ?? r.status}`);
  return j;
}

// ───────────────────────── Plaid ─────────────────────────
const plaidBase = () => `https://${config.plaid.env}.plaid.com`;
export async function plaidCall(path: string, body: any) {
  if (!config.plaid.clientId) throw badRequest('Bank feeds are not configured on this server (PLAID_CLIENT_ID / PLAID_SECRET). Use CSV statement import instead.');
  const r = await fetch(`${plaidBase()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: config.plaid.clientId, secret: config.plaid.secret, ...body }) });
  const j: any = await r.json(); if (!r.ok) throw badRequest(`Bank feed: ${j.error_message ?? r.status}`); return j;
}
export async function plaidSync(db: Db, tenantId: string, bankAccountId: string) {
  const ba = await one(db, `SELECT * FROM bank_accounts WHERE id=$1 AND provider='plaid'`, [bankAccountId]);
  if (!ba) throw badRequest('Bank account is not linked to a bank feed.');
  const i = await getIntegration(db, 'plaid'); const s = decryptJson<any>(i?.secrets_enc) ?? {};
  const access = s[`access_${bankAccountId}`]; if (!access) throw badRequest('Bank link is missing; relink the account.');
  let cursor = s[`cursor_${bankAccountId}`] ?? undefined; let added = 0; let more = true;
  while (more) {
    const j = await plaidCall('/transactions/sync', { access_token: access, cursor });
    for (const t of j.added ?? []) {
      if (ba.provider_ref && t.account_id !== ba.provider_ref) continue;
      const r = await db.query(`INSERT INTO bank_transactions(tenant_id, bank_account_id, txn_date, description, amount, external_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [tenantId, bankAccountId, t.date, t.merchant_name ?? t.name, -Number(t.amount), t.transaction_id]);
      added += r.rowCount ?? 0;
    }
    cursor = j.next_cursor; more = j.has_more;
  }
  await upsertIntegration(db, tenantId, 'plaid', null, { secrets: { [`cursor_${bankAccountId}`]: cursor } });
  return added;
}
