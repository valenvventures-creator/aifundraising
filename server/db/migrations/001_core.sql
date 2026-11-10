-- A.I. Nonprofits — core schema
-- Every tenant-owned table carries tenant_id and is protected by row-level security.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  email text, phone text,
  address1 text, city text, region text, postal_code text, country text DEFAULT 'US',
  currency text NOT NULL DEFAULT 'USD',
  locale text NOT NULL DEFAULT 'en-US',
  workspace_term text NOT NULL DEFAULT 'Ministry',       -- Ministry / Organization / Program / Chapter / ...
  workspace_term_plural text NOT NULL DEFAULT 'Ministries',
  invoice_terms text NOT NULL DEFAULT 'Net 30',
  tax_jurisdiction text NOT NULL DEFAULT 'US-IRS',      -- US-IRS | CA-CRA | OTHER
  tax_id text,                                           -- EIN or CRA charity BN
  receipt_settings jsonb NOT NULL DEFAULT '{}',
  faith_based boolean NOT NULL DEFAULT true,
  billing_enabled boolean NOT NULL DEFAULT true,
  fiscal_year_start_month int NOT NULL DEFAULT 1,
  health_rules jsonb NOT NULL DEFAULT '{"activeDays":180,"engagedDays":365,"coolingDays":540,"lapsingDays":730}',
  opportunity_rules jsonb NOT NULL DEFAULT '{}',
  attribution_window_days int NOT NULL DEFAULT 7,
  onboarding jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text,
  is_platform_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, name)
);

CREATE TABLE ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text DEFAULT '#6366f1',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','inactive')),
  all_ministries boolean NOT NULL DEFAULT false,
  ministry_ids uuid[] NOT NULL DEFAULT '{}',
  invited_email text,
  invite_token text UNIQUE,
  seat boolean NOT NULL DEFAULT true,
  notification_prefs jsonb NOT NULL DEFAULT '{"email":true}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE rate_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  hourly_rate numeric(12,2) NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false
);

-- ───────────── Donors / CRM ─────────────
CREATE TABLE donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  donor_type text NOT NULL DEFAULT 'individual'
    CHECK (donor_type IN ('individual','household','foundation','business','church','organization')),
  first_name text, last_name text, org_name text,
  household_name text, spouse_name text,
  email text, phone text,
  address1 text, address2 text, city text, region text, postal_code text, country text,
  lat double precision, lng double precision,
  comm_prefs jsonb NOT NULL DEFAULT '{"email":true,"phone":true,"text":false,"mail":true}',
  notes text,
  private_notes text,                         -- visible only with donors.private_notes
  tags text[] NOT NULL DEFAULT '{}',
  source text,
  owner_user_id uuid REFERENCES users(id),
  custom jsonb NOT NULL DEFAULT '{}',
  capacity_estimate numeric(14,2),            -- optional wealth/capacity indicator
  health_status text NOT NULL DEFAULT 'active',
  health_override text,
  score int NOT NULL DEFAULT 0,
  score_parts jsonb NOT NULL DEFAULT '{}',
  intelligence jsonb NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  merged_into uuid REFERENCES donors(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX donors_tenant_idx ON donors(tenant_id, ministry_id) WHERE NOT archived;
CREATE INDEX donors_email_idx ON donors(tenant_id, lower(email));

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL, description text,
  goal numeric(14,2), starts_on date, ends_on date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Accounting core ─────────────
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','net_assets','revenue','expense')),
  subtype text,
  is_cash boolean NOT NULL DEFAULT false,
  description text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  code text,
  restriction text NOT NULL DEFAULT 'unrestricted'
    CHECK (restriction IN ('unrestricted','purpose','time','permanent')),
  description text,
  revenue_account_id uuid REFERENCES accounts(id),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL, description text,
  goal numeric(14,2), budget numeric(14,2),
  fund_id uuid REFERENCES funds(id),
  campaign_id uuid REFERENCES campaigns(id),
  owner_user_id uuid REFERENCES users(id),
  starts_on date, ends_on date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  entry_date date NOT NULL,
  memo text,
  reference text,
  source text NOT NULL DEFAULT 'manual',   -- manual | gift | expense | bank | payroll | invoice | import | refund
  source_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','pending_approval','posted','void')),
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX je_tenant_date ON journal_entries(tenant_id, entry_date);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  project_id uuid REFERENCES projects(id),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text
);
CREATE INDEX jl_entry ON journal_lines(entry_id);
CREATE INDEX jl_fund ON journal_lines(tenant_id, fund_id);

-- ───────────── Giving ─────────────
CREATE TABLE gift_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recurring_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  donor_id uuid NOT NULL REFERENCES donors(id),
  amount numeric(14,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  fund_id uuid REFERENCES funds(id),
  status text NOT NULL DEFAULT 'active',     -- active | paused | cancelled | failed
  provider text, provider_ref text,
  started_on date, next_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_ref)
);

CREATE TABLE email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  subject text, preview_text text, from_name text,
  blocks jsonb NOT NULL DEFAULT '[]',
  audience_id uuid,
  campaign_id uuid REFERENCES campaigns(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','paused','archived')),
  scheduled_at timestamptz, sent_at timestamptz,
  recipient_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  donor_id uuid NOT NULL REFERENCES donors(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  gift_date date NOT NULL,
  fund_id uuid NOT NULL REFERENCES funds(id),
  campaign_id uuid REFERENCES campaigns(id),
  project_id uuid REFERENCES projects(id),
  email_campaign_id uuid REFERENCES email_campaigns(id),
  gift_type text NOT NULL DEFAULT 'one_time',  -- one_time | recurring | pledge_payment | in_kind | stock | grant | matching | custom
  payment_method text NOT NULL DEFAULT 'check',
  recurring_gift_id uuid REFERENCES recurring_gifts(id),
  batch_id uuid REFERENCES gift_batches(id),
  follow_up_user_id uuid REFERENCES users(id),
  receipt_status text NOT NULL DEFAULT 'pending' CHECK (receipt_status IN ('pending','sent','not_required')),
  thank_you_status text NOT NULL DEFAULT 'pending' CHECK (thank_you_status IN ('pending','sent','not_required')),
  notes text,
  provider text, provider_txn_id text,
  deposit_account_id uuid REFERENCES accounts(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  refunded boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_txn_id)
);
CREATE INDEX gifts_donor ON gifts(tenant_id, donor_id, gift_date DESC);
CREATE INDEX gifts_date ON gifts(tenant_id, gift_date);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gift_id uuid REFERENCES gifts(id),
  donor_id uuid NOT NULL REFERENCES donors(id),
  number text NOT NULL,
  kind text NOT NULL DEFAULT 'single',     -- single | annual
  period_start date, period_end date,
  amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','delivered','corrected','void')),
  jurisdiction text NOT NULL,
  replaces_id uuid REFERENCES receipts(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (tenant_id, number)
);

CREATE TABLE asks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  donor_id uuid NOT NULL REFERENCES donors(id),
  amount numeric(14,2) NOT NULL,
  asked_on date NOT NULL DEFAULT current_date,
  purpose text, status text NOT NULL DEFAULT 'open',  -- open | accepted | declined | deferred
  user_id uuid REFERENCES users(id),
  notes text
);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_txn_id text NOT NULL,
  kind text NOT NULL DEFAULT 'payment',  -- payment | refund | dispute | failure | subscription
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payer_name text, payer_email text,
  status text NOT NULL DEFAULT 'unmatched',  -- matched | unmatched | refunded | disputed | failed | ignored
  gift_id uuid REFERENCES gifts(id),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_txn_id, kind)
);

-- ───────────── Communications & work ─────────────
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  title text NOT NULL, client_name text,
  status text NOT NULL DEFAULT 'open',          -- open | in_progress | waiting | completed | cancelled
  engagement_type text NOT NULL DEFAULT 'hourly', -- hourly | fixed_fee | retainer
  assignee_id uuid REFERENCES users(id),
  due_date date, fixed_fee numeric(14,2), retainer numeric(14,2),
  billed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, contact_name text, email text, phone text, website text,
  focus_areas text, notes text,
  donor_id uuid REFERENCES donors(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  funder_id uuid REFERENCES funders(id),
  title text NOT NULL,
  request_amount numeric(14,2), awarded_amount numeric(14,2),
  deadline date, submitted_on date, decision_on date, report_due date,
  status text NOT NULL DEFAULT 'researching'
    CHECK (status IN ('researching','qualified','preparing','submitted','under_review','awarded','declined','reporting','closed')),
  assignee_id uuid REFERENCES users(id),
  project_id uuid REFERENCES projects(id),
  fund_id uuid REFERENCES funds(id),
  requirements text, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  title text NOT NULL,
  category text,
  rate_type_id uuid REFERENCES rate_types(id),
  due_date date,
  est_hours numeric(8,2), actual_hours numeric(8,2) NOT NULL DEFAULT 0,
  progress int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'todo',   -- todo | in_progress | waiting | completed | custom
  assignee_id uuid REFERENCES users(id),
  notes text, next_step text,
  billable boolean NOT NULL DEFAULT false,
  donor_id uuid REFERENCES donors(id),
  job_id uuid REFERENCES jobs(id),
  grant_id uuid REFERENCES grants(id),
  project_id uuid REFERENCES projects(id),
  created_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  donor_id uuid REFERENCES donors(id),
  user_id uuid REFERENCES users(id),
  type text NOT NULL DEFAULT 'phone',   -- phone | meeting | email | text | video | letter | custom
  direction text NOT NULL DEFAULT 'outbound',
  subject text, body text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  duration_hours numeric(6,2),
  rate_type_id uuid REFERENCES rate_types(id),
  billable boolean NOT NULL DEFAULT false,
  is_private boolean NOT NULL DEFAULT false,
  job_id uuid REFERENCES jobs(id),
  grant_id uuid REFERENCES grants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comms_donor ON communications(tenant_id, donor_id, occurred_at DESC);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  user_id uuid NOT NULL REFERENCES users(id),
  entry_date date NOT NULL,
  hours numeric(6,2) NOT NULL CHECK (hours > 0),
  description text,
  rate_type_id uuid REFERENCES rate_types(id),
  billable boolean NOT NULL DEFAULT false,
  task_id uuid REFERENCES tasks(id),
  job_id uuid REFERENCES jobs(id),
  project_id uuid REFERENCES projects(id),
  grant_id uuid REFERENCES grants(id),
  communication_id uuid REFERENCES communications(id),
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Events ─────────────
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  event_type text NOT NULL DEFAULT 'gathering',  -- conference | seminar | webinar | gathering | fundraiser | other
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  location text, description text,
  capacity int,
  slug text NOT NULL UNIQUE,
  is_public boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'published',  -- draft | published | closed | cancelled
  campaign_id uuid REFERENCES campaigns(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  donor_id uuid REFERENCES donors(id),
  name text NOT NULL, email text, phone text, guests int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'registered',  -- registered | attended | no_show | cancelled
  followed_up boolean NOT NULL DEFAULT false,
  registered_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Email / Reach ─────────────
CREATE TABLE audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL, description text,
  filters jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_campaigns ADD CONSTRAINT ec_aud FOREIGN KEY (audience_id) REFERENCES audiences(id);

CREATE TABLE email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, subject text, blocks jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_campaign_id uuid REFERENCES email_campaigns(id) ON DELETE CASCADE,
  journey_id uuid,
  donor_id uuid REFERENCES donors(id),
  to_email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',  -- queued | delivered | bounced | failed | suppressed
  provider_message_id text,
  error text,
  sent_at timestamptz,
  tracking_token text UNIQUE DEFAULT encode(gen_random_bytes(12),'hex')
);

CREATE TABLE email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_campaign_id uuid REFERENCES email_campaigns(id) ON DELETE CASCADE,
  message_id uuid REFERENCES email_messages(id) ON DELETE CASCADE,
  donor_id uuid REFERENCES donors(id),
  type text NOT NULL,   -- delivered | open | click | bounce | unsubscribe | complaint
  url text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_events_campaign ON email_events(tenant_id, email_campaign_id, type);

CREATE TABLE email_suppressions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email)
);

CREATE TABLE journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  trigger text NOT NULL,   -- first_gift | donor_lapsed | recurring_started | event_registration | donor_created
  mode text NOT NULL DEFAULT 'approval' CHECK (mode IN ('automatic','approval')),
  steps jsonb NOT NULL DEFAULT '[]',   -- [{delayDays, subject, blocks}]
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  donor_id uuid NOT NULL REFERENCES donors(id),
  step_index int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting',  -- waiting | awaiting_approval | completed | cancelled
  next_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, donor_id)
);

-- ───────────── Outreach, AI drafts, trips ─────────────
CREATE TABLE voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  tone text, leader_voice text,
  faith_language text, scripture_usage text,
  urgency int DEFAULT 3, formality int DEFAULT 3, donor_centeredness int DEFAULT 4,
  themes text, words_to_use text, words_to_avoid text,
  faith_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ministry_id)
);

CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  ministry_id uuid REFERENCES ministries(id),
  donor_id uuid REFERENCES donors(id),
  kind text NOT NULL,
  title text,
  content text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  generator text NOT NULL DEFAULT 'template',  -- template | claude
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  city text, region text, postal_code text,
  lat double precision, lng double precision,
  start_date date NOT NULL, end_date date NOT NULL,
  purpose text, radius_miles int NOT NULL DEFAULT 50,
  meetings_per_day int NOT NULL DEFAULT 4,
  est_cost numeric(12,2),
  status text NOT NULL DEFAULT 'planned',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  donor_id uuid NOT NULL REFERENCES donors(id),
  meeting_at timestamptz,
  priority text NOT NULL DEFAULT 'medium',
  suggested_ask numeric(14,2),
  notes text,
  included boolean NOT NULL DEFAULT true,
  UNIQUE (trip_id, donor_id)
);

-- ───────────── Money ─────────────
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL,
  fund_id uuid REFERENCES funds(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  fund_id uuid REFERENCES funds(id),
  project_id uuid REFERENCES projects(id),
  amount numeric(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  provider text NOT NULL DEFAULT 'manual',   -- manual | plaid | csv
  provider_ref text, last4 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  txn_date date NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,   -- positive = deposit, negative = withdrawal
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','posted','matched','excluded','duplicate')),
  category_account_id uuid REFERENCES accounts(id),
  fund_id uuid REFERENCES funds(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reconciled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, external_id)
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL, entity_id uuid,
  filename text NOT NULL, mime text, size int,
  storage_key text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  vendor text NOT NULL,
  expense_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  account_id uuid NOT NULL REFERENCES accounts(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  project_id uuid REFERENCES projects(id),
  payment_account_id uuid NOT NULL REFERENCES accounts(id),
  notes text,
  attachment_id uuid REFERENCES attachments(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  number text NOT NULL,
  customer_name text NOT NULL, customer_email text,
  invoice_date date NOT NULL, due_date date NOT NULL,
  terms text NOT NULL DEFAULT 'Net 30',
  tax_rate numeric(6,3) NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','paid','void')),
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  job_id uuid REFERENCES jobs(id),
  project_id uuid REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  rate_type_id uuid REFERENCES rate_types(id)
);

CREATE TABLE payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  staff_name text NOT NULL,
  user_id uuid REFERENCES users(id),
  pay_date date NOT NULL,
  gross numeric(14,2) NOT NULL, employer_taxes numeric(14,2) NOT NULL DEFAULT 0, benefits numeric(14,2) NOT NULL DEFAULT 0,
  department text,
  account_id uuid NOT NULL REFERENCES accounts(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  source text NOT NULL DEFAULT 'manual',
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weekly_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  period_start date NOT NULL, period_end date NOT NULL,
  content text NOT NULL,
  generator text NOT NULL DEFAULT 'template',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Impact & growth ─────────────
CREATE TABLE impact_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  project_id uuid REFERENCES projects(id),
  fund_id uuid REFERENCES funds(id),
  name text NOT NULL, unit text, target numeric(14,2),
  period_start date, period_end date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE impact_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_id uuid NOT NULL REFERENCES impact_metrics(id) ON DELETE CASCADE,
  value numeric(14,2) NOT NULL,
  entry_date date NOT NULL DEFAULT current_date,
  notes text
);
CREATE TABLE impact_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  project_id uuid REFERENCES projects(id),
  title text NOT NULL, story text NOT NULL,
  beneficiaries int, story_date date DEFAULT current_date,
  attachment_id uuid REFERENCES attachments(id),
  shareable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE growth_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text NOT NULL,
  metric text NOT NULL,  -- giving_total | new_donors | retention_rate | recurring_donors | major_donors
  target numeric(14,2) NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Messages ─────────────
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ministry_id uuid REFERENCES ministries(id),
  name text,
  is_channel boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  last_read_at timestamptz NOT NULL DEFAULT 'epoch',
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Integrations / sync ─────────────
CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,      -- quickbooks | stripe | square | paypal | google | plaid | smtp
  user_id uuid REFERENCES users(id),  -- for per-user connections (google)
  status text NOT NULL DEFAULT 'disconnected', -- disconnected | connected | error
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',
  secrets_enc text,             -- AES-256-GCM encrypted JSON
  last_sync_at timestamptz, last_error text,
  webhook_key text NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  connected_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX integrations_unique ON integrations(tenant_id, provider, coalesce(user_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE integration_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_type text NOT NULL,   -- account | fund | donor | gift | expense | invoice | journal
  internal_id uuid NOT NULL,
  external_id text NOT NULL,
  external_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, entity_type, internal_id)
);

CREATE TABLE sync_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_type text NOT NULL,
  internal_id uuid,
  direction text NOT NULL DEFAULT 'push',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','synced','error','conflict','skipped')),
  idempotency_key text NOT NULL,
  external_id text,
  attempts int NOT NULL DEFAULT 0,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, idempotency_key)
);

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  event_type text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',  -- received | processed | error | ignored
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_event_id)
);

-- ───────────── Platform ─────────────
CREATE TABLE ai_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  question text NOT NULL,
  answer text,
  citations jsonb NOT NULL DEFAULT '[]',
  engine text NOT NULL DEFAULT 'rules',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL, title text NOT NULL, body text, link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, dedupe_key)
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  category text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  entity_type text, entity_id uuid,
  meta jsonb NOT NULL DEFAULT '{}',
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant ON audit_events(tenant_id, created_at DESC);

CREATE TABLE automations (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz, last_status text, last_error text,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE job_queue (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_ready ON job_queue(status, run_at);

CREATE TABLE saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL, name text NOT NULL, filters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  entity text NOT NULL,
  filename text,
  headers text[] NOT NULL DEFAULT '{}',
  rows jsonb NOT NULL DEFAULT '[]',
  mapping jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'uploaded',   -- uploaded | previewed | committed | rolled_back
  result jsonb NOT NULL DEFAULT '{}',
  created_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Row-level security (tenant isolation) ─────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.column_name = 'tenant_id' AND c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
