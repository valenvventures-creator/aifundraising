import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../lib/http.js';
import { tx, requirePerm, ministryScope, assertMinistry, actor, can } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { many, one } from '../db/pool.js';
import { DONOR_NAME_SQL, fmtMoney, miles, today, addDays } from '../lib/util.js';
import { generateText, templateDraft, voiceInstructions, CONTENT_TYPES } from '../services/ai.js';
import { opportunityReport } from '../services/intelligence.js';
import { askQuestion } from '../services/ask.js';
import { geocodeCity, geocodeDonors } from '../services/geo.js';
import { renderPdf } from '../services/pdf.js';
import { config } from '../config.js';

export const outreachRouter = Router();

// ───────── Voice profiles ─────────
outreachRouter.get('/voice/:ministryId', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read'); assertMinistry(req.auth!, String(req.params.ministryId));
  const v = await tx(req, (db) => one(db, `SELECT * FROM voice_profiles WHERE ministry_id=$1`, [req.params.ministryId]));
  res.json(v ?? { ministry_id: req.params.ministryId });
}));
outreachRouter.put('/voice/:ministryId', h(async (req, res) => {
  requirePerm(req.auth, 'email.write'); assertMinistry(req.auth!, String(req.params.ministryId));
  const b = parse(z.object({ tone: z.string().nullish(), leader_voice: z.string().nullish(), faith_language: z.string().nullish(), scripture_usage: z.string().nullish(),
    urgency: z.number().int().min(1).max(5).nullish(), formality: z.number().int().min(1).max(5).nullish(), donor_centeredness: z.number().int().min(1).max(5).nullish(),
    themes: z.string().nullish(), words_to_use: z.string().nullish(), words_to_avoid: z.string().nullish(), faith_enabled: z.boolean().default(true) }), req.body);
  const v = await tx(req, async (db) => {
    const r = await one(db, `INSERT INTO voice_profiles(tenant_id, ministry_id, tone, leader_voice, faith_language, scripture_usage, urgency, formality, donor_centeredness, themes, words_to_use, words_to_avoid, faith_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (tenant_id, ministry_id) DO UPDATE SET tone=EXCLUDED.tone, leader_voice=EXCLUDED.leader_voice, faith_language=EXCLUDED.faith_language, scripture_usage=EXCLUDED.scripture_usage,
        urgency=EXCLUDED.urgency, formality=EXCLUDED.formality, donor_centeredness=EXCLUDED.donor_centeredness, themes=EXCLUDED.themes, words_to_use=EXCLUDED.words_to_use,
        words_to_avoid=EXCLUDED.words_to_avoid, faith_enabled=EXCLUDED.faith_enabled, updated_at=now() RETURNING *`,
      [req.auth!.tenantId, req.params.ministryId, b.tone, b.leader_voice, b.faith_language, b.scripture_usage, b.urgency, b.formality, b.donor_centeredness, b.themes, b.words_to_use, b.words_to_avoid, b.faith_enabled]);
    await audit(db, actor(req), 'outreach', 'voice_profile', 'Updated voice profile', { type: 'voice_profile', id: r.id });
    return r;
  });
  res.json(v);
}));

// ───────── AI writing assistant (drafts only) ─────────
outreachRouter.get('/content-types', (_req, res) => res.json(CONTENT_TYPES));

outreachRouter.post('/draft', h(async (req, res) => {
  requirePerm(req.auth, 'ai.ask');
  const b = parse(z.object({ kind: z.string(), ministry_id: z.string().uuid().nullish(), donor_id: z.string().uuid().nullish(), segment: z.string().nullish(),
    include_private: z.boolean().default(false), campaign_id: z.string().uuid().nullish(), event_id: z.string().uuid().nullish(), context: z.string().max(4000).nullish(),
    save: z.boolean().default(true) }), req.body);
  if (!CONTENT_TYPES[b.kind]) throw badRequest('Unknown content type.');
  assertMinistry(req.auth!, b.ministry_id);
  const out = await tx(req, async (db) => {
    const t = await one(db, `SELECT name, currency, faith_based FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const ministry = b.ministry_id ? await one(db, `SELECT name FROM ministries WHERE id=$1`, [b.ministry_id]) : null;
    const voice = b.ministry_id
      ? await one(db, `SELECT * FROM voice_profiles WHERE ministry_id=$1`, [b.ministry_id])
      : await one(db, `SELECT * FROM voice_profiles ORDER BY updated_at DESC LIMIT 1`);
    let donor: any = null, donorFacts = '';
    if (b.donor_id) {
      requirePerm(req.auth, 'donors.read');
      const p: unknown[] = [b.donor_id];
      donor = await one(db, `SELECT d.*, ${DONOR_NAME_SQL()} AS name FROM donors d WHERE d.id=$1 AND ${ministryScope(req.auth!, 'd.ministry_id', p)}`, p);
      if (!donor) throw notFound('Donor');
      const gifts = await many(db, `SELECT g.gift_date, g.amount::float, f.name fund FROM gifts g JOIN funds f ON f.id=g.fund_id WHERE g.donor_id=$1 AND NOT g.refunded ORDER BY gift_date DESC LIMIT 5`, [donor.id]);
      const i = donor.intelligence ?? {};
      donorFacts = `Donor: ${donor.name} (first name ${donor.first_name ?? 'n/a'}), ${donor.health_status}. Lifetime giving ${fmtMoney(i.stats?.lifetime ?? 0, t.currency)}. Recent gifts: ${gifts.map((g) => `${g.gift_date} ${fmtMoney(g.amount, t.currency)} to ${g.fund}`).join('; ') || 'none'}. Suggested ask ${fmtMoney(i.suggestedAsk ?? 0, t.currency)}${i.isMonthlyAsk ? '/month' : ''}.`
        + (donor.notes ? ` Notes: ${donor.notes}` : '')
        + (b.include_private && can(req.auth!, 'donors.private_notes') && donor.private_notes ? ` Private notes (do not quote directly): ${donor.private_notes}` : '');
      donor.gifts = gifts;
    }
    const campaign = b.campaign_id ? await one(db, `SELECT name, description, goal FROM campaigns WHERE id=$1`, [b.campaign_id]) : null;
    const event = b.event_id ? await one(db, `SELECT name, starts_at, location FROM events WHERE id=$1`, [b.event_id]) : null;
    const orgName = ministry?.name ?? t.name;
    const prompt = `Write a ${CONTENT_TYPES[b.kind]} for ${orgName}.
${b.segment ? `Audience segment: ${b.segment}.` : ''}
${donorFacts}
${campaign ? `Campaign: ${campaign.name}${campaign.goal ? ` (goal ${campaign.goal})` : ''}. ${campaign.description ?? ''}` : ''}
${event ? `Event: ${event.name} on ${new Date(event.starts_at).toDateString()} at ${event.location ?? 'TBD'}.` : ''}
${b.context ? `Context from staff: ${b.context}` : ''}
Sender: ${req.auth!.name}.
${voiceInstructions(voice ? { ...voice, faith_enabled: voice.faith_enabled && t.faith_based } : null)}
Return only the draft text (with a subject line first if it is an email). Use {{first_name}} as a placeholder when writing for a segment rather than one donor.`;
    const ai = await generateText({ prompt, effort: 'medium' }).catch((e) => { console.error('AI draft failed', e.message); return null; });
    const content = ai ?? templateDraft(b.kind, { orgName, donorFirst: donor?.first_name, donorName: donor?.name, amount: donor?.gifts?.[0] ? fmtMoney(donor.gifts[0].amount, t.currency) : undefined,
      lastGift: donor?.gifts?.[0]?.gift_date, fund: donor?.gifts?.[0]?.fund, campaign: campaign?.name, context: b.context ?? undefined, senderName: req.auth!.name,
      ask: donor?.intelligence?.suggestedAsk ? fmtMoney(donor.intelligence.suggestedAsk, t.currency) : undefined, faith: Boolean(voice?.faith_enabled && t.faith_based), eventName: event?.name });
    const title = `${CONTENT_TYPES[b.kind]}${donor ? ` — ${donor.name}` : b.segment ? ` — ${b.segment}` : ''}`;
    const saved = b.save ? await one(db, `INSERT INTO drafts(tenant_id,user_id,ministry_id,donor_id,kind,title,content,context,generator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.auth!.tenantId, req.auth!.userId, b.ministry_id ?? null, b.donor_id ?? null, b.kind, title, content, { segment: b.segment, campaign_id: b.campaign_id, event_id: b.event_id }, ai ? 'claude' : 'template']) : null;
    await audit(db, actor(req), 'ai', 'draft', `Generated draft: ${title}`, { type: 'draft', id: saved?.id }, { generator: ai ? 'claude' : 'template', includePrivate: b.include_private });
    return { id: saved?.id, title, content, generator: ai ? 'claude' : 'template', status: 'draft' };
  });
  res.json(out);
}));

outreachRouter.post('/opportunity-summary', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read', 'ai.ask');
  const out = await tx(req, async (db) => {
    const p: unknown[] = []; const rep = await opportunityReport(db, ministryScope(req.auth!, 'd.ministry_id', p), p);
    const t = await one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]);
    const lines = rep.categories.map((c) => `- ${c.label}: ${fmtMoney(c.potential, t.currency)} across ${c.donors} donors; action: ${c.action}; priority ${c.priority}; timeline ${c.timeline}`).join('\n');
    const ai = await generateText({ prompt: `Write a concise executive summary (3 short paragraphs) for leadership of ${t.name} about the fundraising opportunity in the donor database.\nTotal estimated reachable opportunity: ${fmtMoney(rep.total, t.currency)}.\nCategories:\n${lines}\nMethod: ${rep.method}\nBe clear these are estimates. End with the top 3 recommended priorities.` }).catch(() => null);
    const content = ai ?? `${t.name} has an estimated ${fmtMoney(rep.total, t.currency)} in realistically reachable giving across ${rep.categories.reduce((a, c) => a + c.donors, 0)} donors. These figures are estimates based on giving history and configurable likelihoods, not commitments.\n\nThe largest opportunities are ${rep.categories.slice(0, 3).map((c) => `${c.label.toLowerCase()} (${fmtMoney(c.potential, t.currency)})`).join(', ')}.\n\nRecommended priorities:\n${rep.categories.slice(0, 3).map((c, i) => `${i + 1}. ${c.action} — ${c.timeline}.`).join('\n')}`;
    await db.query(`INSERT INTO drafts(tenant_id,user_id,kind,title,content,generator) VALUES ($1,$2,'opportunity_summary','Next $100K executive summary',$3,$4)`, [req.auth!.tenantId, req.auth!.userId, content, ai ? 'claude' : 'template']);
    return { content, generator: ai ? 'claude' : 'template', created_at: new Date().toISOString() };
  });
  res.json(out);
}));

// ───────── Ask A.I. Nonprofits ─────────
outreachRouter.post('/ask', h(async (req, res) => {
  requirePerm(req.auth, 'ai.ask');
  const b = parse(z.object({ question: z.string().min(2).max(2000), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(12).default([]) }), req.body);
  const out = await tx(req, async (db) => {
    const a = await askQuestion(db, req.auth!, b.question, b.history);
    const row = await one(db, `INSERT INTO ai_questions(tenant_id,user_id,question,answer,citations,engine) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [req.auth!.tenantId, req.auth!.userId, b.question, a.answer, JSON.stringify(a.citations), a.engine]);
    return { ...a, id: row.id, created_at: row.created_at };
  });
  res.json(out);
}));
outreachRouter.get('/ask/history', h(async (req, res) => {
  requirePerm(req.auth, 'ai.ask');
  res.json(await tx(req, (db) => many(db, `SELECT id, question, answer, citations, engine, created_at FROM ai_questions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.auth!.userId])));
}));

// ───────── Trip planning ─────────
const tripSchema = z.object({ city: z.string().min(1), region: z.string().nullish(), postal_code: z.string().nullish(), start_date: z.string(), end_date: z.string(),
  purpose: z.string().nullish(), radius_miles: z.number().int().min(1).max(500).default(50), meetings_per_day: z.number().int().min(1).max(12).default(4),
  est_cost: z.number().nullish(), ministry_id: z.string().uuid().nullish() });

async function tripCandidates(db: any, req: any, trip: any) {
  await geocodeDonors(db, 300);
  const p: unknown[] = []; const sc = ministryScope(req.auth!, 'd.ministry_id', p);
  const rows = await many(db, `SELECT d.id, ${DONOR_NAME_SQL()} AS name, d.city, d.region, d.postal_code, d.address1, d.lat, d.lng, d.score, d.phone, d.email, d.health_status,
      (d.intelligence->'stats'->>'lifetime')::float lifetime, d.intelligence->'stats'->>'lastGift' last_gift, (d.intelligence->>'suggestedAsk')::float suggested_ask,
      d.intelligence->>'priority' priority, d.intelligence->>'categoryLabel' opportunity
    FROM donors d WHERE NOT d.archived AND d.lat IS NOT NULL AND ${sc}`, p);
  return rows.map((d) => ({ ...d, distance: Math.round(miles(trip.lat, trip.lng, d.lat, d.lng) * 10) / 10 })).filter((d) => d.distance <= trip.radius_miles)
    .sort((a, b) => (b.score - a.score) || (b.lifetime - a.lifetime));
}

function scheduleStops(stops: any[], trip: any) {
  const days: string[] = [];
  for (let d = trip.start_date; d <= trip.end_date; d = addDays(d, 1)) days.push(d);
  const slots: string[] = [];
  const hours = [9, 10.5, 13, 14.5, 16, 17.5, 8, 19, 11.5, 12, 15, 18];
  for (const day of days) for (let i = 0; i < trip.meetings_per_day; i++) {
    const hh = hours[i]; slots.push(`${day}T${String(Math.floor(hh)).padStart(2, '0')}:${hh % 1 ? '30' : '00'}:00`);
  }
  return stops.map((s, i) => ({ ...s, meeting_at: slots[i] ?? null }));
}

outreachRouter.post('/trips', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  const b = parse(tripSchema, req.body);
  if (b.end_date < b.start_date) throw badRequest('Travel end must be on or after travel start.');
  assertMinistry(req.auth!, b.ministry_id);
  const out = await tx(req, async (db) => {
    const g = await geocodeCity(db, b.city, b.region, b.postal_code);
    if (!g) throw badRequest(`We couldn't locate “${b.city}${b.region ? ', ' + b.region : ''}”. ${config.google.mapsKey ? '' : 'Add a Google Maps API key for full address lookup, or '}try a nearby major city.`);
    const trip = await one(db, `INSERT INTO trips(tenant_id, ministry_id, city, region, postal_code, lat, lng, start_date, end_date, purpose, radius_miles, meetings_per_day, est_cost, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.auth!.tenantId, b.ministry_id ?? null, b.city, b.region ?? null, b.postal_code ?? null, g.lat, g.lng, b.start_date, b.end_date, b.purpose ?? null, b.radius_miles, b.meetings_per_day, b.est_cost ?? null, req.auth!.userId]);
    const cands = await tripCandidates(db, req, trip);
    const capacity = Math.round((new Date(b.end_date).getTime() - new Date(b.start_date).getTime()) / 86400000 + 1) * b.meetings_per_day;
    const scheduled = scheduleStops(cands.slice(0, capacity), trip);
    for (const s of scheduled) {
      await db.query(`INSERT INTO trip_stops(tenant_id, trip_id, donor_id, meeting_at, priority, suggested_ask) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.auth!.tenantId, trip.id, s.id, s.meeting_at, (s.priority ?? 'Medium').toLowerCase(), s.suggested_ask]);
    }
    await audit(db, actor(req), 'fundraising', 'trip', `Planned donor trip to ${b.city}`, { type: 'trip', id: trip.id });
    return trip;
  });
  res.status(201).json(out);
}));

outreachRouter.get('/trips', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  res.json(await tx(req, (db) => many(db, `SELECT t.*, (SELECT count(*) FROM trip_stops s WHERE s.trip_id=t.id AND s.included)::int stops FROM trips t ORDER BY start_date DESC`)));
}));

async function loadTrip(db: any, req: any, id: string) {
  const trip = await one(db, `SELECT * FROM trips WHERE id=$1`, [id]);
  if (!trip) throw notFound('Trip');
  const stops = await many(db, `SELECT s.*, ${DONOR_NAME_SQL()} AS name, d.city, d.region, d.address1, d.postal_code, d.lat, d.lng, d.score, d.phone, d.email,
      (d.intelligence->'stats'->>'lifetime')::float lifetime, d.intelligence->'stats'->>'lastGift' last_gift, d.intelligence->>'categoryLabel' opportunity
    FROM trip_stops s JOIN donors d ON d.id=s.donor_id WHERE s.trip_id=$1 ORDER BY s.included DESC, s.meeting_at NULLS LAST`, [id]);
  const nearby = await tripCandidates(db, req, trip);
  const inTrip = new Set(stops.map((s) => s.donor_id));
  const included = stops.filter((s) => s.included);
  const potential = included.reduce((a, s) => a + Number(s.suggested_ask ?? 0), 0);
  const route = included.filter((s) => s.lat != null);
  const mapsUrl = route.length ? `https://www.google.com/maps/dir/${route.slice(0, 10).map((s) => encodeURIComponent([s.address1, s.city, s.region, s.postal_code].filter(Boolean).join(', '))).join('/')}` : null;
  return { trip, stops, others: nearby.filter((d) => !inTrip.has(d.id)).slice(0, 50), summary: { donors: included.length, potential, roi: trip.est_cost ? Math.round((potential / Number(trip.est_cost)) * 10) / 10 : null }, mapsUrl };
}

outreachRouter.get('/trips/:id', h(async (req, res) => {
  requirePerm(req.auth, 'donors.read');
  const t = await tx(req, (db) => loadTrip(db, req, String(req.params.id)));
  if (req.query.format !== 'pdf') return res.json(t);
  const org = await tx(req, (db) => one(db, `SELECT name, currency FROM tenants WHERE id=$1`, [req.auth!.tenantId]));
  const m = (n: number) => fmtMoney(n, org.currency);
  renderPdf(res, `Trip plan - ${t.trip.city}.pdf`, {
    title: `Donor Trip: ${t.trip.city}${t.trip.region ? ', ' + t.trip.region : ''}`, subtitle: `${t.trip.start_date} → ${t.trip.end_date} · ${t.trip.purpose ?? ''}`, org: org.name,
    blocks: [
      { type: 'metrics', items: [{ label: 'Donors to see', value: String(t.summary.donors) }, { label: 'Potential asks', value: m(t.summary.potential) }, { label: 'Est. trip cost', value: t.trip.est_cost ? m(Number(t.trip.est_cost)) : '—' }, { label: 'Potential ROI', value: t.summary.roi ? `${t.summary.roi}×` : '—' }] },
      { type: 'h2', text: 'Meeting schedule' },
      { type: 'table', columns: ['Meeting', 'Donor', 'City', 'Lifetime', 'Last gift', 'Score', 'Suggested ask', 'Priority'],
        rows: t.stops.filter((s) => s.included).map((s) => [s.meeting_at ? String(s.meeting_at).slice(0, 16).replace('T', ' ') : 'TBD', s.name, s.city ?? '', m(s.lifetime ?? 0), s.last_gift ?? '—', s.score, m(Number(s.suggested_ask ?? 0)), s.priority]),
        widths: [80, 92, 62, 58, 56, 34, 64, 50], align: ['left', 'left', 'left', 'right', 'left', 'right', 'right', 'left'] },
      ...(t.mapsUrl ? [{ type: 'p' as const, text: `Route: ${t.mapsUrl}` }] : []),
      { type: 'muted', text: 'Suggested asks are estimates. Confirm meetings before travel.' },
    ],
  });
}));

outreachRouter.patch('/trips/:id/stops/:donorId', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write');
  const b = parse(z.object({ meeting_at: z.string().nullish(), notes: z.string().nullish(), priority: z.enum(['high', 'medium', 'low']).optional(), included: z.boolean().optional() }), req.body);
  await tx(req, async (db) => {
    const exists = await one(db, `SELECT id FROM trip_stops WHERE trip_id=$1 AND donor_id=$2`, [req.params.id, req.params.donorId]);
    if (!exists) {
      const d = await one(db, `SELECT (intelligence->>'suggestedAsk')::numeric ask FROM donors WHERE id=$1`, [req.params.donorId]);
      await db.query(`INSERT INTO trip_stops(tenant_id,trip_id,donor_id,suggested_ask,included) VALUES ($1,$2,$3,$4,true)`, [req.auth!.tenantId, req.params.id, req.params.donorId, d?.ask ?? null]);
    }
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (keys.length) await db.query(`UPDATE trip_stops SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE trip_id=$1 AND donor_id=$2`, [req.params.id, req.params.donorId, ...keys.map((k) => (b as any)[k])]);
  });
  res.json({ ok: true });
}));

/** Create tasks for the trip (explicit action): prep task per meeting + follow-up task the day after the trip. */
outreachRouter.post('/trips/:id/tasks', h(async (req, res) => {
  requirePerm(req.auth, 'donors.write', 'work.write');
  const { kind } = parse(z.object({ kind: z.enum(['trip', 'follow_up']) }), req.body);
  const n = await tx(req, async (db) => {
    const t = await loadTrip(db, req, String(req.params.id));
    let c = 0;
    for (const s of t.stops.filter((x) => x.included)) {
      const title = kind === 'trip' ? `Confirm meeting with ${s.name} (${t.trip.city} trip)` : `Follow up with ${s.name} after ${t.trip.city} visit`;
      const due = kind === 'trip' ? addDays(t.trip.start_date, -7) : addDays(t.trip.end_date, 2);
      await db.query(`INSERT INTO tasks(tenant_id, ministry_id, title, due_date, donor_id, assignee_id, created_by, category, next_step) VALUES ($1,$2,$3,$4,$5,$6,$6,'Donor trip',$7)`,
        [req.auth!.tenantId, t.trip.ministry_id, title, due, s.donor_id, req.auth!.userId, kind === 'trip' ? `Meeting ${s.meeting_at ?? 'TBD'}` : `Thank and confirm next step; ask ${s.suggested_ask ?? ''}`]);
      c++;
    }
    await audit(db, actor(req), 'fundraising', 'trip_tasks', `Created ${c} ${kind === 'trip' ? 'trip' : 'follow-up'} tasks`, { type: 'trip', id: t.trip.id });
    return c;
  });
  res.json({ created: n });
}));

export const _t = { today };
