/** Grant Finder (USA and Canada), grant applications list, and the guided application builder. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Search, ExternalLink, BookmarkPlus, FileEdit, CalendarClock, Building2, Sparkles, ChevronLeft, ChevronRight, Download,
  CheckCircle2, Circle, Landmark, MapPin, TrendingUp, Info, Plus, Trash2, Copy, Check, FileText, Wand2,
} from 'lucide-react';
import { api, useApi, download, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, Spinner, Empty, Select, Input, Textarea, Field, Modal, Notice, ErrorBox, useAction, useToast, SaveState, cx } from '../components/ui';
import { ProgressRing } from '../components/visual';
import { date } from '../lib/format';

type Country = 'US' | 'CA';
const FLAG: Record<Country, string> = { US: '🇺🇸', CA: '🇨🇦' };
const COUNTRY_NAME: Record<Country, string> = { US: 'United States', CA: 'Canada' };

function useMeta() { return useApi<any>('/grant-finder/meta'); }
function defaultCountry(me: any): Country { return me?.tenant?.tax_jurisdiction === 'CA-CRA' || me?.tenant?.currency === 'CAD' ? 'CA' : 'US'; }
const fmt = (n: number | null | undefined, c: Country) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(c === 'CA' ? 'en-CA' : 'en-US', { style: 'currency', currency: c === 'CA' ? 'CAD' : 'USD', maximumFractionDigits: 0 }).format(n));
function daysLeft(d?: string | null) { if (!d) return null; return Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86400000); }

function CountrySwitch({ value, onChange }: { value: Country; onChange: (c: Country) => void }) {
  return (
    <div className="inline-flex rounded-2xl bg-white/10 p-1 ring-1 ring-white/15" role="tablist" aria-label="Country">
      {(['US', 'CA'] as Country[]).map((c) => (
        <button key={c} role="tab" aria-selected={value === c} onClick={() => onChange(c)}
          className={cx('flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition', value === c ? 'bg-white text-slate-900 shadow' : 'text-white/80 hover:text-white')}>
          <span aria-hidden>{FLAG[c]}</span>{COUNTRY_NAME[c]}
        </button>
      ))}
    </div>
  );
}

/** Start an application from anything (search result, pipeline grant or blank). */
export function useStartApplication() {
  const nav = useNavigate(); const { run, busy } = useAction();
  const start = async (body: any) => { const r = await run(() => api.post('/grant-applications', body), 'Application started. Details your organization already has are filled in.'); if (r) nav(`/donors/grants/applications/${r.id}`); };
  return { start, busy };
}

// ───────────────────────── Finder ─────────────────────────
export function GrantFinder() {
  const { me, can } = useSession();
  const [country, setCountry] = useState<Country>(() => defaultCountry(me));
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const meta = useMeta();
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-6 text-white shadow-xl sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Grant Finder</div>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Find grants your organization can apply for</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/70">{country === 'US'
              ? 'Live federal opportunities from Grants.gov that nonprofits are eligible for. Save the ones that fit to your pipeline, or start an application.'
              : 'Federal programs that fund not-for-profits and charities, plus live data showing which programs are awarding funding to organizations like yours right now.'}</p>
          </div>
          <CountrySwitch value={country} onChange={(c) => { setCountry(c); }} />
        </div>
        <form className="relative mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={country === 'US' ? 'e.g. youth mentoring, food security, housing, arts' : 'e.g. seniors, youth, accessibility, culture'}
              className="w-full rounded-2xl border-0 bg-white py-3.5 pl-11 pr-4 text-base text-slate-900 shadow-lg outline-none ring-2 ring-transparent placeholder:text-slate-400 focus:ring-gold-400" aria-label="Search grants" />
          </div>
          <button className="rounded-2xl bg-gradient-to-b from-gold-400 to-gold-600 px-6 py-3.5 text-sm font-bold text-slate-900 shadow-lg transition hover:brightness-105">Search grants</button>
        </form>
        <div className="relative mt-3 flex flex-wrap gap-2">
          {(country === 'US' ? ['youth', 'food security', 'housing', 'mental health', 'arts', 'environment'] : ['seniors', 'youth', 'accessibility', 'culture', 'community safety', 'employment']).map((s) => (
            <button key={s} onClick={() => { setQ(s); setSubmitted(s); }} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/85 ring-1 ring-white/15 hover:bg-white/20">{s}</button>
          ))}
        </div>
      </div>
      {!meta.data ? <Spinner /> : country === 'US' ? <UsResults q={submitted} meta={meta.data} canWrite={can('grants.write')} /> : <CaResults q={submitted} meta={meta.data} canWrite={can('grants.write')} />}
    </div>
  );
}

function SaveButton({ body }: { body: any }) {
  const { run, busy } = useAction(); const [saved, setSaved] = useState(false); const nav = useNavigate();
  if (saved) return <Button size="sm" variant="subtle" icon={<Check className="h-3.5 w-3.5" />} onClick={() => nav('/donors/grants?tab=pipeline')}>In pipeline</Button>;
  return <Button size="sm" loading={busy} icon={<BookmarkPlus className="h-3.5 w-3.5" />} onClick={async () => { const r = await run(() => api.post('/grant-finder/save', body)); if (r) { setSaved(true); } }}>Save to pipeline</Button>;
}

function UsResults({ q, meta, canWrite }: { q: string; meta: any; canWrite: boolean }) {
  const [eligibility, setEligibility] = useState('12|13');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, eligibility, category, status]);
  const { data, error, loading, reload } = useApi<any>(`/grant-finder/us${qs({ q, eligibility, category, status, page })}`);
  const [open, setOpen] = useState<string | null>(null);
  const { start, busy } = useStartApplication();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,240px))_1fr]">
        <Select value={eligibility} onChange={(e) => setEligibility(e.target.value)} options={[{ value: '12|13', label: 'Any nonprofit' }, { value: '12', label: 'Nonprofits with 501(c)(3)' }, { value: '13', label: 'Nonprofits without 501(c)(3)' }, { value: '12|13|25|99', label: 'Nonprofits + open to others' }]} />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All focus areas" options={Object.entries(meta.usCategories).map(([value, label]) => ({ value, label: String(label) }))} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Open + coming soon' }, { value: 'posted', label: 'Open now' }, { value: 'forecasted', label: 'Coming soon (forecast)' }]} />
        {data && <span className="text-sm text-slate-500 lg:text-right">{data.total.toLocaleString()} opportunities</span>}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data || loading ? <Spinner label="Searching Grants.gov…" /> : !data.results.length ? <Empty title="No matching grants">Try fewer or different words, or widen the focus area.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.results.map((g: any) => {
            const dl = daysLeft(g.closeDate);
            return (
              <div key={g.id} className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gold-400/60 hover:shadow-lg">
                <div className="flex items-center gap-2 text-xs">
                  <span className={cx('rounded-full px-2 py-0.5 font-semibold', g.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{g.status === 'posted' ? 'Open' : 'Coming soon'}</span>
                  <span className="truncate text-slate-500">{g.number}</span>
                </div>
                <button onClick={() => setOpen(g.id)} className="mt-2 text-left text-[15px] font-semibold leading-snug text-slate-900 hover:text-brand-700">{g.title}</button>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{g.agency}</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{g.closeDate ? <>Closes {date(g.closeDate)}{dl !== null && dl >= 0 && <b className={cx('ml-1', dl <= 14 ? 'text-red-600' : 'text-slate-700')}>· {dl} days left</b>}</> : 'Close date not posted yet'}</span>
                  {g.openDate && <span>Posted {date(g.openDate)}</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="primary" icon={<Info className="h-3.5 w-3.5" />} onClick={() => setOpen(g.id)}>Details</Button>
                  {canWrite && <SaveButton body={{ country: 'US', title: g.title, funder: g.agency, deadline: g.closeDate, url: g.url, source: 'grants.gov', source_id: g.id }} />}
                  {canWrite && <Button size="sm" loading={busy} icon={<FileEdit className="h-3.5 w-3.5" />} onClick={() => start({ country: 'US', title: g.title, funder: g.agency, deadline: g.closeDate, source: 'grants.gov', source_id: g.id, source_url: g.url, prefill: { opportunity_number: g.number, assistance_listing: g.assistanceListings?.[0] } })}>Start application</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" disabled={page === 0} icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-slate-500">Page {page + 1} of {Math.min(51, Math.ceil(data.total / data.pageSize))}</span>
          <Button size="sm" disabled={(page + 1) * data.pageSize >= data.total || page >= 50} onClick={() => setPage(page + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
      <p className="text-xs text-slate-400">Source: Grants.gov, the official U.S. federal grants listing. Always confirm eligibility and deadlines in the full notice before applying.</p>
      <UsDetail id={open} onClose={() => setOpen(null)} canWrite={canWrite} />
    </div>
  );
}

function UsDetail({ id, onClose, canWrite }: { id: string | null; onClose: () => void; canWrite: boolean }) {
  const { data, error } = useApi<any>(id ? `/grant-finder/us/${id}` : null);
  const { start, busy } = useStartApplication();
  return (
    <Modal open={Boolean(id)} onClose={onClose} size="lg" title="Grant opportunity"
      footer={data && <>
        <a href={data.url} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="h-4 w-4" />}>Full notice on Grants.gov</Button></a>
        {canWrite && <SaveButton body={{ country: 'US', title: data.title, funder: data.agency, deadline: data.closeDate, url: data.url, source: 'grants.gov', source_id: data.id, amount: data.awardCeiling, summary: data.description.slice(0, 1500) }} />}
        {canWrite && <Button variant="primary" loading={busy} icon={<FileEdit className="h-4 w-4" />} onClick={() => start({ country: 'US', title: data.title, funder: data.agency, deadline: data.closeDate, source: 'grants.gov', source_id: data.id, source_url: data.url, prefill: { opportunity_number: data.number, assistance_listing: data.assistanceListings?.[0]?.split(' ')[0], amount_requested: data.awardCeiling ?? undefined } })}>Start application</Button>}
      </>}>
      {error ? <ErrorBox error={error} /> : !data ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div><div className="text-xs text-slate-500">{data.number} · {data.agency}</div><h3 className="mt-1 text-lg font-semibold text-slate-900">{data.title}</h3></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Award ceiling', fmt(data.awardCeiling, 'US')], ['Award floor', fmt(data.awardFloor, 'US')], ['Total funding', fmt(data.estimatedFunding, 'US')], ['Expected awards', data.numberOfAwards ?? '—']].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">{k}</div><div className="mt-1 font-semibold text-slate-900">{v}</div></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-600">
            <span><b>Closes:</b> {data.closeDate ? date(data.closeDate) : 'Not posted yet'}</span>
            <span><b>Cost sharing:</b> {data.costSharing ? 'Required' : 'Not required'}</span>
            {data.instruments?.length > 0 && <span><b>Type:</b> {data.instruments.join(', ')}</span>}
          </div>
          {data.closeDateNote && <Notice>{data.closeDateNote}</Notice>}
          <div><div className="mb-1 font-semibold text-slate-900">About</div><p className="whitespace-pre-line text-slate-600">{data.description || 'No description provided.'}</p></div>
          {data.eligibility?.length > 0 && <div><div className="mb-1 font-semibold text-slate-900">Who can apply</div><ul className="list-disc space-y-0.5 pl-5 text-slate-600">{data.eligibility.map((e: string) => <li key={e}>{e}</li>)}</ul>{data.eligibilityNotes && <p className="mt-2 text-slate-500">{data.eligibilityNotes}</p>}</div>}
          {(data.contact?.email || data.contact?.phone) && <div className="text-slate-600"><b>Contact:</b> {[data.contact.name, data.contact.email, data.contact.phone].filter(Boolean).join(' · ')}</div>}
        </div>
      )}
    </Modal>
  );
}

function CaResults({ q, meta, canWrite }: { q: string; meta: any; canWrite: boolean }) {
  const [province, setProvince] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/grant-finder/ca${qs({ q, province })}`);
  const { start, busy } = useStartApplication();
  return (
    <div className="space-y-6">
      <div className="max-w-xs">
        <Select value={province} onChange={(e) => setProvince(e.target.value)} placeholder="All provinces and territories" options={Object.entries(meta.caProvinces).map(([value, label]) => ({ value, label: String(label) }))} />
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data || loading ? <Spinner label="Searching Government of Canada data…" /> : (
        <>
          <section>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Landmark className="h-4 w-4 text-gold-600" />Federal programs that fund not-for-profits</h3>
            <p className="mt-1 text-sm text-slate-500">Intake periods open and close during the year. Each link goes to the official Government of Canada page with current dates and eligibility.</p>
            {!data.programs.length ? <p className="mt-3 text-sm text-slate-500">No listed programs match those words. See the live data below.</p> : (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.programs.map((p: any) => (
                  <div key={p.name} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="text-xs text-slate-500">{p.department}</div>
                    <div className="mt-1 font-semibold text-slate-900">{p.name}</div>
                    {p.typical && <div className="mt-1 text-xs font-medium text-gold-600">{p.typical}</div>}
                    <p className="mt-2 flex-1 text-sm text-slate-600">{p.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={p.url} target="_blank" rel="noreferrer"><Button size="sm" variant="primary" icon={<ExternalLink className="h-3.5 w-3.5" />}>Check intake & apply</Button></a>
                      {canWrite && <Button size="sm" loading={busy} icon={<FileEdit className="h-3.5 w-3.5" />} onClick={() => start({ country: 'CA', title: p.name, funder: p.department, source: 'canada.ca', source_url: p.url, prefill: { program_name: p.name } })}>Start application</Button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><TrendingUp className="h-4 w-4 text-emerald-600" />Programs funding not-for-profits right now</h3>
            <p className="mt-1 text-sm text-slate-500">From the {data.scanned.toLocaleString()} most recent federal grants and contributions to not-for-profits and charities (Government of Canada open data). A program that is actively funding groups like yours is a strong lead.</p>
            {data.liveError && <div className="mt-3"><Notice tone="warn">{data.liveError}</Notice></div>}
            {!data.active.length ? <p className="mt-3 text-sm text-slate-500">No recent awards match. Try a broader word or another province.</p> : (
              <div className="mt-3 space-y-2">
                {data.active.map((a: any) => (
                  <div key={`${a.program}|${a.department}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900">{a.program}</div>
                        <div className="text-xs text-slate-500">{a.department}</div>
                      </div>
                      <div className="flex gap-4 text-right text-xs text-slate-500">
                        <div><div className="text-lg font-bold text-slate-900">{a.awards}</div>recent awards</div>
                        <div><div className="text-lg font-bold text-slate-900">{fmt(a.typicalAward, 'CA')}</div>typical award</div>
                      </div>
                    </div>
                    {a.purpose && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{a.purpose}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {a.latestStart && <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />Latest agreement {date(a.latestStart)}</span>}
                      {a.provinces.length > 0 && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{a.provinces.join(', ')}</span>}
                    </div>
                    {a.examples.length > 0 && <div className="mt-2 text-xs text-slate-500">Funded projects: {a.examples.map((e: string) => `“${e}”`).join(' · ')}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={a.url} target="_blank" rel="noreferrer"><Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>See who it funded</Button></a>
                      {canWrite && <SaveButton body={{ country: 'CA', title: a.program, funder: a.department, url: a.url, source: 'open.canada.ca', source_id: a.program.slice(0, 90), amount: a.typicalAward, summary: a.purpose }} />}
                      {canWrite && <Button size="sm" loading={busy} icon={<FileEdit className="h-3.5 w-3.5" />} onClick={() => start({ country: 'CA', title: a.program, funder: a.department, source: 'open.canada.ca', source_url: a.url, prefill: { program_name: a.program } })}>Start application</Button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Applications list ─────────────────────────
const APP_STATUS: Record<string, { label: string; cls: string }> = {
  drafting: { label: 'Drafting', cls: 'bg-slate-100 text-slate-700' }, in_review: { label: 'In review', cls: 'bg-indigo-50 text-indigo-700' },
  ready: { label: 'Ready to submit', cls: 'bg-emerald-50 text-emerald-700' }, submitted: { label: 'Submitted', cls: 'bg-gold-400/20 text-gold-600' }, archived: { label: 'Archived', cls: 'bg-slate-100 text-slate-400' },
};

export function GrantApplications() {
  const { data, error, reload } = useApi<any[]>('/grant-applications');
  const { can, me } = useSession();
  const [add, setAdd] = useState(false);
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Guided applications built on what U.S. and Canadian funders usually ask for. Your organization's details fill in automatically.</p>
        {can('grants.write') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>New application</Button>}
      </div>
      {!data.length ? (
        <Empty title="No applications yet" icon={<FileText className="h-6 w-6" />} action={can('grants.write') && <Button variant="primary" onClick={() => setAdd(true)}>Start an application</Button>}>
          Find a grant in <b>Find grants</b> and choose <b>Start application</b>, or start a blank one for any funder.
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((a) => {
            const dl = daysLeft(a.deadline ? String(a.deadline).slice(0, 10) : null);
            return (
              <button key={a.id} onClick={() => nav(`/donors/grants/applications/${a.id}`)} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gold-400/60 hover:shadow-lg">
                <ProgressRing value={a.progress.percent} size={68} stroke={7} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs"><span aria-hidden>{FLAG[a.country as Country]}</span><span className={cx('rounded-full px-2 py-0.5 font-semibold', APP_STATUS[a.status]?.cls)}>{APP_STATUS[a.status]?.label}</span></div>
                  <div className="mt-1 line-clamp-2 font-semibold text-slate-900">{a.title}</div>
                  <div className="truncate text-xs text-slate-500">{a.funder ?? 'Funder not set'}</div>
                  <div className={cx('mt-1 text-xs', dl !== null && dl <= 14 && dl >= 0 ? 'font-semibold text-red-600' : 'text-slate-500')}>{a.deadline ? `Due ${date(a.deadline)}${dl !== null && dl >= 0 ? ` · ${dl} days` : ''}` : 'No deadline set'}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <NewApplication open={add} onClose={() => setAdd(false)} country={defaultCountry(me)} />
    </div>
  );
}

function NewApplication({ open, onClose, country: initial }: { open: boolean; onClose: () => void; country: Country }) {
  const [v, setV] = useState<any>({ country: initial, title: '', funder: '', deadline: '' });
  const { start, busy } = useStartApplication();
  return (
    <Modal open={open} onClose={onClose} title="New grant application" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!v.title.trim()} onClick={() => start({ country: v.country, title: v.title.trim(), funder: v.funder.trim() || null, deadline: v.deadline || null })}>Start</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['US', 'CA'] as Country[]).map((c) => (
            <button key={c} onClick={() => setV({ ...v, country: c })} className={cx('rounded-2xl border-2 p-3 text-left transition', v.country === c ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
              <div className="text-2xl" aria-hidden>{FLAG[c]}</div><div className="mt-1 text-sm font-semibold">{COUNTRY_NAME[c]}</div>
              <div className="text-xs text-slate-500">{c === 'US' ? 'SF-424 style: UEI, SAM.gov, narrative, SF-424A budget' : 'Federal style: CRA number, results, GBA Plus, eligible costs'}</div>
            </button>
          ))}
        </div>
        <Field label="Grant or program name"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></Field>
        <Field label="Funder"><Input value={v.funder} onChange={(e) => setV({ ...v, funder: e.target.value })} placeholder={v.country === 'US' ? 'e.g. Department of Housing and Urban Development' : 'e.g. Employment and Social Development Canada'} /></Field>
        <Field label="Deadline"><Input type="date" value={v.deadline} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── Application builder ─────────────────────────
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function GrantApplicationEditor() {
  const { id } = useParams();
  const { data: app, error, reload } = useApi<any>(`/grant-applications/${id}`);
  const meta = useMeta();
  const { can } = useSession();
  const [data, setData] = useState<Record<string, any>>({});
  const [att, setAtt] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState(0);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [progress, setProgress] = useState<any>(null);
  const timer = useRef<number | undefined>(undefined);
  const loaded = useRef(false);
  const { run } = useAction(); const { push } = useToast(); const nav = useNavigate();
  const writable = can('grants.write');

  useEffect(() => { if (app && !loaded.current) { setData(app.data ?? {}); setAtt(app.attachments ?? {}); setProgress(app.progress); loaded.current = true; } }, [app]);
  useEffect(() => () => { window.clearTimeout(timer.current); }, []);

  const tpl = app && meta.data ? meta.data.templates[app.country] : null;
  const steps = useMemo(() => (tpl ? [...tpl.sections.map((s: any) => ({ key: s.key, title: s.title })), { key: '__attachments', title: 'Attachments' }, { key: '__review', title: 'Review & download' }] : []), [tpl]);

  const queue = (patch: any) => {
    if (!writable) return;
    setSave('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try { const r = await api.patch(`/grant-applications/${id}`, patch); setProgress(r.progress); setSave('saved'); } catch (e: any) { setSave('error'); push('error', e.message); }
    }, 700);
  };
  const setField = (k: string, v: any) => { setData((d) => { const n = { ...d, [k]: v }; queue({ data: n }); return n; }); };
  const setAttachment = (k: string, v: boolean) => { setAtt((a) => { const n = { ...a, [k]: v }; queue({ attachments: n }); return n; }); };

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!app || !tpl) return <Spinner />;
  const secProgress = (key: string) => progress?.sections?.find((s: any) => s.key === key);
  const step = steps[active];
  const section = tpl.sections.find((s: any) => s.key === step.key);
  const attDone = tpl.attachments.filter((a: any) => att[a.key]).length;

  return (
    <div className="space-y-5">
      <Link to="/donors/grants?tab=applications" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><ChevronLeft className="h-3.5 w-3.5" />All applications</Link>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 p-5 text-white shadow-xl sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <ProgressRing value={progress?.percent ?? 0} size={96} label="ready" dark />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-white/60"><span aria-hidden>{FLAG[app.country as Country]}</span>{tpl.name}</div>
            <h2 className="mt-1 text-xl font-bold sm:text-2xl">{app.title}</h2>
            <div className="mt-1 text-sm text-white/70">{app.funder ?? 'Funder not set'}{app.deadline ? ` · due ${date(app.deadline)}` : ''}</div>
            <div className="mt-1 text-xs text-white/50">{progress?.done ?? 0} of {progress?.total ?? 0} required answers complete</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveState state={save} />
            {writable && <select value={app.status} onChange={async (e) => { const r = await run(() => api.patch(`/grant-applications/${id}`, { status: e.target.value }), 'Status updated'); if (r) reload(); }}
              className="rounded-lg border-0 bg-white/10 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/20 focus:ring-gold-400" aria-label="Status">
              {Object.entries(APP_STATUS).map(([k, v]) => <option key={k} value={k} className="text-slate-900">{v.label}</option>)}
            </select>}
            <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/grant-applications/${id}/pdf`)}>PDF</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav className="h-max rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-4" aria-label="Application sections">
          <ol className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
            {steps.map((s: any, i: number) => {
              const sp = secProgress(s.key);
              const complete = s.key === '__attachments' ? attDone === tpl.attachments.length : sp ? sp.done === sp.total : false;
              return (
                <li key={s.key} className="shrink-0">
                  <button onClick={() => { setActive(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition', i === active ? 'bg-slate-900 text-white shadow' : 'text-slate-700 hover:bg-slate-50')}>
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', complete ? 'bg-emerald-500 text-white' : i === active ? 'bg-gold-400 text-slate-900' : 'bg-slate-100 text-slate-500')}>{complete ? <Check className="h-4 w-4" /> : i + 1}</span>
                    <span className="min-w-0 flex-1 whitespace-nowrap lg:whitespace-normal">{s.title}{sp && sp.total > 0 && <span className={cx('block text-[11px]', i === active ? 'text-white/60' : 'text-slate-400')}>{sp.done}/{sp.total} required</span>}{s.key === '__attachments' && <span className={cx('block text-[11px]', i === active ? 'text-white/60' : 'text-slate-400')}>{attDone}/{tpl.attachments.length} ready</span>}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 space-y-4">
          {section && (
            <Card>
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-400/20 text-sm font-bold text-gold-600">{active + 1}</span>
                <div><h3 className="text-lg font-semibold text-slate-900">{section.title}</h3><p className="mt-0.5 text-sm text-slate-500">{section.intro}</p></div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {section.fields.map((f: any) => <AppField key={f.key} f={f} value={data[f.key]} onChange={(v) => setField(f.key, v)} tpl={tpl} appId={String(id)} writable={writable} country={app.country} canDraft={can('ai.ask')} />)}
              </div>
            </Card>
          )}
          {step.key === '__attachments' && (
            <Card>
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-400/20 text-sm font-bold text-gold-600">{active + 1}</span>
                <div><h3 className="text-lg font-semibold text-slate-900">Attachments checklist</h3><p className="mt-0.5 text-sm text-slate-500">Documents funders commonly ask for. Tick each one when it's ready. Always follow the list in the funder's own guide.</p></div>
              </div>
              <ul className="divide-y divide-slate-100">
                {tpl.attachments.map((a: any) => (
                  <li key={a.key}>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600" checked={Boolean(att[a.key])} disabled={!writable} onChange={(e) => setAttachment(a.key, e.target.checked)} />
                      <span><span className={cx('block text-sm font-medium', att[a.key] ? 'text-slate-400 line-through' : 'text-slate-800')}>{a.label}</span>{a.help && <span className="block text-xs text-slate-500">{a.help}</span>}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {step.key === '__review' && (
            <Card>
              <div className="flex flex-wrap items-center gap-5">
                <ProgressRing value={progress?.percent ?? 0} size={110} label="ready" tone={progress?.percent === 100 ? 'good' : 'gold'} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-slate-900">{progress?.percent === 100 ? 'Every required answer is complete' : 'Almost there'}</h3>
                  <p className="mt-1 text-sm text-slate-500">Download a working copy to review with your team, then copy each answer into the funder's form or portal. A.I. Fundraising never submits applications for you.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => download(`/grant-applications/${id}/pdf`)}>Download application (PDF)</Button>
                    {app.source_url && <a href={app.source_url} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="h-4 w-4" />}>Open funder page</Button></a>}
                  </div>
                </div>
              </div>
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {tpl.sections.map((s: any, i: number) => { const sp = secProgress(s.key); const ok = sp && sp.done === sp.total; return (
                  <li key={s.key}><button onClick={() => setActive(i)} className="flex w-full items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-slate-300" />}<span className="flex-1">{s.title}</span><span className="text-xs text-slate-400">{sp?.done}/{sp?.total}</span></button></li>
                ); })}
              </ul>
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="text-sm font-semibold text-slate-900">Helpful links</div>
                <ul className="mt-2 space-y-1 text-sm">{tpl.resources.map((r: any) => <li key={r.url}><a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.label}<ExternalLink className="h-3 w-3" /></a></li>)}</ul>
              </div>
              {writable && <div className="mt-5 border-t border-slate-100 pt-4"><Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (!window.confirm('Delete this application? This cannot be undone.')) return; if (await run(() => api.del(`/grant-applications/${id}`), 'Application deleted')) nav('/donors/grants?tab=applications'); }}>Delete application</Button></div>}
            </Card>
          )}
          <div className="flex justify-between">
            <Button disabled={active === 0} icon={<ChevronLeft className="h-4 w-4" />} onClick={() => { setActive(active - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Previous</Button>
            {active < steps.length - 1 && <Button variant="primary" onClick={() => { setActive(active + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Next: {steps[active + 1].title}<ChevronRight className="h-4 w-4" /></Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppField({ f, value, onChange, tpl, appId, writable, country, canDraft }: { f: any; value: any; onChange: (v: any) => void; tpl: any; appId: string; writable: boolean; country: Country; canDraft: boolean }) {
  const label = `${f.label}${f.required ? ' *' : ''}`;
  const full = !f.half || f.type === 'textarea' || f.type === 'budget';
  if (f.type === 'checkbox') return (
    <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 sm:col-span-2', value ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200')}>
      <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600" checked={Boolean(value)} disabled={!writable} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-slate-700">{label}{f.help && <span className="block text-xs text-slate-500">{f.help}</span>}</span>
    </label>
  );
  if (f.type === 'budget') return <div className="sm:col-span-2"><BudgetEditor value={value ?? {}} lines={tpl.budgetLines} onChange={onChange} country={country} writable={writable} /></div>;
  if (f.type === 'textarea') return <div className="sm:col-span-2"><Narrative f={f} value={value ?? ''} onChange={onChange} appId={appId} writable={writable} canDraft={canDraft} /></div>;
  const type = f.type === 'money' || f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
  return (
    <Field label={label} hint={f.help} className={full ? 'sm:col-span-2' : ''}>
      {f.type === 'select'
        ? <Select value={value ?? ''} disabled={!writable} onChange={(e) => onChange(e.target.value)} placeholder="Choose…" options={f.options} />
        : <div className="relative">{f.type === 'money' && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>}
            <Input type={type} value={value ?? ''} readOnly={!writable} placeholder={f.placeholder} min={type === 'number' ? 0 : undefined} className={f.type === 'money' ? 'pl-7' : ''}
              onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} /></div>}
    </Field>
  );
}

function Narrative({ f, value, onChange, appId, writable, canDraft }: { f: any; value: string; onChange: (v: string) => void; appId: string; writable: boolean; canDraft: boolean }) {
  const [draft, setDraft] = useState<{ text: string; generator: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const { run, busy } = useAction();
  const w = words(value);
  const over = f.words && w > f.words;
  return (
    <div className="rounded-2xl border border-slate-200 p-4 transition focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{f.label}{f.required && <span className="text-red-500"> *</span>}</div>{f.help && <div className="mt-0.5 text-xs text-slate-500">{f.help}</div>}</div>
        <div className="flex items-center gap-1">
          {value && <Button size="sm" variant="ghost" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</Button>}
          {f.draftable && writable && canDraft && <Button size="sm" variant="subtle" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setAsking(!asking)}>{value ? 'Improve with A.I.' : 'Draft with A.I.'}</Button>}
        </div>
      </div>
      {asking && !draft && (
        <div className="mt-3 rounded-xl bg-indigo-50/60 p-3">
          <Field label="Anything the draft should include? (optional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. we served 340 families last year; partners are the county food bank and two churches" /></Field>
          <div className="mt-2 flex justify-end gap-2"><Button size="sm" onClick={() => setAsking(false)}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} icon={<Wand2 className="h-3.5 w-3.5" />} onClick={async () => { const r = await run(() => api.post(`/grant-applications/${appId}/draft`, { field: f.key, notes: notes || null })); if (r) setDraft(r); }}>Suggest a draft</Button></div>
        </div>
      )}
      {draft && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-indigo-700"><Sparkles className="h-3.5 w-3.5" />{draft.generator === 'ai' ? 'Suggested draft. Check every fact and fill in any [brackets] before using it.' : 'A.I. drafting is not turned on for this site, so here is an outline to write from.'}</div>
          <p className="whitespace-pre-line text-sm text-slate-700">{draft.text}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={() => { setDraft(null); setAsking(false); }}>Discard</Button>
            {value && <Button size="sm" onClick={() => { onChange(`${value}\n\n${draft.text}`); setDraft(null); setAsking(false); }}>Add below my answer</Button>}
            <Button size="sm" variant="primary" onClick={() => { onChange(draft.text); setDraft(null); setAsking(false); }}>{draft.generator === 'ai' ? (value ? 'Replace my answer' : 'Use this draft') : (value ? 'Replace with outline' : 'Use as outline')}</Button>
          </div>
        </div>
      )}
      <Textarea className="mt-3" rows={Math.min(14, Math.max(4, Math.ceil((f.words ?? 150) / 60)))} value={value} readOnly={!writable} onChange={(e) => onChange(e.target.value)} />
      {f.words && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full transition-all', over ? 'bg-red-500' : 'bg-gradient-to-r from-gold-600 to-gold-400')} style={{ width: `${Math.min(100, (w / f.words) * 100)}%` }} /></div>
          <span className={cx('text-xs tabular-nums', over ? 'font-semibold text-red-600' : 'text-slate-400')}>{w} / {f.words} words</span>
        </div>
      )}
    </div>
  );
}

function BudgetEditor({ value, lines, onChange, country, writable }: { value: Record<string, { amount?: number | ''; note?: string }>; lines: any[]; onChange: (v: any) => void; country: Country; writable: boolean }) {
  const total = lines.reduce((a, l) => a + (Number(value[l.key]?.amount) || 0), 0);
  const set = (k: string, patch: any) => onChange({ ...value, [k]: { ...(value[k] ?? {}), ...patch } });
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="grid grid-cols-[1fr_140px] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-[220px_140px_1fr]"><span>Category</span><span className="text-right">Amount</span><span className="hidden sm:block">How it was calculated</span></div>
      {lines.map((l) => {
        const amt = Number(value[l.key]?.amount) || 0;
        return (
          <div key={l.key} className="grid grid-cols-[1fr_140px] items-start gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-[220px_140px_1fr]">
            <div><div className="text-sm font-medium text-slate-800">{l.label}</div>{l.help && <div className="text-xs text-slate-400">{l.help}</div>}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-all" style={{ width: `${total ? (amt / total) * 100 : 0}%` }} /></div></div>
            <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <Input type="number" min={0} className="pl-7 text-right" value={value[l.key]?.amount ?? ''} readOnly={!writable} onChange={(e) => set(l.key, { amount: e.target.value === '' ? '' : Number(e.target.value) })} aria-label={`${l.label} amount`} /></div>
            <Input className="col-span-2 sm:col-span-1" value={value[l.key]?.note ?? ''} readOnly={!writable} placeholder="e.g. 0.5 FTE × $52,000" onChange={(e) => set(l.key, { note: e.target.value })} aria-label={`${l.label} calculation`} />
          </div>
        );
      })}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white"><span className="text-sm font-semibold">Total</span><span className="text-lg font-bold">{fmt(total, country)}</span></div>
    </div>
  );
}
