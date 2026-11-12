/** Shared building blocks for overview screens (period picker, dark headline band, tiles, bars, breakdowns). */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Input, cx } from './ui';
import { WorkspaceSelect } from './domain';
import { date } from '../lib/format';

export type Preset = 'ytd' | 'quarter' | '12m' | 'lastyear' | 'month' | 'custom';
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const now = new Date(); const y = now.getUTCFullYear();
  if (p === 'ytd') return { from: `${y}-01-01`, to: iso(now), label: `${y} so far` };
  if (p === 'month') return { from: iso(new Date(Date.UTC(y, now.getUTCMonth(), 1))), to: iso(now), label: 'this month' };
  if (p === '12m') { const f = new Date(now); f.setUTCFullYear(y - 1); f.setUTCDate(f.getUTCDate() + 1); return { from: iso(f), to: iso(now), label: 'the last 12 months' }; }
  if (p === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
  if (p === 'quarter') { const q = Math.floor(now.getUTCMonth() / 3); return { from: iso(new Date(Date.UTC(y, q * 3, 1))), to: iso(now), label: 'this quarter' }; }
  return { from: custom.from, to: custom.to, label: `${date(custom.from)} – ${date(custom.to)}` };
}

/** Period + workspace state with the controls to change them. */
export function usePeriod(initial: Preset = 'ytd') {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState({ from: `${new Date().getUTCFullYear()}-01-01`, to: iso(new Date()) });
  const [ministry, setMinistry] = useState('');
  const range = rangeFor(preset, custom);
  const controls = (right?: React.ReactNode, showWorkspace = true) => (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {([['month', 'This month'], ['quarter', 'This quarter'], ['ytd', 'This year'], ['12m', 'Last 12 months'], ['lastyear', 'Last year'], ['custom', 'Custom']] as [Preset, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setPreset(k)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium', preset === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{l}</button>
        ))}
      </div>
      {preset === 'custom' && <div className="flex items-center gap-1"><Input type="date" className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" /><span className="text-slate-400">–</span><Input type="date" className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>}
      {showWorkspace && <div className="w-56"><WorkspaceSelect value={ministry} onChange={setMinistry} /></div>}
      {right && <div className="ml-auto flex flex-wrap gap-2">{right}</div>}
    </div>
  );
  return { range, ministry, controls, query: { from: range.from, to: range.to, ministry_id: ministry } };
}

export function Delta({ now, prev, invert = false, light = false }: { now: number; prev: number; invert?: boolean; light?: boolean }) {
  if (!prev && !now) return null;
  if (!prev) return <span className={cx('text-[11px] font-medium', light ? 'text-emerald-600' : 'text-emerald-300')}>New this period</span>;
  const d = ((now - prev) / Math.abs(prev)) * 100;
  if (!isFinite(d)) return null;
  const good = invert ? d <= 0 : d >= 0;
  const Icon = d >= 0 ? TrendingUp : TrendingDown;
  const text = Math.abs(d) > 500 ? `${Math.round(now / prev)}× the previous period` : `${Math.abs(Math.round(d))}% vs previous period`;
  return <span className={cx('inline-flex items-center gap-1 text-[11px] font-semibold', good ? (light ? 'text-emerald-600' : 'text-emerald-300') : (light ? 'text-rose-600' : 'text-rose-300'))}><Icon className="h-3 w-3" />{text}</span>;
}

export function Source({ kind, light = false }: { kind: 'auto' | 'entered' | 'live' | 'estimate'; light?: boolean }) {
  const label = { auto: 'Auto', entered: 'Team', live: 'Live', estimate: 'Estimate' }[kind];
  const title = { auto: 'Counted automatically from records in the app', entered: 'Recorded by your team', live: 'Current right now, not limited to the period', estimate: 'An estimate based on your data' }[kind];
  const cls = light
    ? { auto: 'bg-sky-50 text-sky-700', entered: 'bg-amber-50 text-amber-700', live: 'bg-emerald-50 text-emerald-700', estimate: 'bg-violet-50 text-violet-700' }[kind]
    : { auto: 'bg-sky-400/15 text-sky-200', entered: 'bg-gold-400/15 text-gold-400', live: 'bg-emerald-400/15 text-emerald-200', estimate: 'bg-violet-400/15 text-violet-200' }[kind];
  return <span title={title} className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls)}>{label}</span>;
}

/** Dark gradient band with an eyebrow, title and a grid of tiles. */
export function Hero({ eyebrow, title, children, legend = true, aside }: { eyebrow: string; title: React.ReactNode; children: React.ReactNode; legend?: boolean; aside?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-5 text-white shadow-xl sm:p-7">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-400/20 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-3">
        <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">{eyebrow}</div><h2 className="mt-1 text-2xl font-bold sm:text-3xl">{title}</h2></div>
        {aside ?? (legend && <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/60"><span className="flex items-center gap-1"><Source kind="auto" /> counted for the period</span><span className="flex items-center gap-1"><Source kind="live" /> as of today</span></div>)}
      </div>
      <div className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
    </section>
  );
}

export function Tile({ icon: Icon, label, value, sub, kind = 'auto', delta, to }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode; kind?: 'auto' | 'entered' | 'live' | 'estimate'; delta?: React.ReactNode; to?: string }) {
  const body = (
    <div className="h-full rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.1]">
      <div className="flex items-center justify-between gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-gold-400"><Icon className="h-4 w-4" /></span><Source kind={kind} /></div>
      <div className="mt-3 truncate text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-white/60">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-white/45">{sub}</div>}
      {delta && <div className="mt-1.5">{delta}</div>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

const TONES = { gold: 'from-gold-600 to-gold-400', brand: 'from-brand-600 to-brand-400', good: 'from-emerald-600 to-emerald-400', bad: 'from-rose-600 to-rose-400', sky: 'from-sky-600 to-sky-400' };
export type Tone = keyof typeof TONES;
export function Meter({ value, max, tone = 'gold', className }: { value: number; max: number; tone?: Tone; className?: string }) {
  return <div className={cx('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}><div className={cx('h-full rounded-full bg-gradient-to-r transition-all duration-700', TONES[tone])} style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%` }} /></div>;
}

/** Ranked list with a bar per row. */
export function Breakdown({ rows, format, tone = 'gold', empty = 'Nothing in this period.', labelOf, linkOf, subOf }: {
  rows: any[]; format: (v: number) => string; tone?: Tone; empty?: string; labelOf?: (r: any) => React.ReactNode; linkOf?: (r: any) => string | undefined; subOf?: (r: any) => React.ReactNode;
}) {
  if (!rows?.length) return <p className="text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.amount ?? r.value ?? r.n ?? r.hours ?? 0))));
  const total = rows.reduce((a, r) => a + Number(r.amount ?? r.value ?? r.n ?? r.hours ?? 0), 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => {
        const v = Number(r.amount ?? r.value ?? r.n ?? r.hours ?? 0);
        const name = labelOf ? labelOf(r) : r.key;
        const link = linkOf?.(r);
        return (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{link ? <Link to={link} className="hover:underline">{name}</Link> : name}{subOf && <span className="ml-2 text-xs text-slate-400">{subOf(r)}</span>}</span>
              <span className="shrink-0 tabular-nums text-slate-900"><b>{format(v)}</b>{total > 0 && <span className="ml-1.5 text-xs text-slate-400">{Math.round((v / total) * 100)}%</span>}</span>
            </div>
            <Meter value={Math.abs(v)} max={max} tone={tone} className="mt-1" />
          </li>
        );
      })}
    </ul>
  );
}

/** Horizontal step flow (A → B → C) used to show how one thing leads to the next. */
export function Flow({ steps }: { steps: { label: string; value: React.ReactNode; sub?: React.ReactNode; kind?: 'auto' | 'entered' | 'live' | 'estimate'; to?: string; tone?: 'default' | 'good' | 'bad' }[] }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
      {steps.map((s, i) => {
        const inner = (
          <div className={cx('h-full rounded-xl p-3', s.tone === 'good' ? 'bg-emerald-50' : s.tone === 'bad' ? 'bg-rose-50' : 'bg-slate-50')}>
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-slate-400">{s.label}{s.kind && <Source kind={s.kind} light />}</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{s.value}</div>
            {s.sub && <div className="text-xs text-slate-500">{s.sub}</div>}
          </div>
        );
        return (
          <React.Fragment key={s.label}>
            <div className="flex-1">{s.to ? <Link to={s.to} className="block h-full transition hover:-translate-y-0.5">{inner}</Link> : inner}</div>
            {i < steps.length - 1 && <span className="hidden self-center text-gold-500 md:block" aria-hidden>→</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const monthTick = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short' });
export const shortMoney = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
