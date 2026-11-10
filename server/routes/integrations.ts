import { Router, raw } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, actor, requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, withSystem, withTenant } from '../db/pool.js';
import { config } from '../config.js';
import { decryptJson } from '../lib/crypto.js';
import {
  PROVIDERS, getIntegration, upsertIntegration, publicView, verifyState, qboAuthUrl, qboExchange, qboListRefs, qboPushEntry, qboExportRows,
  verifyStripe, stripeToEvents, stripeImportRecent, verifySquare, squareToEvents, verifyPaypal, paypalToEvents, ingestPayment, resolvePayment,
  googleAuthUrl, googleExchange, googleCreateEvent, plaidCall, plaidSync,
} from '../services/integrations.js';
import { sendTable } from '../services/exporter.js';
import { DONOR_NAME_SQL, today } from '../lib/util.js';

export const integrationsRouter = Router();

integrationsRouter.get('/', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  const out = await tx(req, async (db) => {
    const rows = await many(db, `SELECT * FROM integrations WHERE user_id IS NULL OR user_id=$1`, [req.auth!.userId]);
    return Object.entries(PROVIDERS).map(([key, meta]) => {
      const i = rows.find((r) => r.provider === key);
      const serverConfigured = key === 'quickbooks' ? Boolean(config.quickbooks.clientId) : key === 'google' ? Boolean(config.google.clientId) : key === 'plaid' ? Boolean(config.plaid.clientId) : true;
      return { key, ...meta, serverConfigured, integration: publicView(i),
        webhookUrl: i && ['stripe', 'square', 'paypal'].includes(key) ? `${config.apiUrl}/webhooks/${key}/${i.webhook_key}` : null };
    });
  });
  res.json(out);
}));

/** Save API credentials (Stripe / Square / PayPal). Secrets are encrypted and never returned. */
integrationsRouter.put('/:provider/credentials', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const p = String(req.params.provider);
  const schemas: Record<string, z.ZodTypeAny> = {
    stripe: z.object({ api_key: z.string().regex(/^(rk|sk)_(live|test)_/, 'Use a Stripe secret or restricted key').optional(), webhook_secret: z.string().startsWith('whsec_').optional() }),
    square: z.object({ access_token: z.string().optional(), signature_key: z.string().optional(), environment: z.enum(['sandbox', 'production']).optional() }),
    paypal: z.object({ client_id: z.string().optional(), client_secret: z.string().optional(), webhook_id: z.string().optional(), environment: z.enum(['sandbox', 'live']).optional() }),
  };
  if (!schemas[p]) throw badRequest('This integration connects with OAuth, not API keys.');
  const b = parse(schemas[p], req.body) as Record<string, string>;
  const { environment, ...secrets } = b;
  const out = await tx(req, async (db) => {
    const i = await upsertIntegration(db, req.auth!.tenantId, p, null, { status: 'connected', config: environment ? { environment } : {}, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)), connectedBy: req.auth!.userId });
    await audit(db, actor(req), 'integrations', 'credentials', `Updated ${PROVIDERS[p as keyof typeof PROVIDERS].label} credentials`, { type: 'integration', id: i.id });
    return publicView(i);
  });
  res.json(out);
}));

integrationsRouter.patch('/:provider/config', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const b = parse(z.object({ default_fund_id: z.string().uuid().nullish(), default_campaign_id: z.string().uuid().nullish(), deposit_account_id: z.string().uuid().nullish(),
    auto_create_donors: z.boolean().optional(), sync_direction: z.enum(['push', 'two_way']).optional(), auto_sync: z.boolean().optional() }), req.body);
  res.json(await tx(req, async (db) => {
    const i = await getIntegration(db, String(req.params.provider)); if (!i) throw notFound('Integration');
    const r = await upsertIntegration(db, req.auth!.tenantId, String(req.params.provider), null, { config: b });
    await audit(db, actor(req), 'integrations', 'config', `Changed ${req.params.provider} settings`, { type: 'integration', id: i.id }, b);
    return publicView(r);
  }));
}));

integrationsRouter.post('/:provider/toggle', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  res.json(await tx(req, async (db) => {
    const i = await getIntegration(db, String(req.params.provider), req.params.provider === 'google' ? req.auth!.userId : null); if (!i) throw notFound('Integration');
    const r = await one(db, `UPDATE integrations SET enabled = NOT enabled WHERE id=$1 RETURNING *`, [i.id]);
    await audit(db, actor(req), 'integrations', 'toggle', `${r.enabled ? 'Enabled' : 'Disabled'} ${req.params.provider}`, { type: 'integration', id: i.id });
    return publicView(r);
  }));
}));

integrationsRouter.post('/:provider/disconnect', h(async (req, res) => {
  const p = String(req.params.provider);
  if (p !== 'google') requirePerm(req.auth, 'integrations.manage');
  await tx(req, async (db) => {
    const i = await getIntegration(db, p, p === 'google' ? req.auth!.userId : null); if (!i) throw notFound('Integration');
    if (p === 'google') { const s = decryptJson<any>(i.secrets_enc); if (s?.refresh_token) await fetch(`https://oauth2.googleapis.com/revoke?token=${s.refresh_token}`, { method: 'POST' }).catch(() => {}); }
    await db.query(`UPDATE integrations SET status='disconnected', secrets_enc=NULL WHERE id=$1`, [i.id]);
    await audit(db, actor(req), 'integrations', 'disconnect', `Disconnected ${p}`, { type: 'integration', id: i.id });
  });
  res.json({ ok: true });
}));

integrationsRouter.post('/:provider/test', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const p = String(req.params.provider);
  const result = await tx(req, async (db) => {
    const i = await getIntegration(db, p, p === 'google' ? req.auth!.userId : null);
    if (!i || i.status !== 'connected') return { ok: false, message: 'Not connected.' };
    const s = decryptJson<any>(i.secrets_enc) ?? {};
    try {
      if (p === 'quickbooks') { const r = await qboListRefs(db, req.auth!.tenantId); return { ok: true, message: `Connected to company ${i.config.companyName ?? i.config.realmId}: ${r.accounts.length} accounts, ${r.classes.length} classes.` }; }
      if (p === 'stripe') { if (!s.api_key) return { ok: false, message: 'API key missing.' }; const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${s.api_key}` } }); return { ok: r.ok, message: r.ok ? `Stripe key works.${s.webhook_secret ? '' : ' Add the webhook signing secret to receive live gifts.'}` : `Stripe returned ${r.status}.` }; }
      if (p === 'square') { if (!s.access_token) return { ok: false, message: 'Access token missing.' }; const r = await fetch(`https://connect.squareup${i.config.environment === 'production' ? '' : 'sandbox'}.com/v2/locations`, { headers: { Authorization: `Bearer ${s.access_token}`, 'Square-Version': '2024-01-18' } }); return { ok: r.ok, message: r.ok ? 'Square credentials work.' : `Square returned ${r.status}.` }; }
      if (p === 'paypal') { const live = i.config.environment === 'live'; const r = await fetch(`https://api-m.${live ? '' : 'sandbox.'}paypal.com/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${s.client_id}:${s.client_secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }); return { ok: r.ok, message: r.ok ? 'PayPal credentials work.' : `PayPal returned ${r.status}.` }; }
      if (p === 'google') return { ok: true, message: `Connected as ${i.config.email}.` };
      return { ok: true, message: 'Connected.' };
    } catch (e: any) { return { ok: false, message: e.message }; }
  });
  await tx(req, (db) => db.query(`UPDATE integrations SET last_error=$2 WHERE provider=$1`, [p, result.ok ? null : result.message]));
  res.json(result);
}));

// ── OAuth starts ──
integrationsRouter.get('/quickbooks/connect', h(async (req, res) => { requirePerm(req.auth, 'integrations.manage'); res.json({ url: qboAuthUrl(req.auth!.tenantId, req.auth!.userId) }); }));
integrationsRouter.get('/google/connect', h(async (req, res) => { res.json({ url: googleAuthUrl(req.auth!.tenantId, req.auth!.userId) }); }));

// ── QuickBooks mappings & Sync Center ──
integrationsRouter.get('/quickbooks/refs', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  res.json(await tx(req, async (db) => {
    const refs = await qboListRefs(db, req.auth!.tenantId);
    const mappings = await many(db, `SELECT * FROM integration_mappings WHERE provider='quickbooks' AND entity_type IN ('account','fund')`);
    return { ...refs, mappings };
  }));
}));
integrationsRouter.put('/quickbooks/mappings', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const { mappings } = parse(z.object({ mappings: z.array(z.object({ entity_type: z.enum(['account', 'fund']), internal_id: z.string().uuid(), external_id: z.string().nullable(), external_name: z.string().nullish() })) }), req.body);
  await tx(req, async (db) => {
    for (const m of mappings) {
      if (!m.external_id) await db.query(`DELETE FROM integration_mappings WHERE provider='quickbooks' AND entity_type=$1 AND internal_id=$2`, [m.entity_type, m.internal_id]);
      else await db.query(`INSERT INTO integration_mappings(tenant_id, provider, entity_type, internal_id, external_id, external_name) VALUES ($1,'quickbooks',$2,$3,$4,$5)
        ON CONFLICT (tenant_id, provider, entity_type, internal_id) DO UPDATE SET external_id=EXCLUDED.external_id, external_name=EXCLUDED.external_name, updated_at=now()`, [req.auth!.tenantId, m.entity_type, m.internal_id, m.external_id, m.external_name ?? null]);
    }
    // Errors caused by unmapped accounts can be retried now.
    await db.query(`UPDATE sync_records SET status='queued' WHERE provider='quickbooks' AND status='error' AND error LIKE 'Unmapped%'`);
    await audit(db, actor(req), 'integrations', 'qbo_mappings', `Updated ${mappings.length} QuickBooks mappings`);
  });
  res.json({ ok: true });
}));
integrationsRouter.get('/sync-center', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read');
  res.json(await tx(req, async (db) => {
    const i = await getIntegration(db, 'quickbooks');
    const counts = await many(db, `SELECT status, count(*)::int n FROM sync_records WHERE provider='quickbooks' GROUP BY 1`);
    const issues = await many(db, `SELECT s.*, je.memo, je.entry_date FROM sync_records s LEFT JOIN journal_entries je ON je.id=s.internal_id WHERE s.provider='quickbooks' AND s.status IN ('error','conflict','queued') ORDER BY s.updated_at DESC LIMIT 200`);
    const unposted = await one(db, `SELECT count(*)::int n FROM journal_entries je WHERE je.status='posted' AND NOT EXISTS (SELECT 1 FROM sync_records s WHERE s.internal_id=je.id AND s.provider='quickbooks')`);
    const unmappedAccounts = await many(db, `SELECT a.id, a.code, a.name FROM accounts a WHERE NOT a.archived AND NOT EXISTS (SELECT 1 FROM integration_mappings m WHERE m.provider='quickbooks' AND m.entity_type='account' AND m.internal_id=a.id)
      AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id=a.id)`);
    const payments = await many(db, `SELECT * FROM payment_transactions WHERE status IN ('unmatched','disputed','failed') ORDER BY occurred_at DESC LIMIT 200`);
    const webhooks = await many(db, `SELECT provider, event_type, status, error, received_at FROM webhook_events ORDER BY received_at DESC LIMIT 25`);
    return { quickbooks: publicView(i), counts, issues, notYetQueued: unposted!.n, unmappedAccounts, payments, webhooks };
  }));
}));
integrationsRouter.post('/quickbooks/sync-now', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const r = await tx(req, async (db) => {
    const i = await getIntegration(db, 'quickbooks');
    if (!i || i.status !== 'connected') throw badRequest('Connect QuickBooks first, or use the date-range export.');
    const entries = await many(db, `SELECT je.id FROM journal_entries je WHERE je.status IN ('posted','void') AND (je.posted_at IS NULL OR je.posted_at >= coalesce((SELECT (config->>'syncStart')::date FROM integrations WHERE provider='quickbooks'), '1900-01-01'))
      AND NOT EXISTS (SELECT 1 FROM sync_records s WHERE s.internal_id=je.id AND s.provider='quickbooks' AND s.status IN ('synced','skipped') AND je.status='posted') LIMIT 500`);
    for (const e of entries) await qboPushEntry(db, req.auth!.tenantId, e.id);
    await db.query(`UPDATE integrations SET last_sync_at=now() WHERE id=$1`, [i.id]);
    await audit(db, actor(req), 'integrations', 'qbo_sync', `Manual QuickBooks sync of ${entries.length} entries`);
    return { processed: entries.length };
  });
  res.json(r);
}));
integrationsRouter.post('/sync-records/:id/:action', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const action = String(req.params.action);
  await tx(req, async (db) => {
    const s = await one(db, `SELECT * FROM sync_records WHERE id=$1`, [req.params.id]); if (!s) throw notFound('Sync record');
    if (action === 'retry') { await db.query(`UPDATE sync_records SET status='queued' WHERE id=$1`, [s.id]); await qboPushEntry(db, req.auth!.tenantId, s.internal_id); }
    else if (action === 'resolve') await db.query(`UPDATE sync_records SET status='skipped', error=coalesce(error,'') || ' — resolved manually' WHERE id=$1`, [s.id]);
    else throw badRequest('Unknown action.');
    await audit(db, actor(req), 'integrations', `sync_${action}`, `Sync record ${action}`, { type: 'sync_record', id: s.id });
  });
  res.json({ ok: true });
}));
integrationsRouter.get('/quickbooks/export', h(async (req, res) => {
  requirePerm(req.auth, 'finance.read', 'data.export');
  const from = String(req.query.from ?? `${new Date().getFullYear()}-01-01`), to = String(req.query.to ?? today());
  const rows = await tx(req, async (db) => { await audit(db, actor(req), 'export', 'qbo_export', `QuickBooks export ${from} to ${to}`); return qboExportRows(db, from, to); });
  const cols = ['JournalNo', 'JournalDate', 'Memo', 'AccountName', 'Debits', 'Credits', 'Description', 'Class', 'Source'];
  await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `quickbooks-journal-${from}-${to}`, cols.map((c) => ({ key: c, label: c })), rows);
}));

// ── Payments review queue ──
integrationsRouter.post('/payments/:id/resolve', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const b = parse(z.object({ donor_id: z.string().uuid().optional(), new_donor: z.record(z.string(), z.any()).optional(), fund_id: z.string().uuid(), campaign_id: z.string().uuid().nullish(), project_id: z.string().uuid().nullish() }), req.body);
  res.json(await tx(req, async (db) => { const g = await resolvePayment(db, req, String(req.params.id), b); await audit(db, actor(req), 'giving', 'payment_resolve', 'Matched online payment to a gift', { type: 'gift', id: g.id }); return g; }));
}));
integrationsRouter.post('/payments/:id/ignore', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  await tx(req, async (db) => { await db.query(`UPDATE payment_transactions SET status='ignored' WHERE id=$1`, [req.params.id]); await audit(db, actor(req), 'giving', 'payment_ignore', 'Ignored an online payment', { type: 'payment', id: String(req.params.id) }); });
  res.json({ ok: true });
}));
integrationsRouter.post('/stripe/import', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  res.json({ imported: await tx(req, async (db) => { const n = await stripeImportRecent(db, req.auth!.tenantId); await audit(db, actor(req), 'integrations', 'stripe_import', `Imported ${n} Stripe payments`); return n; }) });
}));

// ── Google Calendar (explicit user action) ──
integrationsRouter.post('/google/calendar', h(async (req, res) => {
  const b = parse(z.object({ items: z.array(z.object({ summary: z.string(), description: z.string().optional(), start: z.string(), end: z.string().optional(), allDay: z.boolean().optional(), location: z.string().optional() })).min(1).max(100) }), req.body);
  const out = await tx(req, async (db) => {
    const created = []; for (const it of b.items) created.push((await googleCreateEvent(db, req.auth!.userId, it)).htmlLink);
    await audit(db, actor(req), 'integrations', 'calendar', `Added ${created.length} item(s) to Google Calendar`);
    return created;
  });
  res.json({ created: out });
}));

// ── Plaid bank feed ──
integrationsRouter.post('/plaid/link-token', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const j = await plaidCall('/link/token/create', { user: { client_user_id: req.auth!.userId }, client_name: 'A.I. Nonprofits', products: ['transactions'], country_codes: ['US', 'CA'], language: 'en' });
  res.json({ link_token: j.link_token });
}));
integrationsRouter.post('/plaid/exchange', h(async (req, res) => {
  requirePerm(req.auth, 'integrations.manage');
  const b = parse(z.object({ public_token: z.string(), bank_account_id: z.string().uuid(), plaid_account_id: z.string().optional() }), req.body);
  const j = await plaidCall('/item/public_token/exchange', { public_token: b.public_token });
  await tx(req, async (db) => {
    await upsertIntegration(db, req.auth!.tenantId, 'plaid', null, { status: 'connected', secrets: { [`access_${b.bank_account_id}`]: j.access_token }, connectedBy: req.auth!.userId });
    await db.query(`UPDATE bank_accounts SET provider='plaid', provider_ref=$2 WHERE id=$1`, [b.bank_account_id, b.plaid_account_id ?? null]);
    await audit(db, actor(req), 'integrations', 'plaid_link', 'Linked a bank feed', { type: 'bank_account', id: b.bank_account_id });
  });
  res.json({ ok: true });
}));
integrationsRouter.post('/plaid/sync/:bankAccountId', h(async (req, res) => {
  requirePerm(req.auth, 'finance.write');
  res.json({ added: await tx(req, (db) => plaidSync(db, req.auth!.tenantId, String(req.params.bankAccountId))) });
}));

// ───────── OAuth callbacks (browser redirects; session cookie present) ─────────
export const oauthCallbackRouter = Router();
oauthCallbackRouter.get('/quickbooks/callback', requireAuth, h(async (req, res) => {
  const st = verifyState(String(req.query.state));
  if (st.tenantId !== req.auth!.tenantId || st.userId !== req.auth!.userId) throw badRequest('This connection was started from a different session.');
  requirePerm(req.auth, 'integrations.manage');
  if (req.query.error) return res.redirect(`${config.appUrl}/money/accounting/integrations?error=${encodeURIComponent(String(req.query.error))}`);
  const t = await qboExchange(String(req.query.code));
  await withTenant(req.auth!.tenantId, async (db) => {
    await upsertIntegration(db, req.auth!.tenantId, 'quickbooks', null, { status: 'connected', config: { realmId: String(req.query.realmId), environment: config.quickbooks.environment, syncStart: today() },
      secrets: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 }, connectedBy: req.auth!.userId });
    try { const info = await (await import('../services/integrations.js')).qboFetch(db, req.auth!.tenantId, `/companyinfo/${req.query.realmId}`); await upsertIntegration(db, req.auth!.tenantId, 'quickbooks', null, { config: { companyName: info.CompanyInfo?.CompanyName } }); } catch { /* optional */ }
    await audit(db, actor(req), 'integrations', 'connect', 'Connected QuickBooks Online', { type: 'integration' }, { realmId: req.query.realmId });
  });
  res.redirect(`${config.appUrl}/money/accounting/sync?connected=quickbooks`);
}));
oauthCallbackRouter.get('/google/callback', requireAuth, h(async (req, res) => {
  const st = verifyState(String(req.query.state));
  if (st.tenantId !== req.auth!.tenantId || st.userId !== req.auth!.userId) throw badRequest('This connection was started from a different session.');
  if (req.query.error) return res.redirect(`${config.appUrl}/settings?tab=google&error=${encodeURIComponent(String(req.query.error))}`);
  const t = await googleExchange(String(req.query.code));
  await withTenant(req.auth!.tenantId, async (db) => {
    await upsertIntegration(db, req.auth!.tenantId, 'google', req.auth!.userId, { status: 'connected', config: { email: t.email, scopes: t.scope }, secrets: { refresh_token: t.refresh_token }, connectedBy: req.auth!.userId });
    await audit(db, actor(req), 'integrations', 'connect', `Connected Google account ${t.email}`, { type: 'integration' });
  });
  res.redirect(`${config.appUrl}/settings?tab=google&connected=1`);
}));

// ───────── Webhooks (public, signature-verified, raw body) ─────────
export const webhooksRouter = Router();
webhooksRouter.use(raw({ type: '*/*', limit: '2mb' }));

async function routeWebhook(provider: string, key: string) {
  const i = await withSystem((db) => one(db, `SELECT * FROM integrations WHERE provider=$1 AND webhook_key=$2`, [provider, key]));
  if (!i || !i.enabled || i.status !== 'connected') throw notFound('Webhook endpoint');
  return i;
}
async function recordAndProcess(tenantId: string, provider: string, eventId: string, eventType: string, payload: any, events: any[]) {
  await withTenant(tenantId, async (db) => {
    const ins = await db.query(`INSERT INTO webhook_events(tenant_id, provider, external_event_id, event_type, payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [tenantId, provider, eventId, eventType, payload]);
    if (!ins.rowCount) return; // duplicate delivery
    const wid = ins.rows[0].id;
    try {
      await db.query('SAVEPOINT wh');
      for (const ev of events) await ingestPayment(db, tenantId, ev);
      await db.query(`UPDATE webhook_events SET status=$2 WHERE id=$1`, [wid, events.length ? 'processed' : 'ignored']);
    } catch (e: any) {
      await db.query('ROLLBACK TO SAVEPOINT wh');
      await db.query(`UPDATE webhook_events SET status='error', error=$2 WHERE id=$1`, [wid, e.message.slice(0, 1000)]);
    }
  });
}

webhooksRouter.post('/stripe/:key', h(async (req, res) => {
  const i = await routeWebhook('stripe', String(req.params.key));
  const s = decryptJson<any>(i.secrets_enc);
  if (!s?.webhook_secret) throw badRequest('Webhook signing secret not configured.');
  verifyStripe(req.body as Buffer, req.header('stripe-signature'), s.webhook_secret);
  const evt = JSON.parse((req.body as Buffer).toString('utf8'));
  await recordAndProcess(i.tenant_id, 'stripe', evt.id, evt.type, evt, stripeToEvents(evt));
  res.json({ received: true });
}));
webhooksRouter.post('/square/:key', h(async (req, res) => {
  const i = await routeWebhook('square', String(req.params.key));
  const s = decryptJson<any>(i.secrets_enc);
  if (!s?.signature_key) throw badRequest('Square signature key not configured.');
  verifySquare(req.body as Buffer, req.header('x-square-hmacsha256-signature'), s.signature_key, `${config.apiUrl}/webhooks/square/${i.webhook_key}`);
  const evt = JSON.parse((req.body as Buffer).toString('utf8'));
  await recordAndProcess(i.tenant_id, 'square', evt.event_id, evt.type, evt, squareToEvents(evt));
  res.json({ received: true });
}));
webhooksRouter.post('/paypal/:key', h(async (req, res) => {
  const i = await routeWebhook('paypal', String(req.params.key));
  const evt = JSON.parse((req.body as Buffer).toString('utf8'));
  await withTenant(i.tenant_id, (db) => verifyPaypal(db, req.headers, evt));
  await recordAndProcess(i.tenant_id, 'paypal', evt.id, evt.event_type, evt, paypalToEvents(evt));
  res.json({ received: true });
}));

export const _i = { DONOR_NAME_SQL, qboPushEntry };
