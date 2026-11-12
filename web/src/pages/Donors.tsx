import React, { useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Plus, Upload, MessageSquareText, Receipt, Layers, HandCoins, Search, Download, Phone, Mail, CheckCheck, ListPlus, FileText, ArrowRightLeft, Sparkles } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { api, useApi, qs, download, downloadPost } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, PillTabs, Spinner, ErrorBox, Modal, Field, Input, Select, Textarea, Table, Pager, SearchInput, Chip, Empty, Notice, useAction, useToast, cx, Checkbox } from '../components/ui';
import { DonorModal, GiftModal, TaskModal, DraftModal, ContactModal, HealthChip, ScoreBadge, FundSelect, DonorPicker, WorkspaceSelect, TeamSelect, useCampaigns, GIFT_TYPES, PAYMENT_METHODS, DONOR_TYPES, donorTypeLabel } from '../components/domain';
import { DonorsInsights } from './DonorsHub';
import { money, num, date, label, today } from '../lib/format';

const HEALTH_COLORS: Record<string, string> = { active: '#10b981', engaged: '#0ea5e9', cooling: '#f59e0b', lapsing: '#f97316', lapsed: '#ef4444' };

/** Top-level Donors area with its action bar. */
export function DonorsShell() {
  const { can } = useSession();
  const [modal, setModal] = useState<null | 'donor' | 'gift' | 'batch' | 'texts' | 'receipts'>(null);
  const nav = useNavigate();
  React.useEffect(() => { const f = () => setModal('donor'); window.addEventListener('ainp:add-donor', f); return () => window.removeEventListener('ainp:add-donor', f); }, []);
  return (
    <>
      <PageHeader title="Donors" subtitle="Fundraising intelligence — who to call, what to say, and where future gifts may come from."
        actions={<>
          {can('data.import') && <Button size="sm" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => nav('/settings?tab=data&preset=donor-crm-a')}>Migrate</Button>}
          {can('data.import') && <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => nav('/settings?tab=data')}>Import</Button>}
          {can('donors.write') && <Button size="sm" icon={<MessageSquareText className="h-4 w-4" />} onClick={() => setModal('texts')}>Texts</Button>}
          {can('gifts.write') && <Button size="sm" icon={<Receipt className="h-4 w-4" />} onClick={() => nav('/donors/giving/receipts')}>Receipts</Button>}
          {can('donors.write') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('donor')}>Add Donor</Button>}
          {can('gifts.write') && <Button size="sm" icon={<Layers className="h-4 w-4" />} onClick={() => setModal('batch')}>Batch Gifts</Button>}
          {can('gifts.write') && <Button size="sm" variant="primary" icon={<HandCoins className="h-4 w-4" />} onClick={() => setModal('gift')}>Add Donation</Button>}
        </>}>
        <PillTabs className="mt-4" tabs={[
          { to: '/donors/giving', label: 'Donors & Giving', hidden: !can('donors.read') }, { to: '/donors/grants', label: 'Grants', hidden: !can('grants.read') },
          { to: '/donors/projects', label: 'Projects', hidden: !can('projects.read') }, { to: '/donors/email', label: 'Email', hidden: !can('email.read') }, { to: '/donors/events', label: 'Events', hidden: !can('events.read') }]} />
      </PageHeader>
      <Outlet />
      <DonorModal open={modal === 'donor'} onClose={() => setModal(null)} onSaved={(d) => nav(`/donors/${d.id}`)} />
      <GiftModal open={modal === 'gift'} onClose={() => setModal(null)} onSaved={() => window.dispatchEvent(new Event('ainp:refresh'))} />
      <BatchGiftsModal open={modal === 'batch'} onClose={() => setModal(null)} />
      <TextsModal open={modal === 'texts'} onClose={() => setModal(null)} />
    </>
  );
}

export function GivingShell() {
  const { workspaces, term } = useSession();
  const [sp, setSp] = useSearchParams();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PillTabs tabs={[{ to: '/donors/giving', label: 'Overview', end: true }, { to: '/donors/giving/donors', label: 'Donors' }, { to: '/donors/giving/priorities', label: 'Priorities' },
          { to: '/donors/giving/trips', label: 'Trips' }, { to: '/donors/giving/outreach', label: 'Outreach' }, { to: '/donors/giving/campaigns', label: 'Campaigns' }, { to: '/donors/giving/audit', label: 'Growth Audit' }, { to: '/donors/giving/reports', label: 'Reports' }]} />
        {workspaces.length > 1 && <div className="w-56"><WorkspaceSelect value={sp.get('ministry_id') ?? ''} onChange={(v) => { const n = new URLSearchParams(sp); v ? n.set('ministry_id', v) : n.delete('ministry_id'); setSp(n); }} placeholder={`All ${term === 'Ministry' ? 'ministries' : term.toLowerCase() + 's'}`} /></div>}
      </div>
      <Outlet />
    </div>
  );
}

export function GivingOverviewRoute() { const [sp] = useSearchParams(); return <DonorsOverview ministryId={sp.get('ministry_id') ?? ''} />; }

/** Today's Fundraising Moves + donor health + thank-you/receipt queues. */
export function DonorsOverview({ ministryId }: { ministryId?: string }) {
  return <DonorsInsights ministryId={ministryId}>{(m) => <DonorActions ministryId={m || undefined} />}</DonorsInsights>;
}
function DonorActions({ ministryId }: { ministryId?: string }) {
  const { data, loading, error, reload } = useApi<any>(`/donors/intel/overview${qs({ ministry_id: ministryId, moves: 12 })}`);
  React.useEffect(() => { const f = () => reload(); window.addEventListener('ainp:refresh', f); return () => window.removeEventListener('ainp:refresh', f); }, [reload]);
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const k = data.kpis;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2"><h3 className="text-lg font-semibold text-slate-900">What to do next</h3>
        <Link to="/donors/giving/priorities" className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Opportunity in your donor base (estimate): {money(k.opportunity)}</Link></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Today's Fundraising Moves" subtitle="Ranked by priority and estimated opportunity. Suggestions, not certainties." className="xl:col-span-2" padded={false}
          actions={<Link to="/donors/giving/priorities/calls" className="text-xs text-brand-600 hover:underline">Call lists</Link>}>
          {!data.moves.length ? <div className="p-5"><Empty title="No moves right now">Everyone has been contacted recently. Add donors or gifts to generate new recommendations.</Empty></div> :
            <ul className="divide-y divide-slate-100">{data.moves.map((m: any) => <MoveItem key={m.id} m={m} onDone={reload} />)}</ul>}
        </Card>
        <div className="space-y-5">
          <Card title="Donor health">
            <div className="h-44"><ResponsiveContainer><BarChart data={data.health} layout="vertical" margin={{ left: 10 }}><XAxis type="number" hide /><YAxis type="category" dataKey="status" tickFormatter={label} tick={{ fontSize: 12 }} width={70} /><Tooltip /><Bar dataKey="count" radius={[0, 6, 6, 0]} onClick={(d: any) => nav(`/donors/giving/donors?health=${d.status}`)} cursor="pointer">{data.health.map((h: any) => <Cell key={h.status} fill={HEALTH_COLORS[h.status]} />)}</Bar></BarChart></ResponsiveContainer></div>
            <div className="mt-2 flex flex-wrap gap-1.5">{data.health.map((h: any) => <Link key={h.status} to={`/donors/giving/donors?health=${h.status}`}><Chip value={h.status}>{label(h.status)} · {h.count}</Chip></Link>)}</div>
          </Card>
          <QueueCard title="Thank-Yous to Send" field="thank_you_status" rows={data.thankYous} onChange={reload} />
          <QueueCard title="Receipts to Send" field="receipt_status" rows={data.receipts} onChange={reload} />
        </div>
      </div>
    </div>
  );
}

function MoveItem({ m, onDone }: { m: any; onDone: () => void }) {
  const { can } = useSession();
  const [modal, setModal] = useState<null | 'task' | 'email' | 'script' | 'text' | 'call'>(null);
  const { run } = useAction();
  const donor = { id: m.id, name: m.name };
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Link to={`/donors/${m.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{m.name}</Link><HealthChip status={m.health_status} /><Chip value={(m.priority ?? '').toLowerCase()}>{m.priority}</Chip><span className="text-xs text-slate-500">{m.opportunity}</span></div>
          <p className="mt-1 text-sm text-slate-700">{m.next_step}</p>
          <p className="mt-1 text-xs text-slate-500">Why: {(m.reasons ?? []).join(' · ') || '—'} · Lifetime {money(m.lifetime)} · Last gift {m.last_gift ? `${date(m.last_gift)} (${money(m.last_amount)})` : 'never'}</p>
        </div>
        <div className="text-right"><div className="text-xs uppercase text-slate-500">Suggested ask</div><div className="font-bold">{money(m.ask_low)}–{money(m.ask_high)}{m.is_monthly ? '/mo' : ''}</div><div className="text-xs text-slate-500">Opportunity ≈ {money(m.opportunity_value)}</div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {can('work.write') && <Button size="sm" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => setModal('task')}>Create Task</Button>}
        {can('ai.ask') && <Button size="sm" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setModal('email')}>Email</Button>}
        {can('ai.ask') && <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setModal('script')}>Call Script</Button>}
        {m.phone && <a href={`tel:${m.phone}`} onClick={() => setTimeout(() => setModal('call'), 300)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"><Phone className="h-3.5 w-3.5" />Call</a>}
        {m.phone && can('donors.write') && <Button size="sm" icon={<MessageSquareText className="h-3.5 w-3.5" />} onClick={() => setModal('text')}>Text</Button>}
        {can('donors.write') && <Button size="sm" variant="subtle" icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={async () => { if (await run(() => api.post(`/donors/${m.id}/move-done`), 'Marked done and logged')) onDone(); }}>Done</Button>}
      </div>
      <TaskModal open={modal === 'task'} onClose={() => setModal(null)} defaults={{ title: `${m.opportunity}: ${m.name}`, donor_id: m.id, due_date: m.follow_up_on, next_step: m.next_step, category: 'Fundraising' }} onSaved={onDone} />
      <DraftModal open={modal === 'email'} onClose={() => setModal(null)} kind={m.category === 'thank_you' ? 'thank_you' : m.category === 'event_invitation' ? 'event_invitation' : 'donor_email'} donorId={m.id} title={`Email draft — ${m.name}`} context={m.next_step} />
      <DraftModal open={modal === 'script'} onClose={() => setModal(null)} kind="call_script" donorId={m.id} title={`Call script — ${m.name}`} context={m.next_step} />
      <TextModal open={modal === 'text'} onClose={() => setModal(null)} donor={{ ...donor, phone: m.phone }} onSent={onDone} />
      <ContactModal open={modal === 'call'} onClose={() => setModal(null)} donor={donor} defaultType="phone" onSaved={onDone} />
    </li>
  );
}

function QueueCard({ title, field, rows, onChange }: { title: string; field: 'thank_you_status' | 'receipt_status'; rows: any[]; onChange: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { can } = useSession(); const { run, busy } = useAction();
  const mark = async (ids: string[]) => { if (await run(() => api.post('/donors/queues/mark', { giftIds: ids, field, status: 'sent' }), `${ids.length} marked sent`)) { setSel(new Set()); onChange(); } };
  return (
    <Card title={`${title} (${rows.length})`} padded={false} actions={can('gifts.write') && rows.length > 0 && <>
      {field === 'receipt_status' && <Button size="sm" onClick={async () => { const ids = sel.size ? [...sel] : rows.map((r) => r.id); const r = await run(() => api.post('/giving/receipts/generate', { giftIds: ids })); if (r) { await downloadPost('/giving/receipts/batch-pdf', { ids: r.receipts.map((x: any) => x.id) }, `receipts-${today()}.pdf`); onChange(); } }}>Generate PDFs</Button>}
      <Button size="sm" variant="primary" loading={busy} onClick={() => mark(sel.size ? [...sel] : rows.map((r) => r.id))}>{sel.size ? `Mark ${sel.size} sent` : 'Mark all sent'}</Button></>}>
      {!rows.length ? <p className="px-5 py-4 text-sm text-slate-500">All caught up.</p> :
        <div className="max-h-72 overflow-y-auto"><Table rows={rows} selectable={can('gifts.write')} selected={sel} onSelect={setSel} cols={[
          { key: 'donor', label: 'Donor', render: (r) => <Link className="font-medium hover:text-brand-700" to={`/donors/${r.donor_id}`}>{r.donor}</Link> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
          { key: 'gift_date', label: 'Date', render: (r) => date(r.gift_date) },
          { key: 'fund', label: 'Fund', render: (r) => <span className="text-xs">{r.fund}</span> },
          { key: 'status', label: 'Status', render: () => <Chip value="pending" /> }]} /></div>}
    </Card>
  );
}

// ───────── Donor list ─────────
export function DonorList() {
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'offset') n.delete('offset'); setSp(n, { replace: true }); };
  const { data, loading, error, reload } = useApi<any>(`/donors${qs({ ...q, limit: 50 })}`);
  const { can, me } = useSession();
  const nav = useNavigate(); const { push } = useToast();
  const saved = useApi<any>('/r/saved_filters?scope=donors');
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <SearchInput value={q.q ?? ''} onChange={(v) => set('q', v)} placeholder="Name, email, phone, city…" />
        <Select className="w-36" value={q.health ?? ''} onChange={(e) => set('health', e.target.value)} placeholder="All health" options={['active', 'engaged', 'cooling', 'lapsing', 'lapsed'].map((h) => ({ value: h, label: label(h) }))} />
        <Select className="w-48" value={q.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="All opportunities" options={['lapsed_major', 'major_donor_call', 'campaign_follow_up', 'year_end', 'recurring_upgrade', 'first_time_follow_up', 'event_invitation', 'reactivate_lapsed', 'thank_you', 'cultivate'].map((c) => ({ value: c, label: label(c) }))} />
        <Select className="w-36" value={q.donor_type ?? ''} onChange={(e) => set('donor_type', e.target.value)} placeholder="All types" options={DONOR_TYPES.map((t) => ({ value: t, label: donorTypeLabel(t) }))} />
        <Input className="w-28" placeholder="Tag" value={q.tag ?? ''} onChange={(e) => set('tag', e.target.value)} />
        <Input className="w-28" placeholder="State/Prov." value={q.region ?? ''} onChange={(e) => set('region', e.target.value)} />
        <Input className="w-32" type="number" placeholder="Min lifetime" value={q.min_lifetime ?? ''} onChange={(e) => set('min_lifetime', e.target.value)} />
        <Select className="w-36" value={q.owner ?? ''} onChange={(e) => set('owner', e.target.value)} placeholder="Any owner" options={[{ value: 'me', label: 'Mine' }]} />
        <Checkbox label="Recurring" checked={q.recurring === 'true'} onChange={(e) => set('recurring', e.target.checked ? 'true' : '')} />
        <div className="ml-auto flex flex-wrap gap-2">
          {saved.data?.rows?.length > 0 && <Select className="w-40" value="" onChange={(e) => { const f = saved.data.rows.find((r: any) => r.id === e.target.value); if (f) setSp(new URLSearchParams(f.filters)); }} placeholder="Saved filters" options={saved.data.rows.map((r: any) => ({ value: r.id, label: r.name }))} />}
          <Button size="sm" onClick={async () => { const name = prompt('Name this filter'); if (name) { await api.post('/r/saved_filters', { scope: 'donors', name, filters: q }); saved.reload(); push('success', 'Filter saved'); } }}>Save filter</Button>
          {can('data.export') && <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => download(`/donors/export${qs({ ...q, format: 'csv' })}`)}>CSV</Button>}
          {can('data.export') && <Button size="sm" onClick={() => download(`/donors/export${qs({ ...q, format: 'xlsx' })}`)}>XLSX</Button>}
        </div>
      </div>
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : loading && !data ? <Spinner /> :
        !data.total && !Object.keys(q).length ? <div className="p-4"><Empty title="No donors yet" action={<><Button variant="primary" onClick={() => window.dispatchEvent(new Event('ainp:add-donor'))}>Add Donor</Button><Button onClick={() => nav('/settings?tab=data')}>Import Donors</Button></>}>Add donors one at a time or import a CSV from your previous system.</Empty></div> :
        <>
          <Table rows={data.rows} onRowClick={(r) => nav(`/donors/${r.id}`)} sort={{ key: q.sort ?? 'score', dir: (q.dir as any) ?? 'desc' }}
            onSort={(k) => { const n = new URLSearchParams(sp); n.set('sort', k); n.set('dir', (q.sort ?? 'score') === k && q.dir !== 'asc' ? 'asc' : 'desc'); setSp(n, { replace: true }); }}
            cols={[
              { key: 'name', label: 'Donor', sortable: true, render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{[r.email, r.phone].filter(Boolean).join(' · ')}</div></div> },
              { key: 'health', label: 'Health', sortable: true, render: (r) => <HealthChip status={r.health_status} override={r.health_override} /> },
              { key: 'score', label: 'Score', sortable: true, render: (r) => <ScoreBadge score={r.score} /> },
              { key: 'lifetime', label: 'Lifetime', align: 'right', sortable: true, render: (r) => money(r.lifetime) },
              { key: 'last_gift', label: 'Last gift', sortable: true, render: (r) => r.last_gift ? <span>{date(r.last_gift)}<span className="block text-xs text-slate-500">{money(r.last_amount)}</span></span> : '—' },
              { key: 'opportunity', label: 'Opportunity', render: (r) => <span className="text-xs">{r.opportunity}</span> },
              { key: 'suggested_ask', label: 'Suggested ask', align: 'right', render: (r) => r.suggested_ask ? money(r.suggested_ask) : '—' },
              { key: 'city', label: 'Location', sortable: true, render: (r) => [r.city, r.region].filter(Boolean).join(', ') || '—' },
              { key: 'owner_name', label: 'Owner', render: (r) => r.owner_name ?? '—' },
            ]} />
          <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={(o) => set('offset', String(o))} />
        </>}
    </Card>
  );
}

// ───────── Batch gifts ─────────
function BatchGiftsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(`Batch ${today()}`);
  const [rows, setRows] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>({ gift_date: today(), payment_method: 'check', fund_id: '' });
  const { run, busy } = useAction();
  React.useEffect(() => { if (open) setRows([{ key: 1 }, { key: 2 }, { key: 3 }]); }, [open]);
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const upd = (i: number, k: string, v: any) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Modal open={open} onClose={onClose} title="Batch gift entry" size="xl"
      footer={<><span className="mr-auto self-center text-sm text-slate-600">{rows.filter((r) => r.donor && r.amount).length} gifts · {money(total, 2)}</span><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => {
          const gifts = rows.filter((r) => r.donor && r.amount).map((r) => ({ donor_id: r.donor.id, amount: Number(r.amount), gift_date: r.gift_date || defaults.gift_date, fund_id: r.fund_id || defaults.fund_id, payment_method: r.payment_method || defaults.payment_method, notes: r.notes || null, gift_type: 'one_time' }));
          if (!gifts.length) return;
          const r = await run(() => api.post('/giving/gifts/batch', { name, gifts }), 'Batch posted to the ledger'); if (r) { onClose(); window.dispatchEvent(new Event('ainp:refresh')); } }}>Post batch</Button></>}>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Batch name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Default date"><Input type="date" value={defaults.gift_date} onChange={(e) => setDefaults({ ...defaults, gift_date: e.target.value })} /></Field>
        <Field label="Default fund"><FundSelect value={defaults.fund_id} onChange={(v) => setDefaults({ ...defaults, fund_id: v })} /></Field>
        <Field label="Default payment"><Select value={defaults.payment_method} onChange={(e) => setDefaults({ ...defaults, payment_method: e.target.value })} options={PAYMENT_METHODS} /></Field>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-1 items-start gap-2 rounded-xl border border-slate-100 p-2 sm:grid-cols-[2fr_1fr_1fr_1.4fr_1.6fr]">
            <DonorPicker value={r.donor ?? null} onChange={(d) => upd(i, 'donor', d)} />
            <Input type="number" placeholder="Amount" value={r.amount ?? ''} onChange={(e) => upd(i, 'amount', e.target.value)} />
            <Input type="date" value={r.gift_date ?? ''} onChange={(e) => upd(i, 'gift_date', e.target.value)} placeholder="Default" />
            <FundSelect value={r.fund_id ?? ''} onChange={(v) => upd(i, 'fund_id', v)} placeholder="Default fund" allowEmpty />
            <Input placeholder="Notes / check #" value={r.notes ?? ''} onChange={(e) => upd(i, 'notes', e.target.value)} />
          </div>
        ))}
      </div>
      <Button className="mt-3" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRows((rs) => [...rs, { key: Date.now() }])}>Add row</Button>
      <p className="mt-3 text-xs text-slate-500">All gifts in a batch post together — if any row is invalid, nothing is posted and the row number is reported.</p>
    </Modal>
  );
}

// ───────── Texts (no SMS provider: opens the device's messaging app and logs the text) ─────────
export function TextModal({ open, onClose, donor, onSent }: { open: boolean; onClose: () => void; donor: { id: string; name: string; phone?: string }; onSent?: () => void }) {
  const [body, setBody] = useState(''); const { run } = useAction();
  React.useEffect(() => { if (open) setBody(`Hi ${donor.name.split(' ')[0]}, `); }, [open]); // eslint-disable-line
  return (
    <Modal open={open} onClose={onClose} title={`Text ${donor.name}`} footer={<><Button onClick={onClose}>Cancel</Button>
      <a href={`sms:${donor.phone}?&body=${encodeURIComponent(body)}`} onClick={async () => { await run(() => api.post(`/donors/${donor.id}/contact`, { type: 'text', subject: 'Text message', body }), 'Text logged to donor history'); onSent?.(); onClose(); }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"><MessageSquareText className="h-4 w-4" />Open in Messages & log</a></>}>
      <Field label={`To ${donor.phone ?? '(no phone on file)'}`}><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-slate-500">Opens your phone's messaging app with this text pre-filled. A.I. Fundraising logs the text on the donor's record; it never sends texts on its own.</p>
    </Modal>
  );
}
function TextsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [full, setFull] = useState<any>(null);
  React.useEffect(() => { if (!open) { setD(null); setFull(null); } }, [open]);
  React.useEffect(() => { if (d) api.get(`/donors/${d.id}`).then((x) => setFull(x.donor)); }, [d]);
  if (full) return <TextModal open={open} onClose={onClose} donor={{ id: full.id, name: full.name, phone: full.phone }} />;
  return <Modal open={open} onClose={onClose} title="Texts"><Field label="Who would you like to text?"><DonorPicker value={d} onChange={setD} /></Field>
    <div className="mt-4"><Notice>Texts open on your device and are logged to the donor's communication history. Use <Link className="underline" to="/work/communications?type=text">Communications</Link> to review text history.</Notice></div></Modal>;
}

// ───────── Receipts center ─────────
export function ReceiptsPage() {
  const [status, setStatus] = useState('');
  const { data, reload } = useApi<any>(`/giving/receipts${qs({ status })}`);
  const queue = useApi<any>('/giving/gifts?receipt_status=pending&limit=200');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rsel, setRsel] = useState<Set<string>>(new Set());
  const { run, busy } = useAction(); const { me, can } = useSession();
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0));
  return (
    <div className="space-y-5">
      <Notice>Receipts follow your jurisdiction settings ({me?.tenant?.tax_jurisdiction === 'CA-CRA' ? 'Canada — CRA official receipts' : me?.tenant?.tax_jurisdiction === 'US-IRS' ? 'United States — IRS acknowledgment' : 'General'}). Configure wording and registration numbers in <Link className="underline" to="/settings?tab=receipts">Settings › Receipts</Link>.</Notice>
      <Card title={`Gifts needing receipts (${queue.data?.total ?? 0})`} padded={false} actions={can('gifts.write') && <>
        <Button size="sm" loading={busy} onClick={async () => { const ids = sel.size ? [...sel] : (queue.data?.rows ?? []).map((r: any) => r.id); if (!ids.length) return; const r = await run(() => api.post('/giving/receipts/generate', { giftIds: ids }), 'Receipts generated'); if (r) { setSel(new Set()); reload(); queue.reload(); } }}>{sel.size ? `Generate ${sel.size}` : 'Generate all'}</Button>
        <Button size="sm" variant="primary" onClick={async () => { const ids = sel.size ? [...sel] : (queue.data?.rows ?? []).map((r: any) => r.id); if (!ids.length) return; const r = await run(() => api.post('/giving/receipts/generate', { giftIds: ids })); if (r) { const d = await run(() => api.post('/giving/receipts/deliver', { ids: r.receipts.map((x: any) => x.id) })); if (d) alert(`Emailed ${d.sent} receipts.${d.skipped.length ? `\nSkipped: ${d.skipped.join(', ')}` : ''}`); reload(); queue.reload(); } }}>Generate & email</Button></>}>
        <Table rows={queue.data?.rows ?? []} selectable={can('gifts.write')} selected={sel} onSelect={setSel} cols={[
          { key: 'donor_name', label: 'Donor', render: (r) => <Link className="font-medium hover:text-brand-700" to={`/donors/${r.donor_id}`}>{r.donor_name}</Link> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount, 2) }, { key: 'gift_date', label: 'Date', render: (r) => date(r.gift_date) }, { key: 'fund_name', label: 'Fund' }]} empty="No gifts waiting for receipts." />
      </Card>
      <Card title="Issued receipts" padded={false} actions={<>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={['created', 'delivered', 'corrected', 'void']} />
        {rsel.size > 0 && <Button size="sm" onClick={() => downloadPost('/giving/receipts/batch-pdf', { ids: [...rsel] }, `receipts-${today()}.pdf`)}>Download {rsel.size} PDFs</Button>}
        {can('gifts.write') && <><Input className="w-24" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /><Button size="sm" onClick={async () => { const r = await run(() => api.post('/giving/receipts/annual', { year })); if (r) { alert(`Created ${r.created} annual statements for ${year}.`); reload(); } }}>Annual statements</Button></>}</>}>
        <Table rows={data?.rows ?? []} selectable selected={rsel} onSelect={setRsel} cols={[
          { key: 'number', label: 'Receipt #', render: (r) => <a className="font-medium text-brand-700 hover:underline" href={`/api/giving/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer">{r.number}</a> },
          { key: 'donor_name', label: 'Donor', render: (r) => <Link to={`/donors/${r.donor_id}`}>{r.donor_name}</Link> }, { key: 'kind', label: 'Type', render: (r) => label(r.kind) },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount, 2) }, { key: 'issued_at', label: 'Issued', render: (r) => date(r.issued_at) }, { key: 'status', label: 'Status', render: (r) => <Chip value={r.status} /> },
          { key: 'a', label: '', render: (r) => can('gifts.write') && r.status !== 'void' && <div className="flex gap-1"><Button size="sm" onClick={async () => { if (await run(() => api.post(`/giving/receipts/${r.id}/status`, { status: 'delivered' }), 'Marked delivered')) reload(); }}>Delivered</Button><Button size="sm" variant="ghost" onClick={async () => { if (confirm('Void this receipt?') && await run(() => api.post(`/giving/receipts/${r.id}/status`, { status: 'void' }), 'Receipt voided')) reload(); }}>Void</Button></div> }]} empty="No receipts issued yet." />
      </Card>
    </div>
  );
}

// ───────── Growth audit & reports ─────────
export function GrowthAudit() {
  const { data, loading } = useApi<any>('/growth');
  if (loading || !data) return <Spinner />;
  const y = data.years[0], p = data.years[1];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Donors this year" value={num(y?.donors ?? 0)} sub={p ? `${p.donors} last year` : undefined} />
        <Metric label="New donors" value={num(y?.new_donors ?? 0)} sub={p ? `${p.new_donors} last year` : undefined} />
        <Metric label="Retention" value={y?.retention_rate != null ? `${y.retention_rate}%` : '—'} sub="gave last year and this year" tone={y?.retention_rate < 45 ? 'warn' : 'good'} />
        <Metric label="Major donors ($5k+)" value={num(y?.major_donors ?? 0)} />
      </div>
      <Card title="Audit findings" subtitle={data.recommendationsNote}>{data.recommendations.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{data.recommendations.map((r: string) => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-slate-500">No issues detected.</p>}</Card>
      <Card title="Year over year" padded={false}><Table rows={data.years} rowKey="yr" cols={[{ key: 'yr', label: 'Year' }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'new_donors', label: 'New', align: 'right' }, { key: 'retained', label: 'Retained', align: 'right' },
        { key: 'retention_rate', label: 'Retention', align: 'right', render: (r) => (r.retention_rate != null ? `${r.retention_rate}%` : '—') }, { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) }, { key: 'avg_gift_per_donor', label: 'Avg / donor', align: 'right', render: (r) => money(r.avg_gift_per_donor) }]} /></Card>
    </div>
  );
}

export function GivingReports() {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`); const [to, setTo] = useState(today());
  const { data } = useApi<any>(`/money/reports/giving?from=${from}&to=${to}`);
  const camps = useApi<any>(`/money/reports/campaigns?from=${from}&to=${to}`);
  const { can } = useSession();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {can('data.export') && <><Button onClick={() => download(`/money/reports/giving?from=${from}&to=${to}&format=pdf`)}>Export PDF</Button><Button onClick={() => download(`/money/reports/giving?from=${from}&to=${to}&format=csv`)}>CSV</Button><Button onClick={() => download(`/giving/gifts/export?from=${from}&to=${to}&format=xlsx`)}>All gifts (XLSX)</Button></>}</div>
      {!can('finance.read') && <Notice>Some giving reports also require finance access.</Notice>}
      {data && <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={`Giving by month — total ${money(data.total)}`} padded={false}><Table rowKey="month" rows={data.byMonth} cols={[{ key: 'month', label: 'Month' }, { key: 'gifts', label: 'Gifts', align: 'right' }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'total', label: 'Total', align: 'right', render: (r) => <Link className="hover:underline" to={`/money/accounting/giving?from=${r.month}-01&to=${r.month}-31`}>{money(r.total)}</Link> }]} /></Card>
        <Card title="By fund" padded={false}><Table rowKey="fund" rows={data.byFund} cols={[{ key: 'fund', label: 'Fund' }, { key: 'restriction', label: 'Restriction', render: (r) => <Chip value={r.restriction} /> }, { key: 'gifts', label: 'Gifts', align: 'right' }, { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) }]} /></Card>
        <Card title="Top donors" padded={false}><Table rows={data.topDonors} cols={[{ key: 'name', label: 'Donor', render: (r) => <Link to={`/donors/${r.id}`} className="hover:underline">{r.name}</Link> }, { key: 'gifts', label: 'Gifts', align: 'right' }, { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) }]} /></Card>
        <Card title="Campaigns" padded={false}><Table rows={camps.data?.rows ?? []} cols={[{ key: 'name', label: 'Campaign', render: (r) => <Link to={`/donors/giving/campaigns/${r.id}`} className="hover:underline">{r.name}</Link> }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'raised', label: 'Raised', align: 'right', render: (r) => money(r.raised) }, { key: 'goal', label: 'Goal', align: 'right', render: (r) => (r.goal ? money(r.goal) : '—') }]} /></Card>
      </div>}
    </div>
  );
}

export const _u = { useMemo, cx, Search, Textarea, Sparkles, TeamSelect, useCampaigns, GIFT_TYPES, useLocation, Upload };
