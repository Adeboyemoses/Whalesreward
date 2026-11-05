-- Durable operation records never contain presigned URLs. Existing purchases,
-- revisions and assets remain the source of truth for contribution and evidence.
CREATE SEQUENCE sync_sale_code_seq;
CREATE TABLE sync_finalize_operation (
 purchase_id uuid NOT NULL REFERENCES purchase(id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
 upload_id uuid NOT NULL REFERENCES photo_asset(id) ON DELETE RESTRICT,
 expected_version integer NOT NULL CHECK (expected_version > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 PRIMARY KEY(purchase_id,operation_id)
);
CREATE TRIGGER guard_sync_finalize_immutable BEFORE UPDATE OR DELETE ON sync_finalize_operation
 FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('completed_at');
CREATE TABLE sync_validation (
 purchase_id uuid PRIMARY KEY REFERENCES purchase(id) ON DELETE RESTRICT,
 policy_version integer NOT NULL,
 reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
 campaign_eligible boolean NOT NULL,
 evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER guard_sync_validation_immutable BEFORE UPDATE OR DELETE ON sync_validation
 FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
