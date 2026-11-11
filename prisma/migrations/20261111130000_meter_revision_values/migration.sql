-- Preserve the ordinary exact arithmetic invariant; only explicitly labelled historical
-- meter evidence may store independently verified effective money and quantity.
-- This does not enable the still-unconfigured correct_meter mutation endpoint.
ALTER TABLE purchase_revision DROP CONSTRAINT ck_purchase_revision_entry_basis;
ALTER TABLE purchase_revision ADD CONSTRAINT ck_purchase_revision_entry_basis CHECK (
 (calculation_mode='captured_rate' AND ((basis='amount' AND entered_amount_kobo IS NOT NULL AND entered_quantity IS NULL AND amount_kobo=entered_amount_kobo AND quantity * power(10::numeric, quantity_precision) = div(amount_kobo::numeric * power(10::numeric, quantity_precision), rate_kobo) + CASE WHEN mod(amount_kobo::numeric * power(10::numeric, quantity_precision), rate_kobo) * 2 >= rate_kobo THEN 1 ELSE 0 END) OR (basis='quantity' AND entered_quantity IS NOT NULL AND entered_amount_kobo IS NULL AND quantity=entered_quantity AND entered_quantity=round(entered_quantity,quantity_precision) AND amount_kobo=round(entered_quantity*rate_kobo,0)))) OR
 (calculation_mode='meter_evidence'
  AND kind IN ('price_resolution','date_resolution')
  AND quantity=round(quantity,quantity_precision)
  AND ((basis='amount' AND entered_amount_kobo IS NOT NULL AND entered_quantity IS NULL)
    OR (basis='quantity' AND entered_quantity IS NOT NULL AND entered_amount_kobo IS NULL
      AND entered_quantity=round(entered_quantity,quantity_precision))))
);
-- Ordinary positive/NUMERIC(20,6)/BIGINT/configuration guards remain in force.
-- Meter values are independent, but original entry facts and captured rate are not.
CREATE FUNCTION guard_meter_revision_facts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original purchase;
BEGIN
 IF NEW.calculation_mode='meter_evidence' THEN
  SELECT * INTO original FROM purchase WHERE id=NEW.purchase_id;
  IF original.id IS NULL OR
   ROW(NEW.basis,NEW.entered_amount_kobo,NEW.entered_quantity,NEW.rate_kobo,
       NEW.price_version_id,NEW.currency,NEW.unit,NEW.quantity_precision,NEW.medium)
   IS DISTINCT FROM
   ROW(original.basis,original.entered_amount_kobo,original.entered_quantity,original.rate_kobo,
       original.price_version_id,original.currency,original.unit,original.quantity_precision,original.medium)
  THEN RAISE EXCEPTION 'meter revision must retain original capture facts' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_meter_revision_facts BEFORE INSERT ON purchase_revision
 FOR EACH ROW EXECUTE FUNCTION guard_meter_revision_facts();
