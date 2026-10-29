-- Notifications: an in-app inbox per user, phone push subscriptions per device, and per-user choices.

-- One row per device that turned on notifications (a browser's Web Push subscription).
CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,           -- the push service URL for this device
  p256dh      TEXT NOT NULL,                  -- the device's public key (base64url)
  auth        TEXT NOT NULL,                  -- the device's auth secret (base64url)
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  last_ok_at  TEXT                            -- last successful delivery
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- The inbox. Text is stored as keys + params so each person reads it in their own language.
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                 -- e.g. 'booking_new', 'job_note'
  title_key    TEXT NOT NULL,
  body_key     TEXT NOT NULL,
  params_json  TEXT NOT NULL DEFAULT '{}',
  link         TEXT NOT NULL,                 -- dashboard route, e.g. '#/bookings/bkg_...'
  tag          TEXT,                          -- groups updates about the same record on the phone
  created_at   TEXT NOT NULL,
  read_at      TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at);

-- Choices per user and group of events; no row means "on".
CREATE TABLE notification_prefs (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind)
);
