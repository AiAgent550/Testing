-- Job videos and email-sized photo previews, invoices and quotes, customer emails and private media links.

-- ---------- job media (module: jobs) ----------
ALTER TABLE job_files ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video'));
ALTER TABLE job_files ADD COLUMN preview_key TEXT;      -- R2 key of a ~1600px JPEG made on the phone (photos only)
ALTER TABLE job_files ADD COLUMN preview_size INTEGER;
ALTER TABLE job_files ADD COLUMN filename TEXT;

-- ---------- invoices and quotes (module: invoices) ----------
CREATE TABLE documents (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('invoice','quote')),
  number          TEXT NOT NULL UNIQUE,              -- INV-1050, QUO-1001
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','void','accepted','declined')),
  job_id          TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  bill_name       TEXT NOT NULL,
  bill_email      TEXT,
  bill_phone      TEXT,
  bill_address    TEXT,
  vehicle_reg     TEXT,
  vehicle_desc    TEXT,
  po_number       TEXT,
  issue_date      TEXT NOT NULL,                     -- YYYY-MM-DD
  due_date        TEXT,                              -- YYYY-MM-DD; NULL = due on receipt (quotes: valid until)
  notes           TEXT,                              -- printed on the document
  total_pence     INTEGER NOT NULL DEFAULT 0,
  paid_pence      INTEGER NOT NULL DEFAULT 0,
  quote_id        TEXT REFERENCES documents(id) ON DELETE SET NULL,  -- invoice made from this quote
  sent_at         TEXT,
  paid_at         TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_documents_job ON documents(job_id);
CREATE INDEX idx_documents_kind_status ON documents(kind, status, issue_date);

CREATE TABLE document_lines (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'part' CHECK (kind IN ('part','labour','other')),
  description  TEXT NOT NULL,
  qty          REAL NOT NULL DEFAULT 1,
  unit         TEXT,                                 -- "L", "set"...
  unit_pence   INTEGER NOT NULL,                     -- price charged per unit
  cost_pence   INTEGER,                              -- what we paid (never printed)
  markup_pct   REAL                                  -- markup used to work out the price (never printed)
);
CREATE INDEX idx_document_lines_doc ON document_lines(document_id, position);

-- ---------- customer email (module: mail) ----------
CREATE TABLE outbound_emails (
  id            TEXT PRIMARY KEY,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  document_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('report','invoice','quote','reminder','other')),
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  attachments   TEXT NOT NULL DEFAULT '[]',          -- JSON: [{ name, size }]
  link_id       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error         TEXT,
  message_id    TEXT,
  sent_by       TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_outbound_job ON outbound_emails(job_id, created_at);
CREATE INDEX idx_outbound_doc ON outbound_emails(document_id, created_at);

-- Private links to a job's photos and videos, sent to the customer. Only the token's hash is stored.
CREATE TABLE share_links (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_ids    TEXT NOT NULL,                         -- JSON array of job_files ids
  title       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);

INSERT INTO counters (name, value) VALUES ('invoice_ref', 1049), ('quote_ref', 1000);
