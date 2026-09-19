-- Add email verification columns to existing tossa-db installs.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN pending_email TEXT;
ALTER TABLE users ADD COLUMN email_verify_code_hash TEXT;
ALTER TABLE users ADD COLUMN email_verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires_at TEXT;
ALTER TABLE users ADD COLUMN email_verify_sent_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email != '';
