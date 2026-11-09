ALTER TABLE sync_validation ADD COLUMN capture_evidence JSONB;
-- The existing immutable-row guard protects evaluation evidence.
