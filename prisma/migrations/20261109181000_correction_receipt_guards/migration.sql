-- Classify from the actual first durable row value, including database receipt hooks.
CREATE FUNCTION bind_correction_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.timing:=CASE WHEN NEW.cutoff_at_receipt IS NULL THEN 'unresolved' WHEN NEW.first_received_at<NEW.cutoff_at_receipt THEN 'before_midnight' ELSE 'late' END;
 NEW.receipt:=NEW.receipt || jsonb_build_object('serverReceivedAt',to_char(NEW.first_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timing',NEW.timing);
 RETURN NEW; END $$;
CREATE TRIGGER zz_bind_correction_receipt BEFORE INSERT ON correction_request FOR EACH ROW EXECUTE FUNCTION bind_correction_receipt();
CREATE FUNCTION guard_correction_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state IN ('accepted','rejected') THEN RAISE EXCEPTION 'correction terminal' USING ERRCODE='23514'; END IF;
 IF NEW.state<>OLD.state THEN
  IF NEW.version<>OLD.version+1 OR NOT ((OLD.state='pending_validation' AND NEW.state IN ('awaiting_review','accepted','rejected')) OR (OLD.state='awaiting_review' AND NEW.state IN ('accepted','rejected'))) THEN RAISE EXCEPTION 'invalid correction transition' USING ERRCODE='23514'; END IF;
 ELSIF NEW.version<>OLD.version THEN RAISE EXCEPTION 'lease metadata cannot change correction version' USING ERRCODE='23514'; END IF;
 IF NEW.authorship='unverified_recovery' AND OLD.state='pending_validation' AND NEW.state='accepted' THEN RAISE EXCEPTION 'recovered proposal requires independent review' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER guard_correction_transition BEFORE UPDATE ON correction_request FOR EACH ROW EXECUTE FUNCTION guard_correction_transition();
-- Composite ownership plus immutable capture fields also apply to non-HTTP writers.
CREATE FUNCTION guard_correction_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c correction_request; p purchase; r purchase_revision; base purchase_revision; author uuid;
BEGIN
 IF TG_TABLE_NAME='correction_request' THEN SELECT * INTO c FROM correction_request WHERE id=NEW.id;
 ELSE SELECT * INTO c FROM correction_request WHERE id=NEW.correction_id; END IF;
 IF c.id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM purchase WHERE id=c.purchase_id;
 SELECT * INTO r FROM purchase_revision WHERE id=c.proposed_revision_id;
 SELECT * INTO base FROM purchase_revision WHERE id=c.based_on_revision_id;
 IF ROW(r.purchase_id,r.based_on_revision_id,r.correction_id,r.actor_user_id,r.basis,r.rate_kobo,r.price_version_id,r.quantity_precision,r.unit,r.medium,r.evidence_asset_id) IS DISTINCT FROM ROW(p.id,c.based_on_revision_id,c.id,c.submitted_by_user_id,p.basis,base.rate_kobo,base.price_version_id,base.quantity_precision,base.unit,base.medium,base.evidence_asset_id) THEN RAISE EXCEPTION 'correction binding mismatch' USING ERRCODE='23514'; END IF;
 IF c.authorship='authenticated_attendant' THEN SELECT user_id INTO author FROM attendant WHERE id=c.verified_author_attendant_id;
 ELSE SELECT user_id INTO author FROM admin WHERE id=c.recovery_executor_id; END IF;
 IF author IS DISTINCT FROM c.submitted_by_user_id THEN RAISE EXCEPTION 'correction actor mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER ck_correction_binding AFTER INSERT ON correction_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_correction_binding();
CREATE CONSTRAINT TRIGGER ck_revision_correction_binding AFTER INSERT ON purchase_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_correction_binding();
-- Preserve known durable P-20 evaluations; no inferred date/authorization provenance.
INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version)
 SELECT gen_random_uuid(),s.purchase_id,j.code,'p20-'||s.policy_version::text,s.evaluated_at,1
 FROM sync_validation s CROSS JOIN LATERAL jsonb_array_elements_text(s.reasons) AS j(code)
 WHERE j.code IN ('capture_authorization_unresolved','capture_time_unresolved')
 AND NOT EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=s.purchase_id AND b.code=j.code AND b.resolved_at IS NULL);
