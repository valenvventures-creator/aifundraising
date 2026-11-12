import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Field, Input, PasswordInput, Select, Checkbox, ErrorBox, Notice } from '../components/ui';
import { dateTime } from '../lib/format';
import { BrandLockup } from '../components/Brand';

function Shell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex flex-col items-center text-center">
          <BrandLockup size="lg" onDark stacked />
        </Link>
        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { reload } = useSession();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <Shell title="Sign in" subtitle="The operating system for nonprofit organizations.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await api.post('/auth/login', { email, password }); await reload(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        {err && <ErrorBox error={err} />}
        <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <div className="-mt-1 text-right"><Link to="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">Forgot password?</Link></div>
        <Button variant="primary" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">New to A.I. Fundraising? <Link to="/signup" className="font-medium text-brand-600 hover:underline">Create your organization</Link></p>
    </Shell>
  );
}

const TERMS: [string, string][] = [['Ministry', 'Ministries'], ['Organization', 'Organizations'], ['Program', 'Programs'], ['Chapter', 'Chapters'], ['Project', 'Projects'], ['Campus', 'Campuses'], ['Mission', 'Missions'], ['Department', 'Departments']];

export function OrgFields({ v, set }: { v: any; set: (k: string, x: any) => void }) {
  return (
    <>
      <Field label="Organization name"><Input value={v.orgName ?? ''} onChange={(e) => set('orgName', e.target.value)} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Call your workspaces"><Select value={v.workspaceTerm ?? 'Ministry'} onChange={(e) => { const t = TERMS.find((x) => x[0] === e.target.value)!; set('workspaceTerm', t[0]); set('workspaceTermPlural', t[1]); }} options={TERMS.map(([s, p]) => ({ value: s, label: p }))} /></Field>
        <Field label="Country"><Select value={v.country ?? 'US'} onChange={(e) => { set('country', e.target.value); set('currency', e.target.value === 'CA' ? 'CAD' : e.target.value === 'GB' ? 'GBP' : e.target.value === 'AU' ? 'AUD' : 'USD'); }} options={[{ value: 'US', label: 'United States' }, { value: 'CA', label: 'Canada' }, { value: 'GB', label: 'United Kingdom' }, { value: 'AU', label: 'Australia' }, { value: 'OTHER', label: 'Other' }]} /></Field>
      </div>
      <Checkbox label="We are a faith-based organization (enables optional faith language in writing tools)" checked={v.faithBased ?? true} onChange={(e) => set('faithBased', e.target.checked)} />
    </>
  );
}

export function Signup() {
  const { reload } = useSession();
  const [v, setV] = useState<any>({ workspaceTerm: 'Ministry', workspaceTermPlural: 'Ministries', faithBased: true, country: 'US', currency: 'USD' });
  const set = (k: string, x: any) => setV((o: any) => ({ ...o, [k]: x }));
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  return (
    <Shell title="Create your organization" subtitle="Start your nonprofit operating system — fundraising, accounting, work and impact in one place.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); const bad = passwordProblem(v.password ?? '', v.confirm ?? ''); if (bad) { setErr(bad); setBusy(false); return; } try { const { confirm, ...body } = v; await api.post('/auth/signup', body); await reload(); nav('/'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        {err && <ErrorBox error={err} />}
        <Field label="Your name"><Input value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Work email"><Input type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} required /></Field>
        <PasswordPair password={v.password ?? ''} confirm={v.confirm ?? ''} onPassword={(x) => set('password', x)} onConfirm={(x) => set('confirm', x)} />
        <OrgFields v={v} set={set} />
        <Button variant="primary" className="w-full" loading={busy}>Create organization</Button>
      </form>
      <p className="mt-3 text-center text-xs text-slate-400">By creating an account you agree to the <Link to="/terms" className="underline hover:text-slate-600">End-User License Agreement</Link> and <Link to="/privacy" className="underline hover:text-slate-600">Privacy Policy</Link>.</p>
      <p className="mt-4 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
    </Shell>
  );
}

export function NewOrganization() {
  const { reload } = useSession(); const nav = useNavigate();
  const [v, setV] = useState<any>({ workspaceTerm: 'Ministry', workspaceTermPlural: 'Ministries', faithBased: true, country: 'US', currency: 'USD' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-2xl font-bold">New organization</h1>
      <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api.post('/auth/organizations', v); await reload(); nav('/'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        {err && <ErrorBox error={err} />}
        <OrgFields v={v} set={(k, x) => setV((o: any) => ({ ...o, [k]: x }))} />
        <Notice>Each organization is a separate, isolated account with its own donors, books and team.</Notice>
        <Button variant="primary" loading={busy}>Create organization</Button>
      </form>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState<null | boolean>(null);
  return (
    <Shell title="Forgot your password?" subtitle="Enter your email and we'll send a link to choose a new one. The link works for 30 minutes.">
      {sent === true && <Notice>If an account exists for <b>{email}</b>, a reset link is on its way. Check your inbox (and spam folder).</Notice>}
      {sent === false && <Notice tone="warn">Email delivery isn't set up on this site yet, so reset links can't be sent. Ask your administrator to add RESEND_API_KEY and EMAIL_FROM in Netlify, or to reset your access from Admin &amp; Access.</Notice>}
      {sent === null && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await api.post('/auth/forgot', { email }); setSent(Boolean(r.emailConfigured)); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        {err && <ErrorBox error={err} />}
        <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Button variant="primary" className="w-full" loading={busy}>Send reset link</Button>
      </form>}
      <p className="mt-4 text-center text-sm text-slate-500"><Link to="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link></p>
    </Shell>
  );
}

export function ResetPassword() {
  const { token } = useParams(); const nav = useNavigate();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  return (
    <Shell title="Choose a new password" subtitle="After saving, sign in with your new password. Other signed-in sessions are signed out.">
      {done ? <><Notice>Your password has been changed.</Notice><Button variant="primary" className="mt-4 w-full" onClick={() => nav('/login')}>Sign in</Button></> :
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const bad = passwordProblem(password, confirm); if (bad) { setErr(bad); return; } setBusy(true); setErr(null); try { await api.post(`/auth/reset/${token}`, { password }); setDone(true); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
          {err && <ErrorBox error={err} />}
          <PasswordPair label="New password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          <Button variant="primary" className="w-full" loading={busy}>Save new password</Button>
        </form>}
      <p className="mt-4 text-center text-sm text-slate-500"><Link to="/forgot-password" className="font-medium text-brand-600 hover:underline">Request a new link</Link></p>
    </Shell>
  );
}

export function AcceptInvite() {
  const { token } = useParams(); const { reload } = useSession(); const nav = useNavigate();
  const [inv, setInv] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/auth/invite/${token}`).then(setInv).catch((e) => setErr(e.message)); }, [token]);
  return (
    <Shell title={inv ? `Join ${inv.org}` : 'Accept invitation'} subtitle={inv ? `Invitation for ${inv.invited_email}` : undefined}>
      {err && <ErrorBox error={err} />}
      {inv && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const bad = passwordProblem(password, confirm); if (bad) { setErr(bad); return; } setBusy(true); try { await api.post(`/auth/invite/${token}`, { name, password }); await reload(); nav('/'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <PasswordPair label="Choose a password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <Button variant="primary" className="w-full" loading={busy}>Accept & continue</Button>
      </form>}
    </Shell>
  );
}

/** Public event registration page (no login). Registrants are matched/created as constituents. */
export function PublicEvent() {
  const { slug } = useParams();
  const [e, setE] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<any>({ guests: 0 }); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/public/events/${slug}`).then(async (r) => (r.ok ? setE(await r.json()) : setErr((await r.json()).error))).catch(() => setErr('Could not load event.')); }, [slug]);
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
        {err && <ErrorBox error={err} />}
        {e && <>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">{e.org} · {e.event_type}</div>
          <h1 className="mt-1 text-2xl font-bold">{e.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{dateTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</p>
          {e.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{e.description}</p>}
          {done ? <Notice>You're registered! A confirmation will follow from {e.org}.</Notice> : e.full ? <Notice tone="warn">This event is full.</Notice> :
            <form className="mt-6 space-y-3" onSubmit={async (ev) => { ev.preventDefault(); setBusy(true); setErr(null); const r = await fetch(`/api/public/events/${slug}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, guests: Number(f.guests || 0) }) }); setBusy(false); if (r.ok) setDone(true); else setErr((await r.json()).error); }}>
              <Field label="Full name"><Input value={f.name ?? ''} onChange={(x) => setF({ ...f, name: x.target.value })} required /></Field>
              <Field label="Email"><Input type="email" value={f.email ?? ''} onChange={(x) => setF({ ...f, email: x.target.value })} required /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Phone"><Input value={f.phone ?? ''} onChange={(x) => setF({ ...f, phone: x.target.value })} /></Field><Field label="Additional guests"><Input type="number" min={0} max={20} value={f.guests} onChange={(x) => setF({ ...f, guests: x.target.value })} /></Field></div>
              <input type="text" name="website" className="hidden" tabIndex={-1} autoComplete="off" onChange={(x) => setF({ ...f, website: x.target.value })} />
              <Button variant="primary" className="w-full" loading={busy}>Register</Button>
            </form>}
        </>}
        <p className="mt-6 text-center text-xs text-slate-400">Powered by A.I. Fundraising</p>
      </div>
    </div>
  );
}

export function passwordProblem(password: string, confirm: string) {
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

/** Password + confirmation with show/hide toggles and live match feedback. */
export function PasswordPair({ label = 'Password', password, confirm, onPassword, onConfirm }: { label?: string; password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void }) {
  const mismatch = confirm.length > 0 && confirm !== password;
  const ok = confirm.length > 0 && confirm === password && password.length >= 10;
  return (
    <>
      <Field label={label} hint={password.length > 0 && password.length < 10 ? `${10 - password.length} more character${password.length === 9 ? '' : 's'} needed` : 'At least 10 characters'}>
        <PasswordInput autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} required minLength={10} />
      </Field>
      <Field label="Confirm password" error={mismatch ? 'Passwords do not match.' : undefined} hint={ok ? '✓ Passwords match' : undefined}>
        <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} required aria-invalid={mismatch} />
      </Field>
    </>
  );
}
