-- Dormant evaluator registry: deliberately no station policy bindings or campaign values.
CREATE TABLE reconciliation_policy_definition (
 policy_version text PRIMARY KEY,
 evaluator_identity text NOT NULL,
 semantics_digest text NOT NULL DEFAULT '6c2fe33b4b9f079540fdc79618b2eb5a209c88147d589ee40df22fbf0623c21a' CHECK(semantics_digest ~ '^[0-9a-f]{64}$'),
 approval_reference text NOT NULL,
 partial_uploads text NOT NULL CHECK(partial_uploads='exact_incomplete'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE station_reconciliation_policy (
 station_id uuid PRIMARY KEY REFERENCES station(id),
 policy_version text NOT NULL REFERENCES reconciliation_policy_definition(policy_version),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE giveaway_manager_designation (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 manager_admin_id uuid NOT NULL REFERENCES admin(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE giveaway_phone_census (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 version integer NOT NULL CHECK(version>1),
 designation_id uuid NOT NULL REFERENCES giveaway_manager_designation(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 UNIQUE(campaign_id,version), UNIQUE(campaign_id,id)
);
CREATE TABLE giveaway_phone_exclusion (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 census_id uuid NOT NULL REFERENCES giveaway_phone_census(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 UNIQUE(campaign_id,id)
);
CREATE TABLE giveaway_phone_exclusion_transition (
 id uuid PRIMARY KEY, exclusion_id uuid NOT NULL REFERENCES giveaway_phone_exclusion(id),
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('pending','approved','rejected','superseded')),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 UNIQUE(exclusion_id,version)
);
CREATE TABLE giveaway_phone_check (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 census_id uuid NOT NULL REFERENCES giveaway_phone_census(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array'),
 UNIQUE(campaign_id,id)
);
ALTER TABLE campaign ADD COLUMN manager_designation_id uuid REFERENCES giveaway_manager_designation(id),
 ADD COLUMN phone_census_id uuid REFERENCES giveaway_phone_census(id),
 ADD COLUMN phone_check_id uuid REFERENCES giveaway_phone_check(id);
DROP TRIGGER guard_campaign_immutable ON campaign;
CREATE TRIGGER guard_campaign_immutable BEFORE UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','version','reconciliation_required','current_timing_version_id','latest_snapshot_id','reconciled_data_version','manager_designation_id','phone_census_id','phone_check_id');
CREATE TABLE giveaway_reconciliation (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 station_id uuid NOT NULL REFERENCES station(id),
 phone_check_id uuid NOT NULL REFERENCES giveaway_phone_check(id),
 source_data_version bigint NOT NULL CHECK(source_data_version>=0),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE giveaway_preview (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaign(id),
 station_id uuid NOT NULL REFERENCES station(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array'),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL
);
ALTER TABLE giveaway_snapshot ADD COLUMN content jsonb CHECK(jsonb_typeof(content)='object'),
 ADD COLUMN sources jsonb CHECK(jsonb_typeof(sources)='array'),
 ADD COLUMN rows jsonb CHECK(jsonb_typeof(rows)='array'),
 ADD COLUMN reconciliation_id uuid REFERENCES giveaway_reconciliation(id),
 ADD COLUMN phone_check_id uuid REFERENCES giveaway_phone_check(id),
 ADD COLUMN source_data_version bigint CHECK(source_data_version>=0),
 ADD COLUMN content_digest text;
CREATE TABLE giveaway_preview_consumption (
 preview_id uuid PRIMARY KEY REFERENCES giveaway_preview(id),
 snapshot_id uuid NOT NULL UNIQUE REFERENCES giveaway_snapshot(id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['reconciliation_policy_definition','station_reconciliation_policy','giveaway_manager_designation','giveaway_phone_census','giveaway_phone_exclusion','giveaway_phone_exclusion_transition','giveaway_phone_check','giveaway_reconciliation','giveaway_preview','giveaway_preview_consumption'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns()',t);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_immutable_columns()',t);
 END LOOP;
END $$;
CREATE TRIGGER reports_photo_observation AFTER INSERT ON photo_receipt_observation FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_photo_receipt AFTER INSERT ON photo_receipt_fact FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_card AFTER INSERT OR UPDATE OR DELETE ON card FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_card_link AFTER INSERT OR UPDATE OR DELETE ON card_customer_link FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
CREATE TRIGGER reports_review_evaluation AFTER INSERT ON review_evaluation FOR EACH ROW EXECUTE FUNCTION advance_report_generation();
-- Pin changes close obsolete proposals atomically; source-only changes never rewrite content.
CREATE FUNCTION supersede_phone_exclusions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; aid uuid; tid uuid; at timestamptz; changes jsonb; generation text; triggering uuid;
BEGIN
 SELECT * INTO NEW FROM campaign WHERE id=NEW.id;
 SELECT data_version::text INTO generation FROM station_reporting_state WHERE station_id=NEW.station_id;
 FOR e IN SELECT x.id,x.content,t.version FROM giveaway_phone_exclusion x
 JOIN LATERAL(SELECT state,version FROM giveaway_phone_exclusion_transition WHERE exclusion_id=x.id ORDER BY version DESC LIMIT 1)t ON true
 WHERE x.campaign_id=NEW.id AND t.state='pending' AND (
 x.content->>'censusId' IS DISTINCT FROM NEW.phone_census_id::text OR
 x.content->>'designationId' IS DISTINCT FROM NEW.manager_designation_id::text OR
 x.content->>'settingsVersionId' IS DISTINCT FROM NEW.current_timing_version_id::text OR
 x.content->>'previousSnapshotId' IS DISTINCT FROM NEW.latest_snapshot_id::text OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(x.content->'partialSources') s
 JOIN purchase p ON p.id=(s->>'purchaseId')::uuid WHERE
 p.version<>(s->>'purchaseVersion')::integer OR p.current_revision_id IS NOT NULL OR EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id)))
 LOOP
 aid:=gen_random_uuid();tid:=gen_random_uuid();at:=clock_timestamp();
 SELECT a.id INTO triggering FROM audit_event a WHERE a.xmin::text=pg_current_xact_id()::text
 AND a.action<>'giveaway_phone_unavailable_superseded' AND a.id<>(e.content->>'auditEventId')::uuid
 AND (a.target_id=NEW.id OR a.target_id IN(SELECT (s->>'purchaseId')::uuid FROM jsonb_array_elements(e.content->'partialSources') s))
 ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('field',key,'before',null,'after',value)) INTO changes FROM jsonb_each(jsonb_build_object(
 'phoneExclusionId',e.id,'phoneId',e.content->>'phoneId','exclusionVersion',(e.version+1)::text,'phoneExclusionState','superseded',
 'proposerAdminId',e.content#>>'{proposedBy,id}','campaignVersion',NEW.version::text,'sourceDataVersion',generation,'actionKind',e.content->>'kind'));
 INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,actor_snapshot,originating_seller_snapshot,"before","after",reason,occurred_at,schema_version,station_id,event_code,area,target_snapshot,correlation_id,changes,related_event_ids)
 VALUES(aid,null,'system','giveaway_phone_unavailable_superseded','campaign',NEW.id,null,
 jsonb_build_object('kind','system','service','reconciliation','nameAtEvent','Giveaway reconciliation'),'null'::jsonb,'{}','{}','Phone unavailable superseded',at,2,NEW.station_id,'AUD-'||aid::text,'giveaway',jsonb_build_object('kind','campaign','id',NEW.id,'code','CAMPAIGN-'||NEW.id::text,'subjectAtEvent',null),aid,changes,array_remove(ARRAY[(e.content->>'auditEventId')::uuid,triggering],NULL));
 INSERT INTO giveaway_phone_exclusion_transition(id,exclusion_id,version,state,content) VALUES(tid,e.id,e.version+1,'superseded',jsonb_build_object('auditEventId',aid));
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER phone_exclusion_pin_supersession AFTER UPDATE ON campaign DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION supersede_phone_exclusions();

INSERT INTO reconciliation_policy_definition(policy_version,evaluator_identity,approval_reference,partial_uploads) VALUES('reconciliation-v1','reconciliation-v1','WHR-158 / WHR-162 / Earl 16 Nov 2026','exact_incomplete');

ALTER TABLE station_reporting_state ADD COLUMN last_writer_transaction xid8;
CREATE OR REPLACE FUNCTION advance_report_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; payload jsonb; changed uuid[];
BEGIN
 payload:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME IN ('purchase','settings_version','station_reporting_state','photo_receipt_observation') THEN sid:=(payload->>'station_id')::uuid;
 ELSIF TG_TABLE_NAME='customer' THEN sid:=(payload->>'registered_station_id')::uuid;
 ELSE SELECT station_id INTO sid FROM purchase WHERE id=(payload->>'purchase_id')::uuid;
 END IF;
 WITH bumped AS (
 INSERT INTO station_reporting_state(station_id,data_version,last_writer_transaction)
 SELECT id,1,pg_current_xact_id() FROM station WHERE sid IS NULL OR id=sid
 ON CONFLICT(station_id) DO UPDATE SET data_version=station_reporting_state.data_version+1,last_writer_transaction=pg_current_xact_id()
 WHERE station_reporting_state.last_writer_transaction IS DISTINCT FROM pg_current_xact_id()
 RETURNING station_id)
 SELECT array_agg(station_id) INTO changed FROM bumped;
 IF TG_TABLE_NAME NOT IN ('settings_version','station_reporting_state') THEN
 UPDATE campaign SET version=version+1,reconciliation_required=true WHERE station_id=ANY(changed);
 END IF;
 RETURN NULL;
END $$;
-- Composite identities prevent cross-campaign links even for a non-superuser SQL writer.
ALTER TABLE giveaway_manager_designation ADD UNIQUE(campaign_id,id);
ALTER TABLE giveaway_snapshot ADD UNIQUE(campaign_id,id);
ALTER TABLE giveaway_preview ADD UNIQUE(campaign_id,id);
ALTER TABLE giveaway_reconciliation ADD UNIQUE(campaign_id,id);
ALTER TABLE campaign ADD COLUMN reconciliation_id uuid;
DROP TRIGGER guard_campaign_immutable ON campaign;
CREATE TRIGGER guard_campaign_immutable BEFORE UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','version','reconciliation_required','current_timing_version_id','latest_snapshot_id','reconciled_data_version','manager_designation_id','phone_census_id','phone_check_id','reconciliation_id');
ALTER TABLE campaign ADD FOREIGN KEY(id,manager_designation_id) REFERENCES giveaway_manager_designation(campaign_id,id),
 ADD FOREIGN KEY(id,phone_census_id) REFERENCES giveaway_phone_census(campaign_id,id),
 ADD FOREIGN KEY(id,phone_check_id) REFERENCES giveaway_phone_check(campaign_id,id),
 ADD FOREIGN KEY(id,reconciliation_id) REFERENCES giveaway_reconciliation(campaign_id,id),
 ADD FOREIGN KEY(id,latest_snapshot_id) REFERENCES giveaway_snapshot(campaign_id,id);
ALTER TABLE giveaway_phone_census ADD FOREIGN KEY(campaign_id,designation_id) REFERENCES giveaway_manager_designation(campaign_id,id);
ALTER TABLE giveaway_phone_exclusion ADD FOREIGN KEY(campaign_id,census_id) REFERENCES giveaway_phone_census(campaign_id,id),
 ADD COLUMN designation_id uuid GENERATED ALWAYS AS ((content->>'designationId')::uuid) STORED NOT NULL,
 ADD COLUMN settings_version_id uuid GENERATED ALWAYS AS ((content->>'settingsVersionId')::uuid) STORED NOT NULL,
 ADD COLUMN previous_snapshot_id uuid GENERATED ALWAYS AS ((content->>'previousSnapshotId')::uuid) STORED,
 ADD COLUMN proposer_id uuid GENERATED ALWAYS AS ((content#>>'{proposedBy,id}')::uuid) STORED NOT NULL REFERENCES admin(id),
 ADD COLUMN operation_id uuid GENERATED ALWAYS AS ((content->>'operationId')::uuid) STORED NOT NULL,
 ADD COLUMN proposal_audit_id uuid GENERATED ALWAYS AS ((content->>'auditEventId')::uuid) STORED NOT NULL REFERENCES audit_event(id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(campaign_id,designation_id) REFERENCES giveaway_manager_designation(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,previous_snapshot_id) REFERENCES giveaway_snapshot(campaign_id,id),
 ADD UNIQUE(proposer_id,operation_id);
ALTER TABLE settings_version ADD UNIQUE(campaign_id,id);
ALTER TABLE giveaway_phone_exclusion ADD FOREIGN KEY(campaign_id,settings_version_id) REFERENCES settings_version(campaign_id,id);
ALTER TABLE giveaway_phone_check ADD FOREIGN KEY(campaign_id,census_id) REFERENCES giveaway_phone_census(campaign_id,id),
 ADD COLUMN designation_id uuid GENERATED ALWAYS AS ((content->>'designationId')::uuid) STORED NOT NULL,
 ADD COLUMN settings_version_id uuid GENERATED ALWAYS AS ((content->>'settingsVersionId')::uuid) STORED NOT NULL,
 ADD COLUMN previous_snapshot_id uuid GENERATED ALWAYS AS ((content->>'previousSnapshotId')::uuid) STORED,
 ADD COLUMN actor_id uuid GENERATED ALWAYS AS ((content#>>'{manager,id}')::uuid) STORED NOT NULL REFERENCES admin(id),
 ADD COLUMN operation_id uuid GENERATED ALWAYS AS ((content->>'operationId')::uuid) STORED NOT NULL,
 ADD COLUMN audit_event_id uuid GENERATED ALWAYS AS ((content->>'auditEventId')::uuid) STORED NOT NULL REFERENCES audit_event(id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(campaign_id,designation_id) REFERENCES giveaway_manager_designation(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,settings_version_id) REFERENCES settings_version(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,previous_snapshot_id) REFERENCES giveaway_snapshot(campaign_id,id),
 ADD UNIQUE(actor_id,operation_id);
ALTER TABLE giveaway_reconciliation ADD FOREIGN KEY(station_id,campaign_id) REFERENCES campaign(station_id,id),
 ADD FOREIGN KEY(campaign_id,phone_check_id) REFERENCES giveaway_phone_check(campaign_id,id),
 ADD COLUMN actor_id uuid GENERATED ALWAYS AS ((content->>'actorId')::uuid) STORED NOT NULL REFERENCES admin(id),
 ADD COLUMN operation_id uuid GENERATED ALWAYS AS ((content->>'operationId')::uuid) STORED NOT NULL,
 ADD COLUMN settings_version_id uuid GENERATED ALWAYS AS ((content->>'settingsVersionId')::uuid) STORED NOT NULL,
 ADD COLUMN policy_version text GENERATED ALWAYS AS (content->>'policyVersion') STORED NOT NULL REFERENCES reconciliation_policy_definition(policy_version),
 ADD COLUMN timing_policy_version text GENERATED ALWAYS AS (content->>'timingPolicyVersion') STORED NOT NULL,
 ADD COLUMN reason text GENERATED ALWAYS AS (content->>'reason') STORED NOT NULL,
 ADD COLUMN outcome text GENERATED ALWAYS AS (content->>'outcome') STORED NOT NULL CHECK(outcome IN ('preview_prepared','unchanged')),
 ADD COLUMN current_snapshot_id uuid GENERATED ALWAYS AS ((content->>'currentSnapshotId')::uuid) STORED,
 ADD COLUMN audit_event_id uuid GENERATED ALWAYS AS ((content->>'auditEventId')::uuid) STORED NOT NULL REFERENCES audit_event(id) DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN checked_at timestamptz NOT NULL,
 ADD FOREIGN KEY(campaign_id,settings_version_id) REFERENCES settings_version(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,current_snapshot_id) REFERENCES giveaway_snapshot(campaign_id,id),
 ADD UNIQUE(actor_id,operation_id);
ALTER TABLE giveaway_preview ADD FOREIGN KEY(station_id,campaign_id) REFERENCES campaign(station_id,id);
ALTER TABLE giveaway_snapshot ADD FOREIGN KEY(campaign_id,reconciliation_id) REFERENCES giveaway_reconciliation(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,phone_check_id) REFERENCES giveaway_phone_check(campaign_id,id),
 ADD FOREIGN KEY(campaign_id,previous_snapshot_id) REFERENCES giveaway_snapshot(campaign_id,id);
CREATE FUNCTION check_preview_consumption_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM giveaway_preview p JOIN giveaway_snapshot s ON s.campaign_id=p.campaign_id WHERE p.id=NEW.preview_id AND s.id=NEW.snapshot_id) THEN
 RAISE EXCEPTION 'preview and snapshot must belong to same campaign' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_same_campaign BEFORE INSERT ON giveaway_preview_consumption FOR EACH ROW EXECUTE FUNCTION check_preview_consumption_parent();
ALTER TABLE giveaway_manager_designation
 ADD COLUMN actor_id uuid GENERATED ALWAYS AS ((content->>'actorId')::uuid) STORED NOT NULL REFERENCES admin(id),
 ADD COLUMN operation_id uuid GENERATED ALWAYS AS ((content->>'operationId')::uuid) STORED NOT NULL,
 ADD COLUMN audit_event_id uuid GENERATED ALWAYS AS ((content->>'auditEventId')::uuid) STORED NOT NULL REFERENCES audit_event(id),
 ADD UNIQUE(actor_id,operation_id);
ALTER TABLE giveaway_phone_census
 ADD COLUMN actor_id uuid GENERATED ALWAYS AS ((content->>'actorId')::uuid) STORED NOT NULL REFERENCES admin(id),
 ADD COLUMN operation_id uuid GENERATED ALWAYS AS ((content->>'operationId')::uuid) STORED NOT NULL,
 ADD COLUMN audit_event_id uuid GENERATED ALWAYS AS ((content->>'auditEventId')::uuid) STORED NOT NULL REFERENCES audit_event(id),
 ADD UNIQUE(actor_id,operation_id);
CREATE FUNCTION validate_phone_check_entries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE census jsonb; e jsonb; phone jsonb;
BEGIN
 SELECT content INTO census FROM giveaway_phone_census WHERE id=NEW.census_id AND campaign_id=NEW.campaign_id;
 IF census IS NULL OR jsonb_array_length(NEW.entries)<>jsonb_array_length(census->'phones') OR
 (SELECT count(DISTINCT value->>'phoneId') FROM jsonb_array_elements(NEW.entries))<>jsonb_array_length(NEW.entries) THEN
 RAISE EXCEPTION 'incomplete phone check entries' USING ERRCODE='23514'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(NEW.entries) LOOP
 SELECT value INTO phone FROM jsonb_array_elements(census->'phones') WHERE value->>'id'=e->>'phoneId';
 IF phone IS NULL OR phone->>'version' IS DISTINCT FROM e->>'phoneVersion' OR NOT ((phone->'attendantIds') @> (e->'attendantIds') AND (e->'attendantIds') @> (phone->'attendantIds')) THEN
 RAISE EXCEPTION 'phone entry does not match census' USING ERRCODE='23514'; END IF;
 IF e->>'result'='empty' THEN
 IF e->>'exclusionId' IS NOT NULL THEN RAISE EXCEPTION 'empty phone has exclusion' USING ERRCODE='23514'; END IF;
 ELSIF e->>'result'='unavailable' THEN
 IF NOT EXISTS(SELECT 1 FROM giveaway_phone_exclusion x JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=x.id ORDER BY version DESC LIMIT 1)t ON t.state='approved'
 WHERE x.id=(e->>'exclusionId')::uuid AND x.campaign_id=NEW.campaign_id AND x.census_id=NEW.census_id AND x.content->>'phoneId'=e->>'phoneId') THEN
 RAISE EXCEPTION 'unapproved phone exclusion' USING ERRCODE='23503'; END IF;
 ELSE RAISE EXCEPTION 'unknown phone result' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER check_phone_entries BEFORE INSERT ON giveaway_phone_check FOR EACH ROW EXECUTE FUNCTION validate_phone_check_entries();
CREATE FUNCTION validate_phone_exclusion_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; phone jsonb; sid uuid;
BEGIN
 SELECT station_id INTO sid FROM campaign WHERE id=NEW.campaign_id;
 SELECT value INTO phone FROM giveaway_phone_census c CROSS JOIN LATERAL jsonb_array_elements(c.content->'phones')
 WHERE c.id=NEW.census_id AND c.campaign_id=NEW.campaign_id AND value->>'id'=NEW.content->>'phoneId';
 IF phone IS NULL OR phone->>'version' IS DISTINCT FROM NEW.content->>'phoneVersion' THEN RAISE EXCEPTION 'exclusion phone mismatch' USING ERRCODE='23503'; END IF;
 IF (SELECT count(DISTINCT value->>'purchaseId') FROM jsonb_array_elements(NEW.content->'partialSources'))<>jsonb_array_length(NEW.content->'partialSources') THEN RAISE EXCEPTION 'duplicate partial sources' USING ERRCODE='23514'; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(NEW.content->'partialSources') LOOP
 IF NOT EXISTS(SELECT 1 FROM purchase p WHERE p.id=(source->>'purchaseId')::uuid AND p.station_id=sid AND p.version=(source->>'purchaseVersion')::integer AND p.status IN ('received','photo_pending')
 AND (phone->'attendantIds') @> to_jsonb(ARRAY[p.originating_attendant_id::text]) AND p.current_revision_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM purchase_revision r WHERE r.purchase_id=p.id AND r.state='accepted')
 AND NOT EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id)) THEN
 RAISE EXCEPTION 'invalid exact partial source' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER check_exclusion_sources BEFORE INSERT ON giveaway_phone_exclusion FOR EACH ROW EXECUTE FUNCTION validate_phone_exclusion_sources();
ALTER TABLE giveaway_phone_exclusion ADD CHECK(content->>'id'=id::text AND content->>'campaignId'=campaign_id::text AND content->>'censusId'=census_id::text);
ALTER TABLE giveaway_phone_check ADD CHECK(content->>'id'=id::text AND content->>'campaignId'=campaign_id::text AND content->>'censusId'=census_id::text);
