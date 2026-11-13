/** Settings versions share a station counter, but only giveaway and legacy
 * timing rows establish campaign history. Check the full counter before filtering
 * so retention gaps are harmless without concealing genuinely missing history.
 * The initial logical version 1 has no row when retention is the first change. */
export const timingHistoryCte = `WITH all_settings AS (
 SELECT version,section,previous_version_id FROM settings_version WHERE station_id=$1
), completeness AS (
 SELECT count(*)=max(version)-min(version)+1 AND
 (min(version)=1 OR (min(version)=2 AND
 (SELECT section='retention' AND previous_version_id IS NULL FROM all_settings ORDER BY version LIMIT 1))) AS history_complete
 FROM all_settings
), timing_history AS (
 SELECT v.*,row_number() OVER(ORDER BY version)::integer AS timing_history_version,
 c.history_complete AS timing_history_complete
 FROM settings_version v CROSS JOIN completeness c
 WHERE v.station_id=$1 AND (v.section IS NULL OR v.section='giveaway')
)`;
