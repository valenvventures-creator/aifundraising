import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Sparkles, FileText, MapPin, CalendarPlus, ListChecks, Route, Plus, Save } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, useApi, download, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PillTabs, Spinner, ErrorBox, Field, Input, Select, Textarea, Table, Chip, Empty, Notice, AiBadge, useAction, Progress, Checkbox, SaveState, useToast } from '../components/ui';
import { HealthChip, ScoreBadge, DraftModal, WorkspaceSelect, useCampaigns } from '../components/domain';
import { ResourcePage } from '../components/ResourcePage';
import { money, num, date, dateTime, label, today, addDays } from '../lib/format';
import { CONTENT_TYPES_UI } from './contentTypes';

// ───────── Priorities ─────────
export function PrioritiesShell({ children }: { children?: React.ReactNode }) {
  return <div className="space-y-4"><PillTabs tabs={[{ to: '/donors/giving/priorities', label: 'Next $100K', end: true }, { to: '/donors/giving/priorities/calls', label: 'Call Lists' }, { to: '/donors/giving/priorities/recovery', label: 'Recovery' }, { to: '/donors/giving/priorities/plan', label: 'Action Plan' }]} />{children}</div>;
}

export function Next100K() {
  const [sp] = useSearchParams();
  const { data, loading, error, reload } = useApi<any>(`/donors/intel/opportunities${qs({ ministry_id: sp.get('ministry_id') })}`);
  const [open, setOpen] = useState<string | null>(null);
  const { can } = useSession(); const { run, busy } = useAction();
  if (error) return <PrioritiesShell><ErrorBox error={error} onRetry={reload} /></PrioritiesShell>;
  if (loading || !data) return <PrioritiesShell><Spinner /></PrioritiesShell>;
  return (
    <PrioritiesShell>
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-slate-900 p-6 text-white shadow">
        <div className="text-xs uppercase tracking-widest text-brand-200">Realistically reachable from your current donors</div>
        <div className="mt-1 text-4xl font-bold">{money(data.total)}</div>
        <p className="mt-2 max-w-3xl text-sm text-brand-100">{data.method}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {can('ai.ask') && <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={busy} onClick={async () => { if (await run(() => api.post('/outreach/opportunity-summary'), 'Executive summary refreshed')) reload(); }}>{data.summary ? 'Refresh' : 'Generate'} executive summary</Button>}
          {can('data.export') && <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => download('/donors/intel/opportunities?format=pdf')}>Export PDF</Button>}
        </div>
      </div>
      {data.summary && <Card title="Executive summary" actions={<><AiBadge generator={data.summary.generator} /><span className="text-xs text-slate-400">{dateTime(data.summary.created_at)}</span></>}><p className="whitespace-pre-line text-sm text-slate-700">{data.summary.content}</p></Card>}
      <Card padded={false} title="Opportunity categories" subtitle="Click a category to see the donors and the calculation behind each amount.">
        <Table rowKey="key" rows={data.categories} onRowClick={(c) => setOpen(open === c.key ? null : c.key)} cols={[
          { key: 'label', label: 'Category', render: (c) => <span className="font-medium">{c.label}</span> }, { key: 'potential', label: 'Estimated Potential', align: 'right', render: (c) => <b>{money(c.potential)}</b> },
          { key: 'donors', label: 'Number of Donors', align: 'right' }, { key: 'action', label: 'Recommended Action', render: (c) => <span className="text-xs">{c.action}</span> },
          { key: 'priority', label: 'Priority', render: (c) => <Chip value={c.priority.toLowerCase()}>{c.priority}</Chip> }, { key: 'timeline', label: 'Timeline' }]} empty="No opportunities found — add gifts to build donor history." />
      </Card>
      {open && <CategoryDonors k={open} />}
    </PrioritiesShell>
  );
}
function CategoryDonors({ k }: { k: string }) {
  const { data } = useApi<any>(`/donors/intel/category/${k}`);
  if (!data) return <Spinner />;
  return <Card padded={false} title={`${data.category?.label} — ${data.rows.length} donors`} subtitle="Each donor contributes suggested ask × likelihood.">
    <Table rows={data.rows} cols={[{ key: 'name', label: 'Donor', render: (r) => <Link to={`/donors/${r.id}`} className="font-medium hover:underline">{r.name}</Link> }, { key: 'health', label: 'Health', render: (r) => <HealthChip status={r.health_status} /> },
      { key: 'suggested_ask', label: 'Suggested ask', align: 'right', render: (r) => money(r.suggested_ask) }, { key: 'probability', label: 'Likelihood', align: 'right', render: (r) => `${Math.round(r.probability * 100)}%` },
      { key: 'opportunity_value', label: '= Opportunity', align: 'right', render: (r) => <b>{money(r.opportunity_value)}</b> }, { key: 'ask_basis', label: 'Ask basis', render: (r) => <span className="text-xs text-slate-500">{r.ask_basis}</span> }]} />
  </Card>;
}

function DonorCallTable({ query }: { query: Record<string, string> }) {
  const [sp, setSp] = useSearchParams();
  const q = { ...query, ...Object.fromEntries(sp.entries()) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const { data, loading } = useApi<any>(`/donors${qs({ ...q, limit: 100 })}`);
  const { can } = useSession();
  return (
    <Card padded={false}>
      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
        <Select className="w-36" value={q.health ?? ''} onChange={(e) => set('health', e.target.value)} placeholder="Any health" options={['active', 'engaged', 'cooling', 'lapsing', 'lapsed']} />
        <Input className="w-28" type="number" placeholder="Min score" value={q.min_score ?? ''} onChange={(e) => set('min_score', e.target.value)} />
        <Input className="w-32" type="number" placeholder="Min lifetime" value={q.min_lifetime ?? ''} onChange={(e) => set('min_lifetime', e.target.value)} />
        <Input className="w-28" placeholder="State/Prov." value={q.region ?? ''} onChange={(e) => set('region', e.target.value)} />
        <Input className="w-24" placeholder="Tag" value={q.tag ?? ''} onChange={(e) => set('tag', e.target.value)} />
        <CampaignFilter value={q.campaign_id ?? ''} onChange={(v) => set('campaign_id', v)} />
        <Select className="w-32" value={q.owner ?? ''} onChange={(e) => set('owner', e.target.value)} placeholder="Any owner" options={[{ value: 'me', label: 'Mine' }]} />
        <Checkbox label="Recurring" checked={q.recurring === 'true'} onChange={(e) => set('recurring', e.target.checked ? 'true' : '')} />
        {can('data.export') && <Button size="sm" className="ml-auto" onClick={() => download(`/donors/export${qs({ ...q, format: 'csv' })}`)}>Export call list</Button>}
      </div>
      {loading || !data ? <Spinner /> : <Table rows={data.rows} cols={[
        { key: 'name', label: 'Donor', render: (r) => <Link to={`/donors/${r.id}`} className="font-medium hover:underline">{r.name}</Link> },
        { key: 'phone', label: 'Phone', render: (r) => (r.phone ? <a href={`tel:${r.phone}`} className="text-brand-700 hover:underline">{r.phone}</a> : '—') },
        { key: 'health', label: 'Health', render: (r) => <HealthChip status={r.health_status} /> }, { key: 'score', label: 'Score', render: (r) => <ScoreBadge score={r.score} /> },
        { key: 'lifetime', label: 'Lifetime', align: 'right', render: (r) => money(r.lifetime) }, { key: 'last_gift', label: 'Last gift', render: (r) => date(r.last_gift) },
        { key: 'suggested_ask', label: 'Ask', align: 'right', render: (r) => money(r.suggested_ask) }, { key: 'next_step', label: 'Talking point', render: (r) => <span className="text-xs">{r.next_step}</span> }]} />}
    </Card>
  );
}
function CampaignFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) { const c = useCampaigns() ?? []; return <Select className="w-44" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Any campaign" options={c.map((x) => ({ value: x.id, label: x.name }))} />; }
export function CallLists() { return <PrioritiesShell><Notice>Call lists are built from fundraising intelligence. Filter, then export or work through the list — each donor links to a call script.</Notice><DonorCallTable query={{ sort: 'opportunity' }} /></PrioritiesShell>; }
export function Recovery() { return <PrioritiesShell><Notice tone="warn">Lapsing and lapsed donors, highest lifetime giving first. Recommended: personal outreach for major donors, a re-engagement message with an impact story for others.</Notice><DonorCallTable query={{ health: 'lapsing,lapsed', sort: 'lifetime' }} /></PrioritiesShell>; }
export function ActionPlan() {
  const { data } = useApi<any>('/donors/intel/action-plan');
  return <PrioritiesShell>{!data ? <Spinner /> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{data.weeks.map((w: any) => (
    <Card key={w.week} title={w.week} subtitle={w.focus} actions={<b>{money(w.potential)}</b>}>
      {!w.items.length ? <p className="text-sm text-slate-500">Nothing in these categories right now.</p> : <ul className="space-y-2">{w.items.map((c: any) => <li key={c.key} className="text-sm"><div className="flex justify-between"><span className="font-medium">{c.label}</span><span>{c.donors} donors · {money(c.potential)}</span></div><div className="text-xs text-slate-500">{c.action}</div></li>)}</ul>}
      <Link to="/donors/giving/priorities/calls" className="mt-3 inline-block text-xs text-brand-600 hover:underline">Open call list →</Link>
    </Card>))}</div>}</PrioritiesShell>;
}

// ───────── Trips ─────────
export function Trips() {
  const { data, loading } = useApi<any[]>('/outreach/trips');
  const nav = useNavigate(); const { can } = useSession();
  const [f, setF] = useState<any>({ start_date: addDays(today(), 14), end_date: addDays(today(), 15), radius_miles: 50, meetings_per_day: 4 });
  const { run, busy } = useAction();
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {can('donors.write') && <Card title="Plan a donor trip" subtitle="We'll find donors near your destination and draft a meeting schedule.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" className="col-span-2"><Input value={f.city ?? ''} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Nashville" /></Field>
          <Field label="State / Province"><Input value={f.region ?? ''} onChange={(e) => setF({ ...f, region: e.target.value })} /></Field>
          <Field label="ZIP / Postal"><Input value={f.postal_code ?? ''} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></Field>
          <Field label="Travel start"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Travel end"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Purpose" className="col-span-2"><Input value={f.purpose ?? ''} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Year-end visits" /></Field>
          <Field label="Radius (miles)"><Input type="number" value={f.radius_miles} onChange={(e) => setF({ ...f, radius_miles: Number(e.target.value) })} /></Field>
          <Field label="Meetings per day"><Input type="number" value={f.meetings_per_day} onChange={(e) => setF({ ...f, meetings_per_day: Number(e.target.value) })} /></Field>
          <Field label="Estimated trip cost (optional)" hint="Used for potential ROI" className="col-span-2"><Input type="number" value={f.est_cost ?? ''} onChange={(e) => setF({ ...f, est_cost: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Button variant="primary" className="mt-4 w-full" loading={busy} icon={<MapPin className="h-4 w-4" />} onClick={async () => { const t = await run(() => api.post('/outreach/trips', f), 'Trip planned'); if (t) nav(`/donors/giving/trips/${t.id}`); }}>Plan trip</Button>
      </Card>}
      <Card title="Trips" className="xl:col-span-2" padded={false}>
        {loading ? <Spinner /> : !data?.length ? <div className="p-5"><Empty title="No trips planned">Plan a trip to see donors near your destination on a map with a suggested schedule.</Empty></div> :
          <Table rows={data} onRowClick={(t) => nav(`/donors/giving/trips/${t.id}`)} cols={[{ key: 'city', label: 'Destination', render: (t) => `${t.city}${t.region ? ', ' + t.region : ''}` }, { key: 'start_date', label: 'Dates', render: (t) => `${date(t.start_date)} – ${date(t.end_date)}` }, { key: 'purpose', label: 'Purpose' }, { key: 'stops', label: 'Meetings', align: 'right' }]} />}
      </Card>
    </div>
  );
}

export function TripDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi<any>(`/outreach/trips/${id}`);
  const { can, me } = useSession(); const { run } = useAction(); const { push } = useToast();
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Spinner />;
  const { trip, stops, others, summary, mapsUrl } = data;
  const included = stops.filter((s: any) => s.included);
  const patch = async (donorId: string, body: any) => { if (await run(() => api.patch(`/outreach/trips/${trip.id}/stops/${donorId}`, body))) reload(); };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to="/donors/giving/trips" className="text-xs text-brand-600 hover:underline">← Trips</Link><h2 className="text-xl font-bold">{trip.city}{trip.region ? `, ${trip.region}` : ''}</h2><p className="text-sm text-slate-500">{date(trip.start_date)} – {date(trip.end_date)} · {trip.purpose ?? 'Donor visits'} · {trip.radius_miles} mi radius</p></div>
        <div className="flex flex-wrap gap-2">
          {can('work.write') && <Button icon={<ListChecks className="h-4 w-4" />} onClick={async () => { const r = await run(() => api.post(`/outreach/trips/${trip.id}/tasks`, { kind: 'trip' })); if (r) push('success', `${r.created} trip tasks created`); }}>Trip Task List</Button>}
          {can('work.write') && <Button onClick={async () => { const r = await run(() => api.post(`/outreach/trips/${trip.id}/tasks`, { kind: 'follow_up' })); if (r) push('success', `${r.created} follow-up tasks created`); }}>Follow-Up List</Button>}
          <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={async () => {
            const items = included.filter((s: any) => s.meeting_at).map((s: any) => ({ summary: `Donor visit: ${s.name}`, start: s.meeting_at, description: `Suggested ask ${money(s.suggested_ask)}. ${s.notes ?? ''}`, location: [s.address1, s.city, s.region].filter(Boolean).join(', ') }));
            if (!items.length) return push('error', 'No scheduled meetings to add.');
            if (!me?.features.google) return push('error', 'Google Calendar is not configured on this server. Ask an administrator to add Google credentials.');
            const r = await run(() => api.post('/integrations/google/calendar', { items })); if (r) push('success', `Added ${r.created.length} meetings to Google Calendar`);
          }}>Add All to Calendar</Button>
          {can('data.export') && <Button icon={<FileText className="h-4 w-4" />} onClick={() => download(`/outreach/trips/${trip.id}?format=pdf`)}>Export Trip Plan PDF</Button>}
          {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"><Route className="h-4 w-4" />Open Route in Google Maps</a>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Donors to see" value={summary.donors} /><Metric label="Potential asks" value={money(summary.potential)} tone="good" sub="estimate" />
        <Metric label="Est. trip cost" value={trip.est_cost ? money(trip.est_cost) : '—'} /><Metric label="Potential ROI" value={summary.roi ? `${summary.roi}×` : '—'} />
      </div>
      <Card padded={false} title="Donor map">
        <div className="h-[380px] overflow-hidden rounded-b-2xl">
          <MapContainer center={[trip.lat, trip.lng]} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Circle center={[trip.lat, trip.lng]} radius={trip.radius_miles * 1609} pathOptions={{ color: '#6366f1', weight: 1, fillOpacity: 0.04 }} />
            {others.map((o: any) => <CircleMarker key={o.id} center={[o.lat, o.lng]} radius={5} pathOptions={{ color: '#94a3b8' }}><Popup>{o.name}<br />{money(o.lifetime)} lifetime</Popup></CircleMarker>)}
            {included.filter((s: any) => s.lat).map((s: any) => <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={8} pathOptions={{ color: '#4f46e5', fillColor: '#6366f1', fillOpacity: 0.8 }}><Popup><b>{s.name}</b><br />{s.meeting_at ? dateTime(s.meeting_at) : 'Not scheduled'}<br />Ask {money(s.suggested_ask)}</Popup></CircleMarker>)}
          </MapContainer>
        </div>
      </Card>
      <Card padded={false} title="Meeting schedule">
        <Table rows={stops} rowKey="donor_id" cols={[
          { key: 'included', label: '', render: (s) => <input type="checkbox" checked={s.included} onChange={(e) => patch(s.donor_id, { included: e.target.checked })} /> },
          { key: 'name', label: 'Donor', render: (s) => <Link className="font-medium hover:underline" to={`/donors/${s.donor_id}`}>{s.name}</Link> }, { key: 'city', label: 'City / State', render: (s) => [s.city, s.region].filter(Boolean).join(', ') },
          { key: 'lifetime', label: 'Lifetime', align: 'right', render: (s) => money(s.lifetime) }, { key: 'last_gift', label: 'Last gift', render: (s) => date(s.last_gift) }, { key: 'score', label: 'Score', render: (s) => <ScoreBadge score={s.score} /> },
          { key: 'meeting_at', label: 'Meeting', render: (s) => <input type="datetime-local" className="rounded border border-slate-200 px-1 py-0.5 text-xs" defaultValue={s.meeting_at ? String(s.meeting_at).slice(0, 16) : ''} onBlur={(e) => patch(s.donor_id, { meeting_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /> },
          { key: 'suggested_ask', label: 'Suggested ask', align: 'right', render: (s) => money(s.suggested_ask) },
          { key: 'priority', label: 'Priority', render: (s) => <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={s.priority} onChange={(e) => patch(s.donor_id, { priority: e.target.value })}>{['high', 'medium', 'low'].map((p) => <option key={p}>{p}</option>)}</select> },
          { key: 'notes', label: 'Notes', render: (s) => <input className="w-40 rounded border border-slate-200 px-1 py-0.5 text-xs" defaultValue={s.notes ?? ''} onBlur={(e) => e.target.value !== (s.notes ?? '') && patch(s.donor_id, { notes: e.target.value })} /> }]} />
      </Card>
      {others.length > 0 && <Card padded={false} title={`Other donors nearby (${others.length})`}><Table rows={others} cols={[{ key: 'name', label: 'Donor', render: (o) => <Link to={`/donors/${o.id}`} className="hover:underline">{o.name}</Link> }, { key: 'distance', label: 'Miles', align: 'right' }, { key: 'lifetime', label: 'Lifetime', align: 'right', render: (o) => money(o.lifetime) }, { key: 'score', label: 'Score', render: (o) => <ScoreBadge score={o.score} /> }, { key: 'add', label: '', render: (o) => can('donors.write') && <Button size="sm" onClick={() => patch(o.id, { included: true })}>Add</Button> }]} /></Card>}
    </div>
  );
}

// ───────── Outreach: Writer + Voice profile ─────────
export function Outreach() {
  const { workspaces, me, can } = useSession();
  const [ministry, setMinistry] = useState(workspaces[0]?.id ?? '');
  const voice = useApi<any>(ministry ? `/outreach/voice/${ministry}` : null, [ministry]);
  const [v, setV] = useState<any>({}); const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { if (voice.data) setV(voice.data); }, [voice.data]);
  const [w, setW] = useState<any>({ kind: 'thank_you' });
  const [result, setResult] = useState<any>(null); const [content, setContent] = useState('');
  const campaigns = useCampaigns() ?? [];
  const { run, busy } = useAction(); const { push } = useToast();
  const faith = me?.tenant?.faith_based && v.faith_enabled !== false;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      <Card title="Writer" className="xl:col-span-3" subtitle="AI Writing Assistant — creates editable drafts. Nothing is ever sent automatically.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Content type"><Select value={w.kind} onChange={(e) => setW({ ...w, kind: e.target.value })} options={Object.entries(CONTENT_TYPES_UI).map(([value, l]) => ({ value, label: l }))} /></Field>
          <Field label="Donor segment"><Select value={w.segment ?? ''} onChange={(e) => setW({ ...w, segment: e.target.value })} placeholder="General audience" options={['Lapsed donors', 'Monthly partners', 'Major donors', 'First-time donors', 'Event attendees', 'Board members', 'Volunteers']} /></Field>
          <Field label="Personalize for a donor (optional)" className="sm:col-span-2"><DonorSearch value={w.donor} onChange={(d) => setW({ ...w, donor: d })} /></Field>
          <Field label="Campaign / occasion"><Select value={w.campaign_id ?? ''} onChange={(e) => setW({ ...w, campaign_id: e.target.value })} placeholder="None" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Workspace voice"><WorkspaceSelect value={ministry} onChange={setMinistry} placeholder="Organization default" /></Field>
          <Field label="Context" className="sm:col-span-2"><Textarea rows={3} value={w.context ?? ''} onChange={(e) => setW({ ...w, context: e.target.value })} placeholder="What's happening, what to highlight, any specific ask…" /></Field>
          {w.donor && can('donors.private_notes') && <Checkbox label="Allow private notes to inform the draft (not quoted)" checked={Boolean(w.include_private)} onChange={(e) => setW({ ...w, include_private: e.target.checked })} />}
        </div>
        <Button variant="primary" className="mt-4" icon={<Sparkles className="h-4 w-4" />} loading={busy} onClick={async () => { const r = await run(() => api.post('/outreach/draft', { kind: w.kind, segment: w.segment || null, donor_id: w.donor?.id, campaign_id: w.campaign_id || null, ministry_id: ministry || null, context: w.context || null, include_private: Boolean(w.include_private) })); if (r) { setResult(r); setContent(r.content); } }}>Generate draft</Button>
        {result && <div className="mt-5 space-y-2"><div className="flex items-center justify-between"><AiBadge generator={result.generator} /><div className="flex gap-2"><Button size="sm" onClick={() => { navigator.clipboard.writeText(content); push('success', 'Copied'); }}>Copy</Button><Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => run(() => api.patch(`/r/drafts/${result.id}`, { content }), 'Draft saved')}>Save draft</Button>{can('email.write') && <Button size="sm" onClick={async () => { const c = await run(() => api.post('/reach/campaigns', { name: result.title, subject: content.split('\n')[0].replace(/^subject:\s*/i, '').slice(0, 150), blocks: [{ type: 'text', text: content.split('\n').slice(1).join('\n').trim() }] }), 'Email campaign draft created'); if (c) window.location.assign(`/donors/email/campaigns/${c.id}`); }}>Use in email campaign</Button>}</div></div>
          <Textarea rows={14} value={content} onChange={(e) => setContent(e.target.value)} /></div>}
        {!me?.features.ai && <div className="mt-4"><Notice tone="ai">AI service is not configured on this server; drafts use structured templates. Set ANTHROPIC_API_KEY to enable AI drafting.</Notice></div>}
      </Card>
      <Card title="Voice Profile" className="xl:col-span-2" subtitle={workspaces.find((x) => x.id === ministry)?.name} actions={<SaveState state={saveState} />}>
        {!ministry ? <p className="text-sm text-slate-500">Choose a workspace.</p> : <div className="space-y-3">
          <Field label="Ministry / Organization tone"><Input value={v.tone ?? ''} onChange={(e) => setV({ ...v, tone: e.target.value })} placeholder="Warm, grateful, hopeful" /></Field>
          <Field label="Leader voice"><Input value={v.leader_voice ?? ''} onChange={(e) => setV({ ...v, leader_voice: e.target.value })} placeholder="Pastoral, plain-spoken" /></Field>
          {me?.tenant?.faith_based && <Checkbox label="Use faith language" checked={v.faith_enabled !== false} onChange={(e) => setV({ ...v, faith_enabled: e.target.checked })} />}
          {faith && <><Field label="Faith language"><Input value={v.faith_language ?? ''} onChange={(e) => setV({ ...v, faith_language: e.target.value })} /></Field><Field label="Scripture usage"><Input value={v.scripture_usage ?? ''} onChange={(e) => setV({ ...v, scripture_usage: e.target.value })} placeholder="Occasional, short verses" /></Field></>}
          {[['urgency', 'Urgency'], ['formality', 'Formality'], ['donor_centeredness', 'Donor-centeredness']].map(([k, l]) => <Field key={k} label={`${l}: ${v[k] ?? 3}/5`}><input type="range" min={1} max={5} value={v[k] ?? 3} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-full accent-brand-600" /></Field>)}
          <Field label="Themes"><Input value={v.themes ?? ''} onChange={(e) => setV({ ...v, themes: e.target.value })} /></Field>
          <Field label="Words to use"><Input value={v.words_to_use ?? ''} onChange={(e) => setV({ ...v, words_to_use: e.target.value })} /></Field>
          <Field label="Words to avoid"><Input value={v.words_to_avoid ?? ''} onChange={(e) => setV({ ...v, words_to_avoid: e.target.value })} /></Field>
          {can('email.write') && <Button variant="primary" onClick={async () => { setSaveState('saving'); try { const { id, tenant_id, ministry_id, updated_at, ...body } = v; await api.put(`/outreach/voice/${ministry}`, { ...body, faith_enabled: v.faith_enabled !== false }); await api.post('/onboarding/voice'); setSaveState('saved'); } catch (e: any) { setSaveState('error'); push('error', e.message); } }}>Save voice profile</Button>}
        </div>}
      </Card>
    </div>
  );
}
function DonorSearch({ value, onChange }: { value: any; onChange: (d: any) => void }) {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { if (q.length < 2) return setRows([]); const t = setTimeout(() => api.get(`/donors?q=${encodeURIComponent(q)}&limit=6`).then((d) => setRows(d.rows)), 200); return () => clearTimeout(t); }, [q]);
  if (value) return <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">{value.name}<button className="text-xs text-brand-600" onClick={() => onChange(null)}>Clear</button></div>;
  return <div className="relative"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search donor…" />{rows.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow">{rows.map((r) => <button key={r.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { onChange({ id: r.id, name: r.name }); setQ(''); setRows([]); }}>{r.name}</button>)}</div>}</div>;
}

// ───────── Fundraising campaigns ─────────
export function Campaigns() {
  const nav = useNavigate();
  return <ResourcePage resource="campaigns" title="Campaign" writePerm="donors.write" onRowClick={(r: any) => nav(`/donors/giving/campaigns/${r.id}`)}
    emptyText="Campaigns group gifts, emails and events around a goal (e.g. year-end, building, missions)."
    fields={[{ key: 'name', label: 'Name', required: true, span: 2 }, { key: 'goal', label: 'Goal', type: 'number' }, { key: 'status', label: 'Status', type: 'select', options: ['active', 'planned', 'completed', 'archived'], default: 'active' },
      { key: 'starts_on', label: 'Starts', type: 'date' }, { key: 'ends_on', label: 'Ends', type: 'date' }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }, { key: 'description', label: 'Description', type: 'textarea' }]}
    cols={[{ key: 'name', label: 'Campaign', sortable: true, render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: 'status', label: 'Status', render: (r: any) => <Chip value={r.status === 'active' ? 'open' : r.status}>{r.status}</Chip> },
      { key: 'raised', label: 'Raised', align: 'right', render: (r: any) => <div className="w-40"><div className="text-right">{money(r.raised)}{r.goal ? ` / ${money(r.goal)}` : ''}</div>{r.goal && <Progress value={r.raised} max={r.goal} />}</div> },
      { key: 'gift_count', label: 'Gifts', align: 'right' }, { key: 'starts_on', label: 'Dates', render: (r: any) => `${date(r.starts_on)} – ${date(r.ends_on)}` }, { key: 'ministry_name', label: 'Workspace' }]} />;
}
export function CampaignDetail() {
  const { id } = useParams();
  const { data: c } = useApi<any>(`/r/campaigns/${id}`);
  const gifts = useApi<any>(`/giving/gifts?campaign_id=${id}&limit=200`);
  const [draft, setDraft] = useState(false);
  if (!c) return <Spinner />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><Link to="/donors/giving/campaigns" className="text-xs text-brand-600 hover:underline">← Campaigns</Link><h2 className="text-xl font-bold">{c.name}</h2><p className="text-sm text-slate-500">{c.description}</p></div><Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setDraft(true)}>Draft campaign message</Button></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Raised" value={money(c.raised)} tone="good" /><Metric label="Goal" value={c.goal ? money(c.goal) : '—'} /><Metric label="Gifts" value={num(c.gift_count)} /><Metric label="Progress" value={c.goal ? `${Math.round((c.raised / c.goal) * 100)}%` : '—'} /></div>
    <Card padded={false} title="Gifts in this campaign (drill-down)"><Table rows={gifts.data?.rows ?? []} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'donor_name', label: 'Donor', render: (g) => <Link to={`/donors/${g.donor_id}`} className="hover:underline">{g.donor_name}</Link> }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money(g.amount, 2) }, { key: 'fund_name', label: 'Fund' }]} /></Card>
    <DraftModal open={draft} onClose={() => setDraft(false)} kind="campaign_message" context={`Campaign: ${c.name}. ${c.description ?? ''}`} title={`Campaign message — ${c.name}`} />
  </div>;
}
export const _f = { Plus };
