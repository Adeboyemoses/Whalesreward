// SQL fragments contain only server-owned identifiers. Every exact numeric is
// converted to text before PostgreSQL JSON conversion, never after JS parsing.
export function values(alias: string, original = false) {
  return `jsonb_build_object('amountKobo',${alias}.amount_kobo::text,'quantity',trim_scale(${alias}.quantity)::text,'currency',${alias}.currency,'unit',${alias}.unit,'basis',${alias}.basis,'enteredAmountKobo',${alias}.entered_amount_kobo::text,'enteredQuantity',trim_scale(${alias}.entered_quantity)::text,'rateKobo',${alias}.rate_kobo::text,'priceVersionId',${alias}.price_version_id,'quantityPrecision',${alias}.quantity_precision,'medium',${alias}.medium,'calculation',${original ? "'captured_rate'" : `${alias}.calculation_mode`},'verifiedSaleDate',${alias}.verified_sale_date::text)`;
}
export const actor = (user: string) =>
  `(SELECT jsonb_build_object('id',coalesce(a.id,t.id),'code',coalesce(a.admin_code,t.staff_code),'name',u.display_name) FROM auth_user u LEFT JOIN admin a ON a.user_id=u.id LEFT JOIN attendant t ON t.user_id=u.id WHERE u.id=${user})`;
export const seller = (alias: string) =>
  `jsonb_build_object('attendantId',${alias}.originating_attendant_id,'accountId',a.user_id,'staffCode',a.staff_code,'name',${alias}.seller_name,'username',${alias}.seller_username)`;
export function holds(own: boolean) {
  const publicFields =
    "'kind',h.kind,'state',h.state,'reasonCode',h.reason_code";
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object(${publicFields}${own ? "" : `, 'id',h.id,'version',h.version,'openedRevisionId',h.opened_revision_id,'resolvedBy',(SELECT jsonb_build_object('id',u.id,'code',ad.admin_code,'name',u.display_name) FROM admin ad JOIN auth_user u ON u.id=ad.user_id WHERE ad.id=h.resolved_by),'resolvedAt',h.resolved_at,'resolutionReason',h.resolution_reason,'resolutionId',h.resolution_operation_id`}) ORDER BY h.created_at,h.id),'[]'::jsonb) FROM purchase_hold h WHERE h.purchase_id=p.id)`;
}
export const blocks = `(SELECT coalesce(jsonb_agg(b.code ORDER BY b.code),'[]'::jsonb) FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL)`;
export function row(own: boolean) {
  return `jsonb_build_object('id',p.id,'operationId',p.operation_id,'saleCode',p.sale_code,'version',p.version,'customer',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'customerCode',c.customer_code,'name',c.name,'category',c.category) END,'capturedCardCode',p.card_code,'seller',${seller("p")},'station',jsonb_build_object('id',p.station_id,'code',st.code),'pump',jsonb_build_object('id',p.pump_id,'code',pu.code),'product',pr.code,'appCapturedAt',p.app_captured_at,'serverReceivedAt',p.server_received_at,'verifiedSaleDate',p.verified_sale_date::text,'state',p.status,'credited',p.status='credited' AND p.current_revision_id IS NOT NULL,'currentRevisionId',p.current_revision_id,'displayedValues',CASE WHEN r.id IS NULL THEN ${values("p", true)} ELSE ${values("r")} END,'displayedSource',CASE WHEN r.id IS NULL THEN 'original' ELSE 'accepted_revision' END,'holds',${holds(own)},'policyBlocks',${blocks},'duplicateFlag',EXISTS(SELECT 1 FROM duplicate_flag f WHERE (f.purchase_id=p.id OR f.other_purchase_id=p.id) AND f.state='open'),'correctionPending',EXISTS(SELECT 1 FROM correction_request cr WHERE cr.purchase_id=p.id AND cr.state IN ('pending_validation','awaiting_review')))`;
}
export const joins = `JOIN attendant a ON a.id=p.originating_attendant_id JOIN station st ON st.id=p.station_id JOIN pump pu ON pu.id=p.pump_id JOIN product pr ON pr.id=p.product_id LEFT JOIN customer c ON c.id=p.customer_id LEFT JOIN purchase_revision r ON r.id=p.current_revision_id AND r.purchase_id=p.id`;
export function revision(own: boolean) {
  return `jsonb_build_object('id',r.id,'number',r.revision_number,'kind',r.kind,'state',r.state,'basedOnRevisionId',r.based_on_revision_id,'values',${values("r")},'receivedAt',r.server_received_at${own ? "" : `,'actor',${actor("r.actor_user_id")},'reason',r.reason`})`;
}
export function correction(own: boolean) {
  return `jsonb_build_object('id',cr.id,'purchaseId',cr.purchase_id,'operationId',cr.operation_id,'version',cr.version,'basedOnRevisionId',cr.based_on_revision_id,'proposed',${values("r")},'reason',cr.reason,'serverReceivedAt',cr.first_received_at,'cutoffAtReceipt',cr.cutoff_at_receipt,'timing',cr.timing,'state',cr.state,'decidedAt',cr.decided_at,'authorship',cr.authorship,'policyBlocks',to_jsonb(cr.policy_blocks)${own ? "" : `,'expectedPurchaseVersion',cr.expected_purchase_version,'originatingSeller',${seller("p")},'requestedBy',CASE WHEN cr.verified_author_attendant_id IS NULL THEN NULL ELSE ${seller("p")} END,'submittedBy',${actor("cr.submitted_by_user_id")},'decidedBy',${actor("cr.decided_by_user_id")},'decisionReason',cr.decision_reason`})`;
}
export function decision(own: boolean) {
  if (!own) return "d.response";
  // Deliberately build the attendant allowlist rather than copy admin JSON.
  return `jsonb_build_object('id',d.id,'kind',d.kind,'outcome',d.outcome,'decidedAt',d.decided_at,'before',d.before_values,'after',d.after_values,'creditedAfter',d.response->'creditedAfter','remainingHolds',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',x->'kind','state',x->'state','reasonCode',x->'reasonCode')) FROM jsonb_array_elements(d.response->'remainingHolds') x),'[]'::jsonb),'policyBlocks',d.response->'policyBlocks')`;
}
