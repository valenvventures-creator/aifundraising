/**
 * Pages Intuit sends people to:
 *  - /quickbooks/launch       Launch URL: after authenticating from QuickBooks, open the right place in the app.
 *  - /quickbooks/connect      Connect/Reconnect URL: start (or restart) the QuickBooks connection.
 *  - /quickbooks/disconnected Disconnect URL: confirm the disconnection and offer to reconnect (public page).
 */
import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Link2, Loader2, Unplug, AlertTriangle } from 'lucide-react';
import { api, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Button } from '../components/ui';
import { BrandLockup } from '../components/Brand';

function Frame({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-900 to-brand-800 px-4 py-10">
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-6 flex justify-center"><BrandLockup size="md" onDark /></Link>
        <div className="rounded-2xl bg-white p-6 text-center shadow-2xl sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">{icon}</div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">{title}</h1>
          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Launch URL (signed in): go to Sync Center when QuickBooks is connected, otherwise Integrations. */
export function QuickBooksLaunch() {
  const { data, error } = useApi<any>('/integrations');
  if (error) return <Navigate to="/" replace />;
  if (!data) return <Frame icon={<Loader2 className="h-7 w-7 animate-spin" />} title="Opening A.I. Fundraising…"><p>One moment.</p></Frame>;
  const list = Array.isArray(data) ? data : data.providers ?? data.rows ?? [];
  const qbo = list.find((p: any) => p.key === 'quickbooks' || p.provider === 'quickbooks');
  const connected = qbo && (qbo.status === 'connected' || qbo.connected === true || qbo.integration?.status === 'connected');
  return <Navigate to={connected ? '/money/accounting/sync' : '/money/accounting/integrations'} replace />;
}

/** Connect/Reconnect URL (signed in): send the person straight to Intuit to approve the connection. */
export function QuickBooksConnect() {
  const { can } = useSession();
  const [error, setError] = useState<string | null>(null);
  const allowed = can('integrations.manage');
  useEffect(() => {
    if (!allowed) return;
    api.get('/integrations/quickbooks/connect').then((r: any) => { window.location.href = r.url; }).catch((e) => setError(e.message));
  }, [allowed]);
  if (!allowed) return (
    <Frame icon={<AlertTriangle className="h-7 w-7" />} title="Ask an administrator to connect QuickBooks">
      <p>Your role can’t connect integrations. An administrator or finance lead in your organization can connect QuickBooks from Money › Accounting › Integrations.</p>
      <Link to="/"><Button variant="primary" className="mt-2">Go to A.I. Fundraising</Button></Link>
    </Frame>
  );
  if (error) return (
    <Frame icon={<AlertTriangle className="h-7 w-7" />} title="QuickBooks couldn’t be connected">
      <p>{error}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1"><Button onClick={() => window.location.reload()}>Try again</Button><Link to="/money/accounting/integrations"><Button variant="primary">Go to Integrations</Button></Link></div>
    </Frame>
  );
  return <Frame icon={<Link2 className="h-7 w-7" />} title="Connecting to QuickBooks…"><p>Taking you to Intuit to approve the connection. You’ll come straight back here afterwards.</p><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></Frame>;
}

/** Disconnect URL (public): shown after someone disconnects A.I. Fundraising from inside QuickBooks. */
export function QuickBooksDisconnected() {
  const { me, can, loading } = useSession();
  const canManage = Boolean(me?.tenant) && can('integrations.manage');
  const { data } = useApi<any>(canManage ? '/integrations' : null);
  const [cleared, setCleared] = useState(false); const [busy, setBusy] = useState(false);
  const list = data ? (Array.isArray(data) ? data : data.providers ?? data.rows ?? []) : [];
  const qbo = list.find((p: any) => p.key === 'quickbooks' || p.provider === 'quickbooks');
  const stillConnected = qbo && (qbo.status === 'connected' || qbo.connected === true || qbo.integration?.status === 'connected');
  useEffect(() => { const t = document.title; document.title = 'QuickBooks disconnected · A.I. Fundraising'; return () => { document.title = t; }; }, []);
  return (
    <Frame icon={<Unplug className="h-7 w-7" />} title="QuickBooks has been disconnected">
      <p>A.I. Fundraising no longer has access to your QuickBooks Online company. Nothing more will be sent to QuickBooks, and your records in A.I. Fundraising are unchanged.</p>
      <p>Entries you post while disconnected stay in A.I. Fundraising. If you reconnect later, you can send them from the Sync Center.</p>
      {!loading && canManage && stillConnected && !cleared && (
        <div className="rounded-xl bg-amber-50 p-3 text-left text-amber-800">
          A.I. Fundraising still shows QuickBooks as connected for your organization.
          <Button size="sm" variant="primary" className="mt-2 w-full" loading={busy} onClick={async () => { setBusy(true); try { await api.post('/integrations/quickbooks/disconnect'); setCleared(true); } finally { setBusy(false); } }}>Finish disconnecting in A.I. Fundraising</Button>
        </div>
      )}
      {cleared && <p className="flex items-center justify-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Disconnected in A.I. Fundraising too.</p>}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Link to="/quickbooks/connect"><Button variant="primary" icon={<Link2 className="h-4 w-4" />}>Reconnect QuickBooks</Button></Link>
        <Link to={me ? '/money/accounting/integrations' : '/login'}><Button>{me ? 'Go to Integrations' : 'Sign in'}</Button></Link>
      </div>
      <p className="pt-2 text-xs text-slate-400">Questions? See our <Link to="/privacy" className="underline">Privacy Policy</Link> for how QuickBooks data is handled and deleted.</p>
    </Frame>
  );
}
