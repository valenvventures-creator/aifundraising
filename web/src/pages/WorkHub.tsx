/** Work overview: tasks, time, contacts, team workload and an agenda that pulls deadlines from across the app. */
import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ListTodo, AlarmClock, Clock, DollarSign, PhoneCall, Briefcase, CalendarDays, Award, CalendarCheck, FileText, User } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Spinner, ErrorBox, cx } from '../components/ui';
import { usePeriod, Hero, Tile, Delta, Breakdown, Meter, monthTick } from '../components/overview';
import { money, num, date, label } from '../lib/format';

const KIND: Record<string, { icon: React.ElementType; cls: string }> = {
  Task: { icon: ListTodo, cls: 'bg-indigo-50 text-indigo-700' }, Grant: { icon: Award, cls: 'bg-amber-50 text-amber-700' }, Event: { icon: CalendarCheck, cls: 'bg-emerald-50 text-emerald-700' },
  Invoice: { icon: FileText, cls: 'bg-sky-50 text-sky-700' }, 'Client work': { icon: Briefcase, cls: 'bg-violet-50 text-violet-700' },
};
const dayLabel = (d: string) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(`${d}T00:00:00`); const diff = Math.round((x.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff < 0) return `${-diff} ${diff === -1 ? 'day' : 'days'} overdue`;
  return x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export function WorkOverview() {
  const { me } = useSession();
  const per = usePeriod('month');
  const { data: d, error, reload } = useApi<any>(`/overview/work${qs(per.query)}`);
  const billing = me?.tenant?.billing_enabled;
  const maxTeam = Math.max(1, ...(d?.team ?? []).map((u: any) => u.open + u.done));
  return (
    <div className="space-y-5">
      {per.controls()}
      {error ? <ErrorBox error={error} onRetry={reload} /> : !d ? <Spinner label="Gathering work from across the app…" /> : (
        <>
          <Hero eyebrow="Work" title={`Your team’s work in ${per.range.label}`}>
            <Tile icon={CheckCircle2} label="Tasks completed" value={num(d.tasks.done)} delta={<Delta now={d.tasks.done} prev={d.tasks.done_prev} />} to="/work/tasks" />
            <Tile icon={ListTodo} label="Open tasks" value={num(d.tasks.open)} sub={`${num(d.tasks.mine)} assigned to you · ${num(d.tasks.due_week)} due this week`} kind="live" to="/work/tasks" />
            <Tile icon={AlarmClock} label="Overdue" value={num(d.tasks.overdue)} sub={d.tasks.overdue ? 'past their due date' : 'nothing overdue'} kind="live" to="/work/tasks?due=overdue" />
            <Tile icon={Clock} label="Hours logged" value={num(Math.round(d.time.hours * 10) / 10)} sub={`${num(d.time.people)} ${d.time.people === 1 ? 'person' : 'people'}`} delta={<Delta now={d.time.hours} prev={d.time.hours_prev} />} to="/work/time" />
            {billing ? <Tile icon={DollarSign} label="Billable time" value={money(d.time.billable_amount)} sub={`${num(d.time.billable_hours)} billable hours`} to="/work/client-work" />
              : <Tile icon={Briefcase} label="Client work" value={num(d.jobs?.open ?? 0)} sub={`${num(d.jobs?.overdue ?? 0)} overdue`} kind="live" to="/work/client-work" />}
            <Tile icon={PhoneCall} label="Contacts logged" value={num(d.contacts.n)} sub="calls, meetings, emails and notes" delta={<Delta now={d.contacts.n} prev={d.contacts.prev} />} to="/work/communications" />
            <Tile icon={CalendarDays} label="Coming up (3 weeks)" value={num(d.agenda.filter((a: any) => !a.overdue).length)} sub="tasks, grants, events and invoices" kind="live" to="/work/calendar" />
            <Tile icon={User} label="People with work" value={num(d.team.length)} sub="with open tasks or logged time" kind="live" />
          </Hero>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Agenda" subtitle="Everything due soon across tasks, grants, events, invoices and client work." className="xl:col-span-2" padded={false}>
              {!d.agenda.length ? <p className="p-5 text-sm text-slate-500">Nothing due in the next three weeks.</p> : (
                <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">{d.agenda.map((a: any, i: number) => {
                  const k = KIND[a.kind] ?? KIND.Task; const Icon = k.icon;
                  const showDay = i === 0 || d.agenda[i - 1].date !== a.date;
                  return (
                    <li key={i}>
                      {showDay && <div className={cx('bg-slate-50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide', a.overdue ? 'text-red-600' : 'text-slate-500')}>{dayLabel(a.date)}</div>}
                      <Link to={a.link} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
                        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', k.cls)}><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{a.title}</span>{a.sub && <span className="block truncate text-xs text-slate-500">{a.sub}</span>}</span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{a.kind}</span>
                      </Link>
                    </li>
                  );
                })}</ul>
              )}
            </Card>
            <Card title="Team workload" subtitle="Open and completed tasks, and hours this period.">
              {!d.team.length ? <p className="text-sm text-slate-500">No assigned work yet.</p> : (
                <ul className="space-y-3">{d.team.map((u: any) => (
                  <li key={u.id}>
                    <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 font-medium text-slate-800"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white">{u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</span>{u.name}</span>
                      <span className="text-xs text-slate-500">{num(Math.round(u.hours * 10) / 10)} h</span></div>
                    <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-emerald-500" style={{ width: `${(u.done / maxTeam) * 100}%` }} title={`${u.done} completed`} />
                      <div className="bg-brand-500" style={{ width: `${((u.open - u.overdue) / maxTeam) * 100}%` }} title={`${u.open - u.overdue} open`} />
                      <div className="bg-rose-500" style={{ width: `${(u.overdue / maxTeam) * 100}%` }} title={`${u.overdue} overdue`} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{u.done} done · {u.open} open{u.overdue ? ` · ${u.overdue} overdue` : ''}</div>
                  </li>
                ))}</ul>
              )}
              <div className="mt-4 flex gap-3 text-[11px] text-slate-500"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />Done</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-brand-500" />Open</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-500" />Overdue</span></div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Where time went" subtitle="Hours by the kind of work they were logged against.">
              <Breakdown rows={d.timeByArea} format={(v) => `${num(Math.round(v * 10) / 10)} h`} tone="brand" empty="No time logged in this period." />
              {d.timeByWorkspace.length > 1 && <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By workspace</div><Breakdown rows={d.timeByWorkspace} format={(v) => `${num(Math.round(v * 10) / 10)} h`} tone="sky" /></div>}
            </Card>
            <Card title="Contacts logged" subtitle="Calls, meetings, emails and notes in this period.">
              <Breakdown rows={d.contactTypes} format={num} tone="good" labelOf={(r) => label(r.key)} empty="No contacts logged in this period." />
            </Card>
            <Card title="Month by month" subtitle="Hours logged (bars) and tasks completed (line).">
              <div className="h-56"><ResponsiveContainer><ComposedChart data={d.trend} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthTick} />
                <YAxis yAxisId="h" tick={{ fontSize: 11 }} width={32} /><YAxis yAxisId="t" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <Tooltip labelFormatter={(m: any) => monthTick(String(m))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="h" dataKey="hours" name="Hours" fill="#6366f1" radius={[4, 4, 0, 0]} /><Line yAxisId="t" dataKey="done" name="Tasks completed" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart></ResponsiveContainer></div>
            </Card>
          </div>
          {d.tasks.open > 0 && <Card><div className="flex flex-wrap items-center gap-4"><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-800">Task health</div><div className="text-xs text-slate-500">{num(d.tasks.open - d.tasks.overdue)} on track · {num(d.tasks.overdue)} overdue · {num(d.tasks.due_week)} due in the next 7 days</div></div><div className="w-full sm:w-80"><Meter value={d.tasks.open - d.tasks.overdue} max={d.tasks.open} tone={d.tasks.overdue ? 'gold' : 'good'} /></div><span className="text-xs text-slate-400">{date(new Date().toISOString())}</span></div></Card>}
        </>
      )}
    </div>
  );
}
