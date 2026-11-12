/** Donors & Giving overview: who gave, how they came, what they supported, and the relationship work behind it. */
import React from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Users, UserPlus, Repeat, Gift, Heart, Target, Mail } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Spinner, ErrorBox } from '../components/ui';
import { usePeriod, Hero, Tile, Delta, Breakdown, Flow, Meter, Source, monthTick, shortMoney } from '../components/overview';
import { money, num, label } from '../lib/format';

const CHANNEL: Record<string, string> = { stripe: 'Stripe (online)', square: 'Square', paypal: 'PayPal', email: 'After an email', online: 'Online', check: 'Check', cash: 'Cash', ach: 'Bank transfer', card: 'Card', stock: 'Stock', other: 'Other', in_kind: 'In kind' };

export function DonorsInsights({ ministryId, children }: { ministryId?: string; children?: (ministry: string) => React.ReactNode }) {
  const { can } = useSession();
  const per = usePeriod('ytd');
  const ministry = ministryId ?? per.ministry;
  const { data: d, error, reload } = useApi<any>(`/overview/donors${qs({ ...per.query, ministry_id: ministry })}`);
  const k = d?.kpis;
  return (
    <div className="space-y-5">
      {per.controls(undefined, ministryId === undefined)}
      {error ? <ErrorBox error={error} onRetry={reload} /> : !d ? <Spinner label="Gathering giving from across the app…" /> : (
        <>
          <Hero eyebrow="Donors & giving" title={`Your donors in ${per.range.label}`}>
            <Tile icon={HandCoins} label="Given" value={money(k.raised)} sub={`${num(k.gifts)} gifts · largest ${money(k.largest)}`} delta={<Delta now={k.raised} prev={k.raised_prev} />} to="/donors/giving/reports" />
            <Tile icon={Users} label="Donors who gave" value={num(k.donors)} sub={`${num(k.new_donors)} new · ${num(k.reactivated)} came back`} delta={<Delta now={k.donors} prev={k.donors_prev} />} to="/donors/giving/donors" />
            <Tile icon={Heart} label="Gave again" value={k.retention === null ? '—' : `${Math.round(k.retention)}%`} sub={k.donors_prev ? `${num(k.retained)} of ${num(k.donors_prev)} from the previous period` : 'Needs a previous period to compare'} />
            <Tile icon={Gift} label="Average gift" value={money(k.average)} sub={`${num(k.upgraded)} donors gave more than before`} delta={<Delta now={k.average} prev={k.average_prev} />} />
            <Tile icon={Repeat} label="Monthly recurring" value={money(d.recurring.monthly)} sub={`${num(d.recurring.donors)} monthly partners`} kind="live" to="/donors/giving/donors?recurring=true" />
            <Tile icon={UserPlus} label="Contacts with donors" value={num(d.engagement.contacts)} sub={`${num(d.engagement.donors_contacted)} donors reached personally`} delta={<Delta now={d.engagement.contacts} prev={d.engagement.contacts_prev} />} to="/work/communications" />
            <Tile icon={Target} label="Asks made" value={num(d.asks.asks)} sub={`${num(d.asks.accepted)} said yes · ${money(d.asks.accepted_amount)}`} />
            <Tile icon={Mail} label="Thank-yous & receipts waiting" value={`${num(d.queues.thank_yous)} / ${num(d.queues.receipts)}`} sub="thank-yous / receipts to send" kind="live" to="/donors/giving/receipts" />
          </Hero>

          <Card title="The donor journey this period" subtitle="How your donor base moved compared with the previous period of the same length.">
            <Flow steps={[
              { label: 'New donors', value: num(k.new_donors), sub: 'first gift ever', kind: 'auto', tone: 'good', to: '/donors/giving/priorities' },
              { label: 'Came back', value: num(k.reactivated), sub: 'returned after a gap', kind: 'auto' },
              { label: 'Gave again', value: num(k.retained), sub: 'gave in both periods', kind: 'auto' },
              { label: 'Gave more', value: num(k.upgraded), sub: `${num(k.downgraded)} gave less`, kind: 'auto', tone: 'good' },
              { label: 'Have not given yet', value: num(k.lapsed), sub: 'gave last period, not this one', kind: 'auto', tone: k.lapsed ? 'bad' : 'default', to: '/donors/giving/priorities/recovery' },
            ]} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="How gifts arrived" subtitle="Online platforms, email, checks and more.">
              <Breakdown rows={d.byChannel} format={money} labelOf={(r) => CHANNEL[r.key] ?? label(r.key)} subOf={(r) => `${num(r.n)} gifts`} />
              {d.byType.length > 1 && <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By gift type</div><Breakdown rows={d.byType} format={money} tone="sky" labelOf={(r) => label(r.key)} /></div>}
            </Card>
            <Card title="What donors supported" subtitle="Funds and programs that received gifts.">
              <Breakdown rows={d.funds} format={money} tone="brand" labelOf={(r) => <>{r.name}{r.restriction !== 'unrestricted' && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">restricted</span>}</>} subOf={(r) => `${num(r.donors)} donors`} linkOf={(r) => (can('finance.read') ? `/money/accounting/funds/${r.id}` : undefined)} />
              {d.projects.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Programs</div><Breakdown rows={d.projects} format={money} tone="good" labelOf={(r) => r.name} linkOf={(r) => `/donors/projects/${r.id}`} subOf={(r) => (r.goal ? `${Math.round((r.amount / r.goal) * 100)}% of goal` : '')} /></div>}
            </Card>
            <Card title="Campaigns" subtitle="Progress toward each goal." actions={<Link to="/donors/giving/campaigns" className="text-xs text-brand-600 hover:underline">All campaigns</Link>}>
              {!d.campaigns.length ? <p className="text-sm text-slate-500">No campaigns yet.</p> : (
                <ul className="space-y-3">{d.campaigns.map((c: any) => (
                  <li key={c.id}><Link to={`/donors/giving/campaigns/${c.id}`} className="block">
                    <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium text-slate-800">{c.name}</span><span className="shrink-0 text-slate-500">{money(c.raised_all)}{c.goal ? ` / ${money(c.goal)}` : ''}</span></div>
                    <Meter value={c.raised_all} max={c.goal || c.raised_all} tone={c.goal && c.raised_all >= c.goal ? 'good' : 'gold'} className="mt-1" />
                    <div className="mt-0.5 text-[11px] text-slate-400">{money(c.raised)} this period · {num(c.donors)} donors</div>
                  </Link></li>
                ))}</ul>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Giving month by month" subtitle="Amount given (bars) and number of donors (line)." className="xl:col-span-2">
              <div className="h-64"><ResponsiveContainer><ComposedChart data={d.trend} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthTick} />
                <YAxis yAxisId="m" tick={{ fontSize: 11 }} tickFormatter={shortMoney} width={40} /><YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip formatter={(v: any, n: any) => (n === 'Donors' ? num(v) : money(v))} labelFormatter={(m: any) => monthTick(String(m))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="m" dataKey="raised" name="Given" fill="#d4a10c" radius={[4, 4, 0, 0]} /><Line yAxisId="c" dataKey="donors" name="Donors" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart></ResponsiveContainer></div>
            </Card>
            <Card title="Relationships" subtitle="Personal contact, events and email.">
              <div className="space-y-4 text-sm">
                <div><div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">Contacts logged<Source kind="auto" light /></div><Breakdown rows={d.contactTypes} format={num} tone="sky" labelOf={(r) => label(r.key)} empty="No contacts logged in this period." /></div>
                {d.eventDonors && <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Events</div><div className="mt-0.5"><b>{num(d.eventDonors.attendees)}</b> donors attended · <b>{num(d.eventDonors.gave_after)}</b> gave within 60 days ({money(d.eventDonors.amount)})</div></div>}
                {d.email && <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Email to donors</div><div className="mt-0.5"><b>{num(d.email.delivered)}</b> delivered · <b>{num(d.email.opened)}</b> opened · <b>{num(d.email.clicked)}</b> clicked{d.emailGiving?.n ? <> · <b>{money(d.emailGiving.amount)}</b> given after an email</> : null}</div><div className="mt-0.5 text-[11px] text-slate-400">Opens are estimates.</div></div>}
                {d.topDonors.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Top donors this period</div>{d.topDonors.map((x: any) => <Link key={x.id} to={`/donors/${x.id}`} className="flex justify-between py-0.5 hover:underline"><span className="truncate">{x.name}</span><span className="text-slate-500">{money(x.amount)}</span></Link>)}</div>}
              </div>
            </Card>
          </div>
        </>
      )}
      {children?.(ministry)}
    </div>
  );
}
