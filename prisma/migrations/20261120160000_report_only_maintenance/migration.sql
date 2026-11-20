-- Additive report-only inventory infrastructure. No domain/evidence updates.
ALTER TABLE maintenance_run
 ADD COLUMN storage_identity text,
 ADD COLUMN started_at timestamptz,
 ADD COLUMN heartbeat_at timestamptz,
 ADD COLUMN completion_deadline timestamptz,
 ADD COLUMN watermark timestamptz,
 ADD COLUMN error_code text,
 ADD COLUMN page_no integer NOT NULL DEFAULT 0 CHECK(page_no>=0);
DROP TRIGGER guard_maintenance_run_immutable ON maintenance_run;
CREATE TRIGGER guard_maintenance_run_immutable BEFORE UPDATE OR DELETE ON maintenance_run FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('status','cursor','lease_owner','lease_until','fencing_version','attempts','next_attempt_at','completed_at','outcome','started_at','heartbeat_at','completion_deadline','watermark','error_code','page_no');
CREATE TABLE maintenance_job (
 job text NOT NULL CHECK(job IN ('orphans','reconcile-uploads')),
 scope text NOT NULL DEFAULT 'primary' CHECK(scope='primary'),
 run_id uuid REFERENCES maintenance_run(id),
 lease_owner uuid,
 lease_until timestamptz,
 fencing_version bigint NOT NULL DEFAULT 0 CHECK(fencing_version>=0),
 heartbeat_at timestamptz,
 next_due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completion_deadline timestamptz,
 last_complete_watermark timestamptz,
 last_succeeded_at timestamptz,
 last_outcome text CHECK(last_outcome IN ('running','continued','succeeded','failed')),
 error_code text CHECK(error_code IN ('database_unavailable','storage_unavailable')),
 PRIMARY KEY(job,scope),
 CHECK((lease_owner IS NULL)=(lease_until IS NULL))
);
CREATE TABLE maintenance_object (
 id uuid PRIMARY KEY,
 object_key text NOT NULL,
 version_id text NOT NULL,
 UNIQUE(object_key,version_id)
);
CREATE TABLE maintenance_page (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES maintenance_run(id),
 page_no integer NOT NULL CHECK(page_no>=0),
 counts jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(run_id,page_no)
);
CREATE TABLE maintenance_finding (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES maintenance_run(id),
 page_no integer NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 code text NOT NULL CHECK(code IN ('aged_staged','unreferenced_final','missing_object','digest_mismatch','size_mismatch','missing_digest','missing_receipt','receipt_mismatch','stalled_upload','delete_marker')),
 object_id uuid REFERENCES maintenance_object(id),
 asset_id uuid,
 purchase_id uuid,
 reference_ids uuid[] NOT NULL DEFAULT '{}',
 UNIQUE(run_id,page_no,ordinal),
 FOREIGN KEY(run_id,page_no) REFERENCES maintenance_page(run_id,page_no)
);
CREATE FUNCTION guard_maintenance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'maintenance observations are immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['maintenance_object','maintenance_page','maintenance_finding'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_maintenance_append_only()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_maintenance_append_only()',t||'_no_truncate',t);
 END LOOP;
END $$;
CREATE INDEX maintenance_finding_run ON maintenance_finding(run_id,page_no);
