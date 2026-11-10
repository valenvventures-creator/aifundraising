/**
 * Email rendering, audience segmentation and delivery. Delivery only happens
 * from explicit user actions (Send / Schedule / Approve) or journeys an admin
 * activated in automatic mode — never from AI.
 */
import nodemailer from 'nodemailer';
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { config } from '../config.js';
import { DONOR_NAME_SQL, fmtMoney } from '../lib/util.js';
import { decryptJson } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';

export interface Block { type: 'heading' | 'text' | 'image' | 'button' | 'donate' | 'video' | 'divider'; text?: string; url?: string; label?: string; amounts?: number[] }

export interface AudienceFilters {
  health?: string[]; minLifetime?: number; maxLifetime?: number; minLastGift?: number; lastGiftWithinDays?: number; lastGiftOlderThanDays?: number;
  recurring?: boolean; firstTime?: boolean; lapsed?: boolean; campaignId?: string; fundId?: string; region?: string; tags?: string[];
  eventId?: string; ownerUserId?: string; ministryId?: string; donorType?: string;
}

/** Translate segment filters to SQL over donors (d). Uses only CRM + giving data. */
export function audienceWhere(f: AudienceFilters, params: unknown[]) {
  const w: string[] = [`NOT d.archived`, `d.merged_into IS NULL`, `d.email IS NOT NULL`, `coalesce((d.comm_prefs->>'email')::boolean, true)`,
    `NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email=lower(d.email))`];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (f.health?.length) add(`d.health_status = ANY($?)`, f.health);
  if (f.minLifetime != null) add(`coalesce((d.intelligence->'stats'->>'lifetime')::numeric,0) >= $?`, f.minLifetime);
  if (f.maxLifetime != null) add(`coalesce((d.intelligence->'stats'->>'lifetime')::numeric,0) <= $?`, f.maxLifetime);
  if (f.minLastGift != null) add(`coalesce((d.intelligence->'stats'->>'lastAmount')::numeric,0) >= $?`, f.minLastGift);
  if (f.lastGiftWithinDays != null) add(`EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.gift_date > current_date - $?::int)`, f.lastGiftWithinDays);
  if (f.lastGiftOlderThanDays != null) add(`NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.gift_date > current_date - $?::int)`, f.lastGiftOlderThanDays);
  if (f.recurring) w.push(`EXISTS (SELECT 1 FROM recurring_gifts r WHERE r.donor_id=d.id AND r.status='active')`);
  if (f.firstTime) w.push(`(SELECT count(*) FROM gifts g WHERE g.donor_id=d.id AND NOT g.refunded) = 1`);
  if (f.lapsed) w.push(`d.health_status IN ('lapsing','lapsed')`);
  if (f.campaignId) add(`EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.campaign_id=$?)`, f.campaignId);
  if (f.fundId) add(`EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.fund_id=$?)`, f.fundId);
  if (f.region) add(`lower(d.region) = lower($?)`, f.region);
  if (f.tags?.length) add(`d.tags && $?::text[]`, f.tags);
  if (f.eventId) add(`EXISTS (SELECT 1 FROM registrations r WHERE r.donor_id=d.id AND r.event_id=$?)`, f.eventId);
  if (f.ownerUserId) add(`d.owner_user_id = $?`, f.ownerUserId);
  if (f.ministryId) add(`d.ministry_id = $?`, f.ministryId);
  if (f.donorType) add(`d.donor_type = $?`, f.donorType);
  return w.join(' AND ');
}

export async function audienceDonors(db: Db, f: AudienceFilters, limit = 100000) {
  const p: unknown[] = [];
  return many(db, `SELECT d.id, d.email, d.first_name, ${DONOR_NAME_SQL()} AS name, d.intelligence->'stats' stats, d.ministry_id
    FROM donors d WHERE ${audienceWhere(f, p)} ORDER BY d.created_at LIMIT ${limit}`, p);
}

export function personalize(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderEmailHtml(blocks: Block[], vars: Record<string, string>, opts: { orgName: string; trackingBase?: string; token?: string; unsubscribeUrl?: string; previewText?: string }) {
  const link = (url: string) => opts.trackingBase && opts.token ? `${opts.trackingBase}/t/c/${opts.token}?u=${encodeURIComponent(url)}` : url;
  const body = blocks.map((b) => {
    const t = b.text ? esc(personalize(b.text, vars)) : '';
    switch (b.type) {
      case 'heading': return `<h2 style="font:700 22px/1.3 Georgia,serif;color:#111827;margin:24px 0 8px">${t}</h2>`;
      case 'text': return `<p style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#374151;margin:0 0 14px;white-space:pre-line">${t}</p>`;
      case 'image': return b.url ? `<img src="${esc(b.url)}" alt="${t}" style="max-width:100%;border-radius:8px;margin:8px 0"/>` : '';
      case 'button': return b.url ? `<p style="margin:20px 0"><a href="${esc(link(b.url))}" style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font:600 15px Arial,sans-serif">${esc(b.label ?? 'Learn more')}</a></p>` : '';
      case 'donate': {
        const amts = (b.amounts?.length ? b.amounts : [25, 50, 100, 250]);
        return `<div style="background:#f5f3ff;border-radius:10px;padding:16px;margin:16px 0;text-align:center"><p style="font:600 15px Arial;color:#3730a3;margin:0 0 10px">${t || 'Give today'}</p>${amts.map((a) => `<a href="${esc(link(`${b.url ?? '#'}${(b.url ?? '').includes('?') ? '&' : '?'}amount=${a}`))}" style="display:inline-block;margin:4px;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font:600 14px Arial">$${a}</a>`).join('')}</div>`;
      }
      case 'video': return b.url ? `<p><a href="${esc(link(b.url))}" style="color:#4f46e5;font:600 15px Arial">▶ ${t || 'Watch the video'}</a></p>` : '';
      case 'divider': return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>`;
      default: return '';
    }
  }).join('\n');
  const pixel = opts.trackingBase && opts.token ? `<img src="${opts.trackingBase}/t/o/${opts.token}.gif" width="1" height="1" alt="" style="display:none"/>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6"><span style="display:none">${esc(opts.previewText ?? '')}</span>
<div style="max-width:600px;margin:0 auto;background:#fff;padding:28px 32px">${body}
<p style="font:12px Arial;color:#9ca3af;margin-top:32px">${esc(opts.orgName)}${opts.unsubscribeUrl ? ` · <a href="${opts.unsubscribeUrl}" style="color:#9ca3af">Unsubscribe</a>` : ''}</p>${pixel}</div></body></html>`;
}

export function donorVars(d: any, orgName: string, currency = 'USD'): Record<string, string> {
  const s = d.stats ?? {};
  return { first_name: d.first_name ?? 'friend', name: d.name ?? '', organization: orgName, ministry: orgName,
    last_gift_amount: s.lastAmount ? fmtMoney(s.lastAmount, currency) : '', gift_amount: s.lastAmount ? fmtMoney(s.lastAmount, currency) : '',
    last_gift_date: s.lastGift ?? '', lifetime_giving: s.lifetime ? fmtMoney(s.lifetime, currency) : '' };
}

/** Which transport will deliver mail for this tenant (Gmail of the sender, or server SMTP). */
export async function transportFor(db: Db, userId: string | null) {
  if (userId) {
    const g = await one(db, `SELECT secrets_enc, config FROM integrations WHERE provider='google' AND user_id=$1 AND status='connected' AND enabled`, [userId]);
    if (g) {
      const sec = decryptJson<any>(g.secrets_enc);
      if (sec?.refresh_token && config.google.clientId) {
        return { kind: 'gmail' as const, from: g.config.email as string, t: nodemailer.createTransport({ service: 'gmail', auth: { type: 'OAuth2', user: g.config.email, clientId: config.google.clientId, clientSecret: config.google.clientSecret, refreshToken: sec.refresh_token } }) };
      }
    }
  }
  if (config.smtp) {
    return { kind: 'smtp' as const, from: config.smtp.from, t: nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined }) };
  }
  return null;
}

export async function requireTransport(db: Db, userId: string | null) {
  const t = await transportFor(db, userId);
  if (!t) throw badRequest('Email delivery is not configured. Connect Gmail in Settings › Gmail & Calendar, or ask your administrator to configure SMTP.');
  return t;
}
