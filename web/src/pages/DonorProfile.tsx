import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HandCoins, PhoneCall, Mail, Phone, MessageSquareText, Target, ListPlus, FileText, Printer, BarChart3, Eye, Pencil, Archive, Sparkles, GitMerge, Paperclip } from 'lucide-react';
import { api, useApi, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Chip, Spinner, ErrorBox, Modal, Field, Input, Select, Textarea, Table, StateTabs, Progress, Notice, AiBadge, useAction, useToast, Dropdown } from '../components/ui';
import { DonorModal, GiftModal, ContactModal, TaskModal, DraftModal, HealthChip, ScoreBadge, DonorPicker } from '../components/domain';
import { TextModal } from './Donors';
import { money, money2, date, dateTime, label, today } from '../lib/format';

const PARTS: [string, string][] = [['capacity', 'Capacity'], ['recency', 'Recency'], ['frequency', 'Frequency'], ['recentGiving', 'Recent Giving'], ['engagement', 'Engagement'], ['momentum', 'Momentum']];
const PART_HELP: Record<string, string> = {
  capacity: 'Largest gift, lifetime giving and any recorded capacity estimate (log scale).',
  recency: 'Days since last gift: ≤30 = 100, ≤90 = 85, ≤180 = 70, ≤365 = 50, ≤730 = 25.',
  frequency: 'Gifts in the last 24 months (12 pts each); active recurring = 100.',
  recentGiving: 'Total given in the last 12 months (log scale up to $10k).',
  engagement: 'Contacts in 180 days, events attended and email opens/clicks.',
  momentum: 'Last 12 months vs. the prior 12 months.',
};

export function DonorProfile() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi<any>(`/donors/${id}`);
  const { can } = useSession(); const nav = useNavigate();
  const [modal, setModal] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'giving' | 'communications' | 'tasks' | 'receipts' | 'more'>('overview');
  const { run } = useAction(); const { confirm } = useToast();
  const [editGift, setEditGift] = useState<any>(null);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const d = data.donor; const i = d.intelligence ?? {}; const s = i.stats ?? {}; const parts = d.score_parts ?? {};
  const donor = { id: d.id, name: d.name, phone: d.phone };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/donors/giving/donors" className="text-xs text-brand-600 hover:underline">← Donors</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold">{d.name}<HealthChip status={d.health_status} override={d.health_override} />{d.archived && <Chip value="archived" />}</h1>
          <p className="mt-1 text-sm text-slate-500">{label(d.donor_type)}{d.spouse_name ? ` · Spouse: ${d.spouse_name}` : ''}{d.household_name ? ` · ${d.household_name}` : ''}{d.ministry_name ? ` · ${d.ministry_name}` : ''}{d.owner_name ? ` · Owner: ${d.owner_name}` : ''}</p>
          <p className="mt-1 text-sm text-slate-600">{[d.email, d.phone, [d.address1, d.city, d.region, d.postal_code].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
          {d.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{d.tags.map((t: string) => <Chip key={t}>{t}</Chip>)}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can('gifts.write') && <Button variant="primary" icon={<HandCoins className="h-4 w-4" />} onClick={() => setModal('gift')}>Log Gift</Button>}
          {can('donors.write') && <Button icon={<PhoneCall className="h-4 w-4" />} onClick={() => setModal('contact')}>Log Contact</Button>}
          {can('ai.ask') && <Button icon={<Mail className="h-4 w-4" />} onClick={() => setModal('email')}>Email</Button>}
          {d.phone && <a href={`tel:${d.phone}`} onClick={() => setTimeout(() => setModal('call'), 300)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><Phone className="h-4 w-4" />Call</a>}
          {d.phone && can('donors.write') && <Button icon={<MessageSquareText className="h-4 w-4" />} onClick={() => setModal('text')}>Text</Button>}
          <Dropdown label="More" items={[
            { label: 'Record Ask', onClick: () => setModal('ask'), hidden: !can('donors.write') },
            { label: 'Create Task', onClick: () => setModal('task'), hidden: !can('work.write') },
            { label: 'View Brief', onClick: () => nav(`/donors/${d.id}/brief`) },
            { label: 'Generate Prep Sheet (PDF)', onClick: () => download(`/donors/${d.id}/brief?format=pdf`), hidden: !can('data.export') },
            { label: 'View Giving', onClick: () => setTab('giving') },
            { label: 'View Portal', onClick: () => nav(`/donors/${d.id}/portal`) },
            { label: 'Edit', onClick: () => setModal('edit'), hidden: !can('donors.write') },
            { label: 'Merge duplicate into this donor', onClick: () => setModal('merge'), hidden: !can('donors.delete') },
            { label: d.archived ? 'Restore' : 'Archive', danger: !d.archived, hidden: !can('donors.delete'), onClick: async () => { if (await confirm({ title: d.archived ? 'Restore donor?' : 'Archive donor?', message: d.archived ? 'The donor will reappear in lists.' : 'Archived donors are hidden from lists and outreach but keep their full history.', danger: !d.archived })) { if (await run(() => api.post(`/donors/${d.id}/archive`), d.archived ? 'Donor restored' : 'Donor archived')) reload(); } } },
          ]} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Opportunity score" subtitle="Transparent 0–100 score. Each component is shown so you can see why." actions={<ScoreBadge score={d.score} />}>
          <div className="space-y-3">
            {PARTS.map(([k, l]) => <div key={k} title={PART_HELP[k]}><div className="mb-1 flex justify-between text-xs"><span className="font-medium text-slate-700">{l}</span><span className="tabular-nums text-slate-500">{parts[k] ?? 0}</span></div><Progress value={parts[k] ?? 0} tone={(parts[k] ?? 0) >= 60 ? 'good' : (parts[k] ?? 0) >= 35 ? 'warn' : 'bad'} /><p className="mt-0.5 text-[11px] text-slate-400">{PART_HELP[k]}</p></div>)}
          </div>
          {can('donors.write') && <div className="mt-4 border-t border-slate-100 pt-3"><Field label="Health override" hint="Overrides the automatic classification until cleared.">
            <Select value={d.health_override ?? ''} onChange={async (e) => { if (await run(() => api.patch(`/donors/${d.id}`, { health_override: e.target.value || null }), 'Health updated')) reload(); }} placeholder={`Automatic (${label(d.health_status)})`} options={['active', 'engaged', 'cooling', 'lapsing', 'lapsed'].map((h) => ({ value: h, label: label(h) }))} /></Field></div>}
        </Card>
        <Card title="Recommended next step" className="xl:col-span-2" actions={<span className="text-xs text-slate-400">{i.disclaimer}</span>}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div><div className="text-xs uppercase text-slate-500">Opportunity</div><div className="font-semibold">{i.categoryLabel ?? '—'}</div></div>
            <div><div className="text-xs uppercase text-slate-500">Suggested ask</div><div className="font-semibold">{money(i.suggestedAsk)}{i.isMonthlyAsk ? '/mo' : ''}</div><div className="text-xs text-slate-500">Range {money(i.askLow)}–{money(i.askHigh)}</div></div>
            <div><div className="text-xs uppercase text-slate-500">Channel</div><div className="font-semibold">{i.channel ?? '—'}</div></div>
            <div><div className="text-xs uppercase text-slate-500">Follow up by</div><div className="font-semibold">{date(i.followUpOn)}</div></div>
          </div>
          <p className="mt-4 text-sm text-slate-800">{i.nextStep}</p>
          <p className="mt-2 text-xs text-slate-500"><b>Why:</b> {(i.reasons ?? []).join(' · ') || '—'}</p>
          <p className="mt-1 text-xs text-slate-500"><b>Ask basis:</b> {i.askBasis}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
            <Stat l="Lifetime" v={money(s.lifetime)} /><Stat l="Gifts" v={s.giftCount ?? 0} /><Stat l="Last gift" v={s.lastGift ? `${date(s.lastGift)} · ${money(s.lastAmount)}` : 'Never'} /><Stat l="Largest" v={money(s.largest)} />
            <Stat l="Last 12 months" v={money(s.last12)} /><Stat l="Prior 12 months" v={money(s.prior12)} /><Stat l="Monthly recurring" v={money(s.recurringMonthly)} /><Stat l="Email opens/clicks" v={`${data.emailStats?.opens ?? 0} / ${data.emailStats?.clicks ?? 0}`} />
          </div>
        </Card>
      </div>

      <StateTabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Notes & Activity' }, { value: 'giving', label: 'Giving', count: data.gifts.length }, { value: 'communications', label: 'Communications', count: data.communications.length },
        { value: 'tasks', label: 'Tasks', count: data.tasks.filter((t: any) => t.status !== 'completed').length }, { value: 'receipts', label: 'Receipts', count: data.receipts.length }, { value: 'more', label: 'Asks · Events · Projects · Files' }]} />

      {tab === 'overview' && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Notes">{d.notes ? <p className="whitespace-pre-line text-sm">{d.notes}</p> : <p className="text-sm text-slate-500">No notes.</p>}
          {d.private_notes && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-amber-700">Private notes</div><p className="whitespace-pre-line">{d.private_notes}</p></div>}</Card>
        <Card title="Recent activity"><Timeline items={[...data.gifts.slice(0, 6).map((g: any) => ({ at: g.gift_date, text: `Gift ${money2(g.amount)} → ${g.fund_name}` })), ...data.communications.slice(0, 8).map((c: any) => ({ at: c.occurred_at, text: `${label(c.type)}: ${c.subject ?? ''}`, by: c.user_name }))]} /></Card>
        {data.drafts.length > 0 && <Card title="Drafts">{data.drafts.map((x: any) => <div key={x.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 text-sm"><span>{x.title}</span><span className="flex items-center gap-2"><AiBadge generator={x.generator} /><span className="text-xs text-slate-400">{date(x.created_at)}</span></span></div>)}</Card>}
        {data.household.length > 0 && <Card title="Household">{data.household.map((h: any) => <Link key={h.id} to={`/donors/${h.id}`} className="block text-sm hover:underline">{h.name}</Link>)}</Card>}
      </div>}

      {tab === 'giving' && <Card padded={false} title="Giving history" actions={<>{data.recurring.map((r: any) => <Chip key={r.id} value={r.status}>{money(r.amount)}/{r.frequency} · {r.fund_name}</Chip>)}</>}>
        <Table rows={data.gifts} onRowClick={can('gifts.write') ? (g) => setEditGift({ ...g, donor_name: d.name }) : undefined} cols={[
          { key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => <span className={g.refunded ? 'line-through' : ''}>{money2(g.amount)}</span> },
          { key: 'fund_name', label: 'Fund', render: (g) => <span className="flex items-center gap-1.5">{g.fund_name}{g.restriction !== 'unrestricted' && <Chip value={g.restriction} />}</span> },
          { key: 'campaign_name', label: 'Campaign / Project', render: (g) => [g.campaign_name, g.project_name].filter(Boolean).join(' / ') || '—' },
          { key: 'gift_type', label: 'Type', render: (g) => label(g.gift_type) }, { key: 'payment_method', label: 'Method', render: (g) => label(g.payment_method) },
          { key: 'receipt_status', label: 'Receipt', render: (g) => <Chip value={g.receipt_status} /> }, { key: 'thank_you_status', label: 'Thank-you', render: (g) => <Chip value={g.thank_you_status} /> },
          { key: 'x', label: '', render: (g) => g.refunded ? <Chip value="void">Refunded</Chip> : can('gifts.write') && can('finance.write') && <Button size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: 'Record refund?', message: 'A reversing ledger entry will be posted. Online payments must be refunded in the payment provider instead.', danger: true })) { if (await run(() => api.post(`/giving/gifts/${g.id}/refund`, {}), 'Refund recorded')) reload(); } }}>Refund</Button> }]} empty="No gifts yet." />
      </Card>}

      {tab === 'communications' && <Card padded={false} title="Communication history" actions={can('donors.write') && <Button size="sm" onClick={() => setModal('contact')}>Log contact</Button>}>
        <Table rows={data.communications} cols={[{ key: 'occurred_at', label: 'When', render: (c) => dateTime(c.occurred_at) }, { key: 'type', label: 'Type', render: (c) => <Chip>{label(c.type)}</Chip> }, { key: 'subject', label: 'Subject', render: (c) => <div><div className="font-medium">{c.subject ?? '—'}{c.is_private && <Chip className="ml-2" value="pending">private</Chip>}</div>{c.body && <div className="max-w-xl whitespace-pre-line text-xs text-slate-500">{c.body}</div>}</div> }, { key: 'user_name', label: 'By' }]} empty="No communications logged." />
      </Card>}

      {tab === 'tasks' && <Card padded={false} title="Tasks" actions={can('work.write') && <Button size="sm" onClick={() => setModal('task')}>Create task</Button>}>
        <Table rows={data.tasks} cols={[{ key: 'title', label: 'Task' }, { key: 'due_date', label: 'Due', render: (t) => date(t.due_date) }, { key: 'status', label: 'Status', render: (t) => <Chip value={t.status} /> }, { key: 'assignee_name', label: 'Assignee' }]} empty="No tasks." />
      </Card>}

      {tab === 'receipts' && <Card padded={false} title="Receipts">
        <Table rows={data.receipts} cols={[{ key: 'number', label: '#', render: (r) => <a className="text-brand-700 hover:underline" href={`/api/giving/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer">{r.number}</a> }, { key: 'kind', label: 'Type', render: (r) => label(r.kind) }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => money2(r.amount) }, { key: 'issued_at', label: 'Issued', render: (r) => date(r.issued_at) }, { key: 'status', label: 'Status', render: (r) => <Chip value={r.status} /> }]} empty="No receipts issued." />
      </Card>}

      {tab === 'more' && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Asks" actions={can('donors.write') && <Button size="sm" onClick={() => setModal('ask')}>Record ask</Button>}><Table rows={data.asks} cols={[{ key: 'asked_on', label: 'Date', render: (a) => date(a.asked_on) }, { key: 'amount', label: 'Amount', align: 'right', render: (a) => money(a.amount) }, { key: 'purpose', label: 'Purpose' }, { key: 'status', label: 'Status', render: (a) => <AskStatus a={a} onChange={reload} /> }]} empty="No asks recorded." /></Card>
        <Card title="Events"><Table rows={data.registrations} cols={[{ key: 'event_name', label: 'Event', render: (r) => <Link to={`/donors/events/${r.event_id}`} className="hover:underline">{r.event_name}</Link> }, { key: 'starts_at', label: 'Date', render: (r) => date(r.starts_at) }, { key: 'status', label: 'Status', render: (r) => <Chip value={r.status} /> }]} empty="No event registrations." /></Card>
        <Card title="Projects & funds supported"><Table rows={data.projects} cols={[{ key: 'name', label: 'Project', render: (p) => <Link to={`/donors/projects/${p.id}`} className="hover:underline">{p.name}</Link> }, { key: 'given', label: 'Given', align: 'right', render: (p) => money(p.given) }]} empty="No project gifts." /></Card>
        <Files entityType="donor" entityId={d.id} canWrite={can('donors.write')} />
      </div>}

      <GiftModal open={modal === 'gift'} onClose={() => setModal(null)} donor={{ id: d.id, name: d.name }} onSaved={reload} />
      <GiftModal open={Boolean(editGift)} onClose={() => setEditGift(null)} gift={editGift} onSaved={reload} />
      <ContactModal open={modal === 'contact' || modal === 'call'} onClose={() => setModal(null)} donor={donor} defaultType="phone" onSaved={reload} />
      <TextModal open={modal === 'text'} onClose={() => setModal(null)} donor={donor} onSent={reload} />
      <TaskModal open={modal === 'task'} onClose={() => setModal(null)} defaults={{ donor_id: d.id, ministry_id: d.ministry_id, title: `Follow up with ${d.name}`, due_date: i.followUpOn, next_step: i.nextStep, category: 'Fundraising' }} onSaved={reload} />
      <DraftModal open={modal === 'email'} onClose={() => setModal(null)} kind="donor_email" donorId={d.id} title={`Email draft — ${d.name}`} />
      <DonorModal open={modal === 'edit'} onClose={() => setModal(null)} initial={d} onSaved={reload} />
      <AskModal open={modal === 'ask'} onClose={() => setModal(null)} donorId={d.id} suggested={i.suggestedAsk} onSaved={reload} />
      <MergeModal open={modal === 'merge'} onClose={() => setModal(null)} targetId={d.id} onDone={reload} />
    </div>
  );
}
function Stat({ l, v }: { l: string; v: React.ReactNode }) { return <div><div className="text-[11px] uppercase text-slate-500">{l}</div><div className="text-sm font-semibold">{v}</div></div>; }
function Timeline({ items }: { items: { at: string; text: string; by?: string }[] }) {
  const sorted = [...items].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
  if (!sorted.length) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return <ol className="space-y-2 border-l border-slate-200 pl-4">{sorted.map((x, k) => <li key={k} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-400" /><span className="text-xs text-slate-400">{date(x.at)}</span> — {x.text}{x.by ? <span className="text-xs text-slate-400"> · {x.by}</span> : null}</li>)}</ol>;
}
function AskStatus({ a, onChange }: { a: any; onChange: () => void }) {
  const { can } = useSession();
  if (!can('donors.write')) return <Chip value={a.status === 'accepted' ? 'completed' : a.status}>{a.status}</Chip>;
  return <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={a.status} onChange={async (e) => { await api.patch(`/r/asks/${a.id}`, { status: e.target.value }); onChange(); }}>{['open', 'accepted', 'declined', 'deferred'].map((s) => <option key={s}>{s}</option>)}</select>;
}
function AskModal({ open, onClose, donorId, suggested, onSaved }: { open: boolean; onClose: () => void; donorId: string; suggested?: number; onSaved: () => void }) {
  const [a, setA] = useState<any>({}); const { run, busy } = useAction();
  React.useEffect(() => { if (open) setA({ amount: suggested ?? '', asked_on: today(), status: 'open' }); }, [open, suggested]);
  return <Modal open={open} onClose={onClose} title="Record ask" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/r/asks', { ...a, donor_id: donorId, amount: Number(a.amount) }), 'Ask recorded')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Amount asked"><Input type="number" value={a.amount} onChange={(e) => setA({ ...a, amount: e.target.value })} /></Field><Field label="Date"><Input type="date" value={a.asked_on} onChange={(e) => setA({ ...a, asked_on: e.target.value })} /></Field>
      <Field label="Purpose" className="col-span-2"><Input value={a.purpose ?? ''} onChange={(e) => setA({ ...a, purpose: e.target.value })} /></Field><Field label="Status"><Select value={a.status} onChange={(e) => setA({ ...a, status: e.target.value })} options={['open', 'accepted', 'declined', 'deferred']} /></Field>
      <Field label="Notes" className="col-span-2"><Textarea rows={2} value={a.notes ?? ''} onChange={(e) => setA({ ...a, notes: e.target.value })} /></Field></div></Modal>;
}
function MergeModal({ open, onClose, targetId, onDone }: { open: boolean; onClose: () => void; targetId: string; onDone: () => void }) {
  const [src, setSrc] = useState<any>(null); const { run, busy } = useAction();
  return <Modal open={open} onClose={onClose} title="Merge a duplicate into this donor" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!src} onClick={async () => { if (await run(() => api.post(`/donors/${targetId}/merge`, { sourceId: src.id }), 'Donors merged')) { onDone(); onClose(); } }}>Merge</Button></>}>
    <Field label="Duplicate donor to merge (its gifts, contacts, tasks and receipts move here; it is then archived)"><DonorPicker value={src} onChange={setSrc} /></Field></Modal>;
}
export function Files({ entityType, entityId, canWrite }: { entityType: string; entityId: string; canWrite: boolean }) {
  const { data, reload } = useApi<any[]>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`);
  const { run } = useAction();
  return <Card title="Files" actions={canWrite && <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-slate-50"><Paperclip className="h-3.5 w-3.5" />Upload<input type="file" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); fd.append('entity_type', entityType); fd.append('entity_id', entityId); if (await run(() => api.upload('/attachments', fd), 'File uploaded')) reload(); e.target.value = ''; }} /></label>}>
    {!data?.length ? <p className="text-sm text-slate-500">No files.</p> : <ul className="space-y-1">{data.map((f) => <li key={f.id}><a className="text-sm text-brand-700 hover:underline" href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a> <span className="text-xs text-slate-400">{Math.round(f.size / 1024)} KB · {date(f.created_at)}</span></li>)}</ul>}
  </Card>;
}

// ───────── Donor brief ─────────
export function DonorBrief() {
  const { id } = useParams(); const { can } = useSession();
  const [priv, setPriv] = useState(false);
  const { data, loading, error } = useApi<any>(`/donors/${id}/brief?private=${priv}`, [priv]);
  const [draft, setDraft] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Spinner />;
  const d = data.donor, i = data.intelligence, s = data.stats;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to={`/donors/${d.id}`} className="text-xs text-brand-600 hover:underline">← {d.name}</Link><h1 className="text-2xl font-bold">Donor Brief: {d.name}</h1><p className="text-sm text-slate-500">{label(d.health_status)} · Score {d.score}/100 · Prepared {date(today())}</p></div>
        <div className="flex flex-wrap gap-2">
          {can('donors.private_notes') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />Include private notes</label>}
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          {can('data.export') && <Button variant="primary" icon={<FileText className="h-4 w-4" />} onClick={() => download(`/donors/${d.id}/brief?format=pdf&private=${priv}`)}>Export PDF</Button>}
        </div>
      </div>
      <Card title="Relationship summary">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat l="Lifetime giving" v={money(s.lifetime)} /><Stat l="Gifts" v={s.giftCount} /><Stat l="Last gift" v={s.lastGift ? date(s.lastGift) : 'Never'} /><Stat l="Largest gift" v={money(s.largest)} /></div>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Capacity / frequency context</dt><dd>{d.capacity_estimate ? `Estimated capacity ${money(d.capacity_estimate)}; ` : ''}{s.giftCount} gifts, {money(s.last12)} in the last 12 months</dd></div>
          <div><dt className="text-xs text-slate-500">Campaigns</dt><dd>{data.campaigns.join(', ') || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Funds / projects supported</dt><dd>{data.funds.map((f: any) => `${f.name} (${money(f.total)})`).join(', ') || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Relationship owner</dt><dd>{d.owner_name ?? '—'}</dd></div>
        </dl>
      </Card>
      <Card title="Suggested approach" actions={<span className="text-xs text-slate-400">Estimates from giving history — not certainties</span>}>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Suggested next step</dt><dd className="font-medium">{i.nextStep}</dd></div>
          <div><dt className="text-xs text-slate-500">Suggested ask</dt><dd className="font-medium">{money(i.suggestedAsk)}{i.isMonthlyAsk ? '/month' : ''} <span className="text-slate-500">(range {money(i.askLow)}–{money(i.askHigh)})</span></dd></div>
          <div><dt className="text-xs text-slate-500">Conversation angle</dt><dd>{data.angle}</dd></div>
          <div><dt className="text-xs text-slate-500">Recommended follow-up</dt><dd>{i.channel} by {date(i.followUpOn)}</dd></div>
        </dl>
        {can('ai.ask') && <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {[['call_script', 'Call Script'], ['thank_you', 'Thank-You Email'], ['proposal', 'Major Donor Proposal'], ['follow_up', 'Follow-Up Note']].map(([k, l]) => <Button key={k} size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setDraft(k)}>{l}</Button>)}
          {can('work.write') && <FollowUpTaskButton d={d} i={i} />}
        </div>}
      </Card>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card title="Giving history" padded={false}><Table rowKey="gift_date" rows={data.gifts} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money2(g.amount) }, { key: 'fund', label: 'Fund' }]} /></Card>
        <Card title="Recent interactions">{data.comms.length ? <ul className="space-y-2 text-sm">{data.comms.map((c: any, k: number) => <li key={k}><span className="text-xs text-slate-400">{date(c.occurred_at)} · {label(c.type)}</span><div>{c.subject}</div>{c.body && <div className="text-xs text-slate-500">{c.body}</div>}</li>)}</ul> : <p className="text-sm text-slate-500">None logged.</p>}</Card>
      </div>
      {(d.notes || data.privateNotes) && <Card title="Notes">{d.notes && <p className="whitespace-pre-line text-sm">{d.notes}</p>}{data.privateNotes && <Notice tone="warn"><b>Private:</b> {data.privateNotes}</Notice>}</Card>}
      <DraftModal open={Boolean(draft)} onClose={() => setDraft(null)} kind={draft ?? 'call_script'} donorId={d.id} title={`Draft — ${d.name}`} context={data.angle} />
    </div>
  );
}
function FollowUpTaskButton({ d, i }: { d: any; i: any }) {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Follow-Up Task</Button><TaskModal open={open} onClose={() => setOpen(false)} defaults={{ donor_id: d.id, title: `Follow up with ${d.name}`, due_date: i.followUpOn, next_step: i.nextStep, category: 'Fundraising' }} /></>;
}

/** Donor portal preview: what the donor would see — giving history and receipts (read-only). */
export function DonorPortal() {
  const { id } = useParams();
  const { data, loading } = useApi<any>(`/donors/${id}`);
  const { me } = useSession();
  if (loading || !data) return <Spinner />;
  const d = data.donor;
  const byYear = data.gifts.filter((g: any) => !g.refunded).reduce((m: any, g: any) => { const y = g.gift_date.slice(0, 4); m[y] = (m[y] ?? 0) + Number(g.amount); return m; }, {});
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Notice>Portal preview — this is the read-only view of giving history and receipts a donor sees. <Link to={`/donors/${d.id}`} className="underline">Back to donor</Link></Notice>
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="text-xs uppercase tracking-wide text-slate-500">{me?.tenant?.name}</div>
        <h1 className="mt-1 text-2xl font-bold">Welcome, {d.first_name ?? d.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Thank you for your generosity. Here is your giving history.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(byYear).sort().reverse().slice(0, 4).map(([y, t]) => <div key={y} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{y}</div><div className="text-lg font-bold">{money(t as number)}</div></div>)}</div>
        <h2 className="mt-6 text-sm font-semibold">Gifts</h2>
        <Table rows={data.gifts.filter((g: any) => !g.refunded)} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money2(g.amount) }, { key: 'fund_name', label: 'Designation' }]} />
        <h2 className="mt-6 text-sm font-semibold">Receipts & statements</h2>
        <Table rows={data.receipts.filter((r: any) => r.status !== 'void')} cols={[{ key: 'number', label: 'Receipt', render: (r) => <a className="text-brand-700 hover:underline" href={`/api/giving/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer">{r.number}</a> }, { key: 'kind', label: 'Type', render: (r) => label(r.kind) }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => money2(r.amount) }]} empty="No receipts yet." />
      </div>
    </div>
  );
}
export const _p = { Target, BarChart3, Eye, Pencil, Archive, GitMerge };
