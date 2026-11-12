/** Money overview: money in, money out, funds, budgets, receivables and what needs attention, for a period and workspace. */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Scale, Landmark, Lock, Unlock, FileText, Users, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useApi, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Card, Spinner, ErrorBox, Chip, cx } from '../components/ui';
import { usePeriod, Hero, Tile, Delta, Breakdown, Flow, Meter, monthTick, shortMoney } from '../components/overview';
import { money, num, date, label } from '../lib/format';

export function MoneyOverview() {
  const { can } = useSession();
  const per = usePeriod('ytd');
  const { data: d, error, reload } = useApi<any>(`/overview/money${qs(per.query)}`);
  const t = d?.totals;
  return (
    <div className="space-y-5">
      {per.controls()}
      {error ? <ErrorBox error={error} onRetry={reload} /> : !d ? <Spinner label="Reading the ledger…" /> : (
        <>
          {d.attention.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">{d.attention.map((x: any, i: number) => (
              <Link key={i} to={x.link} className={cx('flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm transition hover:-translate-y-0.5', x.level === 'error' ? 'border-red-200 bg-red-50 text-red-800' : x.level === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800')}>
                {x.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{x.text}
              </Link>))}</div>
          ) : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />Nothing needs attention right now: no approvals, bank items or sync problems waiting.</div>}

          <Hero eyebrow="Money" title={`Your finances in ${per.range.label}`}>
            <Tile icon={ArrowDownCircle} label="Money in" value={money(t.income)} delta={<Delta now={t.income} prev={t.income_prev} />} to={`/money/reports?kind=activities&from=${per.range.from}&to=${per.range.to}`} />
            <Tile icon={ArrowUpCircle} label="Money out" value={money(t.expenses)} delta={<Delta now={t.expenses} prev={t.expenses_prev} invert />} to={`/money/reports?kind=activities&from=${per.range.from}&to=${per.range.to}`} />
            <Tile icon={Scale} label={t.change >= 0 ? 'Surplus' : 'Deficit'} value={money(Math.abs(t.change))} sub="money in minus money out" />
            <Tile icon={Landmark} label="Cash on hand" value={money(t.cash)} sub={t.runwayMonths !== null ? `about ${t.runwayMonths >= 24 ? '24+' : Math.round(t.runwayMonths * 10) / 10} months of spending` : 'no recent spending to compare'} kind="live" to="/money/reports?kind=financial-position" />
            <Tile icon={Lock} label="Restricted funds" value={money(d.restricted)} sub="held for specific purposes" kind="live" to="/money/accounting/funds" />
            <Tile icon={Unlock} label="Unrestricted funds" value={money(d.unrestricted)} sub="free to use where needed" kind="live" to="/money/accounting/funds" />
            <Tile icon={FileText} label="Owed to you" value={money(d.invoices.outstanding)} sub={`${num(d.invoices.open)} open invoices · ${money(d.invoices.overdue)} past due`} kind="live" to="/money/invoices" />
            <Tile icon={Users} label="Payroll" value={money(d.payroll.total)} sub={`${num(d.payroll.people)} people, incl. taxes & benefits`} delta={<Delta now={d.payroll.total} prev={d.payroll.total_prev} invert />} to="/money/payroll" />
          </Hero>

          <Card title="How money moved" subtitle="Where money came from, where it went, and what remains.">
            <Flow steps={[
              { label: 'Came in', value: money(t.income), sub: d.incomeBySource.map((x: any) => `${x.key} ${money(x.amount)}`).slice(0, 2).join(' · '), kind: 'auto', tone: 'good' },
              { label: 'Spent on programs', value: money(d.expenseByProgram.filter((x: any) => x.id).reduce((a: number, x: any) => a + x.amount, 0)), sub: `${d.expenseByProgram.filter((x: any) => x.id).length} programs`, kind: 'auto' },
              { label: 'Spent on everything else', value: money(d.expenseByProgram.filter((x: any) => !x.id).reduce((a: number, x: any) => a + x.amount, 0)), sub: 'operations, staff, admin', kind: 'auto' },
              { label: t.change >= 0 ? 'Left over' : 'Short', value: money(Math.abs(t.change)), sub: 'for this period', kind: 'auto', tone: t.change >= 0 ? 'good' : 'bad' },
            ]} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Money in" subtitle="By source and income account.">
              <Breakdown rows={d.incomeBySource} format={money} tone="good" />
              <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">By income account</div><Breakdown rows={d.incomeByAccount} format={money} tone="sky" /></div>
              {d.online.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Online payment platforms</div><Breakdown rows={d.online} format={money} labelOf={(r) => label(r.key)} subOf={(r) => `${num(r.n)} payments${r.disputes ? ` · ${r.disputes} disputes` : ''}`} /></div>}
            </Card>
            <Card title="Money out" subtitle="By expense account.">
              <Breakdown rows={d.expenseByAccount} format={money} tone="brand" />
            </Card>
            <Card title="Spending by program" subtitle="What each program cost in this period.">
              <Breakdown rows={d.expenseByProgram} format={money} tone="gold" linkOf={(r) => (r.id ? `/donors/projects/${r.id}` : undefined)} />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Month by month" subtitle="Money in and money out." className="xl:col-span-2">
              <div className="h-64"><ResponsiveContainer><ComposedChart data={d.trend.map((x: any) => ({ ...x, net: x.income - x.expenses }))} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthTick} /><YAxis tick={{ fontSize: 11 }} tickFormatter={shortMoney} width={44} />
                <Tooltip formatter={(v: any) => money(v)} labelFormatter={(m: any) => monthTick(String(m))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Money in" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="expenses" name="Money out" fill="#6366f1" radius={[4, 4, 0, 0]} /><Line dataKey="net" name="Difference" stroke="#d4a10c" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart></ResponsiveContainer></div>
            </Card>
            <Card title="Budgets" subtitle="Spending against budgets that cover this period." actions={<Link to="/money/accounting/budgets" className="text-xs text-brand-600 hover:underline">All budgets</Link>}>
              {!d.budgets.length ? <p className="text-sm text-slate-500">No budgets cover this period. Create one under Money › Accounting › Budgets.</p> : (
                <ul className="space-y-4">{d.budgets.map((b: any) => {
                  const used = b.budget ? b.actual / b.budget : 0; const ahead = used > b.elapsed + 0.1;
                  return (
                    <li key={b.id}><Link to={`/money/accounting/budgets/${b.id}`} className="block">
                      <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium text-slate-800">{b.name}</span><span className="shrink-0 text-slate-500">{money(b.actual)} / {money(b.budget)}</span></div>
                      <div className="relative mt-1"><Meter value={b.actual} max={b.budget} tone={used > 1 ? 'bad' : ahead ? 'gold' : 'good'} /><span className="absolute top-[-2px] h-2.5 w-0.5 rounded bg-slate-500" style={{ left: `${Math.min(100, b.elapsed * 100)}%` }} title="Share of the budget period that has passed" /></div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{Math.round(used * 100)}% used · {Math.round(b.elapsed * 100)}% of the period passed{ahead ? ' · spending ahead of schedule' : ''}</div>
                    </Link></li>
                  );
                })}</ul>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Funds" subtitle="Balance today, and what came in and went out in this period." className="xl:col-span-2" padded={false}>
              <div className="divide-y divide-slate-100">{d.funds.map((f: any) => {
                const max = Math.max(f.received, f.spent, 1);
                return (
                  <Link key={f.id} to={`/money/accounting/funds/${f.id}`} className="grid grid-cols-1 gap-2 px-5 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_140px_200px] sm:items-center">
                    <div className="flex items-center gap-2"><span className="font-medium text-slate-800">{f.name}</span><Chip value={f.restriction} /></div>
                    <div className={cx('text-right font-semibold tabular-nums', f.balance < 0 ? 'text-red-600' : 'text-slate-900')}>{money(f.balance)}</div>
                    <div className="space-y-1 text-[11px] text-slate-500"><div className="flex items-center gap-2"><span className="w-10">In</span><Meter value={f.received} max={max} tone="good" className="flex-1" /><span className="w-16 text-right">{money(f.received)}</span></div>
                      <div className="flex items-center gap-2"><span className="w-10">Out</span><Meter value={f.spent} max={max} tone="brand" className="flex-1" /><span className="w-16 text-right">{money(f.spent)}</span></div></div>
                  </Link>
                );
              })}</div>
            </Card>
            <Card title="Recent activity" padded={false} actions={<Link to="/money/accounting/transactions" className="text-xs text-brand-600 hover:underline">All transactions</Link>}>
              <ul className="divide-y divide-slate-100">{d.recent.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0"><div className="truncate text-slate-800">{e.memo || label(e.source)}</div><div className="text-[11px] text-slate-400">{date(e.entry_date)} · {label(e.source)}{e.status !== 'posted' ? ` · ${label(e.status)}` : ''}</div></div>
                  <span className="shrink-0 tabular-nums text-slate-700">{money(e.amount)}</span>
                </li>))}</ul>
            </Card>
          </div>
          {!can('donors.read') && <p className="text-xs text-slate-400">Some donor details are hidden for your role.</p>}
        </>
      )}
    </div>
  );
}
