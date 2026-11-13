/** Current accepted operational contribution; shared with customer all-time totals.
 * Campaign qualification and proposed corrections never alter this predicate. */
export const acceptedContribution = `p.status='credited' AND r.state='accepted' AND p.customer_id IS NOT NULL AND EXISTS(SELECT 1 FROM photo_asset ph WHERE ph.purchase_id=p.id AND ph.id=r.evidence_asset_id AND ph.state='validated') AND NOT EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open') AND NOT EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL)`;
