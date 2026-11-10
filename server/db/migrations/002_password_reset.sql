-- Forgot-password links (30 minutes, single use). Only a SHA-256 hash of each token is stored.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Sessions issued before a password change stop working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
