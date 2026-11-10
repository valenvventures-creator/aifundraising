let CURRENCY = 'USD';
let LOCALE = 'en-US';
export function setLocale(currency: string, locale: string) { CURRENCY = currency || 'USD'; LOCALE = locale || 'en-US'; }

export const money = (n: number | string | null | undefined, digits = 0) =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(n ?? 0));
export const money2 = (n: number | string | null | undefined) => money(n, 2);
export const num = (n: number | string | null | undefined) => new Intl.NumberFormat(LOCALE).format(Number(n ?? 0));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(Number(n) * 10) / 10}%`);
export function date(d: string | Date | null | undefined) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.toISOString();
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return dt.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function dateTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function ago(d: string | null | undefined) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`; return date(d);
}
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const label = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
