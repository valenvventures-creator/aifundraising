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
import { transportFor } from '../services/email.js';

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
    const u = await one(db, `SELECT id, email, name, is_platform_owner, password_changed_at FROM users WHERE id=$1`, [s.sub]);
    const orgs = await many(db, `SELECT t.id, t.name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.status='active' ORDER BY t.name`, [s.sub]);
    const tenant = s.tid ? await one(db, `SELECT id, name, legal_name, currency, locale, country, workspace_term, workspace_term_plural, faith_based, billing_enabled, tax_jurisdiction, onboarding, invoice_terms FROM tenants WHERE id=$1`, [s.tid]) : null;
    return { u, orgs, tenant };
  });
  const stale = data.u?.password_changed_at && s.iat && s.iat * 1000 < new Date(data.u.password_changed_at).getTime() - 1000;
  if (!data.u || stale) { clearSession(res); return res.status(401).json({ error: 'Not signed in' }); }
  delete data.u.password_changed_at;
  const ctx = s.tid ? await loadContext(s.sub, s.tid, s.iat) : null;
  res.json({
    user: data.u, organizations: data.orgs, tenant: ctx ? data.tenant : null,
    role: ctx?.roleName ?? null, permissions: ctx ? [...ctx.permissions] : [], allMinistries: ctx?.allMinistries ?? false, ministryIds: ctx?.ministryIds ?? [],
    features: { ai: config.aiEnabled, smtp: Boolean(config.smtp || config.resend), resend: Boolean(config.resend), quickbooks: Boolean(config.quickbooks.clientId), google: Boolean(config.google.clientId),
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

// ───────── Forgot / reset password (same flow as the other Thought Authorities sites) ─────────
const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

authRouter.post('/forgot', limiter, h(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  const out = await withSystem(async (db) => {
    const tr = await transportFor(db, null);
    if (!tr) return { ok: true, emailConfigured: false };
    const u = await one(db, `SELECT id, name, email FROM users WHERE lower(email)=lower($1) AND password_hash IS NOT NULL`, [email]);
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.query(`UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [u.id]);
      await db.query(`INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '30 minutes')`, [u.id, sha256(token)]);
      const link = `${config.appUrl}/reset-password/${token}`;
try {
      await tr.t.sendMail({ from: tr.from, to: u.email, subject: 'Reset your A.I. Fundraising password',
        text: `Hello ${u.name},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Hello ${u.name.replace(/[<>&]/g, '')},</p><p><a href="${link}">Choose a new password</a>. The link works for 30 minutes and only once.</p><p>If you didn't ask for this, you can ignore this email.</p>` });
      } catch (e: any) {
        console.error('reset email failed', e);
        throw badRequest("We couldn't send the reset email right now. Please try again later or contact your administrator.");
      }
    }
    return { ok: true, emailConfigured: true }; // same answer whether or not the email has an account
  });
  res.json(out);
}));

authRouter.post('/reset/:token', limiter, h(async (req, res) => {
  const { password: pw } = parse(z.object({ password }), req.body);
  await withSystem(async (db) => {
    const t = await one(db, `SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [sha256(String(req.params.token))]);
    if (!t) throw badRequest('This reset link is invalid or has expired. Request a new one.');
    await db.query(`UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1`, [t.user_id, await bcrypt.hash(pw, 12)]);
    await db.query(`UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [t.user_id]);
    for (const m of await many(db, `SELECT tenant_id FROM memberships WHERE user_id=$1 AND status='active'`, [t.user_id]))
      await audit(db, { tenantId: m.tenant_id, userId: t.user_id, ip: req.ip }, 'security', 'password_reset', 'Password reset via email link');
  });
  res.json({ ok: true });
}));

export function newInviteToken() { return crypto.randomBytes(24).toString('hex'); }
