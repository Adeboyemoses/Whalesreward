import { readSales } from "../../src/server/modules/sales/service";
import { saleDetailSchema } from "../../src/shared/contracts/sales";
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
import { contributions } from "../../src/server/modules/giveaway/data";
// Dormant protocol only: actual installation remains denied and is verified separately.
vi.mock(
  "../../src/server/modules/reviews/release-v2",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    assertReleaseV2Installation: vi.fn(async () => {}),
  }),
);
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
async function fixture(kind: "card" | "price" | "date" | "capture" = "card") {
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
    readerFactory: () => ({
      read: x.h.storage.read,
      available: async () => true,
      signGet: async () => "https://evidence.example.test/fictional",
    }),
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
async function recoveredCorrection(
  x: Awaited<ReturnType<typeof fixture>>,
  recoveryUser: string,
) {
  const correction = newId(),
    revision = newId(),
    operation = newId();
  const recoveryAdmin = (
    await db.pool.query("SELECT id FROM admin WHERE user_id=$1", [recoveryUser])
  ).rows[0].id;
  const session = (
    await db.pool.query(
      "SELECT id FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [recoveryUser],
    )
  ).rows[0].id;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,version,authority_session_id,reserved_purchase_version,receipt) VALUES($1,$2,$3,$4,'fictional recovery','fictional recovery',$5,$6,$7,'2026-11-10T12:00:00Z','2026-11-10T23:00:00Z','p20-bounded-day-v1','before_midnight','rejected','Fictional recovered proposal',$8,NULL,'unverified_recovery',$9,$9,ARRAY[]::text[],1,$10,$6+1,'{}')",
      [
        correction,
        x.sale.purchaseId,
        x.f.attendantId,
        operation,
        x.original,
        x.body.expectedVersion,
        revision,
        recoveryUser,
        recoveryAdmin,
        session,
      ],
    );
    await client.query(
      "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','admin_correction','state','rejected','actor_user_id',$5::text,'reason','Fictional recovered proposal','based_on_revision_id',r.id,'correction_id',$4::text))).* FROM purchase_revision r WHERE r.id=$1",
      [x.original, revision, operation, correction, recoveryUser],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-05 %s approval and lost response replay apply one immutable decision",
    async (kind) => {
      const x = await fixture(kind);
      const readDetail = async () =>
        saleDetailSchema.parse(
          await readSales(
            db.pool,
            {
              secret: process.env.BETTER_AUTH_SECRET!,
              origin: "https://reviews.example.test",
            },
            x.token,
            "admin",
            "detail",
            {},
            x.sale.purchaseId,
          ),
        );
      const before = await readDetail();
      const originalBefore = (
        await db.pool.query(
          "SELECT to_jsonb(r)-ARRAY['state','version','decision_actor_id','decision_reason','decided_at'] value FROM purchase_revision r WHERE id=$1",
          [x.original],
        )
      ).rows[0]!.value;
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
      const after = await readDetail();
      expect(after.original).toEqual(before.original);
      expect(
        (
          await db.pool.query(
            "SELECT to_jsonb(r)-ARRAY['state','version','decision_actor_id','decision_reason','decided_at'] value FROM purchase_revision r WHERE id=$1",
            [x.original],
          )
        ).rows[0]!.value,
      ).toEqual(originalBefore);
      if (kind === "date") {
        expect(after.verifiedSaleDate).toBe("2026-11-11");
        expect(after.displayedValues.verifiedSaleDate).toBe("2026-11-11");
      }
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
  it.each([
    ["purchase", "{target,purchaseId}", (): string => newId()],
    ["decision", "{target,decisionId}", (): string => newId()],
    ["station", "{policy,scope,stationId}", (): string => newId()],
    [
      "purchase version",
      "{result,appliedPurchaseVersion}",
      (): number => 987654,
    ],
    ["revision", "{result,resultingRevisionId}", (): string => newId()],
    ["meter evidence", "{result,evidenceAssetId}", (): string => newId()],
    ["closure", "{result,closure}", (): string => "cancelled"],
  ] as const)(
    "WHR-184 P-29 campaign reader rejects a foreign %s binding",
    async (_name, path, foreign) => {
      const x = await fixture("capture");
      const timingBlock = newId();
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
        [timingBlock, x.sale.purchaseId],
      );
      await seedHistorical(
        db.pool,
        "settings_version",
        "UPDATE settings_version SET purchase_start='2026-11-10T12:05:00Z' WHERE station_id=$1",
        [x.f.stationId],
      );
      const target = {
        kind: "capture",
        blocks: [
          {
            id: x.holdId,
            version: 1,
            code: "capture_authorization_unresolved",
          },
          { id: timingBlock, version: 1, code: "capture_time_unresolved" },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      };
      await seedHistorical(
        db.pool,
        "held_release_sheet",
        "UPDATE held_release_sheet SET target=$2 WHERE id=$1",
        [x.body.sheetAssetId, target],
      );
      const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        target,
      });
      await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      });
      const timing = (
        await db.pool.query(
          `SELECT campaign_id id,id settings_id,
          (extract(epoch FROM launch_at)*1000000)::bigint::text launch,
          (extract(epoch FROM purchase_start)*1000000)::bigint::text start,
          (extract(epoch FROM purchase_cutoff)*1000000)::bigint::text cutoff,
          (extract(epoch FROM upload_deadline)*1000000)::bigint::text deadline
         FROM settings_version WHERE station_id=$1 ORDER BY version DESC LIMIT 1`,
          [x.f.stationId],
        )
      ).rows[0];
      const bounds = {
        ...timing,
        launch: (BigInt(Date.parse(S)) * 1000n).toString(),
        settingsVersionId: timing.settings_id,
      };
      const client = await db.pool.connect();
      try {
        const read = async () =>
          (await contributions(client, x.f.stationId, bounds)).find(
            (s) => s.purchaseId === x.sale.purchaseId,
          )!;
        expect((await read()).reasons).not.toContain("timing_unresolved");
        for (const foreignBounds of [
          { ...bounds, id: newId() },
          { ...bounds, settingsVersionId: newId() },
        ]) {
          const row = (
            await contributions(client, x.f.stationId, foreignBounds)
          ).find((s) => s.purchaseId === x.sale.purchaseId)!;
          expect(row.included).toBe(false);
          expect(row.reasons).toContain("timing_unresolved");
        }
        const before = (
          await db.pool.query(
            "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].provenance;
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "UPDATE review_evaluation SET provenance=jsonb_set(provenance,$2::text[],$3::jsonb) WHERE purchase_id=$1",
          [x.sale.purchaseId, path, JSON.stringify(foreign())],
        );
        const row = await read();
        expect(row.included).toBe(false);
        expect(row.reasons).toContain("timing_unresolved");
        // Restore only fixture corruption, never a runtime mutation of protected proof.
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "UPDATE review_evaluation SET provenance=$2::jsonb WHERE purchase_id=$1",
          [x.sale.purchaseId, JSON.stringify(before)],
        );
      } finally {
        client.release();
      }
    },
    30000,
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
  it("SR-04 photo access is per-kind, bound to proposal and expires within sixty seconds", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const before = Date.now();
    const access = await x.svc.photoAccess(
      x.reviewerToken,
      x.sale.purchaseId,
      proposal.id,
      { assetId: x.body.sheetAssetId },
    );
    expect(new Date(access.expiresAt).getTime() - before).toBeLessThanOrEqual(
      61000,
    );
    await expect(
      x.svc.photoAccess(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        assetId: x.sale.assetId,
      }),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    await db.pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='cardEligibility'",
      [fixtureId(1)],
    );
    try {
      await expect(
        x.svc.get(x.reviewerToken, x.sale.purchaseId, proposal.id),
      ).rejects.toMatchObject({ code: "permission_denied" });
      await expect(
        x.svc.photoAccess(x.reviewerToken, x.sale.purchaseId, proposal.id, {
          assetId: x.body.sheetAssetId,
        }),
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(
        (await x.svc.list(x.reviewerToken, x.sale.purchaseId, { limit: 25 }))
          .items,
      ).toHaveLength(0);
    } finally {
      await db.pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'cardEligibility') ON CONFLICT DO NOTHING",
        [fixtureId(1)],
      );
    }
  });
  it("SR-07 actual incomplete installation gate denies even while dormant service tests use a mock", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/server/modules/reviews/release-v2")
    >("../../src/server/modules/reviews/release-v2");
    await expect(
      actual.assertReleaseV2Installation(db.pool, newId()),
    ).rejects.toThrow("release_policy_unconfigured");
  });
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-02 %s cancel requires void-marked paper and preserves terminal zero contribution",
    async (kind) => {
      const x = await fixture(kind);
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, {
          ...x.body,
          outcome: "cancel",
        }),
      ).rejects.toMatchObject({ code: "evidence_insufficient" });
      const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        operationId: newId(),
        outcome: "cancel",
        facts: { ...x.body.facts, finding: "entry_marked_void" },
      });
      const result = await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposal.id,
        {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedProposalVersion: 1,
          outcome: "approve",
        },
      );
      expect(result.proposal.state).toBe("approved");
      expect(
        (
          await db.pool.query(
            "SELECT status,current_revision_id FROM purchase WHERE id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].status,
      ).toBe("cancelled");
      expect(
        (
          await db.pool.query(
            kind === "capture"
              ? "SELECT closure_kind AS state FROM purchase_validation_block WHERE id=$1"
              : "SELECT state FROM purchase_hold WHERE id=$1",
            [x.holdId],
          )
        ).rows[0].state,
      ).toBe("cancelled");
    },
  );
  it("SR-04 revoked reviewer cannot receive a sheet URL after slow storage read", async () => {
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
      x.svc.photoAccess(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        assetId: x.body.sheetAssetId,
      }),
    ).rejects.toThrow();
    expect(revoked).toBe(true);
  });
  it("SR-02 unsupported paper submillisecond precision returns evidence_insufficient without proposal", async () => {
    const x = await fixture();
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        facts: {
          ...x.body.facts,
          observedCapture: {
            ...x.facts.observedCapture,
            from: "2026-11-10T12:10:00.000001Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it.each(["proposer", "reviewer"])(
    "SR-03 recovery %s stored by admin ID is excluded by canonical user identity",
    async (which) => {
      const x = await fixture();
      await recoveredCorrection(x, x.actors[which === "proposer" ? 0 : 1]!);
      if (which === "proposer")
        await expect(
          x.svc.propose(x.token, x.sale.purchaseId, x.body),
        ).rejects.toMatchObject({
          code: "independent_reviewer_required",
          status: 403,
        });
      else {
        const { proposal } = await x.svc.propose(
          x.token,
          x.sale.purchaseId,
          x.body,
        );
        await expect(
          x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
            ...(await x.h.guard(x.sale.purchaseId)),
            expectedProposalVersion: 1,
            outcome: "approve",
          }),
        ).rejects.toMatchObject({
          code: "independent_reviewer_required",
          status: 403,
        });
      }
    },
  );
  it("SR-02a frozen lookup composite source remains valid protected provenance", async () => {
    const x = await fixture();
    const link = (
      await db.pool.query(
        "SELECT id,customer_id FROM card_customer_link WHERE card_id=$1",
        [fixtureId(29)],
      )
    ).rows[0];
    const context = (
      await db.pool.query(
        "SELECT offline_expires_at FROM capture_context WHERE id=$1",
        [x.f.contextId],
      )
    ).rows[0];
    const claims = {
      version: 1,
      purpose: "capture_lookup",
      cardCode: "A7K3M9Q",
      captureContextId: x.f.contextId,
      originatingAccountId: x.f.attendantId,
      stationId: x.f.stationId,
      cardId: fixtureId(29),
      customerId: link.customer_id,
      cardCustomerLinkId: link.id,
      issuedAt: "2026-11-10T12:05:00.000Z",
      expiresAt: context.offline_expires_at.toISOString(),
    };
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET lookup_receipt_status='valid',lookup_receipt_claims=$2,capture_lower_bound=$3,capture_policy_version='lookup-v1' WHERE id=$1",
      [x.sale.purchaseId, claims, claims.issuedAt],
    );
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    expect(
      (
        await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedProposalVersion: 1,
          outcome: "approve",
        })
      ).proposal.state,
    ).toBe("approved");
  });
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-08 %s approval reason stays out of ordinary sales detail and history",
    async (kind) => {
      const x = await fixture(kind),
        canary = "Private sheet witness narrative CANARY";
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      const result = await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposal.id,
        {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedProposalVersion: 1,
          outcome: "approve",
          reason: canary,
        },
      );
      expect(JSON.stringify(result)).toContain(canary);
      const { readSales } =
        await import("../../src/server/modules/sales/service");
      const { adminConfig } =
        await import("../../src/server/modules/admin-access/config");
      for (const [action, input] of [
        ["detail", {}],
        ["history", { kind: "decisions" }],
        ["history", { kind: "revisions" }],
      ] as const) {
        const read = await readSales(
          db.pool,
          adminConfig(),
          x.token,
          "admin",
          action,
          input,
          x.sale.purchaseId,
        );
        expect(JSON.stringify(read)).not.toContain(canary);
      }
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-08 %s cancellation reason stays out of ordinary sales detail and history",
    async (kind) => {
      const x = await fixture(kind),
        canary = "Private sheet witness narrative CANARY";
      const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        outcome: "cancel",
        facts: { ...x.facts, finding: "entry_marked_void" },
      });
      const result = await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposal.id,
        {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedProposalVersion: 1,
          outcome: "approve",
          reason: canary,
        },
      );
      expect(JSON.stringify(result)).toContain(canary);
      const { readSales } =
        await import("../../src/server/modules/sales/service");
      const { adminConfig } =
        await import("../../src/server/modules/admin-access/config");
      for (const [action, input] of [
        ["detail", {}],
        ["history", { kind: "decisions" }],
        ["history", { kind: "revisions" }],
      ] as const) {
        const read = await readSales(
          db.pool,
          adminConfig(),
          x.token,
          "admin",
          action,
          input,
          x.sale.purchaseId,
        );
        expect(JSON.stringify(read)).not.toContain(canary);
      }
    },
  );
  it("SR-01 superseded campaign deadline does not invalidate a later applicable capture interval", async () => {
    const x = await fixture();
    const settings = (
      await db.pool.query(
        "SELECT id FROM settings_version WHERE station_id=$1 ORDER BY version",
        [x.f.stationId],
      )
    ).rows[0].id;
    const newer = newId();
    await db.pool.query(
      "INSERT INTO settings_version SELECT (jsonb_populate_record(NULL::settings_version,to_jsonb(s)||jsonb_build_object('id',$2::text,'version',2,'timing_history_version',2,'effective_from','2026-11-10T11:00:00Z'))).* FROM settings_version s WHERE id=$1",
      [settings, newer],
    );
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET purchase_cutoff='2026-11-09T12:00:00Z',upload_deadline='2026-11-09T13:00:00Z' WHERE id=$1",
      [settings],
    );
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    expect(proposal.state).toBe("pending");
  });
  it.each(["assignment_end", "context_revocation"])(
    "SR-08 capture %s structural denial retains the exact boundary source",
    async (boundary) => {
      const x = await fixture("capture");
      if (boundary === "context_revocation") {
        await seedHistorical(
          db.pool,
          "assignment",
          "UPDATE assignment SET effective_until=NULL WHERE id=$1",
          [x.f.assignmentId],
        );
        await seedHistorical(
          db.pool,
          "capture_context",
          "UPDATE capture_context SET revoked_at='2026-11-10T12:30:00Z' WHERE id=$1",
          [x.f.contextId],
        );
      }
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      const provenance = (
        await db.pool.query(
          "SELECT provenance FROM held_release_proposal WHERE id=$1",
          [proposal.id],
        )
      ).rows[0].provenance;
      const sourceId =
        boundary === "assignment_end" ? x.f.assignmentId : x.f.contextId;
      const source = provenance.evaluation.sources.find(
        (s: { id: string }) => s.id === sourceId,
      );
      const atMicros = String(
        BigInt(Date.parse("2026-11-10T12:30:00Z")) * 1000n,
      );
      expect(provenance.evaluation.boundaries).toContainEqual({
        kind:
          boundary === "assignment_end"
            ? "assignment_ended"
            : "context_revoked",
        sourceId,
        sourceVersion: source.version,
        atMicros,
        changeAtMicros: atMicros,
      });
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-01 %s v1-sufficient target refuses the exception route",
    async (kind) => {
      const x = await fixture(kind);
      const from =
        kind === "card"
          ? "2026-11-10T12:40:00.000Z"
          : x.facts.observedCapture.from;
      const through =
        kind === "card"
          ? "2026-11-10T13:00:00.000Z"
          : x.facts.observedCapture.through;
      if (kind === "card")
        x.body.facts.observedCapture = {
          ...x.body.facts.observedCapture,
          from: "2026-11-10T12:45:00.000Z",
          through: "2026-11-10T12:50:00.000Z",
        };
      await seedHistorical(
        db.pool,
        "capture_context",
        "UPDATE capture_context SET signed_in_at=$2,offline_expires_at=$2::timestamptz+interval '24 hours' WHERE id=$1",
        [x.f.contextId, from],
      );
      await seedHistorical(
        db.pool,
        "purchase",
        "UPDATE purchase SET capture_lower_bound=$2,server_received_at=$3 WHERE id=$1",
        [x.sale.purchaseId, from, through],
      );
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, x.body),
      ).rejects.toMatchObject({ code: "release_not_required", status: 409 });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-01 %s missing customer or incomplete settings never becomes paper admission",
    async (kind) => {
      for (const defect of ["customer", "settings"]) {
        const x = await fixture(kind);
        if (defect === "customer")
          await seedHistorical(
            db.pool,
            "purchase",
            "UPDATE purchase SET customer_id=NULL WHERE id=$1",
            [x.sale.purchaseId],
          );
        else
          await seedHistorical(
            db.pool,
            "settings_version",
            "UPDATE settings_version SET purchase_cutoff=NULL,upload_deadline=NULL WHERE station_id=$1",
            [x.f.stationId],
          );
        await expect(
          x.svc.propose(x.token, x.sale.purchaseId, x.body),
        ).rejects.toMatchObject({ code: "evidence_insufficient" });
        expect(
          (
            await db.pool.query(
              "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
              [x.sale.purchaseId],
            )
          ).rows[0].n,
        ).toBe(0);
      }
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-04 %s missing original meter or sheet bytes cannot approve paper evidence",
    async (kind) => {
      for (const asset of ["meter", "sheet"]) {
        const x = await fixture(kind);
        const key =
          asset === "sheet"
            ? `final/${x.body.sheetAssetId}`
            : (
                await db.pool.query(
                  "SELECT final_key FROM photo_asset WHERE id=$1",
                  [x.sale.assetId],
                )
              ).rows[0].final_key;
        x.h.objects.delete(key);
        await expect(
          x.svc.propose(x.token, x.sale.purchaseId, x.body),
        ).rejects.toThrow();
        expect(
          (
            await db.pool.query(
              "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
              [x.sale.purchaseId],
            )
          ).rows[0].n,
        ).toBe(0);
      }
    },
  );
  it("SR-01 a uniformly wrong captured rate cannot be rescued by paper attestation", async () => {
    const x = await fixture("price");
    await seedHistorical(
      db.pool,
      "capture_context",
      "UPDATE capture_context SET signed_in_at='2026-11-10T12:40:00Z',offline_expires_at='2026-11-11T12:40:00Z' WHERE id=$1",
      [x.f.contextId],
    );
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET capture_lower_bound='2026-11-10T12:40:00Z' WHERE id=$1",
      [x.sale.purchaseId],
    );
    const facts = {
      ...x.facts,
      observedCapture: {
        ...x.facts.observedCapture,
        from: "2026-11-10T12:45:00.000Z",
        through: "2026-11-10T12:50:00.000Z",
      },
    };
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, { ...x.body, facts }),
    ).rejects.toMatchObject({ code: "release_not_required" });
  });
  it.each(["card", "price", "capture"] as const)(
    "SR-02 %s paper interval touching the material upper boundary remains ambiguous",
    async (kind) => {
      const x = await fixture(kind);
      const facts = {
        ...x.facts,
        observedCapture: {
          ...x.facts.observedCapture,
          through: "2026-11-10T12:30:00.000Z",
        },
      };
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, { ...x.body, facts }),
      ).rejects.toMatchObject({ code: "evidence_insufficient" });
    },
  );
  it("SR-02 date paper range spanning Lagos midnight remains ambiguous", async () => {
    const x = await fixture("date");
    const facts = {
      ...x.facts,
      observedCapture: {
        ...x.facts.observedCapture,
        from: "2026-11-10T22:59:59.999Z",
        through: "2026-11-10T23:00:00.000Z",
      },
    };
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, { ...x.body, facts }),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
  it("SR-08 protected proposal pagination is bounded, ordered and cursor-scoped", async () => {
    const x = await fixture();
    const ids: string[] = [];
    for (let n = 0; n < 3; n++) {
      const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        ...(await x.h.guard(x.sale.purchaseId)),
      });
      ids.push(proposal.id);
      await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "reject",
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await x.svc.list(x.reviewerToken, x.sale.purchaseId, {
        limit: 1,
        cursor,
      });
      expect(page.items).toHaveLength(1);
      seen.push(page.items[0]!.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(ids.reverse());
    await expect(
      x.svc.list(x.reviewerToken, x.sale.purchaseId, { limit: 101 }),
    ).rejects.toThrow();
    await expect(
      x.svc.list(x.reviewerToken, x.sale.purchaseId, {
        limit: 1,
        cursor: "tampered",
      }),
    ).rejects.toThrow();
  });
  it("SR-03 sales-only and audit-only authority cannot read paper proposals or images", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const grants = (
      await db.pool.query(
        "SELECT permission_code FROM role_permission WHERE role_id=$1",
        [fixtureId(1)],
      )
    ).rows.map((r) => r.permission_code);
    try {
      for (const only of ["sales", "audit"]) {
        await db.pool.query("DELETE FROM role_permission WHERE role_id=$1", [
          fixtureId(1),
        ]);
        await db.pool.query(
          "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
          [fixtureId(1), only],
        );
        await expect(
          x.svc.get(x.reviewerToken, x.sale.purchaseId, proposal.id),
        ).rejects.toMatchObject({ code: "permission_denied" });
        await expect(
          x.svc.photoAccess(x.reviewerToken, x.sale.purchaseId, proposal.id, {
            assetId: x.body.sheetAssetId,
          }),
        ).rejects.toMatchObject({ code: "permission_denied" });
      }
    } finally {
      await db.pool.query("DELETE FROM role_permission WHERE role_id=$1", [
        fixtureId(1),
      ]);
      for (const grant of grants)
        await db.pool.query(
          "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
          [fixtureId(1), grant],
        );
    }
  });
  it("SR-03 first-password sessions and unrelated resource IDs cannot expose paper evidence", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    await expect(
      x.svc.get(x.reviewerToken, x.sale.purchaseId, newId()),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      x.svc.get(x.reviewerToken, newId(), proposal.id),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await db.pool.query(
      "UPDATE auth_user SET must_change_password=true WHERE id=$1",
      [x.actors[1]],
    );
    await expect(
      x.svc.get(x.reviewerToken, x.sale.purchaseId, proposal.id),
    ).rejects.toMatchObject({ code: "password_change_required" });
  });
  it("SR-05 changed sheet, outcome and guards cannot reuse a successful proposal operation", async () => {
    const x = await fixture();
    await x.svc.propose(x.token, x.sale.purchaseId, x.body);
    for (const patch of [
      { sheetAssetId: newId() },
      { meterAssetId: newId() },
      { expectedVersion: x.body.expectedVersion + 1 },
      { expectedRevisionId: newId() },
      {
        outcome: "cancel",
        facts: { ...x.facts, finding: "entry_marked_void" },
      },
    ])
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, { ...x.body, ...patch }),
      ).rejects.toMatchObject({ code: "operation_conflict" });
  });
  it.each([
    "unknown_release",
    "bad_digest",
    "wrong_station",
    "wrong_environment",
    "stale_revision",
    "inactive",
  ])(
    "SR-07 %s configuration cannot admit a release proposal",
    async (defect) => {
      const x = await fixture();
      const config = structuredClone(x.policy);
      if (defect === "unknown_release") config.release = "review-evidence-v99";
      if (defect === "bad_digest") config.digest = "0".repeat(64);
      if (defect === "wrong_station") config.scope.stationId = newId();
      if (defect === "wrong_environment")
        config.scope.environment = "production";
      if (defect === "stale_revision") config.revision = 1;
      const policy =
        defect === "inactive"
          ? {
              ...config,
              activation: {
                state: "inactive",
                approvalReference: null,
                activatedAt: null,
              },
            }
          : config;
      const svc = createHeldReleaseService({
        pool: db.pool,
        storage: x.h.storage,
        env: {
          ...process.env,
          WHR_ENV: "test",
          WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
        },
      });
      await expect(
        svc.propose(x.token, x.sale.purchaseId, x.body),
      ).rejects.toMatchObject({
        code: "release_policy_unconfigured",
        status: 409,
      });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it("SR-08 audit failure rolls back approval, receipt, contribution and transition together", async () => {
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
    const before = (
      await db.pool.query(
        "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    await db.pool.query(
      "CREATE FUNCTION test_reject_release_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='held_release_approved' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_release_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION test_reject_release_audit()",
    );
    try {
      await expect(
        x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, decision),
      ).rejects.toThrow("fictional audit failure");
    } finally {
      await db.pool.query(
        "DROP TRIGGER test_reject_release_audit ON audit_event; DROP FUNCTION test_reject_release_audit()",
      );
    }
    expect(
      (
        await db.pool.query(
          "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
          [x.sale.purchaseId],
        )
      ).rows,
    ).toEqual(before);
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
          "SELECT count(*)::int n FROM held_release_receipt WHERE operation_id=$1",
          [decision.operationId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await x.svc.decide(
          x.reviewerToken,
          x.sale.purchaseId,
          proposal.id,
          decision,
        )
      ).proposal.state,
    ).toBe("approved");
  });
  it("SR-06 missing sheet evidence permits rejection and retains immutable source history", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    x.h.objects.delete(`final/${x.body.sheetAssetId}`);
    const decision = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "reject",
    };
    expect(
      (
        await x.svc.decide(
          x.reviewerToken,
          x.sale.purchaseId,
          proposal.id,
          decision,
        )
      ).proposal.state,
    ).toBe("rejected");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM held_release_sheet_validation WHERE asset_id=$1",
          [x.body.sheetAssetId],
        )
      ).rows[0].n,
    ).toBe(1);
    const transition = (
      await db.pool.query(
        "SELECT content FROM held_release_transition WHERE proposal_id=$1 AND state='rejected'",
        [proposal.id],
      )
    ).rows[0].content;
    expect(transition.guard).toEqual({
      expectedVersion: decision.expectedVersion,
      expectedRevisionId: decision.expectedRevisionId,
      expectedProposalVersion: 1,
    });
    expect(transition.appliedProposalVersion).toBe(2);
    expect(transition.appliedPurchaseVersion).toBe(
      decision.expectedVersion + 1,
    );
  });
  it("SR-06 ordinary target closure supersedes pending proposal with linked audit and retained photos", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    await seedHistorical(
      db.pool,
      "capture_context",
      "UPDATE capture_context SET signed_in_at='2026-11-10T12:40:00Z',offline_expires_at='2026-11-11T12:40:00Z' WHERE id=$1",
      [x.f.contextId],
    );
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET capture_lower_bound='2026-11-10T12:40:00Z' WHERE id=$1",
      [x.sale.purchaseId],
    );
    const { createReviewsService } =
      await import("../../src/server/modules/reviews/service");
    const ordinary = createReviewsService({
      pool: db.pool,
      storage: x.h.storage,
      env: {
        ...process.env,
        WHR_ENV: "test",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
      },
    });
    const result = await ordinary.decideCard(
      x.reviewerToken,
      x.sale.purchaseId,
      x.holdId,
      {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedHoldVersion: 1,
        outcome: "cancel",
        evidence: x.evidence,
      },
    );
    expect(
      (await x.svc.get(x.token, x.sale.purchaseId, proposal.id)).state,
    ).toBe("superseded");
    const transition = (
      await db.pool.query(
        "SELECT content FROM held_release_transition WHERE proposal_id=$1 AND state='superseded'",
        [proposal.id],
      )
    ).rows[0].content;
    expect(transition.closingAuditEventId).toBe(result.auditEventId);
    expect(x.h.objects.has(`final/${x.body.sheetAssetId}`)).toBe(true);
  });
  it("SR-02 capture outside-campaign attestation retains an outside-membership conclusion", async () => {
    const x = await fixture("capture");
    await seedHistorical(
      db.pool,
      "assignment",
      "UPDATE assignment SET effective_until=NULL WHERE id=$1",
      [x.f.assignmentId],
    );
    await seedHistorical(
      db.pool,
      "purchase_validation_block",
      "UPDATE purchase_validation_block SET code='capture_time_unresolved' WHERE id=$1",
      [x.holdId],
    );
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET purchase_start='2026-11-10T12:30:00Z' WHERE station_id=$1",
      [x.f.stationId],
    );
    const target = {
      kind: "capture",
      blocks: [{ id: x.holdId, version: 1, code: "capture_time_unresolved" }],
    };
    await seedHistorical(
      db.pool,
      "held_release_sheet",
      "UPDATE held_release_sheet SET target=$2 WHERE id=$1",
      [x.body.sheetAssetId, target],
    );
    const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
      ...x.body,
      target,
    });
    await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "approve",
    });
    expect(
      (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE purchase_id=$1 ORDER BY created_at DESC LIMIT 1",
          [x.sale.purchaseId],
        )
      ).rows[0].provenance.conclusions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: "campaign_membership_uniform",
          inside: false,
        }),
      ]),
    );
    const settings = (
      await db.pool.query(
        `SELECT campaign_id id,id settings_id,
          (extract(epoch FROM purchase_start)*1000000)::bigint::text start,
          (extract(epoch FROM purchase_cutoff)*1000000)::bigint::text cutoff,
          (extract(epoch FROM upload_deadline)*1000000)::bigint::text deadline
         FROM settings_version WHERE station_id=$1 ORDER BY version DESC LIMIT 1`,
        [x.f.stationId],
      )
    ).rows[0];
    const client = await db.pool.connect();
    try {
      const row = (
        await contributions(client, x.f.stationId, {
          ...settings,
          launch: (BigInt(Date.parse(S)) * 1000n).toString(),
          settingsVersionId: settings.settings_id,
        })
      ).find((s) => s.purchaseId === x.sale.purchaseId)!;
      expect(row.included).toBe(false);
      expect(row.reasons).toContain("outside_period");
      expect(row.reasons).not.toContain("timing_unresolved");
    } finally {
      client.release();
    }
    expect(
      (
        await db.pool.query(
          "SELECT closure_kind FROM purchase_validation_block WHERE id=$1",
          [x.holdId],
        )
      ).rows[0].closure_kind,
    ).toBe("confirmed");
  });
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-08 %s approval preserves original evidence and exact protected people provenance",
    async (kind) => {
      const x = await fixture(kind);
      const original = (
        await db.pool.query(
          "SELECT to_jsonb(p) - 'status' - 'version' - 'current_revision_id' - 'updated_at' - 'verified_sale_date' original FROM purchase p WHERE id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].original;
      const retainedObjects = new Map(
        [...x.h.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]),
      );
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      const decision = {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
        reason: "Protected second person explanation",
      };
      await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposal.id,
        decision,
      );
      const evaluation = (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].provenance;
      const committed = (
        await db.pool.query(
          "SELECT id,purchase_id,applied_purchase_version,result_revision_id,evidence_asset_id FROM sale_decision WHERE purchase_id=$1 AND kind='held_release'",
          [x.sale.purchaseId],
        )
      ).rows[0];
      expect(evaluation.target).toMatchObject({
        ...x.target,
        purchaseId: committed.purchase_id,
        decisionId: committed.id,
      });
      expect(evaluation.result).toMatchObject({
        closure: "confirmed",
        appliedPurchaseVersion: committed.applied_purchase_version,
        resultingRevisionId: committed.result_revision_id,
        evidenceAssetId: committed.evidence_asset_id,
      });
      expect(evaluation.people.proposer).toMatchObject({
        person: { personId: x.people[0], version: 1 },
        reason: x.body.reason,
      });
      expect(evaluation.people.approver).toMatchObject({
        person: { personId: x.people[1], version: 1 },
        reason: decision.reason,
      });
      expect(evaluation.people.proposer.actor).not.toEqual(
        evaluation.people.approver.actor,
      );
      expect(Number.isFinite(Date.parse(evaluation.people.proposer.at))).toBe(
        true,
      );
      expect(Number.isFinite(Date.parse(evaluation.people.approver.at))).toBe(
        true,
      );
      expect(evaluation.evidence).toEqual({
        meterAssetId: x.body.meterAssetId,
        sheetAssetId: x.body.sheetAssetId,
      });
      expect(evaluation.policy).toMatchObject({
        release: x.policy.release,
        digest: x.policy.digest,
        revision: 2,
      });
      const after = (
        await db.pool.query(
          "SELECT to_jsonb(p) - 'status' - 'version' - 'current_revision_id' - 'updated_at' - 'verified_sale_date' original FROM purchase p WHERE id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].original;
      expect(after).toEqual(original);
      expect(x.h.objects).toEqual(retainedObjects);
    },
  );
  it.each(["sourceIds", "predicates", "interval"] as const)(
    "SR-02a corrupted retained %s removes SQL contribution and denies later consistency checks",
    async (field) => {
      const x = await fixture();
      const { proposal } = await x.svc.propose(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      await x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposal.id, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      });
      const { assertAppliedReleaseConsistency } =
        await import("../../src/server/modules/reviews/release-integrations");
      const { acceptedContribution } =
        await import("../../src/server/modules/reports/contribution");
      const client = await db.pool.connect();
      try {
        await expect(
          assertAppliedReleaseConsistency(client, x.sale.purchaseId),
        ).resolves.toBeUndefined();
        expect(
          (
            await client.query("SELECT held_release_consistent($1) valid", [
              x.sale.purchaseId,
            ])
          ).rows[0].valid,
        ).toBe(true);
        const contribution = async () =>
          (
            await client.query(
              `SELECT (${acceptedContribution}) valid FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1`,
              [x.sale.purchaseId],
            )
          ).rows[0].valid;
        expect(await contribution()).toBe(true);
        const path = field === "interval" ? "fromMicros" : field;
        const value = field === "interval" ? '"0"' : "[]";
        await seedHistorical(
          db.pool,
          "held_release_transition",
          "UPDATE held_release_transition SET content=jsonb_set(content,ARRAY['attestation',$2],$3::jsonb) WHERE proposal_id=$1 AND state='approved'",
          [proposal.id, path, value],
        );
        await expect(
          assertAppliedReleaseConsistency(client, x.sale.purchaseId),
        ).rejects.toMatchObject({ code: "evidence_insufficient" });
        expect(
          (
            await client.query("SELECT held_release_consistent($1) valid", [
              x.sale.purchaseId,
            ])
          ).rows[0].valid,
        ).toBe(false);
        expect(await contribution()).toBe(false);
      } finally {
        client.release();
      }
    },
  );
  it.each(["referenceIds", "appCapturedAt", "sourceIds"])(
    "SR-01 caller %s cannot narrow server source closure or rescue phone time",
    async (field) => {
      const x = await fixture();
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, {
          ...x.body,
          [field]:
            field === "appCapturedAt"
              ? "2026-11-10T12:10:00Z"
              : [x.sale.purchaseId],
        }),
      ).rejects.toMatchObject({ name: "ZodError" });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal",
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-02 %s disjoint paper interval and mismatched entry cannot produce an attestation",
    async (kind) => {
      const x = await fixture(kind);
      for (const facts of [
        {
          ...x.facts,
          observedCapture: {
            ...x.facts.observedCapture,
            from: "2026-11-09T09:00:00Z",
            through: "2026-11-09T10:00:00Z",
          },
        },
        { ...x.facts, pumpId: newId() },
        { ...x.facts, recordedAmountKobo: "1", recordedQuantity: null },
      ]) {
        await expect(
          x.svc.propose(x.token, x.sale.purchaseId, {
            ...x.body,
            operationId: newId(),
            facts,
          }),
        ).rejects.toMatchObject({ code: "evidence_insufficient" });
      }
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal",
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it("SR-03 proposer binding revision makes approval stale even when canonical person is unchanged", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    await db.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,true)",
      [newId(), x.f.stationId, x.actors[0], x.people[0]],
    );
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
  it("SR-03 proposer demotion prevents approval but independent rejection remains available", async () => {
    const x = await fixture();
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const role = newId();
    await db.pool.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,'Fictional demoted role',false,true,1)",
      [role],
    );
    await db.pool.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'sales')",
      [role],
    );
    await db.pool.query(
      "UPDATE admin SET role_id=$2,version=version+1 WHERE user_id=$1",
      [x.actors[0], role],
    );
    try {
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
    } finally {
      await db.pool.query(
        "UPDATE admin SET role_id=$2,version=version+1 WHERE user_id=$1",
        [x.actors[0], fixtureId(1)],
      );
    }
  });
  it.each(["purchase_start", "purchase_cutoff"] as const)(
    "SR-02 campaign %s exact endpoint preserves inclusive membership and source boundary",
    async (field) => {
      const x = await fixture("capture");
      await seedHistorical(
        db.pool,
        "assignment",
        "UPDATE assignment SET effective_until=NULL WHERE id=$1",
        [x.f.assignmentId],
      );
      await seedHistorical(
        db.pool,
        "purchase_validation_block",
        "UPDATE purchase_validation_block SET code='capture_time_unresolved' WHERE id=$1",
        [x.holdId],
      );
      await seedHistorical(
        db.pool,
        "settings_version",
        `UPDATE settings_version SET ${field}='2026-11-10T12:30:00Z' WHERE station_id=$1`,
        [x.f.stationId],
      );
      const target = {
        kind: "capture",
        blocks: [{ id: x.holdId, version: 1, code: "capture_time_unresolved" }],
      };
      await seedHistorical(
        db.pool,
        "held_release_sheet",
        "UPDATE held_release_sheet SET target=$2 WHERE id=$1",
        [x.body.sheetAssetId, target],
      );
      const facts = {
        ...x.facts,
        observedCapture: {
          ...x.facts.observedCapture,
          from:
            field === "purchase_start"
              ? "2026-11-10T12:30:00Z"
              : "2026-11-10T12:20:00Z",
          through:
            field === "purchase_start"
              ? "2026-11-10T12:40:00Z"
              : "2026-11-10T12:30:00Z",
        },
      };
      const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        target,
        facts,
      });
      const e = (
        await db.pool.query(
          "SELECT provenance->'evaluation' e FROM held_release_proposal WHERE id=$1",
          [proposal.id],
        )
      ).rows[0].e;
      const settings = (
        await db.pool.query(
          "SELECT id FROM settings_version WHERE station_id=$1 ORDER BY version DESC",
          [x.f.stationId],
        )
      ).rows[0].id;
      const source = e.sources.find((s: { id: string }) => s.id === settings);
      const at = BigInt(Date.parse("2026-11-10T12:30:00Z")) * 1000n;
      expect(e.boundaries).toContainEqual({
        kind:
          field === "purchase_start" ? "campaign_started" : "campaign_cutoff",
        sourceId: settings,
        sourceVersion: source.version,
        atMicros: String(at),
        changeAtMicros: String(field === "purchase_start" ? at : at + 1n),
      });
      expect(e.conclusions).toContainEqual(
        expect.objectContaining({
          tag: "campaign_membership_uniform",
          inside: true,
        }),
      );
    },
  );
  it("SR-02 whole-day paper precision cannot select one side of an unresolved midnight", async () => {
    const x = await fixture("date");
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        facts: {
          ...x.facts,
          observedCapture: {
            ...x.facts.observedCapture,
            from: "2026-11-10T22:30:00Z",
            through: "2026-11-10T23:30:00Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
  });
  it("SR-02 selected card target cannot clear sibling timing or P-19 authorship blocks", async () => {
    const x = await fixture("card");
    const blocks = [newId(), newId()];
    for (const [index, code] of [
      "capture_time_unresolved",
      "correction_authorship_unverified",
    ].entries())
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,'Fictional invariant fixture',clock_timestamp(),1)",
        [blocks[index], x.sale.purchaseId, code],
      );
    await expect(
      x.svc.propose(x.token, x.sale.purchaseId, x.body),
    ).rejects.toMatchObject({ code: "evidence_insufficient" });
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM held_release_proposal"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(2);
    await seedHistorical(
      db.pool,
      "purchase_validation_block",
      "DELETE FROM purchase_validation_block WHERE id=$1",
      [blocks[1]],
    );
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const result = await x.svc.decide(
      x.reviewerToken,
      x.sale.purchaseId,
      proposal.id,
      {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedProposalVersion: 1,
        outcome: "approve",
      },
    );
    expect(result.decision.result).toMatchObject({ creditedAfter: false });
    expect(
      (
        await db.pool.query(
          "SELECT id FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL ORDER BY id",
          [x.sale.purchaseId],
        )
      ).rows.map((r) => r.id),
    ).toEqual([blocks[0]]);
  });
  it.each(["sale_absent", "uncertain"])(
    "SR-02 %s paper finding never supplies cancellation authority",
    async (finding) => {
      const x = await fixture();
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, {
          ...x.body,
          outcome: "cancel",
          facts: { ...x.facts, finding },
        }),
      ).rejects.toMatchObject({ name: "ZodError" });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal",
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it.each(["card", "price", "date", "capture"] as const)(
    "SR-01 %s missing historical price audit cannot be rescued by paper",
    async (kind) => {
      const x = await fixture(kind);
      await seedHistorical(
        db.pool,
        "audit_event",
        "DELETE FROM audit_event WHERE action='price_activated'",
      );
      await expect(
        x.svc.propose(x.token, x.sale.purchaseId, x.body),
      ).rejects.toMatchObject({ code: "evidence_insufficient" });
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM held_release_proposal",
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
});
