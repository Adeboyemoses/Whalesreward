-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "auth_user" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "username_normalized" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "must_change_password" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credential" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendant" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "staff_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "attendant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "admin_code" TEXT NOT NULL,
    "email_normalized" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "role_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "is_owner" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "required_view_code" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "secret_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "auth_version" INTEGER NOT NULL,
    "last_online_sign_in_at" TIMESTAMPTZ(6) NOT NULL,
    "assignment_id" UUID,
    "capture_context_id" UUID,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_challenge" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "customer_id" UUID,
    "purpose" TEXT NOT NULL,
    "target_digest" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "operation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "verification_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_grant" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_id" UUID NOT NULL,
    "originating_attendant_id" UUID NOT NULL,
    "device_binding_digest" TEXT NOT NULL,
    "manifest_digest" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,

    CONSTRAINT "recovery_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_grant_item" (
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "photo_digest" TEXT NOT NULL,

    CONSTRAINT "recovery_grant_item_pkey" PRIMARY KEY ("grant_id","operation_id")
);

-- CreateTable
CREATE TABLE "station" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "station_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "pump_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendant_id" UUID NOT NULL,
    "pump_id" UUID NOT NULL,
    "assignment_version" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_until" TIMESTAMPTZ(6),
    "changed_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_version" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "station_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rate_kobo" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "quantity_precision" SMALLINT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "product_price_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_context" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "signed_in_at" TIMESTAMPTZ(6) NOT NULL,
    "offline_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "seller_name" TEXT NOT NULL,
    "seller_username" TEXT NOT NULL,
    "device_binding_digest" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "capture_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_batch" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "card_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "qr_payload" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "retirement_reason" TEXT,
    "replaced_by_card_id" UUID,
    "version" INTEGER NOT NULL,

    CONSTRAINT "card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_customer_link" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "card_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "actor_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "card_customer_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_identity_change" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "challenge_id" UUID,
    "manager_review_reason" TEXT,
    "verification_evidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "customer_identity_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originating_attendant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "sale_code" TEXT NOT NULL,
    "capture_context_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "pump_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "seller_name" TEXT NOT NULL,
    "seller_username" TEXT NOT NULL,
    "card_code" TEXT NOT NULL,
    "app_captured_at" TIMESTAMPTZ(6) NOT NULL,
    "server_received_at" TIMESTAMPTZ(6) NOT NULL,
    "price_version_id" UUID NOT NULL,
    "basis" TEXT NOT NULL,
    "entered_amount_kobo" BIGINT,
    "entered_quantity" DECIMAL(20,6),
    "amount_kobo" BIGINT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "rate_kobo" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity_precision" SMALLINT NOT NULL,
    "medium" TEXT NOT NULL,
    "expected_photo_digest" TEXT NOT NULL,
    "expected_photo_bytes" BIGINT NOT NULL,
    "card_id" UUID,
    "customer_id" UUID,
    "status" TEXT NOT NULL,
    "current_revision_id" UUID,
    "verified_sale_date" DATE,
    "cancellation_reason" TEXT,
    "version" INTEGER NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_revision" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "operation_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "based_on_revision_id" UUID,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "server_received_at" TIMESTAMPTZ(6) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity_precision" SMALLINT NOT NULL,
    "basis" TEXT NOT NULL,
    "entered_amount_kobo" BIGINT,
    "entered_quantity" DECIMAL(20,6),
    "rate_kobo" BIGINT NOT NULL,
    "price_version_id" UUID NOT NULL,
    "medium" TEXT NOT NULL,
    "verified_sale_date" DATE,
    "evidence_asset_id" UUID,
    "decision_actor_id" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_asset" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_id" UUID NOT NULL,
    "upload_operation_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "staging_key" TEXT NOT NULL,
    "staging_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "expected_digest" TEXT NOT NULL,
    "expected_bytes" BIGINT NOT NULL,
    "final_key" TEXT,
    "validated_digest" TEXT,
    "validated_bytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "media_type" TEXT,
    "validated_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_run_id" UUID,

    CONSTRAINT "photo_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_hold" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "opened_revision_id" UUID NOT NULL,
    "reason_code" TEXT NOT NULL,
    "resolved_by" UUID,
    "resolution_operation_id" UUID,
    "resolution_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_revision_id" UUID,
    "version" INTEGER NOT NULL,

    CONSTRAINT "purchase_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_flag" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_id" UUID NOT NULL,
    "other_purchase_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "resolved_by" UUID,
    "resolution_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "operation_id" UUID,
    "version" INTEGER NOT NULL,

    CONSTRAINT "duplicate_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "station_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reconciliation_required" BOOLEAN NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_version" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "station_id" UUID NOT NULL,
    "campaign_id" UUID,
    "version" INTEGER NOT NULL,
    "purchase_start" TIMESTAMPTZ(6),
    "purchase_cutoff" TIMESTAMPTZ(6),
    "upload_deadline" TIMESTAMPTZ(6),
    "timezone" TEXT NOT NULL,
    "retention_days" INTEGER,
    "retention_approved_by" UUID,
    "retention_approved_at" TIMESTAMPTZ(6),
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "settings_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_snapshot" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaign_id" UUID NOT NULL,
    "settings_version_id" UUID NOT NULL,
    "snapshot_number" INTEGER NOT NULL,
    "previous_snapshot_id" UUID,
    "operation_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "tie_rule" TEXT NOT NULL,
    "finalized_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "giveaway_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_snapshot_row" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "qualifying_spend_kobo" DECIMAL(30,0) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "transaction_count" BIGINT NOT NULL,
    "overall_rank" BIGINT NOT NULL,
    "category_rank" BIGINT NOT NULL,

    CONSTRAINT "giveaway_snapshot_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_snapshot_source" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "revision_id" UUID,
    "included" BOOLEAN NOT NULL,
    "exclusion_reason" TEXT,

    CONSTRAINT "giveaway_snapshot_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "operation_id" UUID,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_run" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "job" TEXT NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" JSONB,
    "lease_owner" TEXT,
    "lease_until" TIMESTAMPTZ(6),
    "fencing_version" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "outcome" JSONB,

    CONSTRAINT "maintenance_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_username_normalized" ON "auth_user"("username_normalized");

-- CreateIndex
CREATE INDEX "auth_credential_user_id_idx" ON "auth_credential"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_credential_provider_account" ON "auth_credential"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_attendant_user_id" ON "attendant"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_attendant_staff_code" ON "attendant"("staff_code");

-- CreateIndex
CREATE INDEX "admin_role_id_idx" ON "admin"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admin_user_id" ON "admin"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admin_admin_code" ON "admin"("admin_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_admin_email_normalized" ON "admin"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_name" ON "role"("name");

-- CreateIndex
CREATE INDEX "permission_required_view_code_idx" ON "permission"("required_view_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_permission_code" ON "permission"("code");

-- CreateIndex
CREATE INDEX "role_permission_role_id_idx" ON "role_permission"("role_id");

-- CreateIndex
CREATE INDEX "role_permission_permission_code_idx" ON "role_permission"("permission_code");

-- CreateIndex
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");

-- CreateIndex
CREATE INDEX "auth_session_assignment_id_idx" ON "auth_session"("assignment_id");

-- CreateIndex
CREATE INDEX "auth_session_capture_context_id_idx" ON "auth_session"("capture_context_id");

-- CreateIndex
CREATE INDEX "auth_session_user_id_revoked_at_expires_at_idx" ON "auth_session"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_auth_session_secret_verifier" ON "auth_session"("secret_verifier");

-- CreateIndex
CREATE INDEX "verification_challenge_user_id_idx" ON "verification_challenge"("user_id");

-- CreateIndex
CREATE INDEX "verification_challenge_customer_id_idx" ON "verification_challenge"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_verification_challenge_secret_hash" ON "verification_challenge"("secret_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_verification_challenge_operation_id" ON "verification_challenge"("operation_id");

-- CreateIndex
CREATE INDEX "recovery_grant_admin_id_idx" ON "recovery_grant"("admin_id");

-- CreateIndex
CREATE INDEX "recovery_grant_originating_attendant_id_idx" ON "recovery_grant"("originating_attendant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_recovery_grant_secret_hash" ON "recovery_grant"("secret_hash");

-- CreateIndex
CREATE INDEX "recovery_grant_item_grant_id_idx" ON "recovery_grant_item"("grant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_station_code" ON "station"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_code" ON "product"("code");

-- CreateIndex
CREATE INDEX "pump_station_id_idx" ON "pump"("station_id");

-- CreateIndex
CREATE INDEX "pump_product_id_idx" ON "pump"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pump_station_id_code" ON "pump"("station_id", "code");

-- CreateIndex
CREATE INDEX "assignment_attendant_id_idx" ON "assignment"("attendant_id");

-- CreateIndex
CREATE INDEX "assignment_pump_id_idx" ON "assignment"("pump_id");

-- CreateIndex
CREATE INDEX "assignment_changed_by_idx" ON "assignment"("changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_assignment_attendant_id_assignment_version" ON "assignment"("attendant_id", "assignment_version");

-- CreateIndex
CREATE INDEX "product_price_version_station_id_idx" ON "product_price_version"("station_id");

-- CreateIndex
CREATE INDEX "product_price_version_product_id_idx" ON "product_price_version"("product_id");

-- CreateIndex
CREATE INDEX "product_price_version_actor_id_idx" ON "product_price_version"("actor_id");

-- CreateIndex
CREATE INDEX "product_price_version_station_id_product_id_effective_from_idx" ON "product_price_version"("station_id", "product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_price_version_station_id_product_id_version" ON "product_price_version"("station_id", "product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_price_version_station_id_product_id_effective_from" ON "product_price_version"("station_id", "product_id", "effective_from");

-- CreateIndex
CREATE INDEX "capture_context_attendant_id_idx" ON "capture_context"("attendant_id");

-- CreateIndex
CREATE INDEX "capture_context_assignment_id_idx" ON "capture_context"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_customer_code" ON "customer"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_phone" ON "customer"("phone_normalized");

-- CreateIndex
CREATE INDEX "card_batch_created_by_idx" ON "card_batch"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_card_batch_batch_code" ON "card_batch"("batch_code");

-- CreateIndex
CREATE INDEX "card_batch_id_idx" ON "card"("batch_id");

-- CreateIndex
CREATE INDEX "card_replaced_by_card_id_idx" ON "card"("replaced_by_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_card_code" ON "card"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_card_qr_payload" ON "card"("qr_payload");

-- CreateIndex
CREATE INDEX "card_customer_link_customer_id_idx" ON "card_customer_link"("customer_id");

-- CreateIndex
CREATE INDEX "card_customer_link_actor_user_id_idx" ON "card_customer_link"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_card_customer_link_card_id" ON "card_customer_link"("card_id");

-- CreateIndex
CREATE INDEX "customer_identity_change_customer_id_idx" ON "customer_identity_change"("customer_id");

-- CreateIndex
CREATE INDEX "customer_identity_change_actor_id_idx" ON "customer_identity_change"("actor_id");

-- CreateIndex
CREATE INDEX "customer_identity_change_challenge_id_idx" ON "customer_identity_change"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customer_identity_change_actor_id_operation_id" ON "customer_identity_change"("actor_id", "operation_id");

-- CreateIndex
CREATE INDEX "purchase_originating_attendant_id_idx" ON "purchase"("originating_attendant_id");

-- CreateIndex
CREATE INDEX "purchase_capture_context_id_idx" ON "purchase"("capture_context_id");

-- CreateIndex
CREATE INDEX "purchase_assignment_id_idx" ON "purchase"("assignment_id");

-- CreateIndex
CREATE INDEX "purchase_station_id_idx" ON "purchase"("station_id");

-- CreateIndex
CREATE INDEX "purchase_pump_id_idx" ON "purchase"("pump_id");

-- CreateIndex
CREATE INDEX "purchase_product_id_idx" ON "purchase"("product_id");

-- CreateIndex
CREATE INDEX "purchase_price_version_id_idx" ON "purchase"("price_version_id");

-- CreateIndex
CREATE INDEX "purchase_card_id_idx" ON "purchase"("card_id");

-- CreateIndex
CREATE INDEX "purchase_customer_id_idx" ON "purchase"("customer_id");

-- CreateIndex
CREATE INDEX "purchase_station_id_server_received_at_idx" ON "purchase"("station_id", "server_received_at");

-- CreateIndex
CREATE INDEX "purchase_originating_attendant_id_server_received_at_idx" ON "purchase"("originating_attendant_id", "server_received_at");

-- CreateIndex
CREATE INDEX "purchase_status_idx" ON "purchase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_operation" ON "purchase"("originating_attendant_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_sale_code" ON "purchase"("sale_code");

-- CreateIndex
CREATE INDEX "purchase_revision_purchase_id_idx" ON "purchase_revision"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_revision_actor_user_id_idx" ON "purchase_revision"("actor_user_id");

-- CreateIndex
CREATE INDEX "purchase_revision_based_on_revision_id_idx" ON "purchase_revision"("based_on_revision_id");

-- CreateIndex
CREATE INDEX "purchase_revision_price_version_id_idx" ON "purchase_revision"("price_version_id");

-- CreateIndex
CREATE INDEX "purchase_revision_evidence_asset_id_idx" ON "purchase_revision"("evidence_asset_id");

-- CreateIndex
CREATE INDEX "purchase_revision_decision_actor_id_idx" ON "purchase_revision"("decision_actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_revision_purchase_id_revision_number" ON "purchase_revision"("purchase_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_revision_actor_user_id_operation_id" ON "purchase_revision"("actor_user_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_revision_purchase_id_id" ON "purchase_revision"("purchase_id", "id");

-- CreateIndex
CREATE INDEX "photo_asset_purchase_id_idx" ON "photo_asset"("purchase_id");

-- CreateIndex
CREATE INDEX "photo_asset_deletion_run_id_idx" ON "photo_asset"("deletion_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_photo_asset_purchase_id_id" ON "photo_asset"("purchase_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_photo_asset_purchase_id_upload_operation_id" ON "photo_asset"("purchase_id", "upload_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_photo_asset_staging_key" ON "photo_asset"("staging_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_photo_asset_final_key" ON "photo_asset"("final_key");

-- CreateIndex
CREATE INDEX "purchase_hold_purchase_id_idx" ON "purchase_hold"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_hold_opened_revision_id_idx" ON "purchase_hold"("opened_revision_id");

-- CreateIndex
CREATE INDEX "purchase_hold_resolved_by_idx" ON "purchase_hold"("resolved_by");

-- CreateIndex
CREATE INDEX "purchase_hold_resolution_revision_id_idx" ON "purchase_hold"("resolution_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_purchase_hold_resolved_by_resolution_operation_id" ON "purchase_hold"("resolved_by", "resolution_operation_id");

-- CreateIndex
CREATE INDEX "duplicate_flag_purchase_id_idx" ON "duplicate_flag"("purchase_id");

-- CreateIndex
CREATE INDEX "duplicate_flag_other_purchase_id_idx" ON "duplicate_flag"("other_purchase_id");

-- CreateIndex
CREATE INDEX "duplicate_flag_resolved_by_idx" ON "duplicate_flag"("resolved_by");

-- CreateIndex
CREATE UNIQUE INDEX "uq_duplicate_flag_purchase_id_other_purchase_id" ON "duplicate_flag"("purchase_id", "other_purchase_id");

-- CreateIndex
CREATE INDEX "campaign_station_id_idx" ON "campaign"("station_id");

-- CreateIndex
CREATE INDEX "settings_version_station_id_idx" ON "settings_version"("station_id");

-- CreateIndex
CREATE INDEX "settings_version_campaign_id_idx" ON "settings_version"("campaign_id");

-- CreateIndex
CREATE INDEX "settings_version_retention_approved_by_idx" ON "settings_version"("retention_approved_by");

-- CreateIndex
CREATE INDEX "settings_version_actor_id_idx" ON "settings_version"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_settings_version_station_id_version" ON "settings_version"("station_id", "version");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_campaign_id_idx" ON "giveaway_snapshot"("campaign_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_settings_version_id_idx" ON "giveaway_snapshot"("settings_version_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_previous_snapshot_id_idx" ON "giveaway_snapshot"("previous_snapshot_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_actor_id_idx" ON "giveaway_snapshot"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_giveaway_snapshot_campaign_id_snapshot_number" ON "giveaway_snapshot"("campaign_id", "snapshot_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_giveaway_snapshot_actor_id_operation_id" ON "giveaway_snapshot"("actor_id", "operation_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_row_snapshot_id_idx" ON "giveaway_snapshot_row"("snapshot_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_row_customer_id_idx" ON "giveaway_snapshot_row"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_giveaway_snapshot_row_snapshot_id_customer_id" ON "giveaway_snapshot_row"("snapshot_id", "customer_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_source_snapshot_id_idx" ON "giveaway_snapshot_source"("snapshot_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_source_purchase_id_idx" ON "giveaway_snapshot_source"("purchase_id");

-- CreateIndex
CREATE INDEX "giveaway_snapshot_source_revision_id_idx" ON "giveaway_snapshot_source"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_giveaway_snapshot_source_snapshot_id_purchase_id" ON "giveaway_snapshot_source"("snapshot_id", "purchase_id");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_idx" ON "audit_event"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_event_target_type_target_id_occurred_at_idx" ON "audit_event"("target_type", "target_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_occurred_at_idx" ON "audit_event"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "maintenance_run_status_next_attempt_at_idx" ON "maintenance_run"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_maintenance_run_job_deduplication_key" ON "maintenance_run"("job", "deduplication_key");

-- AddForeignKey
ALTER TABLE "auth_credential" ADD CONSTRAINT "auth_credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attendant" ADD CONSTRAINT "attendant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "admin" ADD CONSTRAINT "admin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "admin" ADD CONSTRAINT "admin_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "permission" ADD CONSTRAINT "permission_required_view_code_fkey" FOREIGN KEY ("required_view_code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_capture_context_id_fkey" FOREIGN KEY ("capture_context_id") REFERENCES "capture_context"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "verification_challenge" ADD CONSTRAINT "verification_challenge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "verification_challenge" ADD CONSTRAINT "verification_challenge_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recovery_grant" ADD CONSTRAINT "recovery_grant_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recovery_grant" ADD CONSTRAINT "recovery_grant_originating_attendant_id_fkey" FOREIGN KEY ("originating_attendant_id") REFERENCES "attendant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recovery_grant_item" ADD CONSTRAINT "recovery_grant_item_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "recovery_grant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pump" ADD CONSTRAINT "pump_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pump" ADD CONSTRAINT "pump_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "attendant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_pump_id_fkey" FOREIGN KEY ("pump_id") REFERENCES "pump"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_price_version" ADD CONSTRAINT "product_price_version_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_price_version" ADD CONSTRAINT "product_price_version_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_price_version" ADD CONSTRAINT "product_price_version_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "capture_context" ADD CONSTRAINT "capture_context_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "attendant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "capture_context" ADD CONSTRAINT "capture_context_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card_batch" ADD CONSTRAINT "card_batch_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "card_batch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_replaced_by_card_id_fkey" FOREIGN KEY ("replaced_by_card_id") REFERENCES "card"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card_customer_link" ADD CONSTRAINT "card_customer_link_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card_customer_link" ADD CONSTRAINT "card_customer_link_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "card_customer_link" ADD CONSTRAINT "card_customer_link_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "customer_identity_change_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "customer_identity_change_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "customer_identity_change_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "verification_challenge"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_originating_attendant_id_fkey" FOREIGN KEY ("originating_attendant_id") REFERENCES "attendant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_capture_context_id_fkey" FOREIGN KEY ("capture_context_id") REFERENCES "capture_context"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_pump_id_fkey" FOREIGN KEY ("pump_id") REFERENCES "pump"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "product_price_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_based_on_revision_id_fkey" FOREIGN KEY ("based_on_revision_id") REFERENCES "purchase_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "product_price_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_evidence_asset_id_fkey" FOREIGN KEY ("evidence_asset_id") REFERENCES "photo_asset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_revision" ADD CONSTRAINT "purchase_revision_decision_actor_id_fkey" FOREIGN KEY ("decision_actor_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "photo_asset" ADD CONSTRAINT "photo_asset_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "photo_asset" ADD CONSTRAINT "photo_asset_deletion_run_id_fkey" FOREIGN KEY ("deletion_run_id") REFERENCES "maintenance_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_hold" ADD CONSTRAINT "purchase_hold_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_hold" ADD CONSTRAINT "purchase_hold_opened_revision_id_fkey" FOREIGN KEY ("opened_revision_id") REFERENCES "purchase_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_hold" ADD CONSTRAINT "purchase_hold_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_hold" ADD CONSTRAINT "purchase_hold_resolution_revision_id_fkey" FOREIGN KEY ("resolution_revision_id") REFERENCES "purchase_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "duplicate_flag_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "duplicate_flag_other_purchase_id_fkey" FOREIGN KEY ("other_purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "duplicate_flag_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settings_version" ADD CONSTRAINT "settings_version_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settings_version" ADD CONSTRAINT "settings_version_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settings_version" ADD CONSTRAINT "settings_version_retention_approved_by_fkey" FOREIGN KEY ("retention_approved_by") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settings_version" ADD CONSTRAINT "settings_version_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "giveaway_snapshot_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "giveaway_snapshot_settings_version_id_fkey" FOREIGN KEY ("settings_version_id") REFERENCES "settings_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "giveaway_snapshot_previous_snapshot_id_fkey" FOREIGN KEY ("previous_snapshot_id") REFERENCES "giveaway_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "giveaway_snapshot_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "giveaway_snapshot_row_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "giveaway_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "giveaway_snapshot_row_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot_source" ADD CONSTRAINT "giveaway_snapshot_source_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "giveaway_snapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot_source" ADD CONSTRAINT "giveaway_snapshot_source_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "giveaway_snapshot_source" ADD CONSTRAINT "giveaway_snapshot_source_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "purchase_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Reviewed SQL-only constraints and immutable history guards.
ALTER TABLE "auth_user" ADD CONSTRAINT "ck_auth_user_kind" CHECK (kind IN ('attendant', 'admin'));
ALTER TABLE "auth_user" ADD CONSTRAINT "ck_auth_user_username_nonempty" CHECK (length(btrim(username)) > 0);
ALTER TABLE "auth_user" ADD CONSTRAINT "ck_auth_user_username_normalized_nonempty" CHECK (length(btrim(username_normalized)) > 0);
ALTER TABLE "auth_user" ADD CONSTRAINT "ck_auth_user_display_name_nonempty" CHECK (length(btrim(display_name)) > 0);
ALTER TABLE "auth_user" ADD CONSTRAINT "ck_auth_user_auth_version" CHECK (auth_version > 0);
ALTER TABLE "auth_credential" ADD CONSTRAINT "ck_auth_credential_provider_nonempty" CHECK (length(btrim(provider)) > 0);
ALTER TABLE "auth_credential" ADD CONSTRAINT "ck_auth_credential_provider_account_id_nonempty" CHECK (length(btrim(provider_account_id)) > 0);
ALTER TABLE "auth_credential" ADD CONSTRAINT "ck_auth_credential_password_hash_nonempty" CHECK (password_hash IS NULL OR length(btrim(password_hash)) > 0);
ALTER TABLE "attendant" ADD CONSTRAINT "ck_attendant_staff_code_nonempty" CHECK (length(btrim(staff_code)) > 0);
ALTER TABLE "attendant" ADD CONSTRAINT "ck_attendant_version" CHECK (version > 0);
ALTER TABLE "admin" ADD CONSTRAINT "ck_admin_admin_code_nonempty" CHECK (length(btrim(admin_code)) > 0);
ALTER TABLE "admin" ADD CONSTRAINT "ck_admin_email_normalized_nonempty" CHECK (email_normalized IS NULL OR length(btrim(email_normalized)) > 0);
ALTER TABLE "admin" ADD CONSTRAINT "ck_admin_version" CHECK (version > 0);
ALTER TABLE "role" ADD CONSTRAINT "ck_role_name_nonempty" CHECK (length(btrim(name)) > 0);
ALTER TABLE "role" ADD CONSTRAINT "ck_role_version" CHECK (version > 0);
ALTER TABLE "permission" ADD CONSTRAINT "ck_permission_code_nonempty" CHECK (length(btrim(code)) > 0);
ALTER TABLE "permission" ADD CONSTRAINT "ck_permission_required_view_code_nonempty" CHECK (required_view_code IS NULL OR length(btrim(required_view_code)) > 0);
ALTER TABLE "role_permission" ADD CONSTRAINT "ck_role_permission_permission_code_nonempty" CHECK (length(btrim(permission_code)) > 0);
ALTER TABLE "auth_session" ADD CONSTRAINT "ck_auth_session_secret_verifier_nonempty" CHECK (length(btrim(secret_verifier)) > 0);
ALTER TABLE "auth_session" ADD CONSTRAINT "ck_auth_session_auth_version" CHECK (auth_version > 0);
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_verification_challenge_purpose" CHECK (purpose IN ('verify_email', 'reset_password', 'replace_card'));
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_verification_challenge_target_digest_nonempty" CHECK (length(btrim(target_digest)) > 0);
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_verification_challenge_secret_hash_nonempty" CHECK (length(btrim(secret_hash)) > 0);
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_verification_challenge_version" CHECK (version > 0);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_grant_device_binding_digest_nonempty" CHECK (length(btrim(device_binding_digest)) > 0);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_grant_manifest_digest_nonempty" CHECK (length(btrim(manifest_digest)) > 0);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_grant_secret_hash_nonempty" CHECK (length(btrim(secret_hash)) > 0);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_grant_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_grant_version" CHECK (version > 0);
ALTER TABLE "recovery_grant_item" ADD CONSTRAINT "ck_recovery_grant_item_payload_digest_nonempty" CHECK (length(btrim(payload_digest)) > 0);
ALTER TABLE "recovery_grant_item" ADD CONSTRAINT "ck_recovery_grant_item_photo_digest_nonempty" CHECK (length(btrim(photo_digest)) > 0);
ALTER TABLE "station" ADD CONSTRAINT "ck_station_code_nonempty" CHECK (length(btrim(code)) > 0);
ALTER TABLE "station" ADD CONSTRAINT "ck_station_name_nonempty" CHECK (length(btrim(name)) > 0);
ALTER TABLE "station" ADD CONSTRAINT "ck_station_timezone_nonempty" CHECK (length(btrim(timezone)) > 0);
ALTER TABLE "station" ADD CONSTRAINT "ck_station_version" CHECK (version > 0);
ALTER TABLE "product" ADD CONSTRAINT "ck_product_code" CHECK (code IN ('pms', 'diesel', 'kerosene', 'cooking_gas'));
ALTER TABLE "product" ADD CONSTRAINT "ck_product_unit" CHECK (unit IN ('litre', 'kilogram'));
ALTER TABLE "pump" ADD CONSTRAINT "ck_pump_code_nonempty" CHECK (length(btrim(code)) > 0);
ALTER TABLE "pump" ADD CONSTRAINT "ck_pump_version" CHECK (version > 0);
ALTER TABLE "assignment" ADD CONSTRAINT "ck_assignment_assignment_version" CHECK (assignment_version > 0);
ALTER TABLE "assignment" ADD CONSTRAINT "ck_assignment_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_version" CHECK (version > 0);
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_rate_kobo_positive" CHECK (rate_kobo > 0);
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_currency_nonempty" CHECK (length(btrim(currency)) > 0);
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_currency" CHECK (currency = 'NGN');
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_precision" CHECK (quantity_precision BETWEEN 0 AND 6);
ALTER TABLE "product_price_version" ADD CONSTRAINT "ck_product_price_version_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "capture_context" ADD CONSTRAINT "ck_capture_context_seller_name_nonempty" CHECK (length(btrim(seller_name)) > 0);
ALTER TABLE "capture_context" ADD CONSTRAINT "ck_capture_context_seller_username_nonempty" CHECK (length(btrim(seller_username)) > 0);
ALTER TABLE "capture_context" ADD CONSTRAINT "ck_capture_context_device_binding_digest_nonempty" CHECK (length(btrim(device_binding_digest)) > 0);
ALTER TABLE "customer" ADD CONSTRAINT "ck_customer_customer_code_nonempty" CHECK (length(btrim(customer_code)) > 0);
ALTER TABLE "customer" ADD CONSTRAINT "ck_customer_name_nonempty" CHECK (length(btrim(name)) > 0);
ALTER TABLE "customer" ADD CONSTRAINT "ck_customer_phone_normalized_nonempty" CHECK (length(btrim(phone_normalized)) > 0);
ALTER TABLE "customer" ADD CONSTRAINT "ck_customer_category" CHECK (category IN ('car_owner', 'commercial_bus_driver', 'three_wheeler_user', 'bike_user', 'keg_buyer', 'cooking_gas_customer'));
ALTER TABLE "customer" ADD CONSTRAINT "ck_customer_version" CHECK (version > 0);
ALTER TABLE "card_batch" ADD CONSTRAINT "ck_card_batch_batch_code_nonempty" CHECK (length(btrim(batch_code)) > 0);
ALTER TABLE "card_batch" ADD CONSTRAINT "ck_card_batch_status" CHECK (status IN ('generated', 'printed', 'active'));
ALTER TABLE "card_batch" ADD CONSTRAINT "ck_card_batch_version" CHECK (version > 0);
ALTER TABLE "card" ADD CONSTRAINT "ck_card_code_nonempty" CHECK (length(btrim(code)) > 0);
ALTER TABLE "card" ADD CONSTRAINT "ck_card_qr_payload_nonempty" CHECK (length(btrim(qr_payload)) > 0);
ALTER TABLE "card" ADD CONSTRAINT "ck_card_state" CHECK (state IN ('unassigned', 'linked', 'retired'));
ALTER TABLE "card" ADD CONSTRAINT "ck_card_retirement_reason_nonempty" CHECK (retirement_reason IS NULL OR length(btrim(retirement_reason)) > 0);
ALTER TABLE "card" ADD CONSTRAINT "ck_card_version" CHECK (version > 0);
ALTER TABLE "card_customer_link" ADD CONSTRAINT "ck_card_customer_link_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "ck_customer_identity_change_kind" CHECK (kind IN ('phone_change', 'card_replacement'));
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "ck_customer_identity_change_manager_review_reason_nonempty" CHECK (manager_review_reason IS NULL OR length(btrim(manager_review_reason)) > 0);
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "ck_customer_identity_change_verification_evidence_nonempty" CHECK (length(btrim(verification_evidence)) > 0);
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "ck_customer_identity_change_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_payload_digest_nonempty" CHECK (length(btrim(payload_digest)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_sale_code_nonempty" CHECK (length(btrim(sale_code)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_seller_name_nonempty" CHECK (length(btrim(seller_name)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_seller_username_nonempty" CHECK (length(btrim(seller_username)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_card_code_nonempty" CHECK (length(btrim(card_code)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_basis" CHECK (basis IN ('amount', 'quantity'));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_entered_amount_kobo_positive" CHECK (entered_amount_kobo > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_entered_quantity_positive" CHECK (entered_quantity > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_amount_kobo_positive" CHECK (amount_kobo > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_rate_kobo_positive" CHECK (rate_kobo > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_currency_nonempty" CHECK (length(btrim(currency)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_currency" CHECK (currency = 'NGN');
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_unit" CHECK (unit IN ('litre', 'kilogram'));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_precision" CHECK (quantity_precision BETWEEN 0 AND 6);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_medium" CHECK (medium IN ('vehicle', 'keg', 'three_wheeler', 'bike', 'cylinder'));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_expected_photo_digest_nonempty" CHECK (length(btrim(expected_photo_digest)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_expected_photo_bytes_positive" CHECK (expected_photo_bytes > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_status" CHECK (status IN ('received', 'photo_pending', 'finalizing', 'credited', 'held', 'cancelled'));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_cancellation_reason_nonempty" CHECK (cancellation_reason IS NULL OR length(btrim(cancellation_reason)) > 0);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_version" CHECK (version > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_revision_number_positive" CHECK (revision_number > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_payload_digest_nonempty" CHECK (length(btrim(payload_digest)) > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_kind" CHECK (kind IN ('original', 'attendant_correction', 'admin_correction', 'price_resolution', 'date_resolution'));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_state" CHECK (state IN ('proposed', 'accepted', 'rejected', 'superseded'));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_reason_nonempty" CHECK (reason IS NULL OR length(btrim(reason)) > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_amount_kobo_positive" CHECK (amount_kobo > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_currency_nonempty" CHECK (length(btrim(currency)) > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_currency" CHECK (currency = 'NGN');
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_unit" CHECK (unit IN ('litre', 'kilogram'));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_precision" CHECK (quantity_precision BETWEEN 0 AND 6);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_basis" CHECK (basis IN ('amount', 'quantity'));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_entered_amount_kobo_positive" CHECK (entered_amount_kobo > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_entered_quantity_positive" CHECK (entered_quantity > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_rate_kobo_positive" CHECK (rate_kobo > 0);
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_medium" CHECK (medium IN ('vehicle', 'keg', 'three_wheeler', 'bike', 'cylinder'));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_decision_reason_nonempty" CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_state" CHECK (state IN ('staged', 'validated', 'rejected', 'deleted'));
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_staging_key_nonempty" CHECK (length(btrim(staging_key)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_expected_digest_nonempty" CHECK (length(btrim(expected_digest)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_expected_bytes_positive" CHECK (expected_bytes > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_final_key_nonempty" CHECK (final_key IS NULL OR length(btrim(final_key)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_validated_digest_nonempty" CHECK (validated_digest IS NULL OR length(btrim(validated_digest)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_validated_bytes_positive" CHECK (validated_bytes > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_width_positive" CHECK (width > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_height_positive" CHECK (height > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_media_type_nonempty" CHECK (media_type IS NULL OR length(btrim(media_type)) > 0);
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_photo_asset_rejection_reason_nonempty" CHECK (rejection_reason IS NULL OR length(btrim(rejection_reason)) > 0);
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_purchase_hold_kind" CHECK (kind IN ('price', 'card', 'date'));
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_purchase_hold_state" CHECK (state IN ('open', 'resolved', 'cancelled'));
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_purchase_hold_reason_code_nonempty" CHECK (length(btrim(reason_code)) > 0);
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_purchase_hold_resolution_reason_nonempty" CHECK (resolution_reason IS NULL OR length(btrim(resolution_reason)) > 0);
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_purchase_hold_version" CHECK (version > 0);
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_flag_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_flag_state" CHECK (state IN ('open', 'cleared', 'cancelled'));
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_flag_resolution_reason_nonempty" CHECK (resolution_reason IS NULL OR length(btrim(resolution_reason)) > 0);
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_flag_version" CHECK (version > 0);
ALTER TABLE "campaign" ADD CONSTRAINT "ck_campaign_name_nonempty" CHECK (length(btrim(name)) > 0);
ALTER TABLE "campaign" ADD CONSTRAINT "ck_campaign_version" CHECK (version > 0);
ALTER TABLE "settings_version" ADD CONSTRAINT "ck_settings_version_version" CHECK (version > 0);
ALTER TABLE "settings_version" ADD CONSTRAINT "ck_settings_version_timezone_nonempty" CHECK (length(btrim(timezone)) > 0);
ALTER TABLE "settings_version" ADD CONSTRAINT "ck_settings_version_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "ck_giveaway_snapshot_snapshot_number_positive" CHECK (snapshot_number > 0);
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "ck_giveaway_snapshot_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "giveaway_snapshot" ADD CONSTRAINT "ck_giveaway_snapshot_tie_rule_nonempty" CHECK (length(btrim(tie_rule)) > 0);
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_category_nonempty" CHECK (length(btrim(category)) > 0);
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_currency_nonempty" CHECK (length(btrim(currency)) > 0);
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_currency" CHECK (currency = 'NGN');
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_transaction_count_positive" CHECK (transaction_count > 0);
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_overall_rank_positive" CHECK (overall_rank > 0);
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_giveaway_snapshot_row_category_rank_positive" CHECK (category_rank > 0);
ALTER TABLE "giveaway_snapshot_source" ADD CONSTRAINT "ck_giveaway_snapshot_source_exclusion_reason_nonempty" CHECK (exclusion_reason IS NULL OR length(btrim(exclusion_reason)) > 0);
ALTER TABLE "audit_event" ADD CONSTRAINT "ck_audit_event_actor_kind" CHECK (actor_kind IN ('user', 'system'));
ALTER TABLE "audit_event" ADD CONSTRAINT "ck_audit_event_action_nonempty" CHECK (length(btrim(action)) > 0);
ALTER TABLE "audit_event" ADD CONSTRAINT "ck_audit_event_target_type_nonempty" CHECK (length(btrim(target_type)) > 0);
ALTER TABLE "audit_event" ADD CONSTRAINT "ck_audit_event_reason_nonempty" CHECK (length(btrim(reason)) > 0);
ALTER TABLE "maintenance_run" ADD CONSTRAINT "ck_maintenance_run_job_nonempty" CHECK (length(btrim(job)) > 0);
ALTER TABLE "maintenance_run" ADD CONSTRAINT "ck_maintenance_run_deduplication_key_nonempty" CHECK (length(btrim(deduplication_key)) > 0);
ALTER TABLE "maintenance_run" ADD CONSTRAINT "ck_maintenance_run_status" CHECK (status IN ('pending', 'running', 'succeeded', 'failed'));
ALTER TABLE "maintenance_run" ADD CONSTRAINT "ck_maintenance_run_lease_owner_nonempty" CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) > 0);
ALTER TABLE "product" ADD CONSTRAINT "ck_product_unit_pair" CHECK ((code = 'cooking_gas' AND unit = 'kilogram') OR (code <> 'cooking_gas' AND unit = 'litre'));
ALTER TABLE "admin" ADD CONSTRAINT "ck_admin_email_verification" CHECK (email_verified_at IS NULL OR email_normalized IS NOT NULL);
ALTER TABLE "auth_credential" ADD CONSTRAINT "ck_credential_password" CHECK (provider <> 'credential' OR password_hash IS NOT NULL);
ALTER TABLE "auth_session" ADD CONSTRAINT "ck_session_expiry" CHECK (expires_at > created_at);
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_challenge_subject" CHECK ((purpose = 'replace_card' AND customer_id IS NOT NULL AND user_id IS NULL) OR (purpose IN ('verify_email','reset_password') AND user_id IS NOT NULL AND customer_id IS NULL));
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_challenge_attempts" CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts);
ALTER TABLE "verification_challenge" ADD CONSTRAINT "ck_challenge_expiry" CHECK (expires_at > created_at);
ALTER TABLE "recovery_grant" ADD CONSTRAINT "ck_recovery_expiry" CHECK (expires_at > created_at);
ALTER TABLE "assignment" ADD CONSTRAINT "ck_assignment_interval" CHECK (effective_until IS NULL OR effective_until > effective_from);
ALTER TABLE "capture_context" ADD CONSTRAINT "ck_context_window" CHECK (offline_expires_at = signed_in_at + interval '24 hours');
ALTER TABLE "card" ADD CONSTRAINT "ck_card_code" CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$');
ALTER TABLE "card" ADD CONSTRAINT "ck_card_retirement" CHECK ((state='retired' AND retired_at IS NOT NULL AND retirement_reason IS NOT NULL) OR (state<>'retired' AND retired_at IS NULL AND retirement_reason IS NULL AND replaced_by_card_id IS NULL));
ALTER TABLE "card" ADD CONSTRAINT "ck_card_replacement" CHECK (replaced_by_card_id IS NULL OR replaced_by_card_id <> id);
ALTER TABLE "card_customer_link" ADD CONSTRAINT "ck_link_interval" CHECK (ended_at IS NULL OR ended_at > linked_at);
ALTER TABLE "customer_identity_change" ADD CONSTRAINT "ck_identity_verification" CHECK (kind <> 'card_replacement' OR challenge_id IS NOT NULL OR manager_review_reason IS NOT NULL);
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_entry_basis" CHECK ((basis='amount' AND entered_amount_kobo IS NOT NULL AND entered_quantity IS NULL AND amount_kobo=entered_amount_kobo AND quantity=round(amount_kobo::numeric/rate_kobo, quantity_precision)) OR (basis='quantity' AND entered_quantity IS NOT NULL AND entered_amount_kobo IS NULL AND quantity=entered_quantity AND entered_quantity=round(entered_quantity,quantity_precision) AND amount_kobo=round(entered_quantity*rate_kobo,0)));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_medium_unit" CHECK ((unit='kilogram' AND medium='cylinder') OR (unit='litre' AND medium IN ('vehicle','keg','three_wheeler','bike')));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_entry_basis" CHECK ((basis='amount' AND entered_amount_kobo IS NOT NULL AND entered_quantity IS NULL AND amount_kobo=entered_amount_kobo AND quantity=round(amount_kobo::numeric/rate_kobo, quantity_precision)) OR (basis='quantity' AND entered_quantity IS NOT NULL AND entered_amount_kobo IS NULL AND quantity=entered_quantity AND entered_quantity=round(entered_quantity,quantity_precision) AND amount_kobo=round(entered_quantity*rate_kobo,0)));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_purchase_revision_medium_unit" CHECK ((unit='kilogram' AND medium='cylinder') OR (unit='litre' AND medium IN ('vehicle','keg','three_wheeler','bike')));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_cancel_reason" CHECK ((status='cancelled') = (cancellation_reason IS NOT NULL));
ALTER TABLE "purchase" ADD CONSTRAINT "ck_purchase_digest" CHECK (expected_photo_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_revision_base" CHECK ((kind='original' AND based_on_revision_id IS NULL) OR (kind<>'original' AND based_on_revision_id IS NOT NULL AND reason IS NOT NULL));
ALTER TABLE "purchase_revision" ADD CONSTRAINT "ck_revision_decision" CHECK (state='proposed' OR (decision_actor_id IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL));
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_asset_digest" CHECK (expected_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE "photo_asset" ADD CONSTRAINT "ck_validated_asset" CHECK ((state NOT IN ('validated','deleted') OR (final_key IS NOT NULL AND validated_digest=expected_digest AND validated_digest IS NOT NULL AND validated_bytes=expected_bytes AND validated_bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND media_type IS NOT NULL AND validated_at IS NOT NULL)) AND (state <> 'deleted' OR (deleted_at IS NOT NULL AND deletion_run_id IS NOT NULL)) AND (state <> 'rejected' OR rejection_reason IS NOT NULL));
ALTER TABLE "purchase_hold" ADD CONSTRAINT "ck_hold_resolution" CHECK ((state='open' AND resolved_by IS NULL AND resolution_operation_id IS NULL AND resolution_reason IS NULL AND resolved_at IS NULL AND resolution_revision_id IS NULL) OR (state<>'open' AND resolved_by IS NOT NULL AND resolution_operation_id IS NOT NULL AND resolution_reason IS NOT NULL AND resolved_at IS NOT NULL AND resolution_revision_id IS NOT NULL));
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_order" CHECK (purchase_id < other_purchase_id);
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "ck_duplicate_resolution" CHECK ((state='open' AND resolved_by IS NULL AND resolution_reason IS NULL AND resolved_at IS NULL AND operation_id IS NULL) OR (state<>'open' AND resolved_by IS NOT NULL AND resolution_reason IS NOT NULL AND resolved_at IS NOT NULL AND operation_id IS NOT NULL));
ALTER TABLE "settings_version" ADD CONSTRAINT "ck_settings_bounds" CHECK ((purchase_start IS NULL OR purchase_cutoff IS NULL OR purchase_start < purchase_cutoff) AND (purchase_cutoff IS NULL OR upload_deadline IS NULL OR purchase_cutoff <= upload_deadline));
ALTER TABLE "settings_version" ADD CONSTRAINT "ck_retention_policy" CHECK (retention_days IS NULL OR (retention_days > 0 AND retention_approved_by IS NOT NULL AND retention_approved_at IS NOT NULL));
ALTER TABLE "giveaway_snapshot_row" ADD CONSTRAINT "ck_snapshot_spend" CHECK (qualifying_spend_kobo >= 0);
ALTER TABLE "giveaway_snapshot_source" ADD CONSTRAINT "ck_snapshot_inclusion" CHECK ((included AND revision_id IS NOT NULL AND exclusion_reason IS NULL) OR (NOT included AND exclusion_reason IS NOT NULL));
ALTER TABLE "audit_event" ADD CONSTRAINT "ck_audit_actor" CHECK ((actor_kind='user' AND actor_user_id IS NOT NULL) OR (actor_kind='system' AND actor_user_id IS NULL));
ALTER TABLE "maintenance_run" ADD CONSTRAINT "ck_maintenance_counters" CHECK (fencing_version >= 0 AND attempts >= 0);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE assignment ADD CONSTRAINT ex_assignment_interval EXCLUDE USING gist (attendant_id WITH =, tstzrange(effective_from,effective_until,'[)') WITH &&);
CREATE UNIQUE INDEX uq_assignment_current ON assignment(attendant_id) WHERE effective_until IS NULL;
CREATE UNIQUE INDEX uq_customer_active_card ON card_customer_link(customer_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_purchase_hold_open ON purchase_hold(purchase_id,kind) WHERE state='open';
CREATE UNIQUE INDEX uq_revision_current_accepted ON purchase_revision(purchase_id) WHERE state='accepted';
ALTER TABLE assignment ADD CONSTRAINT uq_assignment_owner UNIQUE(id,attendant_id,pump_id);
ALTER TABLE capture_context ADD CONSTRAINT uq_capture_context_owner UNIQUE(id,attendant_id,assignment_id);
ALTER TABLE pump ADD CONSTRAINT uq_pump_product UNIQUE(id,station_id,product_id);
ALTER TABLE product_price_version ADD CONSTRAINT uq_price_product UNIQUE(id,station_id,product_id);
ALTER TABLE assignment ADD CONSTRAINT uq_assignment_attendant UNIQUE(id,attendant_id);
ALTER TABLE capture_context ADD CONSTRAINT fk_context_assignment FOREIGN KEY(assignment_id,attendant_id) REFERENCES assignment(id,attendant_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_context FOREIGN KEY(capture_context_id,originating_attendant_id,assignment_id) REFERENCES capture_context(id,attendant_id,assignment_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_assignment FOREIGN KEY(assignment_id,originating_attendant_id,pump_id) REFERENCES assignment(id,attendant_id,pump_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_pump FOREIGN KEY(pump_id,station_id,product_id) REFERENCES pump(id,station_id,product_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_price FOREIGN KEY(price_version_id,station_id,product_id) REFERENCES product_price_version(id,station_id,product_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase ADD CONSTRAINT fk_purchase_current_revision FOREIGN KEY(id,current_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase_revision ADD CONSTRAINT fk_revision_base FOREIGN KEY(purchase_id,based_on_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase_revision ADD CONSTRAINT fk_revision_evidence FOREIGN KEY(purchase_id,evidence_asset_id) REFERENCES photo_asset(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase_hold ADD CONSTRAINT fk_hold_open_revision FOREIGN KEY(purchase_id,opened_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchase_hold ADD CONSTRAINT fk_hold_resolution_revision FOREIGN KEY(purchase_id,resolution_revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE giveaway_snapshot_source ADD CONSTRAINT fk_snapshot_revision FOREIGN KEY(purchase_id,revision_id) REFERENCES purchase_revision(purchase_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE giveaway_snapshot ADD CONSTRAINT uq_snapshot_campaign UNIQUE(id,campaign_id);
ALTER TABLE giveaway_snapshot ADD CONSTRAINT fk_snapshot_predecessor FOREIGN KEY(previous_snapshot_id,campaign_id) REFERENCES giveaway_snapshot(id,campaign_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION guard_immutable_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'history rows cannot be deleted: %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 IF TG_NARGS = 0 THEN RAISE EXCEPTION 'append-only rows cannot be updated: %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW) - TG_ARGV::text[]) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV::text[]) THEN
  RAISE EXCEPTION 'immutable columns changed on %',TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_auth_user_immutable BEFORE UPDATE OR DELETE ON auth_user FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('username','username_normalized','display_name','enabled','auth_version','must_change_password','updated_at');
CREATE TRIGGER guard_auth_credential_immutable BEFORE UPDATE ON auth_credential FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('password_hash','updated_at');
CREATE TRIGGER guard_attendant_immutable BEFORE UPDATE OR DELETE ON attendant FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('version');
CREATE TRIGGER guard_admin_immutable BEFORE UPDATE OR DELETE ON admin FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('email_normalized','email_verified_at','role_id','version');
CREATE TRIGGER guard_role_immutable BEFORE UPDATE OR DELETE ON role FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','enabled','version');
CREATE TRIGGER guard_permission_immutable BEFORE UPDATE OR DELETE ON permission FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_role_permission_immutable BEFORE UPDATE ON role_permission FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_auth_session_immutable BEFORE UPDATE ON auth_session FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('revoked_at');
CREATE TRIGGER guard_verification_challenge_immutable BEFORE UPDATE OR DELETE ON verification_challenge FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('attempts','consumed_at','revoked_at','version');
CREATE TRIGGER guard_recovery_grant_immutable BEFORE UPDATE OR DELETE ON recovery_grant FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('revoked_at','version');
CREATE TRIGGER guard_recovery_grant_item_immutable BEFORE UPDATE OR DELETE ON recovery_grant_item FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_station_immutable BEFORE UPDATE OR DELETE ON station FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','timezone','version');
CREATE TRIGGER guard_product_immutable BEFORE UPDATE OR DELETE ON product FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_pump_immutable BEFORE UPDATE OR DELETE ON pump FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('enabled','version');
CREATE TRIGGER guard_assignment_immutable BEFORE UPDATE OR DELETE ON assignment FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('effective_until');
CREATE TRIGGER guard_product_price_version_immutable BEFORE UPDATE OR DELETE ON product_price_version FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_capture_context_immutable BEFORE UPDATE OR DELETE ON capture_context FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('revoked_at');
CREATE TRIGGER guard_customer_immutable BEFORE UPDATE OR DELETE ON customer FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','phone_normalized','version');
CREATE TRIGGER guard_card_batch_immutable BEFORE UPDATE OR DELETE ON card_batch FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('status','version');
CREATE TRIGGER guard_card_immutable BEFORE UPDATE OR DELETE ON card FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','retired_at','retirement_reason','replaced_by_card_id','version');
CREATE TRIGGER guard_card_customer_link_immutable BEFORE UPDATE OR DELETE ON card_customer_link FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('ended_at');
CREATE TRIGGER guard_customer_identity_change_immutable BEFORE UPDATE OR DELETE ON customer_identity_change FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_purchase_immutable BEFORE UPDATE OR DELETE ON purchase FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('card_id','customer_id','status','current_revision_id','verified_sale_date','cancellation_reason','version');
CREATE TRIGGER guard_purchase_revision_immutable BEFORE UPDATE OR DELETE ON purchase_revision FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','decision_actor_id','decision_reason','decided_at');
CREATE TRIGGER guard_photo_asset_immutable BEFORE UPDATE OR DELETE ON photo_asset FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','final_key','validated_digest','validated_bytes','width','height','media_type','validated_at','rejection_reason','deleted_at','deletion_run_id');
CREATE TRIGGER guard_purchase_hold_immutable BEFORE UPDATE OR DELETE ON purchase_hold FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','resolved_by','resolution_operation_id','resolution_reason','resolved_at','resolution_revision_id','version');
CREATE TRIGGER guard_duplicate_flag_immutable BEFORE UPDATE OR DELETE ON duplicate_flag FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('state','resolved_by','resolution_reason','resolved_at','operation_id','version');
CREATE TRIGGER guard_campaign_immutable BEFORE UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('name','version','reconciliation_required');
CREATE TRIGGER guard_settings_version_immutable BEFORE UPDATE OR DELETE ON settings_version FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_giveaway_snapshot_immutable BEFORE UPDATE OR DELETE ON giveaway_snapshot FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_giveaway_snapshot_row_immutable BEFORE UPDATE OR DELETE ON giveaway_snapshot_row FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_giveaway_snapshot_source_immutable BEFORE UPDATE OR DELETE ON giveaway_snapshot_source FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns();
CREATE TRIGGER guard_maintenance_run_immutable BEFORE UPDATE OR DELETE ON maintenance_run FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns('status','cursor','lease_owner','lease_until','fencing_version','attempts','next_attempt_at','completed_at','outcome');
CREATE FUNCTION guard_domain_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oldj jsonb := to_jsonb(OLD); newj jsonb := to_jsonb(NEW); a text; b text;
BEGIN
 IF oldj ? 'version' AND (newj->>'version')::int <> (oldj->>'version')::int + 1 THEN
  RAISE EXCEPTION 'version must advance once' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='card_batch' THEN
  IF NOT ((OLD.status='generated' AND NEW.status='printed') OR (OLD.status='printed' AND NEW.status='active')) THEN RAISE EXCEPTION 'invalid batch transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='card' THEN
  IF OLD.state='retired' THEN RAISE EXCEPTION 'retired card is terminal' USING ERRCODE='23514'; END IF;
  IF OLD.state<>NEW.state AND NOT ((OLD.state='unassigned' AND NEW.state='linked') OR (OLD.state='linked' AND NEW.state='retired')) THEN RAISE EXCEPTION 'invalid card transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME IN ('purchase_hold','duplicate_flag') THEN
  IF OLD.state<>'open' OR NEW.state='open' THEN RAISE EXCEPTION 'terminal review cannot be changed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='purchase_revision' THEN
  IF NOT ((OLD.state='proposed' AND NEW.state IN ('accepted','rejected')) OR (OLD.state='accepted' AND NEW.state='superseded' AND (newj - 'state')=(oldj - 'state'))) THEN RAISE EXCEPTION 'invalid revision transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='purchase' THEN
  a:=OLD.status; b:=NEW.status;
  IF NOT ((a='received' AND b IN ('photo_pending','cancelled')) OR (a='photo_pending' AND b IN ('finalizing','cancelled')) OR (a='finalizing' AND b IN ('photo_pending','held','credited')) OR (a='held' AND b IN ('held','credited','cancelled')) OR (a='credited' AND b IN ('credited','cancelled'))) THEN RAISE EXCEPTION 'invalid purchase transition' USING ERRCODE='23514'; END IF;
  IF OLD.card_id IS NOT NULL AND NEW.card_id IS DISTINCT FROM OLD.card_id OR OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'resolved customer/card immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='assignment' THEN
  IF OLD.effective_until IS NOT NULL OR NEW.effective_until IS NULL THEN RAISE EXCEPTION 'assignment can close once' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='card_customer_link' THEN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'card link can end once' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='photo_asset' THEN
  IF NOT ((OLD.state='staged' AND NEW.state IN ('validated','rejected')) OR (OLD.state='validated' AND NEW.state='deleted' AND (newj - ARRAY['state','deleted_at','deletion_run_id'])=(oldj - ARRAY['state','deleted_at','deletion_run_id']))) THEN RAISE EXCEPTION 'invalid asset transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='admin' AND OLD.email_normalized IS DISTINCT FROM NEW.email_normalized AND NEW.email_verified_at IS NOT NULL THEN
  RAISE EXCEPTION 'email change must clear verification' USING ERRCODE='23514';
 ELSIF TG_TABLE_NAME='verification_challenge' THEN
  IF OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL OR NEW.attempts < OLD.attempts THEN RAISE EXCEPTION 'challenge already terminal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_attendant_transition BEFORE UPDATE ON attendant FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_admin_transition BEFORE UPDATE ON admin FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_role_transition BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_verification_challenge_transition BEFORE UPDATE ON verification_challenge FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_recovery_grant_transition BEFORE UPDATE ON recovery_grant FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_station_transition BEFORE UPDATE ON station FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_pump_transition BEFORE UPDATE ON pump FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_assignment_transition BEFORE UPDATE ON assignment FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_customer_transition BEFORE UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_card_batch_transition BEFORE UPDATE ON card_batch FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_card_transition BEFORE UPDATE ON card FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_card_customer_link_transition BEFORE UPDATE ON card_customer_link FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_purchase_transition BEFORE UPDATE ON purchase FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_purchase_revision_transition BEFORE UPDATE ON purchase_revision FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_photo_asset_transition BEFORE UPDATE ON photo_asset FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_purchase_hold_transition BEFORE UPDATE ON purchase_hold FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_duplicate_flag_transition BEFORE UPDATE ON duplicate_flag FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE TRIGGER guard_campaign_transition BEFORE UPDATE ON campaign FOR EACH ROW EXECUTE FUNCTION guard_domain_transition();
CREATE FUNCTION guard_profile_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id=NEW.user_id AND kind=TG_TABLE_NAME) THEN
  RAISE EXCEPTION 'profile user kind mismatch' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER ck_attendant_kind BEFORE INSERT OR UPDATE ON attendant FOR EACH ROW EXECUTE FUNCTION guard_profile_kind();
CREATE TRIGGER ck_admin_kind BEFORE INSERT OR UPDATE ON admin FOR EACH ROW EXECUTE FUNCTION guard_profile_kind();

CREATE FUNCTION validate_sale_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE price product_price_version; expected_product product; original_purchase purchase;
BEGIN
 SELECT * INTO price FROM product_price_version WHERE id=NEW.price_version_id;
 SELECT * INTO expected_product FROM product WHERE id=price.product_id;
 IF TG_TABLE_NAME='purchase_revision' THEN
  SELECT * INTO original_purchase FROM purchase WHERE id=NEW.purchase_id;
  IF original_purchase.id IS NULL OR ROW(price.station_id,price.product_id) IS DISTINCT FROM ROW(original_purchase.station_id,original_purchase.product_id) THEN RAISE EXCEPTION 'revision price belongs to another station or product' USING ERRCODE='23514'; END IF;
 END IF;
 IF price.id IS NULL OR ROW(NEW.rate_kobo,NEW.currency,NEW.quantity_precision,NEW.unit) IS DISTINCT FROM ROW(price.rate_kobo,price.currency,price.quantity_precision,expected_product.unit) THEN
  RAISE EXCEPTION 'sale differs from captured price configuration' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_purchase_calculation BEFORE INSERT ON purchase FOR EACH ROW EXECUTE FUNCTION validate_sale_snapshot();
CREATE TRIGGER validate_revision_calculation BEFORE INSERT ON purchase_revision FOR EACH ROW EXECUTE FUNCTION validate_sale_snapshot();

CREATE FUNCTION guard_current_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase; r purchase_revision; asset photo_asset;
BEGIN
 IF TG_TABLE_NAME='purchase' THEN SELECT * INTO p FROM purchase WHERE id=NEW.id;
 ELSE SELECT * INTO p FROM purchase WHERE id=NEW.purchase_id; END IF;
 IF EXISTS(SELECT 1 FROM purchase_revision WHERE purchase_id=p.id AND state='accepted' AND id IS DISTINCT FROM p.current_revision_id) THEN
  RAISE EXCEPTION 'accepted revision must be the purchase current pointer' USING ERRCODE='23514';
 END IF;
 IF p.current_revision_id IS NOT NULL THEN
  SELECT * INTO r FROM purchase_revision WHERE id=p.current_revision_id AND purchase_id=p.id;
  SELECT * INTO asset FROM photo_asset WHERE id=r.evidence_asset_id AND purchase_id=p.id;
  IF r.id IS NULL OR r.state<>'accepted' OR asset.id IS NULL OR asset.state NOT IN ('validated','deleted') OR asset.validated_digest<>p.expected_photo_digest OR p.customer_id IS NULL THEN
   RAISE EXCEPTION 'current revision requires accepted own validated evidence and resolved customer' USING ERRCODE='23514';
  END IF;
 END IF;
 IF p.status='credited' AND (p.current_revision_id IS NULL OR EXISTS(SELECT 1 FROM purchase_hold WHERE purchase_id=p.id AND state='open')) THEN
  RAISE EXCEPTION 'credited purchase requires revision and no open holds' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ck_purchase_current_revision AFTER INSERT OR UPDATE ON purchase DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_current_revision();
CREATE CONSTRAINT TRIGGER ck_revision_current_pointer AFTER INSERT OR UPDATE ON purchase_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_current_revision();
CREATE CONSTRAINT TRIGGER ck_hold_credit AFTER INSERT OR UPDATE ON purchase_hold DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_current_revision();

-- Append-only privileges supplement row guards. The provisioned application role must never own tables or have TRUNCATE/DDL grants.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event, giveaway_snapshot, giveaway_snapshot_row, giveaway_snapshot_source FROM PUBLIC;

ALTER TABLE giveaway_snapshot_row ADD CONSTRAINT ck_snapshot_category CHECK(category IN ('car_owner','commercial_bus_driver','three_wheeler_user','bike_user','keg_buyer','cooking_gas_customer'));
CREATE FUNCTION guard_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE initial text := TG_ARGV[0]; state_column text := TG_ARGV[1];
BEGIN
 IF to_jsonb(NEW)->>state_column <> initial THEN RAISE EXCEPTION 'invalid initial state for %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ck_batch_initial BEFORE INSERT ON card_batch FOR EACH ROW EXECUTE FUNCTION guard_initial_state('generated','status');
CREATE TRIGGER ck_card_initial BEFORE INSERT ON card FOR EACH ROW EXECUTE FUNCTION guard_initial_state('unassigned','state');
CREATE TRIGGER ck_asset_initial BEFORE INSERT ON photo_asset FOR EACH ROW EXECUTE FUNCTION guard_initial_state('staged','state');
CREATE TRIGGER ck_hold_initial BEFORE INSERT ON purchase_hold FOR EACH ROW EXECUTE FUNCTION guard_initial_state('open','state');
CREATE TRIGGER ck_duplicate_initial BEFORE INSERT ON duplicate_flag FOR EACH ROW EXECUTE FUNCTION guard_initial_state('open','state');
CREATE FUNCTION guard_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'revocation is permanent' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ck_session_revocation BEFORE UPDATE ON auth_session FOR EACH ROW EXECUTE FUNCTION guard_revocation();
CREATE TRIGGER ck_context_revocation BEFORE UPDATE ON capture_context FOR EACH ROW EXECUTE FUNCTION guard_revocation();
CREATE TRIGGER ck_grant_revocation BEFORE UPDATE ON recovery_grant FOR EACH ROW EXECUTE FUNCTION guard_revocation();
