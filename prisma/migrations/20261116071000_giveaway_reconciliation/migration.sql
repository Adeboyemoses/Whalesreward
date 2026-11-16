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
