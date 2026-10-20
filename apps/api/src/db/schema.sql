-- Lute API schema (mandate §19.11). Authoritative DDL; src/db/schema.ts mirrors it for Drizzle.
-- Money is bigint zatoshi with CHECK (>= 0). No seeds or keys are ever stored here.
-- Columns ending in _enc hold AES-256-GCM ciphertext (encryption at rest, not end-to-end).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- argon2id
  role          TEXT NOT NULL CHECK (role IN ('owner','merchant','user')),
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,              -- SHA-256 of the cookie token; the token itself is never stored
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id                    TEXT PRIMARY KEY,   -- 128-bit random, base64url
  owner_user_id         TEXT NOT NULL REFERENCES users(id),
  type                  TEXT NOT NULL,
  network               TEXT NOT NULL CHECK (network IN ('main','test','regtest')),
  state                 TEXT NOT NULL,
  amount_zat            BIGINT NOT NULL CHECK (amount_zat >= 0),
  wallet                TEXT,
  recipient_address_enc TEXT,
  recipient_ref         TEXT,
  memo_kind             TEXT CHECK (memo_kind IN ('lute_ref','user_typed')),
  memo_ref              TEXT,
  memo_text_enc         TEXT,
  idempotency_key       TEXT NOT NULL,
  expires_at            BIGINT NOT NULL,
  proposal_id           TEXT,
  proposal_hash         TEXT,
  txid                  TEXT,
  broadcast_ambiguous   BOOLEAN NOT NULL DEFAULT FALSE,
  last_decision_id      TEXT,
  reject_reason         TEXT,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL,
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS action_transitions (
  id         BIGSERIAL PRIMARY KEY,
  action_id  TEXT NOT NULL REFERENCES actions(id),
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  actor      TEXT NOT NULL,
  at         BIGINT NOT NULL
);

-- LuteGuard decisions. Checks carry reason codes only (no amounts, addresses, memos).
CREATE TABLE IF NOT EXISTS privacy_decisions (
  decision_id    TEXT PRIMARY KEY,
  action_id      TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('ALLOW','DENY')),
  checks         JSONB NOT NULL,
  params_hash    TEXT NOT NULL,
  evaluated_at   BIGINT NOT NULL
);
