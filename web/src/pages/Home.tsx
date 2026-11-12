import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowRight, CheckCircle2, Circle, Users, AlertTriangle, HandCoins, Wallet, Award, HeartHandshake, CalendarCheck, Clock, UserPlus } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api, useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, StateTabs, Spinner, ErrorBox, Modal, Field, Input, Textarea, Progress, Chip, useAction, Empty } from '../components/ui';
import { money, num, date, dateTime, label } from '../lib/format';
import { DonorsOverview } from './Donors';
import { SetupGuide } from './Setup';
import { Meter, monthTick, shortMoney, usePeriod, Hero, Tile, Delta, Source } from '../components/overview';

function EmptyHint({ text, to, cta }: { text: string; to: string; cta: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{text} <Link to={to} className="font-medium text-brand-600 hover:underline">{cta}</Link></div>;
}

export function Home() {
  const { terms, workspaces } = useSession();
  const [tab, setTab] = useState<'workspaces' | 'dashboard'>(workspaces.length > 1 ? 'workspaces' : 'dashboard');
  return (
    <>
      <PageHeader title="Home" subtitle="Who needs attention, where the next opportunity is, what work is due, where the money went, and what impact you made." actions={<StateTabs value={tab} onChange={setTab} tabs={[{ value: 'workspaces', label: terms }, { value: 'dashboard', label: 'Dashboard' }]} />} />
      {tab === 'workspaces' ? <Workspaces /> : <Dashboard />}
    </>
  );
}

function Workspaces() {
  const { workspaces, term, terms, can, reloadWorkspaces } = useSession();
  const [open, setOpen] = useState(false); const [v, setV] = useState<any>({});
  const { run, busy } = useAction(); const nav = useNavigate();
  return (
    <>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Your {terms}</h2>{can('settings.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setV({}); setOpen(true); }}>Add {term}</Button>}</div>
      {!workspaces.length ? <Empty title={`No ${terms.toLowerCase()} yet`} action={can('settings.manage') && <Button variant="primary" onClick={() => setOpen(true)}>Add {term}</Button>}>Create a workspace for each {term.toLowerCase()} you serve.</Empty> :
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((w) => (
            <div key={w.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3"><span className="h-10 w-10 shrink-0 rounded-xl" style={{ background: w.color }} /><div className="min-w-0"><h3 className="truncate font-semibold">{w.name}</h3>{w.description && <p className="truncate text-xs text-slate-500">{w.description}</p>}</div></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] uppercase text-slate-500">Donors</dt><dd className="font-bold">{num(w.donor_count)}</dd></div>
                <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] uppercase text-slate-500">Giving YTD</dt><dd className="font-bold">{money(w.giving_ytd)}</dd></div>
                <div className="rounded-xl bg-slate-50 p-2"><dt className="text-[11px] uppercase text-slate-500">Lifetime</dt><dd className="font-bold">{money(w.lifetime)}</dd></div>
              </dl>
              <Button variant="primary" className="mt-4" onClick={() => nav(`/workspaces/${w.id}`)}>Enter Workspace <ArrowRight className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>}
      <Modal open={open} onClose={() => setOpen(false)} title={`Add ${term}`} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => api.post('/workspaces', v), `${term} created`); if (r) { setOpen(false); reloadWorkspaces(); } }}>Create</Button></>}>
        <div className="space-y-3"><Field label="Name"><Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Description"><Textarea rows={2} value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <Field label="Color"><Input type="color" value={v.color ?? '#6366f1'} onChange={(e) => setV({ ...v, color: e.target.value })} className="h-10 w-20 p-1" /></Field></div>
      </Modal>
    </>
  );
}

export function WorkspaceHome() {
  const { id } = useParams(); const { workspaces, can } = useSession();
  const w = workspaces.find((x) => x.id === id);
  if (!w) return <Spinner />;
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><span className="h-8 w-8 rounded-lg" style={{ background: w.color }} />{w.name}</span>} subtitle={`${num(w.donor_count)} donors · ${money(w.giving_ytd)} YTD · ${money(w.lifetime)} lifetime`} actions={<Link to="/" className="text-sm text-brand-600 hover:underline">All workspaces</Link>} />
      {can('donors.read') ? <DonorsOverview ministryId={w.id} /> : <Dashboard ministryId={w.id} />}
    </>
  );
}

export function Dashboard({ ministryId }: { ministryId?: string }) {
  const per = usePeriod('ytd');
  const ministry = ministryId ?? per.ministry;
  const { data: d, loading, error, reload } = useApi<any>(`/dashboard${qs({ from: per.range.from, to: per.range.to, ministry_id: ministry })}`);
  const { can } = useSession();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !d) return <Spinner />;
  if (!d) return <Spinner />;
  const P = d.period ?? {};
  const live: { label: string; value: React.ReactNode; to: string; tone?: string }[] = [];
  if (d.recurring) live.push({ label: 'Monthly recurring', value: money(d.recurring.monthly), to: '/donors/giving/donors?recurring=true' });
  if (d.donors) live.push({ label: 'Opportunity (estimate)', value: money(d.donors.pipeline), to: '/donors/giving/priorities' });
  if (d.donors) live.push({ label: 'Lapsing / lapsed', value: `${num(d.donors.lapsing)} / ${num(d.donors.lapsed)}`, to: '/donors/giving/priorities/recovery', tone: d.donors.lapsing + d.donors.lapsed ? 'warn' : undefined });
  if (d.giving) live.push({ label: 'Thank-yous / receipts to send', value: `${num(d.giving.thanks_pending)} / ${num(d.giving.receipts_pending)}`, to: '/donors/giving/receipts', tone: d.giving.thanks_pending + d.giving.receipts_pending ? 'warn' : undefined });
  if (d.finance) live.push({ label: 'Unrestricted funds', value: money(d.finance.unrestricted), to: '/money/accounting/funds', tone: d.finance.unrestricted < 0 ? 'bad' : undefined });
  if (d.tasks) live.push({ label: 'Tasks overdue', value: num(d.tasks.overdue), to: '/work/tasks?due=overdue', tone: d.tasks.overdue ? 'bad' : undefined });
  return (
    <div className="space-y-5">
      {!d.onboarding.complete && <SetupGuide steps={d.onboarding.steps} onChange={reload} />}
      {per.controls(undefined, ministryId === undefined)}
      <Hero eyebrow="At a glance" title={`Your organization in ${per.range.label}`}>
        {P.given !== undefined && <Tile icon={HandCoins} label="Given" value={money(P.given)} sub={`${num(P.donors)} donors · ${num(P.new_donors)} new`} delta={<Delta now={P.given} prev={P.given_prev} />} to="/donors/giving" />}
        {P.donors !== undefined && <Tile icon={Users} label="Donors who gave" value={num(P.donors)} sub={`${num(d.donors?.total ?? 0)} donors on file`} delta={<Delta now={P.donors} prev={P.donors_prev} />} to="/donors/giving/donors" />}
        {P.spent !== undefined && <Tile icon={Wallet} label="Put to work (spent)" value={money(P.spent)} sub={`${money(P.income)} came in`} delta={<Delta now={P.spent} prev={P.spent_prev} invert />} to="/money/accounting" />}
        {P.grants_awarded !== undefined && <Tile icon={Award} label="Grants awarded" value={money(P.grants_awarded)} sub={`${num(P.grants_pending_n)} waiting for a decision`} to="/donors/grants?tab=pipeline" />}
        {P.served !== undefined && <Tile icon={HeartHandshake} label="People served" value={num(P.served)} sub={`${num(P.results)} measures with results`} kind="entered" to="/impact" />}
        {P.attended !== undefined && <Tile icon={CalendarCheck} label="Event attendance" value={num(P.attended)} sub={`${num(P.events)} events`} to="/donors/events" />}
        {P.hours !== undefined && <Tile icon={Clock} label="Hours logged" value={num(Math.round(P.hours))} sub={`${num(P.tasks_done)} tasks completed`} to="/work" />}
        {P.new_donors !== undefined && <Tile icon={UserPlus} label="New donors" value={num(P.new_donors)} delta={<Delta now={P.new_donors} prev={P.new_donors_prev} />} to="/growth" />}
      </Hero>
      {live.length > 0 && <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{live.map((x) => (
        <Link key={x.label} to={x.to} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-center justify-between gap-1 text-[11px] uppercase tracking-wide text-slate-400">{x.label}<Source kind="live" light /></div>
          <div className={`mt-1 truncate text-lg font-bold ${x.tone === 'bad' ? 'text-red-600' : x.tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>{x.value}</div>
        </Link>))}</div>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {d.monthly && <Card title="Giving — last 12 months" className="xl:col-span-2">
          <div className="h-64"><ResponsiveContainer><BarChart data={d.monthly}><defs><linearGradient id="homeGiving" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#efba11" /><stop offset="1" stopColor="#b38a1c" /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthTick} /><YAxis tickFormatter={shortMoney} tick={{ fontSize: 11 }} width={44} /><Tooltip formatter={(v: any) => money(v)} labelFormatter={(m: any) => monthTick(String(m))} cursor={{ fill: '#f8fafc' }} /><Bar dataKey="total" name="Given" fill="url(#homeGiving)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>}
        {d.myTasks && <Card title="My tasks" subtitle="Assigned to you, soonest first." actions={<Link to="/work/tasks" className="text-xs text-brand-600 hover:underline">All tasks</Link>}>
          {!d.myTasks.length ? <EmptyHint text="Nothing assigned to you." to="/work/tasks" cta="See all tasks" /> : <ul className="space-y-1.5">{d.myTasks.map((t: any) => {
            const due = t.due_date ? String(t.due_date).slice(0, 10) : null; const today = new Date().toISOString().slice(0, 10);
            const tone = !due ? 'bg-slate-100 text-slate-500' : due < today ? 'bg-red-100 text-red-700' : due === today ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
            return <li key={t.id}><Link to={`/work/tasks?open=${t.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-slate-50">
              <span className="relative h-5 w-5 shrink-0 rounded-full border-2 border-slate-300">{t.progress > 0 && <span className="absolute inset-0.5 rounded-full bg-brand-500" style={{ clipPath: `inset(${100 - t.progress}% 0 0 0)` }} />}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.title}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{due ? (due < today ? 'Overdue' : due === today ? 'Today' : date(due)) : 'No date'}</span>
            </Link></li>;
          })}</ul>}
        </Card>}
        {d.campaigns && <Card title="Active campaigns" subtitle="Progress toward each goal, and what came in during this period." actions={<Link to="/donors/giving/campaigns" className="text-xs text-brand-600 hover:underline">All campaigns</Link>}>
          {!d.campaigns.length ? <EmptyHint text="No active campaigns." to="/donors/giving/campaigns" cta="Start a campaign" /> : <ul className="space-y-4">{d.campaigns.map((c: any) => {
            const pct = c.goal ? Math.round((c.raised / c.goal) * 100) : null; const left = c.ends_on ? Math.ceil((new Date(`${String(c.ends_on).slice(0, 10)}T23:59:59`).getTime() - Date.now()) / 86400000) : null;
            return <li key={c.id}><Link to={`/donors/giving/campaigns/${c.id}`} className="group block">
              <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800 group-hover:text-brand-700">{c.name}</span>{pct !== null && <span className={`shrink-0 text-xs font-bold ${pct >= 100 ? 'text-emerald-600' : 'text-gold-600'}`}>{pct}%</span>}</div>
              <Meter value={c.raised} max={c.goal || c.raised} tone={pct !== null && pct >= 100 ? 'good' : 'gold'} className="mt-1.5 h-2" />
              <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-500"><span>{money(c.raised)}{c.goal ? ` of ${money(c.goal)}` : ''} · {num(c.donors)} donors</span><span>{c.raised_period ? `+${money(c.raised_period)} this period` : 'no gifts this period'}{left !== null && left >= 0 ? ` · ${left} days left` : ''}</span></div>
            </Link></li>;
          })}</ul>}
        </Card>}
        {d.grants && <Card title="Grant deadlines" subtitle="Applications and reports, soonest first." actions={<Link to="/donors/grants?tab=pipeline" className="text-xs text-brand-600 hover:underline">Pipeline</Link>}>
          {!d.grants.length ? <EmptyHint text="No open grants." to="/donors/grants" cta="Find grants" /> : <ul className="space-y-2">{d.grants.map((g: any) => {
            const report = ['awarded', 'reporting'].includes(g.status); const due = report ? g.report_due ?? g.deadline : g.deadline ?? g.report_due;
            const days = due ? Math.ceil((new Date(`${String(due).slice(0, 10)}T23:59:59`).getTime() - Date.now()) / 86400000) : null;
            const tone = days === null ? 'bg-slate-100 text-slate-500' : days < 0 ? 'bg-red-100 text-red-700' : days <= 14 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700';
            return <li key={g.id}><Link to={`/donors/grants/${g.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50">
              <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-center leading-none ${tone}`}>{days === null ? <span className="text-[10px]">no date</span> : <><span className="text-sm font-bold">{Math.abs(days)}</span><span className="text-[9px] uppercase">{days < 0 ? 'late' : 'days'}</span></>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{g.title}</span><span className="block truncate text-[11px] text-slate-500">{[g.funder, label(g.status), report ? 'report due' : 'application due', due ? date(due) : null].filter(Boolean).join(' · ')}</span></span>
              <span className="shrink-0 text-xs font-semibold text-slate-700">{money(g.awarded_amount || g.request_amount)}</span>
            </Link></li>;
          })}</ul>}
        </Card>}
        {d.events && <Card title="Upcoming events" subtitle="Registrations against capacity." actions={<Link to="/donors/events" className="text-xs text-brand-600 hover:underline">Events</Link>}>
          {!d.events.length ? <EmptyHint text="No upcoming events." to="/donors/events" cta="Plan an event" /> : <ul className="space-y-2">{d.events.map((e: any) => {
            const dt = new Date(e.starts_at);
            return <li key={e.id}><Link to={`/donors/events/${e.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50">
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 leading-none text-white"><span className="text-[9px] uppercase">{dt.toLocaleDateString(undefined, { month: 'short' })}</span><span className="text-base font-bold">{dt.getDate()}</span></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{e.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{[dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), e.location, e.raised ? `${money(e.raised)} raised` : null].filter(Boolean).join(' · ')}</span>
                {e.capacity ? <Meter value={e.people} max={e.capacity} tone={e.people >= e.capacity ? 'bad' : 'good'} className="mt-1" /> : null}</span>
              <span className="shrink-0 text-right text-xs"><b className="text-slate-800">{num(e.registered)}</b><span className="block text-[10px] text-slate-400">{e.capacity ? `of ${num(e.capacity)}` : 'registered'}</span></span>
            </Link></li>;
          })}</ul>}
        </Card>}
        {d.finance && <Card title="Fund balances" subtitle="Balance today, with money in and out during this period." actions={<Link to="/money/accounting/funds" className="text-xs text-brand-600 hover:underline">Fund ledger</Link>}>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2"><div className="text-[10px] uppercase tracking-wide text-slate-400">Unrestricted</div><div className={`font-bold ${d.finance.unrestricted < 0 ? 'text-red-600' : 'text-slate-900'}`}>{money(d.finance.unrestricted)}</div></div>
            <div className="rounded-xl bg-slate-50 p-2"><div className="text-[10px] uppercase tracking-wide text-slate-400">Restricted</div><div className="font-bold text-slate-900">{money(d.finance.restricted)}</div></div>
          </div>
          <ul className="space-y-2.5">{d.finance.funds.map((f: any) => {
            const max = Math.max(f.period_income ?? 0, f.period_expense ?? 0, 1);
            return <li key={f.id}><Link to={`/money/accounting/funds/${f.id}`} className="block rounded-lg px-1 py-0.5 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-2 text-sm"><span className="flex min-w-0 items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${f.restriction === 'unrestricted' ? 'bg-sky-500' : f.restriction === 'permanent' ? 'bg-violet-500' : 'bg-gold-500'}`} /><span className="truncate">{f.name}</span></span><span className={`shrink-0 font-semibold tabular-nums ${f.balance < 0 ? 'text-red-600' : 'text-slate-900'}`}>{money(f.balance)}</span></div>
              <div className="mt-1 grid grid-cols-2 gap-2"><Meter value={f.period_income ?? 0} max={max} tone="good" /><Meter value={f.period_expense ?? 0} max={max} tone="brand" /></div>
            </Link></li>;
          })}</ul>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" />Unrestricted</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-gold-500" />Restricted</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" />Endowment</span><span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded bg-emerald-500" />In</span><span className="flex items-center gap-1"><i className="h-1.5 w-3 rounded bg-brand-500" />Out (this period)</span></div>
        </Card>}
        {d.budgetAlerts?.length > 0 && <Card title={<span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-4 w-4" />Budget alerts</span>} subtitle="Budget lines at 90% or more.">
          <ul className="space-y-3">{d.budgetAlerts.map((b: any, i: number) => { const used = b.budget ? b.actual / b.budget : 0; return <li key={i}><Link to={`/money/accounting/budgets/${b.id}`} className="block">
            <div className="flex justify-between gap-2 text-sm"><span className="truncate text-slate-700">{b.account}</span><span className={`shrink-0 font-semibold ${used > 1 ? 'text-red-600' : 'text-amber-600'}`}>{Math.round(used * 100)}% used</span></div>
            <Meter value={b.actual} max={b.budget} tone={used > 1 ? 'bad' : 'gold'} className="mt-1" /><div className="mt-0.5 text-[11px] text-slate-400">{money(b.actual)} of {money(b.budget)} · {b.name}</div>
          </Link></li>; })}</ul>
        </Card>}
        {d.impact && d.impact.length > 0 && <Card title="Impact" subtitle="Results recorded by your team." actions={<Link to="/impact" className="text-xs text-brand-600 hover:underline">Impact</Link>}>
          <ul className="space-y-3">{d.impact.map((m: any) => <li key={m.id}><Link to="/impact" className="block">
            <div className="flex justify-between gap-2 text-sm"><span className="truncate text-slate-700">{m.name}</span><span className="shrink-0 text-slate-900"><b>{num(m.actual)}</b>{m.target ? ` / ${num(m.target)}` : ''} <span className="text-slate-400">{m.unit}</span></span></div>
            <Meter value={m.actual} max={m.target || m.actual} tone={m.target && m.actual >= m.target ? 'good' : 'gold'} className="mt-1" />
            <div className="mt-0.5 text-[11px] text-slate-400">{m.period ? `+${num(m.period)} this period` : 'nothing recorded this period'}</div>
          </Link></li>)}</ul>
        </Card>}
      </div>
      {!can('donors.read') && !can('finance.read') && !can('work.read') && <Empty title="Welcome" icon={<Users className="h-6 w-6" />}>Your role gives you access to specific areas from the left menu.</Empty>}
    </div>
  );
}

export const _l = { label };
