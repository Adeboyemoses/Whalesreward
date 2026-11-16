import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { createHeldReleaseService } from "../../src/server/modules/reviews/release-service";
import { reviewEvidenceV2ReleaseArtifact } from "../../src/server/modules/reviews/release-v2";
import {
  evidenceDatabase,
  S,
  sourceAudit,
  seedHistorical,
} from "../helpers/review-evidence-fixture";
import { fixtureId } from "../helpers/sync-fixture";
import { heldReleaseFixture } from "../helpers/held-release-fixture";
// Dormant protocol only: actual installation remains denied and is verified separately.
vi.mock(
  "../../src/server/modules/reviews/release-v2",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    assertReleaseV2Installation: vi.fn(async () => {}),
  }),
);
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
async function fixture(kind: "card" | "price" = "card") {
  const x = await heldReleaseFixture(db, kind);
  const approval = newId();
  const policy = {
    release: "review-evidence-v2",
    digest: createHash("sha256")
      .update(reviewEvidenceV2ReleaseArtifact)
      .digest("hex"),
    revision: 2,
    scope: { stationId: x.f.stationId, environment: "test" },
    activation: {
      state: "active",
      approvalReference: approval,
      activatedAt: S,
    },
  };
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,2,$4,'test',$5,'Fictional isolated test approval')",
    [approval, policy.release, policy.digest, x.f.stationId, S],
  );
  await db.pool.query(
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',2,$3,'Fictional isolated test approval')",
    [newId(), x.f.stationId, policy],
  );
  const sheet = newId(),
    bytes = await x.h.image();
  await db.pool.query(
    "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '15 minutes')",
    [
      sheet,
      x.sale.purchaseId,
      x.f.stationId,
      x.actors[0],
      x.people[0],
      x.target,
      createHash("sha256").update(bytes).digest("hex"),
      bytes.length,
      `staging/${sheet}`,
    ],
  );
  await db.pool.query(
    "INSERT INTO held_release_sheet_validation(asset_id,final_key,display_key) VALUES($1,$2,$3)",
    [sheet, `final/${sheet}`, `display/${sheet}`],
  );
  x.h.objects.set(`final/${sheet}`, bytes);
  x.h.objects.set(`display/${sheet}`, bytes);
  const reviewerToken = randomBytes(32).toString("hex");
  await db.pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
    [newId(), x.actors[1], digest(reviewerToken)],
  );
  const body = {
    ...(await x.h.guard(x.sale.purchaseId)),
    target: x.target,
    outcome: "confirm",
    sheetAssetId: sheet,
    meterAssetId: x.sale.assetId,
    facts: x.facts,
  };
  const env = {
    ...process.env,
    WHR_ENV: "test",
    WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
  };
  const raw = createHeldReleaseService({
    pool: db.pool,
    storage: x.h.storage,
    env,
  });
  const proposalResponse = z
    .object({
      id: z.string().uuid(),
      state: z.enum(["pending", "approved", "rejected", "superseded"]),
    })
    .passthrough();
  const svc = {
    ...raw,
    async propose(...args: Parameters<typeof raw.propose>) {
      return z
        .object({ proposal: proposalResponse, replayed: z.boolean() })
        .parse(await raw.propose(...args));
    },
    async decide(...args: Parameters<typeof raw.decide>) {
      return z
        .object({
          proposal: proposalResponse,
          decision: z.object({ result: z.unknown() }).passthrough(),
        })
        .passthrough()
        .parse(await raw.decide(...args));
    },
  };
  return {
    ...x,
    body,
    policy,
    reviewerToken,
    svc,
  };
}
describe("P-29 dormant two-person service on real Postgres", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://reviews.example.test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  it.each(["card", "price"] as const)(
    "SR-05 %s approval and lost response replay apply one immutable decision",
    async (kind) => {
      const x = await fixture(kind);
      const proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
      expect(proposed.proposal.state).toBe("pending");
      const decision = {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      };
      const result = await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposed.proposal.id,
        decision,
      );
      expect(result.proposal.state).toBe("approved");
      expect(
        await x.svc.decide(
          x.reviewerToken,
          x.sale.purchaseId,
          proposed.proposal.id,
          decision,
        ),
      ).toEqual(result);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1 AND kind='held_release'",
            [x.sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(1);
    },
  );
  it("SR-03 proposer cannot approve own proposal and unknown reviewer binding denies", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const decision = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "approve",
    };
    await expect(
      x.svc.decide(x.token, x.sale.purchaseId, proposal.id, decision),
    ).rejects.toMatchObject({ code: "independent_reviewer_required" });
    await db.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,false)",
      [newId(), x.f.stationId, x.actors[1], x.people[1]],
    );
    await expect(
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, decision),
    ).rejects.toMatchObject({ code: "independence_unverifiable" });
    expect(
      (await x.svc.get(x.token, x.sale.purchaseId, proposal.id)).state,
    ).toBe("pending");
  });
  it("SR-05 simultaneous proposers create only one immutable pending proposal", async () => {
    const x = await fixture();
    const results = await Promise.allSettled([
      x.svc.propose(x.token, x.sale.purchaseId, x.body),
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        operationId: newId(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM held_release_state WHERE purchase_id=$1 AND state='pending'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("SR-05 changed facts under the same proposal operation conflict without a second event", async () => {
    const x = await fixture();
    const first = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
    expect(
      (await x.svc.propose(x.token, x.sale.purchaseId, x.body)).proposal,
    ).toEqual(first.proposal);
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        facts: { ...x.body.facts, entryReference: "Different entry" },
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM audit_event WHERE target_id=$1 AND action='held_release_proposed'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("SR-06 independent rejection works after deactivation and retains the hold", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
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
    const decision = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "reject",
    };
    const result = await x.svc.decide(
      x.reviewerToken,
      x.sale.purchaseId,
      proposal.id,
      decision,
    );
    expect(result.proposal.state).toBe("rejected");
    expect(result.decision.result).toBeNull();
    expect(
      (
        await db.pool.query("SELECT state FROM purchase_hold WHERE id=$1", [
          x.holdId,
        ])
      ).rows[0].state,
    ).toBe("open");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1 AND kind='held_release'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("SR-05 opposing approvers have one winner under the same purchase and proposal guard", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const guard = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
    };
    const results = await Promise.allSettled([
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...guard,
        outcome: "approve",
      }),
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...guard,
        operationId: newId(),
        outcome: "reject",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM held_release_transition WHERE proposal_id=$1 AND state<>'pending'",
          [proposal.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("SR-03 proposer disablement makes approval stale but permits independent rejection", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      x.actors[0],
    ]);
    const guard = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
    };
    await expect(
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...guard,
        outcome: "approve",
      }),
    ).rejects.toMatchObject({ code: "proposal_stale" });
    expect(
      (
        await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
          ...guard,
          operationId: newId(),
          outcome: "reject",
        })
      ).proposal.state,
    ).toBe("rejected");
  });
  it("SR-03 same-person alias and attendant alias cannot approve", async () => {
    for (const excluded of [0, 2]) {
      const x = await fixture();
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      await db.pool.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,true)",
        [newId(), x.f.stationId, x.actors[1], x.people[excluded]],
      );
      await expect(
        x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedProposalVersion: 1,
          outcome: "approve",
        }),
      ).rejects.toMatchObject({ code: "independent_reviewer_required" });
    }
  });
  it("SR-06 unrelated purchase change cannot silently rebase frozen approval", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    await db.pool.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
      x.sale.purchaseId,
    ]);
    await expect(
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      }),
    ).rejects.toMatchObject({ code: "proposal_stale" });
    expect(
      (await x.svc.get(x.token, x.sale.purchaseId, proposal.id)).state,
    ).toBe("pending");
  });
  it("SR-08 protected proposal detail and list retain facts while general audit omits them", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const detail = await x.svc.get(
      x.reviewerToken,
      x.sale.purchaseId,
      proposal.id,
    );
    expect(detail.facts.entryReference).toBe(x.facts.entryReference);
    const page = await x.svc.list(x.reviewerToken, x.sale.purchaseId, {
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    const audit = JSON.stringify(
      (
        await db.pool.query(
          "SELECT * FROM audit_event WHERE target_id=$1 AND action LIKE 'held_release_%'",
          [x.sale.purchaseId],
        )
      ).rows,
    );
    expect(audit).not.toContain(x.facts.entryReference);
    expect(audit).not.toContain("recordedAmountKobo");
    expect(audit).not.toContain(x.people[0]);
  });
  it("SR-03 reviewer revocation during slow evidence read aborts approval", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const read = x.h.storage.read.bind(x.h.storage);
    let revoked = false;
    x.h.storage.read = async (...args) => {
      if (!revoked) {
        revoked = true;
        await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
          x.actors[1],
        ]);
      }
      return read(...args);
    };
    await expect(
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      }),
    ).rejects.toThrow();
    expect(revoked).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT state FROM held_release_state WHERE proposal_id=$1",
          [proposal.id],
        )
      ).rows[0].state,
    ).toBe("pending");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1 AND kind='held_release'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("SR-07 successful approval replays after deactivation without reinterpretation", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const decision = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "approve",
    };
    const result = await x.svc.decide(
      x.reviewerToken,
      x.sale.purchaseId,
      proposal.id,
      decision,
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
      await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposal.id,
        decision,
      ),
    ).toEqual(result);
    await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      x.actors[1],
    ]);
    await expect(
      x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, decision),
    ).rejects.toThrow();
  });
  it.each(["card_first", "price_first"])(
    "SR-02a disjoint same-sale card and price attestations deny the second proposal in %s order",
    async (order) => {
      const x = await fixture();
      for (const [version, rate, at] of [
        [2, "110000", "2026-11-10T12:15:00Z"],
        [3, "100000", "2026-11-10T12:45:00Z"],
      ] as const) {
        const id = newId();
        await db.pool.query(
          "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,$4,$5,'NGN',2,$6,$7,'Fictional joint constraint')",
          [id, x.f.stationId, fixtureId(9), version, rate, at, fixtureId(5)],
        );
        await sourceAudit(
          db.pool,
          "price_activated",
          "product",
          fixtureId(9),
          { priceVersionId: id, version, rateKobo: rate, quantityPrecision: 2 },
          at,
        );
      }
      const holdId = newId();
      await db.pool.query(
        "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'price','open',$3,'price_uncertain',1)",
        [holdId, x.sale.purchaseId, x.original],
      );
      const priceTarget = { kind: "price", holdId, expectedHoldVersion: 1 };
      const priceFacts = {
        ...x.facts,
        observedCapture: {
          ...x.facts.observedCapture,
          from: "2026-11-10T12:50:00.000Z",
          through: "2026-11-10T12:55:00.000Z",
        },
      };
      const first =
        order === "card_first"
          ? x.body
          : { ...x.body, target: priceTarget, facts: priceFacts };
      if (order === "price_first")
        await seedHistorical(
          db.pool,
          "held_release_sheet",
          "UPDATE held_release_sheet SET target=$2 WHERE id=$1",
          [x.body.sheetAssetId, priceTarget],
        );
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        first,
      );
      await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      });
      const second = {
        ...(order === "card_first"
          ? { ...x.body, target: priceTarget, facts: priceFacts }
          : x.body),
        ...(await x.h.guard(x.sale.purchaseId)),
      };
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, second),
      ).rejects.toMatchObject({ code: "evidence_insufficient" });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1 AND kind='held_release'",
            [x.sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.pool.query("SELECT status FROM purchase WHERE id=$1", [
            x.sale.purchaseId,
          ])
        ).rows[0].status,
      ).toBe("held");
    },
  );
});
