import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { h, parse } from '../lib/http.js';
import { withSystem, one, many } from '../db/pool.js';
import { issueSession, clearSession, readSession, loadContext } from '../lib/auth.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { bootstrapTenant } from '../services/tenant.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { PERMISSIONS } from '../lib/permissions.js';

export const authRouter = Router();
// Key by client IP; on Netlify the real client address arrives in x-nf-client-connection-ip.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.get('x-nf-client-connection-ip') ?? req.ip ?? req.socket.remoteAddress ?? 'unknown'),
});

const password = z.string().min(10, 'Password must be at least 10 characters');

authRouter.post('/signup', limiter, h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1), email: z.string().email(), password, orgName: z.string().min(2),
    workspaceTerm: z.string().optional(), workspaceTermPlural: z.string().optional(), currency: z.string().length(3).optional(),
    country: z.string().optional(), faithBased: z.boolean().optional(), firstWorkspace: z.string().optional() }), req.body);
  const out = await withSystem(async (db) => {
    const exists = await one(db, `SELECT id FROM users WHERE lower(email)=lower($1)`, [b.email]);
    if (exists) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    const u = await one(db, `INSERT INTO users(email,name,password_hash) VALUES (lower($1),$2,$3) RETURNING id`, [b.email, b.name, await bcrypt.hash(b.password, 12)]);
    const t = await bootstrapTenant(db, { name: b.orgName, ownerUserId: u.id, workspaceTerm: b.workspaceTerm, workspaceTermPlural: b.workspaceTermPlural,
      currency: b.currency, country: b.country, faithBased: b.faithBased, firstWorkspace: b.firstWorkspace });
    await audit(db, { tenantId: t.id, userId: u.id, ip: req.ip }, 'admin', 'signup', `Created organization “${b.orgName}”`);
    return { userId: u.id, tenantId: t.id };
  });
  issueSession(res, out.userId, out.tenantId);
  res.status(201).json({ ok: true });
}));

authRouter.post('/login', limiter, h(async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string() }), req.body);
  const r = await withSystem(async (db) => {
    const u = await one(db, `SELECT * FROM users WHERE lower(email)=lower($1)`, [b.email]);
    if (!u?.password_hash || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, 'Email or password is incorrect.');
    const m = await one(db, `SELECT tenant_id FROM memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [u.id]);
    if (m) await audit(db, { tenantId: m.tenant_id, userId: u.id, ip: req.ip }, 'security', 'login', `${u.email} signed in`);
    return { userId: u.id, tenantId: m?.tenant_id ?? null };
  });
  issueSession(res, r.userId, r.tenantId);
  res.json({ ok: true, needsOrganization: !r.tenantId });
}));

authRouter.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });

authRouter.get('/me', h(async (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in' });
  const data = await withSystem(async (db) => {
    const u = await one(db, `SELECT id, email, name, is_platform_owner FROM users WHERE id=$1`, [s.sub]);
    const orgs = await many(db, `SELECT t.id, t.name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.status='active' ORDER BY t.name`, [s.sub]);
    const tenant = s.tid ? await one(db, `SELECT id, name, legal_name, currency, locale, country, workspace_term, workspace_term_plural, faith_based, billing_enabled, tax_jurisdiction, onboarding, invoice_terms FROM tenants WHERE id=$1`, [s.tid]) : null;
    return { u, orgs, tenant };
  });
  if (!data.u) return res.status(401).json({ error: 'Not signed in' });
  const ctx = s.tid ? await loadContext(s.sub, s.tid) : null;
  res.json({
    user: data.u, organizations: data.orgs, tenant: ctx ? data.tenant : null,
    role: ctx?.roleName ?? null, permissions: ctx ? [...ctx.permissions] : [], allMinistries: ctx?.allMinistries ?? false, ministryIds: ctx?.ministryIds ?? [],
    features: { ai: config.aiEnabled, smtp: Boolean(config.smtp), quickbooks: Boolean(config.quickbooks.clientId), google: Boolean(config.google.clientId),
      googleMaps: Boolean(config.google.mapsKey), plaid: Boolean(config.plaid.clientId) },
    permissionCatalog: PERMISSIONS,
  });
}));

authRouter.post('/switch', h(async (req, res) => {
  const s = readSession(req); if (!s) throw new HttpError(401, 'Please sign in.');
  const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), req.body);
  const ctx = await loadContext(s.sub, tenantId);
  if (!ctx) throw new HttpError(403, 'You are not a member of that organization.');
  issueSession(res, s.sub, tenantId);
  res.json({ ok: true });
}));

authRouter.post('/organizations', h(async (req, res) => {
  const s = readSession(req); if (!s) throw new HttpError(401, 'Please sign in.');
  const b = parse(z.object({ orgName: z.string().min(2), workspaceTerm: z.string().optional(), workspaceTermPlural: z.string().optional(), currency: z.string().optional(), country: z.string().optional(), faithBased: z.boolean().optional() }), req.body);
  const t = await withSystem((db) => bootstrapTenant(db, { name: b.orgName, ownerUserId: s.sub, ...b }));
  issueSession(res, s.sub, t.id);
  res.status(201).json({ ok: true, tenantId: t.id });
}));

// Invitation acceptance (public with token)
authRouter.get('/invite/:token', h(async (req, res) => {
  const inv = await withSystem((db) => one(db, `SELECT m.invited_email, t.name org FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.invite_token=$1 AND m.status='invited'`, [req.params.token]));
  if (!inv) throw badRequest('This invitation is invalid or has already been used.');
  res.json(inv);
}));
authRouter.post('/invite/:token', limiter, h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1), password }), req.body);
  const out = await withSystem(async (db) => {
    const m = await one(db, `SELECT * FROM memberships WHERE invite_token=$1 AND status='invited' FOR UPDATE`, [req.params.token]);
    if (!m) throw badRequest('This invitation is invalid or has already been used.');
    let u = await one(db, `SELECT id FROM users WHERE lower(email)=lower($1)`, [m.invited_email]);
    if (!u) u = await one(db, `INSERT INTO users(email,name,password_hash) VALUES (lower($1),$2,$3) RETURNING id`, [m.invited_email, b.name, await bcrypt.hash(b.password, 12)]);
    await db.query(`UPDATE memberships SET user_id=$2, status='active', invite_token=NULL WHERE id=$1`, [m.id, u.id]);
    const conv = await one(db, `SELECT id FROM conversations WHERE tenant_id=$1 AND name='general' AND is_channel`, [m.tenant_id]);
    if (conv) await db.query(`INSERT INTO conversation_members(tenant_id,conversation_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [m.tenant_id, conv.id, u.id]);
    await audit(db, { tenantId: m.tenant_id, userId: u.id, ip: req.ip }, 'admin', 'invite_accepted', `${m.invited_email} accepted an invitation`);
    return { userId: u.id, tenantId: m.tenant_id };
  });
  issueSession(res, out.userId, out.tenantId);
  res.json({ ok: true });
}));

export function newInviteToken() { return crypto.randomBytes(24).toString('hex'); }
