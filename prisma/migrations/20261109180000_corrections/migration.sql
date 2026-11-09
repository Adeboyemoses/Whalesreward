-- AlterTable
ALTER TABLE "purchase" ADD COLUMN     "correction_cutoff_at" TIMESTAMPTZ(6),
ADD COLUMN     "correction_date_reliable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correction_time_policy_version" TEXT,
ADD COLUMN     "resolution_candidate_revision_id" UUID;

-- AlterTable
ALTER TABLE "purchase_revision" ADD COLUMN     "calculation_mode" TEXT NOT NULL DEFAULT 'captured_rate',
ADD COLUMN     "correction_id" UUID,
ADD COLUMN     "resolution_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "correction_request" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "originating_attendant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "frozen_request_digest" TEXT NOT NULL,
    "based_on_revision_id" UUID NOT NULL,
    "expected_purchase_version" INTEGER NOT NULL,
    "proposed_revision_id" UUID NOT NULL,
    "first_received_at" TIMESTAMPTZ(6) NOT NULL,
    "cutoff_at_receipt" TIMESTAMPTZ(6),
    "time_policy_version" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decision_id" UUID,
    "submitted_by_user_id" UUID NOT NULL,
    "verified_author_attendant_id" UUID,
    "authorship" TEXT NOT NULL,
    "recovery_executor_id" UUID,
    "recovery_authorizing_admin_id" UUID,
    "policy_blocks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "authority_session_id" UUID NOT NULL,
    "reserved_purchase_version" INTEGER NOT NULL,
    "lease_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validation_error" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "decided_by_user_id" UUID,
    "receipt" JSONB NOT NULL,

    CONSTRAINT "correction_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_decision" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correction_id" UUID,
    "expected_purchase_version" INTEGER NOT NULL,
    "expected_revision_id" UUID,
    "result_revision_id" UUID,
    "applied_purchase_version" INTEGER NOT NULL,
    "before_values" JSONB NOT NULL,
    "after_values" JSONB NOT NULL,
    "evidence_asset_id" UUID,
    "reason" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL,
    "audit_event_id" UUID NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "sale_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_validation_block" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "policy_reference" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_reference" UUID,
    "version" INTEGER NOT NULL,

    CONSTRAINT "purchase_validation_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "correction_request_originating_attendant_id_operation_id_key" ON "correction_request"("originating_attendant_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_request_purchase_id_id_key" ON "correction_request"("purchase_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_decision_actor_user_id_operation_id_key" ON "sale_decision"("actor_user_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_decision_purchase_id_id_key" ON "sale_decision"("purchase_id", "id");

-- Reviewed additive guards. Existing rows retain unknown cutoff/provenance.
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_candidate FOREIGN KEY(id,resolution_candidate_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT uq_purchase_origin UNIQUE(id,originating_attendant_id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_origin FOREIGN KEY(purchase_id,originating_attendant_id) REFERENCES purchase(id,originating_attendant_id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_base FOREIGN KEY(purchase_id,based_on_revision_id) REFERENCES purchase_revision(purchase_id,id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_proposal FOREIGN KEY(purchase_id,proposed_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_decision FOREIGN KEY(purchase_id,decision_id) REFERENCES sale_decision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_actor FOREIGN KEY(submitted_by_user_id) REFERENCES auth_user(id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_session FOREIGN KEY(authority_session_id) REFERENCES auth_session(id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_executor FOREIGN KEY(recovery_executor_id) REFERENCES admin(id);
ALTER TABLE correction_request ADD CONSTRAINT fk_correction_authorizer FOREIGN KEY(recovery_authorizing_admin_id) REFERENCES admin(id);
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_state CHECK(state IN ('pending_validation','awaiting_review','accepted','rejected'));
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_timing CHECK(timing IN ('before_midnight','late','unresolved') AND ((cutoff_at_receipt IS NULL)=(timing='unresolved')));
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_version CHECK(version>0 AND expected_purchase_version>0 AND reserved_purchase_version=expected_purchase_version+1 AND attempts BETWEEN 0 AND 5);
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_reason CHECK(length(btrim(reason)) BETWEEN 1 AND 1000);
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_authorship CHECK((authorship='authenticated_attendant' AND verified_author_attendant_id=originating_attendant_id AND verified_author_attendant_id IS NOT NULL AND recovery_executor_id IS NULL AND recovery_authorizing_admin_id IS NULL) OR (authorship='unverified_recovery' AND verified_author_attendant_id IS NULL AND recovery_executor_id IS NOT NULL AND recovery_authorizing_admin_id IS NOT NULL));
ALTER TABLE correction_request ALTER COLUMN policy_blocks SET NOT NULL;
ALTER TABLE correction_request ADD CONSTRAINT ck_correction_blocks CHECK(policy_blocks <@ ARRAY['correction_authorship_unverified','correction_evidence_policy_unset','meter_reconciliation_policy_unset']::text[]);
CREATE UNIQUE INDEX uq_correction_pending ON correction_request(purchase_id) WHERE state IN ('pending_validation','awaiting_review');
CREATE INDEX correction_validation_work ON correction_request(next_attempt_at,first_received_at) WHERE state='pending_validation';
ALTER TABLE purchase_revision ADD CONSTRAINT fk_revision_correction FOREIGN KEY(purchase_id,correction_id) REFERENCES correction_request(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase_revision ADD CONSTRAINT ck_revision_calculation_mode CHECK(calculation_mode IN ('captured_rate','meter_evidence'));
ALTER TABLE sale_decision ADD CONSTRAINT fk_decision_correction FOREIGN KEY(purchase_id,correction_id) REFERENCES correction_request(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE sale_decision ADD CONSTRAINT fk_decision_actor FOREIGN KEY(actor_user_id) REFERENCES auth_user(id);
ALTER TABLE sale_decision ADD CONSTRAINT fk_decision_audit FOREIGN KEY(audit_event_id) REFERENCES audit_event(id);
ALTER TABLE sale_decision ADD CONSTRAINT ck_decision_correction CHECK(kind='correction' AND correction_id IS NOT NULL AND outcome IN ('approve','reject'));
ALTER TABLE purchase_validation_block ADD CONSTRAINT fk_validation_purchase FOREIGN KEY(purchase_id) REFERENCES purchase(id);
CREATE UNIQUE INDEX uq_validation_block_open ON purchase_validation_block(purchase_id,code) WHERE resolved_at IS NULL;
CREATE TRIGGER guard_correction_immutable BEFORE UPDATE OR DELETE ON correction_request FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','version','decision_id','policy_blocks','lease_token','lease_until','attempts','next_attempt_at','validation_error','decided_at','decision_reason','decided_by_user_id');
CREATE TRIGGER guard_sale_decision_immutable BEFORE UPDATE OR DELETE ON sale_decision FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
DROP TRIGGER guard_purchase_immutable ON purchase;
CREATE TRIGGER guard_purchase_immutable BEFORE UPDATE OR DELETE ON purchase FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('card_id','customer_id','status','current_revision_id','verified_sale_date','cancellation_reason','version','resolution_candidate_revision_id','correction_cutoff_at','correction_time_policy_version','correction_date_reliable');
CREATE FUNCTION guard_correction_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.correction_time_policy_version IS NOT NULL AND ROW(NEW.correction_cutoff_at,NEW.correction_time_policy_version,NEW.correction_date_reliable) IS DISTINCT FROM ROW(OLD.correction_cutoff_at,OLD.correction_time_policy_version,OLD.correction_date_reliable) THEN RAISE EXCEPTION 'correction clock frozen' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER guard_correction_clock BEFORE UPDATE ON purchase FOR EACH ROW EXECUTE FUNCTION guard_correction_clock();
DROP TRIGGER guard_purchase_revision_immutable ON purchase_revision;
CREATE TRIGGER guard_purchase_revision_immutable BEFORE UPDATE OR DELETE ON purchase_revision FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','decision_actor_id','decision_reason','decided_at','version');
-- Isolate revision versioning; preserve the existing admin/assignment transition function.
CREATE FUNCTION guard_correction_revision_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.version NOT IN (OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'invalid revision version' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='proposed' AND NEW.state IN ('accepted','rejected')) OR (OLD.state='accepted' AND NEW.state='superseded' AND (to_jsonb(NEW)-ARRAY['state','version'])=(to_jsonb(OLD)-ARRAY['state','version']))) THEN RAISE EXCEPTION 'invalid revision transition' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
DROP TRIGGER guard_purchase_revision_transition ON purchase_revision;
CREATE TRIGGER guard_purchase_revision_transition BEFORE UPDATE ON purchase_revision FOR EACH ROW EXECUTE FUNCTION guard_correction_revision_transition();

-- Cancellation closes proposals without impersonating a human decision.
CREATE FUNCTION close_cancelled_corrections() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN
 UPDATE correction_request SET state='rejected',version=version+1,validation_error='sale_cancelled',decision_reason='Sale cancelled',decided_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE purchase_id=NEW.id AND state IN ('pending_validation','awaiting_review');
 END IF; RETURN NEW; END $$;
CREATE TRIGGER close_cancelled_corrections AFTER UPDATE ON purchase FOR EACH ROW EXECUTE FUNCTION close_cancelled_corrections();
