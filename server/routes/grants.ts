/** Grant finder (USA and Canada) and the grant application workspace. */
import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, actor } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one } from '../db/pool.js';
import { searchUS, detailUS, searchCA, US_ELIGIBILITY, US_CATEGORIES, CA_PROVINCES } from '../services/grantSearch.js';
import { GRANT_TEMPLATES, applicationProgress, type GrantTemplate, type TemplateField } from '../lib/grantTemplates.js';
import { generateText } from '../services/ai.js';
import { renderPdf, type PdfBlock } from '../services/pdf.js';
import { fmtMoney } from '../lib/util.js';

export const grantsRouter = Router();
const country = z.enum(['US', 'CA']);

// ───────── Finder ─────────
grantsRouter.get('/grant-finder/meta', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  res.json({ templates: GRANT_TEMPLATES, usEligibility: US_ELIGIBILITY, usCategories: US_CATEGORIES, caProvinces: CA_PROVINCES });
}));

grantsRouter.get('/grant-finder/us', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  const q = (k: string) => (typeof req.query[k] === 'string' ? String(req.query[k]) : undefined);
  res.json(await searchUS({ q: q('q'), eligibility: q('eligibility'), category: q('category'), status: q('status'), page: Math.min(50, Math.max(0, Number(q('page') ?? 0) || 0)) }));
}));

grantsRouter.get('/grant-finder/us/:id', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  res.json(await detailUS(String(req.params.id)));
}));

grantsRouter.get('/grant-finder/ca', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  res.json(await searchCA({ q: typeof req.query.q === 'string' ? req.query.q : '', province: typeof req.query.province === 'string' ? req.query.province : '' }));
}));

const saveSchema = z.object({
  country, title: z.string().min(1).max(500), funder: z.string().max(300).nullish(), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  url: z.string().url().max(1000).nullish(), source: z.string().max(40).nullish(), source_id: z.string().max(100).nullish(),
  amount: z.number().nonnegative().nullish(), summary: z.string().max(4000).nullish(),
});

/** Save a found opportunity to the grant pipeline (status: researching). */
grantsRouter.post('/grant-finder/save', h(async (req, res) => {
  requirePerm(req.auth, 'grants.write');
  const b = parse(saveSchema, req.body);
  const out = await tx(req, async (db) => {
    const tag = b.source_id ? `[${b.source}:${b.source_id}]` : null;
    if (tag) {
      const existing = await one(db, `SELECT id FROM grants WHERE notes LIKE $1 LIMIT 1`, [`%${tag}%`]);
      if (existing) return { id: existing.id, existed: true };
    }
    let funderId: string | null = null;
    if (b.funder) {
      funderId = (await one(db, `SELECT id FROM funders WHERE lower(name)=lower($1)`, [b.funder]))?.id
        ?? (await one(db, `INSERT INTO funders(tenant_id, name, website, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.auth!.tenantId, b.funder, null, b.country === 'US' ? 'Federal agency (added from Grant Finder)' : 'Government of Canada (added from Grant Finder)'])).id;
    }
    const notes = [b.summary, b.url ? `Opportunity: ${b.url}` : null, tag].filter(Boolean).join('\n\n');
    const g = await one(db, `INSERT INTO grants(tenant_id, funder_id, title, request_amount, deadline, status, notes) VALUES ($1,$2,$3,$4,$5,'researching',$6) RETURNING id`,
      [req.auth!.tenantId, funderId, b.title, b.amount ?? null, b.deadline ?? null, notes || null]);
    await audit(db, actor(req), 'grants', 'create', `Saved grant opportunity “${b.title}” from Grant Finder`, { type: 'grants', id: g.id });
    return { id: g.id, existed: false };
  });
  res.status(out.existed ? 200 : 201).json(out);
}));

// ───────── Applications ─────────
const withProgress = (r: any) => ({ ...r, progress: applicationProgress(GRANT_TEMPLATES[r.country as 'US' | 'CA'], r.data ?? {}) });

grantsRouter.get('/grant-applications', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  const rows = await tx(req, (db) => many(db, `SELECT a.*, u.name AS created_by_name FROM grant_applications a LEFT JOIN users u ON u.id=a.created_by WHERE a.status <> 'archived' OR $1 ORDER BY a.updated_at DESC LIMIT 200`, [req.query.archived === 'true']));
  res.json(rows.map(withProgress));
}));

grantsRouter.post('/grant-applications', h(async (req, res) => {
  requirePerm(req.auth, 'grants.write');
  const b = parse(z.object({
    country, title: z.string().min(1).max(500), funder: z.string().max(300).nullish(), grant_id: z.string().uuid().nullish(),
    source: z.string().max(40).nullish(), source_id: z.string().max(100).nullish(), source_url: z.string().url().max(1000).nullish(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), prefill: z.record(z.string(), z.any()).nullish(),
  }), req.body);
  const row = await tx(req, async (db) => {
    const t = await one(db, `SELECT name, legal_name, email, phone, address1, city, region, postal_code, tax_id FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const me = await one(db, `SELECT name, email FROM users WHERE id=$1`, [req.auth!.userId]);
    const address = [t.address1, [t.city, t.region, t.postal_code].filter(Boolean).join(', ')].filter(Boolean).join('\n');
    // Copy what the organization already has on file, so no one types it twice.
    const data: Record<string, any> = { legal_name: t.legal_name || t.name, address: address || undefined, project_title: b.title, deadline: b.deadline ?? undefined };
    if (b.country === 'US') Object.assign(data, { ein: t.tax_id || undefined, pd_name: me?.name, pd_email: me?.email, agency: b.funder ?? undefined });
    else Object.assign(data, { charity_number: t.tax_id || undefined, contact_name: me?.name, contact_email: me?.email, contact_phone: t.phone || undefined, department: b.funder ?? undefined });
    Object.assign(data, b.prefill ?? {});
    for (const k of Object.keys(data)) if (data[k] === undefined || data[k] === null || data[k] === '') delete data[k];
    const r = await one(db, `INSERT INTO grant_applications(tenant_id, grant_id, country, title, funder, source, source_id, source_url, deadline, data, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.auth!.tenantId, b.grant_id ?? null, b.country, b.title, b.funder ?? null, b.source ?? 'manual', b.source_id ?? null, b.source_url ?? null, b.deadline ?? null, data, req.auth!.userId]);
    await audit(db, actor(req), 'grants', 'create', `Started grant application “${b.title}”`, { type: 'grant_applications', id: r.id });
    return r;
  });
  res.status(201).json(withProgress(row));
}));

async function loadApp(req: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Application');
  const r = await tx(req, (db) => one(db, `SELECT a.*, g.title AS grant_title, g.status AS grant_status FROM grant_applications a LEFT JOIN grants g ON g.id=a.grant_id WHERE a.id=$1`, [id]));
  if (!r) throw notFound('Application');
  return r;
}

grantsRouter.get('/grant-applications/:id', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  res.json(withProgress(await loadApp(req, String(req.params.id))));
}));

grantsRouter.patch('/grant-applications/:id', h(async (req, res) => {
  requirePerm(req.auth, 'grants.write');
  const b = parse(z.object({
    title: z.string().min(1).max(500).optional(), funder: z.string().max(300).nullish(), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    status: z.enum(['drafting', 'in_review', 'ready', 'submitted', 'archived']).optional(),
    data: z.record(z.string(), z.any()).optional(), attachments: z.record(z.string(), z.boolean()).optional(), grant_id: z.string().uuid().nullish(),
  }), req.body);
  if (b.data && JSON.stringify(b.data).length > 400_000) throw badRequest('This application is too large to save. Shorten the longest answers.');
  const prev = await loadApp(req, String(req.params.id));
  const row = await tx(req, async (db) => {
    const r = await one(db, `UPDATE grant_applications SET title=coalesce($2,title), funder=CASE WHEN $3::boolean THEN $4 ELSE funder END, deadline=CASE WHEN $5::boolean THEN $6::date ELSE deadline END,
      status=coalesce($7,status), data=coalesce($8,data), attachments=coalesce($9,attachments), grant_id=CASE WHEN $10::boolean THEN $11::uuid ELSE grant_id END, updated_at=now() WHERE id=$1 RETURNING *`,
      [prev.id, b.title ?? null, 'funder' in b, b.funder ?? null, 'deadline' in b, b.deadline ?? null, b.status ?? null, b.data ?? null, b.attachments ?? null, 'grant_id' in b, b.grant_id ?? null]);
    if (b.status && b.status !== prev.status) await audit(db, actor(req), 'grants', 'update', `Grant application “${r.title}” marked ${b.status.replace('_', ' ')}`, { type: 'grant_applications', id: r.id });
    return r;
  });
  res.json(withProgress(row));
}));

grantsRouter.delete('/grant-applications/:id', h(async (req, res) => {
  requirePerm(req.auth, 'grants.write');
  const prev = await loadApp(req, String(req.params.id));
  await tx(req, async (db) => {
    await db.query(`DELETE FROM grant_applications WHERE id=$1`, [prev.id]);
    await audit(db, actor(req), 'grants', 'delete', `Deleted grant application “${prev.title}”`, { type: 'grant_applications', id: prev.id });
  });
  res.json({ ok: true });
}));

function findField(t: GrantTemplate, key: string): TemplateField | undefined {
  for (const s of t.sections) { const f = s.fields.find((x) => x.key === key); if (f) return f; }
}

/** Plain-text summary of everything already answered, used as context for drafts. */
function answeredContext(t: GrantTemplate, data: Record<string, any>, skip?: string) {
  const out: string[] = [];
  for (const s of t.sections) for (const f of s.fields) {
    if (f.key === skip || f.type === 'budget') continue;
    const v = data[f.key];
    if (v === undefined || v === null || v === '' || v === false) continue;
    out.push(`${f.label}: ${f.type === 'checkbox' ? 'Yes' : String(v).slice(0, 1500)}`);
  }
  return out.join('\n');
}

/** Suggest a draft answer. Returns text only; nothing is saved until the person chooses to use it. */
grantsRouter.post('/grant-applications/:id/draft', h(async (req, res) => {
  requirePerm(req.auth, 'grants.write'); requirePerm(req.auth, 'ai.ask');
  const b = parse(z.object({ field: z.string().max(60), notes: z.string().max(3000).nullish() }), req.body);
  const app = await loadApp(req, String(req.params.id));
  const t = GRANT_TEMPLATES[app.country as 'US' | 'CA'];
  const f = findField(t, b.field);
  if (!f || !f.draftable) throw badRequest('This answer can’t be drafted automatically.');
  const org = await tx(req, (db) => one(db, `SELECT name FROM tenants WHERE id=$1`, [req.auth!.tenantId]));
  const ctx = answeredContext(t, app.data ?? {}, f.key);
  const current = String(app.data?.[f.key] ?? '').trim();
  const text = await generateText({
    effort: 'medium', maxTokens: 6000,
    system: `You help nonprofit staff write grant applications for ${app.country === 'US' ? 'United States federal and private' : 'Government of Canada and Canadian'} funders.
Write in clear, plain, confident language in the first person plural ("we"). Use only facts in the provided information. Where a specific fact, number or name is needed but missing,
write a bracketed placeholder such as [number of participants] instead of inventing it. Do not use headings unless the answer covers several parts. Return only the answer text.`,
    prompt: `Organization: ${org?.name}
Application: ${app.title}${app.funder ? ` (funder: ${app.funder})` : ''}
Question to answer: ${f.label}
Guidance: ${f.help ?? 'n/a'}
Target length: about ${f.words ?? 300} words or fewer.
${b.notes ? `Notes from the writer: ${b.notes}\n` : ''}${current ? `Current answer to improve:\n${current}\n` : ''}
Information already in the application:
${ctx || '(nothing yet)'}`,
  });
  const fallback = [`${f.label}`, '', f.help ? `Guidance: ${f.help}` : '', '',
    'Start with one sentence that states the main point.', 'Add [specific facts, numbers and local data with sources].', 'Explain how this connects to the funder\'s priorities: [quote the program objective].',
    'End with the result you expect: [measurable outcome and date].'].filter((x, i, a) => x || a[i - 1]).join('\n');
  await tx(req, (db) => audit(db, actor(req), 'ai', 'draft', `Suggested a draft for “${f.label}” in grant application “${app.title}”`, { type: 'grant_applications', id: app.id }, { generator: text ? 'claude' : 'outline' }));
  res.json({ text: text ?? fallback, generator: text ? 'ai' : 'outline' });
}));

grantsRouter.get('/grant-applications/:id/pdf', h(async (req, res) => {
  requirePerm(req.auth, 'grants.read');
  const app = await loadApp(req, String(req.params.id));
  const t = GRANT_TEMPLATES[app.country as 'US' | 'CA'];
  const org = await tx(req, (db) => one(db, `SELECT name FROM tenants WHERE id=$1`, [req.auth!.tenantId]));
  const data = app.data ?? {};
  const p = applicationProgress(t, data);
  const cur = (n: number) => fmtMoney(n, t.currency, t.country === 'CA' ? 'en-CA' : 'en-US');
  const blocks: PdfBlock[] = [{ type: 'metrics', items: [{ label: 'Required answers', value: `${p.done} of ${p.total}` }, { label: 'Funder', value: app.funder ?? '—' }, { label: 'Deadline', value: app.deadline ? String(app.deadline).slice(0, 10) : '—' }] }];
  for (const s of t.sections) {
    blocks.push({ type: 'h1', text: s.title });
    const short = s.fields.filter((f) => !['textarea', 'budget'].includes(f.type));
    if (short.length) blocks.push({ type: 'kv', rows: short.map((f) => [f.label, f.type === 'checkbox' ? (data[f.key] ? 'Yes' : 'No') : f.type === 'money' && data[f.key] ? cur(Number(data[f.key])) : String(data[f.key] ?? '')]) });
    for (const f of s.fields.filter((x) => x.type === 'textarea')) {
      blocks.push({ type: 'h2', text: f.label });
      blocks.push(data[f.key] ? { type: 'p', text: String(data[f.key]) } : { type: 'muted', text: 'Not answered yet.' });
    }
    for (const f of s.fields.filter((x) => x.type === 'budget')) {
      const bd = data[f.key] ?? {};
      const rows = t.budgetLines.map((l) => [l.label, bd[l.key]?.amount ? cur(Number(bd[l.key].amount)) : '—', String(bd[l.key]?.note ?? '')]);
      const total = t.budgetLines.reduce((a, l) => a + (Number(bd[l.key]?.amount) || 0), 0);
      rows.push(['Total', cur(total), '']);
      blocks.push({ type: 'table', columns: ['Category', 'Amount', 'How it was calculated'], rows, widths: [150, 90, 272], align: ['left', 'right', 'left'] });
    }
  }
  blocks.push({ type: 'h1', text: 'Attachments checklist' });
  blocks.push({ type: 'table', columns: ['Document', 'Ready'], rows: t.attachments.map((a) => [a.label, app.attachments?.[a.key] ? 'Yes' : '—']), widths: [430, 82] });
  blocks.push({ type: 'muted', text: 'Prepared in A.I. Fundraising as a working copy. Submit through the funder’s own form or portal, following its instructions and limits.' });
  await tx(req, (db) => audit(db, actor(req), 'export', 'export', `Downloaded grant application “${app.title}”`, { type: 'grant_applications', id: app.id }));
  renderPdf(res, `${app.title.slice(0, 60)} - application.pdf`, { title: app.title, subtitle: t.name, org: org?.name, blocks });
}));
