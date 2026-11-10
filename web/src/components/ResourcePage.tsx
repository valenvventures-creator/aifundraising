/** Config-driven list + create/edit for straightforward entities (uses /api/r/:resource). */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, Pencil, Trash2 } from 'lucide-react';
import { api, useApi, qs, download } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Field, Input, Select, Textarea, Checkbox, Modal, Table, Pager, SearchInput, Spinner, ErrorBox, Empty, useAction, useToast, type Col } from './ui';
import { FundSelect, WorkspaceSelect, TeamSelect, SimpleSelect, AccountSelect, invalidate } from './domain';
import { label } from '../lib/format';

export interface FieldDef {
  key: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'textarea' | 'bool' | 'fund' | 'workspace' | 'team' | 'lookup' | 'account' | 'json';
  options?: string[] | { value: string; label: string }[]; lookup?: string; required?: boolean; span?: 2; hint?: string; default?: any; accountTypes?: string[];
}

export function FieldInput({ f, value, onChange }: { f: FieldDef; value: any; onChange: (v: any) => void }) {
  switch (f.type) {
    case 'number': return <Input type="number" step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date': return <Input type="date" value={value ? String(value).slice(0, 10) : ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime': return <Input type="datetime-local" value={value ? toLocalInput(value) : ''} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'select': return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} placeholder={f.required ? undefined : '—'} options={(f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: label(o) } : o))} />;
    case 'textarea': return <Textarea rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'bool': return <div className="pt-2"><Checkbox label={f.label} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /></div>;
    case 'fund': return <FundSelect value={value ?? ''} onChange={(v) => onChange(v || null)} allowEmpty={!f.required} placeholder="—" />;
    case 'workspace': return <WorkspaceSelect value={value ?? ''} onChange={(v) => onChange(v || null)} placeholder="Organization-wide" />;
    case 'team': return <TeamSelect value={value ?? ''} onChange={(v) => onChange(v || null)} />;
    case 'account': return <AccountSelect value={value ?? ''} onChange={(v) => onChange(v || null)} types={f.accountTypes} />;
    case 'lookup': return <SimpleSelect url={f.lookup!} value={value ?? ''} onChange={(v) => onChange(v || null)} labelKey={f.lookup?.includes('grants') || f.lookup?.includes('tasks') || f.lookup?.includes('jobs') ? 'title' : 'name'} />;
    default: return <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
function toLocalInput(v: string) { const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

export function RecordModal({ open, onClose, resource, fields, record, onSaved, title, defaults }: { open: boolean; onClose: () => void; resource: string; fields: FieldDef[]; record?: any; onSaved?: (r: any) => void; title: string; defaults?: any }) {
  const [v, setV] = useState<any>({});
  const { run, busy } = useAction();
  useEffect(() => { if (open) setV(record ? { ...record } : { ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...defaults }); }, [open]); // eslint-disable-line
  const save = async () => {
    const body = Object.fromEntries(fields.map((f) => [f.key, v[f.key] === undefined ? (f.type === 'bool' ? false : null) : v[f.key]]).filter(([k, val]) => !(record === undefined && val === null && !fields.find((f) => f.key === k)?.required)));
    const r = record ? await api.patch(`/r/${resource}/${record.id}`, body) : await api.post(`/r/${resource}`, body);
    invalidate(`/r/${resource}`);
    return r;
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? `Edit ${title.toLowerCase()}` : `New ${title.toLowerCase()}`} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const r = await run(save, `${title} saved`); if (r) { onSaved?.(r); onClose(); } }}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => f.type === 'bool'
          ? <div key={f.key}><FieldInput f={f} value={v[f.key]} onChange={(x) => setV((o: any) => ({ ...o, [f.key]: x }))} /></div>
          : <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} className={f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : ''}><FieldInput f={f} value={v[f.key]} onChange={(x) => setV((o: any) => ({ ...o, [f.key]: x }))} /></Field>)}
      </div>
    </Modal>
  );
}

export function ResourcePage<T extends Record<string, any>>({ resource, title, fields, cols, filters, writePerm, emptyText, emptyAction, onRowClick, extraActions, defaults, baseQuery = {}, cardTitle }: {
  resource: string; title: string; fields: FieldDef[]; cols: Col<T>[]; filters?: React.ReactNode | ((q: Record<string, string>, set: (k: string, v: string) => void) => React.ReactNode); writePerm: string;
  emptyText?: React.ReactNode; emptyAction?: string; onRowClick?: (r: T) => void; extraActions?: React.ReactNode; defaults?: any; baseQuery?: Record<string, string>; cardTitle?: string;
}) {
  const [sp, setSp] = useSearchParams();
  const q = Object.fromEntries(sp.entries());
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'offset') n.delete('offset'); setSp(n, { replace: true }); };
  const url = `/r/${resource}${qs({ ...baseQuery, ...q, limit: 50 })}`;
  const { data, loading, error, reload } = useApi<{ rows: T[]; total: number; limit: number; offset: number }>(url);
  const { can } = useSession();
  const [edit, setEdit] = useState<{ open: boolean; rec?: any }>({ open: false });
  const { run } = useAction(); const { confirm } = useToast();
  const canWrite = can(writePerm);
  const allCols: Col<T>[] = useMemo(() => [...cols, ...(canWrite ? [{ key: '_actions', label: '', align: 'right' as const, render: (r: T) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit" onClick={() => setEdit({ open: true, rec: r })}><Pencil className="h-4 w-4" /></button>
      <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete / archive" onClick={async () => { if (await confirm({ title: `Remove ${title.toLowerCase()}?`, message: 'This cannot be undone (records with history are archived instead).', danger: true, confirmLabel: 'Remove' })) { const ok = await run(() => api.del(`/r/${resource}/${r.id}`), `${title} removed`); if (ok) reload(); } }}><Trash2 className="h-4 w-4" /></button>
    </div>) }] : [])], [cols, canWrite]); // eslint-disable-line
  return (
    <>
      <Card padded={false} title={cardTitle} actions={undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <SearchInput value={q.q ?? ''} onChange={(v) => set('q', v)} placeholder={`Search ${title.toLowerCase()}s…`} />
          {typeof filters === 'function' ? filters(q, set) : filters}
          <div className="ml-auto flex flex-wrap gap-2">
            {extraActions}
            {can('data.export') && <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => download(`/r/${resource}/export${qs({ ...baseQuery, ...q, format: 'csv' })}`)}>CSV</Button>}
            {can('data.export') && <Button size="sm" onClick={() => download(`/r/${resource}/export${qs({ ...baseQuery, ...q, format: 'xlsx' })}`)}>XLSX</Button>}
            {canWrite && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ open: true })}>{emptyAction ?? `New ${title.toLowerCase()}`}</Button>}
          </div>
        </div>
        {error ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : loading && !data ? <Spinner /> :
          !data?.rows.length && !q.q && Object.keys(q).length === 0 ? <div className="p-4"><Empty title={`No ${title.toLowerCase()}s yet`} action={canWrite && <Button variant="primary" onClick={() => setEdit({ open: true })}>{emptyAction ?? `New ${title.toLowerCase()}`}</Button>}>{emptyText}</Empty></div> :
          <>
            <Table cols={allCols} rows={data?.rows ?? []} onRowClick={onRowClick ?? (canWrite ? (r) => setEdit({ open: true, rec: r }) : undefined)}
              sort={q.sort ? { key: q.sort, dir: (q.dir as any) ?? 'desc' } : undefined} onSort={(k) => { const n = new URLSearchParams(sp); n.set('sort', k); n.set('dir', q.sort === k && q.dir !== 'asc' ? 'asc' : 'desc'); setSp(n, { replace: true }); }} />
            {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={(o) => set('offset', String(o))} />}
          </>}
      </Card>
      <RecordModal open={edit.open} onClose={() => setEdit({ open: false })} resource={resource} fields={fields} record={edit.rec} title={title} onSaved={reload} defaults={defaults} />
    </>
  );
}
