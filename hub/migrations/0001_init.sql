-- M&K Hub data model. This file is the contract every module builds against:
-- modules own their tables' behaviour, but the shapes live here so they connect cleanly.
-- Conventions: ids are prefixed text ids (usr_, cus_, veh_, bkg_, job_, ...);
-- timestamps are ISO-8601 UTC strings; money is integer pence; booleans are 0/1.

-- ---------- people and access (module: auth, system) ----------
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  totp_secret_enc  TEXT,                 -- AES-GCM encrypted base32 secret
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,          -- SHA-256 of the cookie token; the token itself is never stored
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_ok        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE auth_attempts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind  TEXT NOT NULL,                      -- 'password' | 'totp' | 'public_booking'
  key   TEXT NOT NULL,                      -- email, user id or ip
  ok    INTEGER NOT NULL,
  at    TEXT NOT NULL
);
CREATE INDEX idx_attempts_lookup ON auth_attempts(kind, key, at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  user_id    TEXT,                          -- null for system or public actions
  action     TEXT NOT NULL,                 -- e.g. 'booking.create'
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT                           -- JSON
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                      -- JSON
);

CREATE TABLE counters (
  name   TEXT PRIMARY KEY,                  -- 'booking_ref', 'job_ref'
  value  INTEGER NOT NULL
);

-- ---------- customers and vehicles (modules: customers, vehicles) ----------
CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,                         -- E.164, e.g. +447700900123
  email       TEXT COLLATE NOCASE,
  notes       TEXT,
  source      TEXT NOT NULL DEFAULT 'other' CHECK (source IN ('website','phone','social','walk_in','other')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);

CREATE TABLE vehicles (
  id            TEXT PRIMARY KEY,
  reg           TEXT NOT NULL UNIQUE,       -- normalised: upper case, no spaces
  vin           TEXT,
  make          TEXT,
  model         TEXT,
  colour        TEXT,
  fuel_type     TEXT,
  year          INTEGER,
  engine_cc     INTEGER,
  mot_status    TEXT,
  mot_expiry    TEXT,
  tax_status    TEXT,
  tax_due       TEXT,
  last_mileage  INTEGER,
  dvla_json     TEXT,                       -- raw lookup responses, kept for reference
  dvsa_json     TEXT,
  looked_up_at  TEXT,
  customer_id   TEXT REFERENCES customers(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);

-- ---------- bookings (module: bookings) ----------
CREATE TABLE bookings (
  id               TEXT PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,    -- human reference, e.g. MK-1042
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  vehicle_id       TEXT REFERENCES vehicles(id),
  service          TEXT NOT NULL CHECK (service IN ('remap','keys','coding','modules','diagnostics','servicing','other')),
  description      TEXT,
  preferred_date   TEXT,                    -- YYYY-MM-DD the customer asked for
  scheduled_start  TEXT,                    -- confirmed slot (ISO datetime)
  scheduled_end    TEXT,
  location         TEXT NOT NULL DEFAULT 'workshop' CHECK (location IN ('workshop','mobile')),
  address          TEXT,
  status           TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','in_progress','completed','cancelled','no_show')),
  source           TEXT NOT NULL DEFAULT 'other' CHECK (source IN ('website','phone','social','walk_in','other')),
  lead_id          TEXT,                    -- set when a social lead was converted
  internal_notes   TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_start ON bookings(scheduled_start);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);

-- ---------- jobs (module: jobs, ai) ----------
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,       -- e.g. J-2031
  booking_id    TEXT REFERENCES bookings(id),
  customer_id   TEXT REFERENCES customers(id),
  vehicle_id    TEXT REFERENCES vehicles(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_parts','completed','cancelled')),
  assigned_to   TEXT REFERENCES users(id),
  mileage       INTEGER,
  started_at    TEXT,
  completed_at  TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_booking ON jobs(booking_id);

CREATE TABLE job_notes (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_job_notes_job ON job_notes(job_id);

CREATE TABLE job_files (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  caption       TEXT,
  uploaded_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_job_files_job ON job_files(job_id);

CREATE TABLE ai_suggestions (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,             -- model id, or 'rules' for the offline fallback
  response_json  TEXT NOT NULL,
  feedback       TEXT CHECK (feedback IN ('helpful','not_helpful')),
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_ai_job ON ai_suggestions(job_id);

-- ---------- social and leads (modules: social, leads) ----------
CREATE TABLE social_accounts (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL CHECK (platform IN ('instagram','facebook','youtube','tiktok','google')),
  handle            TEXT NOT NULL,
  external_id       TEXT NOT NULL,          -- page id, IG user id, channel id, ...
  token_enc         TEXT,                   -- AES-GCM encrypted access token
  token_expires_at  TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reauth','disabled')),
  last_polled_at    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (platform, external_id)
);

CREATE TABLE social_posts (
  id            TEXT PRIMARY KEY,
  caption       TEXT NOT NULL,
  media_r2_key  TEXT,
  media_type    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','publishing','published','partial','failed')),
  scheduled_at  TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE social_post_targets (
  id                TEXT PRIMARY KEY,
  post_id           TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES social_accounts(id),
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','publishing','published','failed')),
  external_post_id  TEXT,
  error             TEXT,
  published_at      TEXT
);
CREATE INDEX idx_targets_post ON social_post_targets(post_id);

CREATE TABLE comments (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL REFERENCES social_accounts(id),
  platform            TEXT NOT NULL,
  external_id         TEXT NOT NULL,
  external_post_id    TEXT,
  parent_external_id  TEXT,
  author_name         TEXT,
  author_handle       TEXT,
  body                TEXT NOT NULL,
  posted_at           TEXT,
  fetched_at          TEXT NOT NULL,
  triaged             INTEGER NOT NULL DEFAULT 0,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_comments_triaged ON comments(triaged);

CREATE TABLE leads (
  id                 TEXT PRIMARY KEY,
  comment_id         TEXT REFERENCES comments(id),
  platform           TEXT NOT NULL,
  author_name        TEXT,
  author_handle      TEXT,
  summary            TEXT NOT NULL,
  service            TEXT,                  -- same values as bookings.service
  make               TEXT,
  model              TEXT,
  urgency            TEXT CHECK (urgency IN ('low','normal','high')),
  score              INTEGER NOT NULL DEFAULT 0,   -- 0-100
  suggested_reply    TEXT,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','booked','dismissed')),
  booking_id         TEXT REFERENCES bookings(id),
  reply_external_id  TEXT,
  replied_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_leads_status ON leads(status);

-- ---------- outgoing messages (module: notifications) ----------
CREATE TABLE outbox (
  id            TEXT PRIMARY KEY,
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp','sms')),
  to_addr       TEXT NOT NULL,
  template      TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  entity        TEXT,
  entity_id     TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT
);
CREATE INDEX idx_outbox_status ON outbox(status);

INSERT INTO counters (name, value) VALUES ('booking_ref', 1000), ('job_ref', 2000);
