-- Grant application workspace: one record per application the organization is preparing.
CREATE TABLE IF NOT EXISTS grant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES grants(id) ON DELETE SET NULL,
  country text NOT NULL CHECK (country IN ('US','CA')),
  title text NOT NULL,
  funder text,
  source text,               -- e.g. grants.gov, canada.ca, manual
  source_id text,
  source_url text,
  deadline date,
  status text NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting','in_review','ready','submitted','archived')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachments jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grant_applications_tenant_idx ON grant_applications(tenant_id, updated_at DESC);
ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grant_applications;
CREATE POLICY tenant_isolation ON grant_applications USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
