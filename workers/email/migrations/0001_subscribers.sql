-- Subscribers: one row per reader. Tokens are stored only as SHA-256 hashes; the raw token lives in the email link.
CREATE TABLE subscribers (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- where confirm and stop mail goes
  kindle        TEXT NOT NULL,             -- name@kindle.com
  status        TEXT NOT NULL CHECK (status IN ('pending', 'active', 'stopped')),
  confirm_hash  TEXT,                      -- cleared on confirm
  stop_hash     TEXT NOT NULL,             -- permanent per subscriber, rotates on re-subscribe
  variant       TEXT,                      -- homepage copy test arm at sign-up (js/ab.js)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at  TEXT,
  last_issue    INTEGER                    -- newest issue delivered, so a cron retry never double-sends
);
CREATE INDEX subscribers_status ON subscribers (status);
