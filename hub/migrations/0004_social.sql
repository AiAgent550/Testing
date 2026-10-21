-- Stage 4 (social, leads): one-time OAuth "state" values for connecting Instagram/Facebook and YouTube.
-- Only the SHA-256 of each state is stored; each is tied to the signed-in user, expires after
-- 10 minutes and is deleted when used, so a callback can't be replayed or forged.
CREATE TABLE oauth_states (
  state_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('meta','google')),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
