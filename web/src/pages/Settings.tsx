import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Upload, Download, RotateCcw, CheckCircle2 } from 'lucide-react';
import { api, useApi, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, PageHeader, Spinner, Field, Input, Select, Textarea, Table, Chip, Notice, Checkbox, useAction, useToast, StateTabs, SaveState, cx } from '../components/ui';
import { AuditLog } from './Platform';
import { date, dateTime, label, ago } from '../lib/format';

type Tab = 'organization' | 'receipts' | 'fundraising' | 'google' | 'notifications' | 'automations' | 'team' | 'data' | 'audit';
export function Settings() {
  const [sp, setSp] = useSearchParams(); const tab = (sp.get('tab') ?? 'organization') as Tab;
  const { can } = useSession();
  const tabs: { value: Tab; label: string }[] = [{ value: 'organization', label: 'Organization' }, { value: 'receipts', label: 'Receipts & tax' }, { value: 'fundraising', label: 'Fundraising rules' }, { value: 'google', label: 'Gmail & Calendar' },
    { value: 'notifications', label: 'Notifications' }, { value: 'automations', label: 'Automations' }, { value: 'team', label: 'Team access' }, ...(can('data.import') || can('data.export') ? [{ value: 'data' as Tab, label: 'Account & Data' }] : []), ...(can('audit.read') ? [{ value: 'audit' as Tab, label: 'Activity history' }] : [])];
  return <>
    <PageHeader title="Settings"><div className="mt-4"><StateTabs value={tab} onChange={(v) => setSp({ tab: v })} tabs={tabs} /></div></PageHeader>
    {tab === 'organization' && <OrgSettings />}{tab === 'receipts' && <ReceiptSettings />}{tab === 'fundraising' && <FundraisingRules />}{tab === 'google' && <GoogleSettings />}
    {tab === 'notifications' && <NotificationSettings />}{tab === 'automations' && <Automations />}{tab === 'team' && <TeamAccess />}{tab === 'data' && <DataSettings />}{tab === 'audit' && <AuditLog />}
  </>;
}

function useSettings() { return useApi<any>('/settings'); }
function useSave(reload: () => void) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle'); const { push } = useToast(); const { reload: reloadMe } = useSession();
  const save = async (body: any) => { setState('saving'); try { await api.patch('/settings', body); setState('saved'); reload(); reloadMe(); } catch (e: any) { setState('error'); push('error', e.message); } };
  return { state, save };
}

const TERMS: [string, string][] = [['Ministry', 'Ministries'], ['Organization', 'Organizations'], ['Program', 'Programs'], ['Chapter', 'Chapters'], ['Project', 'Projects'], ['Campus', 'Campuses'], ['Mission', 'Missions'], ['Department', 'Departments']];
function OrgSettings() {
  const { data, reload } = useSettings(); const [v, setV] = useState<any>(null); const { state, save } = useSave(reload); const { can } = useSession();
  useEffect(() => { if (data) setV(data.tenant); }, [data]);
  if (!v) return <Spinner />;
  const ro = !can('settings.manage'); const set = (k: string, x: any) => setV({ ...v, [k]: x });
  return <Card title="Organization" actions={<SaveState state={state} />}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Display name"><Input disabled={ro} value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field><Field label="Legal name"><Input disabled={ro} value={v.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} /></Field>
      <Field label="Email"><Input disabled={ro} value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field><Field label="Phone"><Input disabled={ro} value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Mailing address"><Input disabled={ro} value={v.address1 ?? ''} onChange={(e) => set('address1', e.target.value)} /></Field><Field label="City"><Input disabled={ro} value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label="State / Province"><Input disabled={ro} value={v.region ?? ''} onChange={(e) => set('region', e.target.value)} /></Field><Field label="Postal code"><Input disabled={ro} value={v.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} /></Field>
      <Field label="Country"><Input disabled={ro} value={v.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
      <Field label="Currency"><Select disabled={ro} value={v.currency} onChange={(e) => set('currency', e.target.value)} options={['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'ZAR', 'KES', 'NGN', 'MXN', 'BRL', 'INR', 'PHP']} /></Field>
      <Field label="Locale / number format"><Select disabled={ro} value={v.locale} onChange={(e) => set('locale', e.target.value)} options={['en-US', 'en-CA', 'fr-CA', 'en-GB', 'en-AU', 'es-MX', 'pt-BR', 'en-IN']} /></Field>
      <Field label="Default invoice terms"><Select disabled={ro} value={v.invoice_terms} onChange={(e) => set('invoice_terms', e.target.value)} options={['Due on receipt', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60']} /></Field>
      <Field label="Workspace terminology"><Select disabled={ro} value={v.workspace_term} onChange={(e) => { const t = TERMS.find((x) => x[0] === e.target.value)!; setV({ ...v, workspace_term: t[0], workspace_term_plural: t[1] }); }} options={TERMS.map(([s, p]) => ({ value: s, label: `${s} / ${p}` }))} /></Field>
      <div className="space-y-2 pt-5"><Checkbox disabled={ro} label="Faith-based organization (enables faith-language options)" checked={v.faith_based} onChange={(e) => set('faith_based', e.target.checked)} /><Checkbox disabled={ro} label="Enable billable work (rates, client work, invoices)" checked={v.billing_enabled} onChange={(e) => set('billing_enabled', e.target.checked)} /></div>
    </div>
    {!ro && <Button variant="primary" className="mt-4" onClick={() => save({ name: v.name, legal_name: v.legal_name, email: v.email || null, phone: v.phone, address1: v.address1, city: v.city, region: v.region, postal_code: v.postal_code, country: v.country, currency: v.currency, locale: v.locale, invoice_terms: v.invoice_terms, workspace_term: v.workspace_term, workspace_term_plural: v.workspace_term_plural, faith_based: v.faith_based, billing_enabled: v.billing_enabled })}>Save</Button>}
    {!ro && <RateTypes />}
  </Card>;
}
function RateTypes() {
  const { data, reload } = useApi<any>('/r/rate_types?limit=100'); const [v, setV] = useState<any>({}); const { run } = useAction();
  return <div className="mt-6 border-t border-slate-100 pt-4"><h4 className="text-sm font-semibold">Rate types</h4><p className="text-xs text-slate-500">Used for tasks, time, communications and invoices.</p>
    <Table rows={data?.rows ?? []} cols={[{ key: 'name', label: 'Rate type' }, { key: 'hourly_rate', label: 'Hourly rate', align: 'right' }, { key: 'a', label: '', render: (r) => <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.patch(`/r/rate_types/${r.id}`, { archived: !r.archived }))) reload(); }}>{r.archived ? 'Restore' : 'Archive'}</Button> }]} />
    <div className="mt-2 flex gap-2"><Input className="max-w-xs" placeholder="Name" value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /><Input className="w-32" type="number" placeholder="Rate" value={v.hourly_rate ?? ''} onChange={(e) => setV({ ...v, hourly_rate: e.target.value })} /><Button onClick={async () => { if (await run(() => api.post('/r/rate_types', { name: v.name, hourly_rate: Number(v.hourly_rate) }), 'Rate type added')) { setV({}); reload(); } }}>Add</Button></div></div>;
}
function ReceiptSettings() {
  const { data, reload } = useSettings(); const [v, setV] = useState<any>(null); const { state, save } = useSave(reload); const { can } = useSession();
  useEffect(() => { if (data) setV(data.tenant); }, [data]);
  if (!v) return <Spinner />;
  const rs = v.receipt_settings ?? {}; const setRs = (k: string, x: any) => setV({ ...v, receipt_settings: { ...rs, [k]: x } }); const ro = !can('settings.manage');
  return <Card title="Receipts & tax jurisdiction" actions={<SaveState state={state} />}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Jurisdiction"><Select disabled={ro} value={v.tax_jurisdiction} onChange={(e) => setV({ ...v, tax_jurisdiction: e.target.value })} options={[{ value: 'US-IRS', label: 'United States — IRS (501(c)(3) acknowledgment)' }, { value: 'CA-CRA', label: 'Canada — CRA official donation receipt' }, { value: 'OTHER', label: 'Other / general receipt' }]} /></Field>
      <Field label={v.tax_jurisdiction === 'CA-CRA' ? 'Charitable registration number (BN)' : 'EIN / tax ID'}><Input disabled={ro} value={v.tax_id ?? ''} onChange={(e) => setV({ ...v, tax_id: e.target.value })} /></Field>
      <Field label="Authorized signatory"><Input disabled={ro} value={rs.signatory ?? ''} onChange={(e) => setRs('signatory', e.target.value)} /></Field>
      {v.tax_jurisdiction === 'US-IRS' && <Field label="Goods & services statement"><Input disabled={ro} value={rs.goodsServicesStatement ?? ''} onChange={(e) => setRs('goodsServicesStatement', e.target.value)} placeholder="No goods or services were provided in exchange for this contribution." /></Field>}
      {v.tax_jurisdiction === 'OTHER' && <Field label="Receipt statement" className="sm:col-span-2"><Textarea disabled={ro} rows={2} value={rs.statement ?? ''} onChange={(e) => setRs('statement', e.target.value)} /></Field>}
    </div>
    <Notice>{v.tax_jurisdiction === 'CA-CRA' ? 'CRA receipts include the registration number, eligible amount, advantage, place of issue and the CRA website. Corrected receipts reference the original.' : 'Receipts include your EIN, the gift amount and date, and the goods & services statement.'} Have your accountant confirm wording for your situation.</Notice>
    {!ro && <Button variant="primary" className="mt-4" onClick={() => save({ tax_jurisdiction: v.tax_jurisdiction, tax_id: v.tax_id, receipt_settings: v.receipt_settings })}>Save</Button>}
  </Card>;
}
function FundraisingRules() {
  const { data, reload } = useSettings(); const [h, setH] = useState<any>(null); const [o, setO] = useState<any>(null); const { state, save } = useSave(reload); const { can } = useSession(); const { run, busy } = useAction();
  useEffect(() => { if (data) { setH(data.tenant.health_rules); setO({ majorThreshold: 5000, ...data.tenant.opportunity_rules, weights: { capacity: 20, recency: 20, frequency: 15, recentGiving: 15, engagement: 15, momentum: 15, ...(data.tenant.opportunity_rules?.weights ?? {}) } }); } }, [data]);
  if (!h || !o) return <Spinner />;
  const ro = !can('settings.manage');
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Donor health thresholds" subtitle="Days since last gift" actions={<SaveState state={state} />}>
      <div className="grid grid-cols-2 gap-3">{[['activeDays', 'Active within'], ['engagedDays', 'Engaged within'], ['coolingDays', 'Cooling within'], ['lapsingDays', 'Lapsing within (else lapsed)']].map(([k, l]) => <Field key={k} label={l}><Input disabled={ro} type="number" value={h[k]} onChange={(e) => setH({ ...h, [k]: Number(e.target.value) })} /></Field>)}</div>
      <p className="mt-2 text-xs text-slate-500">Active recurring donors are always Active. Recent contacts, event attendance and email engagement can keep a donor Engaged. Users can override any donor's health.</p></Card>
    <Card title="Opportunity scoring" subtitle="Component weights (relative) and major donor threshold">
      <div className="grid grid-cols-2 gap-3">{Object.keys(o.weights).map((k) => <Field key={k} label={label(k.replace(/([A-Z])/g, '_$1').toLowerCase())}><Input disabled={ro} type="number" value={o.weights[k]} onChange={(e) => setO({ ...o, weights: { ...o.weights, [k]: Number(e.target.value) } })} /></Field>)}
        <Field label="Major donor lifetime threshold"><Input disabled={ro} type="number" value={o.majorThreshold} onChange={(e) => setO({ ...o, majorThreshold: Number(e.target.value) })} /></Field></div></Card>
    {!ro && <div className="flex gap-2 lg:col-span-2"><Button variant="primary" onClick={() => save({ health_rules: h, opportunity_rules: o })}>Save & recalculate</Button><Button loading={busy} onClick={() => run(() => api.post('/settings/recalculate'), 'Donor intelligence recalculated')}>Recalculate now</Button></div>}
  </div>;
}
function GoogleSettings() {
  const { data, reload } = useApi<any[]>('/integrations'); const { me } = useSession(); const { run } = useAction(); const [sp] = useSearchParams(); const { push } = useToast();
  useEffect(() => { if (sp.get('connected')) push('success', 'Google account connected'); if (sp.get('error')) push('error', `Google: ${sp.get('error')}`); }, []); // eslint-disable-line
  const g = data?.find((x) => x.key === 'google'); const i = g?.integration; const connected = i?.status === 'connected';
  return <Card title="Gmail & Calendar" subtitle="Connect your own Google account. Emails are only sent when you explicitly click Send; meetings are only added when you choose “Add to Calendar”.">
    {!me?.features.google ? <Notice tone="warn">Google sign-in isn't configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Ask your administrator.</Notice> :
      connected ? <div className="space-y-3"><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Connected as <b>{i.config.email}</b></p><p className="text-xs text-slate-500">Scopes: send email, manage calendar events.</p>
        <div className="flex gap-2"><Button onClick={async () => { const r = await run(() => api.post('/integrations/google/test')); if (r) push(r.ok ? 'success' : 'error', r.message); }}>Test</Button><Button variant="danger" onClick={async () => { if (await run(() => api.post('/integrations/google/disconnect'), 'Google disconnected and access revoked')) reload(); }}>Disconnect</Button></div></div> :
        <Button variant="primary" onClick={async () => { const r = await run(() => api.get('/integrations/google/connect')); if (r) window.location.href = r.url; }}>Connect Google account</Button>}
    <p className="mt-4 text-xs text-slate-500">Google Maps routes for donor trips open directly in Google Maps and need no connection.</p>
  </Card>;
}
function NotificationSettings() {
  const { data, reload } = useApi<any>('/notifications/preferences'); const { run } = useAction();
  const TYPES = ['follow_up', 'receipts', 'grant', 'task', 'integration', 'event', 'budget', 'journey', 'message', 'mention'];
  if (!data) return <Spinner />;
  const save = async (p: any) => { if (await run(() => api.put('/notifications/preferences', p), 'Preferences saved')) reload(); };
  return <Card title="Notifications" subtitle="In-app notifications always appear in the bell menu.">
    <Checkbox label="Also send me email notifications (when email delivery is configured)" checked={data.email !== false} onChange={(e) => save({ ...data, email: e.target.checked })} />
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{TYPES.map((t) => <Checkbox key={t} label={label(t)} checked={data.types?.[t] !== false} onChange={(e) => save({ ...data, email: data.email !== false, types: { ...(data.types ?? {}), [t]: e.target.checked } })} />)}</div>
  </Card>;
}
function Automations() {
  const { data, reload } = useSettings(); const { can } = useSession(); const { run } = useAction();
  if (!data) return <Spinner />;
  return <Card title="Automations" subtitle="Deterministic background workflows. They never send donor emails on their own unless you activate an automatic journey or schedule a campaign." padded={false}>
    <Table rowKey="key" rows={data.automations} cols={[{ key: 'key', label: 'Automation', render: (a) => <div><div className="font-medium">{label(a.key)}</div><div className="text-xs text-slate-500">{a.description}</div></div> }, { key: 'last_run_at', label: 'Last run', render: (a) => ago(a.last_run_at) },
      { key: 'last_status', label: 'Status', render: (a) => a.last_status ? <Chip value={a.last_status === 'ok' ? 'completed' : 'error'}>{a.last_status}</Chip> : '—' }, { key: 'last_error', label: 'Error', render: (a) => <span className="text-xs text-red-600">{a.last_error}</span> },
      { key: 'enabled', label: 'Enabled', render: (a) => <input type="checkbox" disabled={!can('settings.manage')} checked={a.enabled} onChange={async (e) => { if (await run(() => api.post(`/settings/automations/${a.key}`, { enabled: e.target.checked }), e.target.checked ? 'Enabled' : 'Disabled')) reload(); }} /> }]} />
  </Card>;
}
function TeamAccess() {
  const { workspaces, terms, can } = useSession(); const users = useApi<any[]>(can('admin.users') ? '/admin/users' : null);
  return <Card title={`${terms} team access`} subtitle={`Who can see each ${terms.toLowerCase()}. Change access in Admin & Access.`}>
    {!can('admin.users') ? <p className="text-sm text-slate-500">Ask an administrator to change team access.</p> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{workspaces.map((w) => <div key={w.id} className="rounded-xl border border-slate-100 p-3"><div className="font-medium">{w.name}</div><ul className="mt-2 space-y-1 text-sm">{(users.data ?? []).filter((u) => u.status === 'active' && (u.all_ministries || u.ministry_ids.includes(w.id))).map((u) => <li key={u.membership_id} className="flex justify-between"><span>{u.name}</span><span className="text-xs text-slate-500">{u.role_name}{u.all_ministries ? ' · all' : ''}</span></li>)}</ul></div>)}</div>}
    <Link to="/admin" className="mt-4 inline-block text-sm text-brand-600 hover:underline">Open Admin & Access →</Link>
  </Card>;
}

// ───────── Account & Data: imports, migration, backups ─────────
const TABLES = ['donors', 'gifts', 'funds', 'accounts', 'journal_entries', 'journal_lines', 'campaigns', 'projects', 'grants', 'funders', 'tasks', 'events', 'registrations', 'communications', 'time_entries', 'invoices', 'expenses', 'budgets', 'receipts'];
function DataSettings() {
  const { can } = useSession(); const [sp] = useSearchParams();
  const meta = useApi<any>('/imports/meta'); const imports = useApi<any[]>(can('data.import') ? '/imports' : null);
  const [entity, setEntity] = useState('donors'); const [preset, setPreset] = useState(sp.get('preset') ?? 'generic');
  const [sess, setSess] = useState<any>(null); const [mapping, setMapping] = useState<Record<string, string>>({}); const [preview, setPreview] = useState<any>(null);
  const [table, setTable] = useState('donors');
  const { run, busy } = useAction(); const { push } = useToast();
  return <div className="space-y-5">
    {can('data.import') && <Card title="Import & migration" subtitle="Upload CSV → map fields → preview & validate → commit. Committed imports can be rolled back for 7 days.">
      {!sess ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="What are you importing?"><Select value={entity} onChange={(e) => setEntity(e.target.value)} options={Object.keys(meta.data?.fields ?? { donors: 1 }).map((k) => ({ value: k, label: label(k) }))} /></Field>
        <Field label="Coming from" hint="Presets pre-map common column names"><Select value={preset} onChange={(e) => setPreset(e.target.value)} options={[{ value: 'generic', label: 'Generic CSV' }, { value: 'donor-crm-a', label: 'Donor CRM export (style A)' }, { value: 'donor-crm-b', label: 'Constituent database export (style B)' }, { value: 'church-mgmt', label: 'Church management system export' }]} /></Field>
        <Field label="CSV file"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm hover:border-brand-400"><Upload className="h-4 w-4" />Choose file<input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); fd.append('entity', entity); fd.append('preset', preset); const r = await run(() => api.upload('/imports', fd)); if (r) { setSess(r); setMapping(r.mapping); setPreview(null); } e.target.value = ''; }} /></label></Field>
        <Field label="Template"><Button onClick={() => download(`/imports/templates/${entity}`)} icon={<Download className="h-4 w-4" />}>Download {entity} template</Button></Field>
      </div> : <div className="space-y-4">
        <div className="flex items-center justify-between"><div className="text-sm"><b>{sess.rowCount}</b> rows in {label(sess.entity)} file. Map each column:</div><Button size="sm" variant="ghost" onClick={() => { setSess(null); setPreview(null); }}>Start over</Button></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{sess.headers.map((hdr: string) => <div key={hdr} className="flex items-center gap-2 text-sm"><span className="w-40 truncate font-mono text-xs" title={hdr}>{hdr}</span><span>→</span><Select value={mapping[hdr] ?? ''} onChange={(e) => setMapping({ ...mapping, [hdr]: e.target.value })} placeholder="(skip)" options={sess.fields.map((f: string) => ({ value: f, label: f }))} /></div>)}</div>
        <Button variant="primary" loading={busy} onClick={async () => { const r = await run(() => api.post(`/imports/${sess.id}/preview`, { mapping })); if (r) setPreview(r); }}>Preview & validate</Button>
        {preview && <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap gap-4 text-sm"><span className="text-emerald-700"><b>{preview.valid}</b> ready</span><span className="text-red-700"><b>{preview.errorCount}</b> errors</span><span className="text-amber-700"><b>{preview.duplicateCount}</b> duplicates (skipped)</span>{(preview.errorCount > 0 || preview.duplicateCount > 0) && <button className="text-brand-600 hover:underline" onClick={() => download(`/imports/${sess.id}/errors.csv`)}>Download error report</button>}</div>
          {preview.errors.length > 0 && <div className="max-h-40 overflow-y-auto text-xs text-red-700">{preview.errors.slice(0, 50).map((e: any, i: number) => <div key={i}>Row {e.row}: {e.message}</div>)}</div>}
          {preview.duplicates.length > 0 && <div className="max-h-32 overflow-y-auto text-xs text-amber-700">{preview.duplicates.slice(0, 30).map((e: any, i: number) => <div key={i}>Row {e.row}: {e.message}</div>)}</div>}
          {preview.preview.length > 0 && <div className="overflow-x-auto"><Table rowKey="_" rows={preview.preview.map((r: any, i: number) => ({ ...r, _: i }))} cols={Object.keys(preview.preview[0]).filter((k) => !['new_donor'].includes(k)).slice(0, 8).map((k) => ({ key: k, label: k, render: (r: any) => (typeof r[k] === 'object' && r[k] ? JSON.stringify(r[k]) : String(r[k] ?? '')) }))} /></div>}
          <Button variant="primary" disabled={!preview.valid} loading={busy} onClick={async () => { const r = await run(() => api.post(`/imports/${sess.id}/commit`)); if (r) { push('success', `Imported ${r.created} records`); setSess(null); setPreview(null); imports.reload(); } }}>Commit {preview.valid} records</Button>
        </div>}
      </div>}
      {imports.data && imports.data.length > 0 && <div className="mt-5"><h4 className="mb-1 text-sm font-semibold">Import history</h4><Table rows={imports.data} cols={[{ key: 'created_at', label: 'When', render: (i) => dateTime(i.created_at) }, { key: 'entity', label: 'Type', render: (i) => label(i.entity) }, { key: 'filename', label: 'File' }, { key: 'status', label: 'Status', render: (i) => <Chip value={i.status === 'committed' ? 'completed' : i.status === 'rolled_back' ? 'void' : 'draft'}>{label(i.status)}</Chip> }, { key: 'result', label: 'Result', render: (i) => (i.result?.created !== undefined ? `${i.result.created} created` : '—') },
        { key: 'a', label: '', render: (i) => i.status === 'committed' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={async () => { if (confirm('Roll back this import? Records it created will be removed (donors with other activity are archived instead).')) { const r = await run(() => api.post(`/imports/${i.id}/rollback`)); if (r) { push('success', `Removed ${r.removed} records`); imports.reload(); } } }}>Roll back</Button> }]} /></div>}
    </Card>}
    {can('data.export') && <Card title="Backups & export" subtitle="Download a complete JSON backup, or any table as CSV. Exports are recorded in the audit log.">
      <div className="flex flex-wrap items-end gap-2"><Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => download('/backup?format=json')}>Full JSON backup</Button>
        <Field label="Table"><Select value={table} onChange={(e) => setTable(e.target.value)} options={TABLES} /></Field><Button onClick={() => download(`/backup?format=csv&table=${table}`)}>Download CSV</Button></div></Card>}
  </div>;
}
export const _s = { cx, date };
