import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Spinner, Empty, LinkButton } from './components/ui';
import { Layout } from './components/Layout';
import { Login, Signup, NewOrganization, AcceptInvite, PublicEvent, ForgotPassword, ResetPassword } from './pages/Auth';
import { Home, WorkspaceHome } from './pages/Home';
import { DonorsShell, GivingShell, GivingOverviewRoute, DonorList, ReceiptsPage, GrowthAudit, GivingReports } from './pages/Donors';
import { DonorProfile, DonorBrief, DonorPortal } from './pages/DonorProfile';
import { Next100K, CallLists, Recovery, ActionPlan, Trips, TripDetail, Outreach, Campaigns, CampaignDetail } from './pages/Fundraising';
import { Grants, GrantDetail, Projects, ProjectDetail, Events, EventDetail } from './pages/Programs';
import { ReachShell, EmailCampaigns, EmailBuilder, Audiences, Journeys, Templates, Grow, EmailAnalytics, ReachSettings } from './pages/Reach';
import { MoneyShell, AccountingShell, AccountingOverview, Transactions, PostGiving, Spend, Funds, FundLedger, ChartOfAccounts, Budgets, BudgetDetail, BankFeed, GivingLedger, AccountingSettings, Payroll, Invoices, InvoiceDetail, Reports, Updates } from './pages/Money';
import { IntegrationsPage, SyncCenter } from './pages/Integrations';
import { WorkShell, Tasks, ClientWork, CalendarPage, Communications, TimeLog } from './pages/Work';
import { Growth, Impact, Messages, Admin, Ask } from './pages/Platform';
import { Settings } from './pages/Settings';
import { Landing } from './pages/Landing';
import { WorkOverview } from './pages/WorkHub';
import { GrantApplicationEditor } from './pages/GrantFinder';

function Guard({ perm, children }: { perm: string | string[]; children: React.ReactNode }) {
  const { can } = useSession();
  const ok = (Array.isArray(perm) ? perm : [perm]).some((p) => can(p));
  return ok ? <>{children}</> : <Empty title="You don't have access to this area">Your role doesn't include this module. Ask an administrator if you need access.</Empty>;
}
function DonorsIndex() {
  const { can } = useSession();
  const first = can('donors.read') ? 'giving' : can('grants.read') ? 'grants' : can('projects.read') ? 'projects' : can('email.read') ? 'email' : 'events';
  return <Navigate to={`/donors/${first}`} replace />;
}

function AuthedApp() {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loc.pathname.startsWith('/e/')) return <Routes><Route path="/e/:slug" element={<PublicEvent />} /></Routes>;
  if (loc.pathname.startsWith('/invite/')) return <Routes><Route path="/invite/:token" element={<AcceptInvite />} /></Routes>;
  if (loc.pathname.startsWith('/reset-password/')) return <Routes><Route path="/reset-password/:token" element={<ResetPassword />} /></Routes>;
  if (loc.pathname === '/forgot-password') return <ForgotPassword />;
  if (loading) return <Spinner label="Loading A.I. Fundraising…" />;
  if (!me) return <Routes><Route path="/" element={<Landing />} /><Route path="/signup" element={<Signup />} /><Route path="*" element={<Login />} /></Routes>;
  if (!me.tenant) return <div className="mx-auto max-w-xl p-8"><NewOrganization /></div>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="workspaces/:id" element={<WorkspaceHome />} />
        <Route path="new-organization" element={<NewOrganization />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="signup" element={<Navigate to="/" replace />} />
        <Route path="donors" element={<DonorsShell />}>
          <Route index element={<DonorsIndex />} />
          <Route path="giving" element={<Guard perm="donors.read"><GivingShell /></Guard>}>
            <Route index element={<GivingOverviewRoute />} />
            <Route path="donors" element={<DonorList />} />
            <Route path="priorities" element={<Next100K />} />
            <Route path="priorities/calls" element={<CallLists />} />
            <Route path="priorities/recovery" element={<Recovery />} />
            <Route path="priorities/plan" element={<ActionPlan />} />
            <Route path="trips" element={<Trips />} />
            <Route path="trips/:id" element={<TripDetail />} />
            <Route path="outreach" element={<Outreach />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="audit" element={<GrowthAudit />} />
            <Route path="reports" element={<GivingReports />} />
            <Route path="receipts" element={<ReceiptsPage />} />
          </Route>
          <Route path="grants" element={<Guard perm="grants.read"><Grants /></Guard>} />
          <Route path="grants/applications/:id" element={<Guard perm="grants.read"><GrantApplicationEditor /></Guard>} />
          <Route path="grants/:id" element={<Guard perm="grants.read"><GrantDetail /></Guard>} />
          <Route path="projects" element={<Guard perm="projects.read"><Projects /></Guard>} />
          <Route path="projects/:id" element={<Guard perm="projects.read"><ProjectDetail /></Guard>} />
          <Route path="email" element={<Guard perm="email.read"><ReachShell /></Guard>}>
            <Route index element={<Navigate to="campaigns" replace />} />
            <Route path="campaigns" element={<EmailCampaigns />} />
            <Route path="campaigns/:id" element={<EmailBuilder />} />
            <Route path="audiences" element={<Audiences />} />
            <Route path="journeys" element={<Journeys />} />
            <Route path="templates" element={<Templates />} />
            <Route path="grow" element={<Grow />} />
            <Route path="analytics" element={<EmailAnalytics />} />
            <Route path="settings" element={<ReachSettings />} />
          </Route>
          <Route path="events" element={<Guard perm="events.read"><Events /></Guard>} />
          <Route path="events/:id" element={<Guard perm="events.read"><EventDetail /></Guard>} />
        </Route>
        <Route path="donors/:id" element={<Guard perm="donors.read"><DonorProfile /></Guard>} />
        <Route path="donors/:id/brief" element={<Guard perm="donors.read"><DonorBrief /></Guard>} />
        <Route path="donors/:id/portal" element={<Guard perm="donors.read"><DonorPortal /></Guard>} />
        <Route path="money" element={<Guard perm="finance.read"><MoneyShell /></Guard>}>
          <Route index element={<Navigate to="accounting" replace />} />
          <Route path="accounting" element={<AccountingShell />}>
            <Route index element={<AccountingOverview />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="post-giving" element={<PostGiving />} />
            <Route path="snap" element={<Spend snap />} />
            <Route path="spend" element={<Spend />} />
            <Route path="funds" element={<Funds />} />
            <Route path="funds/:id" element={<FundLedger />} />
            <Route path="accounts" element={<ChartOfAccounts />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="budgets/:id" element={<BudgetDetail />} />
            <Route path="bank" element={<BankFeed />} />
            <Route path="journals" element={<Transactions journalsMode />} />
            <Route path="giving" element={<GivingLedger />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="sync" element={<SyncCenter />} />
            <Route path="settings" element={<AccountingSettings />} />
          </Route>
          <Route path="payroll" element={<Payroll />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="updates" element={<Guard perm="reports.read"><Updates /></Guard>} />
        </Route>
        <Route path="work" element={<Guard perm="work.read"><WorkShell /></Guard>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<WorkOverview />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="client-work" element={<ClientWork />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="communications" element={<Communications />} />
          <Route path="time" element={<TimeLog />} />
        </Route>
        <Route path="growth" element={<Guard perm="donors.read"><Growth /></Guard>} />
        <Route path="impact" element={<Guard perm="impact.read"><Impact /></Guard>} />
        <Route path="messages" element={<Guard perm="messages.use"><Messages /></Guard>} />
        <Route path="messages/:id" element={<Guard perm="messages.use"><Messages /></Guard>} />
        <Route path="admin" element={<Guard perm={['admin.users', 'audit.read']}><Admin /></Guard>} />
        <Route path="settings" element={<Settings />} />
        <Route path="ask" element={<Guard perm="ai.ask"><Ask /></Guard>} />
        <Route path="*" element={<Empty title="Page not found" action={<LinkButton to="/" variant="primary">Go home</LinkButton>} />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider><ToastProvider><AuthedApp /></ToastProvider></SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
