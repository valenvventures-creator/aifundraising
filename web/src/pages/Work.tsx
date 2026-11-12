/** Work: Tasks · Client Work · Calendar · Communications · Time Log */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, CalendarPlus, Printer, FileText } from 'lucide-react';
import { api, useApi, qs, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, PillTabs, Spinner, Field, Input, Select, Textarea, Table, Pager, Chip, Progress, Checkbox, Modal, useAction, useToast, SearchInput, cx, StateTabs } from '../components/ui';
import { TaskModal, WorkspaceSelect, TeamSelect, useRateTypes, useTeam } from '../components/domain';
import { ResourcePage, RecordModal, type FieldDef } from '../components/ResourcePage';
import { Files } from './DonorProfile';
import { money, money2, num, date, dateTime, label, today, addDays } from '../lib/format';

export function WorkShell() {
  return <><PageHeader title="Work" subtitle="Tasks, client work, calendar, communications and time — in one place."><PillTabs className="mt-4" tabs={[{ to: '/work/overview', label: 'Overview' }, { to: '/work/tasks', label: 'Tasks' }, { to: '/work/client-work', label: 'Client Work' }, { to: '/work/calendar', label: 'Calendar' }, { to: '/work/communications', label: 'Communications' }, { to: '/work/time', label: 'Time Log' }]} /></PageHeader><Outlet /></>;
}

export function Tasks() {
  const [sp, setSp] = useSearchParams(); const q = Object.fromEntries(sp.entries());
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'offset') n.delete('offset'); setSp(n, { replace: true }); };
  const filterQ = { ...q }; delete filterQ.open; delete filterQ.due;
  const { data, reload } = useApi<any>(`/r/tasks${qs({ ...filterQ, limit: 100 })}`);
  const summary = useApi<any>('/work/task-summary');
  const { me, can } = useSession();
  const [edit, setEdit] = useState<{ open: boolean; task?: any }>({ open: false });
  useEffect(() => { if (q.open && data) { const t = data.rows.find((r: any) => r.id === q.open); if (t) setEdit({ open: true, task: t }); else api.get(`/r/tasks/${q.open}`).then((x) => setEdit({ open: true, task: x })).catch(() => {}); } }, [q.open, Boolean(data)]); // eslint-disable-line
  let rows = data?.rows ?? [];
  if (q.due === 'overdue') rows = rows.filter((t: any) => t.due_date && t.due_date < today() && t.status !== 'completed');
  return <div className="space-y-4">
    <div className="grid grid-cols-3 gap-3"><Metric label="Open tasks" value={num(summary.data?.tasks ?? 0)} /><Metric label="Logged hours" value={num(summary.data?.hours ?? 0)} />{me?.tenant?.billing_enabled && <Metric label="Billable amount" value={money(summary.data?.billable ?? 0)} />}</div>
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <SearchInput value={q.q ?? ''} onChange={(v) => set('q', v)} placeholder="Search tasks…" />
        <div className="w-48"><WorkspaceSelect value={q.ministry_id ?? ''} onChange={(v) => set('ministry_id', v)} /></div>
        <Select className="w-36" value={q.status ?? ''} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={[{ value: 'todo', label: 'To Do' }, { value: 'in_progress', label: 'In Progress' }, { value: 'waiting', label: 'Waiting' }, { value: 'completed', label: 'Completed' }]} />
        <div className="w-40"><TeamSelect value={q.assignee_id ?? ''} onChange={(v) => set('assignee_id', v)} placeholder="All assignees" /></div>
        <Checkbox label="Overdue only" checked={q.due === 'overdue'} onChange={(e) => set('due', e.target.checked ? 'overdue' : '')} />
        <div className="ml-auto flex gap-2"><Button size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => download(`/r/tasks/export${qs({ ...filterQ, format: 'xlsx' })}`)}>Task Report</Button>{can('work.write') && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ open: true })}>Add Task</Button>}</div>
      </div>
      {!data ? <Spinner /> : <Table rows={rows} onRowClick={(t) => setEdit({ open: true, task: t })} cols={[
        { key: 'title', label: 'Task', render: (t) => <div><div className={cx('font-medium', t.status === 'completed' && 'text-slate-400 line-through')}>{t.title}</div>{t.donor_name && <Link onClick={(e) => e.stopPropagation()} to={`/donors/${t.donor_id}`} className="text-xs text-brand-600 hover:underline">{t.donor_name}</Link>}</div> },
        { key: 'ministry_name', label: 'Ministry/Organization', render: (t) => t.ministry_name ?? '—' }, { key: 'rate_type_name', label: 'Rate Type', render: (t) => t.rate_type_name ?? '—' },
        { key: 'hours', label: 'Hours', align: 'right', render: (t) => `${num(t.actual_hours)}${t.est_hours ? ` / ${num(t.est_hours)}` : ''}` },
        { key: 'progress', label: 'Progress', render: (t) => <div className="w-24"><div className="text-xs">{t.progress}%</div><Progress value={t.progress} tone={t.status === 'completed' ? 'good' : 'brand'} /></div> },
        { key: 'due_date', label: 'Due', render: (t) => <span className={t.due_date && t.due_date < today() && t.status !== 'completed' ? 'font-medium text-red-600' : ''}>{date(t.due_date)}</span> },
        { key: 'next_step', label: 'Next Step', render: (t) => <span className="text-xs">{t.next_step ?? '—'}</span> },
        { key: 'billable', label: 'Billable', render: (t) => (t.billable ? <Chip value="paid">{t.rate ? money(t.rate * Number(t.actual_hours)) : 'Yes'}</Chip> : '') },
        { key: 'status', label: 'Status', render: (t) => <Chip value={t.status} /> }]} empty="No tasks match." />}
    </Card>
    <TaskModal open={edit.open} onClose={() => { setEdit({ open: false }); if (q.open) set('open', ''); }} task={edit.task} onSaved={() => { reload(); summary.reload(); }} />
  </div>;
}

const JOB_FIELDS: FieldDef[] = [{ key: 'title', label: 'Job', required: true, span: 2 }, { key: 'client_name', label: 'Client / organization' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' },
  { key: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'waiting', 'completed', 'cancelled'], default: 'open' }, { key: 'engagement_type', label: 'Engagement / billing', type: 'select', options: ['hourly', 'fixed_fee', 'retainer'], default: 'hourly' },
  { key: 'assignee_id', label: 'Assignee', type: 'team' }, { key: 'due_date', label: 'Due', type: 'date' }, { key: 'fixed_fee', label: 'Fixed fee', type: 'number' }, { key: 'retainer', label: 'Monthly retainer', type: 'number' }, { key: 'billed', label: 'Billed', type: 'bool' }, { key: 'notes', label: 'Notes', type: 'textarea' }];
export function ClientWork() {
  const s = useApi<any>('/work/jobs-summary'); const [job, setJob] = useState<any>(null);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Open Jobs" value={s.data?.open_jobs ?? '—'} /><Metric label="Due This Week" value={s.data?.due_week ?? '—'} tone="warn" /><Metric label="Overdue" value={s.data?.overdue ?? '—'} tone={s.data?.overdue ? 'bad' : 'default'} /><Metric label="Unbilled" value={money(s.data?.unbilled ?? 0)} /></div>
    <ResourcePage resource="jobs" title="Job" emptyAction="New Job" writePerm="work.write" fields={JOB_FIELDS} onRowClick={(r: any) => setJob(r)}
      extraActions={<Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print/Export List</Button>}
      filters={(q, set) => <><div className="w-44"><WorkspaceSelect value={q.ministry_id ?? ''} onChange={(v) => set('ministry_id', v)} /></div><Select className="w-36" value={q.status ?? ''} onChange={(e) => set('status', e.target.value)} placeholder="Any status" options={['open', 'in_progress', 'waiting', 'completed', 'cancelled']} />
        <div className="w-40"><TeamSelect value={q.assignee_id ?? ''} onChange={(v) => set('assignee_id', v)} placeholder="Any assignee" /></div><Select className="w-36" value={q.engagement_type ?? ''} onChange={(e) => set('engagement_type', e.target.value)} placeholder="Any billing" options={['hourly', 'fixed_fee', 'retainer']} /></>}
      emptyText="Jobs organize client engagements with tasks, deadlines, staff, rates, hours, invoices and files."
      cols={[{ key: 'title', label: 'Job', render: (r: any) => <span className="font-medium">{r.title}</span> }, { key: 'client_name', label: 'Client' }, { key: 'status', label: 'Status', render: (r: any) => <Chip value={r.status} /> }, { key: 'engagement_type', label: 'Billing', render: (r: any) => label(r.engagement_type) },
        { key: 'assignee_name', label: 'Assignee' }, { key: 'due_date', label: 'Due', render: (r: any) => <span className={r.due_date && r.due_date < today() && !['completed', 'cancelled'].includes(r.status) ? 'text-red-600' : ''}>{date(r.due_date)}</span> }, { key: 'hours', label: 'Hours', align: 'right' }, { key: 'open_tasks', label: 'Open tasks', align: 'right' }, { key: 'unbilled_amount', label: 'Unbilled', align: 'right', render: (r: any) => (r.billed ? '—' : money(r.unbilled_amount)) }]} />
    {job && <JobModal job={job} onClose={() => { setJob(null); s.reload(); }} />}
  </div>;
}
function JobModal({ job, onClose }: { job: any; onClose: () => void }) {
  const tasks = useApi<any>(`/r/tasks?job_id=${job.id}`); const time = useApi<any>(`/r/time_entries?job_id=${job.id}`); const comms = useApi<any>(`/r/communications?job_id=${job.id}`);
  const [edit, setEdit] = useState(false); const [task, setTask] = useState(false); const { can } = useSession(); const nav = useNavigate();
  return <Modal open onClose={onClose} title={job.title} size="xl" footer={<>{can('finance.write') && <Button onClick={() => nav('/money/invoices')}>Create invoice</Button>}{can('work.write') && <><Button onClick={() => setTask(true)}>Add task</Button><Button variant="primary" onClick={() => setEdit(true)}>Edit job</Button></>}</>}>
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm"><div><div className="text-xs text-slate-500">Client</div>{job.client_name ?? '—'}</div><div><div className="text-xs text-slate-500">Status</div><Chip value={job.status} /></div><div><div className="text-xs text-slate-500">Hours</div>{job.hours}</div><div><div className="text-xs text-slate-500">Unbilled</div>{money(job.unbilled_amount)}</div></div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Tasks" padded={false}><Table rows={tasks.data?.rows ?? []} cols={[{ key: 'title', label: 'Task' }, { key: 'due_date', label: 'Due', render: (t) => date(t.due_date) }, { key: 'status', label: '', render: (t) => <Chip value={t.status} /> }]} empty="No tasks." /></Card>
      <Card title="Time" padded={false}><Table rows={time.data?.rows ?? []} cols={[{ key: 'entry_date', label: 'Date', render: (t) => date(t.entry_date) }, { key: 'user_name', label: 'Who' }, { key: 'hours', label: 'Hours', align: 'right' }, { key: 'billable', label: 'Billable', render: (t) => (t.billable ? '✓' : '') }]} empty="No time logged." /></Card>
      <Card title="Communications" padded={false}><Table rows={comms.data?.rows ?? []} cols={[{ key: 'occurred_at', label: 'When', render: (c) => date(c.occurred_at) }, { key: 'type', label: 'Type' }, { key: 'subject', label: 'Subject' }]} empty="None." /></Card>
      <Files entityType="job" entityId={job.id} canWrite={can('work.write')} />
    </div>
    <RecordModal open={edit} onClose={() => setEdit(false)} resource="jobs" fields={JOB_FIELDS} record={job} title="Job" onSaved={onClose} />
    <TaskModal open={task} onClose={() => setTask(false)} defaults={{ job_id: job.id, ministry_id: job.ministry_id, title: '' }} onSaved={tasks.reload} />
  </Modal>;
}

// ───────── Calendar ─────────
const TYPE_COLORS: Record<string, string> = { task: 'bg-slate-100 text-slate-700', follow_up: 'bg-amber-100 text-amber-800', meeting: 'bg-sky-100 text-sky-800', trip: 'bg-violet-100 text-violet-800', event: 'bg-emerald-100 text-emerald-800', grant: 'bg-red-100 text-red-800', job: 'bg-indigo-100 text-indigo-800' };
export function CalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [types, setTypes] = useState<string[]>(Object.keys(TYPE_COLORS)); const [user, setUser] = useState(''); const [ministry, setMinistry] = useState('');
  const start = new Date(month); start.setDate(1 - start.getDay()); const end = new Date(start); end.setDate(start.getDate() + 41);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { data } = useApi<any[]>(`/calendar${qs({ from: iso(start), to: iso(end), types: types.join(','), user_id: user, ministry_id: ministry })}`);
  const { me } = useSession(); const { run } = useAction(); const { push } = useToast(); const nav = useNavigate();
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = useMemo(() => { const m: Record<string, any[]> = {}; for (const it of data ?? []) { const k = String(it.start).slice(0, 10); (m[k] ??= []).push(it); } return m; }, [data]);
  const syncVisible = async () => {
    if (!me?.features.google) return push('error', 'Google Calendar is not configured on this server.');
    const items = (data ?? []).filter((i) => String(i.start).slice(0, 10) >= today()).slice(0, 100).map((i) => ({ summary: i.title, start: String(i.start), allDay: Boolean(i.allDay) }));
    if (!items.length) return push('info', 'No upcoming items to add.');
    if (!confirm(`Add ${items.length} upcoming items to your Google Calendar?`)) return;
    const r = await run(() => api.post('/integrations/google/calendar', { items })); if (r) push('success', `Added ${r.created.length} items`);
  };
  return <Card padded={false}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      <Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button><span className="w-36 text-center font-semibold">{month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</span><Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</Button>
      <div className="w-40"><TeamSelect value={user} onChange={setUser} placeholder="Everyone" /></div><div className="w-44"><WorkspaceSelect value={ministry} onChange={setMinistry} /></div>
      <div className="flex flex-wrap gap-1">{Object.keys(TYPE_COLORS).map((t) => <button key={t} onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])} className={cx('rounded-full px-2 py-0.5 text-xs', types.includes(t) ? TYPE_COLORS[t] : 'bg-white text-slate-400 ring-1 ring-slate-200')}>{label(t)}</button>)}</div>
      <Button size="sm" className="ml-auto" icon={<CalendarPlus className="h-4 w-4" />} onClick={syncVisible}>Add upcoming to Google Calendar</Button>
    </div>
    <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-semibold uppercase text-slate-500">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
    <div className="grid grid-cols-7">{days.map((d) => { const k = iso(d); const items = byDay[k] ?? []; const other = d.getMonth() !== month.getMonth();
      return <div key={k} className={cx('min-h-[96px] border-b border-r border-slate-100 p-1', other && 'bg-slate-50/60', k === today() && 'bg-brand-50/50')}><div className={cx('mb-0.5 text-right text-xs', other ? 'text-slate-300' : 'text-slate-500', k === today() && 'font-bold text-brand-700')}>{d.getDate()}</div>
        <div className="space-y-0.5">{items.slice(0, 4).map((it) => <button key={it.id} onClick={() => nav(it.href)} title={it.title} className={cx('block w-full truncate rounded px-1 py-0.5 text-left text-[11px]', TYPE_COLORS[it.type], it.done && 'line-through opacity-60')}>{!it.allDay && it.start?.length > 10 ? `${new Date(it.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ` : ''}{it.title}</button>)}{items.length > 4 && <div className="text-[11px] text-slate-500">+{items.length - 4} more</div>}</div></div>; })}</div>
  </Card>;
}

// ───────── Communications log ─────────
const COMM_FIELDS: FieldDef[] = [{ key: 'type', label: 'Type', type: 'select', required: true, options: ['phone', 'meeting', 'email', 'text', 'video', 'letter', 'note'], default: 'phone' }, { key: 'ministry_id', label: 'Organization/Ministry', type: 'workspace' },
  { key: 'occurred_at', label: 'Date', type: 'datetime' }, { key: 'duration_hours', label: 'Duration (hours)', type: 'number' }, { key: 'rate_type_id', label: 'Rate type', type: 'lookup', lookup: '/r/rate_types?limit=100' }, { key: 'billable', label: 'Billable', type: 'bool' },
  { key: 'subject', label: 'Subject', span: 2 }, { key: 'body', label: 'Notes — what was discussed', type: 'textarea' }, { key: 'job_id', label: 'Job', type: 'lookup', lookup: '/r/jobs?limit=200' }, { key: 'grant_id', label: 'Grant', type: 'lookup', lookup: '/r/grants?limit=200' }];
export function Communications() {
  const [att, setAtt] = useState<any>(null);
  return <><ResourcePage resource="communications" title="Communication" emptyAction="Log Communication" writePerm="work.write" fields={COMM_FIELDS} defaults={{ occurred_at: new Date().toISOString() }}
    filters={(q, set) => <><div className="w-48"><WorkspaceSelect value={q.ministry_id ?? ''} onChange={(v) => set('ministry_id', v)} /></div><Select className="w-36" value={q.type ?? ''} onChange={(e) => set('type', e.target.value)} placeholder="All types" options={['phone', 'meeting', 'email', 'text', 'video', 'letter', 'note']} /></>}
    cols={[{ key: 'type', label: 'Type', render: (c: any) => <Chip>{label(c.type)}</Chip> }, { key: 'ministry_name', label: 'Organization/Ministry' }, { key: 'occurred_at', label: 'Date', sortable: true, render: (c: any) => dateTime(c.occurred_at) }, { key: 'duration_hours', label: 'Duration', align: 'right', render: (c: any) => (c.duration_hours ? `${c.duration_hours}h` : '—') },
      { key: 'rate_type_name', label: 'Rate Type' }, { key: 'body', label: 'Notes', render: (c: any) => <div className="max-w-md"><div className="font-medium">{c.subject}</div><div className="truncate text-xs text-slate-500">{c.body}</div>{c.donor_name && <Link onClick={(e) => e.stopPropagation()} className="text-xs text-brand-600" to={`/donors/${c.donor_id}`}>{c.donor_name}</Link>}</div> },
      { key: 'billable', label: 'Billable', render: (c: any) => (c.billable ? '✓' : '') }, { key: 'attachment_count', label: 'Attachments', render: (c: any) => <button className="text-xs text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); setAtt(c); }}>{c.attachment_count || 'Add'}</button> }]} />
    {att && <Modal open onClose={() => setAtt(null)} title="Attachments — email copies, documents"><Files entityType="communication" entityId={att.id} canWrite /></Modal>}</>;
}

// ───────── Time log ─────────
export function TimeLog() {
  const [week, setWeek] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); });
  const end = addDays(week, 6);
  const sum = useApi<any>(`/work/time-summary?from=${week}&to=${end}`);
  const { data, reload } = useApi<any>(`/r/time_entries?from=${week}&to=${end}&limit=500`);
  const [add, setAdd] = useState(false); const { can } = useSession();
  return <div className="space-y-4">
    <div className="flex items-center gap-2"><Button size="sm" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="h-4 w-4" /></Button><span className="font-semibold">{date(week)} – {date(end)}</span><Button size="sm" onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="h-4 w-4" /></Button>{can('work.write') && <Button variant="primary" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>Add Time Entry</Button>}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Your Hours" value={num(sum.data?.your_hours ?? 0)} /><Metric label="Staff Hours" value={num(sum.data?.staff_hours ?? 0)} /><Metric label="Logged Activities" value={num(sum.data?.activities ?? 0)} /><Metric label="Billable Amount" value={money(sum.data?.billable_amount ?? 0)} /></div>
    <Card padded={false}>{!data?.rows.length ? <div className="py-12 text-center"><p className="text-sm text-slate-500">No time logged this week.</p>{can('work.write') && <Button className="mt-3" variant="primary" onClick={() => setAdd(true)}>Add Time Entry</Button>}</div> :
      <Table rows={data.rows} cols={[{ key: 'entry_date', label: 'Date', render: (t) => date(t.entry_date) }, { key: 'user_name', label: 'Staff' }, { key: 'hours', label: 'Hours', align: 'right' }, { key: 'description', label: 'Description' }, { key: 'link', label: 'For', render: (t) => t.task_title ?? t.job_title ?? t.ministry_name ?? t.category ?? '—' }, { key: 'rate_type_name', label: 'Rate type' }, { key: 'billable', label: 'Billable', align: 'right', render: (t) => (t.billable ? money2(Number(t.hours) * Number(t.rate ?? 0)) : '') }]} />}</Card>
    <RecordModal open={add} onClose={() => setAdd(false)} resource="time_entries" title="Time entry" onSaved={() => { reload(); sum.reload(); }} defaults={{ entry_date: today() }}
      fields={[{ key: 'entry_date', label: 'Date', type: 'date', required: true }, { key: 'hours', label: 'Hours', type: 'number', required: true }, { key: 'description', label: 'Description', span: 2 }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }, { key: 'category', label: 'Category', type: 'select', options: ['administrative', 'fundraising', 'program', 'grants', 'client'] },
        { key: 'task_id', label: 'Task', type: 'lookup', lookup: '/r/tasks?limit=300' }, { key: 'job_id', label: 'Job', type: 'lookup', lookup: '/r/jobs?limit=200' }, { key: 'project_id', label: 'Project', type: 'lookup', lookup: '/r/projects?limit=200' }, { key: 'grant_id', label: 'Grant', type: 'lookup', lookup: '/r/grants?limit=200' },
        { key: 'rate_type_id', label: 'Rate type', type: 'lookup', lookup: '/r/rate_types?limit=100' }, { key: 'billable', label: 'Billable', type: 'bool' }]} />
  </div>;
}
export const _w = { Field, Input, Textarea, StateTabs, useRateTypes, useTeam, Pager };
