CREATE TABLE duplicate_detection_intent (
 id uuid PRIMARY KEY, purchase_id uuid NOT NULL REFERENCES purchase(id),
 policy jsonb, cursor_id uuid, done boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX duplicate_detection_pending ON duplicate_detection_intent(created_at,id) WHERE NOT done;
CREATE INDEX duplicate_detection_purchase ON duplicate_detection_intent(purchase_id);
CREATE TABLE duplicate_reporting_state (
 station_id uuid PRIMARY KEY REFERENCES station(id), generation bigint NOT NULL DEFAULT 0
);
