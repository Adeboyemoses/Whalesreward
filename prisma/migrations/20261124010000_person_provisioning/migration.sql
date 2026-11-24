-- WHR-227: operator provenance is append-only and contains no personal names.
CREATE TABLE person_provisioning_event (
 id UUID PRIMARY KEY,
 station_id UUID NOT NULL REFERENCES station(id),
 environment TEXT NOT NULL CHECK(environment IN ('development','test','staging','production')),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 action TEXT NOT NULL CHECK(action IN ('create','bind','rebind','unbind','disable','verify')),
 actor_code TEXT NOT NULL DEFAULT 'system:person-provisioning' CHECK(actor_code='system:person-provisioning'),
 authorization_reference TEXT NOT NULL CHECK(authorization_reference ~ '^[A-Za-z0-9._-]{1,200}$'),
 reason_code TEXT NOT NULL CHECK(reason_code IN ('initial_provisioning','alias_link','identity_correction','identity_uncertain','offboarding','verification_completed')),
 person_id UUID NOT NULL REFERENCES held_release_person(id),
 user_id UUID REFERENCES auth_user(id),
 verification_reference TEXT CHECK(verification_reference ~ '^[A-Za-z0-9._-]{1,200}$'),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='verify')=(verification_reference IS NOT NULL)),
 UNIQUE(station_id,environment,revision),
 FOREIGN KEY(station_id,person_id) REFERENCES held_release_person(station_id,id)
);
CREATE TABLE person_provisioning_binding (
 event_id UUID NOT NULL REFERENCES person_provisioning_event(id),
 user_id UUID NOT NULL REFERENCES auth_user(id),
 old_binding_id UUID REFERENCES held_release_person_binding(id),
 new_binding_id UUID NOT NULL REFERENCES held_release_person_binding(id),
 PRIMARY KEY(event_id,user_id)
);
CREATE TABLE person_provisioning_campaign (
 event_id UUID NOT NULL REFERENCES person_provisioning_event(id),
 campaign_id UUID NOT NULL REFERENCES campaign(id),
 old_version INTEGER NOT NULL,
 new_version INTEGER NOT NULL,
 old_data_version BIGINT NOT NULL,
 new_data_version BIGINT NOT NULL,
 manager_cleared BOOLEAN NOT NULL,
 PRIMARY KEY(event_id,campaign_id)
);
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['person_provisioning_event','person_provisioning_binding','person_provisioning_campaign'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_held_release_truncate()',t||'_no_truncate',t);
 END LOOP;
END $$;

-- A transaction-local, durable marker distinguishes identity invalidation from
-- ordinary pin/source supersession. No caller-controlled session setting is trusted.
CREATE TABLE person_identity_invalidation (
 campaign_id UUID NOT NULL REFERENCES campaign(id),
 transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
 old_version INTEGER NOT NULL,
 new_version INTEGER NOT NULL CHECK(new_version=old_version+1),
 PRIMARY KEY(campaign_id,transaction_id,old_version)
);
CREATE TRIGGER person_identity_invalidation_immutable BEFORE UPDATE OR DELETE ON person_identity_invalidation FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER person_identity_invalidation_no_truncate BEFORE TRUNCATE ON person_identity_invalidation FOR EACH STATEMENT EXECUTE FUNCTION reject_held_release_truncate();

CREATE OR REPLACE FUNCTION supersede_phone_exclusions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; aid uuid; tid uuid; at timestamptz; changes jsonb; generation text; triggering uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM person_identity_invalidation i WHERE i.campaign_id=NEW.id
   AND i.transaction_id=pg_current_xact_id() AND i.old_version=OLD.version AND i.new_version=NEW.version)
 AND (to_jsonb(NEW)-ARRAY['version','reconciliation_required','phone_check_id','manager_designation_id'])
 IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','reconciliation_required','phone_check_id','manager_designation_id']) THEN
   RETURN NULL;
 END IF;
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
 aid:=whr_uuid_v7();tid:=whr_uuid_v7();at:=clock_timestamp();
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
