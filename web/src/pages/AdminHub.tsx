/** Overviews for Admin & Access, Settings, and Ask A.I. Fundraising. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Users, UserCheck, MailPlus, ShieldCheck, KeyRound, Activity, Download, Sparkles, CheckCircle2, AlertTriangle, Circle, Lock, ArrowRight } from 'lucide-react';
import { useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Spinner, ErrorBox, cx } from '../components/ui';
import { Hero, Tile, Breakdown, Meter } from '../components/overview';
import { ProgressRing } from '../components/visual';
import { num, ago, date, label } from '../lib/format';

export function AdminOverview({ onTab }: { onTab: (t: string) => void }) {
  const { can, terms, term } = useSession();
  const { data: d, error, reload } = useApi<any>('/overview/admin');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return <Spinner />;
  const maxRole = Math.max(1, ...(d.roles ?? []).map((r: any) => r.people));
  return (
    <div className="space-y-5">
      <Hero eyebrow="Admin & Access" title="Who can see and do what" legend={false}>
        {d.people && <>
          <Tile icon={Users} label="People with access" value={num(d.people.active)} sub={`${num(d.people.seats)} seats in use`} kind="live" />
          <Tile icon={MailPlus} label="Invitations waiting" value={num(d.people.invited)} sub="not yet accepted" kind="live" />
          <Tile icon={ShieldCheck} label="Can manage users" value={num(d.admins ?? 0)} sub="administrators" kind="live" />
          <Tile icon={KeyRound} label={`Access to all ${terms.toLowerCase()}`} value={num(d.people.all_access)} sub={`${num(d.people.active - d.people.all_access)} limited to some`} kind="live" />
        </>}
        {d.sensitive && <>
          <Tile icon={UserCheck} label="Sign-ins" value={num(d.sensitive.logins)} sub="last 30 days" />
          <Tile icon={Download} label="Data exports" value={num(d.sensitive.exports)} sub="last 30 days" />
          <Tile icon={Sparkles} label="A.I. drafts created" value={num(d.sensitive.ai_drafts)} sub="last 30 days" />
          <Tile icon={Activity} label="Recorded actions" value={num((d.activity ?? []).reduce((a: number, x: any) => a + x.n, 0))} sub="last 30 days, in the activity history" />
        </>}
      </Hero>

      {d.checks && <Card title="Access health" subtitle="Quick checks that keep your organization secure.">
        <ul className="grid gap-2 md:grid-cols-2">{d.checks.map((c: any, i: number) => (
          <li key={i} className={cx('flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm', c.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>{c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{c.text}</li>
        ))}</ul>
      </Card>}

      <div className="grid gap-5 xl:grid-cols-3">
        {d.users && <Card title="People" subtitle="Last sign-in and activity in the last 30 days." className="xl:col-span-2" padded={false} actions={<button onClick={() => onTab('users')} className="text-xs text-brand-600 hover:underline">Manage users</button>}>
          <ul className="divide-y divide-slate-100">{d.users.map((u: any) => {
            const stale = !u.last_login || Date.now() - new Date(u.last_login).getTime() > 60 * 86400000;
            return (
              <li key={u.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white">{u.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{u.name}</span><span className="block truncate text-xs text-slate-500">{u.role} · {u.all_ministries ? `all ${terms.toLowerCase()}` : `${u.workspaces} ${u.workspaces === 1 ? 'workspace' : 'workspaces'}`}</span></span>
                <span className="hidden text-xs text-slate-500 sm:block">{num(u.actions_30)} actions</span>
                <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', stale ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{u.last_login ? `Signed in ${ago(u.last_login)}` : 'Never signed in'}</span>
              </li>
            );
          })}</ul>
          {d.pendingInvites?.length > 0 && <div className="border-t border-slate-100 px-5 py-3"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Waiting to accept</div>{d.pendingInvites.map((i: any) => <div key={i.id} className="flex justify-between py-0.5 text-sm"><span className="truncate">{i.invited_email}</span><span className="text-xs text-slate-500">{i.role} · invited {date(i.created_at)}</span></div>)}</div>}
        </Card>}
        <div className="space-y-5">
          {d.roles && <Card title="Roles" actions={<button onClick={() => onTab('roles')} className="text-xs text-brand-600 hover:underline">Edit roles</button>}>
            <ul className="space-y-2.5">{d.roles.map((r: any) => (
              <li key={r.id}><div className="flex justify-between text-sm"><span className="text-slate-700">{r.name}</span><span className="text-xs text-slate-500">{r.people} {r.people === 1 ? 'person' : 'people'} · {r.permissions} permissions</span></div><Meter value={r.people} max={maxRole} tone="brand" className="mt-1" /></li>
            ))}</ul>
          </Card>}
          {d.workspaces?.length > 0 && <Card title={`Access by ${term.toLowerCase()}`}>
            <ul className="space-y-2">{d.workspaces.map((w: any) => <li key={w.id} className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{ background: w.color }} /><span className="flex-1 truncate">{w.name}</span><span className="text-xs text-slate-500">{w.people} {w.people === 1 ? 'person' : 'people'}</span></li>)}</ul>
          </Card>}
        </div>
      </div>

      {d.recent && <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Activity by area" subtitle="Last 30 days."><Breakdown rows={d.activity} format={num} tone="sky" labelOf={(r) => label(r.key)} /></Card>
        <Card title="Latest activity" className="xl:col-span-2" padded={false} actions={can('audit.read') && <button onClick={() => onTab('audit')} className="text-xs text-brand-600 hover:underline">Full activity history</button>}>
          <ul className="divide-y divide-slate-100">{d.recent.map((e: any) => <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm"><span className="min-w-0"><span className="block truncate text-slate-800">{e.description}</span><span className="text-xs text-slate-400">{e.user_name ?? 'System'} · {label(e.category)}</span></span><span className="shrink-0 text-xs text-slate-400">{ago(e.created_at)}</span></li>)}</ul>
        </Card>
      </div>}
    </div>
  );
}

export function SettingsOverview({ onTab }: { onTab: (t: string) => void }) {
  const { data: d, error, reload } = useApi<any>('/overview/settings');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return <Spinner />;
  const areas = [...new Set(d.items.map((i: any) => i.area))] as string[];
  const todo = d.items.filter((i: any) => !i.ok && !i.optional);
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-5 text-white shadow-xl sm:p-7">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <ProgressRing value={d.score} size={104} label="ready" dark />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Settings</div>
            <h2 className="mt-1 text-2xl font-bold">{todo.length ? `${todo.length} ${todo.length === 1 ? 'thing' : 'things'} to finish setting up` : 'Everything essential is set up'}</h2>
            <p className="mt-1 text-sm text-white/65">A health check of your organization profile, receipts, email, A.I., money, connections, team and data.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Donors', d.counts.donors], ['Gifts', d.counts.gifts], ['People', d.counts.people]].map(([l, v]) => <div key={l as string} className="rounded-2xl bg-white/[0.06] px-4 py-2 ring-1 ring-white/10"><div className="text-lg font-bold">{num(v as number)}</div><div className="text-[11px] text-white/55">{l}</div></div>)}
          </div>
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {areas.map((area) => (
          <Card key={area} title={area}>
            <ul className="space-y-2">{d.items.filter((i: any) => i.area === area).map((i: any) => {
              const Icon = i.ok ? CheckCircle2 : i.optional ? Circle : AlertTriangle;
              const go = i.tab ? <button onClick={() => onTab(i.tab)} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline">Open <ArrowRight className="h-3 w-3" /></button>
                : i.link ? <Link to={i.link} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline">Open <ArrowRight className="h-3 w-3" /></Link> : null;
              return (
                <li key={i.key} className="flex items-start gap-2 text-sm">
                  <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', i.ok ? 'text-emerald-500' : i.optional ? 'text-slate-300' : 'text-amber-500')} />
                  <span className="min-w-0 flex-1 text-slate-700">{i.text}{i.optional && !i.ok && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">optional</span>}</span>
                  {!i.ok && go}
                </li>
              );
            })}</ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AskSidebar({ onAsk }: { onAsk: (q: string) => void }) {
  const { data: d } = useApi<any>('/overview/ask');
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-violet-900 p-4 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-400/25 blur-3xl" />
        <div className="relative text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Suggested for you</div>
        <p className="relative mt-1 text-xs text-white/60">Based on what is happening in your data right now.</p>
        <ul className="relative mt-3 space-y-2">{d.suggestions.map((s: any) => (
          <li key={s.q}><button onClick={() => onAsk(s.q)} className="group block w-full rounded-xl bg-white/[0.07] p-3 text-left ring-1 ring-white/10 transition hover:bg-white/[0.12]">
            <span className="flex items-center justify-between gap-2 text-sm font-medium">{s.q}<ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" /></span>
            <span className="mt-0.5 block text-[11px] text-white/55">{s.area} · {s.why}</span>
          </button></li>
        ))}</ul>
      </section>
      <Card title="What Ask can see for you" subtitle="Answers only use areas your role can access.">
        <ul className="grid grid-cols-1 gap-1.5 text-sm">{d.areas.map((x: any) => <li key={x.name} className={cx('flex items-center gap-2', x.ok ? 'text-slate-700' : 'text-slate-400')}>{x.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Lock className="h-4 w-4" />}{x.name}</li>)}</ul>
      </Card>
    </div>
  );
}
