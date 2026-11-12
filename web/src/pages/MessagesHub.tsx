/** Messages home: unread, mentions and what needs this person across the app. Shown when no conversation is open. */
import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, AtSign, Inbox, Bell, ListTodo, ShieldCheck, HeartHandshake, Award, Plus } from 'lucide-react';
import { useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Spinner, cx } from '../components/ui';
import { ago, date } from '../lib/format';

const NEED: Record<string, { icon: React.ElementType; cls: string }> = {
  Task: { icon: ListTodo, cls: 'bg-indigo-50 text-indigo-700' }, Approval: { icon: ShieldCheck, cls: 'bg-amber-50 text-amber-700' },
  Donor: { icon: HeartHandshake, cls: 'bg-rose-50 text-rose-700' }, Grant: { icon: Award, cls: 'bg-emerald-50 text-emerald-700' },
};

export function MessagesHome({ onNew }: { onNew: () => void }) {
  const { me } = useSession();
  const { data: d } = useApi<any>('/overview/messages');
  if (!d) return <Spinner />;
  const first = String(me?.user?.name ?? '').split(' ')[0];
  const tiles = [
    { icon: Inbox, label: 'Unread messages', value: d.stats.unread, sub: `in ${d.stats.unread_threads} ${d.stats.unread_threads === 1 ? 'conversation' : 'conversations'}` },
    { icon: AtSign, label: 'Mentions of you', value: d.mentions.length, sub: 'last 30 days' },
    { icon: MessageCircle, label: 'Open conversations', value: d.stats.open_threads, sub: `${d.stats.week_messages} messages this week` },
    { icon: Bell, label: 'Unread alerts', value: d.notifications.length, sub: 'from across the app' },
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Messages</div><h2 className="mt-1 text-xl font-bold sm:text-2xl">{first ? `Hi ${first}, here’s what needs you` : 'Here’s what needs you'}</h2></div>
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onNew}>New message</Button>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{tiles.map((t) => (
          <div key={t.label} className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
            <t.icon className="h-4 w-4 text-gold-400" /><div className="mt-2 text-2xl font-bold">{t.value}</div><div className="text-xs text-white/60">{t.label}</div><div className="text-[11px] text-white/40">{t.sub}</div>
          </div>
        ))}</div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Needs you across the app</h3>
          <p className="text-xs text-slate-500">Your tasks, approvals, donors you own and grants assigned to you.</p>
          {!d.needs.length ? <p className="mt-3 text-sm text-slate-500">You’re all caught up.</p> : (
            <ul className="mt-3 space-y-1.5">{d.needs.map((n: any, i: number) => {
              const k = NEED[n.kind] ?? NEED.Task; const Icon = k.icon;
              const overdue = n.date && n.date < new Date().toISOString().slice(0, 10);
              return (
                <li key={i}><Link to={n.link} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', k.cls)}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">{n.title}</span>
                  {n.date && <span className={cx('shrink-0 text-xs', overdue ? 'font-semibold text-red-600' : 'text-slate-400')}>{date(n.date)}</span>}
                </Link></li>
              );
            })}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Mentions</h3>
          <p className="text-xs text-slate-500">Messages that mention @{first || 'you'}.</p>
          {!d.mentions.length ? <p className="mt-3 text-sm text-slate-500">No recent mentions.</p> : (
            <ul className="mt-3 space-y-2">{d.mentions.map((m: any) => (
              <li key={m.id}><Link to={`/messages/${m.conversation_id}`} className="block rounded-xl bg-slate-50 p-3 hover:bg-slate-100">
                <div className="flex justify-between text-[11px] text-slate-400"><span>{m.author} · {m.conversation}</span><span>{ago(m.created_at)}</span></div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-700">{m.body}</p>
              </Link></li>
            ))}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Alerts</h3>
          <p className="text-xs text-slate-500">Unread notifications such as gifts, deadlines and assignments.</p>
          {!d.notifications.length ? <p className="mt-3 text-sm text-slate-500">No unread alerts.</p> : (
            <ul className="mt-3 space-y-1.5">{d.notifications.map((n: any) => {
              const body = <><div className="flex justify-between gap-2"><span className="truncate font-medium text-slate-800">{n.title}</span><span className="shrink-0 text-[11px] text-slate-400">{ago(n.created_at)}</span></div>{n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}</>;
              return <li key={n.id}>{n.link ? <Link to={n.link} className="block rounded-xl px-2 py-1.5 text-sm hover:bg-slate-50">{body}</Link> : <div className="px-2 py-1.5 text-sm">{body}</div>}</li>;
            })}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Conversations by workspace</h3>
          <p className="text-xs text-slate-500">Open conversations you belong to.</p>
          {!d.byWorkspace.length ? <p className="mt-3 text-sm text-slate-500">No conversations yet. Start one to plan work with your team.</p> : (
            <ul className="mt-3 space-y-2">{d.byWorkspace.map((w: any) => (
              <li key={w.key} className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{ background: w.color ?? '#94a3b8' }} /><span className="flex-1 text-slate-700">{w.key}</span>
                <span className="text-xs text-slate-500">{w.threads} {w.threads === 1 ? 'thread' : 'threads'}</span>{w.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{w.unread}</span>}</li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
