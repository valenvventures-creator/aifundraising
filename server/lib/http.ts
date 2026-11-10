import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type infer as ZInfer } from 'zod';
import { HttpError } from './errors.js';

export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): ZInfer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`);
    throw new HttpError(422, `Please fix: ${issues.join('; ')}`, r.error.issues);
  }
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(422).json({ error: 'Validation failed', details: err.issues });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
  // Postgres constraint errors -> specific messages
  if (err?.code === '23505') return res.status(409).json({ error: `A record with that ${String(err.constraint ?? 'value').replace(/_key$|_idx$/, '').replace(/_/g, ' ')} already exists.` });
  if (err?.code === '23503') return res.status(409).json({ error: 'This record is linked to other records (or references a record that does not exist).', details: err.detail });
  if (err?.code === '23514') return res.status(422).json({ error: `A value failed validation (${err.constraint}).` });
  if (err?.code === '22P02') return res.status(400).json({ error: 'An identifier or value had an invalid format.' });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error. The problem has been logged.' });
}
