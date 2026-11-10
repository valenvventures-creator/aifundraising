/** Growth · Impact · Messages · Admin & Access · Ask A.I. Nonprofits */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Send, Sparkles, Plus, Database, UserPlus, Copy, ShieldCheck } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, Spinner, Field, Input, Select, Textarea, Table, Chip, Progress, Empty, Notice, Modal, Checkbox, useAction, useToast, StateTabs, AiBadge, cx } from '../components/ui';
import { ResourcePage, RecordModal } from '../components/ResourcePage';
import { WorkspaceSelect, DraftModal, useTeam } from '../components/domain';
import { money, num, date, dateTime, label, ago, pct } from '../lib/format';

// ───────── Growth ─────────
export function Growth() {
  const [ministry, setMinistry] = useState('');
  const { data } = useApi<any>(`/growth${ministry ? `?ministry_id=${ministry}` : ''}`);
  const { can } = useSession(); const [goal, setGoal] = useState(false);
  return <>
    <PageHeader title="Growth" subtitle="Strategy layer over your donor data: acquisition, retention, recurring giving, major-donor pipeline and goals." actions={<div className="w-56"><WorkspaceSelect value={ministry} onChange={setMinistry} /></div>} />
    {!data ? <Spinner /> : <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{(() => { const y = data.years[0] ?? {}; const p = data.years[1] ?? {}; return <>
        <Metric label="Giving this year" value={money(y.total ?? 0)} sub={p.total ? `${money(p.total)} last year` : undefined} tone="brand" to="/donors/giving/reports" />
        <Metric label="New donors" value={num(y.new_donors ?? 0)} sub={`${p.new_donors ?? 0} last year`} to="/donors/giving/donors?sort=created_at" />
        <Metric label="Retention" value={y.retention_rate != null ? pct(y.retention_rate) : '—'} tone={y.retention_rate < 45 ? 'warn' : 'good'} to="/donors/giving/audit" />
        <Metric label="Major donors" value={num(y.major_donors ?? 0)} to="/donors/giving/donors?min_lifetime=5000" />
        <Metric label="Avg / donor" value={money(y.avg_gift_per_donor ?? 0)} /></>; })()}</div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Goals" className="xl:col-span-1" actions={can('settings.manage') && <Button size="sm" onClick={() => setGoal(true)}>Add goal</Button>}>
          {!data.goals.length ? <p className="text-sm text-slate-500">No goals set.</p> : <div className="space-y-4">{data.goals.map((g: any) => <div key={g.id}><div className="flex justify-between text-sm"><span className="font-medium">{g.name}</span><span>{g.metric === 'giving_total' ? money(g.actual) : g.metric === 'retention_rate' ? pct(g.actual) : num(g.actual)} / {g.metric === 'giving_total' ? money(g.target) : num(g.target)}</span></div><Progress value={g.pct ?? 0} tone={(g.pct ?? 0) >= 100 ? 'good' : 'brand'} /><div className="text-xs text-slate-500">{date(g.period_start)} – {date(g.period_end)} · {g.pct ?? 0}%</div></div>)}</div>}
        </Card>
        <Card title="Donors & retention by year" className="xl:col-span-2"><div className="h-64"><ResponsiveContainer><BarChart data={[...data.years].reverse()}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="yr" /><YAxis /><Tooltip /><Legend /><Bar dataKey="donors" fill="#6366f1" name="Donors" /><Bar dataKey="new_donors" fill="#10b981" name="New" /><Bar dataKey="retained" fill="#f59e0b" name="Retained" /></BarChart></ResponsiveContainer></div></Card>
        <Card title="Recommended priorities" subtitle={data.recommendationsNote}>{data.recommendations.length ? <ul className="list-disc space-y-1.5 pl-5 text-sm">{data.recommendations.map((r: string) => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-slate-500">You're on track.</p>}<Link to="/donors/giving/priorities" className="mt-3 inline-block text-sm text-brand-600 hover:underline">Open fundraising priorities →</Link></Card>
        <Card title="Major-donor & opportunity pipeline" padded={false}><Table rowKey="category" rows={data.pipeline} cols={[{ key: 'category', label: 'Stage / category' }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'potential', label: 'Potential (est.)', align: 'right', render: (r) => money(r.potential) }]} /></Card>
        <Card title="Acquisition sources (12 months)" padded={false}><Table rowKey="source" rows={data.acquisition} cols={[{ key: 'source', label: 'Source' }, { key: 'donors', label: 'New donors', align: 'right' }]} empty="No new donors in 12 months." /></Card>
        <Card title="Recurring giving starts" className="xl:col-span-2"><div className="h-48"><ResponsiveContainer><BarChart data={data.recurringTrend}><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="started" fill="#0ea5e9" name="New recurring gifts" /></BarChart></ResponsiveContainer></div></Card>
        <Card title="Donor health"><div className="space-y-2">{data.health.map((h: any) => <Link key={h.health_status} to={`/donors/giving/donors?health=${h.health_status}`} className="flex items-center justify-between"><Chip value={h.health_status} /><span className="text-sm">{num(h.n)}</span></Link>)}</div></Card>
      </div>
    </div>}
    <RecordModal open={goal} onClose={() => setGoal(false)} resource="growth_goals" title="Goal" onSaved={() => window.location.reload()} fields={[{ key: 'name', label: 'Goal', required: true, span: 2 }, { key: 'metric', label: 'Metric', type: 'select', required: true, options: ['giving_total', 'new_donors', 'retention_rate', 'recurring_donors', 'major_donors'] }, { key: 'target', label: 'Target', type: 'number', required: true }, { key: 'period_start', label: 'Start', type: 'date', required: true }, { key: 'period_end', label: 'End', type: 'date', required: true }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }]} />
  </>;
}

// ───────── Impact ─────────
export function Impact() {
  const [tab, setTab] = useState<'overview' | 'metrics' | 'stories'>('overview');
  const { data } = useApi<any>('/impact/summary'); const { can } = useSession();
  const [entry, setEntry] = useState<any>(null); const [report, setReport] = useState(false);
  return <>
    <PageHeader title="Impact" subtitle="Connect dollars raised and spent with programs, outcomes and stories." actions={can('ai.ask') && <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setReport(true)}>Draft impact report</Button>}>
      <div className="mt-4"><StateTabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Programs & outcomes' }, { value: 'metrics', label: 'Metrics' }, { value: 'stories', label: 'Stories' }]} /></div></PageHeader>
    {tab === 'overview' && (!data ? <Spinner /> : !data.projects.length ? <Empty title="No programs yet">Create projects under Donors › Projects, then add impact metrics and stories.</Empty> :
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{data.projects.map((p: any) => <Card key={p.id} title={<Link to={`/donors/projects/${p.id}`} className="hover:underline">{p.name}</Link>} subtitle={p.fund_name ? `Fund: ${p.fund_name}` : undefined}>
        <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">Raised</div><div className="font-bold">{money(p.raised)}</div></div><div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">Spent</div><div className="font-bold">{money(p.spent)}</div></div><div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-500">Beneficiaries</div><div className="font-bold">{num(p.beneficiaries)}</div></div></div>
        <div className="mt-3 space-y-2">{(p.metrics ?? []).map((m: any) => <div key={m.name}><div className="flex justify-between text-sm"><span>{m.name}</span><span>{num(m.actual)}{m.target ? ` / ${num(m.target)}` : ''} {m.unit}{Number(m.actual) > 0 && p.spent > 0 ? <span className="text-xs text-slate-500"> · {money(p.spent / Number(m.actual))} per {m.unit ?? 'unit'}</span> : null}</span></div>{m.target && <Progress value={Number(m.actual)} max={Number(m.target)} tone="good" />}</div>)}{!(p.metrics ?? []).length && <p className="text-xs text-slate-500">No metrics yet.</p>}</div>
      </Card>)}</div>)}
    {tab === 'metrics' && <><ResourcePage resource="impact_metrics" title="Impact metric" writePerm="impact.write" onRowClick={(m: any) => can('impact.write') && setEntry(m)}
      fields={[{ key: 'name', label: 'Metric', required: true }, { key: 'unit', label: 'Unit (e.g. meals, students)' }, { key: 'target', label: 'Target', type: 'number' }, { key: 'period_start', label: 'Period start', type: 'date' }, { key: 'period_end', label: 'Period end', type: 'date' }, { key: 'project_id', label: 'Project', type: 'lookup', lookup: '/r/projects?limit=200' }, { key: 'fund_id', label: 'Fund', type: 'fund' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }]}
      cols={[{ key: 'name', label: 'Metric', render: (m: any) => <span className="font-medium">{m.name}</span> }, { key: 'project_name', label: 'Project' }, { key: 'actual', label: 'Actual vs target', render: (m: any) => <div className="w-48"><div className="text-xs">{num(m.actual)}{m.target ? ` / ${num(m.target)}` : ''} {m.unit}</div>{m.target && <Progress value={m.actual} max={m.target} tone="good" />}</div> }, { key: 'period_end', label: 'Period', render: (m: any) => `${date(m.period_start)} – ${date(m.period_end)}` }, { key: 'e', label: '', render: (m: any) => can('impact.write') && <Button size="sm" onClick={(e) => { e.stopPropagation(); setEntry(m); }}>Record result</Button> }]} />
      {entry && <RecordModal open onClose={() => setEntry(null)} resource="impact_entries" title={`Result — ${entry.name}`} defaults={{ metric_id: entry.id, entry_date: new Date().toISOString().slice(0, 10) }} onSaved={() => window.location.reload()} fields={[{ key: 'metric_id', label: 'Metric', type: 'lookup', lookup: '/r/impact_metrics?limit=200', required: true }, { key: 'value', label: `Value (${entry.unit ?? 'units'})`, type: 'number', required: true }, { key: 'entry_date', label: 'Date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' }]} />}</>}
    {tab === 'stories' && <ResourcePage resource="impact_stories" title="Impact story" writePerm="impact.write"
      fields={[{ key: 'title', label: 'Title', required: true, span: 2 }, { key: 'story', label: 'Story', type: 'textarea', required: true }, { key: 'beneficiaries', label: 'People served', type: 'number' }, { key: 'story_date', label: 'Date', type: 'date' }, { key: 'project_id', label: 'Project', type: 'lookup', lookup: '/r/projects?limit=200' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }, { key: 'shareable', label: 'Approved for donor communications', type: 'bool' }]}
      cols={[{ key: 'title', label: 'Story', render: (s: any) => <div><div className="font-medium">{s.title}</div><div className="max-w-xl truncate text-xs text-slate-500">{s.story}</div></div> }, { key: 'project_name', label: 'Project' }, { key: 'beneficiaries', label: 'People', align: 'right' }, { key: 'shareable', label: 'Shareable', render: (s: any) => (s.shareable ? <Chip value="completed">Yes</Chip> : '') }, { key: 'story_date', label: 'Date', render: (s: any) => date(s.story_date) }]} />}
    <DraftModal open={report} onClose={() => setReport(false)} kind="impact_story" title="Impact report draft" context={data ? data.projects.map((p: any) => `${p.name}: raised ${money(p.raised)}, spent ${money(p.spent)}, ${(p.metrics ?? []).map((m: any) => `${m.name} ${m.actual}/${m.target ?? '—'} ${m.unit ?? ''}`).join(', ')}; ${p.beneficiaries} people served`).join('\n') : ''} />
  </>;
}

// ───────── Messages ─────────
export function Messages() {
  const { id } = useParams(); const nav = useNavigate();
  const convs = useApi<any[]>('/conversations'); const [newOpen, setNewOpen] = useState(false);
  const active = convs.data?.find((c) => c.id === id);
  return <>
    <PageHeader title="Messages" subtitle="Internal team collaboration — separate from donor email." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>New Message</Button>} />
    <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white md:grid-cols-[300px_1fr]">
      <div className={cx('overflow-y-auto border-r border-slate-100', id && 'hidden md:block')}>{!convs.data ? <Spinner /> : convs.data.map((c) => <button key={c.id} onClick={() => nav(`/messages/${c.id}`)} className={cx('block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', c.id === id && 'bg-brand-50')}>
        <div className="flex items-center justify-between gap-2"><span className={cx('truncate text-sm', c.unread ? 'font-bold' : 'font-medium')}>{c.is_channel ? '# ' : ''}{c.name ?? c.members}</span>{c.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}</div>
        <div className="truncate text-xs text-slate-500">{c.last_message}</div><div className="flex justify-between text-[11px] text-slate-400"><span>{c.ministry_name ?? ''}{c.status === 'closed' ? ' · closed' : ''}</span><span>{ago(c.last_at)}</span></div></button>)}</div>
      <div className={cx('flex min-h-0 flex-col', !id && 'hidden md:flex')}>{active ? <Thread conv={active} onChange={convs.reload} /> : <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Select a conversation</div>}</div>
    </div>
    {newOpen && <NewMessage onClose={() => setNewOpen(false)} onCreated={(c) => { convs.reload(); nav(`/messages/${c.id}`); }} />}
  </>;
}
function Thread({ conv, onChange }: { conv: any; onChange: () => void }) {
  const { data, reload } = useApi<any[]>(`/conversations/${conv.id}/messages`);
  const [body, setBody] = useState(''); const { me } = useSession(); const { run } = useAction(); const end = useRef<HTMLDivElement>(null); const nav = useNavigate();
  useEffect(() => { end.current?.scrollIntoView(); onChange(); }, [data?.length]); // eslint-disable-line
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  return <>
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><button className="mr-2 text-xs text-brand-600 md:hidden" onClick={() => nav('/messages')}>←</button><span className="font-semibold">{conv.is_channel ? '# ' : ''}{conv.name ?? conv.members}</span><div className="text-xs text-slate-500">{conv.members}</div></div>
      <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/conversations/${conv.id}/status`, { status: conv.status === 'open' ? 'closed' : 'open' }))) onChange(); }}>{conv.status === 'open' ? 'Close' : 'Reopen'}</Button></div>
    <div className="flex-1 space-y-3 overflow-y-auto p-4">{(data ?? []).map((m) => <div key={m.id} className={cx('max-w-[80%]', m.user_id === me?.user.id && 'ml-auto text-right')}><div className="text-[11px] text-slate-400">{m.user_name} · {dateTime(m.created_at)}</div><div className={cx('inline-block whitespace-pre-line rounded-2xl px-3 py-2 text-left text-sm', m.user_id === me?.user.id ? 'bg-brand-600 text-white' : 'bg-slate-100')}>{m.body}</div></div>)}<div ref={end} /></div>
    <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; if (await run(() => api.post(`/conversations/${conv.id}/messages`, { body }))) { setBody(''); reload(); } }}>
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message… (@name to mention)" /><Button variant="primary" icon={<Send className="h-4 w-4" />}>Send</Button></form>
  </>;
}
function NewMessage({ onClose, onCreated }: { onClose: () => void; onCreated: (c: any) => void }) {
  const team = useTeam() ?? []; const { me } = useSession(); const [v, setV] = useState<any>({ user_ids: [] }); const { run, busy } = useAction();
  return <Modal open onClose={onClose} title="New message" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const c = await run(() => api.post('/conversations', { ...v, ministry_id: v.ministry_id || null, is_channel: v.user_ids.length > 2 && Boolean(v.name) })); if (c) { onCreated(c); onClose(); } }}>Send</Button></>}>
    <div className="space-y-3"><Field label="To"><div className="flex flex-wrap gap-2">{team.filter((u) => u.id !== me?.user.id).map((u) => <Checkbox key={u.id} label={u.name} checked={v.user_ids.includes(u.id)} onChange={(e) => setV({ ...v, user_ids: e.target.checked ? [...v.user_ids, u.id] : v.user_ids.filter((x: string) => x !== u.id) })} />)}</div></Field>
      <Field label="Conversation name (optional)"><Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Related workspace"><WorkspaceSelect value={v.ministry_id ?? ''} onChange={(x) => setV({ ...v, ministry_id: x })} placeholder="None" /></Field>
      <Field label="Message"><Textarea value={v.body ?? ''} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field></div></Modal>;
}

// ───────── Admin & Access ─────────
export function Admin() {
  const { can, workspaces, terms } = useSession();
  const [tab, setTab] = useState<'users' | 'roles' | 'audit'>(can('admin.users') ? 'users' : 'audit');
  const users = useApi<any[]>(can('admin.users') ? '/admin/users' : null); const roles = useApi<any>(can('admin.users') ? '/admin/roles' : null);
  const [invite, setInvite] = useState(false); const [edit, setEdit] = useState<any>(null); const [role, setRole] = useState<any>(null);
  const { run } = useAction();
  return <>
    <PageHeader title="Admin & Access" subtitle="Users, seats, roles, workspace access, fine-grained permissions and the audit log." actions={can('admin.users') && tab === 'users' && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInvite(true)}>Invite user</Button>}>
      <div className="mt-4"><StateTabs value={tab} onChange={setTab} tabs={[...(can('admin.users') ? [{ value: 'users' as const, label: 'Users' }, { value: 'roles' as const, label: 'Roles & permissions' }] : []), ...(can('audit.read') ? [{ value: 'audit' as const, label: 'Audit log' }] : [])]} /></div></PageHeader>
    {tab === 'users' && <Card padded={false}><Table rowKey="membership_id" rows={users.data ?? []} onRowClick={(u) => setEdit(u)} cols={[{ key: 'name', label: 'User', render: (u) => <div><div className="font-medium">{u.name ?? u.invited_email}</div><div className="text-xs text-slate-500">{u.email ?? 'Invitation pending'}</div></div> }, { key: 'role_name', label: 'Role' },
      { key: 'access', label: `${terms} access`, render: (u) => (u.all_ministries ? 'All' : u.ministry_ids.map((id: string) => workspaces.find((w) => w.id === id)?.name).filter(Boolean).join(', ') || 'None') }, { key: 'status', label: 'Status', render: (u) => <Chip value={u.status} /> }, { key: 'seat', label: 'Seat', render: (u) => (u.seat ? 'Yes' : 'No') }, { key: 'last_login', label: 'Last sign-in', render: (u) => ago(u.last_login) }]} /></Card>}
    {tab === 'roles' && roles.data && <Card padded={false} actions={<Button size="sm" onClick={() => setRole({ name: '', permissions: [] })}>Custom role</Button>} title="Roles"><Table rows={roles.data.roles} onRowClick={(r) => setRole(r)} cols={[{ key: 'name', label: 'Role', render: (r) => <span className="font-medium">{r.name}{r.is_system && <Chip className="ml-2">system</Chip>}</span> }, { key: 'description', label: 'Description' }, { key: 'permissions', label: 'Permissions', render: (r) => `${r.permissions.length}` }, { key: 'members', label: 'Members', align: 'right' }]} /></Card>}
    {tab === 'audit' && <AuditLog />}
    {invite && roles.data && <InviteModal roles={roles.data.roles} onClose={() => setInvite(false)} onDone={users.reload} />}
    {edit && roles.data && <AccessModal u={edit} roles={roles.data.roles} onClose={() => setEdit(null)} onDone={users.reload} />}
    {role && roles.data && <RoleModal r={role} catalog={roles.data.catalog} onClose={() => setRole(null)} onDone={roles.reload} />}
  </>;
}
function AccessFields({ v, setV, roles }: { v: any; setV: (x: any) => void; roles: any[] }) {
  const { workspaces, terms } = useSession();
  return <><Field label="Role"><Select value={v.role_id ?? ''} onChange={(e) => setV({ ...v, role_id: e.target.value })} placeholder="Choose role" options={roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
    <Field label={`${terms} access`}><Checkbox label={`All ${terms.toLowerCase()} (including future ones)`} checked={Boolean(v.all_ministries)} onChange={(e) => setV({ ...v, all_ministries: e.target.checked })} />
      {!v.all_ministries && <div className="mt-2 flex flex-wrap gap-3">{workspaces.map((w) => <Checkbox key={w.id} label={w.name} checked={(v.ministry_ids ?? []).includes(w.id)} onChange={(e) => setV({ ...v, ministry_ids: e.target.checked ? [...(v.ministry_ids ?? []), w.id] : (v.ministry_ids ?? []).filter((x: string) => x !== w.id) })} />)}</div>}</Field></>;
}
function InviteModal({ roles, onClose, onDone }: { roles: any[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({ all_ministries: false, ministry_ids: [] }); const [link, setLink] = useState<any>(null); const { run, busy } = useAction(); const { push } = useToast();
  return <Modal open onClose={onClose} title="Invite user" footer={link ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => api.post('/admin/invite', v)); if (r) { setLink(r); onDone(); } }}>Send invitation</Button></>}>
    {link ? <div className="space-y-3"><Notice>{link.emailed ? 'Invitation emailed.' : 'Email delivery is not configured — share this invitation link securely:'}</Notice><div className="flex gap-2"><Input readOnly value={link.link} /><Button icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(link.link); push('success', 'Copied'); }}>Copy</Button></div></div> :
      <div className="space-y-3"><Field label="Email"><Input type="email" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field><AccessFields v={v} setV={setV} roles={roles} /></div>}
  </Modal>;
}
function AccessModal({ u, roles, onClose, onDone }: { u: any; roles: any[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({ role_id: u.role_id, all_ministries: u.all_ministries, ministry_ids: u.ministry_ids, status: u.status, seat: u.seat }); const { run, busy } = useAction();
  return <Modal open onClose={onClose} title={`Access — ${u.name ?? u.invited_email}`} footer={<>{u.status === 'invited' && <Button variant="ghost" className="mr-auto text-red-600" onClick={async () => { if (await run(() => api.del(`/admin/memberships/${u.membership_id}`), 'Invitation revoked')) { onDone(); onClose(); } }}>Revoke invitation</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const body: any = { role_id: v.role_id, all_ministries: v.all_ministries, ministry_ids: v.ministry_ids, seat: v.seat }; if (u.status !== 'invited') body.status = v.status; if (await run(() => api.patch(`/admin/memberships/${u.membership_id}`, body), 'Access updated')) { onDone(); onClose(); } }}>Save</Button></>}>
    <div className="space-y-3"><AccessFields v={v} setV={setV} roles={roles} />{u.status !== 'invited' && <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={['active', 'inactive']} /></Field>}<Checkbox label="Uses a paid seat" checked={v.seat} onChange={(e) => setV({ ...v, seat: e.target.checked })} /></div></Modal>;
}
function RoleModal({ r, catalog, onClose, onDone }: { r: any; catalog: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({ ...r }); const { run, busy } = useAction(); const locked = r.is_system && r.name === 'Organization Admin';
  const groups = Object.keys(catalog).reduce((m: Record<string, string[]>, k) => { (m[k.split('.')[0]] ??= []).push(k); return m; }, {});
  return <Modal open onClose={onClose} title={r.id ? `Role — ${r.name}` : 'New custom role'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button>{!locked && <Button variant="primary" loading={busy} onClick={async () => { const body = { name: v.name, description: v.description, permissions: v.permissions }; if (await run(() => (r.id ? api.patch(`/admin/roles/${r.id}`, body) : api.post('/admin/roles', body)), 'Role saved')) { onDone(); onClose(); } }}>Save</Button>}</>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Name"><Input disabled={locked} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Description"><Input disabled={locked} value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></div>
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{Object.entries(groups).map(([g, keys]) => <div key={g}><div className="mb-1 text-xs font-semibold uppercase text-slate-500">{label(g)}</div>{keys.map((k) => <div key={k}><Checkbox disabled={locked} label={<span><span className="font-mono text-xs">{k}</span><span className="block text-xs text-slate-500">{catalog[k]}</span></span>} checked={v.permissions.includes(k)} onChange={(e) => setV({ ...v, permissions: e.target.checked ? [...v.permissions, k] : v.permissions.filter((x: string) => x !== k) })} /></div>)}</div>)}</div>
  </Modal>;
}
export function AuditLog() {
  const [cat, setCat] = useState(''); const [q, setQ] = useState('');
  const { data } = useApi<any[]>(`/admin/audit?category=${cat}&q=${encodeURIComponent(q)}`);
  return <Card padded={false} title="Audit / activity history" actions={<><Input className="w-48" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><Select className="w-40" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={['donors', 'giving', 'accounting', 'export', 'integrations', 'admin', 'security', 'settings', 'email', 'ai', 'import', 'work', 'grants', 'events']} /></>}>
    <Table rows={data ?? []} cols={[{ key: 'created_at', label: 'Date / time', render: (a) => dateTime(a.created_at) }, { key: 'user_name', label: 'User', render: (a) => a.user_name ?? 'System' }, { key: 'category', label: 'Category', render: (a) => <Chip>{a.category}</Chip> }, { key: 'description', label: 'Description' }, { key: 'ip', label: 'IP', render: (a) => <span className="text-xs text-slate-400">{a.ip}</span> }]} empty="No activity." />
  </Card>;
}

// ───────── Ask A.I. Nonprofits ─────────
const EXAMPLES = ['Who should I call today?', 'Which donors are at risk of lapsing?', 'Where could our next $100,000 come from?', 'Which donors have not been thanked?', 'What receipts still need to be sent?', 'Show our restricted-fund balances.',
  'How much did we spend from the Missions fund this quarter?', 'What grant deadlines are coming up?', 'Which tasks are overdue?', 'Which campaigns generated gifts?', 'Which donors near Nashville should I meet with?', 'What is our year-to-date giving?', 'Compare this month with last month.', 'Which programs are over budget?'];
export function Ask() {
  const [msgs, setMsgs] = useState<any[]>([]); const [q, setQ] = useState(''); const { run, busy } = useAction();
  const history = useApi<any[]>('/outreach/ask/history'); const { me } = useSession(); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setMsgs((m) => [...m, { role: 'user', content: question }]); setQ('');
    const r = await run(() => api.post('/outreach/ask', { question, history: msgs.slice(-6).map((m) => ({ role: m.role, content: m.content })) }));
    if (r) { setMsgs((m) => [...m, { role: 'assistant', content: r.answer, citations: r.citations, engine: r.engine, toolsUsed: r.toolsUsed }]); history.reload(); }
    else setMsgs((m) => m.slice(0, -1));
  };
  return <>
    <PageHeader title={<span className="flex items-center gap-2"><Sparkles className="h-6 w-6 text-violet-600" />Ask A.I. Nonprofits</span>} subtitle="Ask questions about the information you're authorized to see. Answers cite the records behind them. Ask can analyze, explain and recommend — it cannot send, post, edit or move anything." />
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
      <Card padded={false} className="flex min-h-[560px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!msgs.length && <div><p className="mb-3 text-sm text-slate-600">Try one of these:</p><div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => ask(e)} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100">{e}</button>)}</div>
            {!me?.features.ai && <div className="mt-4"><Notice>Natural-language AI is not configured on this server, so questions are matched to built-in, permission-aware reports. Set ANTHROPIC_API_KEY to enable free-form answers.</Notice></div>}</div>}
          {msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ml-auto max-w-[80%] rounded-2xl bg-brand-600 px-4 py-2 text-sm text-white">{m.content}</div> :
            <div key={i} className="max-w-[92%] space-y-2"><div className="flex items-center gap-2"><AiBadge generator={m.engine === 'claude' ? 'claude' : 'rules'} />{m.toolsUsed?.length > 0 && <span className="text-[11px] text-slate-400">Data used: {m.toolsUsed.map(label).join(', ')}</span>}</div>
              <div className="whitespace-pre-line rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800">{m.content}</div>
              {m.citations?.length > 0 && <div className="flex flex-wrap gap-1.5">{m.citations.map((c: any) => <Link key={c.href + c.label} to={c.href} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-50">{c.label} →</Link>)}</div>}</div>)}
          {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Sparkles className="h-4 w-4 animate-pulse text-violet-500" />Looking at your data…</div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about donors, giving, funds, grants, tasks…" /><Button variant="primary" loading={busy} icon={<Send className="h-4 w-4" />}>Ask</Button></form>
      </Card>
      <Card title="Your recent questions" padded={false}>{!history.data?.length ? <p className="p-4 text-sm text-slate-500">No questions yet.</p> : <ul className="divide-y divide-slate-50">{history.data.slice(0, 20).map((h) => <li key={h.id}><button className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setMsgs([{ role: 'user', content: h.question }, { role: 'assistant', content: h.answer, citations: h.citations, engine: h.engine }])}>{h.question}<span className="block text-[11px] text-slate-400">{ago(h.created_at)}</span></button></li>)}</ul>}
        <div className="border-t border-slate-100 p-4 text-xs text-slate-500"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Answers only use data your role can access. Drafts and recommendations are never applied automatically.</div></Card>
    </div>
  </>;
}
export const _pl = { Database };
