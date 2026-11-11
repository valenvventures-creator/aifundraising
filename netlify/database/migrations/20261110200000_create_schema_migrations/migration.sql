-- Provisions Netlify Database for A.I. Fundraising on deploy (same convention as the other
-- Thought Authorities sites). The app creates and upgrades its remaining tables itself on
-- first use, from server/db/migrations, and records them in this table.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
