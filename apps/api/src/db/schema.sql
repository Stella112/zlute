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

-- Self-serve accounts (public deployment): each user has their own wallets `<prefix>-merchant`,
-- `<prefix>-payout`, `<prefix>-agent` and their own approval key (generated in their browser).
-- Accounts created before self-serve have no prefix and use the install's wallets and owner key.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_prefix TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_pub TEXT;
-- Non-custodial accounts: their merchant and payout wallets hold only viewing keys; the seed is
-- in the user's browser, which signs each payout (services/lute-signer). The agent wallet stays
-- Lute-held (an agent pays unattended).
ALTER TABLE users ADD COLUMN IF NOT EXISTS browser_signed BOOLEAN NOT NULL DEFAULT false;

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

-- Agents (mandate §19.8, §13.3). A grant is the API-side record of an owner-signed mandate that the
-- sidecar verified and loaded; the agent authenticates with a token stored only as a hash.
CREATE TABLE IF NOT EXISTS meter_services (
  id                 TEXT PRIMARY KEY,
  owner_user_id      TEXT NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,
  wallet             TEXT NOT NULL,             -- receiving wallet (operator-run demo service)
  address_enc        TEXT NOT NULL,             -- fixed receive address; payments matched by memo
  price_per_call_zat BIGINT NOT NULL CHECK (price_per_call_zat > 0),
  credit_limit_zat   BIGINT NOT NULL CHECK (credit_limit_zat > 0),
  created_at         BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_grants (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL REFERENCES users(id),
  agent_name     TEXT NOT NULL,
  wallet         TEXT NOT NULL,
  network        TEXT NOT NULL CHECK (network IN ('main','test','regtest')),
  service_id     TEXT NOT NULL REFERENCES meter_services(id),
  mandate_id     TEXT NOT NULL UNIQUE,
  mandate_hash   TEXT NOT NULL,
  cap_per_tx_zat BIGINT NOT NULL CHECK (cap_per_tx_zat > 0),
  cap_total_zat  BIGINT NOT NULL CHECK (cap_total_zat > 0),
  expires_at     BIGINT NOT NULL,
  revoked_at     BIGINT,
  token_hash     TEXT NOT NULL UNIQUE,         -- SHA-256 of the agent token; the token is shown once
  created_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS meter_sessions (
  id         TEXT PRIMARY KEY,
  grant_id   TEXT NOT NULL REFERENCES agent_grants(id),
  service_id TEXT NOT NULL REFERENCES meter_services(id),
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- One-time quotes for metered calls: bind price, service, session and the exact request (hash of
-- the text, never the text). Single use, short expiry.
CREATE TABLE IF NOT EXISTS meter_quotes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES meter_sessions(id),
  service_id   TEXT NOT NULL REFERENCES meter_services(id),
  pages        INTEGER NOT NULL CHECK (pages > 0),
  amount_zat   BIGINT NOT NULL CHECK (amount_zat > 0),
  request_hash TEXT NOT NULL,
  expires_at   BIGINT NOT NULL,
  used_at      BIGINT,
  created_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS meter_settlements (
  session_id TEXT NOT NULL REFERENCES meter_sessions(id),
  seq        INTEGER NOT NULL CHECK (seq > 0),
  action_id  TEXT NOT NULL UNIQUE REFERENCES actions(id),
  amount_zat BIGINT NOT NULL CHECK (amount_zat > 0),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- Everything seen for a request, confirmed or not: separates "partially paid" from "confirming".
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS seen_zat BIGINT NOT NULL DEFAULT 0;

-- Spends made by an agent carry its grant (budget accounting).
ALTER TABLE actions ADD COLUMN IF NOT EXISTS grant_id TEXT;

-- Commerce (mandate §19.3). Orders are checkouts backed by a payment request. Receipts are signed
-- with an Ed25519 receipt key (not a wallet or owner key), stored encrypted in signing_keys.
CREATE TABLE IF NOT EXISTS signing_keys (
  id              TEXT PRIMARY KEY,
  purpose         TEXT NOT NULL UNIQUE,
  public_key      TEXT NOT NULL,          -- raw 32-byte Ed25519 public key, hex
  private_key_enc TEXT NOT NULL,          -- PKCS#8 DER, AES-256-GCM
  created_at      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  request_id    TEXT NOT NULL UNIQUE REFERENCES payment_requests(id),
  item_enc      TEXT NOT NULL,
  amount_zat    BIGINT NOT NULL CHECK (amount_zat > 0),
  receipt_id    TEXT UNIQUE,
  receipt_json  TEXT,
  receipt_sig   TEXT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_refunds (
  order_id   TEXT NOT NULL REFERENCES orders(id),
  seq        INTEGER NOT NULL CHECK (seq > 0),
  action_id  TEXT NOT NULL UNIQUE REFERENCES actions(id),
  amount_zat BIGINT NOT NULL CHECK (amount_zat > 0),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (order_id, seq)
);

-- Subscriptions (mandate §19.7): a plan bills each period with a fresh payment request (invoice).
-- Lute never pulls funds: the subscriber pays each invoice from their own wallet.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name_enc      TEXT NOT NULL,
  amount_zat    BIGINT NOT NULL CHECK (amount_zat > 0),
  period_s      BIGINT NOT NULL CHECK (period_s >= 60),
  grace_s       BIGINT NOT NULL CHECK (grace_s >= 0),
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES subscription_plans(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  label_enc     TEXT NOT NULL,
  start_ts      BIGINT NOT NULL,
  cancelled_at  BIGINT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  period_no       INTEGER NOT NULL CHECK (period_no >= 0),
  request_id      TEXT NOT NULL UNIQUE REFERENCES payment_requests(id),
  period_start    BIGINT NOT NULL,
  period_end      BIGINT NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (subscription_id, period_no)
);

-- Groups (mandate §19.4): a shared bill split into one payment request per member. Members only
-- see their own share link; the organizer sees who has paid.
CREATE TABLE IF NOT EXISTS payment_groups (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  title_enc     TEXT NOT NULL,
  total_zat     BIGINT NOT NULL CHECK (total_zat > 0),
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES payment_groups(id),
  idx        INTEGER NOT NULL CHECK (idx >= 0),
  label_enc  TEXT NOT NULL,
  share_zat  BIGINT NOT NULL CHECK (share_zat > 0),
  request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id),
  PRIMARY KEY (group_id, idx)
);
