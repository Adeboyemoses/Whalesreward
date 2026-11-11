import {
  legacyReviewFixture,
  earlierReplacement,
  unauthorizedCapture,
} from "../helpers/legacy-review-evidence-fixture";
import { seedHistorical } from "../helpers/review-evidence-fixture";
import { runDuplicateBatch } from "../../src/server/modules/duplicates/service";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { reviewFixtureHarness } from "../helpers/review-fixture";

import { createReviewsService } from "../../src/server/modules/reviews/service";
import { fixtureId } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `reviews_${randomBytes(6).toString("hex")}`;
let pool: pg.Pool, h: ReturnType<typeof reviewFixtureHarness>;

describe("M3 real-Postgres independent review decisions", () => {
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const d of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
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
    vi.stubEnv(
      "DUPLICATE_WINDOW_POLICY",
      JSON.stringify({ version: 1, windowSeconds: 600 }),
    );
    h = reviewFixtureHarness(pool);
  }, 30000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });

  async function held() {
    const x = await legacyReviewFixture(pool);
    h = x.h;
    return x;
  }
  function service() {
    return createReviewsService({
      pool,
      storage: h.storage,
    });
  }
  it("price acceptance uses captured values and historical replay cannot apply twice", async () => {
    const { sale, hold, body } = await held(),
      svc = service(),
      token = await h.adminToken();
    const first = await svc.decidePrice(token, sale.purchaseId, hold.id, body);
    expect(first.after.amountKobo).toBe("2000000");
    expect(first.after.rateKobo).toBe("100000");
    expect(
      await svc.decidePrice(token, sale.purchaseId, hold.id, body),
    ).toEqual(first);
    await expect(
      svc.decidePrice(token, sale.purchaseId, hold.id, {
        ...body,
        reason: "Different review reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("unset evidence policy leaves price hold and contribution unchanged", async () => {
    const { sale, hold, body } = await held();
    vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", "");
    await expect(
      service().decidePrice(
        await h.adminToken(),
        sale.purchaseId,
        hold.id,
        body,
      ),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
    expect(
      (
        await pool.query("SELECT state FROM purchase_hold WHERE id=$1", [
          hold.id,
        ])
      ).rows[0].state,
    ).toBe("open");
    expect(
      (
        await pool.query(
          "SELECT current_revision_id FROM purchase WHERE id=$1",
          [sale.purchaseId],
        )
      ).rows[0].current_revision_id,
    ).toBeNull();
  });
  it("correct_meter fails closed on 409 until WHR-50 without a revision or receipt", async () => {
    const { sale, hold, body } = await held();
    await expect(
      service().decidePrice(await h.adminToken(), sale.purchaseId, hold.id, {
        ...body,
        decision: {
          outcome: "correct_meter",
          amountKobo: "2100000",
          quantity: "21",
        },
      }),
    ).rejects.toMatchObject({ code: "meter_policy_unconfigured", status: 409 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("foreign photo and invented reference cannot authorize a decision", async () => {
    const { sale, hold, body } = await held(),
      svc = service(),
      token = await h.adminToken();
    await expect(
      svc.decidePrice(token, sale.purchaseId, hold.id, {
        ...body,
        evidence: { ...body.evidence, assetId: newId() },
      }),
    ).rejects.toMatchObject({ code: "evidence_unavailable", status: 422 });
    await expect(
      svc.decidePrice(token, sale.purchaseId, hold.id, {
        ...body,
        evidence: { ...body.evidence, referenceIds: [newId()] },
      }),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
  });
  it("stale sale or hold guard and wrong hold kind cannot write decisions", async () => {
    const { sale, hold, body } = await held(),
      svc = service(),
      token = await h.adminToken();
    for (const edit of [
      { expectedVersion: body.expectedVersion + 1 },
      { expectedHoldVersion: body.expectedHoldVersion + 1 },
      { expectedRevisionId: newId() },
    ])
      await expect(
        svc.decidePrice(token, sale.purchaseId, hold.id, { ...body, ...edit }),
      ).rejects.toMatchObject({ code: "version_conflict", status: 409 });
    const { decision, ...common } = body;
    void decision;
    await expect(
      svc.decideCard(token, sale.purchaseId, hold.id, {
        ...common,
        outcome: "confirm_earlier",
      }),
    ).rejects.toMatchObject({ code: "hold_kind_mismatch", status: 422 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("concurrent price decisions have one winner and one accepted contribution", async () => {
    const { sale, hold, body } = await held(),
      svc = service(),
      token = await h.adminToken();
    const results = await Promise.allSettled([
      svc.decidePrice(token, sale.purchaseId, hold.id, body),
      svc.decidePrice(token, sale.purchaseId, hold.id, {
        ...body,
        operationId: newId(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [sale.purchaseId],
        )
      ).rows[0].n,
    ).toBeLessThanOrEqual(1);
  });
  it("permission revocation during evidence read is rechecked before mutation", async () => {
    const { sale, hold, body } = await held(),
      token = await h.adminToken();
    const svc = createReviewsService({
      pool,
      storage: {
        ...h.storage,
        async read(key, max) {
          const bytes = await h.storage.read(key, max);
          await pool.query(
            "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE secret_verifier=$1",
            [
              (await import("../../src/server/modules/auth/crypto")).digest(
                token,
              ),
            ],
          );
          return bytes;
        },
      },
    });
    await expect(
      svc.decidePrice(token, sale.purchaseId, hold.id, body),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await pool.query("SELECT state FROM purchase_hold WHERE id=$1", [
          hold.id,
        ])
      ).rows[0].state,
    ).toBe("open");
  });
  async function captureFixture() {
    const f = await held();
    for (const code of [
      "capture_authorization_unresolved",
      "capture_time_unresolved",
    ])
      await pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,'fixture',clock_timestamp(),1)",
        [newId(), f.sale.purchaseId, code],
      );
    return f;
  }
  it("capture confirm requires every block, preserves unrelated holds and immutable capture bounds", async () => {
    const { sale, body, f } = await captureFixture(),
      token = await h.adminToken();
    const original = (
      await pool.query(
        "SELECT app_captured_at,server_received_at,capture_lower_bound FROM purchase WHERE id=$1",
        [sale.purchaseId],
      )
    ).rows[0];
    const capture = {
      ...(await h.guard(sale.purchaseId)),
      outcome: "confirm",
      evidence: body.evidence,
    };
    const incomplete = createReviewsService({
      pool,
      storage: h.storage,
    });
    await seedHistorical(
      pool,
      "settings_version",
      "UPDATE settings_version SET purchase_cutoff='2026-11-10T12:30:00Z' WHERE station_id=$1",
      [f.stationId],
    );
    await expect(
      incomplete.decideCapture(token, sale.purchaseId, capture),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
    await seedHistorical(
      pool,
      "settings_version",
      "UPDATE settings_version SET purchase_cutoff='2026-12-01T00:00:00Z' WHERE station_id=$1",
      [f.stationId],
    );
    const complete = createReviewsService({
      pool,
      storage: h.storage,
    });
    const result = await complete.decideCapture(
      token,
      sale.purchaseId,
      capture,
    );
    expect(result.creditedAfter).toBe(false);
    expect(result.remainingHolds.some((h) => h.kind === "price")).toBe(true);
    expect(
      await complete.decideCapture(token, sale.purchaseId, capture),
    ).toEqual(result);
    await expect(
      complete.decideCapture(token, sale.purchaseId, {
        ...capture,
        reason: "Changed reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    expect(
      (
        await pool.query(
          "SELECT app_captured_at,server_received_at,capture_lower_bound FROM purchase WHERE id=$1",
          [sale.purchaseId],
        )
      ).rows[0],
    ).toEqual(original);
  });
  it("capture cancellation needs affirmative invalidity proof rather than uncertainty", async () => {
    const { sale, body, f } = await captureFixture(),
      token = await h.adminToken();
    const capture = {
      ...(await h.guard(sale.purchaseId)),
      outcome: "cancel",
      evidence: body.evidence,
    };
    await expect(
      service().decideCapture(token, sale.purchaseId, capture),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
    const svc = createReviewsService({
      pool,
      storage: h.storage,
    });
    await unauthorizedCapture(pool, f);
    const result = await svc.decideCapture(token, sale.purchaseId, capture);
    expect(result.creditedAfter).toBe(false);
    expect(await svc.decideCapture(token, sale.purchaseId, capture)).toEqual(
      result,
    );
    expect(
      (
        await pool.query("SELECT status FROM purchase WHERE id=$1", [
          sale.purchaseId,
        ])
      ).rows[0].status,
    ).toBe("cancelled");
  });
  async function pair() {
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
    const bytes = await h.image(),
      f = await h.context(bytes);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    const a = await h.settle(f, bytes),
      b = await h.settle(f, bytes);
    for (let n = 0; n < 1000 && (await runDuplicateBatch(pool)); n++);
    const flag = (
      await pool.query(
        "SELECT * FROM duplicate_flag WHERE purchase_id=$1 OR other_purchase_id=$1",
        [a.purchaseId],
      )
    ).rows[0];
    const purchases = await Promise.all(
      [a.purchaseId, b.purchaseId].map(async (id) => {
        const guard = await h.guard(id);
        return {
          id,
          expectedVersion: guard.expectedVersion,
          expectedRevisionId: guard.expectedRevisionId,
        };
      }),
    );
    return {
      a,
      b,
      flag,
      body: {
        operationId: newId(),
        expectedFlagVersion: flag.version,
        purchases,
        decision: { outcome: "keep_both" },
        reason: "Reviewed distinct sales",
      },
    };
  }
  it("keep both clears only the selected pair, preserves credit and replays historically", async () => {
    const { a, b, flag, body } = await pair(),
      svc = service(),
      token = await h.adminToken();
    const before = (
      await pool.query(
        "SELECT id,status,current_revision_id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[a.purchaseId, b.purchaseId]],
      )
    ).rows;
    const result = await svc.decideDuplicate(token, flag.id, body);
    expect(await svc.decideDuplicate(token, flag.id, body)).toEqual(result);
    expect(
      (
        await pool.query(
          "SELECT id,status,current_revision_id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[a.purchaseId, b.purchaseId]],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await pool.query("SELECT state FROM duplicate_flag WHERE id=$1", [
          flag.id,
        ])
      ).rows[0].state,
    ).toBe("cleared");
  });
  it("opposite-member concurrent duplicate cancellations cannot both win", async () => {
    const { a, b, flag, body } = await pair(),
      svc = service(),
      token = await h.adminToken();
    const results = await Promise.allSettled([
      svc.decideDuplicate(token, flag.id, {
        ...body,
        decision: { outcome: "cancel", cancelPurchaseId: a.purchaseId },
      }),
      svc.decideDuplicate(token, flag.id, {
        ...body,
        operationId: newId(),
        decision: { outcome: "cancel", cancelPurchaseId: b.purchaseId },
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM purchase WHERE id=ANY($1::uuid[]) AND status='cancelled'",
          [[a.purchaseId, b.purchaseId]],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("duplicate pair guards reject self-pair, third member and nonmember cancellation", async () => {
    const { flag, body } = await pair(),
      svc = service(),
      token = await h.adminToken();
    for (const bad of [
      { ...body, purchases: [body.purchases[0], body.purchases[0]] },
      {
        ...body,
        purchases: [body.purchases[0], { ...body.purchases[1], id: newId() }],
      },
      { ...body, decision: { outcome: "cancel", cancelPurchaseId: newId() } },
    ]) {
      await expect(
        svc.decideDuplicate(token, flag.id, bad),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(
      (
        await pool.query("SELECT state FROM duplicate_flag WHERE id=$1", [
          flag.id,
        ])
      ).rows[0].state,
    ).toBe("open");
  });
  it.each([
    "price,card,date",
    "price,date,card",
    "card,price,date",
    "card,date,price",
    "date,price,card",
    "date,card,price",
  ])(
    "independent hold order %s stages until every hold resolves",
    async (order) => {
      const x = await held();
      const { sale, hold, body } = x,
        token = await h.adminToken();
      await earlierReplacement(x);
      const ids: Record<string, string> = {
        price: hold.id,
        card: newId(),
        date: newId(),
      };
      for (const kind of ["card", "date"])
        await pool.query(
          "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)",
          [
            ids[kind]!,
            sale.purchaseId,
            kind,
            hold.opened_revision_id,
            kind === "card" ? "replaced_card" : "capture_date_uncertain",
          ],
        );
      const date = "2026-11-10";
      const svc = createReviewsService({
        pool,
        storage: h.storage,
      });
      const kinds = order.split(",");
      for (let n = 0; n < kinds.length; n++) {
        const kind = kinds[n]!,
          common = {
            ...(await h.guard(sale.purchaseId)),
            expectedHoldVersion: 1,
            evidence: body.evidence,
          };
        const result =
          kind === "price"
            ? await svc.decidePrice(token, sale.purchaseId, ids[kind]!, {
                ...common,
                decision: { outcome: "accept_captured" },
              })
            : kind === "card"
              ? await svc.decideCard(token, sale.purchaseId, ids[kind]!, {
                  ...common,
                  outcome: "confirm_earlier",
                })
              : await svc.decideDate(token, sale.purchaseId, ids[kind]!, {
                  ...common,
                  verifiedSaleDate: date,
                });
        expect(result.after.amountKobo).toBe("2000000");
        expect(result.creditedAfter).toBe(n === 2);
        const p = (
          await pool.query(
            "SELECT current_revision_id FROM purchase WHERE id=$1",
            [sale.purchaseId],
          )
        ).rows[0];
        if (n < 2) expect(p.current_revision_id).toBeNull();
        else expect(p.current_revision_id).not.toBeNull();
      }
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
  it.each([
    ["2026-02-30", "date_invalid"],
    ["2025-02-29", "date_invalid"],
    ["2026-13-01", "date_invalid"],
    ["2099-01-01", "date_after_receipt"],
  ])(
    "date %s is rejected without changing the staged candidate",
    async (date, code) => {
      const { sale, hold, body } = await held(),
        id = newId(),
        token = await h.adminToken();
      await pool.query(
        "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'date','open',$3,'capture_date_uncertain',1)",
        [id, sale.purchaseId, hold.opened_revision_id],
      );
      const svc = createReviewsService({
        pool,
        storage: h.storage,
      });
      const before = await h.guard(sale.purchaseId);
      await expect(
        svc.decideDate(token, sale.purchaseId, id, {
          ...before,
          expectedHoldVersion: 1,
          evidence: body.evidence,
          verifiedSaleDate: date,
        }),
      ).rejects.toMatchObject({ code, status: 422 });
      expect(await h.guard(sale.purchaseId)).toMatchObject({
        expectedVersion: before.expectedVersion,
        expectedRevisionId: before.expectedRevisionId,
      });
    },
  );
  it.each(["sales", "priceReview"])(
    "price decision requires live %s permission independently",
    async (permission) => {
      const { sale, hold, body } = await held(),
        token = await h.adminToken();
      await pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code=$2",
        [fixtureId(1), permission],
      );
      try {
        await expect(
          service().decidePrice(token, sale.purchaseId, hold.id, body),
        ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      } finally {
        await pool.query(
          "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
          [fixtureId(1), permission],
        );
      }
    },
  );
  it.each(["sales", "dateReview"])(
    "capture review requires live %s permission independently",
    async (permission) => {
      const { sale, body } = await captureFixture(),
        token = await h.adminToken();
      await pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code=$2",
        [fixtureId(1), permission],
      );
      try {
        await expect(
          service().decideCapture(token, sale.purchaseId, {
            ...(await h.guard(sale.purchaseId)),
            outcome: "confirm",
            evidence: body.evidence,
          }),
        ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      } finally {
        await pool.query(
          "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
          [fixtureId(1), permission],
        );
      }
    },
  );
});
