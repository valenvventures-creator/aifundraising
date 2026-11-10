import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, RefreshCw, Download, CheckCircle2, XCircle, Copy } from 'lucide-react';
import { api, useApi, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Spinner, Field, Input, Select, Table, Chip, Notice, Modal, Checkbox, useAction, useToast, Metric } from '../components/ui';
import { FundSelect, AccountSelect, DonorPicker, useAccounts, useFunds, useCampaigns } from '../components/domain';
import { money2, date, dateTime, today, label } from '../lib/format';

const CRED_FIELDS: Record<string, { key: string; label: string; secret?: boolean; options?: string[] }[]> = {
  stripe: [{ key: 'api_key', label: 'Secret or restricted API key (sk_… / rk_…)', secret: true }, { key: 'webhook_secret', label: 'Webhook signing secret (whsec_…)', secret: true }],
  square: [{ key: 'access_token', label: 'Access token', secret: true }, { key: 'signature_key', label: 'Webhook signature key', secret: true }, { key: 'environment', label: 'Environment', options: ['sandbox', 'production'] }],
  paypal: [{ key: 'client_id', label: 'Client ID', secret: true }, { key: 'client_secret', label: 'Client secret', secret: true }, { key: 'webhook_id', label: 'Webhook ID', secret: true }, { key: 'environment', label: 'Environment', options: ['sandbox', 'live'] }],
};

export function IntegrationsPage() {
  const { data, reload } = useApi<any[]>('/integrations');
  const sync = useApi<any>('/integrations/sync-center');
  const [creds, setCreds] = useState<string | null>(null); const [cfg, setCfg] = useState<any>(null); const [resolve, setResolve] = useState<any>(null);
  const { can } = useSession(); const { run } = useAction(); const { push } = useToast();
  if (!data) return <Spinner />;
  const payments = sync.data?.payments ?? [];
  return <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((p) => { const i = p.integration; const connected = i?.status === 'connected';
        return <Card key={p.key} title={<span className="flex items-center gap-2"><Plug className="h-4 w-4 text-brand-600" />{p.label}</span>} actions={<Chip value={connected ? (i.enabled ? 'connected' : 'paused') : 'disconnected'}>{connected ? (i.enabled ? 'Connected' : 'Disabled') : 'Not connected'}</Chip>}>
          <p className="text-sm text-slate-600">{p.description}</p>
          {i?.config?.companyName && <p className="mt-2 text-xs text-slate-500">Company: {i.config.companyName}</p>}
          {i?.config?.email && <p className="mt-2 text-xs text-slate-500">Account: {i.config.email}</p>}
          {i?.last_error && <p className="mt-2 text-xs text-red-600">Last error: {i.last_error}</p>}
          {p.webhookUrl && connected && <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs"><div className="mb-1 font-medium text-slate-600">Webhook URL (add in {p.label} dashboard)</div><div className="flex items-center gap-1"><code className="flex-1 truncate">{p.webhookUrl}</code><button onClick={() => { navigator.clipboard.writeText(p.webhookUrl); push('success', 'Copied'); }}><Copy className="h-3.5 w-3.5" /></button></div></div>}
          {!p.serverConfigured && <div className="mt-3"><Notice tone="warn">Unavailable until a server administrator adds {p.label} app credentials.</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {p.serverConfigured && can(p.key === 'google' ? 'ai.ask' : 'integrations.manage') && !connected && p.kind === 'oauth' && p.key !== 'plaid' && <Button variant="primary" size="sm" onClick={async () => { const r = await run(() => api.get(`/integrations/${p.key}/connect`)); if (r) window.location.href = r.url; }}>Connect {p.label.split(' ')[0]}</Button>}
            {p.key === 'plaid' && <Link to="/money/accounting/bank" className="text-sm text-brand-600 hover:underline">Manage in Bank Feed →</Link>}
            {can('integrations.manage') && p.kind === 'apikey' && <Button size="sm" variant={connected ? 'secondary' : 'primary'} onClick={() => setCreds(p.key)}>{connected ? 'Update credentials' : 'Connect'}</Button>}
            {connected && can('integrations.manage') && <><Button size="sm" onClick={async () => { const r = await run(() => api.post(`/integrations/${p.key}/test`)); if (r) push(r.ok ? 'success' : 'error', r.message); reload(); }}>Test connection</Button>
              {['stripe', 'square', 'paypal'].includes(p.key) && <Button size="sm" onClick={() => setCfg({ provider: p.key, ...(i.config ?? {}) })}>Mapping</Button>}
              {p.key === 'stripe' && <Button size="sm" onClick={async () => { const r = await run(() => api.post('/integrations/stripe/import')); if (r) { push('success', `Imported ${r.imported} payments`); sync.reload(); } }}>Import recent</Button>}
              <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/integrations/${p.key}/toggle`))) reload(); }}>{i.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Disconnect ${p.label}? Stored credentials are deleted.`) && await run(() => api.post(`/integrations/${p.key}/disconnect`), 'Disconnected')) reload(); }}>Disconnect</Button></>}
            {p.key === 'quickbooks' && connected && <Link to="/money/accounting/sync" className="self-center text-sm text-brand-600 hover:underline">Sync Center →</Link>}
          </div>
        </Card>; })}
    </div>
    <Card title={`Payments needing review (${payments.length})`} subtitle="Online payments that could not be matched to a donor or fund automatically, plus disputes and failures." padded={false}>
      <Table rows={payments} cols={[{ key: 'occurred_at', label: 'Date', render: (p) => date(p.occurred_at) }, { key: 'provider', label: 'Provider', render: (p) => label(p.provider) }, { key: 'kind', label: 'Type', render: (p) => label(p.kind) }, { key: 'payer', label: 'Payer', render: (p) => [p.payer_name, p.payer_email].filter(Boolean).join(' · ') || 'Unknown' },
        { key: 'status', label: 'Status', render: (p) => <Chip value={p.status} /> }, { key: 'amount', label: 'Amount', align: 'right', render: (p) => money2(p.amount) },
        { key: 'a', label: '', render: (p) => p.status === 'unmatched' && p.kind === 'payment' && can('gifts.write') && <div className="flex gap-1"><Button size="sm" variant="primary" onClick={() => setResolve(p)}>Match</Button><Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/integrations/payments/${p.id}/ignore`), 'Ignored')) sync.reload(); }}>Ignore</Button></div> }]} empty="Nothing needs review." />
    </Card>
    {creds && <CredsModal provider={creds} onClose={() => setCreds(null)} onSaved={reload} />}
    {cfg && <ConfigModal c={cfg} onClose={() => setCfg(null)} onSaved={reload} />}
    {resolve && <ResolveModal p={resolve} onClose={() => setResolve(null)} onDone={sync.reload} />}
  </div>;
}
function CredsModal({ provider, onClose, onSaved }: { provider: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({}); const { run, busy } = useAction();
  return <Modal open onClose={onClose} title={`${label(provider)} credentials`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put(`/integrations/${provider}/credentials`, Object.fromEntries(Object.entries(v).filter(([, x]) => x))), 'Credentials saved (encrypted)')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="space-y-3">{CRED_FIELDS[provider].map((f) => <Field key={f.key} label={f.label}>{f.options ? <Select value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} placeholder="Keep current" options={f.options} /> : <Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} placeholder="Leave blank to keep existing" />}</Field>)}
      <Notice>Credentials are encrypted at rest, never shown again, and only used server-side. Card data is never stored — payments stay with {label(provider)}.</Notice></div></Modal>;
}
function ConfigModal({ c, onClose, onSaved }: { c: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>(c); const campaigns = useCampaigns() ?? []; const { run, busy } = useAction();
  return <Modal open onClose={onClose} title={`${label(c.provider)} mapping`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.patch(`/integrations/${c.provider}/config`, { default_fund_id: v.default_fund_id || null, default_campaign_id: v.default_campaign_id || null, deposit_account_id: v.deposit_account_id || null, auto_create_donors: v.auto_create_donors !== false }), 'Mapping saved')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="space-y-3"><Field label="Default fund" hint="Used when the payment has no fund metadata"><FundSelect value={v.default_fund_id ?? ''} onChange={(x) => setV({ ...v, default_fund_id: x })} allowEmpty placeholder="None — send to review" /></Field>
      <Field label="Default campaign"><Select value={v.default_campaign_id ?? ''} onChange={(e) => setV({ ...v, default_campaign_id: e.target.value })} placeholder="None" options={campaigns.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      <Field label="Deposit / clearing account"><AccountSelect value={v.deposit_account_id ?? ''} onChange={(x) => setV({ ...v, deposit_account_id: x })} types={['asset']} placeholder="1050 Undeposited Funds" /></Field>
      <Checkbox label="Create new donor records when the payer email is unknown" checked={v.auto_create_donors !== false} onChange={(e) => setV({ ...v, auto_create_donors: e.target.checked })} />
      <p className="text-xs text-slate-500">Payment metadata keys <code>fund</code>, <code>fund_id</code>, <code>campaign_id</code> and <code>project_id</code> override these defaults. Duplicate deliveries are ignored using provider transaction IDs.</p></div></Modal>;
}
function ResolveModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<any>(null); const [fund, setFund] = useState(''); const [newD, setNewD] = useState(false); const { run, busy } = useAction();
  const [first, ...rest] = String(p.payer_name ?? '').split(' ');
  return <Modal open onClose={onClose} title={`Match ${label(p.provider)} payment of ${money2(p.amount)}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/integrations/payments/${p.id}/resolve`, { donor_id: d?.id, new_donor: newD ? { first_name: first || null, last_name: rest.join(' ') || p.payer_email, email: p.payer_email } : undefined, fund_id: fund }), 'Gift created and posted')) { onDone(); onClose(); } }}>Create gift</Button></>}>
    <div className="space-y-3"><p className="text-sm text-slate-600">Payer: {p.payer_name ?? '—'} · {p.payer_email ?? 'no email'} · {dateTime(p.occurred_at)}</p>
      {!newD ? <Field label="Donor"><DonorPicker value={d} onChange={setD} allowNew onCreateNew={() => setNewD(true)} /></Field> : <Notice>A new donor will be created from the payer details. <button className="underline" onClick={() => setNewD(false)}>Choose existing</button></Notice>}
      <Field label="Fund"><FundSelect value={fund} onChange={setFund} /></Field></div></Modal>;
}

// ───────── Import / Sync (QuickBooks Sync Center) ─────────
export function SyncCenter() {
  const { data, reload } = useApi<any>('/integrations/sync-center');
  const [maps, setMaps] = useState(false); const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`); const [to, setTo] = useState(today());
  const { can } = useSession(); const { run, busy } = useAction();
  if (!data) return <Spinner />;
  const q = data.quickbooks; const connected = q?.status === 'connected';
  const count = (s: string) => data.counts.find((c: any) => c.status === s)?.n ?? 0;
  return <div className="space-y-5">
    {!connected && <Notice>QuickBooks Online is not connected. Connect it under <Link className="underline" to="/money/accounting/integrations">Integrations</Link>, or use the date-range export below as a manual fallback.</Notice>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6"><Metric label="Last sync" value={<span className="text-base">{q?.last_sync_at ? dateTime(q.last_sync_at) : 'Never'}</span>} /><Metric label="Synced" value={count('synced')} tone="good" /><Metric label="Queued" value={count('queued') + data.notYetQueued} /><Metric label="Errors" value={count('error')} tone={count('error') ? 'bad' : 'default'} /><Metric label="Conflicts" value={count('conflict')} tone={count('conflict') ? 'bad' : 'default'} /><Metric label="Unmapped accounts" value={data.unmappedAccounts.length} tone={data.unmappedAccounts.length ? 'warn' : 'default'} /></div>
    {connected && can('integrations.manage') && <div className="flex flex-wrap gap-2"><Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={async () => { const r = await run(() => api.post('/integrations/quickbooks/sync-now')); if (r) { alert(`Processed ${r.processed} entries.`); reload(); } }}>Sync Now</Button><Button onClick={() => setMaps(true)}>Account & class mappings</Button>
      <Button onClick={async () => { const cur = q.config?.auto_sync !== false; if (await run(() => api.patch('/integrations/quickbooks/config', { auto_sync: !cur }), `Automatic sync ${cur ? 'off' : 'on'}`)) reload(); }}>{q.config?.auto_sync === false ? 'Turn on automatic sync' : 'Turn off automatic sync'}</Button></div>}
    {data.unmappedAccounts.length > 0 && <Notice tone="warn">Unmapped accounts with activity: {data.unmappedAccounts.map((a: any) => `${a.code} ${a.name}`).join(', ')}. Entries using them cannot sync until mapped.</Notice>}
    <Card padded={false} title="Sync queue, errors and conflicts" subtitle="Conflicts are never overwritten automatically — resolve them in QuickBooks, then mark resolved."><Table rows={data.issues} cols={[{ key: 'updated_at', label: 'Updated', render: (s) => dateTime(s.updated_at) }, { key: 'memo', label: 'Entry', render: (s) => `${date(s.entry_date)} · ${s.memo ?? s.entity_type}` }, { key: 'status', label: 'Status', render: (s) => <Chip value={s.status} /> }, { key: 'attempts', label: 'Attempts', align: 'right' }, { key: 'error', label: 'Detail', render: (s) => <span className="text-xs text-red-700">{s.error}</span> },
      { key: 'a', label: '', render: (s) => can('integrations.manage') && <div className="flex gap-1"><Button size="sm" onClick={async () => { if (await run(() => api.post(`/integrations/sync-records/${s.id}/retry`), 'Retried')) reload(); }}>Retry</Button>{s.status === 'conflict' && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/integrations/sync-records/${s.id}/resolve`), 'Marked resolved')) reload(); }}>Mark resolved</Button>}</div> }]} empty="No sync issues." /></Card>
    <Card title="Date-range QuickBooks export (fallback)" subtitle="Journal-entry CSV/XLSX formatted for QuickBooks import, with funds as Classes.">
      <div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/integrations/quickbooks/export?from=${from}&to=${to}&format=csv`)}>CSV</Button><Button onClick={() => download(`/integrations/quickbooks/export?from=${from}&to=${to}&format=xlsx`)}>XLSX</Button></div></Card>
    <Card padded={false} title="Recent webhook deliveries"><Table rows={data.webhooks} rowKey="received_at" cols={[{ key: 'received_at', label: 'Received', render: (w) => dateTime(w.received_at) }, { key: 'provider', label: 'Provider' }, { key: 'event_type', label: 'Event' }, { key: 'status', label: 'Status', render: (w) => <Chip value={w.status === 'processed' ? 'completed' : w.status}>{w.status}</Chip> }, { key: 'error', label: 'Error' }]} empty="No webhooks received yet." /></Card>
    <Card title="Import data" subtitle="CSV import & migration with mapping, preview, validation, duplicate detection and rollback."><Link to="/settings?tab=data" className="text-sm text-brand-600 hover:underline">Open the import & migration tool →</Link></Card>
    {maps && <MappingsModal onClose={() => { setMaps(false); reload(); }} />}
  </div>;
}
function MappingsModal({ onClose }: { onClose: () => void }) {
  const { data, error } = useApi<any>('/integrations/quickbooks/refs');
  const accts = useAccounts() ?? []; const funds = useFunds() ?? [];
  const [m, setM] = useState<Record<string, string>>({}); const { run, busy } = useAction();
  React.useEffect(() => { if (data) setM(Object.fromEntries(data.mappings.map((x: any) => [`${x.entity_type}:${x.internal_id}`, x.external_id]))); }, [data]);
  return <Modal open onClose={onClose} title="QuickBooks mappings" size="xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
    const mappings = Object.entries(m).map(([k, ext]) => { const [entity_type, internal_id] = k.split(':'); const ref = (entity_type === 'account' ? data.accounts : data.classes).find((x: any) => x.Id === ext); return { entity_type, internal_id, external_id: ext || null, external_name: ref?.Name ?? null }; });
    if (await run(() => api.put('/integrations/quickbooks/mappings', { mappings }), 'Mappings saved')) onClose(); }}>Save mappings</Button></>}>
    {error ? <Notice tone="warn">{error}</Notice> : !data ? <Spinner /> : <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div><h4 className="mb-2 text-sm font-semibold">Accounts → QuickBooks accounts</h4><div className="space-y-1.5">{accts.filter((a) => !a.archived).map((a) => <div key={a.id} className="grid grid-cols-2 items-center gap-2 text-sm"><span>{a.code} {a.name}</span><Select value={m[`account:${a.id}`] ?? ''} onChange={(e) => setM({ ...m, [`account:${a.id}`]: e.target.value })} placeholder="Unmapped" options={data.accounts.map((x: any) => ({ value: x.Id, label: `${x.AcctNum ? x.AcctNum + ' ' : ''}${x.Name} (${x.AccountType})` }))} /></div>)}</div></div>
      <div><h4 className="mb-2 text-sm font-semibold">Funds → QuickBooks classes</h4><div className="space-y-1.5">{funds.map((f) => <div key={f.id} className="grid grid-cols-2 items-center gap-2 text-sm"><span>{f.name}</span><Select value={m[`fund:${f.id}`] ?? ''} onChange={(e) => setM({ ...m, [`fund:${f.id}`]: e.target.value })} placeholder="No class" options={data.classes.map((x: any) => ({ value: x.Id, label: x.Name }))} /></div>)}</div>
        {!data.classes.length && <p className="mt-2 text-xs text-slate-500">Enable class tracking in QuickBooks to track funds as classes.</p>}</div></div>}
  </Modal>;
}
export const _i = { CheckCircle2, XCircle };
