-- Additive, immutable deployment authorization and protected evaluation history.
CREATE TABLE review_evidence_approval (
 id UUID PRIMARY KEY, release TEXT NOT NULL CHECK(release='review-evidence-v1'),
 digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 station_id UUID NOT NULL REFERENCES station(id),
 environment TEXT NOT NULL CHECK(environment IN ('development','test','staging','production')),
 activated_at TIMESTAMPTZ(6) NOT NULL,
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(station_id,environment,revision)
);
CREATE TABLE review_evidence_configuration (
 id UUID PRIMARY KEY, station_id UUID NOT NULL REFERENCES station(id),
 environment TEXT NOT NULL CHECK(environment IN ('development','test','staging','production')),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(station_id,environment,revision),
 CHECK(configuration->'scope'->>'stationId'=station_id::text),
 CHECK(configuration->'scope'->>'environment'=environment),
 CHECK((configuration->>'revision')::bigint=revision)
);
CREATE FUNCTION guard_review_evidence_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.configuration IS DISTINCT FROM jsonb_build_object(
   'release', NEW.configuration->'release', 'digest', NEW.configuration->'digest',
   'revision', to_jsonb(NEW.revision),
   'scope', jsonb_build_object('stationId',NEW.station_id::text,'environment',NEW.environment),
   'activation', NEW.configuration->'activation')
   OR NEW.configuration->>'release' IS DISTINCT FROM 'review-evidence-v1'
   OR NOT coalesce(NEW.configuration->>'digest' ~ '^[a-f0-9]{64}$',false)
   OR jsonb_typeof(NEW.configuration->'digest') IS DISTINCT FROM 'string'
   OR jsonb_typeof(NEW.configuration->'revision') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'invalid review configuration' USING ERRCODE='23514'; END IF;
 IF NEW.configuration->'activation'->>'state' = 'inactive' THEN
   IF NEW.configuration->'activation' IS DISTINCT FROM '{"state":"inactive","approvalReference":null,"activatedAt":null}'::jsonb THEN
    RAISE EXCEPTION 'invalid inactive activation' USING ERRCODE='23514'; END IF;
 ELSIF NEW.configuration->'activation'->>'state' = 'active' THEN
   IF NEW.configuration->'activation' IS DISTINCT FROM jsonb_build_object('state','active','approvalReference',NEW.configuration->'activation'->'approvalReference','activatedAt',NEW.configuration->'activation'->'activatedAt')
      OR jsonb_typeof(NEW.configuration->'activation'->'approvalReference') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.configuration->'activation'->'activatedAt') IS DISTINCT FROM 'string'
      OR NOT coalesce(NEW.configuration->'activation'->>'approvalReference' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)
   THEN RAISE EXCEPTION 'invalid active activation' USING ERRCODE='23514'; END IF;
   PERFORM (NEW.configuration->'activation'->>'activatedAt')::timestamptz;
 ELSE RAISE EXCEPTION 'invalid activation state' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('review-evidence:'||NEW.station_id::text||':'||NEW.environment,0));
 IF EXISTS(SELECT 1 FROM review_evidence_configuration WHERE station_id=NEW.station_id AND environment=NEW.environment AND revision>=NEW.revision) THEN
  RAISE EXCEPTION 'configuration revision must increase' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_evidence_configuration_order BEFORE INSERT ON review_evidence_configuration FOR EACH ROW EXECUTE FUNCTION guard_review_evidence_configuration();
CREATE TRIGGER review_evidence_configuration_immutable BEFORE UPDATE OR DELETE ON review_evidence_configuration FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER review_evidence_approval_immutable BEFORE UPDATE OR DELETE ON review_evidence_approval FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TABLE review_evaluation (
 decision_id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL,
 provenance JSONB NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(purchase_id,decision_id) REFERENCES sale_decision(purchase_id,id),
 CHECK(provenance ?& ARRAY['policy','target','interval','sources','conclusions','result'])
);
CREATE TRIGGER review_evaluation_immutable BEFORE UPDATE OR DELETE ON review_evaluation FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();

ALTER TABLE sale_decision ADD COLUMN capture_evaluation JSONB, ADD COLUMN resolved_capture_block_ids UUID[] NOT NULL DEFAULT '{}';
-- Legacy capture receipts remain historical; new v1 captures populate both fields.
ALTER TABLE sale_decision ADD CONSTRAINT ck_capture_evaluation_kind CHECK(kind='capture' OR (capture_evaluation IS NULL AND cardinality(resolved_capture_block_ids)=0));
