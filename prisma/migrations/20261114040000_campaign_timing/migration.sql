-- P-28 approval registers semantics only. No campaign or client timing values.
CREATE TABLE timing_policy_definition (
 policy_version text PRIMARY KEY,
 evaluator_identity text NOT NULL,
 semantics_digest text NOT NULL CHECK(semantics_digest ~ '^[a-f0-9]{64}$'),
 approval_reference text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE station_timing_policy (
 station_id uuid NOT NULL REFERENCES station(id) ON DELETE RESTRICT,
 policy_version text NOT NULL REFERENCES timing_policy_definition(policy_version) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(station_id,policy_version)
);
CREATE TRIGGER timing_policy_definition_immutable BEFORE UPDATE OR DELETE ON timing_policy_definition FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER station_timing_policy_immutable BEFORE UPDATE OR DELETE ON station_timing_policy FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER timing_policy_definition_no_truncate BEFORE TRUNCATE ON timing_policy_definition FOR EACH STATEMENT EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER station_timing_policy_no_truncate BEFORE TRUNCATE ON station_timing_policy FOR EACH STATEMENT EXECUTE FUNCTION guard_immutable_columns();
INSERT INTO timing_policy_definition(policy_version,evaluator_identity,semantics_digest,approval_reference)
 VALUES('campaign-timing-v1','campaign-timing-v1','5279603d4c9e94e46b2a27bac59b50034b7575b068d432bef2e73fd10055a463','WHR-138 / Whales 13 Nov / Earl 14 Nov 2026');
INSERT INTO station_timing_policy(station_id,policy_version) SELECT id,'campaign-timing-v1' FROM station;
-- Station insertion is bootstrap's transaction boundary, including fresh installs.
CREATE FUNCTION bind_station_timing_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM timing_policy_definition WHERE policy_version='campaign-timing-v1' AND evaluator_identity='campaign-timing-v1' AND semantics_digest='5279603d4c9e94e46b2a27bac59b50034b7575b068d432bef2e73fd10055a463' AND approval_reference='WHR-138 / Whales 13 Nov / Earl 14 Nov 2026') THEN
 RAISE EXCEPTION 'approved timing definition unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO station_timing_policy(station_id,policy_version) VALUES(NEW.id,'campaign-timing-v1') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER station_timing_bootstrap AFTER INSERT ON station FOR EACH ROW EXECUTE FUNCTION bind_station_timing_policy();
-- Existing duplicates deliberately fail this migration for investigation.
ALTER TABLE campaign ADD CONSTRAINT uq_campaign_station UNIQUE(station_id);
ALTER TABLE campaign ADD CONSTRAINT uq_campaign_station_identity UNIQUE(station_id,id);
ALTER TABLE settings_version ADD CONSTRAINT settings_campaign_station FOREIGN KEY(station_id,campaign_id) REFERENCES campaign(station_id,id);
ALTER TABLE settings_version ADD CONSTRAINT settings_policy_station FOREIGN KEY(station_id,timing_policy_version) REFERENCES station_timing_policy(station_id,policy_version) NOT VALID;
ALTER TABLE settings_version ADD CONSTRAINT settings_p28_complete CHECK(section IS DISTINCT FROM 'giveaway' OR timing_policy_version IS DISTINCT FROM 'campaign-timing-v1' OR
 (campaign_id IS NOT NULL AND launch_at IS NOT NULL AND purchase_start IS NOT NULL AND purchase_cutoff IS NOT NULL AND grace_hours IS NOT NULL AND upload_deadline IS NOT NULL AND launch_at<=purchase_start AND purchase_start<purchase_cutoff AND purchase_cutoff<=upload_deadline));
-- Settings insertion advances generation once; launch is part of that same write.
DROP TRIGGER reports_launch ON station_reporting_state;
ALTER TABLE settings_version ADD CONSTRAINT uq_settings_campaign_identity UNIQUE(station_id,campaign_id,id);
ALTER TABLE campaign ADD CONSTRAINT campaign_timing_same_campaign FOREIGN KEY(station_id,id,current_timing_version_id) REFERENCES settings_version(station_id,campaign_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION validate_station_timing_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM station WHERE id=NEW.id OR code=NEW.code) AND NOT EXISTS(
   SELECT 1 FROM station s JOIN station_timing_policy b ON b.station_id=s.id JOIN timing_policy_definition p ON p.policy_version=b.policy_version
   WHERE (s.id=NEW.id OR s.code=NEW.code) AND p.policy_version='campaign-timing-v1' AND p.evaluator_identity='campaign-timing-v1'
   AND p.semantics_digest='5279603d4c9e94e46b2a27bac59b50034b7575b068d432bef2e73fd10055a463' AND p.approval_reference='WHR-138 / Whales 13 Nov / Earl 14 Nov 2026'
 ) THEN RAISE EXCEPTION 'existing timing binding unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER station_timing_bootstrap_validate BEFORE INSERT ON station FOR EACH ROW EXECUTE FUNCTION validate_station_timing_bootstrap();
