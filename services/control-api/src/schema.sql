CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY,
  room_name TEXT NOT NULL UNIQUE,
  invite_hash BYTEA NOT NULL,
  owner_hash BYTEA NOT NULL,
  create_request_hash BYTEA,
  create_request_fingerprint BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  room_closed_at TIMESTAMPTZ,
  room_close_finalized_at TIMESTAMPTZ,
  CONSTRAINT calls_invite_hash_unique UNIQUE (invite_hash)
);

ALTER TABLE calls ADD COLUMN IF NOT EXISTS create_request_hash BYTEA;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS create_request_fingerprint BYTEA;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS room_closed_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS room_close_finalized_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS calls_expiry_idx ON calls (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS calls_create_request_hash_idx
  ON calls (create_request_hash) WHERE create_request_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_pending_room_close_idx
  ON calls (revoked_at) WHERE revoked_at IS NOT NULL AND room_close_finalized_at IS NULL;

CREATE TABLE IF NOT EXISTS request_rate_buckets (
  bucket_hash BYTEA PRIMARY KEY,
  hit_count INTEGER NOT NULL CHECK (hit_count > 0),
  window_started_at TIMESTAMPTZ NOT NULL,
  window_ends_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS request_rate_buckets_expiry_idx ON request_rate_buckets (window_ends_at);
