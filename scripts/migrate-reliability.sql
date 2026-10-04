-- Run once on an existing pre-reliability database, before deploying the Worker.
ALTER TABLE posts ADD COLUMN observed_at TEXT;
UPDATE posts SET observed_at = updated_at WHERE observed_at IS NULL;
-- Historic Passkey login was not an official content confirmation.
UPDATE posts SET is_verified = 0;
CREATE TABLE IF NOT EXISTS mutation_receipts (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_coordinates ON posts(lat, lng);

-- Failed registration options must not reserve the administrator role.
UPDATE users SET role = 'user' WHERE role = 'admin' AND NOT EXISTS (SELECT 1 FROM credentials WHERE user_id = users.id);

CREATE TABLE IF NOT EXISTS post_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  post_title TEXT NOT NULL,
  device_cookie_id TEXT NOT NULL REFERENCES device_sessions(id),
  reason TEXT NOT NULL CHECK(reason IN ('outdated','incorrect','spam','privacy')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution TEXT,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(post_id, device_cookie_id)
);
CREATE INDEX IF NOT EXISTS idx_post_reports_status ON post_reports(status, created_at);
