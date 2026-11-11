/** Grants, Projects, Events & Registration. */
import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Sparkles, ExternalLink, Download, Copy } from 'lucide-react';
import { api, useApi, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, Spinner, Table, Chip, Progress, StateTabs, Select, useAction, useToast, Notice, Empty } from '../components/ui';
import { ResourcePage, RecordModal, type FieldDef } from '../components/ResourcePage';
import { DraftModal, TaskModal } from '../components/domain';
import { Files } from './DonorProfile';
import { money, num, date, dateTime, label } from '../lib/format';

// ───────── Grants ─────────
export const GRANT_STATUSES = ['researching', 'qualified', 'preparing', 'submitted', 'under_review', 'awarded', 'declined', 'reporting', 'closed'];
const GRANT_FIELDS: FieldDef[] = [
  { key: 'title', label: 'Grant / opportunity', required: true, span: 2 }, { key: 'funder_id', label: 'Funder', type: 'lookup', lookup: '/r/funders?limit=500' },
  { key: 'status', label: 'Status', type: 'select', options: GRANT_STATUSES, default: 'researching' }, { key: 'request_amount', label: 'Request amount', type: 'number' }, { key: 'awarded_amount', label: 'Awarded amount', type: 'number' },
  { key: 'deadline', label: 'Deadline', type: 'date' }, { key: 'submitted_on', label: 'Submitted on', type: 'date' }, { key: 'decision_on', label: 'Decision on', type: 'date' }, { key: 'report_due', label: 'Report due', type: 'date' },
  { key: 'assignee_id', label: 'Assigned staff', type: 'team' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }, { key: 'project_id', label: 'Project', type: 'lookup', lookup: '/r/projects?limit=500' }, { key: 'fund_id', label: 'Fund', type: 'fund' },
  { key: 'requirements', label: 'Reporting requirements', type: 'textarea' }, { key: 'notes', label: 'Notes', type: 'textarea' }];

export function Grants() {
  const [sp, setSp] = useSearchParams(); const tab = (sp.get('tab') ?? 'pipeline') as 'pipeline' | 'list' | 'funders';
  const nav = useNavigate();
  return (
    <div className="space-y-4">
      <StateTabs value={tab} onChange={(v) => setSp({ tab: v })} tabs={[{ value: 'pipeline', label: 'Pipeline' }, { value: 'list', label: 'All grants' }, { value: 'funders', label: 'Funders' }]} />
      {tab === 'pipeline' && <GrantPipeline />}
      {tab === 'list' && <ResourcePage resource="grants" title="Grant opportunity" emptyAction="Add Grant Opportunity" writePerm="grants.write" fields={GRANT_FIELDS} onRowClick={(r: any) => nav(`/donors/grants/${r.id}`)}
        emptyText="Track private and government grants from research through reporting. Deadlines feed your calendar, dashboard and reminders."
        filters={(q, set) => <Select className="w-40" value={q.status ?? ''} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={GRANT_STATUSES} />}
        cols={[{ key: 'title', label: 'Grant', sortable: true, render: (r: any) => <span className="font-medium">{r.title}</span> }, { key: 'funder_name', label: 'Funder' }, { key: 'status', label: 'Status', render: (r: any) => <Chip value={r.status} /> },
          { key: 'request_amount', label: 'Requested', align: 'right', sortable: true, render: (r: any) => (r.request_amount ? money(r.request_amount) : '—') }, { key: 'awarded_amount', label: 'Awarded', align: 'right', render: (r: any) => (r.awarded_amount ? money(r.awarded_amount) : '—') },
          { key: 'deadline', label: 'Deadline', sortable: true, render: (r: any) => date(r.deadline) }, { key: 'assignee_name', label: 'Assigned' }]} />}
      {tab === 'funders' && <ResourcePage resource="funders" title="Funder" writePerm="grants.write"
        fields={[{ key: 'name', label: 'Funder', required: true, span: 2 }, { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'website', label: 'Website' }, { key: 'focus_areas', label: 'Focus areas', span: 2 }, { key: 'notes', label: 'Notes', type: 'textarea' }]}
        cols={[{ key: 'name', label: 'Funder', sortable: true, render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: 'contact_name', label: 'Contact' }, { key: 'email', label: 'Email' }, { key: 'focus_areas', label: 'Focus' }, { key: 'grant_count', label: 'Grants', align: 'right' }, { key: 'awarded_total', label: 'Awarded', align: 'right', render: (r: any) => money(r.awarded_total) }]} />}
    </div>
  );
}
function GrantPipeline() {
  const { data, reload } = useApi<any>('/r/grants?limit=500');
  const { can } = useSession(); const nav = useNavigate(); const { run } = useAction();
  const [add, setAdd] = useState(false);
  if (!data) return <Spinner />;
  const by = (s: string) => data.rows.filter((g: any) => g.status === s);
  const active = data.rows.filter((g: any) => !['declined', 'closed'].includes(g.status));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open opportunities" value={active.length} /><Metric label="Requested (open)" value={money(active.reduce((a: number, g: any) => a + Number(g.request_amount ?? 0), 0))} />
        <Metric label="Awarded" value={money(data.rows.reduce((a: number, g: any) => a + Number(g.awarded_amount ?? 0), 0))} tone="good" />
        <Metric label="Due in 30 days" value={data.rows.filter((g: any) => g.deadline && new Date(g.deadline).getTime() - Date.now() < 30 * 86400000 && new Date(g.deadline).getTime() > Date.now()).length} tone="warn" />
      </div>
      <div className="flex justify-end">{can('grants.write') && <Button variant="primary" onClick={() => setAdd(true)}>Add Grant Opportunity</Button>}</div>
      {!data.rows.length ? <Empty title="No grants yet" action={can('grants.write') && <Button variant="primary" onClick={() => setAdd(true)}>Add Grant Opportunity</Button>}>Track opportunities from research to reporting.</Empty> :
        <div className="flex gap-3 overflow-x-auto pb-2">
          {GRANT_STATUSES.map((s) => (
            <div key={s} className="w-64 shrink-0 rounded-2xl bg-slate-100 p-2" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { const gid = e.dataTransfer.getData('grant'); if (gid && can('grants.write') && await run(() => api.patch(`/r/grants/${gid}`, { status: s }), `Moved to ${label(s)}`)) reload(); }}>
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase text-slate-500">{label(s)}<span>{by(s).length}</span></div>
              <div className="space-y-2">{by(s).map((g: any) => (
                <div key={g.id} draggable={can('grants.write')} onDragStart={(e) => e.dataTransfer.setData('grant', g.id)} onClick={() => nav(`/donors/grants/${g.id}`)} className="cursor-pointer rounded-xl bg-white p-3 shadow-sm hover:ring-2 hover:ring-brand-200">
                  <div className="text-sm font-medium">{g.title}</div><div className="text-xs text-slate-500">{g.funder_name ?? '—'}</div>
                  <div className="mt-2 flex justify-between text-xs"><span>{g.request_amount ? money(g.request_amount) : '—'}</span><span className={g.deadline && g.deadline < new Date().toISOString().slice(0, 10) ? 'text-red-600' : 'text-slate-500'}>{date(g.deadline)}</span></div>
                </div>))}</div>
            </div>))}
        </div>}
      <RecordModal open={add} onClose={() => setAdd(false)} resource="grants" fields={GRANT_FIELDS} title="Grant opportunity" onSaved={reload} />
    </>
  );
}
export function GrantDetail() {
  const { id } = useParams();
  const { data: g, reload } = useApi<any>(`/r/grants/${id}`);
  const tasks = useApi<any>(`/r/tasks?grant_id=${id}`);
  const comms = useApi<any>(`/r/communications?grant_id=${id}`);
  const [edit, setEdit] = useState(false); const [draft, setDraft] = useState(false); const [task, setTask] = useState(false);
  const { can } = useSession();
  if (!g) return <Spinner />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to="/donors/grants" className="text-xs text-brand-600 hover:underline">← Grants</Link><h2 className="text-xl font-bold">{g.title}</h2><p className="text-sm text-slate-500">{g.funder_name ?? 'No funder'} · {g.ministry_name ?? 'Organization-wide'}</p></div>
      <div className="flex gap-2">{can('ai.ask') && <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setDraft(true)}>Draft narrative</Button>}{can('work.write') && <Button onClick={() => setTask(true)}>Add task</Button>}{can('grants.write') && <Button variant="primary" onClick={() => setEdit(true)}>Edit</Button>}</div></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Metric label="Status" value={<Chip value={g.status} />} /><Metric label="Requested" value={money(g.request_amount)} /><Metric label="Awarded" value={g.awarded_amount ? money(g.awarded_amount) : '—'} tone="good" /><Metric label="Deadline" value={date(g.deadline)} /><Metric label="Report due" value={date(g.report_due)} /></div>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Details"><dl className="space-y-2 text-sm"><Row l="Assigned" v={g.assignee_name} /><Row l="Project" v={g.project_name} /><Row l="Fund" v={g.fund_name} /><Row l="Submitted" v={date(g.submitted_on)} /><Row l="Decision" v={date(g.decision_on)} /><Row l="Requirements" v={g.requirements} /><Row l="Notes" v={g.notes} /></dl></Card>
      <Card title="Tasks" padded={false}><Table rows={tasks.data?.rows ?? []} cols={[{ key: 'title', label: 'Task' }, { key: 'due_date', label: 'Due', render: (t) => date(t.due_date) }, { key: 'status', label: 'Status', render: (t) => <Chip value={t.status} /> }]} empty="No tasks." /></Card>
      <Card title="Communications" padded={false}><Table rows={comms.data?.rows ?? []} cols={[{ key: 'occurred_at', label: 'When', render: (c) => date(c.occurred_at) }, { key: 'type', label: 'Type' }, { key: 'subject', label: 'Subject' }]} empty="None logged." /></Card>
      <Files entityType="grant" entityId={g.id} canWrite={can('grants.write')} />
    </div>
    <RecordModal open={edit} onClose={() => setEdit(false)} resource="grants" fields={GRANT_FIELDS} record={g} title="Grant" onSaved={reload} />
    <DraftModal open={draft} onClose={() => setDraft(false)} kind="grant_narrative" ministryId={g.ministry_id} context={`Grant: ${g.title} for ${g.funder_name ?? 'a funder'}, requesting ${g.request_amount}. Requirements: ${g.requirements ?? 'n/a'}`} title="Grant narrative draft" />
    <TaskModal open={task} onClose={() => setTask(false)} defaults={{ grant_id: g.id, ministry_id: g.ministry_id, title: `Grant: ${g.title}`, due_date: g.deadline, category: 'Grants' }} onSaved={tasks.reload} />
  </div>;
}
function Row({ l, v }: { l: string; v: any }) { return <div className="grid grid-cols-3 gap-2"><dt className="text-slate-500">{l}</dt><dd className="col-span-2 whitespace-pre-line">{v || '—'}</dd></div>; }

// ───────── Projects ─────────
const PROJECT_FIELDS: FieldDef[] = [{ key: 'name', label: 'Project name', required: true, span: 2 }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }, { key: 'status', label: 'Status', type: 'select', options: ['planning', 'active', 'on_hold', 'completed', 'archived'], default: 'active' },
  { key: 'goal', label: 'Fundraising goal', type: 'number' }, { key: 'budget', label: 'Budget', type: 'number' }, { key: 'fund_id', label: 'Fund / designation', type: 'fund' }, { key: 'campaign_id', label: 'Campaign', type: 'lookup', lookup: '/r/campaigns?limit=500' },
  { key: 'owner_user_id', label: 'Project owner', type: 'team' }, { key: 'starts_on', label: 'Start', type: 'date' }, { key: 'ends_on', label: 'End', type: 'date' }, { key: 'description', label: 'Description', type: 'textarea' }];
export function Projects() {
  const nav = useNavigate();
  return <ResourcePage resource="projects" title="Project" writePerm="projects.write" fields={PROJECT_FIELDS} onRowClick={(r: any) => nav(`/donors/projects/${r.id}`)} emptyText="Projects connect fundraising goals, gifts, spending, grants and impact metrics."
    cols={[{ key: 'name', label: 'Project', sortable: true, render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: 'status', label: 'Status', render: (r: any) => <Chip value={r.status === 'active' ? 'open' : r.status}>{label(r.status)}</Chip> },
      { key: 'raised', label: 'Raised / goal', render: (r: any) => <div className="w-40"><div className="text-xs">{money(r.raised)}{r.goal ? ` / ${money(r.goal)}` : ''}</div>{r.goal && <Progress value={r.raised} max={r.goal} />}</div> },
      { key: 'spent', label: 'Spent / budget', render: (r: any) => <div className="w-40"><div className="text-xs">{money(r.spent)}{r.budget ? ` / ${money(r.budget)}` : ''}</div>{r.budget && <Progress value={r.spent} max={r.budget} tone={r.spent > r.budget ? 'bad' : 'good'} />}</div> },
      { key: 'fund_name', label: 'Fund', render: (r: any) => r.fund_name ? <span className="flex items-center gap-1">{r.fund_name}<Chip value={r.fund_restriction} /></span> : '—' }, { key: 'owner_name', label: 'Owner' }, { key: 'ministry_name', label: 'Workspace' }]} />;
}
export function ProjectDetail() {
  const { id } = useParams();
  const { data: p, reload } = useApi<any>(`/r/projects/${id}`);
  const gifts = useApi<any>(`/giving/gifts?project_id=${id}&limit=100`);
  const grants = useApi<any>(`/r/grants?project_id=${id}`);
  const tasks = useApi<any>(`/r/tasks?project_id=${id}`);
  const metrics = useApi<any>(`/r/impact_metrics?project_id=${id}`);
  const { can } = useSession(); const [edit, setEdit] = useState(false);
  const spend = useApi<any>(can('finance.read') ? `/money/journals?project_id=${id}&limit=50` : null);
  if (!p) return <Spinner />;
  return <div className="space-y-5">
    <div className="flex items-start justify-between"><div><Link to="/donors/projects" className="text-xs text-brand-600 hover:underline">← Projects</Link><h2 className="text-xl font-bold">{p.name}</h2><p className="text-sm text-slate-500">{p.description}</p></div>{can('projects.write') && <Button variant="primary" onClick={() => setEdit(true)}>Edit</Button>}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Metric label="Raised" value={money(p.raised)} tone="good" sub={p.goal ? `of ${money(p.goal)}` : undefined} /><Metric label="Spent" value={money(p.spent)} sub={p.budget ? `of ${money(p.budget)} budget` : undefined} tone={p.budget && p.spent > p.budget ? 'bad' : 'default'} /><Metric label="Fund" value={p.fund_name ?? '—'} /><Metric label="Owner" value={p.owner_name ?? '—'} /><Metric label="Dates" value={<span className="text-sm">{date(p.starts_on)} – {date(p.ends_on)}</span>} /></div>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Donations" padded={false}><Table rows={gifts.data?.rows ?? []} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'donor_name', label: 'Donor', render: (g) => <Link to={`/donors/${g.donor_id}`} className="hover:underline">{g.donor_name}</Link> }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money(g.amount, 2) }]} empty="No gifts tagged to this project." /></Card>
      {can('finance.read') && <Card title="Spending (ledger)" padded={false}><Table rows={(spend.data?.rows ?? []).filter((e: any) => e.source !== 'gift')} cols={[{ key: 'entry_date', label: 'Date', render: (e) => date(e.entry_date) }, { key: 'memo', label: 'Memo' }, { key: 'amount', label: 'Amount', align: 'right', render: (e) => money(e.amount, 2) }]} empty="No spending posted." /></Card>}
      <Card title="Grants" padded={false}><Table rows={grants.data?.rows ?? []} cols={[{ key: 'title', label: 'Grant', render: (g) => <Link to={`/donors/grants/${g.id}`} className="hover:underline">{g.title}</Link> }, { key: 'status', label: 'Status', render: (g) => <Chip value={g.status} /> }, { key: 'awarded_amount', label: 'Awarded', align: 'right', render: (g) => money(g.awarded_amount) }]} empty="No related grants." /></Card>
      <Card title="Impact metrics" padded={false}><Table rows={metrics.data?.rows ?? []} cols={[{ key: 'name', label: 'Metric' }, { key: 'actual', label: 'Actual / target', render: (m) => `${num(m.actual)}${m.target ? ` / ${num(m.target)}` : ''} ${m.unit ?? ''}` }]} empty="No impact metrics yet." /></Card>
      <Card title="Tasks" padded={false}><Table rows={tasks.data?.rows ?? []} cols={[{ key: 'title', label: 'Task' }, { key: 'due_date', label: 'Due', render: (t) => date(t.due_date) }, { key: 'status', label: 'Status', render: (t) => <Chip value={t.status} /> }]} empty="No tasks." /></Card>
      <Files entityType="project" entityId={p.id} canWrite={can('projects.write')} />
    </div>
    <RecordModal open={edit} onClose={() => setEdit(false)} resource="projects" fields={PROJECT_FIELDS} record={p} title="Project" onSaved={reload} />
  </div>;
}

// ───────── Events ─────────
const EVENT_FIELDS: FieldDef[] = [{ key: 'name', label: 'Event name', required: true, span: 2 }, { key: 'event_type', label: 'Type', type: 'select', options: ['conference', 'seminar', 'webinar', 'gathering', 'fundraiser', 'other'], default: 'gathering' },
  { key: 'status', label: 'Status', type: 'select', options: ['draft', 'published', 'closed', 'cancelled'], default: 'published' }, { key: 'starts_at', label: 'Starts', type: 'datetime', required: true }, { key: 'ends_at', label: 'Ends', type: 'datetime' },
  { key: 'location', label: 'Location / link', span: 2 }, { key: 'capacity', label: 'Capacity', type: 'number' }, { key: 'campaign_id', label: 'Campaign', type: 'lookup', lookup: '/r/campaigns?limit=500' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' },
  { key: 'is_public', label: 'Public registration page', type: 'bool', default: true }, { key: 'description', label: 'Description (shown on registration page)', type: 'textarea' }];
export function Events() {
  const nav = useNavigate();
  return <ResourcePage resource="events" title="Event" emptyAction="New Event" writePerm="events.write" fields={EVENT_FIELDS} onRowClick={(r: any) => nav(`/donors/events/${r.id}`)}
    emptyText="Create conferences, seminars, webinars, donor gatherings or fundraisers. Each event gets a public registration page, and registrants flow straight into your donor database."
    cols={[{ key: 'name', label: 'Event', sortable: true, render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: 'event_type', label: 'Type', render: (r: any) => label(r.event_type) }, { key: 'starts_at', label: 'When', sortable: true, render: (r: any) => dateTime(r.starts_at) },
      { key: 'registered', label: 'Registered', align: 'right', render: (r: any) => `${r.registered}${r.capacity ? ` / ${r.capacity}` : ''}` }, { key: 'attended', label: 'Attended', align: 'right' }, { key: 'status', label: 'Status', render: (r: any) => <Chip value={r.status === 'published' ? 'open' : r.status}>{r.status}</Chip> }]} />;
}
export function EventDetail() {
  const { id } = useParams();
  const { data: e, reload } = useApi<any>(`/r/events/${id}`);
  const regs = useApi<any>(`/r/registrations?event_id=${id}&limit=500`);
  const { can } = useSession(); const { run } = useAction(); const { push } = useToast();
  const [edit, setEdit] = useState(false); const [add, setAdd] = useState(false); const [draft, setDraft] = useState(false);
  if (!e) return <Spinner />;
  const link = `${window.location.origin}/e/${e.slug}`;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to="/donors/events" className="text-xs text-brand-600 hover:underline">← Events</Link><h2 className="text-xl font-bold">{e.name}</h2><p className="text-sm text-slate-500">{dateTime(e.starts_at)} · {e.location ?? 'TBD'}</p></div>
      <div className="flex flex-wrap gap-2">
        {e.is_public && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"><ExternalLink className="h-4 w-4" />Registration page preview</a>}
        {e.is_public && <Button icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(link); push('success', 'Registration link copied'); }}>Copy link</Button>}
        {can('data.export') && <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/reach/events/${e.id}/attendees/export?format=csv`)}>Export attendees</Button>}
        {can('ai.ask') && <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setDraft(true)}>Draft invitation</Button>}
        {can('events.write') && <Button variant="primary" onClick={() => setEdit(true)}>Edit</Button>}
      </div></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Registered" value={e.registered} sub={e.capacity ? `capacity ${e.capacity}` : undefined} /><Metric label="Attended" value={e.attended} tone="good" /><Metric label="No-shows" value={e.no_shows} tone="warn" /><Metric label="Status" value={<Chip value={e.status} />} /></div>
    <Card padded={false} title="Registrations" actions={can('events.write') && <><Button size="sm" onClick={() => setAdd(true)}>Add registration</Button>
      <Button size="sm" onClick={async () => { const r = await run(() => api.post(`/reach/events/${e.id}/follow-up-tasks`, { status: 'attended' })); if (r) push('success', `${r.created} follow-up tasks for attendees`); regs.reload(); }}>Follow up attendees</Button>
      <Button size="sm" onClick={async () => { const r = await run(() => api.post(`/reach/events/${e.id}/follow-up-tasks`, { status: 'no_show' })); if (r) push('success', `${r.created} follow-up tasks for no-shows`); regs.reload(); }}>Follow up no-shows</Button></>}>
      <Table rows={regs.data?.rows ?? []} cols={[{ key: 'name', label: 'Name', render: (r) => r.donor_id ? <Link to={`/donors/${r.donor_id}`} className="font-medium hover:underline">{r.name}</Link> : r.name }, { key: 'email', label: 'Email' }, { key: 'guests', label: 'Guests', align: 'right' }, { key: 'registered_at', label: 'Registered', render: (r) => date(r.registered_at) },
        { key: 'status', label: 'Attendance', render: (r) => can('events.write') ? <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={r.status} onChange={async (ev) => { await api.patch(`/r/registrations/${r.id}`, { status: ev.target.value }); regs.reload(); reload(); }}>{['registered', 'attended', 'no_show', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> : <Chip value={r.status} /> },
        { key: 'followed_up', label: 'Followed up', render: (r) => (r.followed_up ? '✓' : '') }]} empty="No registrations yet — share the registration link." />
    </Card>
    <RecordModal open={edit} onClose={() => setEdit(false)} resource="events" fields={EVENT_FIELDS} record={e} title="Event" onSaved={reload} />
    <RecordModal open={add} onClose={() => setAdd(false)} resource="registrations" title="Registration" defaults={{ event_id: e.id }} onSaved={() => { regs.reload(); reload(); }}
      fields={[{ key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'guests', label: 'Guests', type: 'number' }, { key: 'event_id', label: 'Event', type: 'lookup', lookup: '/r/events?limit=200', required: true }]} />
    <DraftModal open={draft} onClose={() => setDraft(false)} kind="event_invitation" ministryId={e.ministry_id} context={`Event: ${e.name}, ${dateTime(e.starts_at)} at ${e.location ?? 'TBD'}. Registration link: ${link}`} title="Event invitation draft" />
  </div>;
}
export const _e = { Notice };
