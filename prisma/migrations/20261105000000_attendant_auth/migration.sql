-- Replay stores only keyed request comparisons and a session reference, never credentials.
CREATE TABLE attendant_sign_in_request (
  request_key UUID PRIMARY KEY,
  request_hmac TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES auth_session(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  tombstone_until TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at AND tombstone_until >= created_at + interval '24 hours')
);
CREATE INDEX attendant_sign_in_request_expiry ON attendant_sign_in_request(tombstone_until);
-- Fixed-size token buckets shared by all application instances, with database time.
CREATE TABLE auth_rate_bucket (
  key_digest TEXT PRIMARY KEY,
  tokens NUMERIC(30,15) NOT NULL CHECK (tokens >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_rate_bucket_updated ON auth_rate_bucket(updated_at);
