import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { X, Loader2, ChevronUp, ChevronDown, AlertTriangle, CheckCircle2, Info, Inbox } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────── Buttons ─────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean; icon?: React.ReactNode }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-300',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', v, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
export function LinkButton({ to, variant = 'secondary', children, icon, className }: { to: string; variant?: BtnVariant; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  const v = { primary: 'bg-brand-600 text-white hover:bg-brand-700', secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50', ghost: 'text-slate-600 hover:bg-slate-100', subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100', danger: 'bg-red-600 text-white' }[variant];
  return <Link to={to} className={cx('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm', v, className)}>{icon}{children}</Link>;
}

// ───────── Layout primitives ─────────
export function Card({ title, actions, children, className, padded = true, subtitle }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <div><h3 className="text-sm font-semibold text-slate-800">{title}</h3>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
export function PageHeader({ title, subtitle, actions, children }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
export function Metric({ label, value, sub, to, tone = 'default', icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string; tone?: 'default' | 'good' | 'warn' | 'bad' | 'brand'; icon?: React.ReactNode }) {
  const tones = { default: 'text-slate-900', good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600', brand: 'text-brand-700' };
  const inner = (
    <div className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm', to && 'transition hover:border-brand-300 hover:shadow')}>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">{label}{icon}</div>
      <div className={cx('mt-1.5 text-2xl font-bold', tones[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

// ───────── Chips / status ─────────
const CHIP: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200', engaged: 'bg-sky-50 text-sky-700 ring-sky-200', cooling: 'bg-amber-50 text-amber-700 ring-amber-200',
  lapsing: 'bg-orange-50 text-orange-700 ring-orange-200', lapsed: 'bg-red-50 text-red-700 ring-red-200',
  high: 'bg-red-50 text-red-700 ring-red-200', medium: 'bg-amber-50 text-amber-700 ring-amber-200', low: 'bg-slate-100 text-slate-600 ring-slate-200',
  draft: 'bg-slate-100 text-slate-600 ring-slate-200', scheduled: 'bg-sky-50 text-sky-700 ring-sky-200', sending: 'bg-indigo-50 text-indigo-700 ring-indigo-200', sent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200', archived: 'bg-slate-100 text-slate-500 ring-slate-200', posted: 'bg-emerald-50 text-emerald-700 ring-emerald-200', void: 'bg-red-50 text-red-700 ring-red-200',
  pending_approval: 'bg-amber-50 text-amber-700 ring-amber-200', pending: 'bg-amber-50 text-amber-700 ring-amber-200', not_required: 'bg-slate-100 text-slate-500 ring-slate-200',
  unrestricted: 'bg-emerald-50 text-emerald-700 ring-emerald-200', purpose: 'bg-violet-50 text-violet-700 ring-violet-200', time: 'bg-sky-50 text-sky-700 ring-sky-200', permanent: 'bg-gold-400/20 text-gold-600 ring-gold-400/40',
  awarded: 'bg-emerald-50 text-emerald-700 ring-emerald-200', declined: 'bg-red-50 text-red-700 ring-red-200', submitted: 'bg-sky-50 text-sky-700 ring-sky-200', under_review: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  todo: 'bg-slate-100 text-slate-700 ring-slate-200', in_progress: 'bg-indigo-50 text-indigo-700 ring-indigo-200', waiting: 'bg-amber-50 text-amber-700 ring-amber-200', completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  connected: 'bg-emerald-50 text-emerald-700 ring-emerald-200', disconnected: 'bg-slate-100 text-slate-500 ring-slate-200', error: 'bg-red-50 text-red-700 ring-red-200', conflict: 'bg-red-50 text-red-700 ring-red-200',
  synced: 'bg-emerald-50 text-emerald-700 ring-emerald-200', queued: 'bg-sky-50 text-sky-700 ring-sky-200', unmatched: 'bg-amber-50 text-amber-700 ring-amber-200', matched: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  unreviewed: 'bg-amber-50 text-amber-700 ring-amber-200', excluded: 'bg-slate-100 text-slate-500 ring-slate-200', duplicate: 'bg-red-50 text-red-700 ring-red-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200', partial: 'bg-amber-50 text-amber-700 ring-amber-200', delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200', created: 'bg-sky-50 text-sky-700 ring-sky-200', corrected: 'bg-amber-50 text-amber-700 ring-amber-200',
  registered: 'bg-sky-50 text-sky-700 ring-sky-200', attended: 'bg-emerald-50 text-emerald-700 ring-emerald-200', no_show: 'bg-red-50 text-red-700 ring-red-200', cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
  invited: 'bg-sky-50 text-sky-700 ring-sky-200', inactive: 'bg-slate-100 text-slate-500 ring-slate-200', open: 'bg-emerald-50 text-emerald-700 ring-emerald-200', closed: 'bg-slate-100 text-slate-500 ring-slate-200',
  claude: 'bg-violet-50 text-violet-700 ring-violet-200', template: 'bg-slate-100 text-slate-600 ring-slate-200', rules: 'bg-slate-100 text-slate-600 ring-slate-200',
};
export function Chip({ value, children, className }: { value?: string | null; children?: React.ReactNode; className?: string }) {
  const k = String(value ?? '').toLowerCase();
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CHIP[k] ?? 'bg-slate-100 text-slate-700 ring-slate-200', className)}>{children ?? (value ? value.replace(/_/g, ' ') : '—')}</span>;
}
export function Progress({ value, max = 100, tone = 'brand' }: { value: number; max?: number; tone?: 'brand' | 'good' | 'warn' | 'bad' }) {
  const p = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const c = { brand: 'bg-brand-500', good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }[tone];
  return <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full transition-all', c)} style={{ width: `${p}%` }} /></div>;
}

// ───────── Tabs ─────────
export function PillTabs({ tabs, className }: { tabs: { to: string; label: string; end?: boolean; hidden?: boolean }[]; className?: string }) {
  return (
    <nav className={cx('flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1', className)}>
      {tabs.filter((t) => !t.hidden).map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition', isActive ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{t.label}</NavLink>
      ))}
    </nav>
  );
}
export function StateTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', value === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────── Forms ─────────
export function Field({ label, children, hint, error, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; error?: string; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} {...p} className={cx(inputCls, p.className)} />);
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...p} className={cx(inputCls, p.className)} />;
export function Select({ options, placeholder, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] | string[]; placeholder?: string }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o.replace(/_/g, ' ') } : o));
  return (
    <select {...p} className={cx(inputCls, 'pr-8', p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Checkbox({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" {...p} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />{label}</label>;
}
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  useEffect(() => { const t = setTimeout(() => v !== value && onChange(v), 300); return () => clearTimeout(t); }, [v]); // eslint-disable-line
  return <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className={cx('max-w-xs', className)} />;
}

// ───────── Modal ─────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 pt-10 backdrop-blur-sm sm:p-6 sm:pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl', w)} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ───────── Toasts & confirm ─────────
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string) => void; confirm: (opts: ConfirmOpts) => Promise<boolean> }>({ push: () => {}, confirm: async () => false });
interface ConfirmOpts { title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean }
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [conf, setConf] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  const push = (kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  };
  const confirm = (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConf({ ...o, resolve }));
  return (
    <ToastCtx.Provider value={{ push, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg', t.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : t.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-800')}>
            {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <Modal open={Boolean(conf)} onClose={() => { conf?.resolve(false); setConf(null); }} title={conf?.title} size="sm"
        footer={<><Button onClick={() => { conf?.resolve(false); setConf(null); }}>Cancel</Button><Button variant={conf?.danger ? 'danger' : 'primary'} onClick={() => { conf?.resolve(true); setConf(null); }}>{conf?.confirmLabel ?? 'Confirm'}</Button></>}>
        <div className="text-sm text-slate-600">{conf?.message}</div>
      </Modal>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Run an async action with toast feedback. Returns the result or undefined on error. */
export function useAction() {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (success) push('success', success); return r; }
    catch (e: any) { push('error', e.message ?? 'Something failed'); return undefined; }
    finally { setBusy(false); }
  };
  return { run, busy };
}

// ───────── States ─────────
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-brand-500" />{label}</div>;
}
export function Empty({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</span>{onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}</div>;
}
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ai'; children: React.ReactNode }) {
  const c = { info: 'border-sky-200 bg-sky-50 text-sky-800', warn: 'border-amber-200 bg-amber-50 text-amber-800', ai: 'border-violet-200 bg-violet-50 text-violet-800' }[tone];
  return <div className={cx('rounded-xl border px-4 py-3 text-sm', c)}>{children}</div>;
}

// ───────── Table ─────────
export interface Col<T> { key: string; label: string; render?: (r: T) => React.ReactNode; align?: 'left' | 'right'; sortable?: boolean; className?: string }
export function Table<T extends Record<string, any>>({ cols, rows, onRowClick, sort, onSort, empty, selectable, selected, onSelect, rowKey = 'id' }: {
  cols: Col<T>[]; rows: T[]; onRowClick?: (r: T) => void; sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (key: string) => void; empty?: React.ReactNode;
  selectable?: boolean; selected?: Set<string>; onSelect?: (s: Set<string>) => void; rowKey?: string;
}) {
  const allSel = selectable && rows.length > 0 && rows.every((r) => selected?.has(r[rowKey]));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {selectable && <th className="w-8 px-3 py-2.5"><input type="checkbox" checked={Boolean(allSel)} onChange={() => { const s = new Set(selected); rows.forEach((r) => (allSel ? s.delete(r[rowKey]) : s.add(r[rowKey]))); onSelect?.(s); }} /></th>}
            {cols.map((c) => (
              <th key={c.key} className={cx('whitespace-nowrap px-3 py-2.5', c.align === 'right' && 'text-right', c.sortable && 'cursor-pointer select-none hover:text-slate-800')} onClick={() => c.sortable && onSort?.(c.key)}>
                {c.label}{sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp className="ml-0.5 inline h-3 w-3" /> : <ChevronDown className="ml-0.5 inline h-3 w-3" />)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={() => onRowClick?.(r)} className={cx(onRowClick && 'cursor-pointer', 'hover:bg-slate-50/70')}>
              {selectable && <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={Boolean(selected?.has(r[rowKey]))} onChange={() => { const s = new Set(selected); s.has(r[rowKey]) ? s.delete(r[rowKey]) : s.add(r[rowKey]); onSelect?.(s); }} /></td>}
              {cols.map((c) => <td key={c.key} className={cx('px-3 py-2.5 align-top text-slate-700', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="py-10 text-center text-sm text-slate-500">{empty ?? 'No records found.'}</div>}
    </div>
  );
}
export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  if (total <= limit) return <div className="px-3 py-2 text-xs text-slate-500">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
      <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <div className="flex gap-1"><Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button><Button size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button></div>
    </div>
  );
}

export function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null;
  return <span className={cx('text-xs', state === 'error' ? 'text-red-600' : 'text-slate-500')}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'All changes saved' : 'Not saved'}</span>;
}

export function Dropdown({ label, items, icon }: { label: React.ReactNode; icon?: React.ReactNode; items: { label: string; onClick: () => void; hidden?: boolean; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  return (
    <div className="relative" ref={ref}>
      <Button icon={icon} onClick={() => setOpen((o) => !o)}>{label}<ChevronDown className="h-3.5 w-3.5" /></Button>
      {open && <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
        {items.filter((i) => !i.hidden).map((i) => <button key={i.label} onClick={() => { setOpen(false); i.onClick(); }} className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-slate-50', i.danger ? 'text-red-600' : 'text-slate-700')}>{i.label}</button>)}
      </div>}
    </div>
  );
}

/** Labels AI-generated content so users can distinguish it from database facts. */
export function AiBadge({ generator }: { generator?: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">✦ {generator === 'claude' ? 'AI-generated draft' : generator === 'rules' ? 'Calculated from your data' : 'Template draft'}</span>;
}
