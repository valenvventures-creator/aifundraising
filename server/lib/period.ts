/** Shared helpers for overview screens: a reporting period, the previous period, and workspace scoping. */
import type { Request } from 'express';
import { ministryScope, assertMinistry, type AuthContext } from './auth.js';
import { badRequest } from './errors.js';
import { many, type Db } from '../db/pool.js';

const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayMs = 86400000;
export const shiftDay = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

/** Workspace of a ledger line: the entry's, else its project's, else its fund's. Needs aliases je and jl. */
export const LEDGER_MINISTRY = `coalesce(je.ministry_id, (SELECT pp.ministry_id FROM projects pp WHERE pp.id=jl.project_id), (SELECT ff.ministry_id FROM funds ff WHERE ff.id=jl.fund_id))`;

export interface Period { from: string; to: string; prevFrom: string; prevTo: string; days: number; ministry: string | null }

export function readPeriod(req: Request): Period {
  const year = new Date().getUTCFullYear();
  const from = isDay(req.query.from) ? String(req.query.from) : `${year}-01-01`;
  const to = isDay(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  if (from > to) throw badRequest('The start date must be before the end date.');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
  if (days > 3700) throw badRequest('Choose a range of ten years or less.');
  const ministry = typeof req.query.ministry_id === 'string' && req.query.ministry_id ? req.query.ministry_id : null;
  if (ministry) assertMinistry(req.auth!, ministry);
  return { from, to, prevFrom: shiftDay(from, -days), prevTo: shiftDay(from, -1), days, ministry };
}

/**
 * Query runner where `s(col)` expands to a filter limiting a workspace column (or expression) to what the user
 * may see and, if chosen, the selected workspace. Base parameters are $1.. in order.
 */
export function scopedQuery(a: AuthContext, ministry: string | null) {
  const scope = (col: string, p: unknown[]) => {
    const parts = [ministryScope(a, col, p)];
    if (ministry) { p.push(ministry); parts.push(`${col} = $${p.length}::uuid`); }
    return parts.join(' AND ');
  };
  const q = (db: Db, sql: (s: (col: string) => string) => string, base: unknown[] = []) => {
    const p = [...base];
    return many(db, sql((col) => scope(col, p)), p);
  };
  const q1 = async (db: Db, sql: (s: (col: string) => string) => string, base: unknown[] = []) => (await q(db, sql, base))[0] ?? {};
  return { q, q1 };
}

/** The list of YYYY-MM months ending at `to`, at most 24. */
export function monthsFor(p: Period) {
  const n = Math.min(24, Math.max(1, Math.ceil(p.days / 30.4)));
  const [y, m] = p.to.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}
export const seriesStart = (months: string[]) => `${months[0]}-01`;
