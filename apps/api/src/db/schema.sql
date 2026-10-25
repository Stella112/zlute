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

-- Payment requests (mandate §19.2). details_ciphertext is encrypted IN THE BROWSER with a key that
-- only exists in the share link's #fragment; the server never sees it in clear.
CREATE TABLE IF NOT EXISTS payment_requests (
  id                 TEXT PRIMARY KEY,      -- 128-bit random base64url; also the LUTE:<ref> memo ref
  owner_user_id      TEXT NOT NULL REFERENCES users(id),
  wallet             TEXT NOT NULL,
  network            TEXT NOT NULL CHECK (network IN ('main','test','regtest')),
  amount_zat         BIGINT NOT NULL CHECK (amount_zat > 0),
  address_enc        TEXT NOT NULL,         -- unique shielded receive address (AES-256-GCM at rest)
  zip321_enc         TEXT NOT NULL,
  details_ciphertext TEXT,                  -- opaque blob from the browser (XChaCha20-Poly1305)
  status             TEXT NOT NULL CHECK (status IN ('UNPAID','PENDING','PAID','EXPIRED')),
  received_zat       BIGINT NOT NULL DEFAULT 0 CHECK (received_zat >= 0),
  matched_by         TEXT,
  txids              JSONB NOT NULL DEFAULT '[]',
  expires_at         BIGINT NOT NULL,
  created_at         BIGINT NOT NULL,
  updated_at         BIGINT NOT NULL
);

-- Streams (mandate §19.5). Payer-controlled, not trustless: settlements are owner-approved payouts.
CREATE TABLE IF NOT EXISTS stream_agreements (
  id                    TEXT PRIMARY KEY,
  owner_user_id         TEXT NOT NULL REFERENCES users(id),
  wallet                TEXT NOT NULL,
  network               TEXT NOT NULL CHECK (network IN ('main','test','regtest')),
  recipient_address_enc TEXT NOT NULL,
  total_zat             BIGINT NOT NULL CHECK (total_zat > 0),
  start_ts              BIGINT NOT NULL,
  end_ts                BIGINT NOT NULL CHECK (end_ts > start_ts),
  events                JSONB NOT NULL DEFAULT '[]',
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS stream_settlements (
  stream_id  TEXT NOT NULL REFERENCES stream_agreements(id),
  seq        INTEGER NOT NULL CHECK (seq > 0),
  action_id  TEXT NOT NULL UNIQUE REFERENCES actions(id),
  amount_zat BIGINT NOT NULL CHECK (amount_zat > 0),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (stream_id, seq)
);
