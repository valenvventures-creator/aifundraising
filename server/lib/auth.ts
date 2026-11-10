import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { withSystem, withTenant, type Db } from '../db/pool.js';
import { HttpError, forbidden } from './errors.js';
import type { Permission } from './permissions.js';
import type { Actor } from './audit.js';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  membershipId: string;
  roleName: string;
  permissions: Set<string>;
  allMinistries: boolean;
  ministryIds: string[];   // explicit grants when !allMinistries
  isPlatformOwner: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { auth?: AuthContext } }
}

const COOKIE = 'ainp_session';

export function issueSession(res: Response, userId: string, tenantId: string | null) {
  const token = jwt.sign({ sub: userId, tid: tenantId }, config.jwtSecret, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 12 * 3600 * 1000, path: '/' });
}
export function clearSession(res: Response) { res.clearCookie(COOKIE, { path: '/' }); }

export function readSession(req: Request): { sub: string; tid: string | null; iat?: number } | null {
  const t = req.cookies?.[COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, config.jwtSecret) as any; } catch { return null; }
}

export async function loadContext(userId: string, tenantId: string, issuedAt?: number): Promise<AuthContext | null> {
  return withSystem(async (db) => {
    const r = await db.query(
      `SELECT m.id membership_id, m.all_ministries, m.ministry_ids, r.name role_name, r.permissions,
              u.email, u.name, u.is_platform_owner, u.password_changed_at
         FROM memberships m JOIN roles r ON r.id=m.role_id JOIN users u ON u.id=m.user_id
        WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.status='active'`, [userId, tenantId]);
    const m = r.rows[0];
    if (!m) return null;
    // Sessions signed before the latest password change are no longer valid.
    if (issuedAt && m.password_changed_at && issuedAt * 1000 < new Date(m.password_changed_at).getTime() - 1000) return null;
    return {
      userId, tenantId, email: m.email, name: m.name, membershipId: m.membership_id, roleName: m.role_name,
      permissions: new Set(m.permissions), allMinistries: m.all_ministries, ministryIds: m.ministry_ids ?? [],
      isPlatformOwner: m.is_platform_owner,
    };
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const s = readSession(req);
    if (!s) throw new HttpError(401, 'Please sign in.');
    if (!s.tid) throw new HttpError(409, 'Choose or create an organization first.');
    const ctx = await loadContext(s.sub, s.tid, s.iat);
    if (!ctx) throw new HttpError(401, 'Your access to this organization is no longer active.');
    req.auth = ctx;
    next();
  } catch (e) { next(e); }
}

export function can(ctx: AuthContext, p: Permission) { return ctx.permissions.has(p); }
export function requirePerm(ctx: AuthContext | undefined, ...perms: Permission[]) {
  if (!ctx) throw new HttpError(401, 'Please sign in.');
  for (const p of perms) if (!ctx.permissions.has(p)) throw forbidden(`Your role does not include the “${p}” permission.`);
}
export const perm = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  try { requirePerm(req.auth, ...perms); next(); } catch (e) { next(e); }
};

/** SQL fragment restricting a ministry_id column to the user's workspace grants. */
export function ministryScope(ctx: AuthContext, col: string, params: unknown[]): string {
  if (ctx.allMinistries) return 'TRUE';
  params.push(ctx.ministryIds);
  return `(${col} IS NULL OR ${col} = ANY($${params.length}::uuid[]))`;
}
export function assertMinistry(ctx: AuthContext, ministryId: string | null | undefined) {
  if (!ministryId || ctx.allMinistries) return;
  if (!ctx.ministryIds.includes(ministryId)) throw forbidden('You do not have access to that workspace.');
}

export function actor(req: Request): Actor {
  return { tenantId: req.auth!.tenantId, userId: req.auth!.userId, ip: req.ip };
}

/** Run a tenant-scoped transaction for the current request. */
export function tx<T>(req: Request, fn: (db: Db) => Promise<T>) {
  return withTenant(req.auth!.tenantId, fn);
}
