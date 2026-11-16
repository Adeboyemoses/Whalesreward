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
CREATE TRIGGER photo_observation_no_truncate BEFORE TRUNCATE ON photo_receipt_observation FOR EACH STATEMENT EXECUTE FUNCTION immutable_photo_receipt();
CREATE TRIGGER photo_fact_no_truncate BEFORE TRUNCATE ON photo_receipt_fact FOR EACH STATEMENT EXECUTE FUNCTION immutable_photo_receipt();
ALTER TABLE photo_asset ADD CONSTRAINT photo_asset_purchase_identity UNIQUE(purchase_id,id);
ALTER TABLE purchase ADD CONSTRAINT purchase_station_identity_receipt UNIQUE(station_id,id);
ALTER TABLE photo_receipt_observation ADD CONSTRAINT receipt_observation_purchase_station FOREIGN KEY(station_id,purchase_id) REFERENCES purchase(station_id,id),
 ADD CONSTRAINT receipt_observation_asset_purchase FOREIGN KEY(purchase_id,asset_id) REFERENCES photo_asset(purchase_id,id),
 ADD CONSTRAINT receipt_observation_fact_identity UNIQUE(id,purchase_id,asset_id,receipt_at);
ALTER TABLE photo_receipt_fact ADD CONSTRAINT receipt_fact_exact_observation FOREIGN KEY(observation_id,purchase_id,asset_id,receipt_at) REFERENCES photo_receipt_observation(id,purchase_id,asset_id,receipt_at);
CREATE FUNCTION validate_photo_receipt_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM photo_receipt_observation o JOIN photo_asset a ON a.id=o.asset_id AND a.purchase_id=o.purchase_id
 WHERE o.id=NEW.observation_id AND a.id=NEW.asset_id AND a.state='validated'
 AND o.observed_digest=a.validated_digest AND o.observed_bytes=a.validated_bytes
 AND o.declared_digest=a.expected_digest AND o.observed_digest=o.declared_digest) THEN
 RAISE EXCEPTION 'receipt fact requires exact validated bytes' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_receipt_validated_bytes BEFORE INSERT ON photo_receipt_fact FOR EACH ROW EXECUTE FUNCTION validate_photo_receipt_fact();
