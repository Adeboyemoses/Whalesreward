-- Guard table-specific record fields only inside their table branch.
CREATE OR REPLACE FUNCTION guard_domain_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oldj jsonb := to_jsonb(OLD); newj jsonb := to_jsonb(NEW); a text; b text;
BEGIN
 IF oldj ? 'version' AND (newj->>'version')::int <> (oldj->>'version')::int + 1 THEN
  RAISE EXCEPTION 'version must advance once' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='card_batch' THEN
  IF NOT ((OLD.status='generated' AND NEW.status='printed') OR (OLD.status='printed' AND NEW.status='active')) THEN RAISE EXCEPTION 'invalid batch transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='card' THEN
  IF OLD.state='retired' THEN RAISE EXCEPTION 'retired card is terminal' USING ERRCODE='23514'; END IF;
  IF OLD.state<>NEW.state AND NOT ((OLD.state='unassigned' AND NEW.state='linked') OR (OLD.state='linked' AND NEW.state='retired')) THEN RAISE EXCEPTION 'invalid card transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME IN ('purchase_hold','duplicate_flag') THEN
  IF OLD.state<>'open' OR NEW.state='open' THEN RAISE EXCEPTION 'terminal review cannot be changed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='purchase_revision' THEN
  IF NOT ((OLD.state='proposed' AND NEW.state IN ('accepted','rejected')) OR (OLD.state='accepted' AND NEW.state='superseded' AND (newj - 'state')=(oldj - 'state'))) THEN RAISE EXCEPTION 'invalid revision transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='purchase' THEN
  a:=OLD.status; b:=NEW.status;
  IF NOT ((a='received' AND b IN ('photo_pending','cancelled')) OR (a='photo_pending' AND b IN ('finalizing','cancelled')) OR (a='finalizing' AND b IN ('photo_pending','held','credited')) OR (a='held' AND b IN ('held','credited','cancelled')) OR (a='credited' AND b IN ('credited','cancelled'))) THEN RAISE EXCEPTION 'invalid purchase transition' USING ERRCODE='23514'; END IF;
  IF OLD.card_id IS NOT NULL AND NEW.card_id IS DISTINCT FROM OLD.card_id OR OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'resolved customer/card immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='assignment' THEN
  IF OLD.effective_until IS NOT NULL OR NEW.effective_until IS NULL THEN RAISE EXCEPTION 'assignment can close once' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='card_customer_link' THEN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'card link can end once' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='photo_asset' THEN
  IF NOT ((OLD.state='staged' AND NEW.state IN ('validated','rejected')) OR (OLD.state='validated' AND NEW.state='deleted' AND (newj - ARRAY['state','deleted_at','deletion_run_id'])=(oldj - ARRAY['state','deleted_at','deletion_run_id']))) THEN RAISE EXCEPTION 'invalid asset transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='admin' THEN
  IF OLD.email_normalized IS DISTINCT FROM NEW.email_normalized AND NEW.email_verified_at IS NOT NULL THEN
   RAISE EXCEPTION 'email change must clear verification' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='verification_challenge' THEN
  IF OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL OR NEW.attempts < OLD.attempts THEN RAISE EXCEPTION 'challenge already terminal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
