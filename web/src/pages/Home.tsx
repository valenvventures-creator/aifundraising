import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowRight, CheckCircle2, Circle, Users, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, StateTabs, Spinner, ErrorBox, Modal, Field, Input, Textarea, Progress, Chip, useAction, Empty } from '../components/ui';
import { money, num, date, dateTime, label } from '../lib/format';
import { DonorsOverview } from './Donors';

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
  const { data: d, loading, error, reload } = useApi<any>(`/dashboard${ministryId ? `?ministry_id=${ministryId}` : ''}`);
  const { can } = useSession();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !d) return <Spinner />;
  const yoy = d.giving?.last_ytd ? Math.round(((d.giving.ytd - d.giving.last_ytd) / d.giving.last_ytd) * 100) : null;
  return (
    <div className="space-y-5">
      {!d.onboarding.complete && <Onboarding steps={d.onboarding.steps} onChange={reload} />}
      {d.giving && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Giving YTD" value={money(d.giving.ytd)} sub={yoy !== null ? `${yoy >= 0 ? '+' : ''}${yoy}% vs last year` : undefined} tone="brand" to="/money/accounting/giving" />
        <Metric label="Lifetime giving" value={money(d.giving.lifetime)} to="/donors/giving/reports" />
        <Metric label="Total donors" value={num(d.donors.total)} sub={`${d.donors.new_ytd} new this year`} to="/donors/giving/donors" />
        <Metric label="Active donors" value={num(d.donors.active)} tone="good" to="/donors/giving/donors?health=active,engaged" />
        <Metric label="Lapsing / lapsed" value={`${d.donors.lapsing} / ${d.donors.lapsed}`} tone="warn" to="/donors/giving/priorities/recovery" />
        <Metric label="Opportunity pipeline" value={money(d.donors.pipeline)} sub="estimate" to="/donors/giving/priorities" />
        <Metric label="Recurring / month" value={money(d.recurring.monthly)} sub={`${d.recurring.n} active plans`} to="/donors/giving/donors?recurring=true" />
        <Metric label="Receipts outstanding" value={num(d.giving.receipts_pending)} tone={d.giving.receipts_pending ? 'warn' : 'default'} to="/donors/giving" />
        <Metric label="Thank-yous outstanding" value={num(d.giving.thanks_pending)} tone={d.giving.thanks_pending ? 'warn' : 'default'} to="/donors/giving" />
        {d.finance && <Metric label="Restricted balances" value={money(d.finance.restricted)} to="/money/accounting/funds" />}
        {d.finance && <Metric label="Unrestricted balance" value={money(d.finance.unrestricted)} tone={d.finance.unrestricted < 0 ? 'bad' : 'default'} to="/money/accounting/funds" />}
        {d.finance && <Metric label="Expenses YTD" value={money(d.finance.expenses_ytd)} to="/money/reports" />}
        {d.tasks && <Metric label="Tasks overdue" value={num(d.tasks.overdue)} tone={d.tasks.overdue ? 'bad' : 'good'} to="/work/tasks?due=overdue" />}
        {d.grantTotals && <Metric label="Grants pending" value={money(d.grantTotals.pending)} to="/donors/grants" />}
        {d.grantTotals && <Metric label="Grants awarded YTD" value={money(d.grantTotals.awarded_ytd)} tone="good" to="/donors/grants" />}
      </div>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {d.monthly && <Card title="Giving — last 12 months" className="xl:col-span-2">
          <div className="h-64"><ResponsiveContainer><BarChart data={d.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => money(v)} tick={{ fontSize: 11 }} width={70} /><Tooltip formatter={(v: any) => money(v)} /><Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>}
        {d.myTasks && <Card title="My tasks" actions={<Link to="/work/tasks" className="text-xs text-brand-600 hover:underline">All tasks</Link>}>
          {!d.myTasks.length ? <p className="text-sm text-slate-500">Nothing assigned to you.</p> : <ul className="space-y-2">{d.myTasks.map((t: any) => <li key={t.id}><Link to={`/work/tasks?open=${t.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"><span className="truncate text-sm">{t.title}</span><span className={`shrink-0 text-xs ${t.due_date && t.due_date < new Date().toISOString().slice(0, 10) ? 'text-red-600' : 'text-slate-500'}`}>{date(t.due_date)}</span></Link></li>)}</ul>}
        </Card>}
        {d.campaigns && <Card title="Active campaigns">
          {!d.campaigns.length ? <p className="text-sm text-slate-500">No active campaigns.</p> : <div className="space-y-3">{d.campaigns.map((c: any) => <Link key={c.id} to={`/donors/giving/campaigns/${c.id}`} className="block"><div className="flex justify-between text-sm"><span className="font-medium">{c.name}</span><span>{money(c.raised)}{c.goal ? ` / ${money(c.goal)}` : ''}</span></div>{c.goal && <Progress value={c.raised} max={c.goal} />}</Link>)}</div>}
        </Card>}
        {d.grants && <Card title="Grant deadlines" actions={<Link to="/donors/grants" className="text-xs text-brand-600 hover:underline">Pipeline</Link>}>
          {!d.grants.length ? <p className="text-sm text-slate-500">No open grants.</p> : <ul className="space-y-2">{d.grants.map((g: any) => <li key={g.id}><Link to={`/donors/grants/${g.id}`} className="flex items-center justify-between gap-2"><span className="truncate text-sm">{g.title}</span><span className="flex shrink-0 items-center gap-2"><Chip value={g.status} /><span className="text-xs text-slate-500">{date(g.deadline)}</span></span></Link></li>)}</ul>}
        </Card>}
        {d.events && <Card title="Upcoming events" actions={<Link to="/donors/events" className="text-xs text-brand-600 hover:underline">Events</Link>}>
          {!d.events.length ? <p className="text-sm text-slate-500">No upcoming events.</p> : <ul className="space-y-2">{d.events.map((e: any) => <li key={e.id}><Link to={`/donors/events/${e.id}`} className="flex justify-between text-sm"><span>{e.name}</span><span className="text-slate-500">{dateTime(e.starts_at)} · {e.registered} reg.</span></Link></li>)}</ul>}
        </Card>}
        {d.finance && <Card title="Fund balances" actions={<Link to="/money/accounting/funds" className="text-xs text-brand-600 hover:underline">Fund ledger</Link>}>
          <ul className="space-y-1.5">{d.finance.funds.map((f: any) => <li key={f.id}><Link to={`/money/accounting/funds/${f.id}`} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2">{f.name}<Chip value={f.restriction} /></span><span className={`tabular-nums ${f.balance < 0 ? 'text-red-600' : ''}`}>{money(f.balance)}</span></Link></li>)}</ul>
        </Card>}
        {d.budgetAlerts?.length > 0 && <Card title={<span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-4 w-4" />Budget alerts</span>}>
          <ul className="space-y-1.5 text-sm">{d.budgetAlerts.map((b: any, i: number) => <li key={i}><Link to={`/money/accounting/budgets/${b.id}`} className="flex justify-between"><span>{b.account}</span><span>{Math.round((b.actual / b.budget) * 100)}% used</span></Link></li>)}</ul>
        </Card>}
        {d.impact && d.impact.length > 0 && <Card title="Impact" actions={<Link to="/impact" className="text-xs text-brand-600 hover:underline">Impact</Link>}>
          <div className="space-y-3">{d.impact.map((m: any) => <div key={m.id}><div className="flex justify-between text-sm"><span>{m.name}</span><span>{num(m.actual)}{m.target ? ` / ${num(m.target)}` : ''} {m.unit}</span></div>{m.target && <Progress value={m.actual} max={m.target} tone="good" />}</div>)}</div>
        </Card>}
      </div>
      {!can('donors.read') && !can('finance.read') && !can('work.read') && <Empty title="Welcome" icon={<Users className="h-6 w-6" />}>Your role gives you access to specific areas from the left menu.</Empty>}
    </div>
  );
}

function Onboarding({ steps, onChange }: { steps: any[]; onChange: () => void }) {
  const done = steps.filter((s) => s.done).length;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('ainp-onboarding-hidden') === '1'; } catch { return false; } });
  if (hidden) return <button className="text-xs text-brand-600 hover:underline" onClick={() => { setHidden(false); try { localStorage.removeItem('ainp-onboarding-hidden'); } catch { /* ignore */ } }}>Show setup checklist ({done}/{steps.length})</button>;
  return (
    <Card title={`Get set up — ${done} of ${steps.length} complete`} subtitle="Optional integrations can be skipped." actions={<Button size="sm" variant="ghost" onClick={() => { setHidden(true); try { localStorage.setItem('ainp-onboarding-hidden', '1'); } catch { /* ignore */ } }}>Hide</Button>}>
      <Progress value={done} max={steps.length} />
      <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
            <Link to={s.link} className="flex items-center gap-2 text-sm">{s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-slate-300" />}<span className={s.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{s.label}</span></Link>
            {!s.done && <button className="shrink-0 text-xs text-slate-400 hover:text-slate-700" onClick={async () => { await api.post(`/onboarding/${s.optional ? `skip_${s.key}` : s.key}`); onChange(); }}>{s.optional ? 'Skip' : 'Mark done'}</button>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
export const _l = { label };
