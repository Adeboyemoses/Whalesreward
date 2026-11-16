import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { newId } from "../../src/server/lib/ids";
import { createReleaseDiscoveryService } from "../../src/server/modules/reviews/release-discovery";
import { handleSalesRead } from "../../src/server/modules/sales/http";
import { readSales } from "../../src/server/modules/sales/service";
import {
  prepareGiveaway,
  confirmGiveaway,
  readReadiness,
} from "../../src/server/modules/giveaway/service";
import {
  evidenceDatabase,
  seedHistorical,
  type Kind,
} from "../helpers/review-evidence-fixture";
import { fixtureId } from "../helpers/sync-fixture";
import { config } from "../helpers/cards-adversarial-fixture";
import { giveawayAtStation } from "../helpers/giveaway-at-station-fixture";
import {
  discoveryFixture,
  addPending,
  clonePending,
  closePending,
  type DiscoveryFixture,
} from "../helpers/release-discovery-fixture";
import { handleReleaseDiscovery } from "../../src/server/modules/reviews/release-discovery-http";
// Only the connection provider is redirected to this suite's disposable real PostgreSQL schema.
vi.mock("../../src/server/lib/db", () => ({ database: () => db.pool }));
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
const kinds: Kind[] = ["price", "card", "date", "capture"];
async function state(x: DiscoveryFixture) {
  const queries = [
    "SELECT * FROM purchase WHERE id=$1",
    "SELECT * FROM purchase_revision WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM purchase_hold WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM purchase_validation_block WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM audit_event WHERE target_id=$1 ORDER BY id",
    "SELECT * FROM held_release_proposal WHERE purchase_id=$1 ORDER BY id",
    "SELECT * FROM review_evaluation WHERE purchase_id=$1 ORDER BY decision_id",
  ];
  return Promise.all(
    queries.map(
      async (sql) => (await x.pool.query(sql, [x.sale.purchaseId])).rows,
    ),
  );
}
async function propose(x: DiscoveryFixture) {
  return (await x.svc.propose(x.token, x.sale.purchaseId, x.body)).proposal.id;
}
async function grants(values: string[]) {
  await db.pool.query("DELETE FROM role_permission WHERE role_id=$1", [
    fixtureId(1),
  ]);
  for (const grant of values)
    await db.pool.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
      [fixtureId(1), grant],
    );
}
async function restoreGrants() {
  await db.pool.query(
    "INSERT INTO role_permission(role_id,permission_code) SELECT $1,code FROM permission ON CONFLICT DO NOTHING",
    [fixtureId(1)],
  );
}
async function waitForBlockedReader() {
  for (let n = 0; n < 100; n++) {
    const result = await db.pool.query(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%security_state%'",
    );
    if (result.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected reader waiting on security serialization lock");
}
describe("T-20 protected preparation and complete pending discovery on real Postgres", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://reviews.example.test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await evidenceDatabase();
  }, 30000);
  beforeEach(async () => {
    await restoreGrants();
  });
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  it.each(kinds)(
    "RD-01 %s preparation returns immutable original IDs exact target candidate and accepted-pointer guard",
    async (kind) => {
      await restoreGrants();
      const x = await discoveryFixture(db, kind);
      const result = await x.discovery.prepare(x.token, x.sale.purchaseId, {
        kind,
      });
      expect(result).toMatchObject({
        purchaseId: x.sale.purchaseId,
        kind,
        guard: {
          expectedVersion: x.body.expectedVersion,
          expectedRevisionId: null,
        },
        target: x.target,
        originalContext: {
          stationId: x.f.stationId,
          accountId: x.f.userId,
          pumpId: x.f.pumpId,
          product: "pms",
          customerId: fixtureId(26),
          cardId: fixtureId(29),
        },
        meterAssetId: x.sale.assetId,
        currentCandidate: { revisionId: x.original, source: "original" },
        admission: {
          state: "structurally_admissible",
          reason: "temporal_boundary",
        },
        proposerAccess: { allowed: true, reason: null },
      });
      expect(result.original.amountKobo).toBe("2000000");
      expect(result.currentCandidate.values).toEqual(result.original);
      expect(Object.keys(result).sort()).toEqual(
        [
          "purchaseId",
          "kind",
          "asOf",
          "guard",
          "target",
          "originalContext",
          "original",
          "meterAssetId",
          "currentCandidate",
          "admission",
          "proposerAccess",
        ].sort(),
      );
    },
  );
  it("RD-01 both capture blocks retain exact sorted IDs versions and codes", async () => {
    const x = await discoveryFixture(db, "capture"),
      second = newId();
    await db.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),3)",
      [second, x.sale.purchaseId],
    );
    const result = await x.discovery.prepare(x.token, x.sale.purchaseId, {
      kind: "capture",
    });
    expect(result.target).toEqual({
      kind: "capture",
      blocks: [
        { id: x.holdId, version: 1, code: "capture_authorization_unresolved" },
        { id: second, version: 3, code: "capture_time_unresolved" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    });
  });
  it("RD-01 staged meter/date candidate is separate from original and accepted pointer", async () => {
    const x = await discoveryFixture(db, "date"),
      candidate = newId();
    await db.pool.query(
      "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','price_resolution','based_on_revision_id',r.id,'amount_kobo',1900000,'quantity',19,'calculation_mode','meter_evidence','verified_sale_date','2026-11-11'))).* FROM purchase_revision r WHERE r.id=$1",
      [x.original, candidate, newId()],
    );
    await db.pool.query(
      "UPDATE purchase SET resolution_candidate_revision_id=$2,version=version+1 WHERE id=$1",
      [x.sale.purchaseId, candidate],
    );
    const result = await x.discovery.prepare(x.token, x.sale.purchaseId, {
      kind: "date",
    });
    expect(result.guard.expectedRevisionId).toBeNull();
    expect(result.currentCandidate).toMatchObject({
      revisionId: candidate,
      source: "resolution_candidate",
      values: {
        amountKobo: "1900000",
        quantity: "19",
        calculation: "meter_evidence",
        verifiedSaleDate: "2026-11-11",
      },
    });
    expect(result.original.amountKobo).toBe("2000000");
  });
  it("RD-01 missing original context fails closed and foreign purchase is nondisclosing", async () => {
    const x = await discoveryFixture(db);
    await expect(
      x.discovery.prepare(x.token, newId(), { kind: "card" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET customer_id=NULL WHERE id=$1",
      [x.sale.purchaseId],
    );
    await expect(
      x.discovery.prepare(x.token, x.sale.purchaseId, { kind: "card" }),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
  it.each(["price", "date", "capture"] as const)(
    "RD-02 %s v1-settleable target requires ordinary review",
    async (kind) => {
      const x = await discoveryFixture(db, kind);
      if (kind === "price")
        await seedHistorical(
          db.pool,
          "product_price_version",
          "DELETE FROM product_price_version WHERE version=2 AND station_id=$1",
          [x.f.stationId],
        );
      if (kind === "date")
        await seedHistorical(
          db.pool,
          "capture_context",
          "UPDATE capture_context SET signed_in_at='2026-11-10T23:01:00Z' WHERE id=$1",
          [x.f.contextId],
        );
      if (kind === "capture")
        await seedHistorical(
          db.pool,
          "assignment",
          "UPDATE assignment SET effective_until='2026-11-10T11:59:00Z' WHERE id=$1",
          [x.f.assignmentId],
        );
      const result = await x.discovery.prepare(x.token, x.sale.purchaseId, {
        kind,
      });
      expect(result.admission).toEqual({
        state: "ordinary_review_required",
        reason: "v1_settleable",
      });
    },
  );
  it.each(["history", "photo", "settings", "deadline"] as const)(
    "RD-02 missing %s never becomes temporal admission",
    async (defect) => {
      const x = await discoveryFixture(db);
      if (defect === "history")
        await seedHistorical(
          db.pool,
          "audit_event",
          "DELETE FROM audit_event WHERE id=$1",
          [x.priceAudit],
        );
      if (defect === "photo")
        await db.pool.query(
          "UPDATE photo_asset SET deleted_at=clock_timestamp() WHERE id=$1",
          [x.sale.assetId],
        );
      if (defect === "settings")
        await seedHistorical(
          db.pool,
          "settings_version",
          "UPDATE settings_version SET campaign_id=NULL,purchase_start=NULL,purchase_cutoff=NULL,upload_deadline=NULL WHERE station_id=$1",
          [x.f.stationId],
        );
      if (defect === "deadline")
        await seedHistorical(
          db.pool,
          "purchase",
          "UPDATE purchase SET server_received_at='2026-12-03T00:00:00Z' WHERE id=$1",
          [x.sale.purchaseId],
        );
      const result = await x.discovery.prepare(x.token, x.sale.purchaseId, {
        kind: "card",
      });
      expect(result.admission.state).toBe("not_admissible");
    },
  );
  it("RD-02 categorical reason precedence chooses history before unavailable photo and invalid bounds before photo", async () => {
    const x = await discoveryFixture(db);
    await db.pool.query(
      "UPDATE photo_asset SET deleted_at=clock_timestamp() WHERE id=$1",
      [x.sale.assetId],
    );
    await seedHistorical(
      db.pool,
      "audit_event",
      "DELETE FROM audit_event WHERE id=$1",
      [x.priceAudit],
    );
    expect(
      (await x.discovery.prepare(x.token, x.sale.purchaseId, { kind: "card" }))
        .admission,
    ).toEqual({ state: "not_admissible", reason: "history_incomplete" });
    const y = await discoveryFixture(db);
    await db.pool.query(
      "UPDATE photo_asset SET deleted_at=clock_timestamp() WHERE id=$1",
      [y.sale.assetId],
    );
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET server_received_at='2026-11-09T00:00:00Z' WHERE id=$1",
      [y.sale.purchaseId],
    );
    expect(
      (await y.discovery.prepare(y.token, y.sale.purchaseId, { kind: "card" }))
        .admission,
    ).toEqual({ state: "not_admissible", reason: "invalid_capture_bounds" });
  });
  it("RD-02 positive advisory admission never bypasses invalid sheet facts or disjoint J", async () => {
    const x = await discoveryFixture(db);
    expect(
      (await x.discovery.prepare(x.token, x.sale.purchaseId, { kind: "card" }))
        .admission.state,
    ).toBe("structurally_admissible");
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        sheetAssetId: newId(),
      }),
    ).rejects.toThrow();
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        facts: {
          ...x.body.facts,
          observedCapture: {
            ...x.facts.observedCapture,
            from: "2026-11-09T12:00:00Z",
            through: "2026-11-09T12:01:00Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
  it.each([false, true])(
    "RD-03 unknown or excluded person (%s) can inspect but cannot propose",
    async (excluded) => {
      const x = await discoveryFixture(db);
      await db.pool.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,$5)",
        [
          newId(),
          x.f.stationId,
          x.actors[0],
          excluded ? x.people[2] : x.people[0],
          excluded,
        ],
      );
      const reason = excluded
        ? "independent_reviewer_required"
        : "independence_unverifiable";
      expect(
        (
          await x.discovery.prepare(x.token, x.sale.purchaseId, {
            kind: "card",
          })
        ).proposerAccess,
      ).toEqual({ allowed: false, reason });
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, x.body),
      ).rejects.toMatchObject({ code: reason });
    },
  );
  it("RD-03 competing proposal retains original operation retry and stale preparation cannot create another", async () => {
    const x = await discoveryFixture(db);
    const prepared = await x.discovery.prepare(x.token, x.sale.purchaseId, {
      kind: "card",
    });
    const id = await propose(x);
    expect(
      (await x.svc.propose(x.token, x.sale.purchaseId, x.body)).proposal.id,
    ).toBe(id);
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        ...prepared.guard,
        operationId: newId(),
      }),
    ).rejects.toThrow();
    expect((await x.discovery.pending(x.token, {})).summary.pending).toBe(1);
  });
  it("RD-03 preparation sees permission revocation committed while waiting for serialization", async () => {
    const x = await discoveryFixture(db),
      lock = await db.pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
    const pending = x.discovery
      .prepare(x.token, x.sale.purchaseId, { kind: "card" })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    try {
      await waitForBlockedReader();
      await lock.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='cardEligibility'",
        [fixtureId(1)],
      );
      await lock.query("COMMIT");
      const result = await pending;
      expect(result).toMatchObject({ error: { code: "permission_denied" } });
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      await restoreGrants();
    }
  });
  it("RD-04 more than 100 tied and submillisecond stale pending proposals traverse exactly once with fresh summary", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x);
    await addPending(x, id, 105);
    let page = await x.discovery.pending(x.token, { limit: 17 });
    expect(page.summary.pending).toBe(106);
    const seen = page.items.map((r) => r.proposalId);
    const firstCursor = page.nextCursor!;
    const newRows = await addPending(x, id, 1);
    await seedHistorical(
      db.pool,
      "held_release_proposal",
      "UPDATE held_release_proposal SET proposed_at=clock_timestamp()+interval '1 second' WHERE id=$1",
      [newRows[0]!.proposal],
    );
    const unseen = (
      await db.pool.query(
        "SELECT id FROM held_release_proposal WHERE id<>ALL($1::uuid[]) AND id<>$2 ORDER BY proposed_at DESC,id DESC LIMIT 1",
        [seen, newRows[0]!.proposal],
      )
    ).rows[0].id as string;
    await closePending(x, unseen);
    while (page.nextCursor) {
      page = await x.discovery.pending(x.token, {
        limit: 17,
        cursor: page.nextCursor,
      });
      expect(page.summary.pending).toBe(106);
      seen.push(...page.items.map((r) => r.proposalId));
    }
    expect(new Set(seen).size).toBe(105);
    expect(seen).toHaveLength(105);
    expect(seen).not.toContain(unseen);
    expect(seen).not.toContain(newRows[0]!.proposal);
    expect(
      (await x.discovery.pending(x.token, { limit: 1 })).items[0]!.proposalId,
    ).toBe(newRows[0]!.proposal);
    expect(firstCursor).toBeTruthy();
  });
  it.each(["target", "candidate", "policy", "person"] as const)(
    "RD-03 preparation coherently observes %s change committed before its locked read",
    async (change) => {
      const x = await discoveryFixture(db),
        writer = await db.pool.connect();
      await writer.query("BEGIN");
      await writer.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      const read = x.discovery
        .prepare(x.token, x.sale.purchaseId, { kind: "card" })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      try {
        await waitForBlockedReader();
        if (change === "target")
          await writer.query(
            "UPDATE purchase_hold SET state='cancelled',version=version+1 WHERE id=$1",
            [x.holdId],
          );
        if (change === "candidate")
          await writer.query(
            "UPDATE purchase SET version=version+1 WHERE id=$1",
            [x.sale.purchaseId],
          );
        if (change === "person")
          await writer.query(
            "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,false)",
            [newId(), x.f.stationId, x.actors[0], x.people[0]],
          );
        if (change === "policy")
          await writer.query(
            "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',3,$3,'Fictional deactivation')",
            [
              newId(),
              x.f.stationId,
              {
                ...x.policy,
                revision: 3,
                activation: {
                  state: "inactive",
                  approvalReference: null,
                  activatedAt: null,
                },
              },
            ],
          );
        await writer.query("COMMIT");
        const result = await read;
        if (change === "target")
          expect(result).toMatchObject({ error: { code: "review_closed" } });
        if (change === "policy")
          expect(result).toMatchObject({
            error: { code: "release_policy_unconfigured" },
          });
        if (change === "candidate")
          expect(result).toMatchObject({
            value: { guard: { expectedVersion: x.body.expectedVersion + 1 } },
          });
        if (change === "person")
          expect(result).toMatchObject({
            value: {
              proposerAccess: {
                allowed: false,
                reason: "independence_unverifiable",
              },
            },
          });
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
      }
    },
  );
  it("RD-05 admin summaries are kind filtered while ordinary sales membership and attendant wire types stay unchanged", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x);
    const detail = await readSales(
      db.pool,
      config,
      x.token,
      "admin",
      "detail",
      {},
      x.sale.purchaseId,
    );
    expect(detail).toMatchObject({
      pendingRelease: { proposalId: id, kind: "card" },
    });
    const filtered = await readSales(
      db.pool,
      config,
      x.token,
      "admin",
      "search",
      { status: "pending_release" },
    );
    expect(filtered).toMatchObject({
      items: [{ id: x.sale.purchaseId, pendingRelease: { proposalId: id } }],
    });
    const ordinary = await readSales(
      db.pool,
      config,
      x.token,
      "admin",
      "search",
      { status: "card_review" },
    );
    expect(ordinary).toMatchObject({ items: [{ id: x.sale.purchaseId }] });
    await grants(["sales", "priceReview"]);
    expect(
      await readSales(
        db.pool,
        config,
        x.token,
        "admin",
        "detail",
        {},
        x.sale.purchaseId,
      ),
    ).toMatchObject({ pendingRelease: null });
    expect(
      await readSales(db.pool, config, x.token, "admin", "search", {
        status: "pending_release",
      }),
    ).toMatchObject({ items: [] });
    expect(
      await readSales(db.pool, config, x.token, "admin", "search", {
        status: "card_review",
      }),
    ).toMatchObject({
      items: [{ id: x.sale.purchaseId, pendingRelease: null }],
    });
    await restoreGrants();
  });
  it("RD-04 first page snapshots only after commit-order lock and includes earlier-timestamp waiting insert", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x),
      writer = await db.pool.connect();
    await writer.query("BEGIN");
    await writer.query(
      "SELECT id FROM security_state WHERE id=true FOR UPDATE",
    );
    const inserted = await clonePending(
      writer,
      x,
      id,
      "card",
      "2026-11-16T00:00:00.000001Z",
    );
    const pending = x.discovery.pending(x.token, { limit: 100 });
    try {
      await waitForBlockedReader();
      await writer.query("COMMIT");
      const result = await pending;
      expect(result.summary.pending).toBe(2);
      expect(result.items.map((r) => r.proposalId)).toContain(
        inserted.proposal,
      );
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });
  it("RD-04 stale persisted proposals remain discoverable after policy deactivation target closure and candidate drift", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x);
    await db.pool.query(
      "UPDATE purchase SET version=version+1,status='cancelled' WHERE id=$1",
      [x.sale.purchaseId],
    );
    await seedHistorical(
      db.pool,
      "purchase_hold",
      "UPDATE purchase_hold SET state='cancelled' WHERE id=$1",
      [x.holdId],
    );
    const inactive = {
      ...x.policy,
      revision: 3,
      activation: {
        state: "inactive",
        approvalReference: null,
        activatedAt: null,
      },
    };
    await db.pool.query(
      "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',3,$3,'Fictional deactivation')",
      [newId(), x.f.stationId, inactive],
    );
    expect(
      (await x.discovery.pending(x.token, {})).items.map((r) => r.proposalId),
    ).toEqual([id]);
    await expect(
      x.discovery.prepare(x.token, x.sale.purchaseId, { kind: "card" }),
    ).rejects.toThrow();
  });
  it("RD-05 all eight kind-grant combinations filter rows and full counts before pagination", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x);
    await addPending(x, id, 12, kinds);
    for (let mask = 0; mask < 8; mask++) {
      const selected = ["priceReview", "cardEligibility", "dateReview"].filter(
        (_, i) => (mask & (1 << i)) !== 0,
      );
      await grants(["sales", ...selected]);
      if (mask === 0) {
        await expect(x.discovery.pending(x.token, {})).rejects.toMatchObject({
          code: "permission_denied",
        });
        continue;
      }
      const allowed = kinds.filter((k) =>
        selected.includes(
          k === "price"
            ? "priceReview"
            : k === "card"
              ? "cardEligibility"
              : "dateReview",
        ),
      );
      const page = await x.discovery.pending(x.token, { limit: 1 });
      expect(page.summary.pending).toBe(
        allowed.reduce((n, k) => n + 3 + (k === "card" ? 1 : 0), 0),
      );
      expect(allowed).toContain(page.items[0]!.kind);
      for (const kind of kinds)
        if (!allowed.includes(kind))
          await expect(
            x.discovery.pending(x.token, { kind }),
          ).rejects.toMatchObject({ code: "permission_denied" });
    }
    await restoreGrants();
  });
  it("RD-05 cursors reject tampering another actor changed kind filter and changed live grants", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x);
    await addPending(x, id, 2);
    const first = await x.discovery.pending(x.token, { limit: 1 });
    const cursor = first.nextCursor!;
    for (const [token, query] of [
      [x.token, { cursor: cursor.slice(0, -1) + "!" }],
      [x.reviewerToken, { cursor }],
      [x.token, { cursor, kind: "card" }],
    ] as const)
      await expect(x.discovery.pending(token, query)).rejects.toMatchObject({
        code: "invalid_request",
      });
    await grants(["sales", "cardEligibility"]);
    await expect(
      x.discovery.pending(x.token, { cursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await grants(["cardEligibility"]);
    await expect(
      x.discovery.pending(x.token, { cursor }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await restoreGrants();
  });
  it("RD-05 HTTP rejects duplicate unknown query keys and malformed limits with protected no-store envelopes", async () => {
    const x = await discoveryFixture(db);
    for (const [query, purchaseId] of [
      ["kind=card&kind=price", x.sale.purchaseId],
      ["kind=card&extra=1", x.sale.purchaseId],
      ["kind=unknown", x.sale.purchaseId],
      ["limit=1&limit=2", undefined],
      ["extra=1", undefined],
      ["limit=0", undefined],
      ["limit=101", undefined],
      ["cursor=" + "a".repeat(8193), undefined],
    ] as const) {
      const result = await handleReleaseDiscovery(
        new Request(`https://reviews.example.test/api/test?${query}`, {
          headers: { cookie: `__Host-whr-admin-session=${x.token}` },
        }),
        purchaseId,
      );
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({
        error: { code: "invalid_request", retryable: false },
      });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.get("vary")).toBe("Cookie");
      expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
  it("RD-05 pending sales search enforces POST Origin before disclosing summaries", async () => {
    const x = await discoveryFixture(db);
    await propose(x);
    const request = (origin: string) =>
      new Request("https://reviews.example.test/api/admin/sales/search", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `__Host-whr-admin-session=${x.token}`,
        },
        body: JSON.stringify({ status: "pending_release" }),
      });
    const denied = await handleSalesRead(
      request("https://foreign.example.test"),
      "admin",
      "search",
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "origin_rejected" },
    });
    const allowed = await handleSalesRead(
      request("https://reviews.example.test"),
      "admin",
      "search",
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      data: { items: [{ pendingRelease: { kind: "card" } }] },
    });
    expect(allowed.headers.get("cache-control")).toBe("no-store");
  });
  it("RD-05 sales-only audit-only leaderboard-only and restricted sessions cannot disclose queue actors", async () => {
    const x = await discoveryFixture(db);
    await propose(x);
    for (const permissions of [["sales"], ["audit"], ["leaderboards"]]) {
      await grants(permissions);
      await expect(x.discovery.pending(x.token, {})).rejects.toMatchObject({
        code: "permission_denied",
      });
    }
    await restoreGrants();
    await db.pool.query(
      "UPDATE auth_user SET must_change_password=true WHERE id=$1",
      [x.actors[0]],
    );
    await expect(x.discovery.pending(x.token, {})).rejects.toMatchObject({
      code: "password_change_required",
    });
    await db.pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [x.actors[0]],
    );
    await expect(x.discovery.pending(undefined, {})).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
  it("RD-05 non-superuser read applies live grants and emits only closed safe summary fields", async () => {
    const x = await discoveryFixture(db),
      id = await propose(x),
      role = `rd_reader_${randomBytes(5).toString("hex")}`;
    const schema = (await db.pool.query("SELECT current_schema() name")).rows[0]
      .name as string;
    expect(schema).toMatch(/^evidence_[a-f0-9]+$/);
    await db.pool.query(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await db.pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await db.pool.query(
      `GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set(
      "options",
      `-c search_path=${schema},public -c role=${role}`,
    );
    const pool = new pg.Pool({ connectionString: url.toString() });
    try {
      expect(
        (
          await pool.query(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0].rolsuper,
      ).toBe(false);
      const svc = createReleaseDiscoveryService({ pool, env: x.env });
      const page = await svc.pending(x.token, {});
      expect(page.items[0]!.proposalId).toBe(id);
      expect(Object.keys(page.items[0]!).sort()).toEqual(
        [
          "proposalId",
          "proposalVersion",
          "kind",
          "outcome",
          "state",
          "proposedBy",
          "proposedAt",
          "purchaseId",
          "saleCode",
        ].sort(),
      );
      const body = JSON.stringify(page);
      for (const secret of [
        x.facts.entryReference,
        x.people[0],
        x.body.sheetAssetId,
        x.sale.assetId,
        "recordedAmountKobo",
        "provenance",
        "https://",
      ])
        expect(body).not.toContain(secret);
      await grants(["sales"]);
      await expect(svc.pending(x.token, {})).rejects.toMatchObject({
        code: "permission_denied",
      });
    } finally {
      await pool.end();
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.pool.query(`DROP ROLE ${role}`);
      await restoreGrants();
    }
  });
  it("RD-06 preparation queue and sales refresh are read-only with no audit receipt version or generation changes", async () => {
    const x = await discoveryFixture(db);
    await propose(x);
    const before = await state(x);
    const reportBefore = (
      await db.pool.query(
        "SELECT * FROM station_reporting_state ORDER BY station_id",
      )
    ).rows;
    const historyBefore = (
      await db.pool.query("SELECT count(*)::int n FROM held_release_transition")
    ).rows;
    await x.discovery.prepare(x.token, x.sale.purchaseId, { kind: "card" });
    await x.discovery.pending(x.token, {});
    await readSales(
      db.pool,
      config,
      x.token,
      "admin",
      "detail",
      {},
      x.sale.purchaseId,
    );
    expect(await state(x)).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM station_reporting_state ORDER BY station_id",
        )
      ).rows,
    ).toEqual(reportBefore);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM held_release_transition",
        )
      ).rows,
    ).toEqual(historyBefore);
  });
  it.each(["initial", "revision", "unchanged"] as const)(
    "RD-06 inaccessible stale pending release blocks %s giveaway and cannot enter phone exclusions",
    async (stage) => {
      const x = await discoveryFixture(db);
      const f = await giveawayAtStation(db.pool, x.f.stationId, x.token);
      await f.check();
      if (stage !== "initial") {
        const prepared = await prepareGiveaway(
          db.pool,
          x.token,
          f.campaignId,
          {
            operationId: newId(),
            kind: "initial",
            reason: "Fictional initial snapshot",
            ...(await f.guard()),
          },
          config,
        );
        const preview = prepared.data as { id: string; contentDigest: string };
        await confirmGiveaway(
          db.pool,
          x.token,
          f.campaignId,
          {
            operationId: newId(),
            previewId: preview.id,
            contentDigest: preview.contentDigest,
            ...(await f.guard()),
          },
          undefined,
          config,
        );
        await f.check("revision");
      }
      await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        ...(await x.h.guard(x.sale.purchaseId)),
      });
      await db.pool.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
        x.sale.purchaseId,
      ]);
      await grants([
        "sales",
        "priceReview",
        "leaderboards",
        "giveawayFinalize",
        "giveawayRevise",
      ]);
      expect((await x.discovery.pending(x.token, {})).items).toEqual([]);
      const readiness = await readReadiness(db.pool, x.token, f.campaignId);
      expect(readiness.blockers).toContain("reviews_unresolved");
      expect(readiness.counts.holds).toBe("1");
      expect(readiness.counts).not.toHaveProperty("pendingReleases");
      await expect(
        prepareGiveaway(
          db.pool,
          x.token,
          f.campaignId,
          {
            operationId: newId(),
            kind: stage === "initial" ? "initial" : "revision",
            reason: "Fictional pending blocker",
            ...(await f.guard()),
          },
          config,
        ),
      ).rejects.toMatchObject({ code: "finalization_blocked" });
      const census = (
        await db.pool.query(
          "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
          [f.campaignId],
        )
      ).rows[0];
      await expect(
        f.phones.propose(x.token, f.campaignId, census.content.phones[0].id, {
          operationId: newId(),
          kind: stage === "initial" ? "initial" : "revision",
          reason: "Fictional invalid pending exclusion",
          ...(await f.guard()),
          expectedCensusVersion: census.version,
          expectedPhoneVersion: 1,
          partialSources: [
            {
              purchaseId: x.sale.purchaseId,
              expectedPurchaseVersion: (await x.h.guard(x.sale.purchaseId))
                .expectedVersion,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
      await restoreGrants();
    },
  );
});
