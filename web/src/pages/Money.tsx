/** Money: Accounting · Payroll · Invoices · Reports · Updates */
import React, { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Camera, Upload, ArrowRightLeft, RefreshCw, FileText, Sparkles, Download, CheckCircle2, Link2, Building2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { api, useApi, qs, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Metric, PageHeader, PillTabs, Spinner, ErrorBox, Field, Input, Select, Textarea, Table, Pager, Chip, Empty, Notice, Modal, Checkbox, useAction, useToast, StateTabs, SearchInput, AiBadge, Progress, cx } from '../components/ui';
import { ResourcePage } from '../components/ResourcePage';
import { FundSelect, AccountSelect, GiftModal, useAccounts, useFunds, useProjects, WorkspaceSelect, useRateTypes, invalidate } from '../components/domain';
import { money, money2, num, date, dateTime, label, today, addDays } from '../lib/format';

export function MoneyShell() {
  return <>
    <PageHeader title="Money" subtitle="True nonprofit fund accounting — every dollar traced to its fund.">
      <PillTabs className="mt-4" tabs={[{ to: '/money/accounting', label: 'Accounting' }, { to: '/money/payroll', label: 'Payroll' }, { to: '/money/invoices', label: 'Invoices' }, { to: '/money/reports', label: 'Reports' }, { to: '/money/updates', label: 'Updates' }]} />
    </PageHeader>
    <Outlet />
  </>;
}
const ACC_TABS = [['', 'Overview'], ['transactions', 'Transactions'], ['post-giving', 'Post Giving'], ['snap', 'Snap & Receipt'], ['spend', 'Spend'], ['funds', 'Funds'], ['accounts', 'Chart of Accounts'], ['budgets', 'Budgets'], ['bank', 'Bank Feed'], ['journals', 'Journals'], ['giving', 'Giving & Receipts'], ['integrations', 'Integrations'], ['sync', 'Import/Sync'], ['settings', 'Settings']];
export function AccountingShell() {
  return <div className="space-y-4"><PillTabs tabs={ACC_TABS.map(([k, l]) => ({ to: `/money/accounting${k ? `/${k}` : ''}`, label: l, end: !k }))} /><Outlet /></div>;
}

// ───────── Overview ─────────
export function AccountingOverview() {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`); const [to, setTo] = useState(today());
  const { data: d, error, reload } = useApi<any>(`/money/overview?from=${from}&to=${to}`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return <Spinner />;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
    {d.alerts.length > 0 && <div className="space-y-2">{d.alerts.map((a: any, i: number) => <Link key={i} to={a.link} className={cx('block rounded-xl border px-4 py-2.5 text-sm', a.level === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>{a.text}</Link>)}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Income" value={money(d.income)} tone="good" to={`/money/reports?kind=activities&from=${from}&to=${to}`} /><Metric label="Expenses" value={money(d.expenses)} to={`/money/reports?kind=activities&from=${from}&to=${to}`} />
      <Metric label="Change in net assets" value={money(d.change)} tone={d.change >= 0 ? 'good' : 'bad'} to={`/money/reports?kind=activities&from=${from}&to=${to}`} />
      <Metric label="Cash" value={money(d.cash)} to="/money/reports?kind=financial-position" /><Metric label="Unrestricted" value={money(d.unrestrictedTotal)} tone={d.unrestrictedTotal < 0 ? 'bad' : 'default'} to="/money/accounting/funds" /><Metric label="Restricted" value={money(d.restrictedTotal)} to="/money/accounting/funds" />
    </div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <Card title="Income vs. expenses — 12 months" className="xl:col-span-2"><div className="h-64"><ResponsiveContainer><BarChart data={d.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => money(v)} width={70} tick={{ fontSize: 11 }} /><Tooltip formatter={(v: any) => money(v)} /><Legend /><Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="expenses" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
      <Card title="Fund balances" padded={false}><Table rows={d.funds} onRowClick={undefined} cols={[{ key: 'name', label: 'Fund', render: (f) => <Link to={`/money/accounting/funds/${f.id}`} className="hover:underline">{f.name}</Link> }, { key: 'restriction', label: '', render: (f) => <Chip value={f.restriction} /> }, { key: 'balance', label: 'Balance', align: 'right', render: (f) => <span className={f.balance < 0 ? 'text-red-600' : ''}>{money(f.balance)}</span> }]} /></Card>
    </div>
    <Card title="Recent activity" padded={false} actions={<Link to="/money/accounting/transactions" className="text-xs text-brand-600 hover:underline">All transactions</Link>}><Table rows={d.recent} cols={[{ key: 'entry_date', label: 'Date', render: (e) => date(e.entry_date) }, { key: 'memo', label: 'Description' }, { key: 'source', label: 'Source', render: (e) => <Chip>{e.source}</Chip> }, { key: 'status', label: 'Status', render: (e) => <Chip value={e.status} /> }, { key: 'amount', label: 'Amount', align: 'right', render: (e) => money2(e.amount) }]} /></Card>
  </div>;
}

// ───────── Transactions & Journals ─────────
export function Transactions({ journalsMode }: { journalsMode?: boolean }) {
  const [sp, setSp] = useSearchParams(); const q = Object.fromEntries(sp.entries());
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'offset') n.delete('offset'); setSp(n, { replace: true }); };
  const base = journalsMode ? { source: q.source ?? 'manual' } : {};
  const { data, reload } = useApi<any>(`/money/journals${qs({ ...q, ...base, limit: 50 })}`);
  const [open, setOpen] = useState<string | null>(null); const [newJ, setNewJ] = useState(false);
  const { can } = useSession(); const { run } = useAction(); const funds = useFunds() ?? [];
  return <Card padded={false}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      <SearchInput value={q.q ?? ''} onChange={(v) => set('q', v)} placeholder="Memo, amount, reference…" />
      <Input type="date" className="w-40" value={q.from ?? ''} onChange={(e) => set('from', e.target.value)} /><Input type="date" className="w-40" value={q.to ?? ''} onChange={(e) => set('to', e.target.value)} />
      <Select className="w-36" value={q.status ?? ''} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={['draft', 'pending_approval', 'posted', 'void']} />
      {!journalsMode && <Select className="w-36" value={q.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="All sources" options={['gift', 'expense', 'manual', 'bank', 'payroll', 'invoice', 'refund']} />}
      <Select className="w-40" value={q.fund_id ?? ''} onChange={(e) => set('fund_id', e.target.value)} placeholder="All funds" options={funds.map((f) => ({ value: f.id, label: f.name }))} />
      {journalsMode && can('finance.write') && <Button variant="primary" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setNewJ(true)}>New journal entry</Button>}
    </div>
    {!data ? <Spinner /> : <>
      <Table rows={data.rows} onRowClick={(e) => setOpen(open === e.id ? null : e.id)} cols={[{ key: 'entry_date', label: 'Date', render: (e) => date(e.entry_date) }, { key: 'memo', label: 'Description', render: (e) => <div><div>{e.memo}</div>{open === e.id && <LinesView e={e} onChanged={reload} />}</div> },
        { key: 'source', label: 'Source', render: (e) => <Chip>{e.source}</Chip> }, { key: 'status', label: 'Status', render: (e) => <Chip value={e.status} /> }, { key: 'created_by_name', label: 'Created by' },
        { key: 'amount', label: 'Amount', align: 'right', render: (e) => money2(e.amount) }]} empty="No transactions match." />
      <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={(o) => set('offset', String(o))} />
    </>}
    {newJ && <JournalModal onClose={() => setNewJ(false)} onSaved={reload} />}
  </Card>;
}
function LinesView({ e, onChanged }: { e: any; onChanged: () => void }) {
  const { can, me } = useSession(); const { run } = useAction();
  return <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50 p-3" onClick={(x) => x.stopPropagation()}>
    <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th>Account</th><th>Fund</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Memo</th></tr></thead>
      <tbody>{(e.lines ?? []).map((l: any) => <tr key={l.id}><td>{l.account}</td><td>{l.fund} {l.restriction !== 'unrestricted' && <Chip value={l.restriction} />}</td><td className="text-right">{Number(l.debit) ? money2(l.debit) : ''}</td><td className="text-right">{Number(l.credit) ? money2(l.credit) : ''}</td><td>{l.description}</td></tr>)}</tbody></table>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">Created by {e.created_by_name ?? 'system'} {dateTime(e.created_at)}{e.approved_by_name && ` · approved by ${e.approved_by_name}`}{e.attachments > 0 && ` · ${e.attachments} attachment(s)`}
      {['draft', 'pending_approval'].includes(e.status) && can('finance.approve') && <Button size="sm" variant="primary" onClick={async () => { if (await run(() => api.post(`/money/journals/${e.id}/approve`), 'Approved and posted')) onChanged(); }}>Approve & post</Button>}
      {e.status === 'posted' && can('finance.approve') && e.source !== 'gift' && <Button size="sm" variant="ghost" onClick={async () => { const reason = prompt('Reason for voiding this entry?'); if (reason && await run(() => api.post(`/money/journals/${e.id}/void`, { reason }), 'Entry voided')) onChanged(); }}>Void</Button>}
      {can('finance.write') && <label className="cursor-pointer text-brand-600 hover:underline">Attach file<input type="file" className="hidden" onChange={async (x) => { const f = x.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); if (await run(() => api.upload(`/money/journals/${e.id}/attachments`, fd), 'Attached')) onChanged(); }} /></label>}
    </div>
    {me && null}
  </div>;
}
function JournalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [j, setJ] = useState<any>({ entry_date: today(), memo: '', reference: '', lines: [{ debit: '', credit: '' }, { debit: '', credit: '' }] });
  const projects = useProjects() ?? []; const { run, busy } = useAction(); const { can } = useSession();
  const d = j.lines.reduce((a: number, l: any) => a + Number(l.debit || 0), 0), c = j.lines.reduce((a: number, l: any) => a + Number(l.credit || 0), 0);
  const upd = (i: number, p: any) => setJ({ ...j, lines: j.lines.map((l: any, k: number) => (k === i ? { ...l, ...p } : l)) });
  const save = (submit: string) => run(() => api.post('/money/journals', { ...j, submit, lines: j.lines.filter((l: any) => l.account_id).map((l: any) => ({ account_id: l.account_id, fund_id: l.fund_id, project_id: l.project_id || null, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || null })) }), submit === 'draft' ? 'Saved as draft' : 'Journal entry saved');
  return <Modal open onClose={onClose} title="New journal entry" size="xl" footer={<><span className={cx('mr-auto self-center text-sm', Math.abs(d - c) < 0.005 ? 'text-emerald-600' : 'text-red-600')}>Debits {money2(d)} · Credits {money2(c)} {Math.abs(d - c) < 0.005 ? '✓ balanced' : `· off by ${money2(d - c)}`}</span>
    <Button onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (await save('draft')) { onSaved(); onClose(); } }}>Save draft</Button><Button variant="primary" loading={busy} onClick={async () => { if (await save('post')) { onSaved(); onClose(); } }}>{can('finance.approve') ? 'Post' : 'Submit for approval'}</Button></>}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4"><Field label="Date"><Input type="date" value={j.entry_date} onChange={(e) => setJ({ ...j, entry_date: e.target.value })} /></Field><Field label="Description" className="sm:col-span-2"><Input value={j.memo} onChange={(e) => setJ({ ...j, memo: e.target.value })} /></Field><Field label="Reference"><Input value={j.reference} onChange={(e) => setJ({ ...j, reference: e.target.value })} /></Field></div>
    <div className="mt-4 space-y-2">{j.lines.map((l: any, i: number) => <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1.5fr_1.2fr_1fr_1fr_1.4fr_auto]">
      <AccountSelect value={l.account_id ?? ''} onChange={(v) => upd(i, { account_id: v })} /><FundSelect value={l.fund_id ?? ''} onChange={(v) => upd(i, { fund_id: v })} placeholder="Fund" allowEmpty />
      <Select value={l.project_id ?? ''} onChange={(e) => upd(i, { project_id: e.target.value })} placeholder="No project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Input type="number" placeholder="Debit" value={l.debit} onChange={(e) => upd(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /><Input type="number" placeholder="Credit" value={l.credit} onChange={(e) => upd(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
      <Input placeholder="Line memo" value={l.description ?? ''} onChange={(e) => upd(i, { description: e.target.value })} />
      <button className="p-2 text-slate-400 hover:text-red-600" onClick={() => setJ({ ...j, lines: j.lines.filter((_: any, k: number) => k !== i) })}><Trash2 className="h-4 w-4" /></button></div>)}</div>
    <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setJ({ ...j, lines: [...j.lines, { debit: '', credit: '' }] })}>Add line</Button>
    <p className="mt-3 text-xs text-slate-500">Every line needs a fund, and each fund must balance on its own. To move money between funds use Funds › Transfer. Entries you create may require approval from another approver.</p>
  </Modal>;
}

// ───────── Post Giving ─────────
export function PostGiving() {
  const und = useApi<any[]>('/money/undeposited');
  const { data: gifts, reload } = useApi<any>('/giving/gifts?limit=25');
  const accts = useAccounts() ?? []; const [bank, setBank] = useState(''); const [d, setD] = useState(today());
  const [add, setAdd] = useState(false); const { run, busy } = useAction(); const { can } = useSession();
  useEffect(() => { if (!bank && accts.length) setBank(accts.find((a) => a.code === '1000')?.id ?? ''); }, [accts.length]); // eslint-disable-line
  const total = (und.data ?? []).reduce((a, r) => a + r.amount, 0);
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    <Card title="Undeposited gifts by fund" subtitle="Gifts post to Undeposited Funds; deposit them to the bank account they landed in.">
      {!und.data ? <Spinner /> : !und.data.length ? <p className="text-sm text-slate-500">Nothing waiting to be deposited.</p> : <>
        <ul className="space-y-1 text-sm">{und.data.map((r) => <li key={r.fund_id} className="flex justify-between"><span className="flex items-center gap-2">{r.fund}<Chip value={r.restriction} /></span><span className="tabular-nums">{money2(r.amount)}</span></li>)}</ul>
        <div className="mt-2 flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>{money2(total)}</span></div>
        {can('finance.write') && <div className="mt-4 space-y-2"><Field label="Deposit to"><AccountSelect value={bank} onChange={setBank} types={['asset']} /></Field><Field label="Deposit date"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
          <Button variant="primary" className="w-full" loading={busy} onClick={async () => { if (await run(() => api.post('/money/deposit', { date: d, bank_account_id: bank }), 'Deposit posted')) und.reload(); }}>Record deposit</Button></div>}
      </>}
    </Card>
    <Card title="Recent gifts" className="xl:col-span-2" padded={false} actions={can('gifts.write') && <Button variant="primary" size="sm" onClick={() => setAdd(true)}>Add Donation</Button>}>
      <Table rows={gifts?.rows ?? []} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'donor_name', label: 'Donor', render: (g) => <Link to={`/donors/${g.donor_id}`} className="hover:underline">{g.donor_name}</Link> }, { key: 'fund_name', label: 'Fund' }, { key: 'payment_method', label: 'Method', render: (g) => label(g.payment_method) }, { key: 'ledger_status', label: 'Ledger', render: (g) => <Chip value={g.ledger_status ?? 'pending'} /> }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money2(g.amount) }]} />
    </Card>
    <GiftModal open={add} onClose={() => setAdd(false)} onSaved={() => { reload(); und.reload(); }} />
  </div>;
}

// ───────── Snap & Receipt + Spend ─────────
export function Spend({ snap }: { snap?: boolean }) {
  const { data, reload } = useApi<any[]>('/money/expenses');
  const unfiled = useApi<any[]>(snap ? '/money/receipt-capture/unfiled' : null);
  const [f, setF] = useState<any>({ expense_date: today() }); const [file, setFile] = useState<File | null>(null); const [override, setOverride] = useState(false);
  const accts = useAccounts() ?? []; const projects = useProjects() ?? [];
  const { run, busy } = useAction(); const { can } = useSession();
  useEffect(() => { if (!f.payment_account_id && accts.length) setF((x: any) => ({ ...x, payment_account_id: accts.find((a) => a.code === '1000')?.id })); }, [accts.length]); // eslint-disable-line
  const submit = async () => {
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => v != null && v !== '' && fd.append(k, String(v))); if (file) fd.append('receipt', file); if (override) fd.append('override_restriction', 'true');
    if (await run(() => api.upload('/money/expenses', fd), 'Expense recorded and posted')) { setF({ expense_date: today(), payment_account_id: f.payment_account_id }); setFile(null); reload(); unfiled.reload(); }
  };
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    {can('finance.write') && <Card title={snap ? 'Snap & Receipt' : 'Record spending'} subtitle={snap ? 'Photograph or upload a receipt, then categorize it.' : 'Expenses post to the ledger against an account and fund.'}>
      <div className="space-y-3">
        <label className={cx('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-sm', file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-brand-300')}>
          <Camera className="mb-1 h-6 w-6 text-brand-500" />{file ? file.name : 'Take photo or upload receipt'}<input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Field label="Vendor"><Input value={f.vendor ?? ''} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Date"><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field><Field label="Amount"><Input type="number" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></div>
        <Field label="Expense account"><AccountSelect value={f.account_id ?? ''} onChange={(v) => setF({ ...f, account_id: v })} types={['expense']} /></Field>
        <Field label="Fund"><FundSelect value={f.fund_id ?? ''} onChange={(v) => setF({ ...f, fund_id: v })} /></Field>
        <Field label="Project"><Select value={f.project_id ?? ''} onChange={(e) => setF({ ...f, project_id: e.target.value })} placeholder="None" options={projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Paid from"><AccountSelect value={f.payment_account_id ?? ''} onChange={(v) => setF({ ...f, payment_account_id: v })} types={['asset', 'liability']} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {can('finance.approve') && <Checkbox label="Approver override: allow overdrawing a restricted fund" checked={override} onChange={(e) => setOverride(e.target.checked)} />}
        <Button variant="primary" className="w-full" loading={busy} onClick={submit}>Save expense</Button>
        {snap && can('finance.write') && <label className="block cursor-pointer text-center text-xs text-brand-600 hover:underline">Upload receipt without categorizing (file for later)<input type="file" className="hidden" onChange={async (e) => { const x = e.target.files?.[0]; if (!x) return; const fd = new FormData(); fd.append('file', x); if (await run(() => api.upload('/money/receipt-capture', fd), 'Receipt saved to inbox')) unfiled.reload(); }} /></label>}
      </div>
    </Card>}
    <div className="space-y-5 xl:col-span-2">
      {snap && unfiled.data && unfiled.data.length > 0 && <Card title={`Receipt inbox (${unfiled.data.length})`}><ul className="space-y-1 text-sm">{unfiled.data.map((u) => <li key={u.id}><a href={`/api/attachments/${u.id}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{u.filename}</a> <span className="text-xs text-slate-400">{date(u.created_at)}</span></li>)}</ul></Card>}
      <Card title="Expenses" padded={false}><Table rows={data ?? []} cols={[{ key: 'expense_date', label: 'Date', render: (x) => date(x.expense_date) }, { key: 'vendor', label: 'Vendor' }, { key: 'account_name', label: 'Account' }, { key: 'fund_name', label: 'Fund', render: (x) => <span className="flex items-center gap-1">{x.fund_name}{x.restriction !== 'unrestricted' && <Chip value={x.restriction} />}</span> },
        { key: 'project_name', label: 'Project' }, { key: 'receipt_filename', label: 'Receipt', render: (x) => (x.attachment_id ? <a className="text-brand-700 hover:underline" href={`/api/attachments/${x.attachment_id}`} target="_blank" rel="noreferrer">View</a> : can('finance.write') ? <label className="cursor-pointer text-xs text-slate-500 hover:underline">Attach<input type="file" className="hidden" onChange={async (e) => { const fl = e.target.files?.[0]; if (!fl) return; const fd = new FormData(); fd.append('file', fl); fd.append('entity_type', 'expense'); fd.append('entity_id', x.id); if (await run(() => api.upload('/money/receipt-capture', fd), 'Receipt attached')) reload(); }} /></label> : '—') },
        { key: 'amount', label: 'Amount', align: 'right', render: (x) => money2(x.amount) }]} empty="No expenses recorded." /></Card>
    </div>
  </div>;
}

// ───────── Funds ─────────
export function Funds() {
  const { data, reload } = useApi<any[]>('/money/funds');
  const [tr, setTr] = useState(false); const [add, setAdd] = useState<any>(null);
  const { can } = useSession(); const nav = useNavigate();
  return <div className="space-y-4">
    <Notice>Restricted funds are never mixed with unrestricted cash. Each fund self-balances in the ledger, so every balance below drills down to its entries.</Notice>
    <Card padded={false} title="Fund ledger" actions={<>{can('finance.approve') && <Button icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTr(true)}>Transfer / release</Button>}{can('finance.write') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd({ restriction: 'purpose' })}>New fund</Button>}</>}>
      <Table rows={data ?? []} onRowClick={(f) => nav(`/money/accounting/funds/${f.id}`)} cols={[{ key: 'name', label: 'Fund', render: (f) => <span className="font-medium">{f.name}{f.archived && ' (archived)'}</span> }, { key: 'code', label: 'Code' },
        { key: 'restriction', label: 'Type', render: (f) => <Chip value={f.restriction}>{({ unrestricted: 'Unrestricted / General', purpose: 'Donor-restricted (purpose)', time: 'Donor-restricted (time)', permanent: 'Endowment / permanent' } as any)[f.restriction]}</Chip> },
        { key: 'period_income', label: 'Income YTD', align: 'right', render: (f) => money(f.period_income) }, { key: 'period_expense', label: 'Spent YTD', align: 'right', render: (f) => money(f.period_expense) }, { key: 'entry_count', label: 'Entries', align: 'right' },
        { key: 'balance', label: 'Balance', align: 'right', render: (f) => <b className={f.balance < 0 ? 'text-red-600' : ''}>{money2(f.balance)}</b> }]} />
    </Card>
    {tr && <TransferModal funds={data ?? []} onClose={() => setTr(false)} onSaved={reload} />}
    {add && <FundModal f={add} onClose={() => setAdd(null)} onSaved={() => { invalidate('/r/funds'); reload(); }} />}
  </div>;
}
function FundModal({ f, onClose, onSaved }: { f: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>(f); const { run, busy } = useAction();
  return <Modal open onClose={onClose} title={f.id ? 'Edit fund' : 'New fund'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const body = { name: v.name, code: v.code || null, restriction: v.restriction, description: v.description || null, revenue_account_id: v.revenue_account_id || null, ministry_id: v.ministry_id || null }; if (await run(() => (f.id ? api.patch(`/r/funds/${f.id}`, body) : api.post('/r/funds', body)), 'Fund saved')) { onSaved(); onClose(); } }}>Save</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="Fund name" className="col-span-2"><Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Code"><Input value={v.code ?? ''} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
      <Field label="Restriction"><Select value={v.restriction} onChange={(e) => setV({ ...v, restriction: e.target.value })} options={[{ value: 'unrestricted', label: 'Unrestricted / General' }, { value: 'purpose', label: 'Donor-restricted — purpose' }, { value: 'time', label: 'Donor-restricted — time' }, { value: 'permanent', label: 'Endowment / permanent' }]} /></Field>
      <Field label="Revenue account override" className="col-span-2" hint="Optional — gifts to this fund credit this account"><AccountSelect value={v.revenue_account_id ?? ''} onChange={(x) => setV({ ...v, revenue_account_id: x })} types={['revenue']} placeholder="Default contribution accounts" /></Field>
      <Field label="Workspace" className="col-span-2"><WorkspaceSelect value={v.ministry_id ?? ''} onChange={(x) => setV({ ...v, ministry_id: x })} placeholder="Organization-wide" /></Field>
      <Field label="Restriction details" className="col-span-2"><Textarea rows={2} value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></div></Modal>;
}
function TransferModal({ funds, onClose, onSaved }: { funds: any[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ date: today() }); const { run, busy } = useAction();
  return <Modal open onClose={onClose} title="Interfund transfer / release from restriction" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/money/funds/transfer', { ...v, amount: Number(v.amount) }), 'Transfer posted')) { onSaved(); onClose(); } }}>Post transfer</Button></>}>
    <div className="grid grid-cols-2 gap-3"><Field label="From fund"><Select value={v.from_fund_id ?? ''} onChange={(e) => setV({ ...v, from_fund_id: e.target.value })} placeholder="Choose" options={funds.map((f) => ({ value: f.id, label: `${f.name} (${money(f.balance)})` }))} /></Field>
      <Field label="To fund"><Select value={v.to_fund_id ?? ''} onChange={(e) => setV({ ...v, to_fund_id: e.target.value })} placeholder="Choose" options={funds.map((f) => ({ value: f.id, label: f.name }))} /></Field>
      <Field label="Amount"><Input type="number" value={v.amount ?? ''} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field><Field label="Date"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
      <Field label="Reason (required)" className="col-span-2"><Input value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} placeholder="e.g. Release of restriction — purpose satisfied" /></Field></div>
    <p className="mt-3 text-xs text-slate-500">Endowment principal cannot be transferred out. Transfers that would overdraw a restricted fund are blocked.</p></Modal>;
}
export function FundLedger() {
  const { id } = useParams(); const { data } = useApi<any>(`/money/funds/${id}/ledger`);
  if (!data) return <Spinner />;
  return <div className="space-y-4"><Link to="/money/accounting/funds" className="text-xs text-brand-600 hover:underline">← Funds</Link>
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold">{data.fund.name}</h2><Chip value={data.fund.restriction} /><span className="ml-auto text-2xl font-bold">{money2(data.balance)}</span></div>
    {data.fund.description && <p className="text-sm text-slate-600">{data.fund.description}</p>}
    <Card padded={false} title="Ledger entries producing this balance"><Table rows={data.rows} cols={[{ key: 'entry_date', label: 'Date', render: (r) => date(r.entry_date) }, { key: 'memo', label: 'Description' }, { key: 'account_name', label: 'Account', render: (r) => `${r.code} ${r.account_name}` }, { key: 'source', label: 'Source', render: (r) => <Chip>{r.source}</Chip> }, { key: 'project_name', label: 'Project' },
      { key: 'change', label: 'Change', align: 'right', render: (r) => <span className={r.change < 0 ? 'text-red-600' : 'text-emerald-700'}>{money2(r.change)}</span> }, { key: 'balance', label: 'Balance', align: 'right', render: (r) => money2(r.balance) }]} /></Card></div>;
}

// ───────── Chart of accounts ─────────
export function ChartOfAccounts() {
  return <ResourcePage resource="accounts" title="Account" writePerm="finance.write" baseQuery={{ limit: '500' }}
    filters={(q, set) => <Select className="w-36" value={q.type ?? ''} onChange={(e) => set('type', e.target.value)} placeholder="All types" options={['asset', 'liability', 'net_assets', 'revenue', 'expense']} />}
    fields={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'type', label: 'Type', type: 'select', required: true, options: ['asset', 'liability', 'net_assets', 'revenue', 'expense'] }, { key: 'subtype', label: 'Subtype' }, { key: 'is_cash', label: 'Cash / bank account', type: 'bool' }, { key: 'description', label: 'Description', type: 'textarea' }]}
    cols={[{ key: 'code', label: 'Code', sortable: true }, { key: 'name', label: 'Account', sortable: true, render: (a: any) => <span className="font-medium">{a.name}</span> }, { key: 'type', label: 'Type', render: (a: any) => label(a.type) }, { key: 'subtype', label: 'Subtype' },
      { key: 'qbo_name', label: 'QuickBooks mapping', render: (a: any) => (a.qbo_name ? <Chip value="synced">{a.qbo_name}</Chip> : <span className="text-xs text-slate-400">Unmapped</span>) },
      { key: 'debit_balance', label: 'Balance', align: 'right', render: (a: any) => money2(['asset', 'expense'].includes(a.type) ? a.debit_balance : -a.debit_balance) }]}
    emptyText="Archiving an account keeps its transaction history." />;
}

// ───────── Budgets ─────────
export function Budgets() {
  const { data, reload } = useApi<any[]>('/money/budgets'); const nav = useNavigate();
  const [add, setAdd] = useState(false); const [v, setV] = useState<any>({ name: `FY${new Date().getFullYear() + 1} Operating Budget`, period_start: `${new Date().getFullYear() + 1}-01-01`, period_end: `${new Date().getFullYear() + 1}-12-31`, copy_actuals_from_year: new Date().getFullYear() });
  const { can } = useSession(); const { run, busy } = useAction();
  return <Card padded={false} title="Budgets" actions={can('finance.write') && <Button variant="primary" onClick={() => setAdd(true)}>New budget</Button>}>
    <Table rows={data ?? []} onRowClick={(b) => nav(`/money/accounting/budgets/${b.id}`)} cols={[{ key: 'name', label: 'Budget', render: (b) => <span className="font-medium">{b.name}</span> }, { key: 'period_start', label: 'Period', render: (b) => `${date(b.period_start)} – ${date(b.period_end)}` }, { key: 'fund_name', label: 'Fund', render: (b) => b.fund_name ?? 'All funds' }, { key: 'total', label: 'Budgeted', align: 'right', render: (b) => money(b.total) }]} empty="No budgets yet." />
    <Modal open={add} onClose={() => setAdd(false)} title="New budget" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const b = await run(() => api.post('/money/budgets', { ...v, copy_actuals_from_year: v.copy_actuals_from_year || undefined, fund_id: v.fund_id || null }), 'Budget created'); if (b) { setAdd(false); nav(`/money/accounting/budgets/${b.id}`); } }}>Create</Button></>}>
      <div className="grid grid-cols-2 gap-3"><Field label="Name" className="col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Start"><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} /></Field><Field label="End"><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} /></Field>
        <Field label="Fund (optional)"><FundSelect value={v.fund_id ?? ''} onChange={(x) => setV({ ...v, fund_id: x })} allowEmpty placeholder="All funds" /></Field><Field label="Start from actuals of year" hint="Leave blank for an empty budget"><Input type="number" value={v.copy_actuals_from_year ?? ''} onChange={(e) => setV({ ...v, copy_actuals_from_year: e.target.value ? Number(e.target.value) : '' })} /></Field></div></Modal>
  </Card>;
}
export function BudgetDetail() {
  const { id } = useParams(); const { data, reload } = useApi<any>(`/money/budgets/${id}`);
  const [editing, setEditing] = useState<any[] | null>(null); const { can } = useSession(); const { run, busy } = useAction(); const nav = useNavigate();
  if (!data) return <Spinner />;
  const tot = (k: string, t: string) => data.rows.filter((r: any) => r.type === t).reduce((a: number, r: any) => a + Number(r[k]), 0);
  return <div className="space-y-4"><Link to="/money/accounting/budgets" className="text-xs text-brand-600 hover:underline">← Budgets</Link>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{data.budget.name}</h2><div className="flex gap-2">{can('data.export') && <Button onClick={() => download(`/money/reports/budget-vs-actual?budget_id=${id}&format=pdf&to=${data.budget.period_end}`)}>Export PDF</Button>}{can('finance.write') && <Button variant="primary" onClick={() => setEditing(data.rows.map((r: any) => ({ account_id: r.account_id, fund_id: r.fund_id, project_id: r.project_id, amount: r.amount })))}>Edit lines</Button>}</div></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Revenue budget" value={money(tot('amount', 'revenue'))} /><Metric label="Revenue actual" value={money(tot('actual', 'revenue'))} /><Metric label="Expense budget" value={money(tot('amount', 'expense'))} /><Metric label="Expense actual" value={money(tot('actual', 'expense'))} tone={tot('actual', 'expense') > tot('amount', 'expense') ? 'bad' : 'default'} /></div>
    <Card padded={false} title="Budget vs. actual — click a line to see its transactions"><Table rows={data.rows} onRowClick={(r) => nav(`/money/accounting/transactions?account_id=${r.account_id}&from=${data.budget.period_start}&to=${data.budget.period_end}${r.fund_id ? `&fund_id=${r.fund_id}` : ''}`)} cols={[
      { key: 'account_name', label: 'Account', render: (r) => `${r.code} ${r.account_name}` }, { key: 'fund_name', label: 'Fund', render: (r) => r.fund_name ?? 'All' }, { key: 'amount', label: 'Budget', align: 'right', render: (r) => money(r.amount) }, { key: 'actual', label: 'Actual', align: 'right', render: (r) => money(r.actual) },
      { key: 'remaining', label: 'Remaining', align: 'right', render: (r) => money(r.remaining) }, { key: 'variance', label: 'Variance', align: 'right', render: (r) => <span className={r.variance < 0 ? 'text-red-600' : 'text-emerald-700'}>{money(r.variance)}</span> },
      { key: 'pct', label: '% used', render: (r) => <div className="w-28"><div className="text-xs">{r.pct ?? '—'}%</div>{r.pct != null && <Progress value={r.pct} tone={r.type === 'expense' && r.pct > 100 ? 'bad' : r.pct > 90 ? 'warn' : 'good'} />}</div> }]} /></Card>
    {editing && <Modal open onClose={() => setEditing(null)} title="Budget lines" size="lg" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put(`/money/budgets/${id}/lines`, { lines: editing.filter((l) => l.account_id).map((l) => ({ ...l, amount: Number(l.amount) })) }), 'Budget saved')) { setEditing(null); reload(); } }}>Save</Button></>}>
      <div className="space-y-2">{editing.map((l, i) => <div key={i} className="grid grid-cols-[2fr_1.5fr_1fr_auto] gap-2"><AccountSelect value={l.account_id ?? ''} onChange={(v) => setEditing(editing.map((x, k) => (k === i ? { ...x, account_id: v } : x)))} types={['revenue', 'expense']} /><FundSelect value={l.fund_id ?? ''} onChange={(v) => setEditing(editing.map((x, k) => (k === i ? { ...x, fund_id: v || null } : x)))} allowEmpty placeholder="All funds" /><Input type="number" value={l.amount} onChange={(e) => setEditing(editing.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} /><button onClick={() => setEditing(editing.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4 text-slate-400" /></button></div>)}</div>
      <Button size="sm" className="mt-2" onClick={() => setEditing([...editing, { amount: 0 }])}>Add line</Button></Modal>}
  </div>;
}

// ───────── Bank feed ─────────
export function BankFeed() {
  const banks = useApi<any>('/r/bank_accounts');
  const [status, setStatus] = useState('unreviewed');
  const { data, reload } = useApi<any[]>(`/money/bank/transactions?status=${status}`);
  const [review, setReview] = useState<any>(null); const [recon, setRecon] = useState<string | null>(null); const [newBank, setNewBank] = useState(false);
  const { can, me } = useSession(); const { run } = useAction();
  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{(banks.data?.rows ?? []).map((b: any) => <Card key={b.id} title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4" />{b.name}</span>} subtitle={`${b.ledger_account} · ${b.provider === 'plaid' ? 'Bank feed linked' : 'CSV import'}`}>
      <div className="text-sm">{b.unreviewed} to review</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {can('finance.write') && <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"><Upload className="h-3.5 w-3.5" />Import CSV<input type="file" accept=".csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); fd.append('bank_account_id', b.id); const r = await run(() => api.upload('/money/bank/import', fd)); if (r) { alert(`Imported ${r.added} new transactions (${r.duplicates} already present).${r.errors.length ? `\n${r.errors.slice(0, 5).join('\n')}` : ''}`); reload(); banks.reload(); } e.target.value = ''; }} /></label>}
        {b.provider === 'plaid' && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={async () => { const r = await run(() => api.post(`/integrations/plaid/sync/${b.id}`)); if (r) { alert(`${r.added} new transactions`); reload(); } }}>Sync</Button>}
        <Button size="sm" onClick={() => setRecon(b.id)}>Reconcile</Button>
      </div></Card>)}
      {can('finance.write') && <button onClick={() => setNewBank(true)} className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-sm text-slate-500 hover:border-brand-300">+ Add bank account{!me?.features.plaid && <span className="mt-1 block text-xs">(Automatic bank feeds require a Plaid configuration; CSV import always works.)</span>}</button>}
    </div>
    <Card padded={false} title="Transactions" actions={<StateTabs value={status} onChange={setStatus} tabs={[{ value: 'unreviewed', label: 'To review' }, { value: 'posted', label: 'Posted' }, { value: 'matched', label: 'Matched' }, { value: 'duplicate', label: 'Possible duplicates' }, { value: 'excluded', label: 'Excluded' }]} />}>
      <Table rows={data ?? []} cols={[{ key: 'txn_date', label: 'Date', render: (t) => date(t.txn_date) }, { key: 'description', label: 'Description' }, { key: 'bank_name', label: 'Account' }, { key: 'category_name', label: 'Category', render: (t) => t.category_name ? `${t.category_name} · ${t.fund_name}` : '—' },
        { key: 'amount', label: 'Amount', align: 'right', render: (t) => <span className={t.amount < 0 ? '' : 'text-emerald-700'}>{money2(t.amount)}</span> }, { key: 'reconciled', label: 'Reconciled', render: (t) => (t.reconciled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : '') },
        { key: 'a', label: '', render: (t) => can('finance.write') && <div className="flex gap-1">{['unreviewed', 'duplicate'].includes(t.status) && <Button size="sm" variant="primary" onClick={() => setReview(t)}>Review</Button>}
          {['posted', 'matched'].includes(t.status) && can('finance.approve') && <Button size="sm" onClick={async () => { if (await run(() => api.post(`/money/bank/transactions/${t.id}/review`, { action: t.reconciled ? 'unreconcile' : 'reconcile' }))) reload(); }}>{t.reconciled ? 'Unreconcile' : 'Reconcile'}</Button>}</div> }]} empty="Nothing here." />
    </Card>
    {review && <BankReviewModal t={review} onClose={() => setReview(null)} onDone={() => { reload(); banks.reload(); }} />}
    {recon && <ReconcileModal bankId={recon} onClose={() => setRecon(null)} />}
    {newBank && <Modal open onClose={() => setNewBank(false)} title="Add bank account"><NewBankForm onDone={() => { setNewBank(false); banks.reload(); }} /></Modal>}
  </div>;
}
function NewBankForm({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState<any>({}); const { run, busy } = useAction();
  return <div className="space-y-3"><Field label="Name"><Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Ledger account (asset)"><AccountSelect value={v.account_id ?? ''} onChange={(x) => setV({ ...v, account_id: x })} types={['asset', 'liability']} /></Field><Field label="Last 4 digits"><Input value={v.last4 ?? ''} onChange={(e) => setV({ ...v, last4: e.target.value })} /></Field>
    <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/r/bank_accounts', { ...v, provider: 'manual' }), 'Bank account added')) onDone(); }}>Add</Button></div>;
}
function BankReviewModal({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({}); const matches = useApi<any[]>(`/money/bank/transactions/${t.id}/matches`); const { run, busy } = useAction();
  const act = async (body: any, msg: string) => { if (await run(() => api.post(`/money/bank/transactions/${t.id}/review`, body), msg)) { onDone(); onClose(); } };
  return <Modal open onClose={onClose} title={`${t.description} · ${money2(t.amount)}`} size="lg">
    {matches.data && matches.data.length > 0 && <Card title="Suggested matches (same amount, within 5 days)" className="mb-4" padded={false}><Table rows={matches.data} cols={[{ key: 'entry_date', label: 'Date', render: (m) => date(m.entry_date) }, { key: 'memo', label: 'Entry' }, { key: 'source', label: 'Source' }, { key: 'amount', label: 'Amount', align: 'right', render: (m) => money2(m.amount) }, { key: 'm', label: '', render: (m) => <Button size="sm" variant="primary" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => act({ action: 'match', journal_entry_id: m.id }, 'Matched — no duplicate posting')}>Match</Button> }]} /></Card>}
    <div className="grid grid-cols-2 gap-3"><Field label={t.amount < 0 ? 'Expense / category account' : 'Income / category account'} className="col-span-2"><AccountSelect value={v.category_account_id ?? ''} onChange={(x) => setV({ ...v, category_account_id: x })} /></Field><Field label="Fund allocation"><FundSelect value={v.fund_id ?? ''} onChange={(x) => setV({ ...v, fund_id: x })} /></Field></div>
    <div className="mt-4 flex flex-wrap justify-end gap-2"><Button onClick={() => act({ action: 'exclude' }, 'Excluded')}>Exclude</Button><Button variant="primary" loading={busy} onClick={() => act({ action: 'post', ...v }, 'Posted to ledger')}>Post as new entry</Button></div>
  </Modal>;
}
function ReconcileModal({ bankId, onClose }: { bankId: string; onClose: () => void }) {
  const [asOf, setAsOf] = useState(today()); const [stmt, setStmt] = useState('');
  const { data } = useApi<any>(`/money/bank/reconciliation/${bankId}?as_of=${asOf}${stmt ? `&statement_balance=${stmt}` : ''}`, [asOf, stmt]);
  return <Modal open onClose={onClose} title="Reconciliation">
    <div className="grid grid-cols-2 gap-3"><Field label="Statement date"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field><Field label="Statement ending balance"><Input type="number" value={stmt} onChange={(e) => setStmt(e.target.value)} /></Field></div>
    {data && <dl className="mt-4 space-y-1 text-sm"><div className="flex justify-between"><dt>Ledger balance</dt><dd>{money2(data.ledgerBalance)}</dd></div><div className="flex justify-between"><dt>Cleared (reconciled) transactions</dt><dd>{money2(data.clearedBalance)} ({data.clearedCount})</dd></div>
      {data.difference !== null && <div className={cx('flex justify-between font-semibold', data.difference === 0 ? 'text-emerald-600' : 'text-red-600')}><dt>Difference</dt><dd>{money2(data.difference)}</dd></div>}</dl>}
    <p className="mt-3 text-xs text-slate-500">Mark posted/matched bank transactions as reconciled until the difference is zero.</p></Modal>;
}

// ───────── Giving & Receipts (ledger view of gifts) ─────────
export function GivingLedger() {
  const [sp, setSp] = useSearchParams(); const q = Object.fromEntries(sp.entries());
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'offset') n.delete('offset'); setSp(n, { replace: true }); };
  const { data } = useApi<any>(`/giving/gifts${qs({ ...q, limit: 50 })}`); const funds = useFunds() ?? []; const { can } = useSession();
  return <Card padded={false}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3"><SearchInput value={q.q ?? ''} onChange={(v) => set('q', v)} placeholder="Donor, amount, reference…" /><Input type="date" className="w-40" value={q.from ?? ''} onChange={(e) => set('from', e.target.value)} /><Input type="date" className="w-40" value={q.to ?? ''} onChange={(e) => set('to', e.target.value)} />
      <Select className="w-40" value={q.fund_id ?? ''} onChange={(e) => set('fund_id', e.target.value)} placeholder="All funds" options={funds.map((f) => ({ value: f.id, label: f.name }))} /><Select className="w-36" value={q.receipt_status ?? ''} onChange={(e) => set('receipt_status', e.target.value)} placeholder="Any receipt" options={['pending', 'sent', 'not_required']} />
      <Select className="w-36" value={q.provider ?? ''} onChange={(e) => set('provider', e.target.value)} placeholder="Any source" options={['manual', 'stripe', 'square', 'paypal', 'import']} />
      <div className="ml-auto flex gap-2"><Link to="/donors/giving/receipts" className="text-sm text-brand-600 hover:underline">Receipts center</Link>{can('data.export') && <Button size="sm" onClick={() => download(`/giving/gifts/export${qs({ ...q, format: 'xlsx' })}`)}>Export</Button>}</div></div>
    {!data ? <Spinner /> : <><div className="px-4 py-2 text-sm text-slate-600">{num(data.total)} gifts · {money2(data.sum)}</div>
      <Table rows={data.rows} cols={[{ key: 'gift_date', label: 'Date', render: (g) => date(g.gift_date) }, { key: 'donor_name', label: 'Donor', render: (g) => <Link to={`/donors/${g.donor_id}`} className="hover:underline">{g.donor_name}</Link> }, { key: 'fund_name', label: 'Fund', render: (g) => <span className="flex items-center gap-1">{g.fund_name}{g.restriction !== 'unrestricted' && <Chip value={g.restriction} />}</span> },
        { key: 'campaign_name', label: 'Campaign' }, { key: 'provider', label: 'Source', render: (g) => <span className="text-xs">{g.provider}{g.provider_txn_id ? ` · ${g.provider_txn_id.slice(0, 14)}` : ''}</span> }, { key: 'receipt_status', label: 'Receipt', render: (g) => <Chip value={g.receipt_status} /> }, { key: 'ledger_status', label: 'Ledger', render: (g) => <Chip value={g.ledger_status} /> }, { key: 'amount', label: 'Amount', align: 'right', render: (g) => money2(g.amount) }]} />
      <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={(o) => set('offset', String(o))} /></>}
  </Card>;
}

// ───────── Accounting settings ─────────
export function AccountingSettings() {
  const { data, reload } = useApi<any>('/settings'); const { can } = useSession(); const { run } = useAction();
  if (!data) return <Spinner />;
  const t = data.tenant; const rs = t.receipt_settings ?? {};
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card title="Controls"><div className="space-y-3"><Checkbox label="Require approval for all manual journal entries" checked={Boolean(rs.journalApprovalRequired)} disabled={!can('settings.manage')} onChange={async (e) => { if (await run(() => api.patch('/settings', { receipt_settings: { ...rs, journalApprovalRequired: e.target.checked } }), 'Saved')) reload(); }} />
      <p className="text-xs text-slate-500">Users without the approve permission always submit entries for approval. When another approver exists, people cannot approve their own entries.</p>
      <Field label="Fiscal year starts"><Select disabled={!can('settings.manage')} value={String(t.fiscal_year_start_month)} onChange={async (e) => { if (await run(() => api.patch('/settings', { fiscal_year_start_month: Number(e.target.value) }), 'Saved')) reload(); }} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleString('en', { month: 'long' }) }))} /></Field>
      <Button onClick={async () => { await api.post('/onboarding/accounting'); await api.post('/onboarding/funds'); }} size="sm">Mark accounting setup complete</Button></div></Card>
    <Card title="Currency & locale"><p className="text-sm">{t.currency} · {t.locale}. Change in <Link className="text-brand-600 hover:underline" to="/settings">Settings › Organization</Link>.</p></Card>
  </div>;
}

// ───────── Payroll ─────────
export function Payroll() {
  const { data, reload } = useApi<any[]>('/money/payroll'); const [v, setV] = useState<any>({ pay_date: today() }); const { can } = useSession(); const { run, busy } = useAction();
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    {can('finance.write') && <Card title="Record payroll" subtitle="Native payroll records (or synced from your payroll provider via QuickBooks).">
      <div className="space-y-3"><Field label="Staff member / group"><Input value={v.staff_name ?? ''} onChange={(e) => setV({ ...v, staff_name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Pay date"><Input type="date" value={v.pay_date} onChange={(e) => setV({ ...v, pay_date: e.target.value })} /></Field><Field label="Gross wages"><Input type="number" value={v.gross ?? ''} onChange={(e) => setV({ ...v, gross: e.target.value })} /></Field>
          <Field label="Employer taxes"><Input type="number" value={v.employer_taxes ?? ''} onChange={(e) => setV({ ...v, employer_taxes: e.target.value })} /></Field><Field label="Benefits"><Input type="number" value={v.benefits ?? ''} onChange={(e) => setV({ ...v, benefits: e.target.value })} /></Field></div>
        <Field label="Department / program"><Input value={v.department ?? ''} onChange={(e) => setV({ ...v, department: e.target.value })} /></Field><Field label="Wage account"><AccountSelect value={v.account_id ?? ''} onChange={(x) => setV({ ...v, account_id: x })} types={['expense']} placeholder="5000 Salaries & Wages" /></Field>
        <Field label="Fund"><FundSelect value={v.fund_id ?? ''} onChange={(x) => setV({ ...v, fund_id: x })} allowEmpty placeholder="General" /></Field><Field label="Workspace"><WorkspaceSelect value={v.ministry_id ?? ''} onChange={(x) => setV({ ...v, ministry_id: x })} placeholder="Organization-wide" /></Field>
        <Button variant="primary" className="w-full" loading={busy} onClick={async () => { if (await run(() => api.post('/money/payroll', { ...v, account_id: v.account_id || undefined, fund_id: v.fund_id || undefined, ministry_id: v.ministry_id || null }), 'Payroll posted')) { setV({ pay_date: today() }); reload(); } }}>Post payroll</Button></div></Card>}
    <Card title="Payroll expense" className="xl:col-span-2" padded={false}><Table rows={data ?? []} cols={[{ key: 'pay_date', label: 'Pay date', render: (p) => date(p.pay_date) }, { key: 'staff_name', label: 'Staff' }, { key: 'department', label: 'Department' }, { key: 'fund_name', label: 'Fund' }, { key: 'gross', label: 'Gross', align: 'right', render: (p) => money2(p.gross) }, { key: 'employer_taxes', label: 'Taxes', align: 'right', render: (p) => money2(p.employer_taxes) }, { key: 'benefits', label: 'Benefits', align: 'right', render: (p) => money2(p.benefits) }, { key: 'source', label: 'Source' }]} empty="No payroll recorded." /></Card>
  </div>;
}

// ───────── Invoices ─────────
export function Invoices() {
  const [status, setStatus] = useState(''); const { data, reload } = useApi<any[]>(`/money/invoices${status ? `?status=${status}` : ''}`);
  const [edit, setEdit] = useState(false); const nav = useNavigate(); const { can } = useSession();
  return <Card padded={false} title="Invoices" actions={<><Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={['draft', 'sent', 'partial', 'paid', 'void']} />{can('finance.write') && <Button variant="primary" onClick={() => setEdit(true)}>New invoice</Button>}</>}>
    <Table rows={data ?? []} onRowClick={(i) => nav(`/money/invoices/${i.id}`)} cols={[{ key: 'number', label: '#', render: (i) => <span className="font-medium">{i.number}</span> }, { key: 'customer_name', label: 'Customer' }, { key: 'invoice_date', label: 'Date', render: (i) => date(i.invoice_date) }, { key: 'due_date', label: 'Due', render: (i) => <span className={i.status !== 'paid' && i.due_date < today() ? 'text-red-600' : ''}>{date(i.due_date)}</span> }, { key: 'terms', label: 'Terms' }, { key: 'status', label: 'Status', render: (i) => <Chip value={i.status} /> }, { key: 'total', label: 'Total', align: 'right', render: (i) => money2(i.total) }]} empty="No invoices yet." />
    {edit && <InvoiceModal onClose={() => setEdit(false)} onSaved={(i) => { reload(); nav(`/money/invoices/${i.id}`); }} />}
  </Card>;
}
function InvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: (i: any) => void }) {
  const { me } = useSession(); const rates = useRateTypes() ?? []; const jobs = useApi<any>('/r/jobs?limit=200');
  const [v, setV] = useState<any>({ invoice_date: today(), terms: me?.tenant?.invoice_terms ?? 'Net 30', tax_rate: 0, lines: [{ description: '', quantity: 1, rate: 0 }] });
  const { run, busy } = useAction();
  const sub = v.lines.reduce((a: number, l: any) => a + Number(l.quantity || 0) * Number(l.rate || 0), 0);
  const updL = (i: number, p: any) => setV({ ...v, lines: v.lines.map((l: any, k: number) => (k === i ? { ...l, ...p } : l)) });
  return <Modal open onClose={onClose} title="New invoice" size="xl" footer={<><span className="mr-auto self-center text-sm">Subtotal {money2(sub)} · Tax {money2(sub * v.tax_rate / 100)} · <b>Total {money2(sub * (1 + v.tax_rate / 100))}</b></span><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const i = await run(() => api.post('/money/invoices', { ...v, job_id: v.job_id || null, customer_email: v.customer_email || null }), 'Invoice created'); if (i) { onSaved(i); onClose(); } }}>Create invoice</Button></>}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4"><Field label="Customer / client" className="sm:col-span-2"><Input value={v.customer_name ?? ''} onChange={(e) => setV({ ...v, customer_name: e.target.value })} /></Field><Field label="Customer email" className="sm:col-span-2"><Input value={v.customer_email ?? ''} onChange={(e) => setV({ ...v, customer_email: e.target.value })} /></Field>
      <Field label="Invoice date"><Input type="date" value={v.invoice_date} onChange={(e) => setV({ ...v, invoice_date: e.target.value })} /></Field><Field label="Terms"><Select value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })} options={['Due on receipt', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60']} /></Field>
      <Field label="Tax %"><Input type="number" value={v.tax_rate} onChange={(e) => setV({ ...v, tax_rate: Number(e.target.value) })} /></Field>
      <Field label="Related job"><Select value={v.job_id ?? ''} onChange={async (e) => { const id = e.target.value; setV({ ...v, job_id: id }); if (id) { const lines = await api.get(`/money/invoices/from-job/${id}`); if (lines.length && confirm('Fill lines from billable time on this job?')) setV((x: any) => ({ ...x, job_id: id, lines: lines.map((l: any) => ({ ...l })) })); } }} placeholder="None" options={(jobs.data?.rows ?? []).map((j: any) => ({ value: j.id, label: j.title }))} /></Field></div>
    <div className="mt-4 space-y-2">{v.lines.map((l: any, i: number) => <div key={i} className="grid grid-cols-[3fr_1.4fr_1fr_1fr_auto] gap-2"><Input placeholder="Description" value={l.description} onChange={(e) => updL(i, { description: e.target.value })} />
      <Select value={l.rate_type_id ?? ''} onChange={(e) => { const r = rates.find((x) => x.id === e.target.value); updL(i, { rate_type_id: e.target.value || null, rate: r ? r.hourly_rate : l.rate }); }} placeholder="Rate type" options={rates.map((r) => ({ value: r.id, label: `${r.name} (${money(r.hourly_rate)})` }))} />
      <Input type="number" placeholder="Qty / hrs" value={l.quantity} onChange={(e) => updL(i, { quantity: e.target.value })} /><Input type="number" placeholder="Rate" value={l.rate} onChange={(e) => updL(i, { rate: e.target.value })} /><button onClick={() => setV({ ...v, lines: v.lines.filter((_: any, k: number) => k !== i) })}><Trash2 className="h-4 w-4 text-slate-400" /></button></div>)}</div>
    <Button size="sm" className="mt-2" onClick={() => setV({ ...v, lines: [...v.lines, { description: '', quantity: 1, rate: 0 }] })}>Add line</Button>
    <Field label="Notes" className="mt-3"><Textarea rows={2} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
  </Modal>;
}
export function InvoiceDetail() {
  const { id } = useParams(); const { data: inv, reload } = useApi<any>(`/money/invoices/${id}`); const { can } = useSession(); const { run } = useAction();
  if (!inv) return <Spinner />;
  const act = async (body: any, msg: string) => { if (await run(() => api.post(`/money/invoices/${id}/status`, body), msg)) reload(); };
  return <div className="mx-auto max-w-4xl space-y-4"><Link to="/money/invoices" className="text-xs text-brand-600 hover:underline">← Invoices</Link>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-3 text-xl font-bold">Invoice {inv.number}<Chip value={inv.status} /></h2>
      <div className="flex flex-wrap gap-2"><Button icon={<FileText className="h-4 w-4" />} onClick={() => download(`/money/invoices/${id}/pdf`)}>PDF</Button>
        {can('finance.write') && inv.customer_email && <Button onClick={() => run(() => api.post(`/money/invoices/${id}/email`), `Emailed to ${inv.customer_email}`)}>Email invoice</Button>}
        {can('finance.write') && inv.status === 'draft' && <Button variant="primary" onClick={() => act({ action: 'mark_sent' }, 'Marked sent — receivable posted')}>Mark sent</Button>}
        {can('finance.write') && ['sent', 'partial'].includes(inv.status) && <Button variant="primary" onClick={() => { const a = prompt(`Payment amount (balance ${inv.balance})`, String(inv.balance)); if (a) act({ action: 'record_payment', amount: Number(a) }, 'Payment recorded'); }}>Record payment</Button>}
        {can('finance.write') && inv.status !== 'void' && Number(inv.amount_paid) === 0 && <Button variant="ghost" onClick={() => confirm('Void this invoice?') && act({ action: 'void' }, 'Invoice voided')}>Void</Button>}</div></div>
    <Card><div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4"><div><div className="text-xs text-slate-500">Bill to</div>{inv.customer_name}<div className="text-xs">{inv.customer_email}</div></div><div><div className="text-xs text-slate-500">Date</div>{date(inv.invoice_date)}</div><div><div className="text-xs text-slate-500">Terms / due</div>{inv.terms} · {date(inv.due_date)}</div><div><div className="text-xs text-slate-500">Job</div>{inv.job_title ?? '—'}</div></div>
      <Table rowKey="id" rows={inv.lines} cols={[{ key: 'description', label: 'Description' }, { key: 'rate_type_name', label: 'Rate type' }, { key: 'quantity', label: 'Qty / hours', align: 'right' }, { key: 'rate', label: 'Rate', align: 'right', render: (l) => money2(l.rate) }, { key: 'amt', label: 'Amount', align: 'right', render: (l) => money2(l.quantity * l.rate) }]} />
      <dl className="ml-auto mt-3 w-64 space-y-1 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money2(inv.subtotal)}</dd></div><div className="flex justify-between"><dt>Tax ({inv.tax_rate}%)</dt><dd>{money2(inv.tax)}</dd></div><div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money2(inv.total)}</dd></div><div className="flex justify-between"><dt>Paid</dt><dd>{money2(inv.amount_paid)}</dd></div><div className="flex justify-between font-bold"><dt>Balance</dt><dd>{money2(inv.balance)}</dd></div></dl>
      {inv.notes && <p className="mt-3 text-sm text-slate-600">{inv.notes}</p>}</Card>
    <FilesLite id={inv.id} />
  </div>;
}
function FilesLite({ id }: { id: string }) { const { data } = useApi<any[]>(`/attachments?entity_type=invoice&entity_id=${id}`); return data?.length ? <Card title="Attachments">{data.map((f) => <a key={f.id} className="block text-sm text-brand-700" href={`/api/attachments/${f.id}`}>{f.filename}</a>)}</Card> : null; }

// ───────── Reports ─────────
const REPORTS = [['financial-position', 'Statement of Financial Position'], ['activities', 'Statement of Activities'], ['budget-vs-actual', 'Budget vs. Actual'], ['general-ledger', 'General Ledger'], ['trial-balance', 'Trial Balance'], ['fund-activity', 'Fund Activity'], ['restricted-funds', 'Restricted Funds'], ['giving', 'Donor / Giving'], ['campaigns', 'Campaigns']];
export function Reports() {
  const [sp, setSp] = useSearchParams();
  const kind = sp.get('kind') ?? 'activities'; const from = sp.get('from') ?? `${new Date().getFullYear()}-01-01`; const to = sp.get('to') ?? today();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  const { data, error } = useApi<any>(`/money/reports/${kind}?from=${from}&to=${to}`); const { can } = useSession();
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
    <Card padded={false}><nav className="p-2">{REPORTS.map(([k, l]) => <button key={k} onClick={() => set('kind', k)} className={cx('block w-full rounded-lg px-3 py-2 text-left text-sm', kind === k ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50')}>{l}</button>)}</nav></Card>
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">{!['financial-position', 'trial-balance'].includes(kind) && <Field label="From"><Input type="date" value={from} onChange={(e) => set('from', e.target.value)} /></Field>}<Field label={['financial-position', 'trial-balance'].includes(kind) ? 'As of' : 'To'}><Input type="date" value={to} onChange={(e) => set('to', e.target.value)} /></Field>
        {can('data.export') && <div className="ml-auto flex gap-2">{['pdf', 'csv', 'xlsx'].map((f) => <Button key={f} icon={f === 'pdf' ? <FileText className="h-4 w-4" /> : <Download className="h-4 w-4" />} onClick={() => download(`/money/reports/${kind}?from=${from}&to=${to}&format=${f}`)}>{f.toUpperCase()}</Button>)}<Button onClick={() => window.print()}>Print</Button></div>}</div>
      {error ? <ErrorBox error={error} /> : !data ? <Spinner /> : <ReportView kind={kind} d={data} from={from} to={to} />}
    </div>
  </div>;
}
function ReportView({ kind, d, from, to }: { kind: string; d: any; from: string; to: string }) {
  const nav = useNavigate();
  if (kind === 'financial-position') return <Card title={`Statement of Financial Position — as of ${date(d.asOf)}`}>
    <Section title="Assets" rows={d.assets} total={d.totalAssets} /><Section title="Liabilities" rows={d.liabilities} total={d.totalLiabilities} />
    <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Net assets</h4><RowLine l="Without donor restrictions" v={d.netAssetsWithoutRestrictions} onClick={() => nav('/money/accounting/funds')} /><RowLine l="With donor restrictions" v={d.netAssetsWithRestrictions} onClick={() => nav('/money/accounting/funds')} /><RowLine l="Total net assets" v={d.totalNetAssets} bold />
    <RowLine l="Total liabilities and net assets" v={d.totalLiabilities + d.totalNetAssets} bold />{d.check !== 0 && <Notice tone="warn">Out of balance by {money2(d.check)}.</Notice>}</Card>;
  if (kind === 'activities') return <Card title={`Statement of Activities — ${date(d.from)} to ${date(d.to)}`} padded={false}>
    <Table rowKey="account" rows={[...d.revenue.map((r: any) => ({ ...r, s: 'Revenue' })), { account: 'Total revenue', without: d.totals.revenueWithout, with: d.totals.revenueWith, total: d.totals.revenueWithout + d.totals.revenueWith, bold: true },
      ...d.expenses.map((r: any) => ({ ...r, s: 'Expenses' })), { account: 'Total expenses', without: d.totals.expensesWithout, with: d.totals.expensesWith, total: d.totals.expensesWithout + d.totals.expensesWith, bold: true }, { account: 'Change in net assets', without: d.totals.changeWithout, with: d.totals.changeWith, total: d.totals.change, bold: true }]}
      cols={[{ key: 'account', label: 'Account', render: (r) => <span className={r.bold ? 'font-bold' : ''}>{r.account}</span> }, { key: 'without', label: 'Without donor restrictions', align: 'right', render: (r) => money2(r.without) }, { key: 'with', label: 'With donor restrictions', align: 'right', render: (r) => money2(r.with) }, { key: 'total', label: 'Total', align: 'right', render: (r) => <b>{money2(r.total)}</b> }]} /></Card>;
  if (kind === 'trial-balance') return <Card title={`Trial Balance — as of ${date(d.asOf)}`} padded={false}><Table rowKey="code" rows={d.rows} onRowClick={() => nav('/money/accounting/transactions')} cols={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'debit', label: 'Debit', align: 'right', render: (r) => (r.debit ? money2(r.debit) : '') }, { key: 'credit', label: 'Credit', align: 'right', render: (r) => (r.credit ? money2(r.credit) : '') }]} /><div className="flex justify-end gap-8 px-4 py-3 text-sm font-bold"><span>{money2(d.totalDebit)}</span><span>{money2(d.totalCredit)}</span></div></Card>;
  if (kind === 'general-ledger') return <Card title="General Ledger" padded={false}><Table rowKey="entry_id" rows={d.rows.slice(0, 500)} cols={[{ key: 'entry_date', label: 'Date', render: (r) => date(r.entry_date) }, { key: 'account', label: 'Account', render: (r) => `${r.code} ${r.account}` }, { key: 'fund', label: 'Fund' }, { key: 'memo', label: 'Memo' }, { key: 'debit', label: 'Debit', align: 'right', render: (r) => (r.debit ? money2(r.debit) : '') }, { key: 'credit', label: 'Credit', align: 'right', render: (r) => (r.credit ? money2(r.credit) : '') }]} />{d.rows.length > 500 && <p className="p-3 text-xs text-slate-500">Showing 500 of {d.rows.length} lines — export for the full ledger.</p>}</Card>;
  if (kind === 'fund-activity' || kind === 'restricted-funds') return <Card title={kind === 'fund-activity' ? 'Fund Activity' : 'Restricted Funds'} padded={false}><Table rows={d.rows} onRowClick={(r) => nav(`/money/accounting/funds/${r.id}`)} cols={[{ key: 'name', label: 'Fund' }, { key: 'restriction', label: 'Restriction', render: (r) => <Chip value={r.restriction} /> }, { key: 'opening', label: 'Opening', align: 'right', render: (r) => money2(r.opening) }, { key: 'income', label: 'Income', align: 'right', render: (r) => money2(r.income) }, { key: 'expenses', label: 'Expenses', align: 'right', render: (r) => money2(r.expenses) }, { key: 'transfers', label: 'Transfers', align: 'right', render: (r) => money2(r.transfers) }, { key: 'closing', label: 'Closing', align: 'right', render: (r) => <b>{money2(r.closing)}</b> }]} /></Card>;
  if (kind === 'budget-vs-actual') return <Card title={`Budget vs. Actual — ${d.budget.name}`} padded={false}><Table rows={d.rows} cols={[{ key: 'account_name', label: 'Account', render: (r) => `${r.code} ${r.account_name}` }, { key: 'amount', label: 'Budget', align: 'right', render: (r) => money(r.amount) }, { key: 'actual', label: 'Actual', align: 'right', render: (r) => money(r.actual) }, { key: 'variance', label: 'Variance', align: 'right', render: (r) => <span className={r.variance < 0 ? 'text-red-600' : ''}>{money(r.variance)}</span> }, { key: 'pct', label: '%', align: 'right', render: (r) => `${r.pct ?? '—'}%` }]} /></Card>;
  if (kind === 'giving') return <Card title={`Giving — ${money2(d.total)}`} padded={false}><Table rowKey="month" rows={d.byMonth} onRowClick={(r) => nav(`/money/accounting/giving?from=${r.month}-01&to=${r.month}-31`)} cols={[{ key: 'month', label: 'Month' }, { key: 'gifts', label: 'Gifts', align: 'right' }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'total', label: 'Total', align: 'right', render: (r) => money2(r.total) }]} /></Card>;
  if (kind === 'campaigns') return <Card title="Campaigns" padded={false}><Table rows={d.rows} onRowClick={(r) => nav(`/donors/giving/campaigns/${r.id}`)} cols={[{ key: 'name', label: 'Campaign' }, { key: 'gifts', label: 'Gifts', align: 'right' }, { key: 'donors', label: 'Donors', align: 'right' }, { key: 'raised', label: 'Raised', align: 'right', render: (r) => money2(r.raised) }, { key: 'goal', label: 'Goal', align: 'right', render: (r) => (r.goal ? money(r.goal) : '—') }]} /></Card>;
  return null;
}
function Section({ title, rows, total }: { title: string; rows: any[]; total: number }) { return <><h4 className="mt-2 text-xs font-semibold uppercase text-slate-500">{title}</h4>{rows.map((r) => <RowLine key={r.account} l={r.account} v={r.amount} />)}<RowLine l={`Total ${title.toLowerCase()}`} v={total} bold /></>; }
function RowLine({ l, v, bold, onClick }: { l: string; v: number; bold?: boolean; onClick?: () => void }) { return <div onClick={onClick} className={cx('flex justify-between border-b border-slate-50 py-1.5 text-sm', bold && 'font-semibold', onClick && 'cursor-pointer hover:bg-slate-50')}><span>{l}</span><span className="tabular-nums">{money2(v)}</span></div>; }

// ───────── Weekly updates ─────────
export function Updates() {
  const { data, reload } = useApi<any[]>('/money/updates');
  const [v, setV] = useState<any>({ period_start: addDays(today(), -7), period_end: today(), exclude_private: true });
  const [cur, setCur] = useState<any>(null); const [content, setContent] = useState('');
  const { can, term } = useSession(); const { run, busy } = useAction(); const { push } = useToast();
  useEffect(() => { if (cur) setContent(cur.content); }, [cur]);
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    <div className="space-y-5">
      <Card title={`Weekly ${term} updates`} subtitle="Summarizes gifts, tasks, campaigns, grants, finances, events and impact.">
        <div className="space-y-3"><Field label={term}><WorkspaceSelect value={v.ministry_id ?? ''} onChange={(x) => setV({ ...v, ministry_id: x || null })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="From"><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} /></Field><Field label="To"><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} /></Field></div>
          <Checkbox label="Exclude private communications and internal notes" checked={v.exclude_private} onChange={(e) => setV({ ...v, exclude_private: e.target.checked })} />
          <Button variant="primary" className="w-full" icon={<Sparkles className="h-4 w-4" />} loading={busy} onClick={async () => { const r = await run(() => api.post('/money/updates/generate', v), 'Update generated'); if (r) { setCur(r); reload(); } }}>Generate Update</Button></div></Card>
      <Card title="Previous updates" padded={false}><Table rows={data ?? []} onRowClick={setCur} cols={[{ key: 'period_start', label: 'Period', render: (u) => `${date(u.period_start)} – ${date(u.period_end)}` }, { key: 'ministry_name', label: term, render: (u) => u.ministry_name ?? 'All' }, { key: 'status', label: '', render: (u) => <Chip value={u.status === 'final' ? 'completed' : 'draft'}>{u.status}</Chip> }]} empty="No updates yet." /></Card>
    </div>
    <Card className="xl:col-span-2" title={cur ? `Update ${date(cur.period_start)} – ${date(cur.period_end)}` : 'Update'} actions={cur && <><AiBadge generator={cur.generator} />
      <Button size="sm" onClick={() => { navigator.clipboard.writeText(content); push('success', 'Copied'); }}>Copy</Button>
      <Button size="sm" onClick={async () => { const r = await run(() => api.patch(`/money/updates/${cur.id}`, { content }), 'Saved'); if (r) { setCur(r); reload(); } }}>Save</Button>
      {can('data.export') && <Button size="sm" onClick={() => download(`/money/updates/${cur.id}/pdf`)}>Export PDF</Button>}
      <Button size="sm" onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent(`Weekly update ${cur.period_start} – ${cur.period_end}`)}&body=${encodeURIComponent(content)}`; }}>Share by email</Button>
      <Button size="sm" variant="primary" onClick={async () => { const r = await run(() => api.patch(`/money/updates/${cur.id}`, { content, status: 'final' }), 'Marked final'); if (r) { setCur(r); reload(); } }}>Mark final</Button></>}>
      {!cur ? <Empty title="Generate or open an update">Updates are editable drafts until you save or share them.</Empty> : <Textarea rows={26} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-[13px]" />}
    </Card>
  </div>;
}
export const _m = { useAccounts, StateTabs, label, cx };
