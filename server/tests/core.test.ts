/**
 * Core guarantees: double-entry + per-fund balancing, explainable scoring,
 * tenant isolation (row-level security), webhook signature validation, and the
 * read-only Ask tool surface. Run: npm test  (needs DATABASE_URL)
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateLines } from '../services/ledger.js';
import { computeDonor, DEFAULT_RULES } from '../services/intelligence.js';
import { verifyStripe, verifySquare, stripeToEvents } from '../services/integrations.js';
import { encryptJson, decryptJson } from '../lib/crypto.js';
import { pool, withSystem, withTenant, one } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { bootstrapTenant } from '../services/tenant.js';
import { toolsFor } from '../services/ask.js';
import { SYSTEM_ROLES } from '../lib/permissions.js';
import { resendTransport } from '../services/email.js';

after(() => pool.end());

test('ledger rejects unbalanced entries and entries where a fund does not self-balance', () => {
  const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
  const F1 = '00000000-0000-0000-0000-0000000000f1', F2 = '00000000-0000-0000-0000-0000000000f2';
  assert.doesNotThrow(() => validateLines([{ account_id: A, fund_id: F1, debit: 100 }, { account_id: B, fund_id: F1, credit: 100 }]));
  assert.throws(() => validateLines([{ account_id: A, fund_id: F1, debit: 100 }, { account_id: B, fund_id: F1, credit: 90 }]), /must equal/);
  assert.throws(() => validateLines([{ account_id: A, fund_id: F1, debit: 100 }, { account_id: B, fund_id: F2, credit: 100 }]), /Each fund must balance/);
  assert.throws(() => validateLines([{ account_id: A, fund_id: '', debit: 100 }, { account_id: B, fund_id: F1, credit: 100 }]), /fund/);
  assert.throws(() => validateLines([{ account_id: A, fund_id: F1, debit: 5, credit: 5 }, { account_id: B, fund_id: F1, credit: 0 }]), /either a debit or a credit/);
});

test('donor scoring is explainable and classifies health from recency', () => {
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const base = { id: 'x', created_at: day(900), capacity_estimate: null, health_override: null, recurring_monthly: 0, recurring_since: null, contacts180: 0, last_contact: null, events12: 0, opens90: 0, pending_thanks: 0, campaign_recent: null, gave_ye_last_year: false, gave_this_year: false };
  const lapsedMajor = computeDonor({ ...base, lifetime: 20000, gift_count: 5, first_gift: day(1500), last_gift: day(800), last_amount: 4000, largest: 6000, last12: 0, prior12: 0, count24: 0 } as any, DEFAULT_RULES);
  assert.equal(lapsedMajor.health, 'lapsed');
  assert.equal(lapsedMajor.intelligence.category, 'lapsed_major');
  assert.ok(lapsedMajor.intelligence.askBasis.length > 0);
  assert.deepEqual(Object.keys(lapsedMajor.parts).sort(), ['capacity', 'engagement', 'frequency', 'momentum', 'recency', 'recentGiving']);
  const active = computeDonor({ ...base, lifetime: 600, gift_count: 6, first_gift: day(300), last_gift: day(10), last_amount: 100, largest: 150, last12: 600, prior12: 300, count24: 6 } as any, DEFAULT_RULES);
  assert.equal(active.health, 'active');
  assert.ok(active.score > lapsedMajor.score - 40 && active.score <= 100);
  const overridden = computeDonor({ ...base, health_override: 'cooling', lifetime: 600, gift_count: 6, first_gift: day(300), last_gift: day(10), last_amount: 100, largest: 150, last12: 600, prior12: 300, count24: 6 } as any, DEFAULT_RULES);
  assert.equal(overridden.health, 'cooling');
});

test('integration secrets round-trip through AES-256-GCM and tampering is detected', () => {
  const blob = encryptJson({ api_key: 'sk_test_123' });
  assert.equal(decryptJson(blob)!.api_key, 'sk_test_123');
  const buf = Buffer.from(blob, 'base64'); buf[buf.length - 1] ^= 1;
  assert.throws(() => decryptJson(buf.toString('base64')));
});

test('Stripe and Square webhook signatures are validated', () => {
  const secret = 'whsec_test'; const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'charge.succeeded', data: { object: { id: 'ch_1', amount: 2500, currency: 'usd', created: 1700000000, billing_details: { email: 'a@b.co' }, metadata: {} } } }));
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.doesNotThrow(() => verifyStripe(body, `t=${t},v1=${sig}`, secret));
  assert.throws(() => verifyStripe(body, `t=${t},v1=${'0'.repeat(64)}`, secret), /Invalid Stripe signature/);
  assert.throws(() => verifyStripe(body, `t=${t - 3600},v1=${sig}`, secret), /tolerance/);
  const ev = stripeToEvents(JSON.parse(body.toString()))[0];
  assert.equal(ev.amount, 25); assert.equal(ev.email, 'a@b.co');
  const sq = crypto.createHmac('sha256', 'key').update('https://x/webhooks/square/k' + body.toString()).digest('base64');
  assert.doesNotThrow(() => verifySquare(body, sq, 'key', 'https://x/webhooks/square/k'));
  assert.throws(() => verifySquare(body, 'bad', 'key', 'https://x/webhooks/square/k'));
});

// Netlify's build has no database; this test runs locally and in CI with Postgres available.
test('row-level security isolates tenants even when a query omits the tenant filter', { skip: process.env.NETLIFY === 'true' ? 'no database during Netlify build' : false }, async () => {
  await migrate();
  const { t1, t2, d1 } = await withSystem(async (db) => {
    const u = await one(db, `INSERT INTO users(email,name) VALUES ($1,'Iso Test') RETURNING id`, [`iso-${crypto.randomUUID()}@test.local`]);
    const a = await bootstrapTenant(db, { name: 'Tenant A', ownerUserId: u.id });
    const b = await bootstrapTenant(db, { name: 'Tenant B', ownerUserId: u.id });
    await db.query(`SELECT set_config('app.tenant_id',$1,true)`, [a.id]);
    const d = await one(db, `INSERT INTO donors(tenant_id, first_name, last_name) VALUES ($1,'Secret','Donor') RETURNING id`, [a.id]);
    return { t1: a.id, t2: b.id, d1: d.id };
  });
  const seenByB = await withTenant(t2, (db) => one(db, `SELECT id FROM donors WHERE id=$1`, [d1]));
  assert.equal(seenByB, null, 'tenant B must not see tenant A donor');
  const seenByA = await withTenant(t1, (db) => one(db, `SELECT id FROM donors WHERE id=$1`, [d1]));
  assert.equal(seenByA?.id, d1);
  await assert.rejects(withTenant(t2, (db) => db.query(`INSERT INTO donors(tenant_id, first_name) VALUES ($1,'Sneaky')`, [t1])), /row-level security/);
});

test('Ask A.I. Nonprofits exposes only read tools, filtered by permission', () => {
  const ctx = (perms: string[]) => ({ permissions: new Set(perms) } as any);
  const all = toolsFor(ctx(SYSTEM_ROLES[0].permissions));
  assert.ok(all.length >= 10);
  for (const t of all) assert.doesNotMatch(t.name, /send|create|update|delete|post|transfer|refund/i);
  const staff = toolsFor(ctx(SYSTEM_ROLES.find((r) => r.name === 'General Staff')!.permissions));
  assert.ok(staff.every((t) => t.perm === 'work.read'), 'general staff cannot query donors or finances');
});

test('Resend transport sends the documented payload and surfaces API errors', async () => {
  const calls: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    const ok = calls.length === 1;
    return new Response(JSON.stringify(ok ? { id: 're_123' } : { message: 'domain not verified' }), { status: ok ? 200 : 403 });
  }) as any;
  try {
    const t = resendTransport({ apiKey: 're_key', from: 'TA <no-reply@example.org>', replyTo: 'help@example.org' });
    const r = await t.sendMail({ from: 'TA <no-reply@example.org>', to: 'a@b.co', subject: 'Hi', html: '<p>x</p>', attachments: [{ filename: 'r.pdf', content: Buffer.from('pdf') }] });
    assert.equal(r.messageId, 're_123');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_key');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.to, ['a@b.co']); assert.equal(body.reply_to, 'help@example.org'); assert.equal(body.attachments[0].content, Buffer.from('pdf').toString('base64'));
    await assert.rejects(t.sendMail({ from: 'x', to: 'a@b.co', subject: 's' }), /Resend 403: domain not verified/);
  } finally { globalThis.fetch = realFetch; }
});
