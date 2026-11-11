-- Additive review receipt storage; historical correction writers remain compatible.
ALTER TABLE sale_decision ADD COLUMN hold_id UUID, ADD COLUMN flag_id UUID,
 ADD COLUMN evidence_evaluation JSONB, ADD COLUMN replay_response JSONB;
ALTER TABLE sale_decision DROP CONSTRAINT ck_decision_correction;
ALTER TABLE sale_decision ADD CONSTRAINT ck_decision_kind CHECK (
 (kind='correction' AND correction_id IS NOT NULL AND hold_id IS NULL AND flag_id IS NULL AND outcome IN ('approve','reject')) OR
 (kind='duplicate' AND correction_id IS NULL AND hold_id IS NULL AND flag_id IS NOT NULL AND outcome IN ('keep_both','cancel')) OR
 (kind='price' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome IN ('accept_captured','correct_meter','cancel')) OR
 (kind='card' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome IN ('confirm_earlier','cancel')) OR
 (kind='date' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome='verify_date') OR
 (kind='capture' AND correction_id IS NULL AND hold_id IS NULL AND flag_id IS NULL AND outcome IN ('confirm','cancel')));
ALTER TABLE sale_decision ADD CONSTRAINT fk_review_hold FOREIGN KEY(hold_id) REFERENCES purchase_hold(id);
ALTER TABLE sale_decision ADD CONSTRAINT fk_review_flag FOREIGN KEY(flag_id) REFERENCES duplicate_flag(id);
ALTER TABLE duplicate_flag ADD COLUMN cancelled_purchase_id UUID REFERENCES purchase(id);
ALTER TABLE duplicate_flag ADD CONSTRAINT ck_cancelled_pair_member CHECK(cancelled_purchase_id IS NULL OR (state='cancelled' AND cancelled_purchase_id IN (purchase_id,other_purchase_id)));
DROP TRIGGER guard_duplicate_flag_immutable ON duplicate_flag;
CREATE TRIGGER guard_duplicate_flag_immutable BEFORE UPDATE OR DELETE ON duplicate_flag FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','resolved_by','resolution_reason','resolved_at','operation_id','version','cancelled_purchase_id');
-- A single terminal cancellation closes all open holds; the receipt remains unique per actor/operation.
DROP INDEX uq_purchase_hold_resolved_by_resolution_operation_id;
CREATE INDEX purchase_hold_resolution_operation ON purchase_hold(resolved_by,resolution_operation_id);
ALTER TABLE purchase_validation_block ADD COLUMN closure_kind TEXT;
ALTER TABLE purchase_validation_block ADD CONSTRAINT ck_block_closure_kind CHECK(closure_kind IS NULL OR (closure_kind IN ('confirmed','cancelled') AND resolved_at IS NOT NULL AND resolution_reference IS NOT NULL));
