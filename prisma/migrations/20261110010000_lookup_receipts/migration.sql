-- Additive P-23 immutable evidence. Old purchases retain no fabricated evidence/bound.
ALTER TABLE purchase
 ADD COLUMN lookup_receipt_input JSONB,
 ADD COLUMN lookup_receipt_status TEXT NOT NULL DEFAULT 'fallback',
 ADD COLUMN lookup_receipt_claims JSONB,
 ADD COLUMN capture_lower_bound TIMESTAMPTZ,
 ADD COLUMN capture_policy_version TEXT,
 ADD CONSTRAINT lookup_receipt_status_check CHECK (lookup_receipt_status IN ('valid','fallback')),
 ADD CONSTRAINT lookup_receipt_claims_check CHECK (
  (lookup_receipt_status='valid' AND lookup_receipt_claims IS NOT NULL AND jsonb_typeof(lookup_receipt_claims)='object' AND capture_lower_bound IS NOT NULL AND capture_policy_version IS NOT NULL)
  OR (lookup_receipt_status='fallback' AND lookup_receipt_claims IS NULL));
-- guard_purchase_immutable already denies edits to every column outside its explicit allowlist.
