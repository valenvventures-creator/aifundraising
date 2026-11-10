/** A.I. Nonprofits Reach — Campaigns · Audiences · Journeys · Templates · Grow · Analytics · Settings */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, Outlet } from 'react-router-dom';
import { Heading1, Type, Image, MousePointerClick, HandCoins, Video, Minus, Trash2, ArrowUp, ArrowDown, Sparkles, Send, Clock, Save, Copy, Plus } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PillTabs, Spinner, Field, Input, Select, Textarea, Table, Chip, Empty, Notice, useAction, useToast, Modal, Checkbox, SaveState, cx } from '../components/ui';
import { ResourcePage, RecordModal } from '../components/ResourcePage';
import { useCampaigns, useFunds, WorkspaceSelect, invalidate } from '../components/domain';
import { money, num, date, dateTime, label, pct } from '../lib/format';

export function ReachShell() {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-xl font-bold text-slate-800">A.I. Nonprofits Reach</h2></div>
    <PillTabs tabs={['campaigns', 'audiences', 'journeys', 'templates', 'grow', 'analytics', 'settings'].map((t) => ({ to: `/donors/email/${t}`, label: label(t) }))} />
    <Outlet />
  </div>;
}

// ───────── Campaigns ─────────
export function EmailCampaigns() {
  const [status, setStatus] = useState('');
  const { data, reload } = useApi<any[]>(`/reach/campaigns${status ? `?status=${status}` : ''}`);
  const { can } = useSession(); const nav = useNavigate(); const { run } = useAction();
  return <Card padded={false} actions={<><Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={['draft', 'scheduled', 'sending', 'sent', 'paused', 'archived']} />
    {can('email.write') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={async () => { const c = await run(() => api.post('/reach/campaigns', { name: 'Untitled campaign', blocks: [{ type: 'heading', text: 'A note of thanks' }, { type: 'text', text: 'Dear {{first_name}},\n\n' }] })); if (c) nav(`/donors/email/campaigns/${c.id}`); }}>New campaign</Button>}</>} title="Email campaigns">
    {!data ? <Spinner /> : !data.length ? <div className="p-5"><Empty title="No email campaigns yet">Build an email with the visual builder, choose an audience from your CRM, and send or schedule it.</Empty></div> :
      <Table rows={data} onRowClick={(c) => nav(`/donors/email/campaigns/${c.id}`)} cols={[
        { key: 'name', label: 'Campaign', render: (c) => <div><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c.subject ?? 'No subject yet'}</div></div> }, { key: 'audience_name', label: 'Audience', render: (c) => c.audience_name ?? '—' },
        { key: 'status', label: 'Status', render: (c) => <Chip value={c.status} /> }, { key: 'recipient_count', label: 'Recipients', align: 'right', render: (c) => num(c.recipient_count) },
        { key: 'opens', label: 'Opens', align: 'right', render: (c) => (c.status === 'sent' ? `${num(c.opens)} (${c.recipient_count ? Math.round((c.opens / c.recipient_count) * 100) : 0}%)` : '—') },
        { key: 'clicks', label: 'Clicks', align: 'right', render: (c) => (c.status === 'sent' ? num(c.clicks) : '—') }, { key: 'gifts_attributed', label: 'Gifts', align: 'right', render: (c) => (c.status === 'sent' ? money(c.gifts_attributed) : '—') },
        { key: 'open', label: '', render: (c) => <Button size="sm" onClick={(e) => { e.stopPropagation(); nav(`/donors/email/campaigns/${c.id}`); }}>{['draft', 'paused'].includes(c.status) ? 'Edit' : 'Open'}</Button> }]} />}
  </Card>;
}

const BLOCKS: { type: string; label: string; icon: any; init: any }[] = [
  { type: 'heading', label: 'Heading', icon: Heading1, init: { text: 'Headline' } }, { type: 'text', label: 'Text', icon: Type, init: { text: 'Write your message…' } },
  { type: 'image', label: 'Image', icon: Image, init: { url: '', text: '' } }, { type: 'button', label: 'Button', icon: MousePointerClick, init: { label: 'Learn more', url: 'https://' } },
  { type: 'donate', label: 'Giving block', icon: HandCoins, init: { text: 'Will you give today?', url: 'https://', amounts: [25, 50, 100, 250] } }, { type: 'video', label: 'Video', icon: Video, init: { url: 'https://', text: 'Watch the story' } },
  { type: 'divider', label: 'Divider', icon: Minus, init: {} }];
const TOKENS = ['first_name', 'name', 'gift_amount', 'last_gift_date', 'lifetime_giving', 'ministry', 'organization'];

export function EmailBuilder() {
  const { id } = useParams();
  const { data, reload } = useApi<any>(`/reach/campaigns/${id}`);
  const audiences = useApi<any>('/r/audiences?limit=200');
  const campaigns = useCampaigns() ?? [];
  const [c, setC] = useState<any>(null); const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sel, setSel] = useState<number | null>(null); const [preview, setPreview] = useState<'desktop' | 'mobile' | null>(null);
  const [testTo, setTestTo] = useState(''); const [sched, setSched] = useState('');
  const [subjects, setSubjects] = useState<string[] | null>(null); const [prediction, setPrediction] = useState<any>(null); const [audCount, setAudCount] = useState<number | null>(null);
  const { can, me } = useSession(); const { run, busy } = useAction(); const { push, confirm } = useToast(); const nav = useNavigate();
  useEffect(() => { if (data) setC(data); }, [data]);
  const editable = c && ['draft', 'paused'].includes(c.status) && can('email.write');
  useEffect(() => {
    if (!c || !editable || !data) return;
    if (JSON.stringify({ ...c }) === JSON.stringify(data)) return;
    setSave('saving');
    const t = setTimeout(async () => { try { await api.patch(`/reach/campaigns/${id}`, { name: c.name, subject: c.subject, preview_text: c.preview_text, from_name: c.from_name, blocks: c.blocks, audience_id: c.audience_id || null, campaign_id: c.campaign_id || null }); setSave('saved'); } catch (e: any) { setSave('error'); push('error', e.message); } }, 800);
    return () => clearTimeout(t);
  }, [c]); // eslint-disable-line
  const aud = audiences.data?.rows.find((a: any) => a.id === c?.audience_id);
  useEffect(() => { if (aud) { api.post('/reach/audiences/preview', { filters: aud.filters }).then((r) => setAudCount(r.count)); api.post('/reach/predict', { filters: aud.filters }).then(setPrediction).catch(() => setPrediction(null)); } }, [aud?.id]); // eslint-disable-line
  if (!c) return <Spinner />;
  const setBlock = (i: number, patch: any) => setC({ ...c, blocks: c.blocks.map((b: any, j: number) => (j === i ? { ...b, ...patch } : b)) });
  const move = (i: number, d: number) => { const b = [...c.blocks]; const [x] = b.splice(i, 1); b.splice(i + d, 0, x); setC({ ...c, blocks: b }); setSel(i + d); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Link to="/donors/email/campaigns" className="text-xs text-brand-600 hover:underline">← Campaigns</Link><Chip value={c.status} /><SaveState state={save} /></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPreview('desktop')}>Preview</Button>
          {can('email.write') && <Button icon={<Copy className="h-4 w-4" />} onClick={async () => { const d = await run(() => api.post(`/reach/campaigns/${id}/duplicate`), 'Duplicated'); if (d) nav(`/donors/email/campaigns/${d.id}`); }}>Duplicate</Button>}
          {['scheduled', 'sending'].includes(c.status) && can('email.send') && <Button onClick={async () => { if (await run(() => api.post(`/reach/campaigns/${id}/pause`), 'Paused')) reload(); }}>Pause</Button>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Campaign name"><Input disabled={!editable} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
              <Field label="From name"><Input disabled={!editable} value={c.from_name ?? ''} onChange={(e) => setC({ ...c, from_name: e.target.value })} placeholder={me?.tenant?.name} /></Field>
              <Field label="Subject line" className="sm:col-span-2"><div className="flex gap-2"><Input disabled={!editable} value={c.subject ?? ''} onChange={(e) => setC({ ...c, subject: e.target.value })} />{editable && can('ai.ask') && <Button icon={<Sparkles className="h-4 w-4" />} onClick={async () => { const r = await run(() => api.post('/reach/subject-lines', { topic: [c.name, c.blocks.map((b: any) => b.text).filter(Boolean).join(' ')].join(': ').slice(0, 900) })); if (r) setSubjects(r.suggestions); }}>Suggest</Button>}</div>
                {subjects && <div className="mt-2 flex flex-wrap gap-1.5">{subjects.map((s) => <button key={s} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-800 hover:bg-violet-100" onClick={() => { setC({ ...c, subject: s }); setSubjects(null); }}>{s}</button>)}<span className="self-center text-[11px] text-violet-500">AI suggestions — click to use</span></div>}</Field>
              <Field label="Preview text" className="sm:col-span-2"><Input disabled={!editable} value={c.preview_text ?? ''} onChange={(e) => setC({ ...c, preview_text: e.target.value })} /></Field>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[140px_1fr]">
            {editable && <div className="flex flex-row flex-wrap gap-2 lg:flex-col">{BLOCKS.map((b) => <button key={b.type} draggable onDragStart={(e) => e.dataTransfer.setData('block', b.type)} onClick={() => { setC({ ...c, blocks: [...c.blocks, { type: b.type, ...b.init }] }); setSel(c.blocks.length); }} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm hover:border-brand-300"><b.icon className="h-4 w-4 text-brand-600" />{b.label}</button>)}</div>}
            <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const t = e.dataTransfer.getData('block'); const b = BLOCKS.find((x) => x.type === t); if (b && editable) setC({ ...c, blocks: [...c.blocks, { type: b.type, ...b.init }] }); }}>
              <div className="mx-auto max-w-[600px] space-y-1 rounded-xl bg-white p-6 shadow-sm">
                {!c.blocks.length && <p className="py-10 text-center text-sm text-slate-400">Drag or tap components to build your email.</p>}
                {c.blocks.map((b: any, i: number) => (
                  <div key={i} onClick={() => setSel(i)} className={cx('group relative rounded-lg border-2 p-2', sel === i ? 'border-brand-400' : 'border-transparent hover:border-slate-200')}>
                    <BlockView b={b} />
                    {editable && sel === i && <div className="absolute -right-2 -top-3 flex gap-0.5 rounded-lg bg-white shadow">{i > 0 && <button className="p-1" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>}{i < c.blocks.length - 1 && <button className="p-1" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>}<button className="p-1 text-red-600" onClick={() => { setC({ ...c, blocks: c.blocks.filter((_: any, j: number) => j !== i) }); setSel(null); }}><Trash2 className="h-3.5 w-3.5" /></button></div>}
                  </div>))}
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {sel !== null && c.blocks[sel] && editable && <Card title={`Edit ${label(c.blocks[sel].type)}`}><BlockEditor b={c.blocks[sel]} onChange={(p) => setBlock(sel, p)} /></Card>}
          <Card title="Audience">
            <Select disabled={!editable} value={c.audience_id ?? ''} onChange={(e) => setC({ ...c, audience_id: e.target.value })} placeholder="Choose audience" options={(audiences.data?.rows ?? []).map((a: any) => ({ value: a.id, label: a.name }))} />
            {aud && <p className="mt-2 text-sm text-slate-600">{audCount ?? '…'} reachable recipients (opted-in, not suppressed).</p>}
            <Field label="Fundraising campaign (for attribution)" className="mt-3"><Select disabled={!editable} value={c.campaign_id ?? ''} onChange={(e) => setC({ ...c, campaign_id: e.target.value })} placeholder="None" options={campaigns.map((x) => ({ value: x.id, label: x.name }))} /></Field>
            <Link to="/donors/email/audiences" className="mt-2 inline-block text-xs text-brand-600 hover:underline">Manage audiences</Link>
          </Card>
          {prediction && <Card title="Predicted impact (estimate)">{prediction.available ? <><div className="text-2xl font-bold">{money(prediction.expectedRevenue)}</div><p className="text-xs text-slate-500">≈ {prediction.expectedGifts} gifts. {prediction.explanation}</p></> : <p className="text-sm text-slate-500">{prediction.reason}</p>}</Card>}
          <Card title="Personalization tokens"><div className="flex flex-wrap gap-1.5">{TOKENS.map((t) => <button key={t} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs hover:bg-slate-200" onClick={() => { navigator.clipboard.writeText(`{{${t}}}`); push('info', `Copied {{${t}}}`); }}>{`{{${t}}}`}</button>)}</div></Card>
          {can('email.write') && c.status !== 'sent' && <Card title="Test email"><div className="flex gap-2"><Input type="email" placeholder="you@example.org" value={testTo} onChange={(e) => setTestTo(e.target.value)} /><Button loading={busy} onClick={() => run(() => api.post(`/reach/campaigns/${id}/test`, { to: testTo }), `Test sent to ${testTo}`)}>Send test</Button></div></Card>}
          {can('email.send') && editable && <Card title="Send">
            <div className="space-y-3">
              <Button variant="primary" className="w-full" icon={<Send className="h-4 w-4" />} loading={busy} onClick={async () => { if (await confirm({ title: 'Send now?', message: `This will email ${audCount ?? 'the selected'} recipients. Sending cannot be undone (you can pause mid-send).`, confirmLabel: 'Send now' })) { if (await run(() => api.post(`/reach/campaigns/${id}/send`, {}), 'Sending started')) reload(); } }}>Send now</Button>
              <div className="flex gap-2"><Input type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} /><Button icon={<Clock className="h-4 w-4" />} disabled={!sched} onClick={async () => { if (await run(() => api.post(`/reach/campaigns/${id}/send`, { scheduled_at: new Date(sched).toISOString() }), 'Scheduled')) reload(); }}>Schedule</Button></div>
              {!me?.features.smtp && <Notice tone="warn">Delivery requires a connected Gmail account (Settings › Gmail & Calendar) or server SMTP.</Notice>}
            </div>
          </Card>}
          {c.status === 'sent' && <Card title="Results"><p className="text-sm">Sent {dateTime(c.sent_at)} to {num(c.recipient_count)} recipients.</p><Link to="/donors/email/analytics" className="text-sm text-brand-600 hover:underline">View analytics →</Link></Card>}
        </div>
      </div>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Preview" size="xl" footer={<><Button onClick={() => setPreview('desktop')}>Desktop</Button><Button onClick={() => setPreview('mobile')}>Mobile</Button></>}>
        <div className="flex justify-center bg-slate-100 p-4"><iframe title="preview" src={`/api/reach/campaigns/${id}/preview?t=${Date.now()}`} className="h-[600px] rounded-lg bg-white shadow" style={{ width: preview === 'mobile' ? 375 : 680 }} /></div>
      </Modal>
    </div>
  );
}
function BlockView({ b }: { b: any }) {
  switch (b.type) {
    case 'heading': return <h2 className="font-serif text-2xl font-bold">{b.text}</h2>;
    case 'text': return <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{b.text}</p>;
    case 'image': return b.url ? <img src={b.url} alt={b.text} className="w-full rounded-lg" /> : <div className="flex h-32 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">Image — add a URL</div>;
    case 'button': return <span className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white">{b.label}</span>;
    case 'donate': return <div className="rounded-xl bg-brand-50 p-4 text-center"><p className="mb-2 font-semibold text-brand-800">{b.text}</p>{(b.amounts ?? []).map((a: number) => <span key={a} className="m-1 inline-block rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">${a}</span>)}</div>;
    case 'video': return <p className="font-semibold text-brand-700">▶ {b.text}</p>;
    case 'divider': return <hr className="my-2" />;
    default: return null;
  }
}
function BlockEditor({ b, onChange }: { b: any; onChange: (p: any) => void }) {
  return <div className="space-y-3">
    {['heading', 'text', 'image', 'donate', 'video'].includes(b.type) && <Field label={b.type === 'image' ? 'Alt text' : 'Text'}>{b.type === 'text' ? <Textarea rows={8} value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} /> : <Input value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />}</Field>}
    {['image', 'button', 'donate', 'video'].includes(b.type) && <Field label={b.type === 'image' ? 'Image URL' : b.type === 'donate' ? 'Donation page URL' : 'Link URL'}><Input value={b.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} /></Field>}
    {b.type === 'button' && <Field label="Button label"><Input value={b.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} /></Field>}
    {b.type === 'donate' && <Field label="Suggested amounts (comma-separated)"><Input value={(b.amounts ?? []).join(', ')} onChange={(e) => onChange({ amounts: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) })} /></Field>}
  </div>;
}

// ───────── Audiences ─────────
const HEALTH = ['active', 'engaged', 'cooling', 'lapsing', 'lapsed'];
export function Audiences() {
  const { data, reload } = useApi<any>('/r/audiences?limit=200');
  const [edit, setEdit] = useState<any>(null); const { can } = useSession();
  return <>
    <Card padded={false} title="Audiences" subtitle="Segments built from CRM and giving data." actions={can('email.write') && <Button variant="primary" onClick={() => setEdit({ name: '', filters: {} })}>New audience</Button>}>
      <Table rows={data?.rows ?? []} onRowClick={(a) => setEdit(a)} cols={[{ key: 'name', label: 'Audience', render: (a) => <span className="font-medium">{a.name}</span> }, { key: 'description', label: 'Description' }, { key: 'filters', label: 'Rules', render: (a) => <span className="text-xs text-slate-500">{describeFilters(a.filters)}</span> }]} empty="No audiences yet." />
    </Card>
    {edit && <AudienceModal a={edit} onClose={() => setEdit(null)} onSaved={reload} />}
  </>;
}
function describeFilters(f: any) {
  const p: string[] = [];
  if (f.health?.length) p.push(`health: ${f.health.join('/')}`); if (f.minLifetime) p.push(`lifetime ≥ ${f.minLifetime}`); if (f.maxLifetime) p.push(`lifetime ≤ ${f.maxLifetime}`); if (f.minLastGift) p.push(`last gift ≥ ${f.minLastGift}`);
  if (f.lastGiftWithinDays) p.push(`gave in last ${f.lastGiftWithinDays}d`); if (f.lastGiftOlderThanDays) p.push(`no gift in ${f.lastGiftOlderThanDays}d`); if (f.recurring) p.push('recurring'); if (f.firstTime) p.push('first-time'); if (f.lapsed) p.push('lapsed/lapsing');
  if (f.region) p.push(`state ${f.region}`); if (f.tags?.length) p.push(`tags ${f.tags.join(',')}`); if (f.campaignId) p.push('campaign donors'); if (f.fundId) p.push('fund donors'); if (f.eventId) p.push('event registrants'); if (f.ownerUserId) p.push('owner');
  return p.join(' · ') || 'All donors with email';
}
function AudienceModal({ a, onClose, onSaved }: { a: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...a, filters: { ...(a.filters ?? {}) } });
  const [prev, setPrev] = useState<any>(null);
  const campaigns = useCampaigns() ?? []; const funds = useFunds() ?? []; const events = useApi<any>('/r/events?limit=200');
  const { run, busy } = useAction();
  const f = v.filters; const setF = (k: string, val: any) => setV({ ...v, filters: { ...f, [k]: val === '' || val === false ? undefined : val } });
  useEffect(() => { const t = setTimeout(() => api.post('/reach/audiences/preview', { filters: v.filters }).then(setPrev).catch(() => {}), 300); return () => clearTimeout(t); }, [JSON.stringify(v.filters)]); // eslint-disable-line
  return <Modal open onClose={onClose} title={a.id ? 'Edit audience' : 'New audience'} size="lg" footer={<>{a.id && <Button variant="ghost" className="mr-auto text-red-600" onClick={async () => { if (await run(() => api.del(`/r/audiences/${a.id}`), 'Audience deleted')) { onSaved(); onClose(); } }}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const body = { name: v.name, description: v.description ?? null, filters: v.filters }; if (await run(() => (a.id ? api.patch(`/r/audiences/${a.id}`, body) : api.post('/r/audiences', body)), 'Audience saved')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Description"><Input value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <Field label="Donor health" className="sm:col-span-2"><div className="flex flex-wrap gap-3">{HEALTH.map((h) => <Checkbox key={h} label={label(h)} checked={(f.health ?? []).includes(h)} onChange={(e) => setF('health', e.target.checked ? [...(f.health ?? []), h] : (f.health ?? []).filter((x: string) => x !== h))} />)}</div></Field>
      <Field label="Min lifetime giving"><Input type="number" value={f.minLifetime ?? ''} onChange={(e) => setF('minLifetime', e.target.value ? Number(e.target.value) : '')} /></Field>
      <Field label="Max lifetime giving"><Input type="number" value={f.maxLifetime ?? ''} onChange={(e) => setF('maxLifetime', e.target.value ? Number(e.target.value) : '')} /></Field>
      <Field label="Min last gift amount"><Input type="number" value={f.minLastGift ?? ''} onChange={(e) => setF('minLastGift', e.target.value ? Number(e.target.value) : '')} /></Field>
      <Field label="Gave within (days)"><Input type="number" value={f.lastGiftWithinDays ?? ''} onChange={(e) => setF('lastGiftWithinDays', e.target.value ? Number(e.target.value) : '')} /></Field>
      <Field label="No gift in (days)"><Input type="number" value={f.lastGiftOlderThanDays ?? ''} onChange={(e) => setF('lastGiftOlderThanDays', e.target.value ? Number(e.target.value) : '')} /></Field>
      <Field label="State / province"><Input value={f.region ?? ''} onChange={(e) => setF('region', e.target.value)} /></Field>
      <Field label="Tags (comma-separated)"><Input value={(f.tags ?? []).join(',')} onChange={(e) => setF('tags', e.target.value ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : '')} /></Field>
      <Field label="Gave to campaign"><Select value={f.campaignId ?? ''} onChange={(e) => setF('campaignId', e.target.value)} placeholder="Any" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Supported fund"><Select value={f.fundId ?? ''} onChange={(e) => setF('fundId', e.target.value)} placeholder="Any" options={funds.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Registered for event"><Select value={f.eventId ?? ''} onChange={(e) => setF('eventId', e.target.value)} placeholder="Any" options={(events.data?.rows ?? []).map((c: any) => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Workspace"><WorkspaceSelect value={f.ministryId ?? ''} onChange={(x) => setF('ministryId', x)} placeholder="Any" /></Field>
      <div className="flex flex-wrap gap-4 sm:col-span-2"><Checkbox label="Recurring donors" checked={Boolean(f.recurring)} onChange={(e) => setF('recurring', e.target.checked)} /><Checkbox label="First-time donors" checked={Boolean(f.firstTime)} onChange={(e) => setF('firstTime', e.target.checked)} /><Checkbox label="Lapsed / lapsing" checked={Boolean(f.lapsed)} onChange={(e) => setF('lapsed', e.target.checked)} /></div>
    </div>
    {prev && <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><b>{num(prev.count)}</b> reachable recipients. {prev.sample.slice(0, 5).map((s: any) => s.name).join(', ')}{prev.count > 5 ? '…' : ''}</div>}
  </Modal>;
}

// ───────── Journeys ─────────
const TRIGGERS = ['donor_created', 'first_gift', 'donor_lapsed', 'recurring_started', 'event_registration', 'campaign_gift'];
export function Journeys() {
  const { data, reload } = useApi<any>('/r/journeys?limit=200');
  const approvals = useApi<any[]>('/reach/journeys/approvals');
  const [edit, setEdit] = useState<any>(null);
  const { can } = useSession(); const { run } = useAction();
  return <div className="space-y-4">
    {Boolean(approvals.data?.length) && <Card title={`Awaiting approval (${approvals.data!.length})`} subtitle="Approval-mode journeys wait for a person before each email." padded={false}>
      <Table rows={approvals.data!} cols={[{ key: 'journey_name', label: 'Journey' }, { key: 'donor_name', label: 'Donor', render: (r) => <Link to={`/donors/${r.donor_id}`} className="hover:underline">{r.donor_name}</Link> }, { key: 'email', label: 'Email' }, { key: 'step', label: 'Step', render: (r) => r.step?.subject },
        { key: 'a', label: '', render: (r) => can('email.send') && <div className="flex gap-1"><Button size="sm" variant="primary" onClick={async () => { if (await run(() => api.post(`/reach/journeys/enrollments/${r.id}/approve`), 'Approved — sending')) approvals.reload(); }}>Approve & send</Button><Button size="sm" onClick={async () => { if (await run(() => api.post(`/reach/journeys/enrollments/${r.id}/skip`), 'Skipped')) approvals.reload(); }}>Skip</Button><Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/reach/journeys/enrollments/${r.id}/cancel`), 'Removed from journey')) approvals.reload(); }}>Cancel</Button></div> }]} />
    </Card>}
    <Card padded={false} title="Journeys" subtitle="Automated communication sequences triggered by database events. Any automation can be paused." actions={can('email.write') && <Button variant="primary" onClick={() => setEdit({ name: '', trigger: 'first_gift', mode: 'approval', steps: [] })}>New journey</Button>}>
      <Table rows={data?.rows ?? []} onRowClick={(j) => setEdit(j)} cols={[{ key: 'name', label: 'Journey', render: (j) => <span className="font-medium">{j.name}</span> }, { key: 'trigger', label: 'Trigger', render: (j) => label(j.trigger) }, { key: 'mode', label: 'Mode', render: (j) => <Chip value={j.mode === 'automatic' ? 'sending' : 'pending'}>{label(j.mode)}</Chip> },
        { key: 'step_count', label: 'Steps', align: 'right' }, { key: 'in_progress', label: 'In progress', align: 'right' }, { key: 'status', label: 'Status', render: (j) => <Chip value={j.status === 'active' ? 'active' : 'paused'} /> },
        { key: 't', label: '', render: (j) => can('email.send') && <Button size="sm" onClick={async (e) => { e.stopPropagation(); if (await run(() => api.post(`/reach/journeys/${j.id}/status`, { status: j.status === 'active' ? 'paused' : 'active' }), j.status === 'active' ? 'Journey paused' : 'Journey activated')) reload(); }}>{j.status === 'active' ? 'Pause' : 'Activate'}</Button> }]} empty="No journeys yet." />
    </Card>
    {edit && <JourneyModal j={edit} onClose={() => setEdit(null)} onSaved={reload} />}
  </div>;
}
function JourneyModal({ j, onClose, onSaved }: { j: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...j, steps: [...(j.steps ?? [])] }); const { run, busy } = useAction();
  const setStep = (i: number, p: any) => setV({ ...v, steps: v.steps.map((s: any, k: number) => (k === i ? { ...s, ...p } : s)) });
  return <Modal open onClose={onClose} title={j.id ? 'Edit journey' : 'New journey'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const body = { name: v.name, trigger: v.trigger, mode: v.mode, steps: v.steps }; if (await run(() => (j.id ? api.patch(`/r/journeys/${j.id}`, body) : api.post('/r/journeys', body)), 'Journey saved')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Trigger"><Select value={v.trigger} onChange={(e) => setV({ ...v, trigger: e.target.value })} options={TRIGGERS.map((t) => ({ value: t, label: label(t) }))} /></Field>
      <Field label="Mode" hint="Approval = a person approves each email"><Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })} options={[{ value: 'approval', label: 'Requires approval' }, { value: 'automatic', label: 'Automatic' }]} /></Field></div>
    <div className="mt-4 space-y-3">{v.steps.map((s: any, i: number) => <div key={i} className="rounded-xl border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-slate-500">Step {i + 1}<button className="text-red-600" onClick={() => setV({ ...v, steps: v.steps.filter((_: any, k: number) => k !== i) })}>Remove</button></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4"><Field label="Wait (days)"><Input type="number" value={s.delayDays ?? 0} onChange={(e) => setStep(i, { delayDays: Number(e.target.value) })} /></Field><Field label="Subject" className="sm:col-span-3"><Input value={s.subject ?? ''} onChange={(e) => setStep(i, { subject: e.target.value })} /></Field>
        <Field label="Message" className="sm:col-span-4"><Textarea rows={4} value={s.blocks?.[0]?.text ?? ''} onChange={(e) => setStep(i, { blocks: [{ type: 'text', text: e.target.value }] })} /></Field></div></div>)}
      <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setV({ ...v, steps: [...v.steps, { delayDays: v.steps.length ? 7 : 0, subject: '', blocks: [{ type: 'text', text: 'Dear {{first_name}},\n\n' }] }] })}>Add step</Button></div>
  </Modal>;
}

export function Templates() {
  const nav = useNavigate(); const { run } = useAction();
  return <ResourcePage resource="email_templates" title="Template" writePerm="email.write" fields={[{ key: 'name', label: 'Name', required: true }, { key: 'subject', label: 'Subject' }]}
    cols={[{ key: 'name', label: 'Template', render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: 'subject', label: 'Subject' }, { key: 'use', label: '', render: (r: any) => <Button size="sm" onClick={async (e) => { e.stopPropagation(); const c = await run(() => api.post('/reach/campaigns', { name: r.name, subject: r.subject, blocks: r.blocks ?? [] }), 'Campaign created from template'); if (c) nav(`/donors/email/campaigns/${c.id}`); }}>Use template</Button> }]}
    emptyText="Save reusable email layouts. To capture an existing campaign's design, create a template here and paste its blocks via Duplicate." />;
}

export function Grow() {
  const { me } = useSession(); const { push } = useToast();
  const events = useApi<any>('/r/events?status=published&limit=50');
  const snippet = `<form action="${window.location.origin}/api/public/subscribe/${me?.tenant?.id}" method="POST">\n  <input name="first_name" placeholder="First name" />\n  <input name="email" type="email" placeholder="Email" required />\n  <button type="submit">Stay in touch</button>\n</form>`;
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Website signup form" subtitle="New subscribers are added to the donor database (tag: subscriber) and can trigger the “Donor created” journey.">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{snippet}</pre>
      <Button className="mt-3" size="sm" onClick={() => { navigator.clipboard.writeText(snippet); push('success', 'Embed code copied'); }}>Copy embed code</Button>
    </Card>
    <Card title="Event registration pages" subtitle="Every registrant becomes (or is matched to) a constituent.">
      {(events.data?.rows ?? []).filter((e: any) => e.is_public).map((e: any) => <div key={e.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-sm"><span>{e.name}</span><a className="text-brand-600 hover:underline" href={`/e/${e.slug}`} target="_blank" rel="noreferrer">Open page</a></div>)}
      {!events.data?.rows?.length && <p className="text-sm text-slate-500">No published events.</p>}
    </Card>
  </div>;
}

export function EmailAnalytics() {
  const { data } = useApi<any>('/reach/analytics');
  const [gifts, setGifts] = useState<any>(null);
  if (!data) return <Spinner />;
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <Metric label="Emails delivered" value={num(data.delivered)} /><Metric label="Open rate" value={pct(data.openRate)} /><Metric label="Click rate" value={pct(data.clickRate)} /><Metric label="Click-to-open" value={pct(data.clickToOpen)} />
      <Metric label="Inbox health" value={data.inboxHealth.rating} tone={data.inboxHealth.rating === 'Good' ? 'good' : data.inboxHealth.rating === 'Fair' ? 'warn' : 'bad'} sub={`Bounce ${data.inboxHealth.bounceRate}% · complaints ${data.inboxHealth.complaintRate}%`} />
      <Metric label="Gifts attributed" value={money(data.giftsAttributed)} tone="good" sub={`${data.attributionWindowDays}-day window`} /><Metric label="Unsubscribes" value={num(data.unsubscribes)} /><Metric label="Bounces" value={num(data.bounces)} />
    </div>
    <Notice>{data.note}</Notice>
    <Card title="Trend — last 12 months"><div className="h-64"><ResponsiveContainer><LineChart data={data.trend}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Line dataKey="delivered" stroke="#6366f1" /><Line dataKey="opens" stroke="#10b981" /><Line dataKey="clicks" stroke="#f59e0b" /></LineChart></ResponsiveContainer></div>{!data.trend.length && <p className="text-center text-sm text-slate-500">No sends yet.</p>}</Card>
    <Card padded={false} title="Campaign comparison"><Table rows={data.campaigns} cols={[{ key: 'name', label: 'Campaign', render: (c) => <Link className="hover:underline" to={`/donors/email/campaigns/${c.id}`}>{c.name}</Link> }, { key: 'sent_at', label: 'Sent', render: (c) => date(c.sent_at) }, { key: 'delivered', label: 'Delivered', align: 'right' },
      { key: 'opens', label: 'Open rate', align: 'right', render: (c) => (c.delivered ? pct((c.opens / c.delivered) * 100) : '—') }, { key: 'clicks', label: 'Click rate', align: 'right', render: (c) => (c.delivered ? pct((c.clicks / c.delivered) * 100) : '—') },
      { key: 'unsubscribes', label: 'Unsubs', align: 'right' }, { key: 'bounces', label: 'Bounces', align: 'right' },
      { key: 'gifts_attributed', label: 'Gifts attributed', align: 'right', render: (c) => <button className="text-brand-700 hover:underline" onClick={async () => setGifts({ c, rows: await api.get(`/reach/campaigns/${c.id}/attributed-gifts`) })}>{money(c.gifts_attributed)} ({c.gift_count})</button> }]} empty="No sent campaigns yet." /></Card>
    <Modal open={Boolean(gifts)} onClose={() => setGifts(null)} title={`Gifts attributed — ${gifts?.c.name}`} size="lg"><Table rows={gifts?.rows ?? []} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'donor_name', label: 'Donor', render: (g) => <Link to={`/donors/${g.donor_id}`} className="hover:underline">{g.donor_name}</Link> }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money(g.amount, 2) }, { key: 'basis', label: 'Basis' }]} /></Modal>
  </div>;
}

export function ReachSettings() {
  const { data, reload } = useApi<any>('/settings'); const { can, me } = useSession(); const { run } = useAction();
  const [win, setWin] = useState<number>(7);
  useEffect(() => { if (data) setWin(data.tenant.attribution_window_days); }, [data]);
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Delivery"><p className="text-sm text-slate-600">Emails send from the sender's connected Gmail account, or from the server's SMTP service when configured.</p>
      <ul className="mt-3 space-y-1 text-sm"><li>Server SMTP: <Chip value={me?.features.smtp ? 'connected' : 'disconnected'}>{me?.features.smtp ? 'Configured' : 'Not configured'}</Chip></li><li>Gmail: <Link className="text-brand-600 hover:underline" to="/settings?tab=google">Manage in Settings</Link></li></ul></Card>
    <Card title="Gift attribution"><Field label="Attribution window (days after send)" hint="Gifts by recipients within this window are attributed to the email."><Input type="number" min={1} max={90} value={win} onChange={(e) => setWin(Number(e.target.value))} disabled={!can('settings.manage')} /></Field>
      {can('settings.manage') && <Button className="mt-3" onClick={async () => { if (await run(() => api.patch('/settings', { attribution_window_days: win }), 'Saved')) reload(); }}>Save</Button>}</Card>
    <Card title="Compliance"><p className="text-sm text-slate-600">Every campaign includes an unsubscribe link and List-Unsubscribe header. Unsubscribes and hard bounces are suppressed automatically, and donors' email preference is updated.</p></Card>
  </div>;
}
export const _r = { useMemo, Save, RecordModal, invalidate };
