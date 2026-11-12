-- Additive customer identity recovery. No existing email verification rules change.
ALTER TABLE customer ADD COLUMN phone_verification_generation BIGINT NOT NULL DEFAULT 0 CHECK(phone_verification_generation>=0);
DROP TRIGGER guard_customer_immutable ON customer;
CREATE TRIGGER guard_customer_immutable BEFORE UPDATE OR DELETE ON customer FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','phone_normalized','version','phone_verification_generation');
ALTER TABLE verification_challenge
 ADD COLUMN issuer_admin_id UUID REFERENCES admin(id),
 ADD COLUMN issuer_session_id UUID REFERENCES auth_session(id),
 ADD COLUMN customer_version INTEGER,
 ADD COLUMN active_card_id UUID REFERENCES card(id),
 ADD COLUMN active_card_version INTEGER,
 ADD COLUMN phone_generation BIGINT,
 ADD COLUMN verified_at TIMESTAMPTZ,
 ADD COLUMN secret_key_version TEXT,
 ADD COLUMN phone_delivery_id UUID,
 ADD COLUMN resend_after TIMESTAMPTZ;
-- Phone intents start with a unique nonredeemable keyed placeholder. The adapter
-- replaces it once, before marking delivery sent; email hashes stay immutable.
DROP TRIGGER guard_verification_challenge_immutable ON verification_challenge;
CREATE OR REPLACE FUNCTION guard_recovery_challenge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable challenge' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['attempts','consumed_at','revoked_at','version','verified_at','secret_hash']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['attempts','consumed_at','revoked_at','version','verified_at','secret_hash']) THEN
  RAISE EXCEPTION 'immutable challenge binding' USING ERRCODE='23514'; END IF;
 IF OLD.purpose<>'replace_card' AND (NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
  RAISE EXCEPTION 'immutable email verifier' USING ERRCODE='23514'; END IF;
 IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN RAISE EXCEPTION 'immutable verification' USING ERRCODE='23514'; END IF;
 IF NEW.secret_hash IS DISTINCT FROM OLD.secret_hash AND (OLD.purpose<>'replace_card' OR OLD.version<>1 OR OLD.attempts<>0 OR OLD.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'verifier already assigned' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_verification_challenge_immutable BEFORE UPDATE OR DELETE ON verification_challenge FOR EACH ROW EXECUTE FUNCTION guard_recovery_challenge();
ALTER TABLE verification_challenge ADD CONSTRAINT ck_phone_challenge_binding CHECK(purpose<>'replace_card' OR
 (issuer_admin_id IS NOT NULL AND issuer_session_id IS NOT NULL AND customer_version IS NOT NULL AND customer_version>0 AND active_card_id IS NOT NULL AND active_card_version IS NOT NULL AND active_card_version>0 AND phone_generation IS NOT NULL AND phone_generation>0 AND secret_key_version IS NOT NULL AND target_key_version IS NOT NULL AND phone_delivery_id IS NOT NULL AND resend_after IS NOT NULL AND issuance_generation IS NULL AND mail_request_id IS NULL)) NOT VALID;
CREATE TABLE phone_verification_delivery (
 id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 customer_id UUID NOT NULL REFERENCES customer(id), generation BIGINT NOT NULL CHECK(generation>0),
 challenge_id UUID NOT NULL UNIQUE REFERENCES verification_challenge(id) DEFERRABLE INITIALLY DEFERRED,
 issuer_admin_id UUID NOT NULL REFERENCES admin(id), purpose TEXT NOT NULL CHECK(purpose='replace_card'),
 destination_phone TEXT NOT NULL, target_hmac TEXT NOT NULL, key_version TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','superseded')),
 lease_nonce TEXT, lease_until TIMESTAMPTZ, fencing_version BIGINT NOT NULL DEFAULT 0,
 failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('delivery_unavailable','delivery_uncertain','authority_unavailable')),
 UNIQUE(customer_id,generation)
);
ALTER TABLE verification_challenge ADD CONSTRAINT fk_phone_delivery FOREIGN KEY(phone_delivery_id) REFERENCES phone_verification_delivery(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE phone_verification_attempt (
 id UUID PRIMARY KEY, challenge_id UUID NOT NULL REFERENCES verification_challenge(id),
 actor_user_id UUID NOT NULL REFERENCES auth_user(id), operation_id UUID NOT NULL,
 request_hmac TEXT NOT NULL, key_version TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('verified','unavailable')),
 applied_challenge_version INTEGER NOT NULL CHECK(applied_challenge_version>0),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), result_snapshot JSONB,
 UNIQUE(actor_user_id,operation_id)
);
CREATE TRIGGER guard_phone_attempt BEFORE UPDATE OR DELETE ON phone_verification_attempt FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
ALTER TABLE customer_identity_change
 ADD COLUMN customer_version INTEGER,
 ADD COLUMN verification_method TEXT,
 ADD COLUMN old_phone_normalized TEXT,
 ADD COLUMN new_phone_normalized TEXT,
 ADD COLUMN old_card_id UUID REFERENCES card(id),
 ADD COLUMN new_card_id UUID REFERENCES card(id),
 ADD COLUMN applied_at TIMESTAMPTZ,
 ADD COLUMN audit_event_id UUID REFERENCES audit_event(id),
 ADD COLUMN actor_snapshot JSONB;
ALTER TABLE customer_identity_change ADD CONSTRAINT ck_recovery_identity_change CHECK(
 customer_version IS NOT NULL AND customer_version>0 AND verification_method IS NOT NULL AND applied_at IS NOT NULL AND audit_event_id IS NOT NULL AND actor_snapshot IS NOT NULL AND manager_review_reason IS NULL AND
 ((kind='phone_change' AND verification_method='card_present' AND old_phone_normalized IS NOT NULL AND new_phone_normalized IS NOT NULL AND old_phone_normalized<>new_phone_normalized AND challenge_id IS NULL AND old_card_id IS NULL AND new_card_id IS NULL)
 OR(kind='card_replacement' AND verification_method='registered_phone_code' AND challenge_id IS NOT NULL AND old_card_id IS NOT NULL AND new_card_id IS NOT NULL AND old_card_id<>new_card_id AND old_phone_normalized IS NULL AND new_phone_normalized IS NULL))) NOT VALID;
CREATE TABLE customer_recovery_case (
 id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 customer_id UUID NOT NULL REFERENCES customer(id), customer_version_at_intake INTEGER NOT NULL CHECK(customer_version_at_intake>0),
 actor_id UUID NOT NULL REFERENCES admin(id), operation_id UUID NOT NULL,
 state TEXT NOT NULL DEFAULT 'awaiting_policy_and_decision' CHECK(state='awaiting_policy_and_decision'),
 customer_present BOOLEAN NOT NULL CHECK(customer_present), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 verification_notes TEXT NOT NULL CHECK(length(verification_notes) BETWEEN 1 AND 1000),
 audit_event_id UUID NOT NULL REFERENCES audit_event(id), version INTEGER NOT NULL DEFAULT 1 CHECK(version=1), actor_snapshot JSONB NOT NULL,
 UNIQUE(actor_id,operation_id)
);
CREATE UNIQUE INDEX uq_customer_open_recovery_case ON customer_recovery_case(customer_id) WHERE state='awaiting_policy_and_decision';
CREATE TRIGGER guard_customer_recovery_case BEFORE UPDATE OR DELETE ON customer_recovery_case FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
-- Issuing a code advances only the independent generation, not identity version.
DROP TRIGGER guard_customer_transition ON customer;
CREATE FUNCTION guard_customer_recovery_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.phone_verification_generation<OLD.phone_verification_generation OR NEW.phone_verification_generation>OLD.phone_verification_generation+1 THEN RAISE EXCEPTION 'invalid phone generation' USING ERRCODE='23514'; END IF;
 IF NEW.version=OLD.version AND NEW.phone_verification_generation=OLD.phone_verification_generation+1 AND (to_jsonb(NEW)-'phone_verification_generation')=(to_jsonb(OLD)-'phone_verification_generation') THEN RETURN NEW; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'version must advance once' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_customer_transition BEFORE UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION guard_customer_recovery_transition();

CREATE TRIGGER guard_phone_delivery_binding BEFORE UPDATE OR DELETE ON phone_verification_delivery FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','lease_nonce','lease_until','fencing_version','failure_code');
CREATE FUNCTION check_phone_delivery_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='verification_challenge' THEN
  IF NEW.purpose='replace_card' AND NOT EXISTS(SELECT 1 FROM phone_verification_delivery d WHERE d.id=NEW.phone_delivery_id AND d.challenge_id=NEW.id AND d.customer_id=NEW.customer_id AND d.generation=NEW.phone_generation AND d.issuer_admin_id=NEW.issuer_admin_id AND d.target_hmac=NEW.target_digest AND d.key_version=NEW.target_key_version AND d.purpose=NEW.purpose) THEN RAISE EXCEPTION 'phone delivery binding mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM verification_challenge v WHERE v.id=NEW.challenge_id AND v.phone_delivery_id=NEW.id AND v.customer_id=NEW.customer_id AND v.phone_generation=NEW.generation AND v.issuer_admin_id=NEW.issuer_admin_id AND v.target_digest=NEW.target_hmac AND v.target_key_version=NEW.key_version AND v.purpose=NEW.purpose) THEN RAISE EXCEPTION 'phone challenge binding mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_phone_challenge_delivery AFTER INSERT ON verification_challenge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_phone_delivery_binding();
CREATE CONSTRAINT TRIGGER check_phone_delivery_challenge AFTER INSERT ON phone_verification_delivery DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_phone_delivery_binding();
