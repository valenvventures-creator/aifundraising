/** “Get set up” guide shown on Home until every step is done. */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Tags, Receipt, Users, History, PenLine, PiggyBank, BookOpen, Calculator, CreditCard, UserPlus, Mail, LayoutDashboard,
  Check, ArrowRight, ChevronDown, ChevronUp, Clock, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { cx, useAction } from '../components/ui';
import { ProgressRing } from '../components/visual';

type Step = { key: string; label: string; done: boolean; optional?: boolean; link: string };
const INFO: Record<string, { icon: React.ElementType; title: string; why: string; minutes: number }> = {
  organization: { icon: Building2, title: 'Create your organization', why: 'Your organization is set up and ready.', minutes: 1 },
  terminology: { icon: Tags, title: 'Name your workspaces', why: 'Choose Ministries, Programs, Chapters or Campuses so every screen speaks your language.', minutes: 1 },
  receipts: { icon: Receipt, title: 'Set up receipts', why: 'Add your tax number, signature and wording so receipts are ready to send.', minutes: 4 },
  donors: { icon: Users, title: 'Add or import donors', why: 'Bring in your donor list from a spreadsheet or another system.', minutes: 5 },
  gifts: { icon: History, title: 'Import past gifts', why: 'Giving history powers donor scores, priorities and reports.', minutes: 5 },
  voice: { icon: PenLine, title: 'Create a voice profile', why: 'Teach the writing assistant how your organization sounds.', minutes: 3 },
  funds: { icon: PiggyBank, title: 'Review your funds', why: 'Confirm general, restricted and endowment funds so money stays where it belongs.', minutes: 3 },
  accounting: { icon: BookOpen, title: 'Review the chart of accounts', why: 'Check the starter accounts and adjust them to match your books.', minutes: 4 },
  quickbooks: { icon: Calculator, title: 'Connect QuickBooks', why: 'Optional. Send posted entries to QuickBooks Online automatically.', minutes: 2 },
  payments: { icon: CreditCard, title: 'Connect online giving', why: 'Optional. Bring in Stripe, Square or PayPal gifts automatically.', minutes: 3 },
  team: { icon: UserPlus, title: 'Invite your team', why: 'Give each person the role and access they need.', minutes: 3 },
  google: { icon: Mail, title: 'Connect Google Workspace', why: 'Optional. Send from Gmail and add events to Google Calendar.', minutes: 2 },
  dashboard: { icon: LayoutDashboard, title: 'Tour your dashboard', why: 'See giving, funds and priorities together in one place.', minutes: 1 },
};
const PHASES: { title: string; keys: string[] }[] = [
  { title: 'Your organization', keys: ['organization', 'terminology', 'receipts'] },
  { title: 'Donors & giving', keys: ['donors', 'gifts', 'voice'] },
  { title: 'Money', keys: ['funds', 'accounting', 'quickbooks', 'payments'] },
  { title: 'Team & tools', keys: ['team', 'google', 'dashboard'] },
];

export function SetupGuide({ steps, onChange }: { steps: Step[]; onChange: () => void }) {
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  const ordered = PHASES.flatMap((p) => p.keys).map((k) => byKey[k]).filter(Boolean) as Step[];
  for (const s of steps) if (!ordered.includes(s)) ordered.push(s); // any future step
  const number = (k: string) => ordered.findIndex((s) => s.key === k) + 1;
  const done = steps.filter((s) => s.done).length;
  const pct = (done / steps.length) * 100;
  const next = ordered.find((s) => !s.done && !s.optional) ?? ordered.find((s) => !s.done);
  const minutesLeft = ordered.filter((s) => !s.done).reduce((a, s) => a + (INFO[s.key]?.minutes ?? 2), 0);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ainp-onboarding-collapsed') === '1'; } catch { return false; } });
  const [pop, setPop] = useState<string | null>(null);
  const { run, busy } = useAction();
  const toggle = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem('ainp-onboarding-collapsed', v ? '1' : '0'); } catch { /* ignore */ } };
  const complete = async (s: Step) => { setPop(s.key); const r = await run(() => api.post(`/onboarding/${s.optional ? `skip_${s.key}` : s.key}`)); if (r) onChange(); };
  const NextIcon = next ? INFO[next.key]?.icon ?? Sparkles : Sparkles;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 text-white shadow-xl" aria-label="Get set up">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />

      <div className="relative flex flex-wrap items-center gap-5 p-5 sm:p-7">
        <ProgressRing value={pct} size={collapsed ? 64 : 104} stroke={collapsed ? 7 : 10} label={collapsed ? undefined : 'set up'} dark />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Get set up</div>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{done <= 1 ? 'Welcome! Let’s get you ready' : pct >= 75 ? 'Nearly there' : 'You’re making great progress'}</h2>
          <p className="mt-1 text-sm text-white/65">{done} of {steps.length} steps done{minutesLeft ? ` · about ${minutesLeft} minutes left` : ''}. Optional connections can be skipped.</p>
        </div>
        {next && !collapsed && (
          <div className="w-full rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur sm:w-auto sm:min-w-[320px] sm:max-w-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gold-400"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" /></span>Up next · step {number(next.key)}</div>
            <div className="mt-2 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-400 text-slate-900"><NextIcon className="h-5 w-5" /></span>
              <div className="min-w-0"><div className="font-semibold">{INFO[next.key]?.title ?? next.label}</div><div className="mt-0.5 text-xs text-white/65">{INFO[next.key]?.why}</div></div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Link to={next.link} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow transition hover:-translate-y-0.5">Start <ArrowRight className="h-4 w-4" /></Link>
              <button disabled={busy} onClick={() => complete(next)} className="rounded-xl px-3 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white">{next.optional ? 'Skip' : 'Mark done'}</button>
              <span className="ml-auto flex items-center gap-1 text-xs text-white/50"><Clock className="h-3.5 w-3.5" />{INFO[next.key]?.minutes ?? 2} min</span>
            </div>
          </div>
        )}
        <button onClick={toggle} className="absolute right-3 top-3 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white sm:static" aria-expanded={!collapsed} aria-label={collapsed ? 'Show all steps' : 'Hide steps'}>
          {collapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="relative grid gap-3 border-t border-white/10 bg-black/10 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-4">
          {PHASES.map((p, pi) => {
            const items = p.keys.map((k) => byKey[k]).filter(Boolean) as Step[];
            const pd = items.filter((s) => s.done).length;
            return (
              <div key={p.title} className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{p.title}</div>
                  <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', pd === items.length ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-white/60')}>{pd === items.length ? 'Done' : `${pd}/${items.length}`}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-all duration-700" style={{ width: `${(pd / items.length) * 100}%` }} /></div>
                <ol className="mt-4">
                  {items.map((s, i) => {
                    const info = INFO[s.key]; const Icon = info?.icon ?? Sparkles; const isNext = next?.key === s.key; const last = i === items.length - 1;
                    return (
                      <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                        {!last && <span className={cx('absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-0.5 rounded', s.done ? 'bg-gradient-to-b from-emerald-400 to-emerald-400/30' : 'bg-white/10')} aria-hidden />}
                        <span className={cx('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-500',
                          s.done ? 'bg-emerald-400 text-slate-900' : isNext ? 'bg-gold-400 text-slate-900 ring-4 ring-gold-400/25' : 'bg-white/10 text-white/70 ring-1 ring-white/15',
                          pop === s.key && 'scale-110')}>
                          {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : number(s.key)}
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <Link to={s.link} className={cx('group flex items-center gap-1.5 text-sm font-medium', s.done ? 'text-white/45' : 'text-white hover:text-gold-400')}>
                            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" /><span className={cx(s.done && 'line-through decoration-white/30')}>{info?.title ?? s.label}</span>
                            {s.optional && !s.done && <span className="rounded bg-white/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">Optional</span>}
                          </Link>
                          {!s.done && <div className="mt-0.5 text-xs leading-snug text-white/50">{info?.why}</div>}
                          {!s.done && <button disabled={busy} onClick={() => complete(s)} className="mt-1 text-[11px] font-medium text-white/45 hover:text-white">{s.optional ? 'Skip for now' : 'Mark done'}</button>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
