-- Add pump display names without changing existing pump identity or history.
ALTER TABLE pump ADD COLUMN name TEXT;
DROP TRIGGER guard_pump_immutable ON pump;
DROP TRIGGER guard_pump_transition ON pump;
UPDATE pump SET name=code;
CREATE TRIGGER guard_pump_transition BEFORE UPDATE ON pump FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
ALTER TABLE pump ALTER COLUMN name SET NOT NULL;
-- Existing fixture/bootstrap writers omit name; supply their immutable code.
CREATE FUNCTION default_pump_name() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name IS NULL THEN NEW.name:=NEW.code; END IF; RETURN NEW; END $$;
CREATE TRIGGER default_pump_name BEFORE INSERT ON pump FOR EACH ROW EXECUTE FUNCTION default_pump_name();
ALTER TABLE pump ADD CONSTRAINT ck_pump_name CHECK(length(btrim(name)) BETWEEN 1 AND 120);
CREATE UNIQUE INDEX uq_pump_normalized_name ON pump(station_id,lower(btrim(name)));
CREATE TRIGGER guard_pump_immutable BEFORE UPDATE OR DELETE ON pump FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('enabled','version');
