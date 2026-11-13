-- Add canonical envelopes; NULL version marks pre-existing historical rows.
-- No backfill or rewrite is permitted for the original audit record.
ALTER TABLE audit_event ADD COLUMN schema_version smallint,
 ADD COLUMN station_id uuid REFERENCES station(id),
 ADD COLUMN event_code text,
 ADD COLUMN area text,
 ADD COLUMN target_snapshot jsonb,
 ADD COLUMN correlation_id uuid,
 ADD COLUMN changes jsonb,
 ADD COLUMN related_event_ids uuid[];
ALTER TABLE audit_event ADD CONSTRAINT audit_canonical_envelope CHECK (
 schema_version IS NULL OR (schema_version=1 AND station_id IS NOT NULL
 AND event_code IS NOT NULL AND area IS NOT NULL AND target_snapshot IS NOT NULL
 AND actor_snapshot IS NOT NULL AND correlation_id IS NOT NULL
 AND jsonb_typeof(changes)='array' AND jsonb_array_length(changes)<=100
 AND related_event_ids IS NOT NULL AND cardinality(related_event_ids)<=20));
CREATE INDEX audit_station_time_id ON audit_event(station_id,occurred_at DESC,id DESC);
CREATE INDEX audit_station_target_time ON audit_event(station_id,target_id,occurred_at DESC,id DESC);
CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_event is append only' USING ERRCODE='42501'; END $$;
-- Existing guard_audit_event_immutable rejects UPDATE and DELETE, including new columns.
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();
