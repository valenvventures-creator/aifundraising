/**
 * Live grant search for the United States and Canada.
 *
 * United States: Grants.gov public REST API (search2 and fetchOpportunity; no key required).
 * Canada: there is no single public feed of open federal calls, so we combine
 *   1) a short list of established federal programs that fund not-for-profits, linking to their
 *      official pages (intake dates change, so we never claim a program is open), and
 *   2) live data from the Government of Canada "Grants and Contributions" open dataset, showing
 *      which programs are actively funding not-for-profit organizations and charities right now.
 *
 * Only public, read-only government data is requested. Nothing about the organization is sent.
 */
import { badRequest } from '../lib/errors.js';

const GG = 'https://api.grants.gov/v1/api';
const CA_API = 'https://open.canada.ca/data/api/action/datastore_search';
const CA_RESOURCE = '1d15a62f-5656-49ad-8c88-f40ce689d831';

async function getJson(url: string, init?: RequestInit, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) {
    throw badRequest(e?.name === 'AbortError' ? 'The government grants service took too long to answer. Please try again.' : 'The government grants service could not be reached right now. Please try again in a minute.');
  } finally { clearTimeout(t); }
}

const decode = (s: string) => String(s ?? '').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const stripHtml = (s: string) => decode(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
/** Grants.gov dates are MM/DD/YYYY; return ISO or null. */
const usDate = (s?: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

// ───────── United States ─────────

export const US_ELIGIBILITY: Record<string, string> = {
  '12': 'Nonprofits with 501(c)(3) status',
  '13': 'Nonprofits without 501(c)(3) status',
  '25': 'Others (see eligibility details)',
  '99': 'Unrestricted',
};
export const US_CATEGORIES: Record<string, string> = {
  CD: 'Community development', ED: 'Education', HL: 'Health', ISS: 'Income security & social services', HU: 'Humanities',
  AR: 'Arts', ENV: 'Environment', FN: 'Food & nutrition', HO: 'Housing', ELT: 'Employment, labor & training', LJL: 'Law, justice & legal services',
  DPR: 'Disaster prevention & relief', AG: 'Agriculture', NR: 'Natural resources', ST: 'Science & technology', O: 'Other',
};

export async function searchUS(p: { q?: string; eligibility?: string; category?: string; status?: string; page?: number }) {
  const rows = 20;
  const body = {
    keyword: (p.q ?? '').slice(0, 200),
    rows,
    startRecordNum: Math.max(0, (p.page ?? 0) * rows),
    oppStatuses: p.status === 'posted' ? 'posted' : p.status === 'forecasted' ? 'forecasted' : 'forecasted|posted',
    eligibilities: p.eligibility && /^[0-9|]+$/.test(p.eligibility) ? p.eligibility : '12|13|25|99',
    fundingCategories: p.category && /^[A-Z|]+$/.test(p.category) ? p.category : '',
    sortBy: p.q?.trim() ? '' : 'openDate|desc', // relevance when searching by words, newest otherwise
  };
  const j = await getJson(`${GG}/search2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (j.errorcode && j.errorcode !== 0) throw badRequest('Grants.gov could not run that search. Try different words.');
  const d = j.data ?? {};
  return {
    total: Number(d.hitCount ?? 0),
    page: p.page ?? 0,
    pageSize: rows,
    results: (d.oppHits ?? []).map((h: any) => ({
      source: 'grants.gov', id: String(h.id), number: h.number, title: decode(h.title), agency: decode(h.agency), agencyCode: h.agencyCode,
      status: h.oppStatus, openDate: usDate(h.openDate), closeDate: usDate(h.closeDate), assistanceListings: h.cfdaList ?? [],
      url: `https://www.grants.gov/search-results-detail/${encodeURIComponent(h.id)}`,
    })),
  };
}

const isoDay = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const money = (v: any) => (v === null || v === undefined || v === '' || Number(v) === 0 ? null : Number(v));

export async function detailUS(id: string) {
  if (!/^\d{1,12}$/.test(id)) throw badRequest('Invalid opportunity.');
  const j = await getJson(`${GG}/fetchOpportunity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: Number(id) }) });
  const d = j.data ?? {};
  const s = d.synopsis ?? d.forecast ?? {};
  const list = (x: any) => (Array.isArray(x) ? x.map((y: any) => y.description).filter(Boolean) : []);
  return {
    source: 'grants.gov', id, number: d.opportunityNumber, title: decode(d.opportunityTitle ?? ''),
    agency: decode(s.agencyName ?? d.agencyDetails?.agencyName ?? d.topAgencyDetails?.agencyName ?? ''),
    status: d.synopsis ? 'posted' : 'forecasted',
    description: stripHtml(s.synopsisDesc ?? s.forecastDesc ?? '').slice(0, 6000),
    eligibility: list(s.applicantTypes), eligibilityNotes: stripHtml(s.applicantEligibilityDesc ?? ''),
    categories: list(s.fundingActivityCategories), instruments: list(s.fundingInstruments),
    awardCeiling: money(s.awardCeiling), awardFloor: money(s.awardFloor), estimatedFunding: money(s.estimatedFunding),
    numberOfAwards: s.numberOfAwards ? Number(s.numberOfAwards) || null : null,
    costSharing: s.costSharing === true || s.costSharing === 'Y',
    postedDate: isoDay(s.postingDateStr),
    closeDate: isoDay(s.responseDateStr ?? s.estApplicationResponseDateStr),
    closeDateNote: stripHtml(s.responseDateDesc ?? s.estApplicationResponseDateDesc ?? ''),
    contact: { name: s.agencyContactName ?? null, email: s.agencyContactEmail ?? null, phone: s.agencyContactPhone ?? null },
    assistanceListings: (d.cfdas ?? []).map((c: any) => `${c.cfdaNumber} ${c.programTitle ?? ''}`.trim()),
    url: `https://www.grants.gov/search-results-detail/${encodeURIComponent(id)}`,
  };
}

// ───────── Canada ─────────

export interface CaProgram { name: string; department: string; focus: string[]; summary: string; url: string; typical?: string }

/** Established federal programs that accept applications from not-for-profits. Intake windows vary. */
export const CA_PROGRAMS: CaProgram[] = [
  { name: 'Canada Summer Jobs', department: 'Employment and Social Development Canada', focus: ['youth', 'employment'], typical: 'Wage subsidies for summer jobs',
    summary: 'Wage subsidies for not-for-profit, public-sector and small private employers to hire youth aged 15 to 30. Applications usually open in winter for the following summer.',
    url: 'https://www.canada.ca/en/employment-social-development/services/funding/programs.html' },
  { name: 'New Horizons for Seniors Program: Community-based projects', department: 'Employment and Social Development Canada', focus: ['seniors', 'community'], typical: 'Grants up to $50,000 for projects up to one year',
    summary: 'Projects led or inspired by seniors that improve their well-being, social inclusion and participation in the community.',
    url: 'https://www.canada.ca/en/employment-social-development/services/funding/new-horizons-seniors-community-based.html' },
  { name: 'New Horizons for Seniors Program: Pan-Canadian projects', department: 'Employment and Social Development Canada', focus: ['seniors'], typical: 'Larger multi-year projects',
    summary: 'Multi-year projects that address issues affecting seniors across regions or nationally.',
    url: 'https://www.canada.ca/en/employment-social-development/services/funding/new-horizons-seniors-pan-canadian.html' },
  { name: 'Enabling Accessibility Fund', department: 'Employment and Social Development Canada', focus: ['accessibility', 'disability', 'capital'], typical: 'Calls for proposals are typically held once a year',
    summary: 'Projects that make community spaces and workplaces more accessible for persons with disabilities.',
    url: 'https://www.canada.ca/en/employment-social-development/services/funding/enabling-accessibility-fund-contribution.html' },
  { name: 'Canada Cultural Spaces Fund', department: 'Canadian Heritage', focus: ['arts', 'culture', 'heritage', 'capital'], typical: 'Continuous intake while funds remain',
    summary: 'Improves physical conditions for arts, heritage and cultural spaces, including renovations and specialized equipment.',
    url: 'https://www.canada.ca/en/canadian-heritage/services/funding/cultural-spaces-fund.html' },
  { name: 'Canadian Heritage funding programs', department: 'Canadian Heritage', focus: ['arts', 'culture', 'sport', 'multiculturalism', 'anti-racism', 'official languages', 'events'],
    summary: 'Directory of Canadian Heritage programs for culture, history, sport, multiculturalism, anti-racism and official languages.',
    url: 'https://www.canada.ca/en/canadian-heritage/services/funding.html' },
  { name: 'Youth Justice Fund', department: 'Department of Justice Canada', focus: ['youth', 'justice', 'crime prevention'],
    summary: 'Projects that improve the youth justice system and support youth in conflict with the law.',
    url: 'https://www.justice.gc.ca/eng/fund-fina/gov-gouv/yj-jj.html' },
  { name: 'Public Safety funding programs', department: 'Public Safety Canada', focus: ['crime prevention', 'community safety', 'security'],
    summary: 'Crime prevention and community security programs, including the Canada Community Security Program for at-risk community spaces.',
    url: 'https://www.publicsafety.gc.ca/cnt/cntrng-crm/crm-prvntn/fndng-prgrms/index-en.aspx' },
  { name: 'ESDC funding programs finder', department: 'Employment and Social Development Canada', focus: ['employment', 'skills', 'community', 'children', 'families', 'disability', 'social'],
    summary: 'Every ESDC program for jobs, skills and community projects, with each one marked as accepting applications or not.',
    url: 'https://www.canada.ca/en/employment-social-development/services/funding/programs.html' },
];

const PROVINCES: Record<string, string> = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' };
export const CA_PROVINCES = PROVINCES;

let caCache: { at: number; rows: any[] } | null = null;
const CA_TTL = 12 * 3600 * 1000;

/** Most recent federal grants and contributions to not-for-profits and charities (about the last 2,000 agreements). */
async function recentCanadianAwards() {
  if (caCache && Date.now() - caCache.at < CA_TTL) return caCache.rows;
  const fields = 'prog_name_en,owner_org_title,recipient_province,recipient_city,agreement_value,agreement_start_date,prog_purpose_en,description_en,agreement_title_en';
  const page = async (offset: number) => {
    const u = new URL(CA_API);
    u.searchParams.set('resource_id', CA_RESOURCE);
    u.searchParams.set('filters', JSON.stringify({ recipient_type: 'N' }));
    u.searchParams.set('sort', 'agreement_start_date desc');
    u.searchParams.set('limit', '1000');
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('fields', fields);
    const j = await getJson(u.toString(), undefined, 9000);
    return (j?.result?.records ?? []) as any[];
  };
  const [a, b] = await Promise.all([page(0), page(1000)]);
  const rows = [...a, ...b].filter((r) => r.prog_name_en);
  caCache = { at: Date.now(), rows };
  return rows;
}

const english = (s: string) => String(s ?? '').split(' | ')[0].trim();

export async function searchCA(p: { q?: string; province?: string }) {
  const words = (p.q ?? '').toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 2);
  const prov = p.province && PROVINCES[p.province] ? p.province : '';
  const matchText = (s: string) => !words.length || words.some((w) => s.toLowerCase().includes(w));

  const programs = CA_PROGRAMS.filter((g) => matchText(`${g.name} ${g.summary} ${g.focus.join(' ')} ${g.department}`));

  let rows: any[] = [];
  let liveError: string | null = null;
  try { rows = await recentCanadianAwards(); } catch (e: any) { liveError = e.message; }
  const groups = new Map<string, any>();
  for (const r of rows) {
    if (prov && r.recipient_province !== prov) continue;
    const text = `${r.prog_name_en} ${r.prog_purpose_en ?? ''} ${r.description_en ?? ''} ${r.agreement_title_en ?? ''}`;
    if (!matchText(text)) continue;
    const key = `${r.prog_name_en}|${r.owner_org_title}`;
    const g = groups.get(key) ?? { program: decode(r.prog_name_en), department: english(r.owner_org_title), awards: 0, values: [] as number[], latest: null as string | null, provinces: new Set<string>(), purpose: '', examples: [] as string[] };
    g.awards++;
    const v = Number(r.agreement_value); if (v > 0) g.values.push(v);
    if (!g.latest || (r.agreement_start_date && r.agreement_start_date > g.latest)) g.latest = r.agreement_start_date;
    if (r.recipient_province) g.provinces.add(r.recipient_province);
    if (!g.purpose && r.prog_purpose_en) g.purpose = stripHtml(r.prog_purpose_en).slice(0, 400);
    const ex = stripHtml(r.agreement_title_en || r.description_en || '');
    if (ex && g.examples.length < 3 && !g.examples.includes(ex)) g.examples.push(ex.slice(0, 160));
    groups.set(key, g);
  }
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const active = [...groups.values()]
    .map((g) => ({ program: g.program, department: g.department, awards: g.awards, typicalAward: median(g.values), largestAward: g.values.length ? Math.max(...g.values) : null,
      latestStart: g.latest ? String(g.latest).slice(0, 10) : null, provinces: [...g.provinces].sort(), purpose: g.purpose, examples: g.examples,
      url: `https://search.open.canada.ca/grants/?search_text=${encodeURIComponent(`"${g.program}"`)}&sort=agreement_start_date+desc` }))
    .sort((a, b) => b.awards - a.awards)
    .slice(0, 30);
  return { programs, active, scanned: rows.length, liveError };
}
