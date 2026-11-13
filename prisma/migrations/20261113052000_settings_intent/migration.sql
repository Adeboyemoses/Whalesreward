-- Retention duration is intent, never authorization to delete. Preserve existing approvals
-- on historical rows; new application writes deliberately carry no approval.
ALTER TABLE settings_version DROP CONSTRAINT ck_retention_policy;
ALTER TABLE settings_version ADD CONSTRAINT ck_retention_intent CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 36500);
ALTER TABLE settings_version ADD COLUMN full_snapshot jsonb;
ALTER TABLE settings_version ADD COLUMN previous_version_id uuid REFERENCES settings_version(id) ON DELETE RESTRICT;
ALTER TABLE settings_version ADD COLUMN section text CHECK(section IN ('giveaway','retention'));
ALTER TABLE settings_version ADD COLUMN grace_hours integer CHECK(grace_hours>=0);
ALTER TABLE settings_version ADD COLUMN launch_at timestamptz;
ALTER TABLE settings_version ADD COLUMN timing_policy_version text;
ALTER TABLE settings_version ADD COLUMN retention_policy_version text;
ALTER TABLE settings_version ADD COLUMN stored_copy_policy text NOT NULL DEFAULT 'unconfigured' CHECK(stored_copy_policy IN ('unconfigured','compressed_only','original_and_compressed'));
ALTER TABLE settings_version ADD COLUMN operation_id uuid;
CREATE UNIQUE INDEX uq_settings_actor_operation ON settings_version(actor_id,operation_id);
CREATE TABLE station_reporting_state (
 station_id uuid PRIMARY KEY REFERENCES station(id) ON DELETE RESTRICT,
 data_version bigint NOT NULL DEFAULT 0 CHECK(data_version>=0),
 settings_version integer NOT NULL DEFAULT 1 CHECK(settings_version>0),
 current_settings_version_id uuid REFERENCES settings_version(id) ON DELETE RESTRICT,
 launch_at timestamptz
);
CREATE UNIQUE INDEX uq_settings_station_identity ON settings_version(station_id,id);
ALTER TABLE station_reporting_state ADD CONSTRAINT reporting_settings_station FOREIGN KEY(station_id,current_settings_version_id) REFERENCES settings_version(station_id,id);
ALTER TABLE campaign ADD COLUMN current_timing_version_id uuid REFERENCES settings_version(id) ON DELETE RESTRICT;
ALTER TABLE campaign ADD COLUMN latest_snapshot_id uuid REFERENCES giveaway_snapshot(id) ON DELETE RESTRICT;
ALTER TABLE campaign ADD COLUMN reconciled_data_version bigint CHECK(reconciled_data_version>=0);
CREATE TABLE settings_change (
 id uuid PRIMARY KEY,
 station_id uuid NOT NULL REFERENCES station(id) ON DELETE RESTRICT,
 settings_version_id uuid NOT NULL UNIQUE REFERENCES settings_version(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 section text NOT NULL CHECK(section IN ('giveaway','retention')),
 applied_at timestamptz NOT NULL,
 snapshot jsonb NOT NULL,
 before_values jsonb NOT NULL,
 after_values jsonb NOT NULL,
 audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_event(id) ON DELETE RESTRICT,
 UNIQUE(station_id,version)
);
CREATE INDEX settings_change_history ON settings_change(station_id,version DESC);
CREATE TRIGGER guard_settings_change_immutable BEFORE UPDATE OR DELETE ON settings_change FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
-- Existing immutable versions remain history. Establish only their pointer; do not
-- manufacture launch, campaign, grace, retention or policy values.
INSERT INTO station_reporting_state(station_id,settings_version,current_settings_version_id)
 SELECT s.id,COALESCE(v.version,1),v.id FROM station s LEFT JOIN LATERAL
 (SELECT id,version FROM settings_version WHERE station_id=s.id ORDER BY version DESC LIMIT 1) v ON true;
ALTER TABLE settings_version ADD CONSTRAINT settings_previous_station FOREIGN KEY(station_id,previous_version_id) REFERENCES settings_version(station_id,id);
ALTER TABLE settings_version ADD CONSTRAINT settings_new_intent_unapproved CHECK(section IS NULL OR (retention_approved_by IS NULL AND retention_approved_at IS NULL));
ALTER TABLE settings_version ADD CONSTRAINT settings_new_timing_shape CHECK(section IS NULL OR (
 ((purchase_cutoff IS NULL AND grace_hours IS NULL AND upload_deadline IS NULL) OR
 (purchase_cutoff IS NOT NULL AND grace_hours IS NOT NULL AND upload_deadline=purchase_cutoff+grace_hours*interval '1 hour'))
 AND (launch_at IS NULL OR purchase_start IS NULL OR launch_at<=purchase_start)));
DROP TRIGGER guard_campaign_immutable ON campaign;
CREATE TRIGGER guard_campaign_immutable BEFORE UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','version','reconciliation_required','current_timing_version_id','latest_snapshot_id','reconciled_data_version');
UPDATE campaign c SET current_timing_version_id=v.id FROM
 (SELECT DISTINCT ON(campaign_id) campaign_id,id FROM settings_version WHERE campaign_id IS NOT NULL ORDER BY campaign_id,version DESC) v WHERE c.id=v.campaign_id;
