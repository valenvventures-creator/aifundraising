import { Router, type Request } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, ministryScope, assertMinistry, actor, can } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one, type Db } from '../db/pool.js';
import { DONOR_NAME_SQL, fmtMoney, today, addDays, donorName } from '../lib/util.js';
import { recalcDonors, opportunityReport, CATEGORY_META, HEALTH_ORDER } from '../services/intelligence.js';
import { sendTable } from '../services/exporter.js';
import { renderPdf } from '../services/pdf.js';
import { gazetteer } from '../services/geo.js';

export const donorsRouter = Router();

const donorSchema = z.object({
  donor_type: z.enum(['individual', 'household', 'foundation', 'business', 'church', 'organization']).default('individual'),
  first_name: z.string().nullish(), last_name: z.string().nullish(), org_name: z.string().nullish(),
  household_name: z.string().nullish(), spouse_name: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')), phone: z.string().nullish(),
  address1: z.string().nullish(), address2: z.string().nullish(), city: z.string().nullish(), region: z.string().nullish(),
  postal_code: z.string().nullish(), country: z.string().nullish(),
  comm_prefs: z.object({ email: z.boolean(), phone: z.boolean(), text: z.boolean(), mail: z.boolean() }).partial().optional(),
  notes: z.string().nullish(), private_notes: z.string().nullish(), tags: z.array(z.string()).optional(), source: z.string().nullish(),
  owner_user_id: z.string().uuid().nullish(), custom: z.record(z.string(), z.any()).optional(), capacity_estimate: z.number().nullish(),
  ministry_id: z.string().uuid().nullish(), lat: z.number().nullish(), lng: z.number().nullish(),
});

function nameOk(d: any) {
  if (['individual', 'household'].includes(d.donor_type ?? 'individual')) return Boolean(d.first_name || d.last_name || d.household_name);
  return Boolean(d.org_name);
}

export async function findDuplicates(db: Db, d: any, excludeId?: string) {
  const p: unknown[] = [d.email ?? '', (d.phone ?? '').replace(/\D/g, ''), d.first_name ?? '', d.last_name ?? '', d.postal_code ?? '', d.org_name ?? '', excludeId ?? null];
  return many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.email, d.phone, d.city, d.region,
      CASE WHEN $1<>'' AND lower(d.email)=lower($1) THEN 'Same email'
           WHEN length($2)>=7 AND regexp_replace(coalesce(d.phone,''),'\\D','','g') = $2 THEN 'Same phone'
           WHEN $6<>'' AND lower(d.org_name)=lower($6) THEN 'Same organization name'
           ELSE 'Same name and postal code' END AS reason
    FROM donors d WHERE NOT d.archived AND d.merged_into IS NULL AND ($7::uuid IS NULL OR d.id <> $7::uuid) AND (
      ($1<>'' AND lower(d.email)=lower($1)) OR (length($2)>=7 AND regexp_replace(coalesce(d.phone,''),'\\D','','g') = $2)
      OR ($6<>'' AND lower(d.org_name)=lower($6))
      OR ($3<>'' AND $4<>'' AND lower(d.first_name)=lower($3) AND lower(d.last_name)=lower($4) AND ($5='' OR d.postal_code=$5)))
    LIMIT 5`, p);
}

export async function createDonor(db: Db, req: Request, raw: any, opts: { skipDuplicateCheck?: boolean } = {}) {
  const d = parse(donorSchema, raw);
  if (!nameOk(d)) throw badRequest(['individual', 'household'].includes(d.donor_type) ? 'Enter a first name, last name or household name.' : 'Enter the organization name.');
  if (d.email === '') d.email = null;
  if (d.private_notes && !can(req.auth!, 'donors.private_notes')) delete d.private_notes;
  assertMinistry(req.auth!, d.ministry_id);
  if (!opts.skipDuplicateCheck) {
    const dups = await findDuplicates(db, d);
    if (dups.length) throw conflict('Possible duplicate donor found. Review the matches or choose “Create anyway”.', { duplicates: dups });
  }
  if (d.lat == null && d.city) { const g = gazetteer(d.city, d.region); if (g) { d.lat = g.lat; d.lng = g.lng; } }
  const cols = Object.keys(d).filter((k) => (d as any)[k] !== undefined);
  const row = await one(db, `INSERT INTO donors(tenant_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
    [req.auth!.tenantId, ...cols.map((k) => (d as any)[k])]);
  await recalcDonors(db, row.id);
  await audit(db, actor(req), 'donors', 'create', `Added donor ${donorName(row)}`, { type: 'donor', id: row.id });
  await db.query(`INSERT INTO job_queue(tenant_id, kind, payload) VALUES ($1,'journey.trigger',$2)`, [req.auth!.tenantId, { trigger: 'donor_created', donorId: row.id }]);
  return row;
}

function donorListQuery(req: Request) {
  const p: unknown[] = []; const w = ['NOT d.archived', 'd.merged_into IS NULL', ministryScope(req.auth!, 'd.ministry_id', p)];
  const qv = (k: string) => (req.query[k] === undefined || req.query[k] === '' ? undefined : String(req.query[k]));
  if (qv('archived') === 'true') w[0] = 'd.archived';
  const q = qv('q');
  if (q) {
    p.push(`%${q}%`); const i = p.length; p.push(q.replace(/\D/g, '')); const ph = p.length;
    w.push(`(${DONOR_NAME_SQL()} ILIKE $${i} OR d.email ILIKE $${i} OR d.spouse_name ILIKE $${i} OR d.city ILIKE $${i} OR (length($${ph})>=4 AND regexp_replace(coalesce(d.phone,''),'\\D','','g') LIKE '%'||$${ph}||'%'))`);
  }
  if (qv('health')) { p.push(String(qv('health')).split(',')); w.push(`d.health_status = ANY($${p.length})`); }
  if (qv('category')) { p.push(qv('category')); w.push(`d.intelligence->>'category' = $${p.length}`); }
  if (qv('tag')) { p.push(qv('tag')); w.push(`$${p.length} = ANY(d.tags)`); }
  if (qv('owner')) { p.push(qv('owner') === 'me' ? req.auth!.userId : qv('owner')); w.push(`d.owner_user_id = $${p.length}`); }
  if (qv('ministry_id')) { p.push(qv('ministry_id')); w.push(`d.ministry_id = $${p.length}`); }
  if (qv('donor_type')) { p.push(qv('donor_type')); w.push(`d.donor_type = $${p.length}`); }
  if (qv('region')) { p.push(qv('region')); w.push(`lower(d.region) = lower($${p.length})`); }
  if (qv('min_score')) { p.push(Number(qv('min_score'))); w.push(`d.score >= $${p.length}`); }
  if (qv('min_lifetime')) { p.push(Number(qv('min_lifetime'))); w.push(`coalesce((d.intelligence->'stats'->>'lifetime')::numeric,0) >= $${p.length}`); }
  if (qv('campaign_id')) { p.push(qv('campaign_id')); w.push(`EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.campaign_id=$${p.length})`); }
  if (qv('recurring') === 'true') w.push(`EXISTS (SELECT 1 FROM recurring_gifts r WHERE r.donor_id=d.id AND r.status='active')`);
  if (qv('last_gift_before')) { p.push(qv('last_gift_before')); w.push(`coalesce(d.intelligence->'stats'->>'lastGift','0000') < $${p.length}`); }
  if (qv('last_gift_after')) { p.push(qv('last_gift_after')); w.push(`d.intelligence->'stats'->>'lastGift' >= $${p.length}`); }
  const sorts: Record<string, string> = {
    name: `${DONOR_NAME_SQL()}`, score: 'd.score', lifetime: `coalesce((d.intelligence->'stats'->>'lifetime')::numeric,0)`,
    last_gift: `d.intelligence->'stats'->>'lastGift'`, opportunity: `coalesce((d.intelligence->>'opportunityValue')::numeric,0)`, created_at: 'd.created_at',
    city: 'd.city', health: `array_position(ARRAY['active','engaged','cooling','lapsing','lapsed'], d.health_status)`,
  };
  const sort = sorts[String(req.query.sort ?? 'score')] ?? 'd.score';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  return { where: w.join(' AND '), params: p, order: `${sort} ${dir} NULLS LAST, d.id` };
}

const LIST_COLS = `d.id, d.donor_type, ${DONOR_NAME_SQL()} AS name, d.first_name, d.last_name, d.org_name, d.email, d.phone, d.city, d.region, d.postal_code,
  d.health_status, d.health_override, d.score, d.tags, d.ministry_id, m.name ministry_name, d.owner_user_id, u.name owner_name, d.lat, d.lng,
  (d.intelligence->'stats'->>'lifetime')::float lifetime, d.intelligence->'stats'->>'lastGift' last_gift, (d.intelligence->'stats'->>'lastAmount')::float last_amount,
  (d.intelligence->'stats'->>'giftCount')::int gift_count, d.intelligence->>'categoryLabel' opportunity, d.intelligence->>'category' category,
  (d.intelligence->>'suggestedAsk')::float suggested_ask, (d.intelligence->>'opportunityValue')::float opportunity_value, d.intelligence->>'nextStep' next_step,
  d.intelligence->>'priority' priority, d.intelligence->>'channel' channel, (d.intelligence->'stats'->>'recurringMonthly')::float recurring_monthly`;

donorsRouter.get('/', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const { where, params, order } = donorListQuery(req);
  const limit = Math.min(Number(req.query.limit ?? 50), 1000), offset = Number(req.query.offset ?? 0);
  const out = await tx(req, async (db) => ({
    rows: await many(db, `SELECT ${LIST_COLS} FROM donors d LEFT JOIN ministries m ON m.id=d.ministry_id LEFT JOIN users u ON u.id=d.owner_user_id WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params),
    total: (await one(db, `SELECT count(*)::int n FROM donors d WHERE ${where}`, params))!.n, limit, offset,
  }));
  res.json(out);
}));

donorsRouter.get('/export', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read', 'data.export');
  const { where, params, order } = donorListQuery(req);
  const rows = await tx(req, async (db) => {
    const r = await many(db, `SELECT ${LIST_COLS}, d.address1, d.address2, d.country, d.spouse_name, d.household_name, d.source, d.notes FROM donors d LEFT JOIN ministries m ON m.id=d.ministry_id LEFT JOIN users u ON u.id=d.owner_user_id WHERE ${where} ORDER BY ${order} LIMIT 100000`, params);
    await audit(db, actor(req), 'export', 'export', `Exported ${r.length} donors`, { type: 'donor' }, { filters: req.query });
    return r;
  });
  const cols = ['name', 'donor_type', 'first_name', 'last_name', 'org_name', 'spouse_name', 'household_name', 'email', 'phone', 'address1', 'address2', 'city', 'region', 'postal_code', 'country',
    'health_status', 'score', 'lifetime', 'last_gift', 'last_amount', 'gift_count', 'opportunity', 'suggested_ask', 'next_step', 'tags', 'ministry_name', 'owner_name', 'source', 'notes'];
  await sendTable(res, req.query.format === 'xlsx' ? 'xlsx' : 'csv', `donors-${today()}`, cols.map((k) => ({ key: k, label: k })), rows);
}));

donorsRouter.post('/duplicates', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  res.json(await tx(req, (db) => findDuplicates(db, req.body ?? {}, req.body?.excludeId)));
}));

donorsRouter.post('/', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  const row = await tx(req, (db) => createDonor(db, req, req.body, { skipDuplicateCheck: req.query.force === 'true' }));
  res.status(201).json(row);
}));

async function getDonor(db: Db, req: Request, id: string) {
  const p: unknown[] = [id];
  const d = await one(db, `SELECT d.*, ${DONOR_NAME_SQL()} AS name, m.name ministry_name, u.name owner_name FROM donors d LEFT JOIN ministries m ON m.id=d.ministry_id LEFT JOIN users u ON u.id=d.owner_user_id WHERE d.id=$1 AND ${ministryScope(req.auth!, 'd.ministry_id', p)}`, p);
  if (!d) throw notFound('Donor');
  if (!can(req.auth!, 'donors.private_notes')) { d.private_notes = d.private_notes ? '(restricted)' : null; d.private_notes_restricted = true; }
  return d;
}

donorsRouter.get('/:id', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const priv = can(req.auth!, 'donors.private_notes');
  const out = await tx(req, async (db) => {
    const d = await getDonor(db, req, String(req.params.id));
    const id = d.id;
    const [gifts, comms, tasks, receipts, asks, recurring, regs, projects, drafts, attachments] = await Promise.all([
      many(db, `SELECT g.*, f.name fund_name, f.restriction, c.name campaign_name, p.name project_name, u.name follow_up_name FROM gifts g JOIN funds f ON f.id=g.fund_id LEFT JOIN campaigns c ON c.id=g.campaign_id LEFT JOIN projects p ON p.id=g.project_id LEFT JOIN users u ON u.id=g.follow_up_user_id WHERE g.donor_id=$1 ORDER BY g.gift_date DESC`, [id]),
      many(db, `SELECT c.*, u.name user_name FROM communications c LEFT JOIN users u ON u.id=c.user_id WHERE c.donor_id=$1 ${priv ? '' : 'AND NOT c.is_private'} ORDER BY c.occurred_at DESC LIMIT 100`, [id]),
      many(db, `SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.donor_id=$1 ORDER BY (t.status='completed'), t.due_date NULLS LAST`, [id]),
      many(db, `SELECT * FROM receipts WHERE donor_id=$1 ORDER BY issued_at DESC`, [id]),
      many(db, `SELECT a.*, u.name user_name FROM asks a LEFT JOIN users u ON u.id=a.user_id WHERE a.donor_id=$1 ORDER BY asked_on DESC`, [id]),
      many(db, `SELECT r.*, f.name fund_name FROM recurring_gifts r LEFT JOIN funds f ON f.id=r.fund_id WHERE r.donor_id=$1`, [id]),
      many(db, `SELECT r.*, e.name event_name, e.starts_at FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.donor_id=$1 ORDER BY e.starts_at DESC`, [id]),
      many(db, `SELECT p.id, p.name, sum(g.amount)::float given FROM gifts g JOIN projects p ON p.id=g.project_id WHERE g.donor_id=$1 GROUP BY p.id`, [id]),
      many(db, `SELECT id, kind, title, created_at, generator FROM drafts WHERE donor_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      many(db, `SELECT id, filename, mime, size, created_at FROM attachments WHERE entity_type='donor' AND entity_id=$1`, [id]),
    ]);
    const emailStats = await one(db, `SELECT count(*) FILTER (WHERE type='open')::int opens, count(*) FILTER (WHERE type='click')::int clicks FROM email_events WHERE donor_id=$1`, [id]);
    const household = d.household_name ? await many(db, `SELECT id, ${DONOR_NAME_SQL()} AS name FROM donors d WHERE household_name=$1 AND id<>$2 AND NOT archived`, [d.household_name, id]) : [];
    return { donor: d, gifts, communications: comms, tasks, receipts, asks, recurring, registrations: regs, projects, drafts, attachments, emailStats, household };
  });
  res.json(out);
}));

donorsRouter.patch('/:id', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  const d = parse(donorSchema.partial().extend({ health_override: z.enum(['active', 'engaged', 'cooling', 'lapsing', 'lapsed']).nullish() }), req.body);
  if ('private_notes' in d && !can(req.auth!, 'donors.private_notes')) delete d.private_notes;
  if (d.email === '') d.email = null;
  assertMinistry(req.auth!, d.ministry_id);
  const row = await tx(req, async (db) => {
    const cur = await getDonor(db, req, String(req.params.id));
    if ((d.city !== undefined || d.region !== undefined) && d.lat === undefined) {
      const g = gazetteer(d.city ?? cur.city, d.region ?? cur.region); d.lat = g?.lat ?? null; d.lng = g?.lng ?? null;
    }
    const keys = Object.keys(d).filter((k) => (d as any)[k] !== undefined);
    if (!keys.length) throw badRequest('Nothing to update.');
    const r = await one(db, `UPDATE donors SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1 RETURNING *`, [cur.id, ...keys.map((k) => (d as any)[k])]);
    if (!nameOk(r)) throw badRequest('A donor needs a name.');
    await recalcDonors(db, cur.id);
    await audit(db, actor(req), 'donors', 'update', `Updated donor ${donorName(r)}${'health_override' in d ? ` (health override: ${d.health_override ?? 'automatic'})` : ''}`, { type: 'donor', id: cur.id }, { fields: keys });
    return r;
  });
  res.json(row);
}));

donorsRouter.post('/:id/archive', h(async (req, res) => {
  requirePerm(req.auth, 'donors.delete');
  await tx(req, async (db) => {
    const d = await getDonor(db, req, String(req.params.id));
    await db.query(`UPDATE donors SET archived = NOT archived WHERE id=$1`, [d.id]);
    await audit(db, actor(req), 'donors', d.archived ? 'restore' : 'archive', `${d.archived ? 'Restored' : 'Archived'} donor ${d.name}`, { type: 'donor', id: d.id });
  });
  res.json({ ok: true });
}));

/** Merge: move all related records from `sourceId` into `:id`, then mark the source merged. */
donorsRouter.post('/:id/merge', h(async (req, res) => {
  requirePerm(req.auth, 'donors.delete', 'donors.write');
  const { sourceId } = parse(z.object({ sourceId: z.string().uuid() }), req.body);
  if (sourceId === req.params.id) throw badRequest('Choose a different donor to merge.');
  await tx(req, async (db) => {
    const target = await getDonor(db, req, String(req.params.id));
    const source = await getDonor(db, req, sourceId);
    for (const t of ['gifts', 'communications', 'tasks', 'receipts', 'asks', 'recurring_gifts', 'registrations', 'drafts', 'email_messages', 'email_events', 'journey_enrollments', 'funders']) {
      await db.query(`UPDATE ${t} SET donor_id=$1 WHERE donor_id=$2`, [target.id, source.id]).catch(async (e) => {
        if (e.code === '23505') await db.query(`DELETE FROM ${t} WHERE donor_id=$1`, [source.id]); else throw e;
      });
    }
    await db.query(`UPDATE trip_stops SET donor_id=$1 WHERE donor_id=$2 AND trip_id NOT IN (SELECT trip_id FROM trip_stops WHERE donor_id=$1)`, [target.id, source.id]);
    await db.query(`UPDATE attachments SET entity_id=$1 WHERE entity_type='donor' AND entity_id=$2`, [target.id, source.id]);
    await db.query(`UPDATE donors SET email=coalesce(email,$2), phone=coalesce(phone,$3), tags=(SELECT array_agg(DISTINCT x) FROM unnest(tags || $4::text[]) x),
      notes=concat_ws(E'\n', notes, $5::text) WHERE id=$1`, [target.id, source.email, source.phone, source.tags, source.notes]);
    await db.query(`UPDATE donors SET merged_into=$1, archived=true WHERE id=$2`, [target.id, source.id]);
    await recalcDonors(db, target.id);
    await audit(db, actor(req), 'donors', 'merge', `Merged donor ${source.name} into ${target.name}`, { type: 'donor', id: target.id }, { sourceId });
  });
  res.json({ ok: true });
}));

donorsRouter.post('/:id/contact', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  const b = parse(z.object({ type: z.string().min(1), subject: z.string().nullish(), body: z.string().nullish(), occurred_at: z.string().nullish(),
    duration_hours: z.number().nullish(), direction: z.enum(['inbound', 'outbound']).default('outbound'), is_private: z.boolean().default(false),
    follow_up_date: z.string().nullish(), follow_up_title: z.string().nullish() }), req.body);
  const out = await tx(req, async (db) => {
    const d = await getDonor(db, req, String(req.params.id));
    const c = await one(db, `INSERT INTO communications(tenant_id, ministry_id, donor_id, user_id, type, direction, subject, body, occurred_at, duration_hours, is_private)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),$10,$11) RETURNING *`,
      [req.auth!.tenantId, d.ministry_id, d.id, req.auth!.userId, b.type, b.direction, b.subject ?? null, b.body ?? null, b.occurred_at ?? null, b.duration_hours ?? null, b.is_private && can(req.auth!, 'donors.private_notes')]);
    if (b.follow_up_date) await db.query(`INSERT INTO tasks(tenant_id, ministry_id, title, due_date, donor_id, assignee_id, created_by, category) VALUES ($1,$2,$3,$4,$5,$6,$6,'Donor follow-up')`,
      [req.auth!.tenantId, d.ministry_id, b.follow_up_title || `Follow up with ${d.name}`, b.follow_up_date, d.id, req.auth!.userId]);
    await recalcDonors(db, d.id);
    await audit(db, actor(req), 'donors', 'log_contact', `Logged ${b.type} with ${d.name}`, { type: 'donor', id: d.id });
    return c;
  });
  res.status(201).json(out);
}));

donorsRouter.post('/:id/move-done', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  await tx(req, async (db) => {
    const d = await getDonor(db, req, String(req.params.id));
    await db.query(`INSERT INTO communications(tenant_id, ministry_id, donor_id, user_id, type, subject, body) VALUES ($1,$2,$3,$4,'note','Fundraising move completed',$5)`,
      [req.auth!.tenantId, d.ministry_id, d.id, req.auth!.userId, `${d.intelligence?.categoryLabel ?? 'Move'} — ${d.intelligence?.nextStep ?? ''}`]);
    await recalcDonors(db, d.id);
  });
  res.json({ ok: true });
}));

/** Donor brief (JSON or PDF). */
async function buildBrief(db: Db, req: Request, id: string, includePrivate: boolean) {
  const d = await getDonor(db, req, id);
  const gifts = await many(db, `SELECT g.gift_date, g.amount::float, f.name fund, c.name campaign, p.name project FROM gifts g JOIN funds f ON f.id=g.fund_id LEFT JOIN campaigns c ON c.id=g.campaign_id LEFT JOIN projects p ON p.id=g.project_id WHERE g.donor_id=$1 AND NOT g.refunded ORDER BY g.gift_date DESC LIMIT 12`, [d.id]);
  const comms = await many(db, `SELECT type, subject, occurred_at, left(body,240) body FROM communications WHERE donor_id=$1 ${includePrivate ? '' : 'AND NOT is_private'} ORDER BY occurred_at DESC LIMIT 6`, [d.id]);
  const byYear = await many(db, `SELECT extract(year from gift_date)::int yr, sum(amount)::float total, count(*)::int n FROM gifts WHERE donor_id=$1 AND NOT refunded GROUP BY 1 ORDER BY 1 DESC LIMIT 6`, [d.id]);
  const campaigns = await many(db, `SELECT DISTINCT c.name FROM gifts g JOIN campaigns c ON c.id=g.campaign_id WHERE g.donor_id=$1`, [d.id]);
  const funds = await many(db, `SELECT f.name, sum(g.amount)::float total FROM gifts g JOIN funds f ON f.id=g.fund_id WHERE g.donor_id=$1 AND NOT g.refunded GROUP BY f.name ORDER BY 2 DESC`, [d.id]);
  const i = d.intelligence ?? {}; const s = i.stats ?? {};
  const angle = i.category === 'lapsed_major' ? 'Reconnect personally: thank them for past partnership and share what has changed since their last gift.'
    : i.category === 'recurring_upgrade' ? 'Celebrate their faithfulness as a monthly partner; show what a small increase unlocks.'
    : i.category === 'first_time_follow_up' ? 'Welcome them; ask what inspired the first gift; invite them deeper.'
    : funds[0] ? `Connect to their interest in ${funds[0].name}; share a specific outcome there.` : 'Learn their interests and share a recent story of impact.';
  return { donor: d, gifts, comms, byYear, campaigns: campaigns.map((c) => c.name), funds, intelligence: i, stats: s, angle,
    privateNotes: includePrivate && can(req.auth!, 'donors.private_notes') ? d.private_notes : null };
}

donorsRouter.get('/:id/brief', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const includePrivate = req.query.private === 'true';
  const b = await tx(req, (db) => buildBrief(db, req, String(req.params.id), includePrivate));
  if (req.query.format !== 'pdf') return res.json(b);
  const t = await tx(req, async (db) => {
    await audit(db, actor(req), 'export', 'export_pdf', `Exported donor brief for ${b.donor.name}`, { type: 'donor', id: b.donor.id });
    return one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
  });
  const m = (n: number) => fmtMoney(n, t.currency);
  const s = b.stats, i = b.intelligence;
  renderPdf(res, `Donor brief - ${b.donor.name}.pdf`, {
    title: `Donor Brief: ${b.donor.name}`, subtitle: `Prepared ${today()} · ${b.donor.health_status.toUpperCase()} · Score ${b.donor.score}/100`, org: t.name,
    blocks: [
      { type: 'metrics', items: [{ label: 'Lifetime giving', value: m(s.lifetime ?? 0) }, { label: 'Gifts', value: String(s.giftCount ?? 0) }, { label: 'Last gift', value: s.lastGift ?? '—' }, { label: 'Largest', value: m(s.largest ?? 0) }] },
      { type: 'h2', text: 'Relationship summary' },
      { type: 'kv', rows: [['Contact', [b.donor.email, b.donor.phone].filter(Boolean).join(' · ')], ['Location', [b.donor.city, b.donor.region].filter(Boolean).join(', ')],
        ['Relationship owner', b.donor.owner_name ?? '—'], ['Spouse / household', [b.donor.spouse_name, b.donor.household_name].filter(Boolean).join(' / ') || '—'],
        ['Campaigns', b.campaigns.join(', ') || '—'], ['Funds supported', b.funds.map((f) => `${f.name} (${m(f.total)})`).join(', ') || '—'],
        ['Capacity context', b.donor.capacity_estimate ? `Estimated capacity ${m(b.donor.capacity_estimate)}` : 'Not recorded']] },
      { type: 'h2', text: 'Suggested approach (estimate — not a certainty)' },
      { type: 'kv', rows: [['Next step', i.nextStep ?? '—'], ['Suggested ask', i.suggestedAsk ? `${m(i.suggestedAsk)}${i.isMonthlyAsk ? ' / month' : ''} (range ${m(i.askLow)}–${m(i.askHigh)})` : '—'],
        ['Basis', i.askBasis ?? '—'], ['Conversation angle', b.angle], ['Channel', i.channel ?? '—'], ['Follow up by', i.followUpOn ?? '—'], ['Why', (i.reasons ?? []).join('; ') || '—']] },
      { type: 'h2', text: 'Giving by year' },
      { type: 'table', columns: ['Year', 'Gifts', 'Total'], rows: b.byYear.map((y) => [y.yr, y.n, m(y.total)]), align: ['left', 'right', 'right'] },
      { type: 'h2', text: 'Recent gifts' },
      { type: 'table', columns: ['Date', 'Amount', 'Fund', 'Campaign / Project'], rows: b.gifts.map((g) => [g.gift_date, m(g.amount), g.fund, [g.campaign, g.project].filter(Boolean).join(' / ')]), widths: [80, 80, 140, 212], align: ['left', 'right', 'left', 'left'] },
      { type: 'h2', text: 'Recent interactions' },
      { type: 'table', columns: ['Date', 'Type', 'Summary'], rows: b.comms.map((c) => [String(c.occurred_at instanceof Date ? c.occurred_at.toISOString() : c.occurred_at).slice(0, 10), c.type, [c.subject, c.body].filter(Boolean).join(' — ')]), widths: [80, 70, 362] },
      ...(b.donor.notes ? [{ type: 'h2' as const, text: 'Notes' }, { type: 'p' as const, text: b.donor.notes }] : []),
      ...(b.privateNotes ? [{ type: 'h2' as const, text: 'Private notes (confidential)' }, { type: 'p' as const, text: b.privateNotes }] : []),
      { type: 'muted', text: 'Confidential donor information. Scores and suggested asks are calculated from giving history and configurable rules; they are estimates.' },
    ],
  });
}));

// ───────── Dashboards & fundraising priorities ─────────
donorsRouter.get('/intel/overview', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const ministry = req.query.ministry_id ? String(req.query.ministry_id) : null;
  assertMinistry(req.auth!, ministry);
  const out = await tx(req, async (db) => {
    const p: unknown[] = [ministry]; const sc = ministryScope(req.auth!, 'd.ministry_id', p);
    const base = `NOT d.archived AND d.merged_into IS NULL AND ($1::uuid IS NULL OR d.ministry_id=$1) AND ${sc}`;
    const health = await many(db, `SELECT health_status, count(*)::int n FROM donors d WHERE ${base} GROUP BY 1`, p);
    const moves = await many(db, `SELECT ${LIST_COLS}, d.intelligence->'reasons' reasons, (d.intelligence->>'askLow')::float ask_low, (d.intelligence->>'askHigh')::float ask_high,
        d.intelligence->>'followUpOn' follow_up_on, (d.intelligence->>'isMonthlyAsk')::boolean is_monthly
      FROM donors d LEFT JOIN ministries m ON m.id=d.ministry_id LEFT JOIN users u ON u.id=d.owner_user_id
      WHERE ${base} AND d.intelligence->>'category' <> 'cultivate'
        AND NOT EXISTS (SELECT 1 FROM communications c WHERE c.donor_id=d.id AND c.occurred_at > now() - interval '14 days')
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.donor_id=d.id AND t.status<>'completed' AND t.created_at > now() - interval '14 days')
      ORDER BY CASE d.intelligence->>'priority' WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, (d.intelligence->>'opportunityValue')::numeric DESC NULLS LAST LIMIT ${Math.min(Number(req.query.moves ?? 12), 50)}`, p);
    const p2: unknown[] = [ministry]; const sc2 = ministryScope(req.auth!, 'g.ministry_id', p2);
    const q = (col: string) => many(db, `SELECT g.id, g.donor_id, ${DONOR_NAME_SQL()} AS donor, g.amount::float, g.gift_date, f.name fund, f.restriction, g.${col} status
      FROM gifts g JOIN donors d ON d.id=g.donor_id JOIN funds f ON f.id=g.fund_id WHERE g.${col}='pending' AND NOT g.refunded AND ($1::uuid IS NULL OR g.ministry_id=$1) AND ${sc2} ORDER BY g.gift_date LIMIT 100`, p2);
    const [thanks, receipts] = await Promise.all([q('thank_you_status'), q('receipt_status')]);
    const kpis = await one(db, `SELECT count(DISTINCT g.donor_id) FILTER (WHERE g.gift_date >= date_trunc('year',current_date))::int donors_ytd,
        coalesce(sum(g.amount) FILTER (WHERE g.gift_date >= date_trunc('year',current_date)),0)::float giving_ytd,
        coalesce(sum(g.amount),0)::float lifetime, coalesce(sum(g.amount) FILTER (WHERE g.gift_date >= date_trunc('month',current_date)),0)::float giving_mtd
      FROM gifts g WHERE NOT g.refunded AND ($1::uuid IS NULL OR g.ministry_id=$1) AND ${sc2}`, p2);
    const donorCount = await one(db, `SELECT count(*)::int n FROM donors d WHERE ${base}`, p);
    const recurring = await one(db, `SELECT count(DISTINCT r.donor_id)::int donors, coalesce(sum(CASE frequency WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount/3 WHEN 'annually' THEN amount/12 WHEN 'weekly' THEN amount*52/12 END),0)::float monthly
      FROM recurring_gifts r JOIN donors d ON d.id=r.donor_id WHERE r.status='active' AND ${base}`, p);
    const p3: unknown[] = []; const sc3 = ministryScope(req.auth!, 'd.ministry_id', p3);
    p3.push(ministry);
    const opp = await opportunityReport(db, `${sc3} AND ($${p3.length}::uuid IS NULL OR d.ministry_id=$${p3.length}::uuid)`, p3);
    return { health: HEALTH_ORDER.map((hh) => ({ status: hh, count: health.find((x) => x.health_status === hh)?.n ?? 0 })), moves, thankYous: thanks, receipts,
      kpis: { ...kpis, donors: donorCount!.n, recurringDonors: recurring!.donors, recurringMonthly: recurring!.monthly, opportunity: opp.total } };
  });
  res.json(out);
}));

donorsRouter.get('/intel/opportunities', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const out = await tx(req, async (db) => {
    const p: unknown[] = []; const sc = ministryScope(req.auth!, 'd.ministry_id', p);
    const ministry = req.query.ministry_id ? String(req.query.ministry_id) : null;
    if (ministry) { assertMinistry(req.auth!, ministry); p.push(ministry); }
    const rep = await opportunityReport(db, `${sc}${ministry ? ` AND d.ministry_id=$${p.length}` : ''}`, p);
    const summary = await one(db, `SELECT content, created_at, generator FROM drafts WHERE kind='opportunity_summary' ORDER BY created_at DESC LIMIT 1`);
    return { ...rep, summary };
  });
  if (req.query.format === 'pdf') {
    requirePerm(req.auth, 'data.export');
    const t = await tx(req, (db) => one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]));
    const m = (n: number) => fmtMoney(n, t.currency);
    return renderPdf(res, `Next $100K - ${today()}.pdf`, {
      title: 'Next $100K — Fundraising Opportunity', subtitle: `Prepared ${today()}`, org: t.name,
      blocks: [
        { type: 'metrics', items: [{ label: 'Estimated reachable opportunity', value: m(out.total) }, { label: 'Donors included', value: String(out.categories.reduce((a, c) => a + c.donors, 0)) }] },
        ...(out.summary ? [{ type: 'h2' as const, text: 'Executive summary' }, { type: 'p' as const, text: out.summary.content }] : []),
        { type: 'h2', text: 'Opportunity categories' },
        { type: 'table', columns: ['Category', 'Estimated potential', 'Donors', 'Recommended action', 'Priority', 'Timeline'],
          rows: out.categories.map((c) => [c.label, m(c.potential), c.donors, c.action, c.priority, c.timeline]), widths: [100, 72, 44, 176, 50, 70], align: ['left', 'right', 'right', 'left', 'left', 'left'] },
        { type: 'muted', text: `Method: ${out.method}` },
      ],
    });
  }
  res.json(out);
}));

donorsRouter.get('/intel/category/:key', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const rows = await tx(req, (db) => {
    const p: unknown[] = [req.params.key]; const sc = ministryScope(req.auth!, 'd.ministry_id', p);
    return many(db, `SELECT ${LIST_COLS}, (d.intelligence->>'probability')::float probability, d.intelligence->>'askBasis' ask_basis FROM donors d LEFT JOIN ministries m ON m.id=d.ministry_id LEFT JOIN users u ON u.id=d.owner_user_id
      WHERE NOT d.archived AND d.intelligence->>'category'=$1 AND ${sc} ORDER BY (d.intelligence->>'opportunityValue')::numeric DESC`, p);
  });
  res.json({ category: CATEGORY_META[String(req.params.key)], rows });
}));

donorsRouter.get('/intel/action-plan', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const out = await tx(req, async (db) => {
    const p: unknown[] = []; const sc = ministryScope(req.auth!, 'd.ministry_id', p);
    const rep = await opportunityReport(db, sc, p);
    const weeks = [
      { week: 'Week 1', focus: 'Thank-yous, first-time donors and lapsed major donors', categories: ['thank_you', 'first_time_follow_up', 'lapsed_major'] },
      { week: 'Week 2', focus: 'Major donor calls and campaign follow-up', categories: ['major_donor_call', 'campaign_follow_up'] },
      { week: 'Week 3', focus: 'Monthly donor upgrades and year-end invitations', categories: ['recurring_upgrade', 'year_end'] },
      { week: 'Week 4', focus: 'Event invitations and lapsed donor re-engagement', categories: ['event_invitation', 'reactivate_lapsed'] },
    ];
    return { total: rep.total, weeks: weeks.map((w) => {
      const cats = rep.categories.filter((c) => w.categories.includes(c.key));
      return { ...w, potential: cats.reduce((a, c) => a + c.potential, 0), donors: cats.reduce((a, c) => a + c.donors, 0), items: cats.map(({ donorIds, ...c }) => c) };
    }) };
  });
  res.json(out);
}));

// Thank-you / receipt queue status updates (individual or batch)
donorsRouter.post('/queues/mark', h(async (req, res) => {
  requirePerm(req.auth, 'gifts.write');
  const b = parse(z.object({ giftIds: z.array(z.string().uuid()).min(1), field: z.enum(['thank_you_status', 'receipt_status']), status: z.enum(['pending', 'sent', 'not_required']) }), req.body);
  const n = await tx(req, async (db) => {
    const r = await db.query(`UPDATE gifts SET ${b.field}=$2 WHERE id = ANY($1::uuid[])`, [b.giftIds, b.status]);
    if (b.field === 'thank_you_status' && b.status === 'sent') {
      await db.query(`INSERT INTO communications(tenant_id, ministry_id, donor_id, user_id, type, subject)
        SELECT g.tenant_id, g.ministry_id, g.donor_id, $2, 'letter', 'Thank-you sent for gift of ' || g.amount FROM gifts g WHERE g.id = ANY($1::uuid[])`, [b.giftIds, req.auth!.userId]);
    }
    await audit(db, actor(req), 'giving', 'queue_update', `Marked ${r.rowCount} gift(s) ${b.field.replace('_status', '').replace('_', '-')} ${b.status}`, { type: 'gift' }, { giftIds: b.giftIds });
    return r.rowCount;
  });
  res.json({ updated: n });
}));

export { getDonor, LIST_COLS, donorListQuery };
export const _unused = { addDays };
