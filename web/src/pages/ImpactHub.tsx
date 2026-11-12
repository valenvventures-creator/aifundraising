/** Impact overview: pulls results from every area of the app for a period and workspace. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HeartHandshake, Target, HandCoins, Wallet, Clock, CalendarCheck, Award, Mail, ArrowRight, TrendingUp, TrendingDown, Sparkles, BookOpen, CalendarClock, Info,
} from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Spinner, ErrorBox, Select, Input, Empty, cx } from '../components/ui';
import { WorkspaceSelect, DraftModal } from '../components/domain';
import { money, num, date } from '../lib/format';

type Preset = 'ytd' | '12m' | 'lastyear' | 'quarter' | 'custom';
const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const now = new Date(); const y = now.getUTCFullYear();
  if (p === 'ytd') return { from: `${y}-01-01`, to: iso(now), label: `${y} so far` };
  if (p === '12m') { const f = new Date(now); f.setUTCFullYear(y - 1); f.setUTCDate(f.getUTCDate() + 1); return { from: iso(f), to: iso(now), label: 'the last 12 months' }; }
  if (p === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
  if (p === 'quarter') { const q = Math.floor(now.getUTCMonth() / 3); const f = new Date(Date.UTC(y, q * 3, 1)); return { from: iso(f), to: iso(now), label: 'this quarter' }; }
  return { from: custom.from, to: custom.to, label: `${date(custom.from)} – ${date(custom.to)}` };
}

function Delta({ now, prev, invert = false }: { now: number; prev: number; invert?: boolean }) {
  if (!prev && !now) return null;
  if (!prev) return <span className="text-[11px] font-medium text-emerald-300">New this period</span>;
  const d = ((now - prev) / prev) * 100;
  const good = invert ? d < 0 : d >= 0;
  const Icon = d >= 0 ? TrendingUp : TrendingDown;
  return <span className={cx('inline-flex items-center gap-1 text-[11px] font-semibold', good ? 'text-emerald-300' : 'text-rose-300')}><Icon className="h-3 w-3" />{Math.abs(Math.round(d))}% vs previous period</span>;
}
function Source({ kind, light = false }: { kind: 'auto' | 'entered'; light?: boolean }) {
  return <span title={kind === 'auto' ? 'Counted automatically from records elsewhere in the app' : 'Recorded by your team on the Impact page'}
    className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', light
      ? (kind === 'auto' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700')
      : (kind === 'auto' ? 'bg-sky-400/15 text-sky-200' : 'bg-gold-400/15 text-gold-400'))}>{kind === 'auto' ? 'Auto' : 'Team'}</span>;
}

function Tile({ icon: Icon, label, value, sub, kind, delta, to }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode; kind: 'auto' | 'entered'; delta?: React.ReactNode; to?: string }) {
  const body = (
    <div className="group h-full rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.1]">
      <div className="flex items-center justify-between gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-gold-400"><Icon className="h-4 w-4" /></span><Source kind={kind} /></div>
      <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-white/60">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-white/45">{sub}</div>}
      {delta && <div className="mt-1.5">{delta}</div>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

function Bar2({ value, max, cls = 'from-gold-600 to-gold-400' }: { value: number; max: number; cls?: string }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full bg-gradient-to-r transition-all duration-700', cls)} style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>;
}

export function ImpactOverview() {
  const { can } = useSession();
  const [preset, setPreset] = useState<Preset>('ytd');
  const [custom, setCustom] = useState({ from: `${new Date().getUTCFullYear()}-01-01`, to: iso(new Date()) });
  const [ministry, setMinistry] = useState('');
  const [report, setReport] = useState(false);
  const range = rangeFor(preset, custom);
  const { data: d, error, reload } = useApi<any>(`/impact/hub${qs({ from: range.from, to: range.to, ministry_id: ministry })}`);

  const reportContext = useMemo(() => {
    if (!d) return '';
    const lines = [`Period: ${range.label} (${d.period.from} to ${d.period.to}).`];
    if (d.served.now) lines.push(`People served (from impact stories): ${d.served.now}.`);
    d.results.filter((m: any) => m.actual).forEach((m: any) => lines.push(`Result: ${m.name}: ${m.actual} ${m.unit ?? ''}${m.target ? ` of a ${m.target} target` : ''}${m.project_name ? ` (${m.project_name})` : ''}.`));
    if (d.giving) lines.push(`Giving: ${money(d.giving.raised)} from ${d.giving.donors} donors (${d.giving.new_donors} new)${d.giving.retention !== null ? `, donor retention ${d.giving.retention}%` : ''}.`);
    if (d.funds) lines.push(`Spent on the mission: ${money(d.spent)} (${money(d.spentRestricted)} from restricted funds).`);
    if (d.work?.hours) lines.push(`Hours logged by staff and volunteers: ${num(d.work.hours)} by ${d.work.people} people; ${d.work.tasks} tasks completed.`);
    if (d.events?.events) lines.push(`Events: ${d.events.events}, ${d.events.attended} people attended.`);
    if (d.grants?.awarded) lines.push(`Grants awarded: ${money(d.grants.awarded)} (${d.grants.awarded_count}).`);
    d.projects.forEach((p: any) => lines.push(`Program ${p.name}: ${p.raised !== undefined ? `raised ${money(p.raised)}, ` : ''}${p.spent !== undefined ? `spent ${money(p.spent)}, ` : ''}${p.metrics.map((m: any) => `${m.name} ${m.actual}${m.target ? `/${m.target}` : ''}`).join(', ')}${p.served ? `, ${p.served} people served` : ''}.`));
    d.stories.slice(0, 3).forEach((s: any) => lines.push(`Story: ${s.title}: ${s.story}`));
    return lines.join('\n');
  }, [d, range.label]);

  const maxWs = useMemo(() => {
    const m: Record<string, number> = {};
    (d?.workspaces ?? []).forEach((w: any) => Object.entries(w).forEach(([k, v]) => { if (typeof v === 'number') m[k] = Math.max(m[k] ?? 0, v); }));
    return m;
  }, [d]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {([['ytd', 'This year'], ['quarter', 'This quarter'], ['12m', 'Last 12 months'], ['lastyear', 'Last year'], ['custom', 'Custom']] as [Preset, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium', preset === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && <div className="flex items-center gap-1"><Input type="date" className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" /><span className="text-slate-400">–</span><Input type="date" className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>}
        <div className="w-56"><WorkspaceSelect value={ministry} onChange={setMinistry} /></div>
        {can('ai.ask') && d && <Button className="ml-auto" icon={<Sparkles className="h-4 w-4" />} onClick={() => setReport(true)}>Draft impact report</Button>}
      </div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : !d ? <Spinner label="Gathering results from across the app…" /> : (
        <>
          {/* Headline */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-5 text-white shadow-xl sm:p-7">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-400/20 blur-3xl" />
            <div className="relative flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Your impact</div>
                <h2 className="mt-1 text-2xl font-bold sm:text-3xl">What your mission accomplished in {range.label}</h2>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-white/60"><span className="flex items-center gap-1"><Source kind="auto" /> counted from the app</span><span className="flex items-center gap-1"><Source kind="entered" /> recorded by your team</span></div>
            </div>
            <div className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile icon={HeartHandshake} label="People served" value={num(d.served.now)} sub={`${d.served.stories} ${d.served.stories === 1 ? 'story' : 'stories'} this period`} kind="entered" delta={<Delta now={d.served.now} prev={d.served.prev} />} />
              <Tile icon={Target} label="Results recorded" value={num(d.results.filter((m: any) => m.actual).length)} sub={`of ${d.results.length} tracked ${d.results.length === 1 ? 'measure' : 'measures'}`} kind="entered" />
              {d.giving && <Tile icon={HandCoins} label="Given to the mission" value={money(d.giving.raised)} sub={`${num(d.giving.donors)} donors · ${num(d.giving.new_donors)} new`} kind="auto" delta={<Delta now={d.giving.raised} prev={d.giving.raised_prev} />} to="/donors/giving" />}
              {d.funds && <Tile icon={Wallet} label="Put to work (spent)" value={money(d.spent)} sub={`${money(d.spentRestricted)} from restricted funds`} kind="auto" to="/money/accounting/funds" />}
              {d.work && <Tile icon={Clock} label="Hours given" value={num(Math.round(d.work.hours))} sub={`${d.work.people} ${d.work.people === 1 ? 'person' : 'people'} · ${d.work.tasks} tasks done`} kind="auto" delta={<Delta now={d.work.hours} prev={d.work.hours_prev} />} to="/work/time" />}
              {d.events && <Tile icon={CalendarCheck} label="Event attendance" value={num(d.events.attended)} sub={`${d.events.events} events · ${num(d.events.registered)} registered`} kind="auto" to="/donors/events" />}
              {d.grants && <Tile icon={Award} label="Grants awarded" value={money(d.grants.awarded)} sub={`${d.grants.awarded_count} awarded · ${d.grants.pending} pending`} kind="auto" to="/donors/grants?tab=pipeline" />}
              {d.giving && d.giving.retention !== null ? <Tile icon={TrendingUp} label="Donors who gave again" value={`${Math.round(d.giving.retention)}%`} sub={`${d.giving.retained} of ${d.giving.donors_prev} from the previous period`} kind="auto" />
                : d.reach && <Tile icon={Mail} label="People reached by email" value={num(d.reach.people)} sub={`${num(d.reach.delivered)} emails delivered`} kind="auto" />}
            </div>
          </section>

          {/* Programs: money in → money out → results → stories */}
          <Card title="Where the impact happened: programs" subtitle="Money in, money put to work, and the results and stories each program produced in this period." padded={false}>
            {!d.projects.length ? <div className="p-5"><Empty title="No programs yet">Create programs under <Link className="text-brand-600 hover:underline" to="/donors/projects">Donors › Projects</Link>. Gifts, expenses, time and results linked to a project appear here automatically.</Empty></div> : (
              <div className="divide-y divide-slate-100">
                {d.projects.map((p: any) => {
                  const steps = [
                    p.raised !== undefined && { label: 'Raised', value: money(p.raised), sub: p.goal ? `${Math.round((p.raised / p.goal) * 100)}% of goal` : null, kind: 'auto' as const },
                    p.spent !== undefined && { label: 'Put to work', value: money(p.spent), sub: p.budget ? `${Math.round((p.spent / p.budget) * 100)}% of budget` : null, kind: 'auto' as const },
                    { label: 'Hours & tasks', value: `${num(Math.round(p.hours))} h`, sub: `${p.tasks_done} tasks done`, kind: 'auto' as const },
                    { label: 'People served', value: num(p.served), sub: `${p.stories} ${p.stories === 1 ? 'story' : 'stories'}`, kind: 'entered' as const },
                  ].filter(Boolean) as any[];
                  return (
                    <div key={p.id} className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><Link to={`/donors/projects/${p.id}`} className="font-semibold text-slate-900 hover:underline">{p.name}</Link><div className="text-xs text-slate-500">{[p.ministry_name, p.fund_name && `Fund: ${p.fund_name}`, p.grants_awarded ? `${money(p.grants_awarded)} in grants` : null].filter(Boolean).join(' · ')}</div></div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-stretch">
                        {steps.map((s, i) => (
                          <React.Fragment key={s.label}>
                            <div className="flex-1 rounded-xl bg-slate-50 p-3">
                              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">{s.label}<Source kind={s.kind} light /></div>
                              <div className="mt-1 text-lg font-bold text-slate-900">{s.value}</div>
                              {s.sub && <div className="text-xs text-slate-500">{s.sub}</div>}
                            </div>
                            {i < steps.length - 1 && <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-gold-500 md:block" />}
                          </React.Fragment>
                        ))}
                      </div>
                      {p.metrics.length > 0 && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {p.metrics.map((m: any) => (
                            <div key={m.name}>
                              <div className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-slate-700">{m.name}</span><span className="text-slate-500">{num(m.actual)}{m.target ? ` / ${num(m.target)}` : ''} {m.unit}</span></div>
                              <Bar2 value={m.actual} max={m.target || m.actual} />
                              {m.costPer !== null && <div className="mt-0.5 text-[11px] text-slate-400">{money(m.costPer)} per {m.unit ? m.unit.replace(/s$/, '') : 'result'}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            {/* By workspace */}
            <Card title="By workspace" subtitle="How each part of your organization contributed in this period.">
              {!d.workspaces.length ? <p className="text-sm text-slate-500">No workspaces yet.</p> : (
                <div className="space-y-4">
                  {d.workspaces.map((w: any) => (
                    <div key={w.id ?? 'org'}>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-full" style={{ background: w.color ?? '#6366f1' }} />{w.name}</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                        {([['raised', 'Raised', money], ['spent', 'Put to work', money], ['served', 'People served', num], ['hours', 'Hours', (v: number) => num(Math.round(v))], ['attended', 'Attended events', num], ['awarded', 'Grants awarded', money], ['results', 'Results recorded', num]] as [string, string, (v: number) => string][])
                          .filter(([k]) => w[k] !== undefined).map(([k, l, f]) => (
                            <div key={k}><div className="flex justify-between text-slate-500"><span>{l}</span><span className="font-semibold text-slate-800">{f(w[k])}</span></div><Bar2 value={w[k]} max={maxWs[k]} cls={k === 'spent' ? 'from-brand-600 to-brand-400' : k === 'served' || k === 'results' ? 'from-emerald-600 to-emerald-400' : 'from-gold-600 to-gold-400'} /></div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Trend */}
            <Card title="Month by month" subtitle="Giving and spending (bars) with results recorded (line).">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.trend} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m) => new Date(`${m}-15`).toLocaleDateString(undefined, { month: 'short' })} />
                    <YAxis yAxisId="money" tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={40} />
                    <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                    <Tooltip formatter={(v: any, n: any) => (n === 'Results recorded' || n === 'Hours' ? num(v) : money(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {d.sections.includes('giving') && <Bar yAxisId="money" dataKey="raised" name="Raised" fill="#d4a10c" radius={[4, 4, 0, 0]} />}
                    {d.sections.includes('funds') && <Bar yAxisId="money" dataKey="spent" name="Put to work" fill="#6366f1" radius={[4, 4, 0, 0]} />}
                    <Line yAxisId="count" type="monotone" dataKey="results" name="Results recorded" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            {/* Results */}
            <Card title="Results" subtitle="Progress on what you measure." actions={<Link to="/impact?tab=metrics" className="text-xs text-brand-600 hover:underline">Record results</Link>} className="xl:col-span-2">
              {!d.results.length ? <Empty title="Nothing measured yet">Add a measure such as “meals served” or “students mentored” in the <b>Measures</b> tab, then record results as they happen.</Empty> : (
                <div className="space-y-3">
                  {d.results.map((m: any) => (
                    <div key={m.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium text-slate-800">{m.name}<span className="ml-2 text-xs font-normal text-slate-400">{[m.project_name, m.ministry_name].filter(Boolean).join(' · ')}</span></span>
                        <span className="text-slate-600"><b className="text-slate-900">{num(m.actual)}</b>{m.target ? ` / ${num(m.target)}` : ''} {m.unit}{m.previous ? <span className="ml-2 text-xs text-slate-400">prev. {num(m.previous)}</span> : null}</span>
                      </div>
                      <Bar2 value={m.actual} max={m.target || Math.max(m.actual, m.previous) || 1} cls={m.target && m.actual >= m.target ? 'from-emerald-600 to-emerald-400' : undefined} />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Coming up */}
            <Card title="Coming up">
              <div className="space-y-4 text-sm">
                {d.grants && <div><div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800"><CalendarClock className="h-4 w-4 text-gold-600" />Grant reports due</div>
                  {!d.grants.reports.length ? <p className="text-xs text-slate-500">No reports due.</p> : d.grants.reports.map((g: any) => <Link key={g.id} to={`/donors/grants/${g.id}`} className="flex justify-between gap-2 py-1 hover:underline"><span className="truncate">{g.title}</span><span className={cx('shrink-0 text-xs', g.report_due < iso(new Date()) ? 'font-semibold text-red-600' : 'text-slate-500')}>{date(g.report_due)}</span></Link>)}</div>}
                {d.events && <div><div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800"><CalendarCheck className="h-4 w-4 text-gold-600" />Events in this period</div>
                  {!d.events.list.length ? <p className="text-xs text-slate-500">No events in this period.</p> : d.events.list.map((e: any) => <Link key={e.id} to={`/donors/events/${e.id}`} className="flex justify-between gap-2 py-1 hover:underline"><span className="truncate">{e.name}</span><span className="shrink-0 text-xs text-slate-500">{e.attended}/{e.registered} attended</span></Link>)}</div>}
                {d.funds && d.funds.some((f: any) => f.restriction !== 'unrestricted') && <div><div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800"><Wallet className="h-4 w-4 text-gold-600" />Restricted funds at work</div>
                  {d.funds.filter((f: any) => f.restriction !== 'unrestricted').slice(0, 5).map((f: any) => <div key={f.id} className="py-1"><div className="flex justify-between text-xs"><span>{f.name}</span><span className="text-slate-500">{money(f.spent)} spent · {money(f.received)} in</span></div><Bar2 value={f.spent} max={Math.max(f.spent, f.received)} cls="from-brand-600 to-brand-400" /></div>)}</div>}
              </div>
            </Card>
          </div>

          {/* Stories */}
          <Card title="Stories" subtitle="The people behind the numbers." actions={<Link to="/impact?tab=stories" className="text-xs text-brand-600 hover:underline">Add a story</Link>}>
            {!d.stories.length ? <Empty title="No stories in this period" icon={<BookOpen className="h-6 w-6" />}>A short story with the number of people served makes every report stronger.</Empty> : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {d.stories.map((s: any) => (
                  <div key={s.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-xs text-slate-400">{date(s.story_date)}{s.project_name ? ` · ${s.project_name}` : ''}</div>
                    <div className="mt-1 font-semibold text-slate-900">{s.title}</div>
                    <p className="mt-1 line-clamp-4 text-sm text-slate-600">{s.story}</p>
                    {s.beneficiaries ? <div className="mt-2 text-xs font-medium text-emerald-700">{num(s.beneficiaries)} people served</div> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <p className="flex items-start gap-1.5 text-xs text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />“Auto” figures come from gifts, posted accounting entries, the time log, tasks, events, grants and email in this period. Spending is counted from posted entries only. You only see areas your role can access.</p>
          {report && <DraftModal open onClose={() => setReport(false)} kind="impact_story" title="Impact report draft" ministryId={ministry || undefined} context={reportContext} />}
        </>
      )}
    </div>
  );
}
