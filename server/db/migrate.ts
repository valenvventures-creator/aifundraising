import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, resetRlsRoleCache } from './pool.js';

// import.meta.url is unavailable when bundled as CommonJS (Netlify Functions).
const selfFile = import.meta.url ? fileURLToPath(import.meta.url) : '';
const here = selfFile ? path.dirname(selfFile) : process.cwd();
function migrationsDir() {
  // When bundled for Netlify, __dirname is <function root>/netlify/functions.
  const bundleDir = typeof __dirname !== 'undefined' ? __dirname : here;
  const candidates = [path.join(here, 'migrations'), path.resolve(bundleDir, '../../server/db/migrations'), path.resolve(process.env.LAMBDA_TASK_ROOT ?? '.', 'server/db/migrations'), path.resolve('server/db/migrations')];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return dir;
}

export async function migrate() {
  const c = await pool.connect();
  try {
    // Serverless cold starts can run this concurrently; serialize with an advisory lock.
    await c.query('SELECT pg_advisory_lock(727274001)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`applied ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    await ensureRlsRole(c);
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274001)').catch(() => {});
    c.release();
    resetRlsRoleCache();
  }
}

/** Best effort: create the NOLOGIN role tenant transactions switch to, and keep its grants current. */
async function ensureRlsRole(c: import('pg').PoolClient) {
  const step = async (sql: string) => { try { await c.query(sql); return true; } catch { return false; } };
  const exists = (await c.query(`SELECT 1 FROM pg_roles WHERE rolname='ainp_rls'`)).rowCount;
  if (!exists && !(await step('CREATE ROLE ainp_rls NOLOGIN NOSUPERUSER NOBYPASSRLS'))) return;
  await step('GRANT ainp_rls TO CURRENT_USER');
  await step('GRANT USAGE ON SCHEMA public TO ainp_rls');
  await step('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ainp_rls');
  await step('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ainp_rls');
}

if (selfFile && process.argv[1] && selfFile === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
