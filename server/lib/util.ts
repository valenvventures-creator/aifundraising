export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);
export function daysBetween(a: string | Date, b: string | Date = new Date()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
export function addDays(d: string | Date, n: number) {
  const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}
export function fmtMoney(n: number, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
}
export function fmtMoney2(n: number, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n || 0);
}
export function donorName(d: { donor_type?: string; first_name?: string | null; last_name?: string | null; org_name?: string | null; household_name?: string | null }) {
  if (d.donor_type && !['individual', 'household'].includes(d.donor_type) && d.org_name) return d.org_name;
  if (d.donor_type === 'household' && d.household_name) return d.household_name;
  const n = [d.first_name, d.last_name].filter(Boolean).join(' ');
  return n || d.org_name || d.household_name || 'Unnamed donor';
}
/** Haversine distance in miles */
export function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const DONOR_NAME_SQL = (a = 'd') => `CASE WHEN ${a}.donor_type NOT IN ('individual','household') AND ${a}.org_name IS NOT NULL THEN ${a}.org_name
  WHEN ${a}.donor_type='household' AND ${a}.household_name IS NOT NULL THEN ${a}.household_name
  ELSE coalesce(nullif(trim(concat_ws(' ', ${a}.first_name, ${a}.last_name)),''), ${a}.org_name, ${a}.household_name, 'Unnamed donor') END`;
