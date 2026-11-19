import type pg from "pg";
import { reviewProvenanceSchema } from "../reviews/provenance";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { acceptedContribution } from "../reports/contribution";
import { totals } from "../reports/data";
import { rankSpend } from "../leaderboards/rank";
import { membership, type CampaignBounds } from "./membership";
import type { Exclusion, RankingRow } from "../../../shared/contracts/giveaway";
import type { ReportSource } from "../../../shared/contracts/reports";
export async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  write = false,
) {
  if (write) await securityLock(db);
  else await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, "leaderboards");
  const stations = (
    await db.query<{ id: string; timezone: string }>(
      "SELECT id,timezone FROM station ORDER BY id LIMIT 2",
    )
  ).rows;
  if (stations.length !== 1)
    throw new AuthError("temporarily_unavailable", 503);
  const station = stations[0]!;
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
    [station.id],
  );
  await db.query(
    "SELECT station_id FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
    [station.id],
  );
  return { actor, station };
}
export async function campaignData(
  db: pg.PoolClient,
  stationId: string,
  id?: string,
) {
  const row = (
    await db.query(
      `SELECT c.*,s.launch_at,s.purchase_start,s.purchase_cutoff,s.upload_deadline,s.grace_hours,s.timezone,s.timing_policy_version,
 (extract(epoch FROM s.launch_at)*1000000)::bigint::text launch_us,(extract(epoch FROM s.purchase_start)*1000000)::bigint::text start_us,(extract(epoch FROM s.purchase_cutoff)*1000000)::bigint::text cutoff_us,(extract(epoch FROM s.upload_deadline)*1000000)::bigint::text deadline_us,
 to_char(s.launch_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') launch_text,to_char(s.purchase_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') start_text,to_char(s.purchase_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff_text,to_char(s.upload_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') deadline_text,
 rs.data_version::text data_version,clock_timestamp() now,
 clock_timestamp()>s.purchase_cutoff after_cutoff,clock_timestamp()>s.upload_deadline after_deadline
 FROM campaign c LEFT JOIN settings_version s ON s.id=c.current_timing_version_id AND s.campaign_id=c.id AND s.station_id=c.station_id JOIN station_reporting_state rs ON rs.station_id=c.station_id WHERE c.station_id=$1 AND ($2::uuid IS NULL OR c.id=$2) FOR UPDATE OF c`,
      [stationId, id ?? null],
    )
  ).rows[0];
  if (id && !row) throw new AuthError("not_found", 404);
  return row ?? null;
}
export function campaignView(
  c: NonNullable<Awaited<ReturnType<typeof campaignData>>>,
) {
  const instant = (x: Date | null) => x?.toISOString() ?? null;
  return {
    id: c.id as string,
    name: c.name as string,
    version: c.version as number,
    settingsVersionId: c.current_timing_version_id as string | null,
    timing: {
      launchAt: c.launch_text ?? instant(c.launch_at),
      purchaseStart: c.start_text ?? instant(c.purchase_start),
      purchaseCutoff: c.cutoff_text ?? instant(c.purchase_cutoff),
      graceHours: c.grace_hours as number | null,
      uploadDeadline: c.deadline_text ?? instant(c.upload_deadline),
      timezone: c.timezone ?? "Africa/Lagos",
      policyVersion: c.timing_policy_version as string | null,
    },
    dataVersion: c.data_version as string,
    latestSnapshotId: c.latest_snapshot_id as string | null,
    reconciliationRequired: c.reconciliation_required as boolean,
    reconciledDataVersion:
      c.reconciled_data_version === null
        ? null
        : String(c.reconciled_data_version),
  };
}
export type Contribution = Pick<
  ReportSource,
  "product" | "amountKobo" | "currency" | "quantity" | "unit"
> & {
  decisionEventIds: string[];
  purchaseId: string;
  revisionId: string | null;
  purchaseVersion: number;
  included: boolean;
  reasons: Exclusion[];
  customerId: string | null;
  category: RankingRow["category"] | null;
  customerCode: string | null;
  name: string | null;
  cardCode: string | null;
  valuesSource: "accepted_revision" | "original";
  photoAssetId: string | null;
  detailsReceivedAt: string;
  photoReceiptAt: string | null;
  timingPolicyVersion: string | null;
  phoneExclusionId: string | null;
};
export async function contributions(
  db: pg.PoolClient,
  stationId: string,
  bounds: CampaignBounds | null,
  exclusions: { purchaseId: string; phoneExclusionId: string }[] = [],
): Promise<Contribution[]> {
  const rows = (
    await db.query(
      `SELECT p.id,p.version,p.status,p.customer_id,r.id revision_id,coalesce(r.amount_kobo,p.amount_kobo)::text amount,trim_scale(coalesce(r.quantity,p.quantity))::text quantity,coalesce(r.currency,p.currency) currency,coalesce(r.unit,p.unit) unit,pr.code product,r.evidence_asset_id,
 c.customer_code,c.name,c.category,(SELECT cc.code FROM card cc JOIN card_customer_link cl ON cl.card_id=cc.id WHERE cl.customer_id=c.id AND cl.ended_at IS NULL AND cc.retired_at IS NULL ORDER BY cc.id LIMIT 1) card_code,
 p.server_received_at,rf.receipt_at,to_char(p.server_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') details_text,to_char(rf.receipt_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') photo_text, ARRAY(SELECT d.audit_event_id::text FROM sale_decision d WHERE d.purchase_id=p.id ORDER BY d.decided_at,d.id) decision_event_ids,
 (${acceptedContribution} AND EXISTS(SELECT 1 FROM sync_validation v WHERE v.purchase_id=p.id)) accepted,
 (extract(epoch FROM greatest(ctx.signed_in_at,coalesce(p.capture_lower_bound,ctx.signed_in_at)))*1000000)::bigint::text lower_us,
 (extract(epoch FROM least(p.server_received_at,ctx.offline_expires_at))*1000000)::bigint::text upper_us,
 (extract(epoch FROM p.server_received_at)*1000000)::bigint::text details_us,(extract(epoch FROM rf.receipt_at)*1000000)::bigint::text photo_us,
 coalesce((SELECT jsonb_agg(DISTINCT ev.provenance) FROM review_evaluation ev JOIN sale_decision d ON d.id=ev.decision_id AND d.purchase_id=ev.purchase_id CROSS JOIN LATERAL jsonb_array_elements(ev.provenance->'conclusions') conclusion WHERE ev.purchase_id=p.id AND conclusion->>'tag'='campaign_membership_uniform' AND ev.provenance->'result'->>'closure'='confirmed' AND ev.provenance->'target'->>'purchaseId'=p.id::text AND ev.provenance->'target'->>'decisionId'=d.id::text AND ev.provenance->'policy'->'scope'->>'stationId'=p.station_id::text AND ev.provenance->'result'->>'appliedPurchaseVersion'=d.applied_purchase_version::text AND ev.provenance->'result'->>'resultingRevisionId' IS NOT DISTINCT FROM d.result_revision_id::text AND ev.provenance->'result'->>'evidenceAssetId'=d.evidence_asset_id::text),'[]') provenances
 FROM purchase p JOIN capture_context ctx ON ctx.id=p.capture_context_id JOIN product pr ON pr.id=p.product_id LEFT JOIN customer c ON c.id=p.customer_id LEFT JOIN purchase_revision r ON r.id=p.current_revision_id AND r.purchase_id=p.id AND r.state='accepted' LEFT JOIN photo_receipt_fact rf ON rf.asset_id=r.evidence_asset_id AND rf.purchase_id=p.id WHERE p.station_id=$1 ORDER BY p.id`,
      [stationId],
    )
  ).rows;
  return rows.map((r) => {
    const reasons: Exclusion[] = [];
    if (!r.accepted)
      reasons.push(
        r.status === "cancelled"
          ? "cancelled"
          : r.status === "held"
            ? "held"
            : r.revision_id
              ? "ineligible"
              : "incomplete",
      );
    const exclusion = exclusions.find((e) => e.purchaseId === r.id);
    if (exclusion) reasons.push("phone_unavailable");
    if (bounds && r.status !== "cancelled") {
      const result = membership(
        {
          lower: r.lower_us,
          upper: r.upper_us,
          details: r.details_us,
          photo: r.photo_us,
          conclusions: (r.provenances as unknown[]).flatMap((value) => {
            const parsed = reviewProvenanceSchema.safeParse(value);
            return parsed.success
              ? parsed.data.conclusions.filter(
                  (c) =>
                    typeof c === "object" &&
                    c !== null &&
                    "tag" in c &&
                    c.tag === "campaign_membership_uniform",
                )
              : [];
          }),
        },
        bounds,
      );
      if (result && !(exclusion && result === "evidence_deadline_unresolved"))
        reasons.push(result);
    }
    return {
      decisionEventIds: r.decision_event_ids,
      purchaseId: r.id,
      revisionId: r.revision_id,
      purchaseVersion: r.version,
      included: reasons.length === 0,
      reasons,
      customerId: r.customer_id,
      category: r.category,
      customerCode: r.customer_code,
      name: r.name,
      cardCode: r.card_code,
      amountKobo: r.amount,
      currency: r.currency,
      quantity: r.quantity,
      unit: r.unit,
      product: r.product,
      valuesSource: r.revision_id ? "accepted_revision" : "original",
      photoAssetId: r.evidence_asset_id,
      detailsReceivedAt: r.details_text,
      photoReceiptAt: r.photo_text,
      timingPolicyVersion: bounds ? "campaign-timing-v1" : null,
      phoneExclusionId: exclusion?.phoneExclusionId ?? null,
    };
  });
}
export function ranking(
  sources: Contribution[],
  category?: RankingRow["category"],
) {
  const included = sources.filter(
    (s) => s.included && s.customerId && (!category || s.category === category),
  );
  const summary = totals(included);
  if (summary.spend.length > 1) throw new AuthError("currency_mismatch", 409);
  const groups = new Map<string, Contribution[]>();
  for (const row of included) {
    const rs = groups.get(row.customerId!) ?? [];
    rs.push(row);
    groups.set(row.customerId!, rs);
  }
  const rows = rankSpend(
    [...groups].map(([id, rs]) => {
      const s = rs[0]!,
        t = totals(rs);
      return {
        customerId: id,
        customerCode: s.customerCode!,
        name: s.name!,
        cardCode: s.cardCode,
        category: s.category!,
        totals: t,
        amountKobo: t.spend[0]!.amountKobo,
      };
    }),
  ).map((entry) => {
    const { amountKobo, ...row } = entry;
    void amountKobo;
    return row;
  });
  return { rows, summary, customers: String(rows.length) };
}
