import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import {
  releasePreparationQuerySchema,
  releasePreparationSchema,
  releaseTargetSchema,
} from "../../../shared/contracts/held-release";
import {
  pendingReleaseFilterSchema,
  pendingReleasePageSchema,
} from "../../../shared/contracts/pending-release";
import { saleValuesSchema } from "../../../shared/contracts/sales";
import { transaction } from "../../lib/transaction";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { adminConfig } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { payloadDigest } from "../sync/canonical";
import * as sql from "../sales/projections";
import { releaseSaleMutations as sale } from "./service";
import { releaseReadInternals } from "./release-service";
import { classifyReleaseStructure } from "./release-admission";
import { pinReleaseV2Policy, type ReviewEnvironment } from "./config";

const permissions = {
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
} as const;
const fail = (code = "evidence_insufficient", status = 422): never => {
  throw new AuthError(code, status);
};
const tuple = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  id: authId,
});
const position = z.strictObject({
  scope: z.string(),
  upper: tuple,
  after: tuple,
});
function cursor(secret: string, scope: string, value?: string) {
  if (!value) return null;
  try {
    const [payload, signature, ...extra] = value.split(".");
    if (!payload || !signature || extra.length) throw new Error();
    const expected = createHmac("sha256", secret).update(payload).digest(),
      actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error();
    const parsed = position.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (parsed.scope !== scope) throw new Error();
    return parsed;
  } catch {
    return fail("invalid_request", 400);
  }
}
function encode(secret: string, value: z.infer<typeof position>) {
  const payload = Buffer.from(JSON.stringify(position.parse(value))).toString(
    "base64url",
  );
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function createReleaseDiscoveryService({
  pool,
  env = process.env,
}: {
  pool: pg.Pool;
  env?: ReviewEnvironment;
}) {
  async function prepare(
    token: string | undefined,
    purchaseId: string,
    input: unknown,
  ) {
    authId.parse(purchaseId);
    const { kind } = releasePreparationQuerySchema.parse(input);
    return transaction(pool, async (db) => {
      const actor = await releaseReadInternals.authority(db, token, env, kind);
      const p = await sale.purchase(db, purchaseId, actor.stationId);
      await pinReleaseV2Policy(db, actor.stationId, env);
      if (p.status === "cancelled") return fail("review_closed", 409);
      let target: z.infer<typeof releaseTargetSchema>;
      if (kind === "capture") {
        const blocks = (
          await db.query(
            "SELECT id,version,code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code IN ('capture_authorization_unresolved','capture_time_unresolved') ORDER BY id FOR SHARE",
            [purchaseId],
          )
        ).rows;
        if (!blocks.length) return fail("review_closed", 409);
        const parsed = releaseTargetSchema.safeParse({ kind, blocks });
        if (!parsed.success) return fail();
        target = parsed.data;
      } else {
        const holds = (
          await db.query(
            "SELECT id,version FROM purchase_hold WHERE purchase_id=$1 AND kind=$2 AND state='open' ORDER BY id FOR SHARE",
            [purchaseId, kind],
          )
        ).rows;
        if (!holds.length) return fail("review_closed", 409);
        if (holds.length !== 1) return fail();
        target = {
          kind,
          holdId: holds[0]!.id,
          expectedHoldVersion: holds[0]!.version,
        };
      }
      const originals = (
        await db.query(
          `SELECT ${sql.values("p")} original,
        p.station_id,p.pump_id,p.customer_id,p.card_id,a.user_id account_id,pr.code product,
        r.id revision_id,r.evidence_asset_id meter_asset_id
        FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id
        JOIN capture_context c ON c.id=p.capture_context_id AND c.attendant_id=a.id AND c.assignment_id=p.assignment_id
        JOIN assignment ass ON ass.id=p.assignment_id AND ass.attendant_id=a.id AND ass.pump_id=p.pump_id
        JOIN pump pu ON pu.id=p.pump_id AND pu.station_id=p.station_id AND pu.product_id=p.product_id
        JOIN product pr ON pr.id=p.product_id JOIN customer cu ON cu.id=p.customer_id
        JOIN card ca ON ca.id=p.card_id
        JOIN purchase_revision r ON r.purchase_id=p.id AND r.kind='original'
        WHERE p.id=$1 AND p.station_id=$2`,
          [purchaseId, actor.stationId],
        )
      ).rows;
      if (originals.length !== 1) return fail();
      const original = originals[0]!;
      if (!original.meter_asset_id) return fail();
      let candidate;
      try {
        candidate = await sale.candidate(db, p);
      } catch (e) {
        if (e instanceof AuthError && e.code === "review_closed") return fail();
        throw e;
      }
      const classified = await classifyReleaseStructure(
        db,
        purchaseId,
        target,
        original.meter_asset_id,
      );
      let proposerAccess:
        | { allowed: true; reason: null }
        | {
            allowed: false;
            reason:
              "independence_unverifiable" | "independent_reviewer_required";
          } = { allowed: true, reason: null };
      try {
        await releaseReadInternals.independent(
          db,
          actor.stationId,
          purchaseId,
          actor.user_id,
        );
      } catch (e) {
        if (
          !(e instanceof AuthError) ||
          ![
            "independence_unverifiable",
            "independent_reviewer_required",
          ].includes(e.code)
        )
          throw e;
        proposerAccess = {
          allowed: false,
          reason: e.code as
            "independence_unverifiable" | "independent_reviewer_required",
        };
      }
      const asOf = (
        await db.query<{ at: Date }>("SELECT clock_timestamp() at")
      ).rows[0]!.at.toISOString();
      return releasePreparationSchema.parse({
        purchaseId,
        kind,
        asOf,
        guard: {
          expectedVersion: p.version,
          expectedRevisionId: p.current_revision_id,
        },
        target,
        originalContext: {
          stationId: original.station_id,
          accountId: original.account_id,
          pumpId: original.pump_id,
          product: original.product,
          customerId: original.customer_id,
          cardId: original.card_id,
        },
        original: saleValuesSchema.parse(original.original),
        meterAssetId: original.meter_asset_id,
        currentCandidate: {
          revisionId: candidate.id,
          source: p.resolution_candidate_revision_id
            ? "resolution_candidate"
            : p.current_revision_id
              ? "accepted_revision"
              : "original",
          values: candidate.values,
        },
        admission: classified.admission,
        proposerAccess,
      });
    });
  }
  async function pending(token: string | undefined, input: unknown = {}) {
    const q = pendingReleaseFilterSchema.parse(input);
    return transaction(pool, async (db) => {
      // READ COMMITTED is deliberate: the materialization statement's snapshot is
      // acquired only AFTER waiting for the same serialization lock as creation.
      await securityLock(db);
      const actor = await requireAdminSession(db, token);
      requirePermission(actor, "sales");
      const kinds = (Object.keys(permissions) as (keyof typeof permissions)[])
        .filter((k) => actor.permissions.includes(permissions[k]))
        .sort();
      if (!kinds.length || (q.kind && !kinds.includes(q.kind)))
        return fail("permission_denied", 403);
      const stations = (
        await db.query<{ id: string }>(
          "SELECT id FROM station ORDER BY id LIMIT 2",
        )
      ).rows;
      if (stations.length !== 1) return fail("permission_denied", 403);
      const station = stations[0]!.id,
        selected = q.kind ? [q.kind] : kinds;
      const scope = payloadDigest({
        route: "pending-release",
        station,
        admin: actor.admin_id,
        kinds,
        kind: q.kind ?? null,
      });
      const secret = adminConfig().secret,
        at = cursor(secret, scope, q.cursor);
      const result = (
        await db.query<{
          items: Record<string, unknown>[];
          pending: string;
          as_of: Date;
          upper: z.infer<typeof tuple> | null;
        }>(
          `
        WITH pending AS MATERIALIZED (
          SELECT p.id,p.purchase_id,p.target_kind,p.outcome,p.provenance->'actor' actor,p.proposed_at,s.version,pu.sale_code
          FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id
          JOIN purchase pu ON pu.id=p.purchase_id AND pu.station_id=p.station_id
          WHERE p.station_id=$1 AND s.state='pending' AND p.target_kind=ANY($2::text[])
        ), upper_bound AS (SELECT proposed_at,id FROM pending ORDER BY proposed_at DESC,id DESC LIMIT 1),
        page AS (SELECT * FROM pending WHERE
          ($3::timestamptz IS NULL OR (proposed_at,id)<=($3::timestamptz,$4::uuid)) AND
          ($5::timestamptz IS NULL OR (proposed_at,id)<($5::timestamptz,$6::uuid))
          ORDER BY proposed_at DESC,id DESC LIMIT $7)
        SELECT (SELECT count(*)::text FROM pending) pending,clock_timestamp() as_of,
          (SELECT jsonb_build_object('at',to_char(proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',id) FROM upper_bound) upper,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('proposalId',id,'proposalVersion',version,'kind',target_kind,'outcome',outcome,'state','pending','proposedBy',actor,'proposedAt',to_char(proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'purchaseId',purchase_id,'saleCode',sale_code) ORDER BY proposed_at DESC,id DESC) FROM page),'[]'::jsonb) items`,
          [
            station,
            selected,
            at?.upper.at ?? null,
            at?.upper.id ?? null,
            at?.after.at ?? null,
            at?.after.id ?? null,
            q.limit + 1,
          ],
        )
      ).rows[0]!;
      const more = result.items.length > q.limit,
        items = result.items.slice(0, q.limit),
        last = items.at(-1),
        upper = at?.upper ?? result.upper;
      return pendingReleasePageSchema.parse({
        items,
        asOf: result.as_of.toISOString(),
        summary: { pending: result.pending },
        nextCursor:
          more && last && upper
            ? encode(secret, {
                scope,
                upper,
                after: {
                  at: String(last.proposedAt),
                  id: String(last.proposalId),
                },
              })
            : null,
      });
    });
  }
  return { prepare, pending };
}
