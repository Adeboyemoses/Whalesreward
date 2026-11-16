import { assertReleaseV2Installation } from "../../src/server/modules/reviews/release-v2";
import {
  pinReleaseV2Policy,
  reviewEvidenceApprovalValid,
  reviewEvidenceReleaseDigest,
  type ReviewEvidenceConfiguration,
} from "../../src/server/modules/reviews/config";
import { pinMeterPolicy } from "../../src/server/modules/reviews/meter-config";
import { meterFixture } from "../helpers/meter-fixture";
import { transaction } from "../../src/server/modules/sync/repo";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { createHeldReleaseService } from "../../src/server/modules/reviews/release-service";
import { reviewEvidenceV2ReleaseArtifact } from "../../src/server/modules/reviews/release-v2";
import { evidenceDatabase, S } from "../helpers/review-evidence-fixture";
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
    env,
  };
}

beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  vi.mocked(assertReleaseV2Installation).mockResolvedValue(undefined);
});

async function append(
  stationId: string,
  revision: number,
  release: "review-evidence-v1" | "review-evidence-v2" = "review-evidence-v2",
  active = true,
  at = S,
) {
  const policy: ReviewEvidenceConfiguration = {
    release,
    digest:
      release === "review-evidence-v1"
        ? reviewEvidenceReleaseDigest
        : createHash("sha256")
            .update(reviewEvidenceV2ReleaseArtifact)
            .digest("hex"),
    revision,
    scope: { stationId, environment: "test" },
    activation: active
      ? { state: "active", approvalReference: newId(), activatedAt: at }
      : { state: "inactive", approvalReference: null, activatedAt: null },
  };
  if (policy.activation.state === "active")
    await db.pool.query(
      "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,$4,$5,'test',$6,'Fictional policy matrix approval')",
      [
        policy.activation.approvalReference,
        release,
        policy.digest,
        revision,
        stationId,
        at,
      ],
    );
  await db.pool.query(
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',$3,$4,'Fictional policy matrix config')",
    [newId(), stationId, revision, policy],
  );
  return policy;
}
function env(policy: unknown) {
  return {
    WHR_ENV: "test",
    WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
  };
}
async function protectedState(purchaseId: string) {
  return (
    await db.pool.query(
      `SELECT to_jsonb(p) AS purchase,
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM purchase_hold h WHERE h.purchase_id=p.id) AS holds,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.proposal_id) FROM held_release_state s WHERE s.purchase_id=p.id) AS proposals,
 (SELECT count(*)::int FROM sale_decision d WHERE d.purchase_id=p.id) AS decisions FROM purchase p WHERE id=$1`,
      [purchaseId],
    )
  ).rows;
}
it("SR-07 future approved v2 activation remains unconfigured without reevaluating held sales", async () => {
  const x = await fixture(),
    before = await protectedState(x.sale.purchaseId);
  const future = await append(
    x.f.stationId,
    3,
    "review-evidence-v2",
    true,
    "2099-01-01T00:00:00Z",
  );
  expect(await reviewEvidenceApprovalValid(db.pool, future)).toBe(false);
  await expect(
    transaction(db.pool, (c) =>
      pinReleaseV2Policy(c, x.f.stationId, env(future)),
    ),
  ).rejects.toMatchObject({ code: "release_policy_unconfigured" });
  expect(await protectedState(x.sale.purchaseId)).toEqual(before);
});
it.each(["absent", "different-approval", "different-instant"])(
  "SR-07 %s approval reference cannot satisfy the exact v2 persisted pin",
  async (kind) => {
    const x = await fixture(),
      policy = structuredClone(x.policy);
    if (kind === "absent") policy.activation.approvalReference = newId();
    if (kind === "different-approval")
      policy.activation.approvalReference =
        x.config.activation.approvalReference!;
    if (kind === "different-instant")
      policy.activation.activatedAt = "2026-11-09T00:00:00Z";
    const before = await protectedState(x.sale.purchaseId);
    await expect(
      transaction(db.pool, (c) =>
        pinReleaseV2Policy(c, x.f.stationId, env(policy)),
      ),
    ).rejects.toMatchObject({ code: "release_policy_unconfigured" });
    expect(await protectedState(x.sale.purchaseId)).toEqual(before);
  },
);
it("SR-07 mixed installed release fails closed even with a matching persisted v2 approval", async () => {
  const x = await fixture();
  vi.mocked(assertReleaseV2Installation).mockRejectedValueOnce(
    new Error("mixed installed package"),
  );
  await expect(
    transaction(db.pool, (c) => pinReleaseV2Policy(c, x.f.stationId, x.env)),
  ).rejects.toMatchObject({ code: "release_policy_unconfigured" });
});
it("SR-07 valid v1 meter package becomes unconfigured with v2 dependency without relabeling provenance", async () => {
  const x = await meterFixture(db);
  const before = (
    await db.pool.query(
      "SELECT to_jsonb(m) AS value FROM meter_configuration m ORDER BY revision",
    )
  ).rows;
  await transaction(db.pool, (c) => pinMeterPolicy(c, x.f.stationId, x.env));
  const v2 = await append(x.f.stationId, 2);
  await expect(
    transaction(db.pool, (c) =>
      pinMeterPolicy(c, x.f.stationId, { ...x.env, ...env(v2) }),
    ),
  ).rejects.toMatchObject({ code: "meter_policy_unconfigured" });
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(m) AS value FROM meter_configuration m ORDER BY revision",
      )
    ).rows,
  ).toEqual(before);
});
it("SR-07 deactivation serializes behind a pinned decision transaction and then denies the old pin", async () => {
  const x = await fixture(),
    client = await db.pool.connect(),
    other = await db.pool.connect();
  const inactive = {
    ...x.policy,
    revision: 3,
    activation: {
      state: "inactive",
      approvalReference: null,
      activatedAt: null,
    },
  };
  try {
    await client.query("BEGIN");
    await pinReleaseV2Policy(client, x.f.stationId, x.env);
    await other.query("BEGIN");
    await other.query("SET LOCAL lock_timeout='100ms'");
    await expect(
      other.query(
        "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',3,$3,'Fictional deactivation')",
        [newId(), x.f.stationId, inactive],
      ),
    ).rejects.toMatchObject({ code: "55P03" });
    await other.query("ROLLBACK");
    await client.query("COMMIT");
    await append(x.f.stationId, 3, "review-evidence-v2", false);
    await expect(
      transaction(db.pool, (c) => pinReleaseV2Policy(c, x.f.stationId, x.env)),
    ).rejects.toMatchObject({ code: "release_policy_unconfigured" });
  } finally {
    await client.query("ROLLBACK");
    await other.query("ROLLBACK");
    client.release();
    other.release();
  }
});
it.each(["review-evidence-v1", "review-evidence-v2"] as const)(
  "SR-07 historical approval receipt after %s switch preserves original result and checks live reviewer",
  async (release) => {
    const x = await fixture(),
      proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
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
    const before = await protectedState(x.sale.purchaseId),
      next = await append(x.f.stationId, 3, release);
    x.env.WHR_REVIEW_EVIDENCE_POLICY = JSON.stringify(next);
    expect(
      await x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposed.proposal.id,
        decision,
      ),
    ).toEqual(result);
    expect(await protectedState(x.sale.purchaseId)).toEqual(before);
    await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      x.actors[1],
    ]);
    await expect(
      x.svc.decide(
        x.reviewerToken,
        x.sale.purchaseId,
        proposed.proposal.id,
        decision,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  },
);
it("SR-07 approval/configuration upgrade and deactivation never auto-release pending proposals or holds", async () => {
  const x = await fixture();
  await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  const before = await protectedState(x.sale.purchaseId);
  await append(x.f.stationId, 3);
  await append(x.f.stationId, 4, "review-evidence-v2", false);
  await append(x.f.stationId, 5, "review-evidence-v1");
  expect(await protectedState(x.sale.purchaseId)).toEqual(before);
});

it("SR-07 deactivation during approval photo inspection prevents commit and preserves pending zero credit", async () => {
  const x = await fixture(),
    proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  const before = await protectedState(x.sale.purchaseId),
    decision = {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "approve",
    };
  let reached!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => {
      reached = resolve;
    }),
    released = new Promise<void>((resolve) => {
      resume = resolve;
    });
  const read = x.h.storage.read;
  let first = true;
  x.h.storage.read = async (...args) => {
    if (first) {
      first = false;
      reached();
      await released;
    }
    return read(...args);
  };
  const approving = x.svc.decide(
    x.reviewerToken,
    x.sale.purchaseId,
    proposed.proposal.id,
    decision,
  );
  try {
    await entered;
    await append(x.f.stationId, 3, "review-evidence-v2", false);
  } finally {
    resume();
  }
  await expect(approving).rejects.toMatchObject({
    code: "release_policy_unconfigured",
  });
  expect(await protectedState(x.sale.purchaseId)).toEqual(before);
});
