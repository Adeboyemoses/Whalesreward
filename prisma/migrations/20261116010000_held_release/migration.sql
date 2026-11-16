-- P-29: content and transitions are immutable. No policy activation or identity assignment.
CREATE TABLE held_release_person (
 id UUID PRIMARY KEY,
 station_id UUID NOT NULL REFERENCES station(id),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(station_id,id)
);
CREATE TABLE held_release_person_binding (
 id UUID PRIMARY KEY,
 station_id UUID NOT NULL REFERENCES station(id),
 user_id UUID NOT NULL REFERENCES auth_user(id),
 person_id UUID NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 verified BOOLEAN NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(station_id,person_id) REFERENCES held_release_person(station_id,id),
 UNIQUE(station_id,user_id,version)
);
CREATE TABLE held_release_sheet (
 id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL REFERENCES purchase(id),
 station_id UUID NOT NULL REFERENCES station(id),
 uploader_id UUID NOT NULL REFERENCES auth_user(id),
 uploader_person_id UUID NOT NULL REFERENCES held_release_person(id),
 target JSONB NOT NULL CHECK(jsonb_typeof(target)='object'),
 purpose TEXT NOT NULL DEFAULT 'held_release_sheet' CHECK(purpose='held_release_sheet'),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 8388608),
 staging_key TEXT NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ(6) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(purchase_id,id)
);
CREATE TABLE held_release_sheet_validation (
 asset_id UUID PRIMARY KEY REFERENCES held_release_sheet(id),
 final_key TEXT NOT NULL UNIQUE,
 display_key TEXT NOT NULL UNIQUE,
 validated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE held_release_proposal (
 id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL REFERENCES purchase(id),
 station_id UUID NOT NULL REFERENCES station(id),
 target_kind TEXT NOT NULL CHECK(target_kind IN ('price','card','date','capture')),
 outcome TEXT NOT NULL CHECK(outcome IN ('confirm','cancel')),
 sheet_asset_id UUID NOT NULL,
 proposer_id UUID NOT NULL REFERENCES auth_user(id),
 proposer_person_id UUID NOT NULL REFERENCES held_release_person(id),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 provenance JSONB NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 proposed_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(purchase_id,sheet_asset_id) REFERENCES held_release_sheet(purchase_id,id),
 UNIQUE(purchase_id,id)
);
CREATE TABLE held_release_state (
 proposal_id UUID PRIMARY KEY,
 purchase_id UUID NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','superseded')),
 FOREIGN KEY(purchase_id,proposal_id) REFERENCES held_release_proposal(purchase_id,id)
);
CREATE UNIQUE INDEX held_release_one_pending ON held_release_state(purchase_id) WHERE state='pending';
CREATE TABLE held_release_transition (
 id UUID PRIMARY KEY,
 proposal_id UUID NOT NULL REFERENCES held_release_proposal(id),
 version INTEGER NOT NULL CHECK(version>0),
 state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','superseded')),
 actor_id UUID REFERENCES auth_user(id),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(proposal_id,version)
);
CREATE TABLE held_release_receipt (
 actor_id UUID NOT NULL REFERENCES auth_user(id),
 operation_kind TEXT NOT NULL,
 operation_id UUID NOT NULL,
 payload_digest TEXT NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 response JSONB NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,operation_kind,operation_id)
);
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['held_release_person','held_release_person_binding','held_release_sheet','held_release_sheet_validation','held_release_proposal','held_release_transition','held_release_receipt'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_immutable_columns()',t||'_immutable',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_held_release_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'release history is retained'; END IF;
 IF OLD.state<>'pending' OR NEW.state='pending' OR NEW.version<>OLD.version+1
 OR NEW.proposal_id<>OLD.proposal_id OR NEW.purchase_id<>OLD.purchase_id THEN
 RAISE EXCEPTION 'invalid release transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER held_release_state_guard BEFORE UPDATE OR DELETE ON held_release_state FOR EACH ROW EXECUTE FUNCTION guard_held_release_state();
