-- Classify from the actual first durable row value, including database receipt hooks.
CREATE FUNCTION bind_correction_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.timing:=CASE WHEN NEW.cutoff_at_receipt IS NULL THEN 'unresolved' WHEN NEW.first_received_at<NEW.cutoff_at_receipt THEN 'before_midnight' ELSE 'late' END;
 NEW.receipt:=NEW.receipt || jsonb_build_object('serverReceivedAt',to_char(NEW.first_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timing',NEW.timing);
 RETURN NEW; END $$;
CREATE TRIGGER zz_bind_correction_receipt BEFORE INSERT ON correction_request FOR EACH ROW EXECUTE FUNCTION bind_correction_receipt();
