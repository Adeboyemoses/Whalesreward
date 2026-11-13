-- Any committed source change advances the same station generation atomically.
-- Reads observe rows and generation in one SQL snapshot; no wall-clock counter.
CREATE FUNCTION advance_report_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; payload jsonb;
BEGIN
 payload:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME IN ('purchase','settings_version','station_reporting_state') THEN sid:=(payload->>'station_id')::uuid;
 ELSIF TG_TABLE_NAME='customer' THEN sid:=(payload->>'registered_station_id')::uuid;
 ELSE SELECT station_id INTO sid FROM purchase WHERE id=(payload->>'purchase_id')::uuid;
 END IF;
 IF sid IS NULL THEN
   UPDATE station_reporting_state SET data_version=data_version+1;
 ELSE
   INSERT INTO station_reporting_state(station_id,data_version) VALUES(sid,1)
   ON CONFLICT(station_id) DO UPDATE SET data_version=station_reporting_state.data_version+1;
 END IF;
 RETURN NULL;
END $$;
INSERT INTO station_reporting_state(station_id) SELECT id FROM station ON CONFLICT DO NOTHING;
CREATE TRIGGER reports_purchase AFTER INSERT OR UPDATE OR DELETE ON purchase FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_revision AFTER INSERT OR UPDATE OR DELETE ON purchase_revision FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_hold AFTER INSERT OR UPDATE OR DELETE ON purchase_hold FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_block AFTER INSERT OR UPDATE OR DELETE ON purchase_validation_block FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_validation AFTER INSERT OR UPDATE OR DELETE ON sync_validation FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_photo AFTER INSERT OR UPDATE OR DELETE ON photo_asset FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_correction AFTER INSERT OR UPDATE OR DELETE ON correction_request FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_duplicate AFTER INSERT OR UPDATE OR DELETE ON duplicate_flag FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_customer AFTER INSERT OR UPDATE OR DELETE ON customer FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_settings AFTER INSERT ON settings_version FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_launch AFTER UPDATE OF launch_at ON station_reporting_state FOR EACH ROW WHEN (OLD.launch_at IS DISTINCT FROM NEW.launch_at) EXECUTE FUNCTION advance_report_generation();
CREATE TABLE report_export (
 id uuid PRIMARY KEY, station_id uuid NOT NULL REFERENCES station(id), created_by uuid NOT NULL REFERENCES admin(id), operation_id uuid NOT NULL,
 format text NOT NULL CHECK(format IN ('pdf','xlsx')), filters jsonb NOT NULL, source_data_version bigint NOT NULL CHECK(source_data_version>=0), snapshot_at timestamptz NOT NULL,
 creator_snapshot jsonb NOT NULL, frozen_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed','expired')),
 prepared_at timestamptz, expires_at timestamptz, object_key text, sha256 text, byte_size bigint,
 failure_code text CHECK(failure_code IN ('preparation_failed','precision_not_representable')),
 lease_nonce text, lease_until timestamptz, fencing_version bigint NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz,
 UNIQUE(created_by,operation_id), CHECK(byte_size IS NULL OR byte_size>0), CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 CHECK(status<>'ready' OR (prepared_at IS NOT NULL AND expires_at=prepared_at+interval '24 hours' AND object_key IS NOT NULL AND sha256 IS NOT NULL AND byte_size IS NOT NULL)),
 CHECK((status='failed')=(failure_code IS NOT NULL))
);
CREATE INDEX report_export_work ON report_export(status,next_attempt_at,lease_until);
CREATE TRIGGER guard_report_export_immutable BEFORE UPDATE OR DELETE ON report_export FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('status','prepared_at','expires_at','object_key','sha256','byte_size','failure_code','lease_nonce','lease_until','fencing_version','attempts','next_attempt_at');
