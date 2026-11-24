import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { createHeldReleaseService } from "../../src/server/modules/reviews/release-service";
import { reviewEvidenceV2ReleaseArtifact } from "../../src/server/modules/reviews/release-v2";
import {
  evidenceDatabase,
  S,
  seedHistorical,
} from "../helpers/review-evidence-fixture";
import { fixtureId, newSession } from "../helpers/sync-fixture";
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
    "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at,uploader_binding_id,uploader_binding_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '15 minutes',(SELECT id FROM held_release_person_binding WHERE station_id=$3 AND user_id=$4 ORDER BY version DESC LIMIT 1),(SELECT version FROM held_release_person_binding WHERE station_id=$3 AND user_id=$4 ORDER BY version DESC LIMIT 1))",
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

import { pendingReleaseBlockers } from "../../src/server/modules/reviews/release-integrations";
import { createReleaseUploadsService } from "../../src/server/modules/reviews/release-uploads";
beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
async function snapshot(x: Awaited<ReturnType<typeof fixture>>) {
  const setting = (
    await db.pool.query(
      "SELECT id,campaign_id FROM settings_version WHERE station_id=$1 ORDER BY version DESC",
      [x.f.stationId],
    )
  ).rows[0];
  const id = newId();
  await db.pool.query(
    "INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,operation_id,actor_id,reason,tie_rule,finalized_at) VALUES($1,$2,$3,1,$4,$5,'Fictional retained history','competition',clock_timestamp())",
    [id, setting.campaign_id, setting.id, newId(), fixtureId(5)],
  );
  const revision = (
    await db.pool.query(
      "SELECT id FROM purchase_revision WHERE purchase_id=$1 ORDER BY revision_number LIMIT 1",
      [x.sale.purchaseId],
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO giveaway_snapshot_source(id,snapshot_id,purchase_id,revision_id,included,exclusion_reason) VALUES($1,$2,$3,$4,false,'held')",
    [newId(), id, x.sale.purchaseId, revision],
  );
  await clean(setting.campaign_id);
  return setting.campaign_id as string;
}
async function clean(campaign: string) {
  await db.pool.query(
    "UPDATE campaign SET reconciliation_required=false,version=version+1 WHERE id=$1",
    [campaign],
  );
}
async function state(station: string, campaign: string) {
  return (
    await db.pool.query(
      "SELECT s.data_version::text generation,c.reconciliation_required dirty FROM station_reporting_state s JOIN campaign c ON c.station_id=s.station_id WHERE s.station_id=$1 AND c.id=$2",
      [station, campaign],
    )
  ).rows[0] as { generation: string; dirty: boolean };
}
async function frozen() {
  return (
    await db.pool.query(
      "SELECT to_jsonb(s) snapshot,(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM giveaway_snapshot_source x WHERE x.snapshot_id=s.id) sources FROM giveaway_snapshot s ORDER BY s.id",
    )
  ).rows;
}
async function terminal(
  x: Awaited<ReturnType<typeof fixture>>,
  proposalId: string,
  outcome: "approved" | "rejected" | "superseded",
) {
  if (outcome !== "superseded")
    return x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposalId, {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: outcome === "approved" ? "approve" : "reject",
    });
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
  return createReviewsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
    },
  }).decideCard(x.reviewerToken, x.sale.purchaseId, x.holdId, {
    ...(await x.h.guard(x.sale.purchaseId)),
    expectedHoldVersion: 1,
    outcome: "cancel",
    evidence: x.evidence,
  });
}
it.each(["approved", "rejected", "superseded"] as const)(
  "SR-06 hook %s transition removes pending blocker and advances generation with dirty reconciliation",
  async (outcome) => {
    const x = await fixture(),
      campaign = await snapshot(x),
      history = await frozen();
    const before = await state(x.f.stationId, campaign);
    const { proposal } = await x.svc.propose(
      x.token,
      x.sale.purchaseId,
      x.body,
    );
    const proposed = await state(x.f.stationId, campaign);
    expect(BigInt(proposed.generation)).toBeGreaterThan(
      BigInt(before.generation),
    );
    expect(proposed.dirty).toBe(true);
    expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual({
      holds: [x.sale.purchaseId],
      policyBlocks: [],
    });
    await clean(campaign);
    const pending = await state(x.f.stationId, campaign);
    await terminal(x, proposal.id, outcome);
    const after = await state(x.f.stationId, campaign);
    expect(BigInt(after.generation)).toBeGreaterThan(
      BigInt(pending.generation),
    );
    expect(after.dirty).toBe(true);
    expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual({
      holds: [],
      policyBlocks: [],
    });
    expect(
      (
        await db.pool.query(
          "SELECT state FROM held_release_state WHERE proposal_id=$1",
          [proposal.id],
        )
      ).rows[0].state,
    ).toBe(outcome);
    expect(await frozen()).toEqual(history);
  },
);
it("SR-06 hook stale pending and deactivated policy remain blocking without generation reinterpretation", async () => {
  const x = await fixture("capture"),
    campaign = await snapshot(x);
  await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  await db.pool.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
    x.sale.purchaseId,
  ]);
  const before = await state(x.f.stationId, campaign);
  const config = {
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
    [newId(), x.f.stationId, config],
  );
  expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual({
    holds: [],
    policyBlocks: [x.sale.purchaseId],
  });
  expect(await state(x.f.stationId, campaign)).toEqual(before);
});
it.each(["proposal", "approval"] as const)(
  "SR-06 hook %s rollback restores generation dirty bit blocker history and receipts",
  async (stage) => {
    const x = await fixture(),
      campaign = await snapshot(x);
    const proposal =
      stage === "approval"
        ? (await x.svc.propose(x.token, x.sale.purchaseId, x.body)).proposal
        : null;
    await clean(campaign);
    const before = await state(x.f.stationId, campaign),
      blockers = await pendingReleaseBlockers(db.pool, x.f.stationId),
      history = await frozen();
    const rows = async () =>
      (
        await db.pool.query(
          "SELECT (SELECT count(*) FROM held_release_proposal)::int proposals,(SELECT count(*) FROM held_release_transition)::int transitions,(SELECT count(*) FROM held_release_receipt)::int receipts,(SELECT count(*) FROM sale_decision)::int decisions",
        )
      ).rows;
    const beforeRows = await rows();
    await db.pool.query(
      `CREATE FUNCTION fail_hook_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional receipt failure'; END $$; CREATE TRIGGER fail_hook_receipt BEFORE INSERT ON held_release_receipt FOR EACH ROW EXECUTE FUNCTION fail_hook_receipt()`,
    );
    try {
      await expect(
        stage === "proposal"
          ? x.svc.propose(x.token, x.sale.purchaseId, x.body)
          : terminal(x, proposal!.id, "approved"),
      ).rejects.toThrow("fictional receipt failure");
    } finally {
      await db.pool.query(
        "DROP TRIGGER fail_hook_receipt ON held_release_receipt; DROP FUNCTION fail_hook_receipt()",
      );
    }
    expect(await state(x.f.stationId, campaign)).toEqual(before);
    expect(await rows()).toEqual(beforeRows);
    expect(await frozen()).toEqual(history);
    expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual(
      blockers,
    );
  },
);
it("SR-06 hook upload reservation alone does not dirty campaign advance generation or add blocker", async () => {
  const x = await fixture(),
    campaign = await snapshot(x),
    before = await state(x.f.stationId, campaign);
  const svc = createReleaseUploadsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
    },
  });
  await svc.reserve(x.token, x.sale.purchaseId, {
    operationId: newId(),
    target: x.target,
    sha256: "a".repeat(64),
    bytes: 100,
    contentType: "image/jpeg",
  });
  expect(await state(x.f.stationId, campaign)).toEqual(before);
  expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual({
    holds: [],
    policyBlocks: [],
  });
});

it("SR-06 hook blocker union counts each purchase once by kind and excludes other stations", async () => {
  const x = await fixture();
  await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  const bytes = await x.h.image();
  const session = await newSession(db.pool, x.f);
  const second = await x.h.settle(
    {
      ...x.f,
      ...session,
      original: { ...x.f.original, captureContextId: session.contextId },
    },
    bytes,
  );
  const foreignContext = await x.h.context(bytes),
    foreign = await x.h.settle(foreignContext, bytes);
  async function pending(purchase: string, station: string, kind: string) {
    const person = newId(),
      sheet = newId(),
      proposal = newId();
    await db.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, station],
    );
    await db.pool.query(
      "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,'{}',$6,10,$7,clock_timestamp()+interval '15 minutes')",
      [
        sheet,
        purchase,
        station,
        x.actors[0],
        person,
        "a".repeat(64),
        `fictional/${sheet}`,
      ],
    );
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO held_release_proposal(id,purchase_id,station_id,target_kind,outcome,sheet_asset_id,proposer_id,proposer_person_id,content,provenance) VALUES($1,$2,$3,$4,'confirm',$5,$6,$7,'{}','{}')",
        [proposal, purchase, station, kind, sheet, x.actors[0], person],
      );
      const beforeGeneration = (
        await client.query(
          "SELECT data_version::text value FROM station_reporting_state WHERE station_id=$1",
          [station],
        )
      ).rows[0].value;
      await client.query(
        "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
        [proposal, purchase],
      );
      await client.query(
        "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
        [newId(), proposal, x.actors[0]],
      );
      const afterGeneration = (
        await client.query(
          "SELECT data_version::text value FROM station_reporting_state WHERE station_id=$1",
          [station],
        )
      ).rows[0].value;
      expect(BigInt(afterGeneration)).toBe(BigInt(beforeGeneration) + 1n);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await pending(second.purchaseId, x.f.stationId, "capture");
  await pending(foreign.purchaseId, foreignContext.stationId, "price");
  const own = await pendingReleaseBlockers(db.pool, x.f.stationId);
  expect(own).toEqual({
    holds: [x.sale.purchaseId],
    policyBlocks: [second.purchaseId],
  });
  expect(
    await pendingReleaseBlockers(db.pool, foreignContext.stationId),
  ).toEqual({ holds: [foreign.purchaseId], policyBlocks: [] });
  const ordinaryHolds = (
    await db.pool.query(
      "SELECT purchase_id FROM purchase_hold WHERE purchase_id=$1 AND state='open'",
      [x.sale.purchaseId],
    )
  ).rows.map((r) => r.purchase_id);
  expect(new Set([...ordinaryHolds, ...own.holds]).size).toBe(1);
  expect(new Set([...own.holds, ...own.policyBlocks]).size).toBe(2);
});

it("SR-06 state trigger alone advances exactly one station generation and rolls back with its transition", async () => {
  const x = await fixture();
  const { proposal } = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  const generation = async () =>
    (
      await db.pool.query(
        "SELECT data_version::text value FROM station_reporting_state WHERE station_id=$1",
        [x.f.stationId],
      )
    ).rows[0].value as string;
  const before = await generation();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE held_release_state SET state='rejected',version=2 WHERE proposal_id=$1",
      [proposal.id],
    );
    await client.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,2,'rejected',$3,'{}')",
      [newId(), proposal.id, x.actors[1]],
    );
    const during = (
      await client.query(
        "SELECT data_version::text value FROM station_reporting_state WHERE station_id=$1",
        [x.f.stationId],
      )
    ).rows[0].value;
    expect(BigInt(during)).toBe(BigInt(before) + 1n);
    expect(await pendingReleaseBlockers(client, x.f.stationId)).toEqual({
      holds: [],
      policyBlocks: [],
    });
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  expect(await generation()).toBe(before);
  expect(await pendingReleaseBlockers(db.pool, x.f.stationId)).toEqual({
    holds: [x.sale.purchaseId],
    policyBlocks: [],
  });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_transition WHERE proposal_id=$1",
        [proposal.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
