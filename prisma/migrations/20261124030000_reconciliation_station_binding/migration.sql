-- P-30 station bootstrap follows P-28. Only the approved semantics are bound;
-- campaign values, people, phone checks and snapshots remain operator inputs.
BEGIN;
-- Keep station creation from racing the backfill and trigger installation.
LOCK TABLE station IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM reconciliation_policy_definition
   WHERE policy_version='reconciliation-v1' AND evaluator_identity='reconciliation-v1'
   AND semantics_digest='6c2fe33b4b9f079540fdc79618b2eb5a209c88147d589ee40df22fbf0623c21a'
   AND partial_uploads='exact_incomplete'
   AND approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026'
 ) THEN RAISE EXCEPTION 'approved reconciliation definition unavailable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM station_reconciliation_policy WHERE policy_version<>'reconciliation-v1') THEN
   RAISE EXCEPTION 'existing reconciliation binding incompatible' USING ERRCODE='23514';
 END IF;
END $$;
INSERT INTO station_reconciliation_policy(station_id,policy_version)
 SELECT id,'reconciliation-v1' FROM station ON CONFLICT(station_id) DO NOTHING;

CREATE OR REPLACE FUNCTION bind_station_reconciliation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM reconciliation_policy_definition
   WHERE policy_version='reconciliation-v1' AND evaluator_identity='reconciliation-v1'
   AND semantics_digest='6c2fe33b4b9f079540fdc79618b2eb5a209c88147d589ee40df22fbf0623c21a'
   AND partial_uploads='exact_incomplete'
   AND approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026'
 ) THEN RAISE EXCEPTION 'approved reconciliation definition unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO station_reconciliation_policy(station_id,policy_version)
 VALUES(NEW.id,'reconciliation-v1') ON CONFLICT(station_id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS station_reconciliation_bootstrap ON station;
CREATE TRIGGER station_reconciliation_bootstrap AFTER INSERT ON station
 FOR EACH ROW EXECUTE FUNCTION bind_station_reconciliation_policy();

-- Match P-28 for bootstrap retries using INSERT ... ON CONFLICT DO NOTHING:
-- an existing station must already have its approved, immutable binding.
CREATE OR REPLACE FUNCTION validate_station_reconciliation_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM station WHERE id=NEW.id OR code=NEW.code) AND NOT EXISTS(
   SELECT 1 FROM station s JOIN station_reconciliation_policy b ON b.station_id=s.id
   JOIN reconciliation_policy_definition p ON p.policy_version=b.policy_version
   WHERE (s.id=NEW.id OR s.code=NEW.code)
   AND p.policy_version='reconciliation-v1' AND p.evaluator_identity='reconciliation-v1'
   AND p.semantics_digest='6c2fe33b4b9f079540fdc79618b2eb5a209c88147d589ee40df22fbf0623c21a'
   AND p.partial_uploads='exact_incomplete'
   AND p.approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026'
 ) THEN RAISE EXCEPTION 'existing reconciliation binding unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS station_reconciliation_bootstrap_validate ON station;
CREATE TRIGGER station_reconciliation_bootstrap_validate BEFORE INSERT ON station
 FOR EACH ROW EXECUTE FUNCTION validate_station_reconciliation_bootstrap();
COMMIT;
