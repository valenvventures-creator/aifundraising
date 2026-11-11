/** Shared domain components: lookups, pickers and the core data-entry modals (Add Donor, Add Donation, Log Contact, Task, Draft). */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { today, money, label } from '../lib/format';
import { Button, Field, Input, Select, Textarea, Checkbox, Modal, useAction, Chip, AiBadge, Notice, cx, useToast } from './ui';
import { Sparkles, Copy, Save } from 'lucide-react';

// ───────── Lookups (cached per page load) ─────────
const cache: Record<string, Promise<any>> = {};
export function lookup(url: string, fresh = false) { if (fresh || !cache[url]) cache[url] = api.get(url).catch((e) => { delete cache[url]; throw e; }); return cache[url]; }
export function invalidate(prefix: string) { for (const k of Object.keys(cache)) if (k.startsWith(prefix)) delete cache[k]; }
export function useLookup<T = any[]>(url: string | null, map?: (d: any) => T): T | undefined {
  const [d, setD] = useState<T>();
  useEffect(() => { if (!url) return; let alive = true; lookup(url).then((r) => alive && setD(map ? map(r) : r)).catch(() => alive && setD([] as any)); return () => { alive = false; }; }, [url]); // eslint-disable-line
  return d;
}
export const useFunds = () => useLookup<any[]>('/r/funds?limit=500', (d) => d.rows);
export const useCampaigns = () => useLookup<any[]>('/r/campaigns?limit=500', (d) => d.rows);
export const useProjects = () => useLookup<any[]>('/r/projects?limit=500', (d) => d.rows);
export const useAccounts = () => useLookup<any[]>('/r/accounts?limit=500', (d) => d.rows);
export const useTeam = () => useLookup<any[]>('/team');
export const useRateTypes = () => useLookup<any[]>('/r/rate_types?limit=200', (d) => d.rows.filter((r: any) => !r.archived));

export function FundSelect({ value, onChange, placeholder = 'Choose fund / designation', allowEmpty }: { value: string; onChange: (v: string) => void; placeholder?: string; allowEmpty?: boolean }) {
  const funds = useFunds() ?? [];
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={allowEmpty || !value ? placeholder : undefined}
    options={funds.filter((f) => !f.archived).map((f) => ({ value: f.id, label: `${f.name}${f.restriction !== 'unrestricted' ? ` — ${f.restriction === 'permanent' ? 'Endowment' : 'Restricted'}` : ''}` }))} />;
}
export function AccountSelect({ value, onChange, types, placeholder = 'Choose account' }: { value: string; onChange: (v: string) => void; types?: string[]; placeholder?: string }) {
  const accts = useAccounts() ?? [];
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={accts.filter((a) => !a.archived && (!types || types.includes(a.type))).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />;
}
export function WorkspaceSelect({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { workspaces, term } = useSession();
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? `All ${term === 'Ministry' ? 'ministries' : `${term.toLowerCase()}s`}`} options={workspaces.filter((w) => !w.archived).map((w) => ({ value: w.id, label: w.name }))} />;
}
export function TeamSelect({ value, onChange, placeholder = 'Unassigned' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const team = useTeam() ?? [];
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={team.map((u) => ({ value: u.id, label: u.name }))} />;
}
export function SimpleSelect({ url, value, onChange, placeholder, labelKey = 'name' }: { url: string; value: string; onChange: (v: string) => void; placeholder?: string; labelKey?: string }) {
  const rows = useLookup<any[]>(url, (d) => d.rows ?? d) ?? [];
  return <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'None'} options={rows.map((r) => ({ value: r.id, label: r[labelKey] }))} />;
}

/** Donor search picker. */
export function DonorPicker({ value, onChange, onCreateNew, allowNew }: { value: { id: string; name: string } | null; onChange: (d: { id: string; name: string } | null) => void; onCreateNew?: () => void; allowNew?: boolean }) {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false);
  useEffect(() => { if (q.length < 2) { setRows([]); return; } const t = setTimeout(() => api.get(`/donors?q=${encodeURIComponent(q)}&limit=8&sort=name&dir=asc`).then((d) => setRows(d.rows)).catch(() => setRows([])), 200); return () => clearTimeout(t); }, [q]);
  if (value) return <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm"><span className="font-medium text-brand-800">{value.name}</span><button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search donors by name, email or phone…" />
      {open && (q.length >= 2 || allowNew) && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {rows.map((r) => <button type="button" key={r.id} onClick={() => { onChange({ id: r.id, name: r.name }); setOpen(false); setQ(''); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"><span className="font-medium">{r.name}</span><span className="ml-2 text-xs text-slate-500">{[r.email, r.city].filter(Boolean).join(' · ')}</span></button>)}
          {q.length >= 2 && !rows.length && <div className="px-3 py-2 text-xs text-slate-500">No donors match “{q}”.</div>}
          {allowNew && onCreateNew && <button type="button" onClick={() => { setOpen(false); onCreateNew(); }} className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50">+ New donor</button>}
        </div>
      )}
    </div>
  );
}

// ───────── Add / Edit Donor ─────────
export const DONOR_TYPES = ['individual', 'household', 'foundation', 'business', 'church', 'organization'];
/** Display names for donor types. The stored value 'foundation' is shown as “Grantmaker”. */
export const donorTypeLabel = (t?: string | null) => (t === 'foundation' ? 'Grantmaker' : label(t ?? 'individual'));
export function DonorFields({ d, set }: { d: any; set: (k: string, v: any) => void }) {
  const { can } = useSession();
  const isPerson = ['individual', 'household'].includes(d.donor_type ?? 'individual');
  const team = useTeam() ?? [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Donor type"><Select value={d.donor_type ?? 'individual'} onChange={(e) => set('donor_type', e.target.value)} options={DONOR_TYPES.map((t) => ({ value: t, label: donorTypeLabel(t) }))} /></Field>
      <Field label="Workspace"><WorkspaceSelect value={d.ministry_id ?? ''} onChange={(v) => set('ministry_id', v || null)} placeholder="Organization-wide" /></Field>
      {isPerson ? <>
        <Field label="First name"><Input value={d.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} /></Field>
        <Field label="Last name"><Input value={d.last_name ?? ''} onChange={(e) => set('last_name', e.target.value)} /></Field>
        <Field label="Spouse name"><Input value={d.spouse_name ?? ''} onChange={(e) => set('spouse_name', e.target.value)} /></Field>
        <Field label="Household name"><Input value={d.household_name ?? ''} onChange={(e) => set('household_name', e.target.value)} placeholder="e.g. The Smith Family" /></Field>
      </> : <Field label="Organization name" className="sm:col-span-2"><Input value={d.org_name ?? ''} onChange={(e) => set('org_name', e.target.value)} /></Field>}
      <Field label="Email"><Input type="email" value={d.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Phone"><Input value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Mailing address" className="sm:col-span-2"><Input value={d.address1 ?? ''} onChange={(e) => set('address1', e.target.value)} placeholder="Street address" /></Field>
      <Field label="Address line 2" className="sm:col-span-2"><Input value={d.address2 ?? ''} onChange={(e) => set('address2', e.target.value)} /></Field>
      <Field label="City"><Input value={d.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label="State / Province"><Input value={d.region ?? ''} onChange={(e) => set('region', e.target.value)} /></Field>
      <Field label="Postal / ZIP code"><Input value={d.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} /></Field>
      <Field label="Country"><Input value={d.country ?? ''} onChange={(e) => set('country', e.target.value)} placeholder="US" /></Field>
      <Field label="Source"><Input value={d.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="Event, referral, website…" /></Field>
      <Field label="Relationship owner"><Select value={d.owner_user_id ?? ''} onChange={(e) => set('owner_user_id', e.target.value || null)} placeholder="Unassigned" options={team.map((u) => ({ value: u.id, label: u.name }))} /></Field>
      <Field label="Tags" hint="Comma-separated" className="sm:col-span-2"><Input value={(d.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
      <Field label="Estimated giving capacity (optional)" hint="Used in the Capacity score component"><Input type="number" value={d.capacity_estimate ?? ''} onChange={(e) => set('capacity_estimate', e.target.value === '' ? null : Number(e.target.value))} /></Field>
      <Field label="Communication preferences">
        <div className="flex flex-wrap gap-3 pt-1">{['email', 'phone', 'text', 'mail'].map((k) => <Checkbox key={k} label={label(k)} checked={d.comm_prefs?.[k] ?? k !== 'text'} onChange={(e) => set('comm_prefs', { email: true, phone: true, text: false, mail: true, ...(d.comm_prefs ?? {}), [k]: e.target.checked })} />)}</div>
      </Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea rows={3} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      {can('donors.private_notes') && <Field label="Private notes (restricted)" hint="Visible only to roles with the private-notes permission" className="sm:col-span-2"><Textarea rows={2} value={d.private_notes ?? ''} onChange={(e) => set('private_notes', e.target.value)} /></Field>}
    </div>
  );
}

export function DonorModal({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: (d: any) => void; initial?: any }) {
  const [d, setD] = useState<any>(initial ?? { donor_type: 'individual' });
  const [dups, setDups] = useState<any[] | null>(null);
  const { run, busy } = useAction();
  const nav = useNavigate();
  useEffect(() => { if (open) { setD(initial ?? { donor_type: 'individual' }); setDups(null); } }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setD((x: any) => ({ ...x, [k]: v }));
  const clean = () => { const { id, name, ministry_name, owner_name, intelligence, score_parts, score, health_status, tenant_id, created_at, updated_at, archived, merged_into, private_notes_restricted, ...rest } = d; if (rest.private_notes === '(restricted)') delete rest.private_notes; return rest; };
  const save = async (force = false) => {
    try {
      const r = initial?.id ? await api.patch(`/donors/${initial.id}`, clean()) : await api.post(`/donors${force ? '?force=true' : ''}`, clean());
      onSaved(r); onClose();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409 && e.details?.duplicates) setDups(e.details.duplicates); else throw e;
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Edit donor' : 'Add donor'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button>{dups && <Button onClick={() => run(() => save(true), 'Donor created')}>Create anyway</Button>}<Button variant="primary" loading={busy} onClick={() => run(() => save(false), initial?.id ? 'Donor saved' : 'Donor added')}>Save donor</Button></>}>
      {dups && <div className="mb-4"><Notice tone="warn"><b>Possible duplicate.</b> {dups.map((x) => <div key={x.id} className="mt-1 flex items-center justify-between gap-2"><span>{x.name} — {x.reason}{x.email ? ` (${x.email})` : ''}</span><button className="text-xs font-medium underline" onClick={() => { onClose(); nav(`/donors/${x.id}`); }}>Open existing</button></div>)}</Notice></div>}
      <DonorFields d={d} set={set} />
    </Modal>
  );
}

// ───────── Add Donation ─────────
export const GIFT_TYPES = ['one_time', 'recurring', 'pledge_payment', 'in_kind', 'stock', 'grant', 'matching'];
export const PAYMENT_METHODS = ['check', 'cash', 'card', 'ach', 'wire', 'stripe', 'square', 'paypal', 'stock', 'other'];
export function GiftModal({ open, onClose, onSaved, donor, gift }: { open: boolean; onClose: () => void; onSaved?: (g: any) => void; donor?: { id: string; name: string } | null; gift?: any }) {
  const [g, setG] = useState<any>({});
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [newDonor, setNewDonor] = useState<any | null>(null);
  const campaigns = useCampaigns() ?? []; const projects = useProjects() ?? []; const funds = useFunds() ?? [];
  const { run, busy } = useAction();
  useEffect(() => {
    if (!open) return;
    setPick(donor ?? (gift ? { id: gift.donor_id, name: gift.donor_name } : null)); setNewDonor(null);
    setG(gift ? { ...gift } : { gift_date: today(), gift_type: 'one_time', payment_method: 'check', receipt_status: 'pending', thank_you_status: 'pending', fund_id: funds.find((f) => f.restriction === 'unrestricted')?.id ?? '' });
  }, [open]); // eslint-disable-line
  useEffect(() => { if (open && !g.fund_id && funds.length && !gift) setG((x: any) => ({ ...x, fund_id: funds.find((f) => f.restriction === 'unrestricted')?.id })); }, [funds.length]); // eslint-disable-line
  const set = (k: string, v: any) => setG((x: any) => ({ ...x, [k]: v }));
  const fund = funds.find((f) => f.id === g.fund_id);
  const save = async () => {
    const body: any = { amount: Number(g.amount), gift_date: g.gift_date, fund_id: g.fund_id, campaign_id: g.campaign_id || null, project_id: g.project_id || null, gift_type: g.gift_type, payment_method: g.payment_method,
      follow_up_user_id: g.follow_up_user_id || null, receipt_status: g.receipt_status, thank_you_status: g.thank_you_status, notes: g.notes || null, ministry_id: g.ministry_id || undefined };
    if (gift) return api.patch(`/giving/gifts/${gift.id}`, body);
    if (pick) body.donor_id = pick.id; else if (newDonor) body.new_donor = newDonor; else throw new Error('Choose a donor or create a new one.');
    if (g.gift_type === 'recurring') body.recurring = { frequency: g.frequency ?? 'monthly' };
    return api.post(`/giving/gifts${newDonor ? '?force=false' : ''}`, body);
  };
  return (
    <Modal open={open} onClose={onClose} title={gift ? 'Edit donation' : 'Add donation'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const r = await run(save, gift ? 'Donation updated and re-posted to the ledger' : 'Donation recorded and posted to the ledger'); if (r) { onSaved?.(r); onClose(); } }}>Save donation</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!gift && <Field label="Donor" className="sm:col-span-2">
          {newDonor ? <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3"><div className="mb-2 flex items-center justify-between text-xs font-semibold text-brand-700">NEW DONOR<button className="font-normal underline" onClick={() => setNewDonor(null)}>Search existing instead</button></div>
            <div className="grid grid-cols-2 gap-2"><Input placeholder="First name" value={newDonor.first_name ?? ''} onChange={(e) => setNewDonor({ ...newDonor, first_name: e.target.value })} /><Input placeholder="Last name" value={newDonor.last_name ?? ''} onChange={(e) => setNewDonor({ ...newDonor, last_name: e.target.value })} />
              <Input placeholder="Email" value={newDonor.email ?? ''} onChange={(e) => setNewDonor({ ...newDonor, email: e.target.value })} /><Input placeholder="Phone" value={newDonor.phone ?? ''} onChange={(e) => setNewDonor({ ...newDonor, phone: e.target.value })} />
              <Input placeholder="City" value={newDonor.city ?? ''} onChange={(e) => setNewDonor({ ...newDonor, city: e.target.value })} /><Input placeholder="State / Province" value={newDonor.region ?? ''} onChange={(e) => setNewDonor({ ...newDonor, region: e.target.value })} /></div></div>
            : <DonorPicker value={pick} onChange={setPick} allowNew onCreateNew={() => setNewDonor({ donor_type: 'individual' })} />}
        </Field>}
        <Field label="Gift amount"><Input type="number" min="0" step="0.01" value={g.amount ?? ''} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Gift date"><Input type="date" value={g.gift_date ?? ''} onChange={(e) => set('gift_date', e.target.value)} /></Field>
        <Field label="Designation / fund" hint={fund && fund.restriction !== 'unrestricted' ? <span className="text-violet-700">Restricted: {fund.restriction === 'permanent' ? 'endowment principal' : 'donor-restricted'} — tracked separately from unrestricted cash.</span> : undefined}>
          <FundSelect value={g.fund_id ?? ''} onChange={(v) => set('fund_id', v)} /></Field>
        <Field label="Campaign (optional)"><Select value={g.campaign_id ?? ''} onChange={(e) => set('campaign_id', e.target.value)} placeholder="None" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Project (optional)"><Select value={g.project_id ?? ''} onChange={(e) => set('project_id', e.target.value)} placeholder="None" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Gift type"><Select value={g.gift_type ?? 'one_time'} onChange={(e) => set('gift_type', e.target.value)} options={GIFT_TYPES.map((t) => ({ value: t, label: label(t) }))} /></Field>
        {g.gift_type === 'recurring' && !gift && <Field label="Frequency"><Select value={g.frequency ?? 'monthly'} onChange={(e) => set('frequency', e.target.value)} options={['weekly', 'monthly', 'quarterly', 'annually']} /></Field>}
        <Field label="Payment method"><Select value={g.payment_method ?? 'check'} onChange={(e) => set('payment_method', e.target.value)} options={PAYMENT_METHODS.map((t) => ({ value: t, label: label(t) }))} /></Field>
        <Field label="Assigned follow-up"><TeamSelect value={g.follow_up_user_id ?? ''} onChange={(v) => set('follow_up_user_id', v)} placeholder="No follow-up" /></Field>
        <Field label="Receipt"><Select value={g.receipt_status ?? 'pending'} onChange={(e) => set('receipt_status', e.target.value)} options={[{ value: 'pending', label: 'Needs receipt' }, { value: 'sent', label: 'Receipt sent' }, { value: 'not_required', label: 'Not required' }]} /></Field>
        <Field label="Thank-you"><Select value={g.thank_you_status ?? 'pending'} onChange={(e) => set('thank_you_status', e.target.value)} options={[{ value: 'pending', label: 'Needs thank-you' }, { value: 'sent', label: 'Thank-you sent' }, { value: 'not_required', label: 'Not required' }]} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={g.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Saving posts a balanced entry to the fund ledger (debit deposit account, credit contribution revenue) in the selected fund{gift ? '; edits void the old entry and post a corrected one' : ''}.</p>
    </Modal>
  );
}

// ───────── Log contact / call / text / email ─────────
export function ContactModal({ open, onClose, donor, onSaved, defaultType = 'phone' }: { open: boolean; onClose: () => void; donor: any; onSaved?: () => void; defaultType?: string }) {
  const [c, setC] = useState<any>({});
  const { can } = useSession();
  const { run, busy } = useAction();
  useEffect(() => { if (open) setC({ type: defaultType, direction: 'outbound', occurred_at: new Date().toISOString().slice(0, 16) }); }, [open, defaultType]);
  const set = (k: string, v: any) => setC((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={`Log contact — ${donor?.name ?? ''}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => api.post(`/donors/${donor.id}/contact`, { ...c, occurred_at: new Date(c.occurred_at).toISOString(), duration_hours: c.duration_hours ? Number(c.duration_hours) : null, follow_up_date: c.follow_up_date || null }), 'Contact logged'); if (r) { onSaved?.(); onClose(); } }}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type"><Select value={c.type ?? 'phone'} onChange={(e) => set('type', e.target.value)} options={['phone', 'meeting', 'email', 'text', 'video', 'letter', 'note'].map((t) => ({ value: t, label: label(t) }))} /></Field>
        <Field label="Direction"><Select value={c.direction} onChange={(e) => set('direction', e.target.value)} options={['outbound', 'inbound']} /></Field>
        <Field label="When"><Input type="datetime-local" value={c.occurred_at ?? ''} onChange={(e) => set('occurred_at', e.target.value)} /></Field>
        <Field label="Duration (hours)"><Input type="number" step="0.25" value={c.duration_hours ?? ''} onChange={(e) => set('duration_hours', e.target.value)} /></Field>
        <Field label="Subject" className="sm:col-span-2"><Input value={c.subject ?? ''} onChange={(e) => set('subject', e.target.value)} /></Field>
        <Field label="What was discussed" className="sm:col-span-2"><Textarea value={c.body ?? ''} onChange={(e) => set('body', e.target.value)} /></Field>
        <Field label="Follow-up date (creates a task)"><Input type="date" value={c.follow_up_date ?? ''} onChange={(e) => set('follow_up_date', e.target.value)} /></Field>
        <Field label="Follow-up title"><Input value={c.follow_up_title ?? ''} onChange={(e) => set('follow_up_title', e.target.value)} /></Field>
        {can('donors.private_notes') && <Checkbox label="Private (restricted to roles with private-notes access)" checked={Boolean(c.is_private)} onChange={(e) => set('is_private', e.target.checked)} />}
      </div>
    </Modal>
  );
}

// ───────── Task ─────────
export function TaskModal({ open, onClose, task, defaults, onSaved }: { open: boolean; onClose: () => void; task?: any; defaults?: any; onSaved?: () => void }) {
  const [t, setT] = useState<any>({});
  const rates = useRateTypes() ?? [];
  const { me } = useSession();
  const { run, busy } = useAction(); const { confirm } = useToast();
  useEffect(() => { if (open) setT(task ? { ...task } : { status: 'todo', progress: 0, assignee_id: me?.user.id, ...defaults }); }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setT((x: any) => ({ ...x, [k]: v }));
  const body = () => ({ title: t.title, ministry_id: t.ministry_id || null, category: t.category || null, rate_type_id: t.rate_type_id || null, due_date: t.due_date || null, est_hours: t.est_hours === '' ? null : t.est_hours ?? null,
    progress: Number(t.progress ?? 0), status: t.status, assignee_id: t.assignee_id || null, notes: t.notes || null, next_step: t.next_step || null, billable: Boolean(t.billable), donor_id: t.donor_id || null, job_id: t.job_id || null, grant_id: t.grant_id || null, project_id: t.project_id || null });
  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit task' : 'Add task'} size="lg"
      footer={<>
        {task && <Button variant="ghost" className="mr-auto text-red-600" onClick={async () => { if (await confirm({ title: 'Delete task?', message: `“${task.title}” will be permanently deleted.`, danger: true, confirmLabel: 'Delete' })) { const r = await run(() => api.del(`/r/tasks/${task.id}`), 'Task deleted'); if (r) { onSaved?.(); onClose(); } } }}>Delete</Button>}
        {task && <Button onClick={async () => { const h = prompt('Hours to log for this task?'); if (h && Number(h) > 0) { const r = await run(() => api.post('/r/time_entries', { entry_date: new Date().toISOString().slice(0, 10), hours: Number(h), task_id: task.id, ministry_id: task.ministry_id, rate_type_id: task.rate_type_id, billable: task.billable, description: task.title }), 'Time logged'); if (r) onSaved?.(); } }}>Log time</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => (task ? api.patch(`/r/tasks/${task.id}`, body()) : api.post('/r/tasks', body())), 'Task saved'); if (r) { onSaved?.(); onClose(); } }}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Task title" className="sm:col-span-2"><Input value={t.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Workspace"><WorkspaceSelect value={t.ministry_id ?? ''} onChange={(v) => set('ministry_id', v)} placeholder="Organization-wide" /></Field>
        <Field label="Category"><Input value={t.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Development, Admin" /></Field>
        <Field label="Rate type"><Select value={t.rate_type_id ?? ''} onChange={(e) => set('rate_type_id', e.target.value)} placeholder="None" options={rates.map((r) => ({ value: r.id, label: `${r.name} (${money(r.hourly_rate)}/hr)` }))} /></Field>
        <Field label="Due date"><Input type="date" value={t.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} /></Field>
        <Field label="Estimated hours"><Input type="number" step="0.25" value={t.est_hours ?? ''} onChange={(e) => set('est_hours', e.target.value === '' ? '' : Number(e.target.value))} /></Field>
        <Field label="Actual hours" hint="Updated from logged time"><Input value={t.actual_hours ?? 0} disabled /></Field>
        <Field label={`Progress — ${t.progress ?? 0}%`}><input type="range" min={0} max={100} step={5} value={t.progress ?? 0} onChange={(e) => set('progress', Number(e.target.value))} className="w-full accent-brand-600" /></Field>
        <Field label="Status"><Select value={t.status ?? 'todo'} onChange={(e) => set('status', e.target.value)} options={[{ value: 'todo', label: 'To Do' }, { value: 'in_progress', label: 'In Progress' }, { value: 'waiting', label: 'Waiting' }, { value: 'completed', label: 'Completed' }]} /></Field>
        <Field label="Assignee"><TeamSelect value={t.assignee_id ?? ''} onChange={(v) => set('assignee_id', v)} /></Field>
        <Field label="Follow-up / next step"><Input value={t.next_step ?? ''} onChange={(e) => set('next_step', e.target.value)} /></Field>
        <Field label="Notes / progress" className="sm:col-span-2"><Textarea value={t.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <Checkbox label="Billable" checked={Boolean(t.billable)} onChange={(e) => set('billable', e.target.checked)} />
      </div>
    </Modal>
  );
}

// ───────── AI draft generator (drafts only — never sends) ─────────
export function DraftModal({ open, onClose, kind, donorId, ministryId, context: initialContext, title }: { open: boolean; onClose: () => void; kind: string; donorId?: string; ministryId?: string; context?: string; title?: string }) {
  const [draft, setDraft] = useState<any>(null);
  const [ctx, setCtx] = useState(initialContext ?? '');
  const [content, setContent] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const { can, me } = useSession();
  const { run, busy } = useAction(); const { push } = useToast();
  useEffect(() => { if (open) { setDraft(null); setContent(''); setCtx(initialContext ?? ''); } }, [open, kind]); // eslint-disable-line
  const generate = async () => { const d = await run(() => api.post('/outreach/draft', { kind, donor_id: donorId, ministry_id: ministryId, context: ctx || null, include_private: includePrivate })); if (d) { setDraft(d); setContent(d.content); } };
  return (
    <Modal open={open} onClose={onClose} title={title ?? 'Generate draft'} size="lg"
      footer={draft ? <>
        <Button icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(content); push('success', 'Copied to clipboard'); }}>Copy</Button>
        <Button icon={<Save className="h-4 w-4" />} onClick={() => run(() => api.patch(`/r/drafts/${draft.id}`, { content }), 'Draft saved')}>Save draft</Button>
        <Button variant="primary" onClick={onClose}>Done</Button></> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={busy} onClick={generate}>Generate with A.I. Nonprofits</Button></>}>
      {!draft ? (
        <div className="space-y-3">
          <Field label="Anything specific to include? (optional)"><Textarea rows={3} value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="e.g. mention the new youth center opening in March" /></Field>
          {donorId && can('donors.private_notes') && <Checkbox label="Allow private notes to inform the draft (they will not be quoted)" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} />}
          <Notice tone="ai">Drafts are created for you to review and edit. Nothing is sent, saved to a donor record, or posted automatically.{!me?.features.ai && ' (AI service not configured on this server — a structured template draft will be produced.)'}</Notice>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><AiBadge generator={draft.generator} /><span className="text-xs text-slate-500">Editable — review before using</span></div>
          <Textarea rows={16} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-[13px]" />
        </div>
      )}
    </Modal>
  );
}

export function HealthChip({ status, override }: { status: string; override?: string | null }) {
  return <Chip value={status}>{label(status)}{override ? ' •' : ''}</Chip>;
}
export function ScoreBadge({ score }: { score: number }) {
  const c = score >= 70 ? 'bg-emerald-100 text-emerald-800' : score >= 45 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={cx('inline-flex h-7 w-9 items-center justify-center rounded-lg text-xs font-bold tabular-nums', c)}>{score}</span>;
}
export function useMemoRows<T>(rows: T[] | undefined) { return useMemo(() => rows ?? [], [rows]); }
