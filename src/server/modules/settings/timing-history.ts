/** Full station chain includes retention, while campaign evidence uses timing rows.
 * Logical version 1 may have no physical row; only valid first intents admit it. */
export const timingHistoryCte = `WITH all_settings AS (
 SELECT id,version,section,previous_version_id,campaign_id,timing_policy_version,launch_at,purchase_start,purchase_cutoff,upload_deadline,grace_hours FROM settings_version WHERE station_id=$1
), completeness AS (
 SELECT count(*)=max(version)-min(version)+1 AND
 (min(version)=1 OR (min(version)=2 AND
 (SELECT previous_version_id IS NULL AND (section='retention' OR
 (section='giveaway' AND timing_policy_version='campaign-timing-v1' AND campaign_id IS NOT NULL
 AND launch_at IS NOT NULL AND launch_at<=purchase_start AND purchase_start<purchase_cutoff
 AND grace_hours>=0 AND upload_deadline=purchase_cutoff+grace_hours*interval '1 hour')) FROM all_settings ORDER BY version LIMIT 1)))
 AND NOT EXISTS(SELECT 1 FROM all_settings a WHERE a.section IS NOT NULL AND a.version>(SELECT min(version) FROM all_settings)
 AND a.previous_version_id IS DISTINCT FROM (SELECT b.id FROM all_settings b WHERE b.version=a.version-1)) AS history_complete
 FROM all_settings
), timing_history AS (
 SELECT v.*,row_number() OVER(ORDER BY version)::integer AS timing_history_version,
 c.history_complete AS timing_history_complete
 FROM settings_version v CROSS JOIN completeness c
 WHERE v.station_id=$1 AND (v.section IS NULL OR v.section='giveaway')
)`;
