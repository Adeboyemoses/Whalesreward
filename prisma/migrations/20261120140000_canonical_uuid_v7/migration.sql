-- WHR-217: preserve historical identifiers and fail closed before changing live generators.
-- Prisma does not wrap SQL migrations automatically. One transaction and writer locks
-- make preflight + replacement atomic even with concurrent reconciliation writers.
BEGIN;
LOCK TABLE campaign, purchase_validation_block, audit_event, giveaway_phone_exclusion_transition
 IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE audits bigint; transitions bigint; blocks bigint;
BEGIN
 SELECT count(*) INTO audits FROM audit_event
 WHERE action='giveaway_phone_unavailable_superseded' AND substring(id::text,15,1)<>'7';
 SELECT count(*) INTO transitions FROM giveaway_phone_exclusion_transition
 WHERE substring(id::text,15,1)<>'7' OR substring(content->>'auditEventId',15,1)<>'7';
 SELECT count(*) INTO blocks FROM purchase_validation_block WHERE substring(id::text,15,1)<>'7';
 IF audits<>0 OR transitions<>0 OR blocks<>0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',
   MESSAGE='WHR-217 legacy identifiers require a reviewed preservation migration',
   DETAIL=format('supersession_audits=%s exclusion_transitions=%s validation_blocks=%s',audits,transitions,blocks),
   HINT='Deployment blocked; preserve all existing IDs and links. Follow docs/engineering/identifier-sweep.md. Do not rewrite IDs or relax contracts.';
 END IF;
END $$;

-- RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, RFC variant 10,
-- and 74 random bits. The core PG16 random UUID supplies entropy only;
-- no version-4 identifier is returned or persisted by this function.
CREATE FUNCTION whr_uuid_v7() RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE bytes bytea; milliseconds bigint;
BEGIN
 milliseconds:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 bytes:=uuid_send(gen_random_uuid()); -- entropy only, never an identifier
 bytes:=overlay(bytes placing substring(int8send(milliseconds) from 3 for 6) from 1 for 6);
 bytes:=set_byte(bytes,6,(get_byte(bytes,6) & 15) | 112);
 bytes:=set_byte(bytes,8,(get_byte(bytes,8) & 63) | 128);
 RETURN encode(bytes,'hex')::uuid;
END $$;

CREATE OR REPLACE FUNCTION supersede_phone_exclusions() RETURNS trigger LANGUAGE plpgsql AS $$
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
COMMIT;
