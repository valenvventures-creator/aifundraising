import pg from 'pg';
import { config } from '../config.js';

// numeric -> number (amounts are numeric(14,2); safe in JS doubles for nonprofit-scale values)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (count(*)) -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date -> 'YYYY-MM-DD' string (avoid timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX ?? (process.env.AINP_SERVERLESS ? 3 : 20)) });

/**
 * Tenant transactions run as the NOLOGIN role `ainp_rls` when available. That role
 * never bypasses row-level security, so isolation holds even if the login role is a
 * hosted-database owner with BYPASSRLS (as on some managed Postgres services).
 */
let rlsRole: Promise<boolean> | null = null;
export function hasRlsRole() {
  rlsRole ??= pool.query(`SELECT pg_has_role(current_user, 'ainp_rls', 'SET') AS ok FROM pg_roles WHERE rolname = 'ainp_rls'`)
    .then((r) => Boolean(r.rows[0]?.ok)).catch(() => false);
  return rlsRole;
}
export function resetRlsRoleCache() { rlsRole = null; }

/** True if tenant queries could bypass row-level security. */
export async function rlsUnsafe() {
  if (await hasRlsRole()) return false;
  const r = await pool.query(`SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`);
  return Boolean(r.rows[0]?.bypass);
}

export type Db = pg.PoolClient;

/**
 * Run fn inside a transaction scoped to one tenant. Row-level security policies
 * read app.tenant_id, so even a query that forgets a tenant filter cannot see
 * another customer's rows.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await hasRlsRole()) await client.query('SET LOCAL ROLE ainp_rls');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** System-level transaction (auth lookups, webhooks routing, job runner). Bypasses RLS explicitly. */
export async function withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
