/** Growth overview: acquisition, retention, upgrades, recurring, major gifts, goals and the other growth drivers in the app. */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Heart, TrendingUp, Repeat, Crown, HandCoins, Target, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Plus } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Spinner, ErrorBox, cx } from '../components/ui';
import { RecordModal } from '../components/ResourcePage';
import { usePeriod, Hero, Tile, Delta, Breakdown, Flow, Meter, Source, monthTick } from '../components/overview';
import { ProgressRing } from '../components/visual';
import { money, num, pct, label, date } from '../lib/format';

const HEALTH_ORDER = ['active', 'engaged', 'cooling', 'lapsing', 'lapsed'];
const HEALTH_CLS: Record<string, string> = { active: 'bg-emerald-500', engaged: 'bg-sky-500', cooling: 'bg-amber-400', lapsing: 'bg-orange-500', lapsed: 'bg-rose-500' };
const METRIC_LABEL: Record<string, string> = { giving_total: 'Total giving', new_donors: 'New donors', retention_rate: 'Donor retention', recurring_donors: 'Monthly donors', major_donors: 'Major donors' };

export function GrowthOverview() {
  const { can } = useSession();
  const per = usePeriod('ytd');
  const { data: d, error, reload } = useApi<any>(`/overview/growth${qs(per.query)}`);
  const [goal, setGoal] = useState(false);
  const k = d?.k;
  const healthTotal = d ? d.health.reduce((a: number, h: any) => a + h.n, 0) : 0;
  return (
    <div className="space-y-5">
      {per.controls(can('settings.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setGoal(true)}>Add goal</Button>)}
      {error ? <ErrorBox error={error} onRetry={reload} /> : !d ? <Spinner label="Measuring growth…" /> : (
        <>
          <Hero eyebrow="Growth" title={`How your donor base grew in ${per.range.label}`}>
            <Tile icon={HandCoins} label="Total giving" value={money(k.given)} delta={<Delta now={k.given} prev={k.given_prev} />} to="/donors/giving/reports" />
            <Tile icon={UserPlus} label="New donors" value={num(k.new_donors)} sub={k.second_gift_rate !== null ? `${Math.round(k.second_gift_rate)}% already gave twice` : undefined} delta={<Delta now={k.new_donors} prev={k.new_donors_prev} />} />
            <Tile icon={Heart} label="Donors who gave again" value={k.retention === null ? '—' : `${Math.round(k.retention)}%`} sub={k.retention_prev !== null ? `${Math.round(k.retention_prev)}% the period before` : `${num(k.retained)} of ${num(k.donors_prev)}`} to="/donors/giving/audit" />
            <Tile icon={TrendingUp} label="Giving per donor" value={money(k.per_donor)} sub={`${num(k.upgraded)} donors gave more than before`} delta={<Delta now={k.per_donor} prev={k.per_donor_prev} />} />
            <Tile icon={Repeat} label="New monthly donors" value={num(d.recurring.started)} sub={`+${money(d.recurring.monthly_added)}/mo · ${num(d.recurring.active)} active`} delta={<Delta now={d.recurring.started} prev={d.recurring.started_prev} />} to="/donors/giving/donors?recurring=true" />
            <Tile icon={Crown} label="Major donors ($5,000+)" value={num(k.major)} delta={<Delta now={k.major} prev={k.major_prev} />} to="/donors/giving/donors?min_lifetime=5000" />
            <Tile icon={Target} label="Opportunity (estimate)" value={money(d.pipeline.reduce((a: number, p: any) => a + p.amount, 0))} sub={`${num(d.pipeline.reduce((a: number, p: any) => a + p.n, 0))} donors with a next step`} kind="estimate" to="/donors/giving/priorities" />
            <Tile icon={Sparkles} label="Monthly recurring" value={money(d.recurring.monthly)} sub="predictable giving each month" kind="live" />
          </Hero>

          <Card title="Your growth engine" subtitle="The five ways a donor base grows. Each step links to where you can act on it.">
            <Flow steps={[
              { label: 'Acquire', value: num(k.new_donors), sub: 'first-time donors', kind: 'auto', tone: k.new_donors >= k.new_donors_prev ? 'good' : 'default', to: '/donors/giving/priorities' },
              { label: 'Retain', value: k.retention === null ? '—' : `${Math.round(k.retention)}%`, sub: 'gave again', kind: 'auto', tone: k.retention !== null && k.retention < 45 ? 'bad' : 'good', to: '/donors/giving/priorities/recovery' },
              { label: 'Upgrade', value: num(k.upgraded), sub: 'gave more', kind: 'auto', to: '/donors/giving/priorities' },
              { label: 'Go monthly', value: num(d.recurring.started), sub: 'new monthly donors', kind: 'auto', tone: d.recurring.started ? 'good' : 'bad', to: '/donors/giving/outreach' },
              { label: 'Major gifts', value: num(k.major), sub: '$5,000+ this period', kind: 'auto', to: '/donors/giving/priorities' },
            ]} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Goals" subtitle="Progress against time elapsed." className="xl:col-span-2" actions={can('settings.manage') && <button onClick={() => setGoal(true)} className="text-xs text-brand-600 hover:underline">Add goal</button>}>
              {!d.goals.length ? <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">No goals yet. Set a goal for giving, new donors, retention, monthly donors or major donors and track it here.</div> : (
                <div className="grid gap-4 sm:grid-cols-2">{d.goals.map((g: any) => {
                  const fmt = g.metric === 'giving_total' ? money : g.metric === 'retention_rate' ? (v: number) => pct(v) : num;
                  return (
                    <div key={g.id} className="flex items-center gap-4 rounded-2xl border border-slate-100 p-4">
                      <ProgressRing value={Math.min(100, g.pct)} size={76} stroke={8} tone={g.status === 'met' ? 'good' : g.status === 'behind' ? 'gold' : 'brand'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-800">{g.name}</div>
                        <div className="text-xs text-slate-500">{METRIC_LABEL[g.metric] ?? label(g.metric)} · {fmt(g.actual)} of {fmt(g.target)}</div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                          {g.status === 'met' ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Goal met</span>
                            : g.status === 'on_track' ? <span className="flex items-center gap-1 font-semibold text-brand-600"><TrendingUp className="h-3.5 w-3.5" />On track</span>
                              : <span className="flex items-center gap-1 font-semibold text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Behind pace</span>}
                          <span className="text-slate-400">· {g.elapsed}% of time used · ends {date(g.period_end)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}</div>
              )}
            </Card>
            <Card title="What to focus on" subtitle="Suggestions based on your numbers. You decide what to do.">
              {!d.recommendations.length ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />You’re on track. Keep going.</p> : (
                <ul className="space-y-2">{d.recommendations.map((r: any) => (
                  <li key={r.text}><Link to={r.link} className="group flex items-start gap-2 rounded-xl bg-amber-50/70 p-3 text-sm text-slate-700 transition hover:bg-amber-50">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span className="flex-1">{r.text}</span><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </Link></li>
                ))}</ul>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Where new donors came from" subtitle="How each first-time donor first gave.">
              <Breakdown rows={d.sources} format={num} tone="good" empty="No new donors in this period." />
              {d.firstCampaigns.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Campaigns that brought new donors</div><Breakdown rows={d.firstCampaigns} format={num} tone="gold" linkOf={(r) => `/donors/giving/campaigns/${r.id}`} /></div>}
            </Card>
            <Card title="Gift size ladder" subtitle="Donors by how much they gave in this period.">
              <Breakdown rows={d.ladder.map((x: any) => ({ key: x.key, value: x.n, given: x.amount }))} format={num} tone="brand" subOf={(r) => `${money(r.given)} given`} />
            </Card>
            <Card title="Opportunity pipeline" subtitle="Estimated potential by next step." actions={<Source kind="estimate" light />}>
              <Breakdown rows={d.pipeline} format={money} tone="gold" subOf={(r) => `${num(r.n)} donors`} linkOf={() => '/donors/giving/priorities'} />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Month by month" subtitle="New donors (bars) and new monthly donors (line)." className="xl:col-span-2">
              <div className="h-64"><ResponsiveContainer><ComposedChart data={d.trend} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthTick} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip labelFormatter={(m: any) => monthTick(String(m))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="new_donors" name="New donors" fill="#10b981" radius={[4, 4, 0, 0]} /><Line dataKey="recurring" name="New monthly donors" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart></ResponsiveContainer></div>
            </Card>
            <Card title="Donor health" subtitle="Where every donor stands today." actions={<Source kind="live" light />}>
              <div className="flex h-3 overflow-hidden rounded-full">{HEALTH_ORDER.map((h) => { const n = d.health.find((x: any) => x.key === h)?.n ?? 0; return n ? <div key={h} className={HEALTH_CLS[h]} style={{ width: `${(n / Math.max(1, healthTotal)) * 100}%` }} title={`${label(h)}: ${n}`} /> : null; })}</div>
              <ul className="mt-4 space-y-2">{HEALTH_ORDER.map((h) => { const n = d.health.find((x: any) => x.key === h)?.n ?? 0; return (
                <li key={h}><Link to={`/donors/giving/donors?health=${h}`} className="flex items-center gap-2 text-sm hover:underline"><span className={cx('h-2.5 w-2.5 rounded-full', HEALTH_CLS[h])} /><span className="flex-1 text-slate-700">{label(h)}</span><span className="tabular-nums text-slate-900">{num(n)}</span><span className="w-10 text-right text-xs text-slate-400">{healthTotal ? Math.round((n / healthTotal) * 100) : 0}%</span></Link></li>
              ); })}</ul>
            </Card>
          </div>

          {(d.grants || d.events || d.email) && <Card title="Other growth drivers" subtitle="Grants, events and email from elsewhere in the app.">
            <div className="grid gap-3 md:grid-cols-3">
              {d.grants && <Link to="/donors/grants" className="rounded-2xl bg-slate-50 p-4 transition hover:bg-slate-100"><div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">Grants<Source kind="auto" light /></div>
                <div className="mt-1 text-xl font-bold text-slate-900">{money(d.grants.awarded)} awarded</div><div className="text-xs text-slate-500">{money(d.grants.pending)} waiting for a decision · {num(d.grants.preparing)} being prepared{d.grants.decided ? ` · won ${d.grants.won} of ${d.grants.decided}` : ''}</div></Link>}
              {d.events && <Link to="/donors/events" className="rounded-2xl bg-slate-50 p-4 transition hover:bg-slate-100"><div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">Events<Source kind="auto" light /></div>
                <div className="mt-1 text-xl font-bold text-slate-900">{num(d.events.donor_guests)} donors attended</div><div className="text-xs text-slate-500">{num(d.events.new_faces)} guests not yet in your donor list, a source of new donors</div></Link>}
              {d.email && <Link to="/donors/email/audiences" className="rounded-2xl bg-slate-50 p-4 transition hover:bg-slate-100"><div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">Email reach<Source kind="live" light /></div>
                <div className="mt-1 text-xl font-bold text-slate-900">{num(d.email.reachable)} reachable by email</div><div className="text-xs text-slate-500">{num(d.email.new_contacts)} added this period · {num(d.email.unsubscribed)} unsubscribed</div></Link>}
            </div>
          </Card>}
        </>
      )}
      <RecordModal open={goal} onClose={() => setGoal(false)} resource="growth_goals" title="Goal" onSaved={reload} fields={[{ key: 'name', label: 'Goal', required: true, span: 2 },
        { key: 'metric', label: 'Measure', type: 'select', required: true, options: ['giving_total', 'new_donors', 'retention_rate', 'recurring_donors', 'major_donors'] }, { key: 'target', label: 'Target', type: 'number', required: true },
        { key: 'period_start', label: 'Start', type: 'date', required: true }, { key: 'period_end', label: 'End', type: 'date', required: true }, { key: 'ministry_id', label: 'Workspace', type: 'workspace' }]} />
    </div>
  );
}
