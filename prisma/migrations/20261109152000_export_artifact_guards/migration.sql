-- CHECK treats UNKNOWN as success: explicitly require every ready-artifact field.
ALTER TABLE card_export ADD CONSTRAINT ck_export_ready_required CHECK(status<>'ready' OR(prepared_at IS NOT NULL AND expires_at IS NOT NULL AND object_key IS NOT NULL AND sha256 IS NOT NULL AND byte_size IS NOT NULL));
ALTER TABLE card_export ADD CONSTRAINT ck_export_failed_required CHECK(status<>'failed' OR failure_code IS NOT NULL);
CREATE FUNCTION guard_card_export_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='expired' OR(OLD.status='ready' AND(NEW.status<>'expired' OR(to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status'))) THEN
 RAISE EXCEPTION 'prepared export is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('pending','failed') AND NEW.status NOT IN('pending','failed','ready') THEN
 RAISE EXCEPTION 'invalid export transition' USING ERRCODE='23514'; END IF;
 IF NEW.fencing_version<OLD.fencing_version OR NEW.attempts<OLD.attempts THEN
 RAISE EXCEPTION 'export claim cannot move backwards' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_card_export_lifecycle BEFORE UPDATE ON card_export FOR EACH ROW EXECUTE FUNCTION guard_card_export_lifecycle();
