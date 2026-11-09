-- AlterTable
ALTER TABLE "card_batch" ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "registered_by_user_id" UUID,
ADD COLUMN     "registered_station_id" UUID;

-- CreateTable
CREATE TABLE "card_export" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "batch_version" INTEGER NOT NULL,
    "batch_status" TEXT NOT NULL,
    "batch_code" TEXT NOT NULL,
    "batch_name" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "prepared_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "object_key" TEXT,
    "sha256" TEXT,
    "byte_size" BIGINT,
    "failure_code" TEXT,
    "lease_nonce" TEXT,
    "lease_until" TIMESTAMPTZ(6),
    "fencing_version" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),

    CONSTRAINT "card_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_export_item" (
    "export_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "qr_payload" TEXT NOT NULL,
    "card_state" TEXT NOT NULL,
    "assignment_eligible" BOOLEAN NOT NULL,

    CONSTRAINT "card_export_item_pkey" PRIMARY KEY ("export_id","card_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_export_object_key_key" ON "card_export"("object_key");

-- CreateIndex
CREATE INDEX "card_export_status_next_attempt_at_idx" ON "card_export"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "card_export_created_by_operation_id_key" ON "card_export"("created_by", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_export_item_export_id_ordinal_key" ON "card_export_item"("export_id", "ordinal");

-- Preserve unknown historical provenance; new application registrations always supply both.
ALTER TABLE customer ADD CONSTRAINT fk_customer_registered_station FOREIGN KEY(registered_station_id) REFERENCES station(id) ON DELETE RESTRICT;
ALTER TABLE customer ADD CONSTRAINT fk_customer_registered_by FOREIGN KEY(registered_by_user_id) REFERENCES auth_user(id) ON DELETE RESTRICT;
ALTER TABLE customer ADD CONSTRAINT ck_customer_provenance_pair CHECK((registered_station_id IS NULL)=(registered_by_user_id IS NULL));
ALTER TABLE card_batch ADD CONSTRAINT ck_batch_name CHECK(name IS NULL OR length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE card_export ADD CONSTRAINT fk_export_batch FOREIGN KEY(batch_id) REFERENCES card_batch(id) ON DELETE RESTRICT;
ALTER TABLE card_export ADD CONSTRAINT fk_export_creator FOREIGN KEY(created_by) REFERENCES admin(id) ON DELETE RESTRICT;
ALTER TABLE card_export ADD CONSTRAINT ck_export_format CHECK(format IN('pdf','xlsx'));
ALTER TABLE card_export ADD CONSTRAINT ck_export_batch_version CHECK(batch_version>0);
ALTER TABLE card_export ADD CONSTRAINT ck_export_batch_status CHECK(batch_status IN('generated','printed','active'));
ALTER TABLE card_export ADD CONSTRAINT ck_export_status CHECK(status IN('pending','ready','failed','expired'));
ALTER TABLE card_export ADD CONSTRAINT ck_export_failure CHECK((status='failed' AND failure_code='preparation_failed') OR(status<>'failed' AND failure_code IS NULL));
ALTER TABLE card_export ADD CONSTRAINT ck_export_lease CHECK((lease_nonce IS NULL)=(lease_until IS NULL) AND fencing_version>=0 AND attempts>=0);
ALTER TABLE card_export ADD CONSTRAINT ck_export_ready CHECK(status<>'ready' OR(prepared_at IS NOT NULL AND expires_at>prepared_at AND object_key LIKE 'final/card-exports/%' AND sha256 ~ '^[a-f0-9]{64}$' AND byte_size>0));
ALTER TABLE card_export_item ADD CONSTRAINT fk_export_item_export FOREIGN KEY(export_id) REFERENCES card_export(id) ON DELETE RESTRICT;
ALTER TABLE card_export_item ADD CONSTRAINT fk_export_item_card FOREIGN KEY(card_id) REFERENCES card(id) ON DELETE RESTRICT;
ALTER TABLE card_export_item ADD CONSTRAINT ck_export_ordinal CHECK(ordinal>0);
ALTER TABLE card_export_item ADD CONSTRAINT ck_export_card_state CHECK(card_state IN('unassigned','linked','retired'));
ALTER TABLE card_export_item ADD CONSTRAINT ck_export_payload CHECK(code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$' AND qr_payload=code);
CREATE TRIGGER guard_card_export BEFORE UPDATE OR DELETE ON card_export FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('status','prepared_at','expires_at','object_key','sha256','byte_size','failure_code','lease_nonce','lease_until','fencing_version','attempts','next_attempt_at');
CREATE TRIGGER guard_card_export_item BEFORE UPDATE OR DELETE ON card_export_item FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE FUNCTION guard_card_export_item_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_export e JOIN card c ON c.batch_id=e.batch_id WHERE e.id=NEW.export_id AND c.id=NEW.card_id AND c.code=NEW.code AND c.qr_payload=NEW.qr_payload AND c.state=NEW.card_state AND NEW.assignment_eligible=(e.batch_status='active' AND c.state='unassigned') AND(e.format='xlsx' OR c.state='unassigned') AND e.status='pending' AND e.fencing_version=0) THEN
 RAISE EXCEPTION 'invalid export inventory snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_card_export_item_insert BEFORE INSERT ON card_export_item FOR EACH ROW EXECUTE FUNCTION guard_card_export_item_insert();
