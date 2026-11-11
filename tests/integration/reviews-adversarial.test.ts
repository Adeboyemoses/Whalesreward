import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { correctionStorage } from "../../src/server/modules/corrections/http";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { readSales } from "../../src/server/modules/sales/service";
import { adminConfig } from "../../src/server/modules/admin-access/config";
import { database } from "../../src/server/lib/db";
import { handleReviews } from "../../src/server/modules/reviews/http";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import { newId } from "../../src/server/lib/ids";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { changePrice, fixtureId } from "../helpers/sync-fixture";

const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `review_adversaries_${randomBytes(6).toString("hex")}`;
let pool: pg.Pool;
let h: ReturnType<typeof reviewFixtureHarness>;
const date = "2026-11-05";

describe("M3 PostgreSQL adversarial review history", () => {
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${entry.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    h = reviewFixtureHarness(pool);
  }, 30000);
  afterAll(async () => {
    await database().end();
    vi.unstubAllEnvs();
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });

  function service() {
    return createReviewsService({
      pool,
      storage: h.storage,
      evidencePolicy: {
        async evaluate(_db, context) {
          return {
            policyVersion: "adversarial-fixture-v1",
            referenceIds: [...context.referenceIds],
            validPrice: true,
            beforeReplacement: true,
            verifiedSaleDate: date,
            authorizedCapture: true,
            campaignEligible: true,
            invalidSale: true,
          };
        },
      },
    });
  }
  async function auditAction(
    decision: { auditEventId: string; purchaseId: string },
    action: string,
  ) {
    expect(
      (
        await pool.query(
          "SELECT action,target_type,target_id FROM audit_event WHERE id=$1",
          [decision.auditEventId],
        )
      ).rows[0],
    ).toEqual({
      action,
      target_type: "purchase",
      target_id: decision.purchaseId,
    });
  }
  async function held() {
    await pool.query("TRUNCATE station,card CASCADE");
    await pool.query(
      (
        await readFile(
          new URL("../../prisma/fixtures.sql", import.meta.url),
          "utf8",
        )
      )
        .split("\n")
        .filter((line) =>
          /^(INSERT INTO (customer|card)|UPDATE card)/.test(line),
        )
        .join("\n"),
    );
    const bytes = await h.image();
    const f = await h.context(bytes);
    await changePrice(pool, f);
    const sale = await h.settle(f, bytes);
    const hold = (
      await pool.query(
        "SELECT * FROM purchase_hold WHERE purchase_id=$1 AND kind='price'",
        [sale.purchaseId],
      )
    ).rows[0];
    const reference = (
      await pool.query(
        "SELECT id FROM audit_event WHERE target_id=$1 ORDER BY occurred_at LIMIT 1",
        [sale.purchaseId],
      )
    ).rows[0].id;
    const evidence = {
      assetId: sale.assetId,
      notes: "Inspected retained fictional evidence",
      referenceIds: [reference],
    };
    return { f, sale, hold, evidence, token: await h.adminToken() };
  }
  async function capture() {
    const fixture = await held();
    for (const code of [
      "capture_authorization_unresolved",
      "capture_time_unresolved",
    ])
      await pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,'fixture',clock_timestamp(),1)",
        [newId(), fixture.sale.purchaseId, code],
      );
    return fixture;
  }
  async function bounds(id: string) {
    return (
      await pool.query(
        `SELECT p.app_captured_at,p.server_received_at,p.capture_lower_bound,p.capture_policy_version,
      p.correction_cutoff_at,p.correction_date_reliable,p.correction_time_policy_version,
      p.originating_attendant_id,p.assignment_id,p.pump_id,c.signed_in_at,c.offline_expires_at
      FROM purchase p JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1`,
        [id],
      )
    ).rows[0];
  }
  async function finalizeReplay(id: string) {
    const op = (
      await pool.query(
        "SELECT * FROM sync_finalize_operation WHERE purchase_id=$1",
        [id],
      )
    ).rows[0];
    return {
      operationId: op.operation_id as string,
      expectedVersion: op.expected_version as number,
      uploadId: op.upload_id as string,
    };
  }

  it.each(["date,card", "card,date"])(
    "I-35 %s retains exact independent meter candidate values until the last hold clears",
    async (order) => {
      const { sale, hold, evidence, token } = await held();
      const svc = service();
      await expect(
        svc.decidePrice(token, sale.purchaseId, hold.id, {
          ...(await h.guard(sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence,
          decision: {
            outcome: "correct_meter",
            amountKobo: "2100001",
            quantity: "19.37",
          },
        }),
      ).rejects.toMatchObject({
        code: "meter_policy_unconfigured",
        status: 409,
      });
      // Trusted persisted historical candidate: runtime creation remains gated by WHR-50.
      // This exercises downstream consumers without enabling the unresolved policy.
      const candidate = newId();
      await pool.query(
        `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,calculation_mode)
      SELECT $1,purchase_id,2,$2,actor_user_id,payload_digest,id,'price_resolution','proposed','Historical meter evidence',server_received_at,2100001,19.37,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,'meter_evidence' FROM purchase_revision WHERE id=$3`,
        [candidate, newId(), hold.opened_revision_id],
      );
      await pool.query(
        "UPDATE purchase SET resolution_candidate_revision_id=$2,version=version+1 WHERE id=$1",
        [sale.purchaseId, candidate],
      );
      await pool.query(
        "UPDATE purchase_hold SET state='resolved',resolved_by=$2,resolution_operation_id=$3,resolution_reason='Historical meter decision',resolved_at=clock_timestamp(),resolution_revision_id=$4,version=version+1 WHERE id=$1",
        [hold.id, fixtureId(5), newId(), candidate],
      );
      const replacement = newId();
      await pool.query(
        "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,'C7K3M9Q','C7K3M9Q','unassigned',1)",
        [replacement, fixtureId(28)],
      );
      await pool.query(
        "UPDATE card_customer_link SET ended_at='2026-11-05T00:00:00Z' WHERE card_id=$1 AND ended_at IS NULL",
        [fixtureId(29)],
      );
      await pool.query(
        "UPDATE card SET state='retired',retired_at='2026-11-05T00:00:00Z',retirement_reason='replaced',replaced_by_card_id=$2,version=version+1 WHERE id=$1",
        [fixtureId(29), replacement],
      );
      const holds = { date: newId(), card: newId() };
      for (const kind of ["date", "card"] as const)
        await pool.query(
          "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)",
          [
            holds[kind],
            sale.purchaseId,
            kind,
            candidate,
            kind === "date" ? "capture_date_uncertain" : "replaced_card",
          ],
        );
      const originalBounds = await bounds(sale.purchaseId);
      for (const [index, kind] of order.split(",").entries()) {
        const body = {
          ...(await h.guard(sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence,
        };
        const result =
          kind === "date"
            ? await svc.decideDate(token, sale.purchaseId, holds.date, {
                ...body,
                verifiedSaleDate: date,
              })
            : await svc.decideCard(token, sale.purchaseId, holds.card, {
                ...body,
                outcome: "confirm_earlier",
              });
        expect(result.after).toMatchObject({
          amountKobo: "2100001",
          quantity: "19.37",
          rateKobo: "100000",
          enteredAmountKobo: "2000000",
          calculation: "meter_evidence",
        });
        expect(result.creditedAfter).toBe(index === 1);
        await auditAction(
          result,
          kind === "date" ? "sale_date_verified" : "card_eligibility_confirmed",
        );
      }
      expect(await bounds(sale.purchaseId)).toEqual(originalBounds);
      expect(
        (
          await pool.query(
            "SELECT amount_kobo::text amount,quantity::text quantity FROM purchase WHERE id=$1",
            [sale.purchaseId],
          )
        ).rows[0],
      ).toEqual({ amount: "2000000", quantity: "20.000000" });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
            [sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(1);
    },
  );

  it.each(["confirm", "cancel"])(
    "I-22 capture %s replay is historical and changed body cannot write again",
    async (outcome) => {
      const { sale, evidence, token } = await capture();
      const svc = service();
      const body = { ...(await h.guard(sale.purchaseId)), outcome, evidence };
      const originalBounds = await bounds(sale.purchaseId);
      const first = await svc.decideCapture(token, sale.purchaseId, body);
      await auditAction(
        first,
        outcome === "confirm" ? "capture_confirmed" : "capture_cancelled",
      );
      const durable = (
        await pool.query(
          "SELECT row_to_json(p)::text value FROM purchase p WHERE id=$1",
          [sale.purchaseId],
        )
      ).rows;
      expect(await svc.decideCapture(token, sale.purchaseId, body)).toEqual(
        first,
      );
      await expect(
        svc.decideCapture(token, sale.purchaseId, {
          ...body,
          outcome: outcome === "confirm" ? "cancel" : "confirm",
        }),
      ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
      expect(
        (
          await pool.query(
            "SELECT row_to_json(p)::text value FROM purchase p WHERE id=$1",
            [sale.purchaseId],
          )
        ).rows,
      ).toEqual(durable);
      expect(await bounds(sale.purchaseId)).toEqual(originalBounds);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
            [sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(1);
    },
  );

  it("I-39 stale capture SaleGuard conflicts during concurrent finalize replay without reopening resolved blocks", async () => {
    const { sale, evidence, token, f, hold } = await capture();
    const svc = service();
    const stale = {
      ...(await h.guard(sale.purchaseId)),
      outcome: "confirm",
      evidence,
    };
    const confirmed = await svc.decideCapture(token, sale.purchaseId, stale);
    const blocks = (
      await pool.query(
        "SELECT * FROM purchase_validation_block WHERE purchase_id=$1 ORDER BY id",
        [sale.purchaseId],
      )
    ).rows;
    const replay = await finalizeReplay(sale.purchaseId);
    const results = await Promise.allSettled([
      h.sync.finalize(f.token, sale.purchaseId, replay),
      svc.decideCapture(token, sale.purchaseId, {
        ...stale,
        operationId: newId(),
      }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "version_conflict", status: 409 },
    });
    // Resolving the independent price hold reruns contribution gates after capture confirmation.
    const accepted = await svc.decidePrice(token, sale.purchaseId, hold.id, {
      ...(await h.guard(sale.purchaseId)),
      expectedHoldVersion: 1,
      evidence,
      decision: { outcome: "accept_captured" },
    });
    expect(accepted.creditedAfter).toBe(true);
    await auditAction(accepted, "price_accepted");
    expect(
      (
        await pool.query(
          "SELECT * FROM purchase_validation_block WHERE purchase_id=$1 ORDER BY id",
          [sale.purchaseId],
        )
      ).rows,
    ).toEqual(blocks);
    expect(await svc.decideCapture(token, sale.purchaseId, stale)).toEqual(
      confirmed,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("I-46 capture decision marks reconciliation without rewriting frozen snapshot rows or sources", async () => {
    const { sale, evidence, token, hold } = await capture();
    const settings = (
      await pool.query("SELECT id,campaign_id FROM settings_version LIMIT 1")
    ).rows[0];
    const snapshot = newId();
    // Persisted finalized history, including an excluded held source, is an M4 input fixture.
    await pool.query(
      "INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,operation_id,actor_id,reason,tie_rule,finalized_at) VALUES($1,$2,$3,1,$4,$5,'Fictional frozen history','competition',clock_timestamp())",
      [snapshot, settings.campaign_id, settings.id, newId(), fixtureId(5)],
    );
    await pool.query(
      "INSERT INTO giveaway_snapshot_source(id,snapshot_id,purchase_id,revision_id,included,exclusion_reason) VALUES($1,$2,$3,$4,false,'held')",
      [newId(), snapshot, sale.purchaseId, hold.opened_revision_id],
    );
    await pool.query(
      "INSERT INTO giveaway_snapshot_row(id,snapshot_id,customer_id,category,qualifying_spend_kobo,currency,transaction_count,overall_rank,category_rank) VALUES($1,$2,$3,'car_owner',2000000,'NGN',1,1,1)",
      [newId(), snapshot, fixtureId(26)],
    );
    const frozen = async () =>
      (
        await pool.query(
          "SELECT row_to_json(s)::text snapshot,(SELECT json_agg(r ORDER BY r.id)::text FROM giveaway_snapshot_row r WHERE snapshot_id=s.id) rows,(SELECT json_agg(x ORDER BY x.id)::text FROM giveaway_snapshot_source x WHERE snapshot_id=s.id) sources FROM giveaway_snapshot s WHERE id=$1",
          [snapshot],
        )
      ).rows;
    const before = await frozen();
    await service().decideCapture(token, sale.purchaseId, {
      ...(await h.guard(sale.purchaseId)),
      outcome: "confirm",
      evidence,
    });
    expect(await frozen()).toEqual(before);
    expect(
      (
        await pool.query(
          "SELECT reconciliation_required FROM campaign WHERE id=$1",
          [settings.campaign_id],
        )
      ).rows[0].reconciliation_required,
    ).toBe(true);
  });
  it.each(["price", "card", "date", "capture"] as const)(
    "I-39 HTTP %s stale guard returns 409 rather than a domain 5xx",
    async (kind) => {
      const { sale, hold, evidence, token } = await capture();
      const guard = await h.guard(sale.purchaseId);
      const common = {
        ...guard,
        expectedVersion: guard.expectedVersion + 1,
        evidence,
      };
      const body =
        kind === "price"
          ? {
              ...common,
              expectedHoldVersion: 1,
              decision: { outcome: "accept_captured" },
            }
          : kind === "card"
            ? { ...common, expectedHoldVersion: 1, outcome: "confirm_earlier" }
            : kind === "date"
              ? { ...common, expectedHoldVersion: 1, verifiedSaleDate: date }
              : { ...common, outcome: "confirm" };
      const request = new Request(
        "http://localhost:3000/api/admin/sales/review",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            cookie: `${COOKIE}=${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      const response = await handleReviews(
        request,
        kind,
        sale.purchaseId,
        kind === "capture" ? undefined : hold.id,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "version_conflict", retryable: false },
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );
  it("I-31 HTTP correct_meter remains a nonretryable 409 with no decision write", async () => {
    const { sale, hold, evidence, token } = await held();
    const response = await handleReviews(
      new Request("http://localhost:3000/api/admin/sales/review", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: `${COOKIE}=${token}`,
        },
        body: JSON.stringify({
          ...(await h.guard(sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence,
          decision: {
            outcome: "correct_meter",
            amountKobo: "2100001",
            quantity: "19.37",
          },
        }),
      }),
      "price",
      sale.purchaseId,
      hold.id,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "meter_policy_unconfigured", retryable: false },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it.each([
    ["captured_rate", "19.37", "2000000", "100000"],
    ["meter_evidence", "19.371", "2000000", "100000"],
    ["meter_evidence", "19.37", "2100001", "100000"],
    ["meter_evidence", "19.37", "2000000", "110000"],
  ])(
    "I-29 %s rejects invalid precision or changed original entry/rate (%s, %s, %s)",
    async (mode, quantity, entered, rate) => {
      const { hold, sale } = await held();
      await expect(
        pool.query(
          `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,calculation_mode)
      SELECT $1,purchase_id,2,$2,actor_user_id,payload_digest,id,'price_resolution','proposed','Invalid fictional candidate',server_received_at,2100001,$4,currency,unit,quantity_precision,basis,$5,entered_quantity,$6,price_version_id,medium,evidence_asset_id,$7 FROM purchase_revision WHERE id=$3`,
          [
            newId(),
            newId(),
            hold.opened_revision_id,
            quantity,
            entered,
            rate,
            mode,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1",
            [sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(1);
    },
  );
  it("HTTP unexpected infrastructure errors return a generic retryable 503 without internal details", async () => {
    const { sale, evidence, token } = await capture();
    const body = {
      ...(await h.guard(sale.purchaseId)),
      outcome: "confirm",
      evidence,
    };
    // Only inject an unavailable connection; no transaction semantics are mocked.
    const failure = vi
      .spyOn(database(), "connect")
      .mockRejectedValueOnce(new Error("private database diagnostics"));
    try {
      const response = await handleReviews(
        new Request("http://localhost:3000/api/admin/sales/review", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            cookie: `${COOKIE}=${token}`,
          },
          body: JSON.stringify(body),
        }),
        "capture",
        sale.purchaseId,
      );
      expect(response.status).toBe(503);
      const output = await response.json();
      expect(output).toMatchObject({
        error: {
          code: "temporarily_unavailable",
          message: "This request could not be completed.",
          retryable: true,
        },
      });
      expect(JSON.stringify(output)).not.toContain(
        "private database diagnostics",
      );
    } finally {
      failure.mockRestore();
    }
  });
  it.each(["price", "card"] as const)(
    "I-41 %s cancellation persists the closed audit vocabulary",
    async (kind) => {
      const { sale, hold, evidence, token } = await held();
      let holdId = hold.id;
      if (kind === "card") {
        holdId = newId();
        await pool.query(
          "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'card','open',$3,'replaced_card',1)",
          [holdId, sale.purchaseId, hold.opened_revision_id],
        );
      }
      const common = {
        ...(await h.guard(sale.purchaseId)),
        expectedHoldVersion: 1,
        evidence,
      };
      const result =
        kind === "price"
          ? await service().decidePrice(token, sale.purchaseId, holdId, {
              ...common,
              decision: { outcome: "cancel" },
            })
          : await service().decideCard(token, sale.purchaseId, holdId, {
              ...common,
              outcome: "cancel",
            });
      await auditAction(
        result,
        kind === "price" ? "price_cancelled" : "card_eligibility_cancelled",
      );
    },
  );

  it.each(["keep_both", "cancel"] as const)(
    "I-40 duplicate %s preserves correction receipts and projects the resolved member",
    async (outcome) => {
      const { sale, f, hold, evidence, token } = await held();
      const svc = service();
      await svc.decidePrice(token, sale.purchaseId, hold.id, {
        ...(await h.guard(sale.purchaseId)),
        expectedHoldVersion: 1,
        evidence,
        decision: { outcome: "accept_captured" },
      });
      const other = await h.settle(f, await h.image());
      const flag = newId();
      const ids = [sale.purchaseId, other.purchaseId].sort();
      await pool.query(
        "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'suspected_duplicate','open',1)",
        [flag, ...ids],
      );
      const corrections = createCorrectionsService({
        pool,
        storage: h.storage,
      });
      const current = await h.guard(sale.purchaseId);
      const input = {
        operationId: newId(),
        expectedVersion: current.expectedVersion,
        basedOnRevisionId: current.expectedRevisionId!,
        edit: { basis: "amount", enteredAmountKobo: "3000000" },
        evidenceAssetId: sale.assetId,
        reason: "Correct fictional entry",
      };
      const cutoff = new Date(Date.now() + 2 * 86400000);
      // Test-only trusted receipt injection, before the production receipt-binding trigger.
      const trigger = `test_receipt_${randomBytes(6).toString("hex")}`;
      await pool.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purchase_id::text=TG_ARGV[0] THEN NEW.first_received_at=TG_ARGV[1]::timestamptz; END IF; RETURN NEW; END $$`,
      );
      let receipt;
      try {
        await pool.query(
          `CREATE TRIGGER ${trigger} BEFORE INSERT ON correction_request FOR EACH ROW EXECUTE FUNCTION ${trigger}('${sale.purchaseId}','${new Date(cutoff.getTime() + 1000).toISOString()}')`,
        );
        receipt = await corrections.submit(f.token, sale.purchaseId, input);
      } finally {
        await pool.query(
          `DROP TRIGGER IF EXISTS ${trigger} ON correction_request`,
        );
        await pool.query(`DROP FUNCTION ${trigger}()`);
      }
      expect(await corrections.processNext()).toBe(true);
      const correctionId = receipt.data.id;
      const before = (
        await pool.query("SELECT * FROM correction_request WHERE id=$1", [
          correctionId,
        ])
      ).rows[0];
      expect(before.state).toBe("awaiting_review");
      const purchases = await Promise.all(
        ids.map(async (id) => {
          const guard = await h.guard(id);
          return {
            id,
            expectedVersion: guard.expectedVersion,
            expectedRevisionId: guard.expectedRevisionId,
          };
        }),
      );
      const body = {
        operationId: newId(),
        expectedFlagVersion: 1,
        purchases,
        decision:
          outcome === "cancel"
            ? { outcome, cancelPurchaseId: sale.purchaseId }
            : { outcome },
        reason: "Reviewed fictional duplicate",
      };
      const result = await svc.decideDuplicate(token, flag, body);
      await auditAction(
        result.decision,
        outcome === "cancel" ? "duplicate_cancelled" : "duplicate_cleared",
      );
      expect(await svc.decideDuplicate(token, flag, body)).toEqual(result);
      const after = (
        await pool.query("SELECT * FROM correction_request WHERE id=$1", [
          correctionId,
        ])
      ).rows[0];
      for (const key of [
        "receipt",
        "first_received_at",
        "submitted_by_user_id",
        "originating_attendant_id",
        "authorship",
        "authority_session_id",
        "frozen_request_digest",
      ])
        expect(after[key]).toEqual(before[key]);
      if (outcome === "cancel") {
        expect(after).toMatchObject({
          state: "rejected",
          validation_error: "sale_cancelled",
          decision_id: result.decision.id,
          decided_by_user_id: fixtureId(2),
          decision_reason: body.reason,
        });
        expect(after.decided_at).toBeInstanceOf(Date);
        expect(
          (
            await pool.query(
              "SELECT state FROM purchase_revision WHERE id=$1",
              [before.proposed_revision_id],
            )
          ).rows[0].state,
        ).toBe("rejected");
        expect(
          (
            await pool.query("SELECT status FROM purchase WHERE id=$1", [
              sale.purchaseId,
            ])
          ).rows[0].status,
        ).toBe("cancelled");
      } else expect(after).toEqual(before);
      expect(
        (await corrections.submit(f.token, sale.purchaseId, input)).data,
      ).toEqual(receipt.data);
      const detail = await readSales(
        pool,
        adminConfig(),
        token,
        "admin",
        "detail",
        {},
        sale.purchaseId,
      );
      const history = await readSales(
        pool,
        adminConfig(),
        token,
        "admin",
        "history",
        { kind: "duplicateFlags" },
        sale.purchaseId,
      );
      const expected = {
        id: flag,
        state: outcome === "cancel" ? "cancelled" : "cleared",
        cancelledPurchaseId: outcome === "cancel" ? sale.purchaseId : null,
      };
      expect(detail).toMatchObject({ duplicateFlags: [expected] });
      expect(history).toMatchObject({ items: [expected] });
    },
  );

  it.each(["network", "server", "missing", "corrupt"] as const)(
    "I-25 HTTP evidence %s failure retains review state with the appropriate retry contract",
    async (failureKind) => {
      const { sale, hold, evidence, token } = await held();
      const { StorageNotFoundError } =
        await import("../../src/server/adapters/storage");
      const read = vi
        .spyOn(correctionStorage, "read")
        .mockImplementation(async () => {
          if (failureKind === "corrupt") return Buffer.from("not an image");
          if (failureKind === "missing")
            throw new StorageNotFoundError("missing fixture");
          throw Object.assign(
            new Error("private storage diagnostics"),
            failureKind === "network"
              ? { code: "ECONNRESET" }
              : { $metadata: { httpStatusCode: 503 } },
          );
        });
      const before = (
        await pool.query(
          "SELECT row_to_json(p)::text value FROM purchase p WHERE id=$1",
          [sale.purchaseId],
        )
      ).rows;
      try {
        const response = await handleReviews(
          new Request("http://localhost:3000/api/admin/sales/review", {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              cookie: `${COOKIE}=${token}`,
            },
            body: JSON.stringify({
              ...(await h.guard(sale.purchaseId)),
              expectedHoldVersion: 1,
              evidence,
              decision: { outcome: "accept_captured" },
            }),
          }),
          "price",
          sale.purchaseId,
          hold.id,
        );
        const retryable = failureKind === "network" || failureKind === "server";
        expect(response.status).toBe(retryable ? 503 : 422);
        const output = await response.json();
        expect(output).toMatchObject({
          error: {
            code: retryable
              ? "temporarily_unavailable"
              : "evidence_unavailable",
            retryable,
          },
        });
        expect(JSON.stringify(output)).not.toContain(
          "private storage diagnostics",
        );
        expect(
          (
            await pool.query(
              "SELECT row_to_json(p)::text value FROM purchase p WHERE id=$1",
              [sale.purchaseId],
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
              [sale.purchaseId],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        read.mockRestore();
      }
    },
  );
});
