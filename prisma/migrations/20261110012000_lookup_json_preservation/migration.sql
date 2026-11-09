-- JSONB excludes NUL and unpaired-surrogate JSON escapes. Canonical JSON text
-- preserves every permitted input losslessly; typed JSONB is an optional projection.
ALTER TABLE purchase ADD COLUMN lookup_receipt_input_json TEXT;
-- The existing immutable-column guard covers this protected original field.
