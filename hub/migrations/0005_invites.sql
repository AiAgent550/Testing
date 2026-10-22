-- One-time invite links: an owner runs scripts/invite.mjs, the person opens /login#invite=<token>,
-- picks their own name and password, then sets up two-step sign-in. Only the token's SHA-256 is stored.
CREATE TABLE invites (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX idx_invites_email ON invites(email);
