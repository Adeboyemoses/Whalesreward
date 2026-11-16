-- P-29: content and transitions are immutable. No policy activation or identity assignment.
CREATE TABLE held_release_person (
 id UUID PRIMARY KEY,
 station_id UUID NOT NULL REFERENCES station(id),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(station_id,id)
);
CREATE TABLE held_release_person_binding (
 id UUID PRIMARY KEY,
 station_id UUID NOT NULL REFERENCES station(id),
 user_id UUID NOT NULL REFERENCES auth_user(id),
 person_id UUID NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 verified BOOLEAN NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(station_id,person_id) REFERENCES held_release_person(station_id,id),
 UNIQUE(station_id,user_id,version)
);
CREATE TABLE held_release_sheet (
 id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL REFERENCES purchase(id),
 station_id UUID NOT NULL REFERENCES station(id),
 uploader_id UUID NOT NULL REFERENCES auth_user(id),
 uploader_person_id UUID NOT NULL REFERENCES held_release_person(id),
 target JSONB NOT NULL CHECK(jsonb_typeof(target)='object'),
 purpose TEXT NOT NULL DEFAULT 'held_release_sheet' CHECK(purpose='held_release_sheet'),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 8388608),
 staging_key TEXT NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ(6) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(purchase_id,id)
);
CREATE TABLE held_release_sheet_validation (
 asset_id UUID PRIMARY KEY REFERENCES held_release_sheet(id),
 final_key TEXT NOT NULL UNIQUE,
 display_key TEXT NOT NULL UNIQUE,
 validated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE held_release_proposal (
 id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL REFERENCES purchase(id),
 station_id UUID NOT NULL REFERENCES station(id),
 target_kind TEXT NOT NULL CHECK(target_kind IN ('price','card','date','capture')),
 outcome TEXT NOT NULL CHECK(outcome IN ('confirm','cancel')),
 sheet_asset_id UUID NOT NULL,
 proposer_id UUID NOT NULL REFERENCES auth_user(id),
 proposer_person_id UUID NOT NULL REFERENCES held_release_person(id),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 provenance JSONB NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 proposed_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(purchase_id,sheet_asset_id) REFERENCES held_release_sheet(purchase_id,id),
 UNIQUE(purchase_id,id)
);
CREATE TABLE held_release_state (
 proposal_id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','superseded')),
 FOREIGN KEY(purchase_id,proposal_id) REFERENCES held_release_proposal(purchase_id,id)
);
CREATE UNIQUE INDEX held_release_one_pending ON held_release_state(purchase_id) WHERE state='pending';
CREATE TABLE held_release_transition (
 id UUID PRIMARY KEY,
 proposal_id UUID NOT NULL REFERENCES held_release_proposal(id),
 version INTEGER NOT NULL CHECK(version>0),
 state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','superseded')),
 actor_id UUID REFERENCES auth_user(id),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(proposal_id,version)
);
CREATE TABLE held_release_receipt (
 actor_id UUID NOT NULL REFERENCES auth_user(id),
 operation_kind TEXT NOT NULL,
 operation_id UUID NOT NULL,
 payload_digest TEXT NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 response JSONB NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,operation_kind,operation_id)
);
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['held_release_person','held_release_person_binding','held_release_sheet','held_release_sheet_validation','held_release_proposal','held_release_transition','held_release_receipt'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns()',t||'_immutable',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_held_release_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'release history is retained'; END IF;
 IF OLD.state<>'pending' OR NEW.state='pending' OR NEW.version<>OLD.version+1
 OR NEW.proposal_id<>OLD.proposal_id OR NEW.purchase_id<>OLD.purchase_id THEN
 RAISE EXCEPTION 'invalid release transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER held_release_state_guard BEFORE UPDATE OR DELETE ON held_release_state FOR EACH ROW EXECUTE FUNCTION guard_held_release_state();

ALTER TABLE review_evidence_approval DROP CONSTRAINT review_evidence_approval_release_check;
ALTER TABLE review_evidence_approval ADD CONSTRAINT review_evidence_approval_release_check CHECK(release IN ('review-evidence-v1','review-evidence-v2'));
CREATE OR REPLACE FUNCTION guard_review_evidence_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.configuration IS DISTINCT FROM jsonb_build_object(
   'release', NEW.configuration->'release', 'digest', NEW.configuration->'digest',
   'revision', to_jsonb(NEW.revision),
   'scope', jsonb_build_object('stationId',NEW.station_id::text,'environment',NEW.environment),
   'activation', NEW.configuration->'activation')
   OR NOT coalesce(NEW.configuration->>'release' IN ('review-evidence-v1','review-evidence-v2'),false)
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
CREATE FUNCTION reject_held_release_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'release history is retained'; END $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['held_release_person','held_release_person_binding','held_release_sheet','held_release_sheet_validation','held_release_proposal','held_release_state','held_release_transition','held_release_receipt'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_held_release_truncate()',t||'_no_truncate',t);
 END LOOP;
END $$;

ALTER TABLE sale_decision DROP CONSTRAINT ck_decision_kind;
ALTER TABLE sale_decision ADD CONSTRAINT ck_decision_kind CHECK (
 (kind='correction' AND correction_id IS NOT NULL AND hold_id IS NULL AND flag_id IS NULL AND outcome IN ('approve','reject')) OR
 (kind='duplicate' AND correction_id IS NULL AND hold_id IS NULL AND flag_id IS NOT NULL AND outcome IN ('keep_both','cancel')) OR
 (kind='price' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome IN ('accept_captured','correct_meter','cancel')) OR
 (kind='card' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome IN ('confirm_earlier','cancel')) OR
 (kind='date' AND correction_id IS NULL AND hold_id IS NOT NULL AND flag_id IS NULL AND outcome='verify_date') OR
 (kind='capture' AND correction_id IS NULL AND hold_id IS NULL AND flag_id IS NULL AND outcome IN ('confirm','cancel')) OR
 (kind='held_release' AND correction_id IS NULL AND flag_id IS NULL AND outcome IN ('confirm','cancel')));
-- Read-side fail-closed consistency fence shared by current contribution projections.
CREATE FUNCTION held_release_consistent(purchase UUID) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; a JSONB; pred JSONB; seen JSONB:='{}'::jsonb; k TEXT; lo NUMERIC; hi NUMERIC; l NUMERIC; u NUMERIC;
BEGIN
 FOR r IN SELECT p.provenance,t.content FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id
 LEFT JOIN held_release_transition t ON t.proposal_id=p.id AND t.version=s.version AND t.state='approved'
 WHERE p.purchase_id=purchase AND p.outcome='confirm' AND s.state='approved' LOOP
  a:=r.content->'attestation';
  IF NOT coalesce((r.provenance->'evaluation'->'originalInterval') ?& ARRAY['L','U'],false) THEN RETURN false; END IF;
  IF a IS NULL OR NOT (a ?& ARRAY['decisionId','version','fromMicros','throughMicros','predicates','sourceIds'])
    OR jsonb_array_length(a->'sourceIds')=0 OR jsonb_array_length(a->'predicates')=0
    OR NOT coalesce(a->>'decisionId' ~ '^[a-f0-9-]{36}$',false) OR (a->>'version')::integer<1 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(a->'sourceIds') s(id) WHERE NOT coalesce(id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR (id=purchase::text||':lookup' AND (a->'sourceIds') ? purchase::text),false)) THEN RETURN false; END IF;
  l:=(a->>'fromMicros')::numeric; u:=(a->>'throughMicros')::numeric;
  IF l>u OR l<(r.provenance->'evaluation'->'originalInterval'->>'L')::numeric OR u>(r.provenance->'evaluation'->'originalInterval'->>'U')::numeric THEN RETURN false; END IF;
  lo:=greatest(lo,l); hi:=least(hi,u); IF lo>hi THEN RETURN false; END IF;
  FOR pred IN SELECT value FROM jsonb_array_elements(a->'predicates') LOOP
   k:=pred->>'kind';
   IF k NOT IN ('rate','card','day','authorization','campaign') THEN RETURN false; END IF;
   IF k='campaign' THEN k:=k||':'||(pred->>'campaignId'); END IF;
   IF seen ? k AND seen->k IS DISTINCT FROM pred THEN RETURN false; END IF;
   seen:=jsonb_set(seen,ARRAY[k],pred);
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TRIGGER reports_held_release AFTER INSERT OR UPDATE OR DELETE ON held_release_state FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE FUNCTION guard_held_release_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state<>'pending' OR NEW.version<>1 THEN RAISE EXCEPTION 'proposal starts pending' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER held_release_initial BEFORE INSERT ON held_release_state FOR EACH ROW EXECUTE FUNCTION guard_held_release_initial_state();
CREATE FUNCTION check_held_release_transition_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s RECORD; n INTEGER; last_state TEXT;
BEGIN
 SELECT * INTO s FROM held_release_state WHERE proposal_id=NEW.proposal_id;
 SELECT count(*) INTO n FROM held_release_transition WHERE proposal_id=NEW.proposal_id;
 SELECT state INTO last_state FROM held_release_transition WHERE proposal_id=NEW.proposal_id AND version=s.version;
 IF s IS NULL OR n<>s.version OR last_state IS DISTINCT FROM s.state OR
 NOT EXISTS(SELECT 1 FROM held_release_transition WHERE proposal_id=NEW.proposal_id AND version=1 AND state='pending') OR
 EXISTS(SELECT 1 FROM held_release_transition WHERE proposal_id=NEW.proposal_id AND version>1 AND state='pending') THEN
 RAISE EXCEPTION 'release transition chain missing or inconsistent' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER held_release_state_chain AFTER INSERT OR UPDATE ON held_release_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_held_release_transition_chain();
CREATE CONSTRAINT TRIGGER held_release_transition_chain AFTER INSERT ON held_release_transition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_held_release_transition_chain();
