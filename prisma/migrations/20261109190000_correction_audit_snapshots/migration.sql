-- Additive and nullable for existing writers/history; no fabricated identity backfill.
-- The existing append-only audit guard protects these snapshots as well.
ALTER TABLE audit_event ADD COLUMN actor_snapshot JSONB,
 ADD COLUMN originating_seller_snapshot JSONB;
