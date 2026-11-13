-- Additive protected measurement/approval history. No meter profiles are seeded.
CREATE TABLE meter_verification (
 id UUID PRIMARY KEY, station_id UUID NOT NULL REFERENCES station(id),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE meter_profile_approval (
 id UUID PRIMARY KEY, station_id UUID NOT NULL REFERENCES station(id), profile_id UUID NOT NULL,
 profile_version BIGINT NOT NULL CHECK(profile_version BETWEEN 1 AND 9007199254740991),
 digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), profile_content JSONB NOT NULL CHECK(jsonb_typeof(profile_content)='object'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), UNIQUE(profile_id,profile_version)
);
CREATE TABLE meter_policy_approval (
 id UUID PRIMARY KEY, station_id UUID NOT NULL REFERENCES station(id),
 environment TEXT NOT NULL CHECK(environment IN ('development','test','staging','production')),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 artifact TEXT NOT NULL, resolver_artifact TEXT NOT NULL,
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), UNIQUE(station_id,environment,revision)
);
CREATE TABLE meter_configuration (
 id UUID PRIMARY KEY, station_id UUID NOT NULL REFERENCES station(id),
 environment TEXT NOT NULL CHECK(environment IN ('development','test','staging','production')),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 authorization_reference TEXT NOT NULL CHECK(length(btrim(authorization_reference)) BETWEEN 1 AND 500),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), UNIQUE(station_id,environment,revision)
);
CREATE FUNCTION guard_meter_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.configuration IS DISTINCT FROM jsonb_build_object(
   'release','meter-reconciliation-v1','digest',NEW.configuration->'digest','revision',NEW.revision,
   'scope',jsonb_build_object('stationId',NEW.station_id::text,'environment',NEW.environment),
   'resolver',NEW.configuration->'resolver','profiles',NEW.configuration->'profiles','activation',NEW.configuration->'activation')
   OR jsonb_typeof(NEW.configuration->'profiles') IS DISTINCT FROM 'array'
   OR NOT coalesce(NEW.configuration->>'digest' ~ '^[a-f0-9]{64}$',false)
 THEN RAISE EXCEPTION 'invalid meter configuration' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meter:'||NEW.station_id::text||':'||NEW.environment,0));
 IF EXISTS(SELECT 1 FROM meter_configuration WHERE station_id=NEW.station_id AND environment=NEW.environment AND revision>=NEW.revision) THEN
  RAISE EXCEPTION 'meter configuration revision must increase' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER meter_configuration_order BEFORE INSERT ON meter_configuration FOR EACH ROW EXECUTE FUNCTION guard_meter_configuration();
CREATE TRIGGER meter_configuration_immutable BEFORE UPDATE OR DELETE ON meter_configuration FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER meter_policy_approval_immutable BEFORE UPDATE OR DELETE ON meter_policy_approval FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER meter_profile_approval_immutable BEFORE UPDATE OR DELETE ON meter_profile_approval FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER meter_verification_immutable BEFORE UPDATE OR DELETE ON meter_verification FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TABLE meter_evaluation (
 decision_id UUID PRIMARY KEY, purchase_id UUID NOT NULL, revision_id UUID NOT NULL UNIQUE,
 provenance JSONB NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(purchase_id,decision_id) REFERENCES sale_decision(purchase_id,id),
 FOREIGN KEY(purchase_id,revision_id) REFERENCES purchase_revision(purchase_id,id),
 CHECK(provenance ?& ARRAY['policy','target','interval','sources','result','reconciliation','transcription'])
);
CREATE TRIGGER meter_evaluation_immutable BEFORE UPDATE OR DELETE ON meter_evaluation FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
