/**
 * Fundraising intelligence — deterministic and explainable.
 * Every score, ask and opportunity amount can be traced to the donor's gifts,
 * contacts and the tenant's configurable rules. AI is NOT used for these numbers.
 */
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { addDays, round2, today } from '../lib/util.js';

export type Health = 'active' | 'engaged' | 'cooling' | 'lapsing' | 'lapsed';
export const HEALTH_ORDER: Health[] = ['active', 'engaged', 'cooling', 'lapsing', 'lapsed'];

export interface Rules {
  activeDays: number; engagedDays: number; coolingDays: number; lapsingDays: number;
  majorThreshold: number;
  weights: { capacity: number; recency: number; frequency: number; recentGiving: number; engagement: number; momentum: number };
  probabilities: Record<string, number>;
}
export const DEFAULT_RULES: Rules = {
  activeDays: 180, engagedDays: 365, coolingDays: 540, lapsingDays: 730,
  majorThreshold: 5000,
  weights: { capacity: 20, recency: 20, frequency: 15, recentGiving: 15, engagement: 15, momentum: 15 },
  probabilities: {
    lapsed_major: 0.3, reactivate_lapsed: 0.15, major_donor_call: 0.5, recurring_upgrade: 0.45,
    first_time_follow_up: 0.35, year_end: 0.5, campaign_follow_up: 0.4, event_invitation: 0.25, thank_you: 0.3, cultivate: 0.2,
  },
};

export const CATEGORY_META: Record<string, { label: string; action: string; channel: string; priority: 'High' | 'Medium' | 'Low'; timeline: string }> = {
  lapsed_major: { label: 'Lapsed major donor outreach', action: 'Personal call from a leader to reconnect and share recent impact', channel: 'Call', priority: 'High', timeline: 'Next 2 weeks' },
  major_donor_call: { label: 'Major donor calls', action: 'Schedule a call or visit and make a specific ask', channel: 'Call', priority: 'High', timeline: 'Next 30 days' },
  campaign_follow_up: { label: 'Campaign follow-up', action: 'Follow up on campaign engagement with a personal note and ask', channel: 'Email', priority: 'High', timeline: 'Next 2 weeks' },
  year_end: { label: 'Year-end giving', action: 'Invite to give again before year-end; reference last year’s gift', channel: 'Email', priority: 'Medium', timeline: 'Before Dec 31' },
  recurring_upgrade: { label: 'Upgrade monthly donors', action: 'Thank for faithfulness and invite a modest monthly increase', channel: 'Email', priority: 'Medium', timeline: 'Next 30 days' },
  first_time_follow_up: { label: 'First-time donor follow-up', action: 'Welcome call/note within weeks of first gift; invite a second gift', channel: 'Call', priority: 'Medium', timeline: 'Next 2 weeks' },
  event_invitation: { label: 'Event invitation opportunities', action: 'Invite to an upcoming event to deepen the relationship', channel: 'Email', priority: 'Low', timeline: 'Before next event' },
  reactivate_lapsed: { label: 'Reactivate lapsed donors', action: 'Re-engagement message with impact update and a simple way to give', channel: 'Email', priority: 'Low', timeline: 'Next 60 days' },
  thank_you: { label: 'Thank-you needed', action: 'Send a personal thank-you for the recent gift', channel: 'Email', priority: 'High', timeline: 'Within 48 hours' },
  cultivate: { label: 'Cultivate relationship', action: 'Share an update and log a touchpoint', channel: 'Email', priority: 'Low', timeline: 'This quarter' },
};

export async function loadRules(db: Db): Promise<Rules> {
  const t = await one(db, `SELECT health_rules, opportunity_rules FROM tenants WHERE id = current_setting('app.tenant_id')::uuid`);
  const hr = t?.health_rules ?? {}, orr = t?.opportunity_rules ?? {};
  return {
    ...DEFAULT_RULES, ...hr, ...orr,
    weights: { ...DEFAULT_RULES.weights, ...(orr.weights ?? {}) },
    probabilities: { ...DEFAULT_RULES.probabilities, ...(orr.probabilities ?? {}) },
  };
}

interface Stats {
  id: string; created_at: string; capacity_estimate: number | null; health_override: string | null;
  lifetime: number; gift_count: number; first_gift: string | null; last_gift: string | null; last_amount: number | null;
  largest: number; last12: number; prior12: number; count24: number;
  recurring_monthly: number; recurring_since: string | null;
  contacts180: number; last_contact: string | null; events12: number; opens90: number;
  pending_thanks: number; campaign_recent: string | null; gave_ye_last_year: boolean; gave_this_year: boolean;
}

const STATS_SQL = `
WITH g AS (
  SELECT donor_id, amount, gift_date, campaign_id, thank_you_status FROM gifts WHERE NOT refunded
)
SELECT d.id, d.created_at, d.capacity_estimate, d.health_override,
  coalesce(sum(g.amount),0)::float lifetime, count(g.amount)::int gift_count,
  min(g.gift_date) first_gift, max(g.gift_date) last_gift,
  (SELECT amount FROM g g2 WHERE g2.donor_id=d.id ORDER BY gift_date DESC LIMIT 1)::float last_amount,
  coalesce(max(g.amount),0)::float largest,
  coalesce(sum(g.amount) FILTER (WHERE g.gift_date > current_date - 365),0)::float last12,
  coalesce(sum(g.amount) FILTER (WHERE g.gift_date <= current_date - 365 AND g.gift_date > current_date - 730),0)::float prior12,
  count(g.amount) FILTER (WHERE g.gift_date > current_date - 730)::int count24,
  coalesce((SELECT sum(CASE frequency WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount/3 WHEN 'annually' THEN amount/12 WHEN 'weekly' THEN amount*52/12 ELSE amount END)
            FROM recurring_gifts r WHERE r.donor_id=d.id AND r.status='active'),0)::float recurring_monthly,
  (SELECT min(started_on) FROM recurring_gifts r WHERE r.donor_id=d.id AND r.status='active') recurring_since,
  (SELECT count(*) FROM communications c WHERE c.donor_id=d.id AND c.occurred_at > now() - interval '180 days')::int contacts180,
  (SELECT max(occurred_at) FROM communications c WHERE c.donor_id=d.id) last_contact,
  (SELECT count(*) FROM registrations rg WHERE rg.donor_id=d.id AND rg.status='attended' AND rg.registered_at > now() - interval '365 days')::int events12,
  (SELECT count(*) FROM email_events e WHERE e.donor_id=d.id AND e.type IN ('open','click') AND e.occurred_at > now() - interval '90 days')::int opens90,
  count(g.amount) FILTER (WHERE g.thank_you_status='pending')::int pending_thanks,
  (SELECT c.id::text FROM g g3 JOIN campaigns c ON c.id=g3.campaign_id AND c.status='active' WHERE g3.donor_id=d.id AND g3.gift_date > current_date - 120 LIMIT 1) campaign_recent,
  bool_or(extract(month from g.gift_date) IN (11,12) AND extract(year from g.gift_date) = extract(year from current_date) - 1) gave_ye_last_year,
  bool_or(extract(year from g.gift_date) = extract(year from current_date)) gave_this_year
FROM donors d LEFT JOIN g ON g.donor_id=d.id
WHERE NOT d.archived AND d.merged_into IS NULL AND ($1::uuid IS NULL OR d.id=$1::uuid)
GROUP BY d.id`;

const n0 = (x: number) => Math.round(Number(x) || 0).toLocaleString('en-US');
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity);
function niceRound(n: number) {
  if (n <= 0) return 0;
  const step = n < 100 ? 5 : n < 1000 ? 25 : n < 10000 ? 250 : 1000;
  return Math.max(step, Math.round(n / step) * step);
}

export function classifyHealth(s: Stats, r: Rules): Health {
  if (s.health_override && HEALTH_ORDER.includes(s.health_override as Health)) return s.health_override as Health;
  if (s.recurring_monthly > 0) return 'active';
  const ds = daysSince(s.last_gift);
  const recentlyEngaged = daysSince(s.last_contact) <= 90 || s.events12 > 0 || s.opens90 > 2;
  if (s.gift_count === 0) return recentlyEngaged || daysSince(s.created_at) <= 180 ? 'engaged' : 'cooling';
  if (ds <= r.activeDays) return 'active';
  if (ds <= r.engagedDays) return 'engaged';
  if (ds <= r.coolingDays) return recentlyEngaged ? 'engaged' : 'cooling';
  if (ds <= r.lapsingDays) return 'lapsing';
  return 'lapsed';
}

export function scoreParts(s: Stats) {
  const capBasis = Math.max(s.largest, (s.capacity_estimate ?? 0) / 10, s.lifetime / 5);
  const capacity = capBasis > 0 ? clamp((Math.log10(capBasis) / Math.log10(25000)) * 100) : 0;
  const ds = daysSince(s.last_gift);
  const recency = ds <= 30 ? 100 : ds <= 90 ? 85 : ds <= 180 ? 70 : ds <= 365 ? 50 : ds <= 730 ? 25 : s.gift_count ? 5 : 0;
  const frequency = s.recurring_monthly > 0 ? 100 : clamp(s.count24 * 12);
  const recentGiving = s.last12 > 0 ? clamp((Math.log10(s.last12 + 1) / Math.log10(10000)) * 100) : 0;
  const engagement = clamp(s.contacts180 * 15 + s.events12 * 20 + s.opens90 * 5);
  let momentum = 50;
  if (s.prior12 === 0 && s.last12 > 0) momentum = 75;
  else if (s.prior12 > 0) momentum = clamp(50 + 50 * Math.max(-1, Math.min(1, (s.last12 - s.prior12) / s.prior12)));
  else if (s.gift_count > 0) momentum = 20;
  else momentum = 40;
  return { capacity: Math.round(capacity), recency, frequency: Math.round(frequency), recentGiving: Math.round(recentGiving), engagement: Math.round(engagement), momentum: Math.round(momentum) };
}

export function computeDonor(s: Stats, r: Rules) {
  const health = classifyHealth(s, r);
  const parts = scoreParts(s);
  const w = r.weights; const wsum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const score = Math.round((parts.capacity * w.capacity + parts.recency * w.recency + parts.frequency * w.frequency +
    parts.recentGiving * w.recentGiving + parts.engagement * w.engagement + parts.momentum * w.momentum) / wsum);

  const avg = s.gift_count ? s.lifetime / s.gift_count : 0;
  const month = new Date().getMonth() + 1;
  const reasons: string[] = [];
  let category = 'cultivate';
  const lapsedish = health === 'lapsed' || health === 'lapsing';
  if (s.pending_thanks > 0 && daysSince(s.last_gift) <= 30) { category = 'thank_you'; reasons.push(`${s.pending_thanks} recent gift(s) not yet thanked`); }
  else if (s.gift_count === 1 && daysSince(s.first_gift) <= 90) { category = 'first_time_follow_up'; reasons.push(`First gift on ${s.first_gift}`); }
  else if (lapsedish && s.lifetime >= r.majorThreshold) { category = 'lapsed_major'; reasons.push(`Lifetime giving of ${n0(s.lifetime)} but no gift in ${daysSince(s.last_gift)} days`); }
  else if (s.campaign_recent) { category = 'campaign_follow_up'; reasons.push('Gave to an active campaign in the last 120 days'); }
  else if (s.recurring_monthly > 0 && daysSince(s.recurring_since) > 180) { category = 'recurring_upgrade'; reasons.push(`Monthly giving of ${n0(s.recurring_monthly)} since ${s.recurring_since}`); }
  else if (!lapsedish && (s.lifetime >= r.majorThreshold || s.largest >= 1000)) { category = 'major_donor_call'; reasons.push(`Largest gift ${n0(s.largest)}; lifetime ${n0(s.lifetime)}`); }
  else if (s.gave_ye_last_year && !s.gave_this_year && month >= 9) { category = 'year_end'; reasons.push('Gave last November/December but not yet this year'); }
  else if (lapsedish) { category = 'reactivate_lapsed'; reasons.push(`No gift in ${daysSince(s.last_gift)} days`); }
  else if (health === 'engaged' && s.events12 === 0) { category = 'event_invitation'; reasons.push('Engaged but has not attended an event this year'); }

  // Suggested ask (explainable basis)
  let ask = 0; let basis = '';
  if (category === 'recurring_upgrade') { ask = niceRound(s.recurring_monthly * 1.2); basis = `Monthly gift ${n0(s.recurring_monthly)} × 1.2 (20% upgrade)`; }
  else if (lapsedish) { ask = niceRound(s.last_amount ?? avg); basis = `Last gift amount (${n0(s.last_amount ?? avg)}) — ask to renew`; }
  else if (s.gift_count === 0) { ask = niceRound(s.capacity_estimate ? s.capacity_estimate * 0.02 : 100); basis = s.capacity_estimate ? '2% of estimated capacity' : 'Starter gift for a new prospect'; }
  else {
    const base = Math.max(avg * 1.5, (s.last_amount ?? 0) * 1.25, s.largest);
    ask = niceRound(base);
    basis = `Highest of: average gift × 1.5 (${n0(avg * 1.5)}), last gift × 1.25 (${n0((s.last_amount ?? 0) * 1.25)}), largest gift (${n0(s.largest)})`;
  }
  if (s.capacity_estimate && ask > s.capacity_estimate * 0.1) { ask = niceRound(s.capacity_estimate * 0.1); basis += '; capped at 10% of estimated capacity'; }
  const prob = r.probabilities[category] ?? 0.2;
  const opportunityValue = category === 'recurring_upgrade' ? round2((ask - s.recurring_monthly) * 12 * prob) : round2(ask * prob);
  const meta = CATEGORY_META[category];
  const followDays = meta.priority === 'High' ? 3 : meta.priority === 'Medium' ? 10 : 21;

  if (parts.momentum >= 70 && s.gift_count > 1) reasons.push('Giving is trending up versus the prior year');
  if (parts.engagement >= 50) reasons.push('Recently engaged (contacts, events or email activity)');
  if (s.recurring_monthly > 0 && category !== 'recurring_upgrade') reasons.push('Active recurring donor');

  return {
    health, score, parts,
    intelligence: {
      category, categoryLabel: meta.label, nextStep: meta.action, channel: meta.channel, priority: meta.priority,
      followUpOn: addDays(today(), followDays),
      suggestedAsk: ask, askLow: niceRound(ask * 0.75), askHigh: niceRound(ask * 1.5), askBasis: basis,
      probability: prob, opportunityValue, reasons,
      isMonthlyAsk: category === 'recurring_upgrade',
      stats: { lifetime: s.lifetime, giftCount: s.gift_count, firstGift: s.first_gift, lastGift: s.last_gift, lastAmount: s.last_amount,
        largest: s.largest, last12: s.last12, prior12: s.prior12, recurringMonthly: s.recurring_monthly, contacts180: s.contacts180,
        lastContact: s.last_contact, events12: s.events12, opens90: s.opens90, daysSinceLastGift: Number.isFinite(daysSince(s.last_gift)) ? daysSince(s.last_gift) : null },
      computedAt: new Date().toISOString(),
      disclaimer: 'Suggestions are estimates based on giving history and configurable rules — not certainties.',
    },
  };
}

/** Recalculate one donor (donorId) or all donors in the current tenant. */
export async function recalcDonors(db: Db, donorId: string | null = null) {
  const rules = await loadRules(db);
  const rows = await many<Stats>(db, STATS_SQL, [donorId]);
  const ids: string[] = [], healths: string[] = [], scores: number[] = [], parts: string[] = [], intel: string[] = [];
  for (const s of rows) {
    const c = computeDonor(s, rules);
    ids.push(s.id); healths.push(c.health); scores.push(c.score); parts.push(JSON.stringify(c.parts)); intel.push(JSON.stringify(c.intelligence));
  }
  if (ids.length) {
    await db.query(`UPDATE donors d SET health_status=u.h, score=u.s, score_parts=u.p::jsonb, intelligence=u.i::jsonb
      FROM unnest($1::uuid[], $2::text[], $3::int[], $4::text[], $5::text[]) AS u(id,h,s,p,i) WHERE d.id=u.id`,
      [ids, healths, scores, parts, intel]);
  }
  return ids.length;
}

/** Group donors into opportunity categories — the “Next $100K” report. Fully drillable. */
export async function opportunityReport(db: Db, scopeSql: string, params: unknown[]) {
  const rows = await many(db, `SELECT d.id, d.intelligence, d.score, d.health_status FROM donors d
     WHERE NOT d.archived AND d.merged_into IS NULL AND ${scopeSql} AND d.intelligence ? 'category'`, params);
  const cats: Record<string, { key: string; label: string; potential: number; donors: number; action: string; priority: string; timeline: string; donorIds: string[]; probability: number }> = {};
  for (const r of rows) {
    const i = r.intelligence; const k = i.category;
    if (k === 'cultivate' || k === 'thank_you') continue;
    const meta = CATEGORY_META[k];
    cats[k] ??= { key: k, label: meta.label, potential: 0, donors: 0, action: meta.action, priority: meta.priority, timeline: meta.timeline, donorIds: [], probability: i.probability };
    cats[k].potential = round2(cats[k].potential + Number(i.opportunityValue || 0));
    cats[k].donors += 1;
    cats[k].donorIds.push(r.id);
  }
  const list = Object.values(cats).sort((a, b) => b.potential - a.potential);
  return { total: round2(list.reduce((a, c) => a + c.potential, 0)), categories: list,
    method: 'Each donor contributes (suggested ask × category likelihood). Recurring upgrades use the annualized monthly increase × likelihood. Likelihoods and thresholds are configurable in Settings › Fundraising rules.' };
}
