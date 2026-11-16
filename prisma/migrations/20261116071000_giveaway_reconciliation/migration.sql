-- Dormant evaluator registry: deliberately no station policy bindings or campaign values.
CREATE TABLE reconciliation_policy_definition (
 policy_version text PRIMARY KEY,
 evaluator_identity text NOT NULL,
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
DECLARE e record; aid uuid; tid uuid; at timestamptz; changes jsonb; generation text;
BEGIN
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
 SELECT jsonb_agg(jsonb_build_object('field',key,'before',null,'after',value)) INTO changes FROM jsonb_each(jsonb_build_object(
 'phoneExclusionId',e.id,'phoneId',e.content->>'phoneId','exclusionVersion',(e.version+1)::text,'phoneExclusionState','superseded',
 'proposerAdminId',e.content#>>'{proposedBy,id}','campaignVersion',NEW.version::text,'sourceDataVersion',generation,'actionKind',e.content->>'kind'));
 INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,actor_snapshot,originating_seller_snapshot,"before","after",reason,occurred_at,schema_version,station_id,event_code,area,target_snapshot,correlation_id,changes,related_event_ids)
 VALUES(aid,null,'system','giveaway_phone_unavailable_superseded','campaign',NEW.id,null,
 jsonb_build_object('kind','system','service','reconciliation','nameAtEvent','Giveaway reconciliation'),'null'::jsonb,'{}','{}','Phone unavailable superseded',at,2,NEW.station_id,'AUD-'||aid::text,'giveaway',jsonb_build_object('kind','campaign','id',NEW.id,'code','CAMPAIGN-'||NEW.id::text,'subjectAtEvent',null),aid,changes,ARRAY[(e.content->>'auditEventId')::uuid]);
 INSERT INTO giveaway_phone_exclusion_transition(id,exclusion_id,version,state,content) VALUES(tid,e.id,e.version+1,'superseded',jsonb_build_object('auditEventId',aid));
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER phone_exclusion_pin_supersession AFTER UPDATE ON campaign FOR EACH ROW EXECUTE FUNCTION supersede_phone_exclusions();

INSERT INTO reconciliation_policy_definition(policy_version,evaluator_identity,approval_reference,partial_uploads) VALUES('reconciliation-v1','reconciliation-v1','WHR-158 / WHR-162 / Earl 16 Nov 2026','exact_incomplete');

CREATE OR REPLACE FUNCTION advance_report_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; payload jsonb;
BEGIN
 payload:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME IN ('purchase','settings_version','station_reporting_state') THEN sid:=(payload->>'station_id')::uuid;
 ELSIF TG_TABLE_NAME='customer' THEN sid:=(payload->>'registered_station_id')::uuid;
 ELSE SELECT station_id INTO sid FROM purchase WHERE id=(payload->>'purchase_id')::uuid;
 END IF;
 IF sid IS NULL THEN
   INSERT INTO station_reporting_state(station_id,data_version) SELECT id,1 FROM station
   ON CONFLICT(station_id) DO UPDATE SET data_version=station_reporting_state.data_version+1;
 ELSE
   INSERT INTO station_reporting_state(station_id,data_version) VALUES(sid,1)
   ON CONFLICT(station_id) DO UPDATE SET data_version=station_reporting_state.data_version+1;
 END IF;
 IF TG_TABLE_NAME NOT IN ('settings_version','station_reporting_state') THEN
 UPDATE campaign SET version=version+1,reconciliation_required=true WHERE sid IS NULL OR station_id=sid;
 END IF;
 RETURN NULL;
END $$;
