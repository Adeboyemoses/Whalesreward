-- Items may only be appended in the transaction that created their immutable snapshot.
CREATE OR REPLACE FUNCTION guard_card_export_item_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM card_export e JOIN card c ON c.batch_id=e.batch_id WHERE e.id=NEW.export_id AND c.id=NEW.card_id AND c.code=NEW.code AND c.qr_payload=NEW.qr_payload AND c.state=NEW.card_state AND NEW.assignment_eligible=(e.batch_status='active' AND c.state='unassigned') AND(e.format='xlsx' OR c.state='unassigned') AND e.status='pending' AND e.fencing_version=0 AND e.xmin=pg_current_xact_id()::text::xid) THEN
 RAISE EXCEPTION 'invalid export inventory snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
