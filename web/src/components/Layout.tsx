import { BrandLockup } from './Brand';
import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Home, Users, DollarSign, ListChecks, TrendingUp, HeartHandshake, MessageSquare, ShieldCheck, Settings, Sparkles, Search, Bell, Menu, X, LogOut, ChevronDown, Building2 } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import { cx, Modal } from './ui';
import { ago } from '../lib/format';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/donors', label: 'Donors', icon: Users, perm: ['donors.read', 'grants.read', 'projects.read', 'email.read', 'events.read'] },
  { to: '/money', label: 'Money', icon: DollarSign, perm: ['finance.read'] },
  { to: '/work', label: 'Work', icon: ListChecks, perm: ['work.read'] },
  { to: '/growth', label: 'Growth', icon: TrendingUp, perm: ['donors.read'] },
  { to: '/impact', label: 'Impact', icon: HeartHandshake, perm: ['impact.read'] },
  { to: '/messages', label: 'Messages', icon: MessageSquare, perm: ['messages.use'] },
  { to: '/admin', label: 'Admin & Access', icon: ShieldCheck, perm: ['admin.users', 'audit.read'] },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/ask', label: 'Ask A.I. Fundraising', icon: Sparkles, perm: ['ai.ask'] },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {compact ? <img src="/logo-emblem.webp" alt="A.I. Fundraising" className="h-8 w-auto" /> : <BrandLockup size="xs" onDark />}
    </div>
  );
}

export function Layout() {
  const { me, can, reload } = useSession();
  const [mobile, setMobile] = useState(false);
  const [finder, setFinder] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMobile(false); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFinder(true); } if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); setFinder(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const nav = NAV.filter((n) => !n.perm || n.perm.some((p) => can(p)));
  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="px-4 py-5"><Link to="/"><Logo /></Link></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
            isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white', n.to === '/ask' && !isActive && 'text-violet-300')}>
            <n.icon className="h-4.5 h-[18px] w-[18px]" />{n.label}
          </NavLink>
        ))}
      </nav>
      <OrgSwitcher />
      <div className="border-t border-slate-800 px-4 py-3 text-xs">
        <div className="truncate font-medium text-slate-200">{me?.user.name}</div>
        <div className="truncate text-slate-500">{me?.role}</div>
        <button onClick={async () => { await api.post('/auth/logout'); await reload(); }} className="mt-2 inline-flex items-center gap-1 text-slate-400 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>
      {mobile && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} /><div className="absolute inset-y-0 left-0 w-72">{sidebar}</div></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:px-6">
          <button className="rounded-lg p-1.5 hover:bg-slate-100 lg:hidden" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <button onClick={() => setFinder(true)} className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-sm text-slate-400 hover:border-slate-300 sm:max-w-md">
            <Search className="h-4 w-4" /><span className="flex-1 truncate">Quick Find — donors, gifts, grants, funds, tasks…</span><kbd className="hidden rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-500 sm:inline">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {can('ai.ask') && <Link to="/ask" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50 sm:inline-flex"><Sparkles className="h-4 w-4" />Ask A.I. Fundraising</Link>}
            <Notifications />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8"><Outlet /></main>
      </div>
      <QuickFind open={finder} onClose={() => setFinder(false)} />
    </div>
  );
}

function OrgSwitcher() {
  const { me, reload } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (!me) return null;
  return (
    <div className="relative border-t border-slate-800 px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800">
        <Building2 className="h-4 w-4 shrink-0" /><span className="flex-1 truncate">{me.tenant?.name}</span><ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-3 right-3 z-50 mb-1 rounded-xl border border-slate-700 bg-slate-800 py-1 shadow-xl">
          {me.organizations.map((o) => (
            <button key={o.id} onClick={async () => { await api.post('/auth/switch', { tenantId: o.id }); setOpen(false); await reload(); nav('/'); }}
              className={cx('block w-full truncate px-3 py-2 text-left text-xs hover:bg-slate-700', o.id === me.tenant?.id ? 'text-white' : 'text-slate-300')}>{o.name}</button>
          ))}
          <button onClick={() => { setOpen(false); nav('/new-organization'); }} className="block w-full border-t border-slate-700 px-3 py-2 text-left text-xs text-brand-200 hover:bg-slate-700">+ New organization</button>
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<{ rows: any[]; unread: number }>('/notifications');
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />{Boolean(data?.unread) && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{data!.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-sm font-semibold">Notifications</span>
            <div className="flex gap-3 text-xs"><button className="text-brand-600 hover:underline" onClick={async () => { await api.post('/notifications/read'); reload(); }}>Mark all read</button><Link to="/settings?tab=notifications" className="text-slate-500 hover:underline" onClick={() => setOpen(false)}>Preferences</Link></div></div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.rows.length && <div className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</div>}
            {data?.rows.map((n) => (
              <button key={n.id} onClick={async () => { await api.post('/notifications/read', { ids: [n.id] }); setOpen(false); reload(); if (n.link) nav(n.link); }}
                className={cx('block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.read_at && 'bg-brand-50/40')}>
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-800">{n.title}</span><span className="shrink-0 text-[11px] text-slate-400">{ago(n.created_at)}</span></div>
                {n.body && <div className="mt-0.5 text-xs text-slate-500">{n.body}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickFind({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setResults([]); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => { try { setResults(await api.get(`/search?q=${encodeURIComponent(q)}`)); setActive(0); } catch { setResults([]); } }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const go = (r: any) => { onClose(); nav(r.href); };
  return (
    <Modal open={open} onClose={onClose} title="Quick Find" size="lg">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone, amount, reference #, organization…"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } if (e.key === 'Enter' && results[active]) go(results[active]); }}
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
      </div>
      <div className="mt-3 space-y-0.5">
        {q.length >= 2 && !results.length && <div className="py-6 text-center text-sm text-slate-500">No matches.</div>}
        {results.map((r, i) => (
          <button key={`${r.type}-${r.id}-${i}`} onMouseEnter={() => setActive(i)} onClick={() => go(r)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}>
            <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.type}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{r.title}</span>{r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">↑↓ to navigate · Enter to open · Esc to close</p>
    </Modal>
  );
}

export function MobileClose({ onClick }: { onClick: () => void }) { return <button onClick={onClick}><X /></button>; }
