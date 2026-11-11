import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Menu, X, HeartHandshake, Landmark, Mail, ListChecks, LineChart, MessageCircleQuestion, ShieldCheck,
  Lock, UserCheck, FileText, Sparkles, CalendarDays, Plug, Receipt, TrendingUp, Scale, KeyRound, Eye,
} from 'lucide-react';
import './landing.css';

/* ---------------- Motion helpers ---------------- */

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fade/lift/un-blur every [data-reveal] element as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.classList.add('js');
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
    items.forEach((n) => { const d = Number(n.dataset.delay || 0); if (d) n.style.transitionDelay = `${d}ms`; });
    if (!('IntersectionObserver' in window) || reducedMotion()) { items.forEach((n) => n.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }), { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
    items.forEach((n) => io.observe(n));
    return () => { io.disconnect(); };
  }, [root]);
}

/** True once the element has been seen (or immediately when motion is reduced). */
function useSeen<T extends HTMLElement>(threshold = 0.4) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => { io.disconnect(); };
  }, [threshold]);
  return [ref, seen] as const;
}

/** Smoothly tween a number toward its target. */
function useTween(target: number, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reducedMotion()) { setV(target); from.current = target; return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e; from.current = cur; setV(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [target, ms]);
  return v;
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const compact = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : money(n);

/** Pointer glow that follows the cursor inside a card. */
function glow(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/* ---------------- Hero chart ---------------- */

const GIVING = [38, 44, 41, 52, 58, 55, 66, 72, 70, 84, 96];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N'];

function smoothPath(pts: [number, number][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function HeroChart() {
  const W = 520, H = 210, padX = 14, top = 18, bottom = 180;
  const pts = GIVING.map((g, i) => [padX + (i * (W - padX * 2)) / (GIVING.length - 1), Math.round(bottom - ((g - 30) / 70) * (bottom - top))] as [number, number]);
  const d = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <svg className="lp-chart" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="Sample chart: monthly giving rising through the year">
      <defs>
        <linearGradient id="rc-gold" x1="0" x2="1"><stop offset="0" stopColor="#9a7209" /><stop offset=".55" stopColor="#efba11" /><stop offset="1" stopColor="#f6d77a" /></linearGradient>
        <linearGradient id="rc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#efba11" stopOpacity=".28" /><stop offset="1" stopColor="#efba11" stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2, 3].map((i) => <line key={i} className="rc-grid" x1="0" x2={W} y1={top + (i * (bottom - top)) / 3} y2={top + (i * (bottom - top)) / 3} />)}
      <path className="rc-area" d={`${d} L${last[0]},${bottom} L${pts[0][0]},${bottom} Z`} fill="url(#rc-fill)" />
      <path className="rc-path" d={d} pathLength={1000} />
      <circle className="rc-halo" cx={last[0]} cy={last[1]} r="16" />
      {pts.map(([x, y], i) => <circle key={i} className={`rc-node n${i}`} cx={x} cy={y} r={i === pts.length - 1 ? 7 : 4.5}><title>{`${MONTHS[i]}: $${GIVING[i]}K given`}</title></circle>)}
      <circle className="rc-pulse" r="4.5">
        <animateMotion className="rc-pulse-motion" dur="4.5s" begin="3s" repeatCount="indefinite" path={d} />
      </circle>
      {pts.map(([x], i) => <text key={i} className="rc-label" x={x} y={H + 10} textAnchor="middle">{MONTHS[i]}</text>)}
    </svg>
  );
}

/* ---------------- Content ---------------- */

const MARQUEE = ['Donor intelligence', 'True fund accounting', 'Tax receipts', 'Grant pipeline', 'Email campaigns & journeys', 'Events & ticketing', 'Payroll', 'Invoices', 'Bank feed', 'QuickBooks sync', 'Stripe · Square · PayPal', 'Budgets vs. actual', 'Board-ready reports', 'Impact stories', 'Donor trips & routes', 'Ask A.I. Nonprofits'];

const BEFORE_AFTER: { title: string; before: string; after: string }[] = [
  { title: 'Who to call this week', before: 'A gut feeling and a spreadsheet nobody has updated since spring.', after: 'A ranked list scored on capacity, recency, frequency, giving, engagement and momentum, with the reason for every suggested ask.' },
  { title: 'Restricted money', before: 'Grant dollars mixed into the general account and reconciled by hand at year end.', after: 'Every ledger line names its fund, each fund balances on its own, and overspending a restricted fund is blocked.' },
  { title: 'Thank-yous and receipts', before: 'Receipts batched in January, thank-you notes whenever someone remembers.', after: 'Receipts generated from posted gifts, and thank-you drafts ready for a person to review and send.' },
  { title: 'The board meeting', before: 'Three days of copying numbers from four systems into slides.', after: 'Statements, giving trends and fund balances exported to PDF or Excel in a few clicks.' },
];

type Stage = { key: string; label: string; icon: React.ElementType; eyebrow: string; title: string; body: string; points: string[]; mock: () => React.ReactElement };

const DONORS = [
  { n: 'Margaret Ellis', s: 'Lapsing · last gift 13 mo', score: 91, c: '#9a7209', pill: ['r', 'Re-engage'] },
  { n: 'The Okafor Family', s: 'Monthly · 4 yrs', score: 84, c: '#4f46e5', pill: ['g', 'Upgrade ask'] },
  { n: 'Daniel Reyes', s: 'First gift in May', score: 72, c: '#16834a', pill: ['y', 'Second gift'] },
  { n: 'Grace Community Fdn.', s: 'Grant renewal due', score: 68, c: '#b4473a', pill: ['i', 'Report due'] },
];

const STAGES: Stage[] = [
  {
    key: 'donors', label: 'Donors', icon: HeartHandshake, eyebrow: 'Donors & Giving', title: 'Know exactly who is ready to give again.',
    body: 'Every donor gets a 0–100 opportunity score and a health status built from their real giving, so your team spends its time on the conversations that matter.',
    points: ['Next $100K list: upgrades, lapsed donors and first-time givers to welcome back', 'Suggested asks that show their basis, never a black box', 'Call lists, donor trips with routes, and outreach history in one profile'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-tag good">Next $100K · this week</div>
        {DONORS.map((d, i) => (
          <div key={d.n} className="lp-mock-row" style={{ animationDelay: `${i * 120}ms` }}>
            <span className="lp-avatar" style={{ background: d.c }}>{d.n.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
            <span className="nm">{d.n}<small>{d.s}</small></span>
            <span className={`lp-pill ${d.pill[0]}`}>{d.pill[1]}</span>
            <span className="lp-meter" title={`Score ${d.score}`}><i style={{ width: `${d.score}%`, animationDelay: `${300 + i * 120}ms` }} /></span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'money', label: 'Money', icon: Landmark, eyebrow: 'Accounting · Payroll · Invoices', title: 'Fund accounting that balances itself.',
    body: 'Gifts, expenses, payroll, invoices and bank items all post through one double-entry ledger, tagged by fund, so restricted money stays restricted.',
    points: ['Statement of activities, financial position and budget vs. actual', 'Journal approvals with separation of duties; posted entries are voided, never deleted', 'QuickBooks sync, bank feed review and Excel/PDF exports'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-tag good">Fund balances</div>
        {[['General Operating', 'Unrestricted', 182400, 78], ['Clean Water Project', 'Temporarily restricted', 64250, 54], ['Scholarship Endowment', 'Permanently restricted', 250000, 100], ['Building Campaign', 'Temporarily restricted', 41800, 33]].map(([n, s, v, p], i) => (
          <div key={n as string} className="lp-mock-row" style={{ animationDelay: `${i * 120}ms` }}>
            <span className="nm">{n}<small>{s}</small></span>
            <span className="lp-meter"><i style={{ width: `${p}%`, animationDelay: `${300 + i * 120}ms` }} /></span>
            <span className="val">{compact(v as number)}</span>
          </div>
        ))}
        <div className="lp-mock-row" style={{ animationDelay: '520ms' }}><span className="nm">Ledger check<small>Debits = credits in every fund</small></span><span className="lp-pill g">Balanced</span></div>
      </div>
    ),
  },
  {
    key: 'reach', label: 'Email', icon: Mail, eyebrow: 'A.I. Nonprofits Reach', title: 'Campaigns and journeys your donors actually open.',
    body: 'Build emails with a visual editor, send to smart audiences, and set up welcome and thank-you journeys. A person always presses send.',
    points: ['Audiences from giving history, tags and engagement', 'Welcome, lapsed-donor and year-end journeys', 'Open and click analytics, clearly labeled as estimates'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-tag good">Year-end appeal · draft</div>
        {[['Audience', 'Gave last year, not this year', '1,284'], ['Subject', '“You made 412 wells possible”', 'A/B'], ['Journey', 'Thank-you → impact story → invite', '3 steps'], ['Status', 'Waiting for your review', 'Draft']].map(([a, b, c], i) => (
          <div key={a} className="lp-mock-row" style={{ animationDelay: `${i * 120}ms` }}><span className="nm">{a}<small>{b}</small></span><span className={`lp-pill ${i === 3 ? 'y' : 'i'}`}>{c}</span></div>
        ))}
      </div>
    ),
  },
  {
    key: 'work', label: 'Work', icon: ListChecks, eyebrow: 'Work · Projects · Grants', title: 'Every deadline, grant and event in one place.',
    body: 'Tasks, calendars, time logs, grant pipelines and events live next to the donors and funds they belong to, organized by workspace.',
    points: ['Grant pipeline with report due dates and award tracking', 'Projects with budgets, tasks and time', 'Event pages, registrations and check-in'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-tag good">This week</div>
        {[['Spring Gala', 'Registrations open · 186 guests', 'g', 'Event'], ['Community grant report', 'Due Friday', 'r', 'Grant'], ['Volunteer onboarding', '6 of 9 tasks done', 'y', 'Project'], ['Board packet', 'Assigned to Finance', 'i', 'Task']].map(([a, b, p, c], i) => (
          <div key={a} className="lp-mock-row" style={{ animationDelay: `${i * 120}ms` }}><span className="lp-ic lp-ic-indigo"><CalendarDays size={16} /></span><span className="nm">{a}<small>{b}</small></span><span className={`lp-pill ${p}`}>{c}</span></div>
        ))}
      </div>
    ),
  },
  {
    key: 'impact', label: 'Impact', icon: LineChart, eyebrow: 'Growth · Impact', title: 'Show donors what their giving did.',
    body: 'Track outcomes by program, connect them to the funds that paid for them, and turn the numbers into stories and updates.',
    points: ['Outcome metrics by program and workspace', 'Growth audit: retention, upgrades, lapsed revenue', 'Weekly updates for leaders and board members'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-tag good">Impact this year</div>
        {[['Families served', 2418, 82], ['Meals provided', 96500, 91], ['Students mentored', 312, 64], ['Wells completed', 41, 70]].map(([a, v, p], i) => (
          <div key={a as string} className="lp-mock-row" style={{ animationDelay: `${i * 120}ms` }}><span className="nm">{a}</span><span className="lp-meter"><i style={{ width: `${p}%`, animationDelay: `${300 + i * 120}ms` }} /></span><span className="val">{(v as number).toLocaleString()}</span></div>
        ))}
      </div>
    ),
  },
  {
    key: 'ask', label: 'Ask', icon: MessageCircleQuestion, eyebrow: 'Ask A.I. Nonprofits', title: 'Ask a question. Get an answer with sources.',
    body: 'Ask in plain English and get answers drawn only from records you are allowed to see, each linked back to the source. It reads and explains; it never changes anything.',
    points: ['Answers cite the donors, gifts and entries they came from', 'Respects every role, permission and workspace', 'Drafts letters and emails that stay drafts until a person acts'],
    mock: () => (
      <div className="lp-mock">
        <div className="lp-bubble q">Which donors gave over $1,000 last year but nothing this year?</div>
        <div className="lp-bubble a" style={{ animationDelay: '500ms' }}>
          <b>14 donors</b> fit, totaling <b>$48,250</b> last year. The largest are Margaret Ellis ($9,000) and the Chen Family ($6,500).
          <small>Sources: 14 donor records · 31 gifts</small>
        </div>
        <div className="lp-bubble a" style={{ animationDelay: '900ms' }}><span className="lp-typing" aria-label="Drafting"><i /><i /><i /></span></div>
      </div>
    ),
  },
];

const FAQ: [string, string][] = [
  ['Does the A.I. ever send emails or change records on its own?', 'No. A.I. in A.I. Nonprofits reads, explains, calculates, recommends and drafts. Sending email, posting accounting entries, moving money, editing donor records and inviting users are always buttons a person presses, and drafts stay drafts until someone acts.'],
  ['Is this real fund accounting?', 'Yes. Every ledger line names a fund and each fund must balance on its own. Restricted-fund overdrafts are blocked unless an approver overrides, endowment principal is protected, and posted entries are voided rather than deleted.'],
  ['Can it work with the tools we already use?', 'It connects to QuickBooks Online, Stripe, Square, PayPal, Google (Gmail and Calendar) and Plaid bank feeds, and imports donors and gifts from CSV exports of most CRMs.'],
  ['How is our donor data protected?', 'Each organization is isolated at the database level, so one organization can never see another\'s rows. Access is controlled by 30 separate permissions, sensitive actions are recorded in an activity history, and card numbers are never stored.'],
  ['Does it fit churches and ministries as well as other nonprofits?', 'Yes. You choose what to call your workspaces (Ministries, Programs, Chapters, Campuses and more), and faith-based language in writing tools is optional.'],
  ['How do we get started?', 'Choose “Create your organization”, add your name and email, and you are in. You can import donors and gifts on day one, then invite your team with the roles they need.'],
];

/* ---------------- Page ---------------- */

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const art = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'A.I. Nonprofits · The operating system for nonprofits';
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); document.title = prev; };
  }, []);

  // Hero parallax on pointer move (desktop, motion allowed).
  useEffect(() => {
    const el = art.current;
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
      el.style.transform = `perspective(1200px) rotateY(${x * 6}deg) rotateX(${-y * 5}deg) translate3d(${x * 10}px, ${y * 8}px, 0)`;
    };
    window.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('pointermove', onMove); };
  }, []);

  const nav = [['#platform', 'Platform'], ['#calculator', 'Calculator'], ['#trust', 'Trust'], ['#faq', 'FAQ']];

  return (
    <div className="lp" ref={root}>
      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <Link to="/" className="lp-brand" aria-label="A.I. Nonprofits home">
            <img src="/logo-crest.webp" alt="" />
            <span><b>A.I. Nonprofits</b><small>by Thought Authorities</small></span>
          </Link>
          <nav className="lp-links" aria-label="Sections">{nav.map(([h, l]) => <a key={h} href={h}>{l}</a>)}</nav>
          <div className="lp-nav-cta">
            <Link to="/login" className="lp-btn lp-btn-ghost lp-hide-sm">Sign in</Link>
            <Link to="/signup" className="lp-btn lp-btn-dark">Get started</Link>
            <button type="button" className="lp-burger" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        {menu && (
          <div className="lp-mobile">
            {nav.map(([h, l]) => <a key={h} href={h} onClick={() => setMenu(false)}>{l}</a>)}
            <Link to="/login" className="lp-btn lp-btn-ghost">Sign in</Link>
            <Link to="/signup" className="lp-btn lp-btn-dark">Create your organization</Link>
          </div>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-glow" aria-hidden />
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-eyebrow lp-in d0"><span className="lp-dot" />The operating system for nonprofits</p>
              <h1 className="lp-h1 lp-in d1">Raise more. Steward every gift. <span className="lp-italic lp-accent lp-underline">Prove the impact.</span></h1>
              <p className="lp-lede lp-in d2">Donors, fund accounting, grants, email, events and impact in one secure place, with an A.I. assistant that explains your numbers and drafts your next step. Your team stays in charge of every send, entry and dollar.</p>
              <div className="lp-ctas lp-in d3">
                <Link to="/signup" className="lp-btn lp-btn-dark">Create your organization <ArrowRight size={16} /></Link>
                <a href="#platform" className="lp-btn lp-btn-ghost">See how it works</a>
              </div>
              <div className="lp-meta lp-in d4"><span>Fund-balanced ledger</span><span>QuickBooks &amp; Stripe ready</span><span>A.I. drafts, people decide</span></div>
            </div>

            <div className="lp-art lp-in d2" ref={art}>
              <div className="lp-float lp-float-c"><span className="lp-ic lp-ic-green"><Receipt size={16} /></span><span><small>Receipt</small><b>Sent by Ana · $250</b></span></div>
              <div className="lp-chart-card">
                <div className="lp-chart-head">
                  <div><small>Giving this year · sample</small><b>$676,000</b></div>
                  <span className="lp-up">▲ 18% vs last year</span>
                </div>
                <HeroChart />
                <div className="lp-funds">
                  {[['General', '$182K', 78], ['Restricted', '$106K', 54], ['Endowment', '$250K', 100]].map(([a, b, p], i) => (
                    <div key={a as string} className="lp-fund"><small>{a}</small><b>{b}</b><div className="lp-bar"><i style={{ width: `${p}%`, animationDelay: `${1.2 + i * 0.2}s` }} /></div></div>
                  ))}
                </div>
              </div>
              <div className="lp-float lp-float-a"><span className="lp-ic lp-ic-gold"><TrendingUp size={16} /></span><span><small>Next $100K</small><b>14 donors ready</b></span></div>
              <div className="lp-float lp-float-b"><span className="lp-ic lp-ic-indigo"><Sparkles size={16} /></span><span><small>Thank-you letter</small><b>Draft ready for review</b></span></div>
            </div>
          </div>
          <div className="lp-scroll" aria-hidden><i /></div>
        </section>

        {/* Marquee */}
        <div className="lp-marquee" aria-label="Capabilities">
          <div className="lp-marquee-track">
            {[0, 1].map((k) => (
              <div key={k} className="lp-marquee-row" aria-hidden={k === 1 || undefined}>
                {MARQUEE.map((m) => <span key={m}>{m}<i /></span>)}
              </div>
            ))}
          </div>
        </div>

        <BeforeAfter />
        <Stages />
        <Calculator />
        <Stats />
        <Bento />
        <Trust />

        {/* FAQ */}
        <section className="lp-section" id="faq">
          <div className="lp-narrow">
            <div className="lp-center" data-reveal><p className="lp-eyebrow">Questions</p><h2 className="lp-h2">Good questions, <span className="lp-italic lp-accent">straight answers.</span></h2></div>
            <div className="lp-faq" data-reveal data-delay="120">
              {FAQ.map(([q, a]) => <details key={q}><summary>{q}<i aria-hidden /></summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="lp-section lp-darkband lp-close">
          <div className="lp-narrow" data-reveal>
            <img src="/logo-crest.webp" alt="" />
            <p className="lp-eyebrow" style={{ marginTop: 24 }}>Start today</p>
            <h2 className="lp-h2" style={{ color: '#fff', marginInline: 'auto' }}>Give your mission the <span className="lp-italic lp-accent">operating system</span> it deserves.</h2>
            <p className="lp-lede">Set up your organization in a minute, import your donors, and see your next best conversations today.</p>
            <div className="lp-ctas">
              <Link to="/signup" className="lp-btn lp-btn-gold">Create your organization <ArrowRight size={16} /></Link>
              <Link to="/login" className="lp-btn lp-btn-ghost">Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <span>© {new Date().getFullYear()} Thought Authorities · A.I. Nonprofits</span>
          <nav><a href="#platform">Platform</a><a href="#trust">Trust</a><Link to="/login">Sign in</Link><Link to="/signup">Get started</Link></nav>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- Sections ---------------- */

function BeforeAfter() {
  const [after, setAfter] = useState(false);
  const [touched, setTouched] = useState(false);
  const [ref, seen] = useSeen<HTMLDivElement>(0.5);
  useEffect(() => {
    if (!seen || touched) return;
    const t = setTimeout(() => setAfter(true), reducedMotion() ? 0 : 1400);
    return () => { clearTimeout(t); };
  }, [seen, touched]);
  const flip = () => { setTouched(true); setAfter((a) => !a); };
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-center" data-reveal>
          <p className="lp-eyebrow">Before &amp; after</p>
          <h2 className="lp-h2">From scattered spreadsheets to <span className="lp-italic lp-accent">one clear picture.</span></h2>
        </div>
        <div className="lp-switch-row" data-reveal data-delay="100">
          <span className={after ? '' : 'on'}>Today</span>
          <button type="button" role="switch" aria-checked={after} aria-label="Show with A.I. Nonprofits" className="lp-switch" onClick={flip} />
          <span className={after ? 'on' : ''}>After A.I. Nonprofits</span>
        </div>
        <div ref={ref} className={`lp-ba${after ? ' is-after' : ''}`} aria-live="polite">
          {BEFORE_AFTER.map((b, i) => (
            <div key={b.title} className="lp-ba-card" data-reveal data-delay={i * 90}>
              <div className="lp-ba-face before" aria-hidden={after}><span className="lp-tag bad">Today</span><h3>{b.title}</h3><p>{b.before}</p></div>
              <div className="lp-ba-face after" aria-hidden={!after}><span className="lp-tag good">After A.I. Nonprofits</span><h3>{b.title}</h3><p>{b.after}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stages() {
  const [cur, setCur] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const DUR = 6500;

  useEffect(() => {
    const el = box.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([en]) => setVisible(en.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); };
  }, []);
  useEffect(() => {
    if (!auto || !visible || reducedMotion()) return;
    const t = setTimeout(() => setCur((c) => (c + 1) % STAGES.length), DUR);
    return () => { clearTimeout(t); };
  }, [cur, auto, visible]);

  const pick = (i: number, focus = false) => {
    setAuto(false);
    const n = (i + STAGES.length) % STAGES.length;
    setCur(n);
    if (focus) tabs.current[n]?.focus();
  };
  const s = STAGES[cur];
  const running = auto && visible && !reducedMotion();
  return (
    <section className="lp-section lp-soft" id="platform">
      <div className="lp-wrap">
        <div className="lp-center" data-reveal>
          <p className="lp-eyebrow">One platform</p>
          <h2 className="lp-h2">Everything your mission runs on, <span className="lp-italic lp-accent">connected.</span></h2>
          <p className="lp-lede">Six modules share one set of donors, funds and people, so nothing is entered twice and every report agrees.</p>
        </div>
        <div className="lp-stages" ref={box} data-reveal data-delay="120" onPointerEnter={() => setAuto(false)}>
          <div className="lp-tabs" role="tablist" aria-label="Modules">
            {STAGES.map((t, i) => {
              const Icon = t.icon;
              const on = i === cur;
              return (
                <button key={t.key} ref={(b) => { tabs.current[i] = b; }} type="button" role="tab" id={`lp-tab-${t.key}`} aria-controls={`lp-panel-${t.key}`} aria-selected={on} tabIndex={on ? 0 : -1} className="lp-tab"
                  onClick={() => pick(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') { e.preventDefault(); pick(i + 1, true); }
                    if (e.key === 'ArrowLeft') { e.preventDefault(); pick(i - 1, true); }
                    if (e.key === 'Home') { e.preventDefault(); pick(0, true); }
                    if (e.key === 'End') { e.preventDefault(); pick(STAGES.length - 1, true); }
                  }}>
                  <Icon size={16} />{t.label}
                  <span key={`${cur}-${running}`} className={`prog${on && running ? ' run' : ''}`} style={{ ['--dur' as any]: `${DUR}ms` }} />
                </button>
              );
            })}
          </div>
          <div key={s.key} className="lp-panel" role="tabpanel" id={`lp-panel-${s.key}`} aria-labelledby={`lp-tab-${s.key}`}>
            <div>
              <p className="lp-eyebrow">{s.eyebrow}</p>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <ul className="lp-list">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            <s.mock />
          </div>
        </div>
      </div>
    </section>
  );
}

function Range({ name, label, value, min, max, step, onChange, fmt, hint }: { name: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; hint: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="lp-range">
      <label htmlFor={`lp-${name}`}>{label}<output htmlFor={`lp-${name}`}>{fmt(value)}</output></label>
      <input id={`lp-${name}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--p' as any]: `${p}%` }} />
      <small>{hint}</small>
    </div>
  );
}

function Calculator() {
  const [donors, setDonors] = useState(800);
  const [gift, setGift] = useState(450);
  const [retention, setRetention] = useState(43);
  const [lift, setLift] = useState(10);
  const r = useMemo(() => {
    const kept = Math.round(donors * (lift / 100));
    const yearOne = kept * gift;
    const newRate = Math.min(0.95, (retention + lift) / 100);
    const threeYear = yearOne * (1 + newRate + newRate * newRate);
    return { kept, yearOne, threeYear, today: donors * gift };
  }, [donors, gift, retention, lift]);
  const yearOne = useTween(r.yearOne), threeYear = useTween(r.threeYear), kept = useTween(r.kept), today = useTween(r.today);
  return (
    <section className="lp-section" id="calculator">
      <div className="lp-wrap">
        <div className="lp-center" data-reveal>
          <p className="lp-eyebrow">Live calculator</p>
          <h2 className="lp-h2">What is keeping one more donor <span className="lp-italic lp-accent">worth to you?</span></h2>
          <p className="lp-lede">Move the sliders. Small gains in donor retention add up quickly, and they are exactly what the priority lists and journeys are built to win.</p>
        </div>
        <div className="lp-calc">
          <div className="lp-calc-in" data-reveal>
            <Range name="donors" label="Active donors" value={donors} min={50} max={5000} step={50} onChange={setDonors} fmt={(v) => v.toLocaleString()} hint="People who gave in the last 12 months." />
            <Range name="gift" label="Average yearly giving per donor" value={gift} min={50} max={5000} step={25} onChange={setGift} fmt={money} hint="Total giving divided by active donors." />
            <Range name="retention" label="Donor retention today" value={retention} min={20} max={80} step={1} onChange={setRetention} fmt={(v) => `${v}%`} hint="Many nonprofits keep fewer than half of last year's donors." />
            <Range name="lift" label="Retention improvement" value={lift} min={1} max={20} step={1} onChange={setLift} fmt={(v) => `+${v} pts`} hint="How many more donors out of every 100 you keep." />
          </div>
          <div className="lp-calc-out" data-reveal data-delay="120" aria-live="polite">
            <div>
              <small>Extra giving kept next year</small>
              <div className="lp-big"><span className="lp-accent">{money(yearOne)}</span></div>
            </div>
            <div className="lp-calc-grid">
              <div><small>Donors kept</small><b>{Math.round(kept).toLocaleString()}</b></div>
              <div><small>Over 3 years</small><b>{compact(threeYear)}</b></div>
              <div><small>Giving today</small><b>{compact(today)}</b></div>
              <div><small>New retention</small><b>{Math.min(95, retention + lift)}%</b></div>
            </div>
            <p className="lp-calc-note">An illustration, not a forecast: assumes kept donors give your current average and are retained at the new rate in later years.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Counter({ to, suffix = '', run }: { to: number; suffix?: string; run: boolean }) {
  const v = useTween(run ? to : 0, 1400);
  return <>{Math.round(v)}{suffix}</>;
}

function Stats() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.4);
  const items: [number, string, string][] = [
    [6, '', 'signals in every donor score: capacity, recency, frequency, recent giving, engagement and momentum'],
    [100, '%', 'of ledger lines tagged to a fund, and every fund balances on its own'],
    [30, '', 'separately grantable permissions, plus per-workspace access'],
    [0, '', 'card numbers stored. Payments stay with Stripe, Square and PayPal'],
  ];
  return (
    <section className="lp-section lp-soft" style={{ paddingBlock: 'clamp(56px, 8vw, 96px)' }}>
      <div className="lp-wrap lp-stats" ref={ref}>
        {items.map(([n, suf, label], i) => (
          <div key={label} className="lp-stat" data-reveal data-delay={i * 90}><b><Counter to={n} suffix={suf} run={seen} /></b><span>{label}</span></div>
        ))}
      </div>
    </section>
  );
}

function Bento() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-center" data-reveal>
          <p className="lp-eyebrow">Built for the whole team</p>
          <h2 className="lp-h2">Development, finance and leadership, <span className="lp-italic lp-accent">on the same page.</span></h2>
        </div>
        <div className="lp-bento">
          <div className="lp-card span-4 wide dark" data-reveal onPointerMove={glow}>
            <span className="lp-ic lp-ic-gold"><Sparkles size={18} /></span>
            <h3>Ask A.I. Nonprofits</h3>
            <p>Your always-available analyst. Ask about giving, funds, grants or events and get answers with links to the records behind them, limited to what you are allowed to see.</p>
            <div className="lp-chips"><span>“How much is left in the Clean Water fund?”</span><span>“Who are our top 10 lapsed donors?”</span><span>“Draft a thank-you to the Okafors”</span></div>
          </div>
          <div className="lp-card span-2" data-reveal data-delay="90" onPointerMove={glow}>
            <span className="lp-ic lp-ic-green"><Receipt size={18} /></span>
            <h3>Receipts in seconds</h3>
            <p>Year-end and per-gift receipts generated from posted gifts, ready to review and send.</p>
          </div>
          <div className="lp-card span-2" data-reveal onPointerMove={glow}>
            <span className="lp-ic lp-ic-indigo"><Plug size={18} /></span>
            <h3>Connected</h3>
            <p>QuickBooks, Stripe, Square, PayPal, Google and bank feeds, with a sync center that shows every item.</p>
          </div>
          <div className="lp-card span-2" data-reveal data-delay="90" onPointerMove={glow}>
            <span className="lp-ic lp-ic-gold"><Scale size={18} /></span>
            <h3>Board-ready reports</h3>
            <p>Statement of activities, financial position and budget vs. actual, exported to PDF or Excel.</p>
          </div>
          <div className="lp-card span-2" data-reveal data-delay="180" onPointerMove={glow}>
            <span className="lp-ic lp-ic-green"><CalendarDays size={18} /></span>
            <h3>Events &amp; trips</h3>
            <p>Event pages and check-in, plus donor-visit trips planned on a map.</p>
          </div>
          <div className="lp-card span-6 wide" data-reveal onPointerMove={glow} style={{ gridColumn: '1 / -1' }}>
            <span className="lp-ic lp-ic-indigo"><FileText size={18} /></span>
            <h3>Your words, your workspaces</h3>
            <p>Call your teams Ministries, Programs, Chapters or Campuses. Every dashboard, report and permission follows the structure you choose.</p>
            <div className="lp-chips">{['Ministries', 'Programs', 'Chapters', 'Campuses', 'Missions', 'Departments'].map((c) => <span key={c}>{c}</span>)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const items: [React.ElementType, string, string][] = [
    [UserCheck, 'A.I. drafts. People decide.', 'The assistant never sends, posts, approves, moves money, edits donor records or invites users. Every consequential action is a button a person presses.'],
    [Lock, 'Isolated by organization', 'Database-level isolation means one organization can never read another\'s records, even if a query forgets to filter.'],
    [KeyRound, 'Permissions that fit your team', 'Thirty separate permissions, eight built-in roles, custom roles and per-workspace access. Private notes and exports are their own permissions.'],
    [ShieldCheck, 'Financial controls', 'Restricted-fund overdraft blocks, endowment protection, journal approvals with separation of duties and void-not-delete.'],
    [Eye, 'Everything on the record', 'Sign-ins, exports, imports, accounting actions, access changes and A.I. drafts are written to an activity history.'],
    [Landmark, 'No card data, ever', 'Payments are processed by Stripe, Square or PayPal. Integration keys are encrypted and never shown in the browser.'],
  ];
  return (
    <section className="lp-section lp-darkband" id="trust">
      <div className="lp-wrap">
        <div className="lp-center" data-reveal>
          <p className="lp-eyebrow">Trust &amp; safety</p>
          <h2 className="lp-h2" style={{ color: '#fff' }}>Powerful A.I., with <span className="lp-italic lp-accent">people in charge.</span></h2>
          <p className="lp-lede">Donors trust you with their generosity. Every part of the platform is built to keep that trust.</p>
        </div>
        <div className="lp-trust">
          {items.map(([Icon, t, d], i) => (
            <div key={t} className="lp-card" data-reveal data-delay={(i % 3) * 90} onPointerMove={glow}>
              <span className="lp-ic lp-ic-gold"><Icon size={18} /></span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
