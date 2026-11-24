-- A sheet reservation belongs to one immutable verified binding version.
-- Existing rows stay unpinned: no historical association is guessed or backfilled.
ALTER TABLE held_release_person_binding
 ADD CONSTRAINT held_release_person_binding_sheet_identity_key
 UNIQUE(station_id,user_id,person_id,version,id);
ALTER TABLE held_release_sheet
 ADD COLUMN uploader_binding_id UUID,
 ADD COLUMN uploader_binding_version INTEGER,
 ADD CONSTRAINT held_release_sheet_binding_pair CHECK (
  (uploader_binding_id IS NULL)=(uploader_binding_version IS NULL)
  AND (uploader_binding_version IS NULL OR uploader_binding_version>0)
 ),
 ADD CONSTRAINT held_release_sheet_binding_identity FOREIGN KEY
 (station_id,uploader_id,uploader_person_id,uploader_binding_version,uploader_binding_id)
 REFERENCES held_release_person_binding(station_id,user_id,person_id,version,id);

CREATE FUNCTION guard_release_sheet_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.uploader_binding_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM held_release_person_binding b
  WHERE b.id=NEW.uploader_binding_id AND b.station_id=NEW.station_id
   AND b.user_id=NEW.uploader_id AND b.person_id=NEW.uploader_person_id
   AND b.version=NEW.uploader_binding_version AND b.verified
   AND NOT EXISTS(SELECT 1 FROM held_release_person_binding newer
    WHERE newer.station_id=b.station_id AND newer.user_id=b.user_id AND newer.version>b.version)
 ) THEN
  RAISE EXCEPTION 'sheet binding is not current and verified' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER held_release_sheet_binding_guard BEFORE INSERT ON held_release_sheet
 FOR EACH ROW EXECUTE FUNCTION guard_release_sheet_binding();
-- held_release_sheet_immutable already denies UPDATE/DELETE of every column,
-- including these pins; its retained-history TRUNCATE guard remains unchanged.
