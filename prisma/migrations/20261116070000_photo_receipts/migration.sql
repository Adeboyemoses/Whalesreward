-- No legacy receipt backfill: validation time never proves complete arrival.
CREATE TABLE photo_receipt_observation (
 id uuid PRIMARY KEY,
 station_id uuid NOT NULL REFERENCES station(id),
 purchase_id uuid NOT NULL REFERENCES purchase(id),
 asset_id uuid NOT NULL REFERENCES photo_asset(id),
 declared_digest text NOT NULL,
 observed_digest text NOT NULL,
 observed_bytes bigint NOT NULL CHECK(observed_bytes>0),
 sealed_key text NOT NULL UNIQUE,
 receipt_at timestamptz NOT NULL,
 observation_kind text NOT NULL DEFAULT 'server_sealed_bytes_v1' CHECK(observation_kind='server_sealed_bytes_v1'),
 policy_version text NOT NULL DEFAULT 'reconciliation-v1' CHECK(policy_version='reconciliation-v1'),
 UNIQUE(asset_id,observed_digest,observed_bytes)
);
CREATE TABLE photo_receipt_fact (
 asset_id uuid PRIMARY KEY REFERENCES photo_asset(id),
 observation_id uuid NOT NULL UNIQUE REFERENCES photo_receipt_observation(id),
 purchase_id uuid NOT NULL REFERENCES purchase(id),
 receipt_at timestamptz NOT NULL
);
CREATE FUNCTION immutable_photo_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'photo receipt is append-only'; END $$;
CREATE TRIGGER photo_observation_immutable BEFORE UPDATE OR DELETE ON photo_receipt_observation FOR EACH ROW EXECUTE FUNCTION immutable_photo_receipt();
CREATE TRIGGER photo_fact_immutable BEFORE UPDATE OR DELETE ON photo_receipt_fact FOR EACH ROW EXECUTE FUNCTION immutable_photo_receipt();
