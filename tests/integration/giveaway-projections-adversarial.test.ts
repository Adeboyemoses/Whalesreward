import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { POST as censusPOST } from "../../src/app/api/admin/giveaway/[campaignId]/reconciliation/censuses/route";
import { COOKIE } from "../../src/server/modules/admin-access/http";
import { database } from "../../src/server/lib/db";
import { z } from "zod";
import type pg from "pg";
import {
  giveawayFixture,
  pendingGiveawayProposal,
} from "../helpers/giveaway-fixture";
import {
  config,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { seedHistorical } from "../helpers/review-evidence-fixture";
import { newId } from "../../src/server/lib/ids";
import { readProjection } from "../../src/server/modules/giveaway/projections";
import {
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "../../src/server/modules/giveaway/service";
import { phoneReadiness } from "../../src/server/modules/giveaway/phone-readiness";
import {
  checklistProjectionSchema,
  attendantSelectionSchema,
  managerSelectionSchema,
  phoneSelectionSchema,
  incompleteSelectionSchema,
  storedChecklistSchema,
} from "../../src/shared/contracts/giveaway-projections";
import type { ProjectionAction } from "../../src/server/modules/giveaway/projection-context";
type Fixture = Awaited<ReturnType<typeof giveawayFixture>>;
async function isolated(run: (f: Fixture) => Promise<void>) {
  const original = process.env.DATABASE_URL;
  const f = await giveawayFixture();
  try {
    await run(f);
  } finally {
    await f.close();
    process.env.DATABASE_URL = original;
  }
}
const read = (
  f: Fixture,
  action: ProjectionAction,
  input: unknown = {},
  id?: string,
  token = f.token,
) =>
  readProjection(f.pool, config.secret, token, f.campaignId, action, id, input);
const checklist = async (f: Fixture) =>
  checklistProjectionSchema.parse(await read(f, "checklist"));
async function relevant(f: Fixture, sale: { id: string }) {
  // Historical fixture construction only; service reads run with all guards enabled.
  await seedHistorical(
    f.pool,
    "settings_version",
    "UPDATE settings_version SET launch_at='2026-11-01',purchase_start='2026-11-01' WHERE campaign_id=$1",
    [f.campaignId],
  );
  await seedHistorical(
    f.pool,
    "purchase",
    "UPDATE purchase SET server_received_at=clock_timestamp()-interval '2 days' WHERE id=$1",
    [sale.id],
  );
}
async function observe(f: Fixture, purchaseId: string) {
  const asset = newId(),
    observation = newId();
  await f.pool.query(
    "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '1 hour',$5,100)",
    [asset, purchaseId, newId(), `fictional/${asset}`, "a".repeat(64)],
  );
  await f.pool.query(
    "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) VALUES($1,$2,$3,$4,$5,$5,100,$6,clock_timestamp())",
    [
      observation,
      fixtureId(8),
      purchaseId,
      asset,
      "a".repeat(64),
      `fictional/sealed/${asset}`,
    ],
  );
  return { asset, observation };
}
async function reviewer(f: Fixture, same = false) {
  const a = await f.actor([
    "sales",
    "leaderboards",
    "giveawayFinalize",
    "giveawayRevise",
  ]);
  const binding = (
    await f.pool.query(
      "SELECT person_id FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [fixtureId(2)],
    )
  ).rows[0];
  const person = same ? binding.person_id : newId();
  if (!same)
    await f.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, fixtureId(8)],
    );
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), fixtureId(8), a.userId, person],
  );
  return a;
}
async function propose(
  f: Fixture,
  purchaseId: string,
  phone?: { id: string; version: number },
) {
  const phones = phoneSelectionSchema.parse(await read(f, "phones"));
  const selected = phone ?? phones.items[0]!;
  const version = (
    await f.pool.query("SELECT version FROM purchase WHERE id=$1", [purchaseId])
  ).rows[0].version;
  return f.phones.propose(f.token, f.campaignId, selected.id, {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional exact incomplete source",
    ...(await f.guard()),
    expectedCensusVersion: phones.view.censusVersion,
    expectedPhoneVersion: selected.version,
    partialSources: [{ purchaseId, expectedPurchaseVersion: version }],
  });
}
async function prepare(f: Fixture, kind: "initial" | "revision" = "initial") {
  return prepareGiveaway(
    f.pool,
    f.token,
    f.campaignId,
    {
      operationId: newId(),
      kind,
      reason: "Fictional historical preparation",
      ...(await f.guard()),
    },
    config,
  );
}
async function save(f: Fixture) {
  await f.check();
  const p = z
    .object({
      id: z.string(),
      contentDigest: z.string(),
      reconciliationId: z.string(),
    })
    .parse((await prepare(f)).data);
  await confirmGiveaway(
    f.pool,
    f.token,
    f.campaignId,
    {
      operationId: newId(),
      previewId: p.id,
      contentDigest: p.contentDigest,
      ...(await f.guard()),
    },
    undefined,
    config,
  );
  return p;
}
it(
  "T21 ordinary holds independently count history and open purchases without P29-only targets",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "held" });
      await relevant(f, s);
      const result = await checklist(f);
      expect(result.checks.find((c) => c.name === "holds")).toMatchObject({
        checked: "1",
        blocking: "1",
        outcome: "unresolved",
        reasonCodes: ["holds_open"],
      });
      expect(
        result.checks.find((c) => c.name === "two_person_proposals")?.blocking,
      ).toBe("0");
    }),
  30000,
);
it(
  "T21 corrections independently block pending proposals without replacing accepted contribution",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { lateProposal: true });
      await relevant(f, s);
      const p = (
        await f.pool.query("SELECT * FROM purchase WHERE id=$1", [s.id])
      ).rows[0];
      const proposed = (
        await f.pool.query(
          "SELECT id FROM purchase_revision WHERE purchase_id=$1 AND state='proposed'",
          [s.id],
        )
      ).rows[0].id;
      const session = (
        await f.pool.query("SELECT id FROM auth_session LIMIT 1")
      ).rows[0].id;
      const correctionId = newId(),
        db = await f.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("ALTER TABLE purchase_revision DISABLE TRIGGER USER");
        await db.query(
          "UPDATE purchase_revision SET correction_id=$2 WHERE id=$1",
          [proposed, correctionId],
        );
        await db.query(
          `INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,authority_session_id,reserved_purchase_version,receipt) VALUES($1,$2,$3,$4,'fictional','fictional',$5,$6,$7,clock_timestamp(),'fictional','unresolved','pending_validation','Fictional late correction',$8,$3,'authenticated_attendant',$9,$10,'{}')`,
          [
            correctionId,
            s.id,
            p.originating_attendant_id,
            newId(),
            s.revisionId,
            p.version,
            proposed,
            fixtureId(3),
            session,
            p.version + 1,
          ],
        );
        await db.query("SET CONSTRAINTS ALL IMMEDIATE");
        await db.query("ALTER TABLE purchase_revision ENABLE TRIGGER USER");
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
      const result = await checklist(f);
      expect(result.checks.find((c) => c.name === "corrections")).toMatchObject(
        { checked: "1", blocking: "1", outcome: "unresolved" },
      );
      expect(
        (
          await f.pool.query(
            "SELECT current_revision_id FROM purchase WHERE id=$1",
            [s.id],
          )
        ).rows[0].current_revision_id,
      ).toBe(s.revisionId);
    }),
  30000,
);
it(
  "T21 duplicate pairs deduplicate the primary purchase while either side remains relevant",
  () =>
    isolated(async (f) => {
      const sales = [
        await historicalSale(f.pool, {}),
        await historicalSale(f.pool, {}),
        await historicalSale(f.pool, {}),
      ];
      for (const s of sales) await relevant(f, s);
      const ids = sales.map((s) => s.id).sort();
      for (const other of ids.slice(1))
        await f.pool.query(
          "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'validated_photo','open',1)",
          [newId(), ids[0], other],
        );
      expect(
        (await checklist(f)).checks.find((c) => c.name === "duplicates"),
      ).toMatchObject({ checked: "1", blocking: "1", outcome: "unresolved" });
    }),
  30000,
);
it(
  "T21 stale inactive P29 with apparently closed target remains a station-wide blocker",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, {});
      await pendingGiveawayProposal(f, s.id);
      const c = await checklist(f);
      expect(
        c.checks.find((x) => x.name === "two_person_proposals"),
      ).toMatchObject({ checked: "1", blocking: "1" });
      expect(c.checks.find((x) => x.name === "holds")?.blocking).toBe("0");
      expect(
        c.checks.find((x) => x.name === "eligibility")?.reasonCodes,
      ).toContain("capture_release_pending");
      expect(c.readiness.blockers).toContain("reviews_unresolved");
    }),
  30000,
);
it(
  "T21 uploads and photo proof overlap without changing grouped readiness unions",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      await relevant(f, s);
      await f.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_unresolved','fictional',clock_timestamp(),1)",
        [newId(), s.id],
      );
      const c = await checklist(f),
        grouped = await readReadiness(f.pool, f.token, f.campaignId);
      for (const name of ["uploads", "complete_photo_deadline", "eligibility"])
        expect(c.checks.find((x) => x.name === name)).toMatchObject({
          blocking: "1",
          outcome: "unresolved",
        });
      expect(c.readiness.counts).toEqual(grouped.counts);
      expect(c.readiness.blockers).toEqual(grouped.blockers);
      expect(grouped.counts.uploads).toBe("1");
    }),
  30000,
);
it(
  "T21 accepted legacy photo without trusted proof keeps grouped uploads unresolved",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, {});
      await relevant(f, s);
      const c = await checklist(f);
      expect(c.readiness.counts.uploads).toBe("1");
      expect(
        c.checks.find((x) => x.name === "complete_photo_deadline"),
      ).toMatchObject({ blocking: "1", outcome: "unresolved" });
      expect(c.checks.find((x) => x.name === "uploads")?.outcome).toBe(
        "unresolved",
      );
    }),
  30000,
);
it(
  "T21 phone census missing stale and complete outcomes never infer unknown devices",
  () =>
    isolated(async (f) => {
      expect(
        (await checklist(f)).checks.find((x) => x.name === "phone_census"),
      ).toMatchObject({ checked: "0", blocking: null, outcome: "unresolved" });
      await f.check();
      expect(
        (await checklist(f)).checks.find((x) => x.name === "phone_census"),
      ).toMatchObject({ checked: "1", blocking: "0", outcome: "resolved" });
      await historicalSale(f.pool, { state: "received" });
      expect(
        (await checklist(f)).checks.find((x) => x.name === "phone_census"),
      ).toMatchObject({ checked: "1", blocking: "1", outcome: "unresolved" });
    }),
  30000,
);
it(
  "T21 101-plus historical candidates page completely and first-page census cannot certify",
  () =>
    isolated(async (f) => {
      for (let i = 0; i < 101; i++) {
        const user = newId(),
          attendant = newId();
        await f.pool.query(
          "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Fictional Attendant',false,1,false,clock_timestamp())",
          [user, `fictional.${user}`],
        );
        await f.pool.query(
          "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
          [attendant, user, `STAFF-${i}`],
        );
        await f.pool.query(
          "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,effective_until,changed_by,reason) VALUES($1,$2,$3,1,'2020-01-01','2020-01-02',$4,'Fictional ended assignment')",
          [newId(), attendant, fixtureId(14), fixtureId(5)],
        );
      }
      const first = attendantSelectionSchema.parse(await read(f, "attendants"));
      expect(first.items).toHaveLength(25);
      expect(first.nextCursor).not.toBeNull();
      await expect(
        f.phones.census(f.token, f.campaignId, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional incomplete first page",
          ...(await f.guard()),
          expectedCensusVersion: 1,
          phones: [
            {
              label: "Fictional phone",
              attendantIds: first.items.map((x) => x.attendantId),
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "census_incomplete" });
      const all = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const next = attendantSelectionSchema.parse(
          await read(f, "attendants", {
            cursor,
            expectedView: first.view.viewToken,
          }),
        );
        all.push(...next.items);
        cursor = next.nextCursor;
      }
      expect(all).toHaveLength(103);
      expect(new Set(all.map((x) => x.attendantId)).size).toBe(103);
      expect(all.map((x) => x.attendantId)).toEqual(
        all.map((x) => x.attendantId).sort(),
      );
    }),
  30000,
);
it(
  "T21 cursor binds route and limit and rejects obsolete complete view",
  () =>
    isolated(async (f) => {
      const first = attendantSelectionSchema.parse(
        await read(f, "attendants", { limit: 1 }),
      );
      for (const [action, input] of [
        ["phones", { limit: 1, cursor: first.nextCursor }],
        ["attendants", { limit: 2, cursor: first.nextCursor }],
      ] as const)
        await expect(read(f, action, input)).rejects.toMatchObject({
          code: "invalid_request",
        });
      await f.pool.query(
        "UPDATE auth_user SET display_name='Fictional renamed' WHERE id=$1",
        [fixtureId(3)],
      );
      await expect(
        read(f, "attendants", { limit: 1, cursor: first.nextCursor }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
    }),
  30000,
);
it(
  "T21 changed verified and alias person bindings invalidate selection without promising independence",
  () =>
    isolated(async (f) => {
      const alias = await reviewer(f, true);
      const before = managerSelectionSchema.parse(await read(f, "managers"));
      expect(before.items.map((x) => x.adminId)).toEqual(
        expect.arrayContaining([fixtureId(5), alias.adminId]),
      );
      await f.pool.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT $1,station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$2 ORDER BY version DESC LIMIT 1",
        [newId(), alias.userId],
      );
      await expect(
        read(f, "managers", { expectedView: before.view.viewToken }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        managerSelectionSchema
          .parse(await read(f, "managers"))
          .items.some((x) => x.adminId === alias.adminId),
      ).toBe(false);
    }),
  30000,
);
it(
  "T21 sealed observation without final fact removes candidate and invalidates selection",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      await relevant(f, s);
      await f.check();
      const phone = phoneSelectionSchema.parse(await read(f, "phones"))
        .items[0]!;
      const before = incompleteSelectionSchema.parse(
        await read(f, "incomplete-sources", {}, phone.id),
      );
      expect(before.items.some((x) => x.purchaseId === s.id)).toBe(true);
      await observe(f, s.id);
      expect(
        (await checklist(f)).checks.find(
          (x) => x.name === "complete_photo_deadline",
        )?.reasonCodes,
      ).toContain("photo_deadline_uncertain");
      expect(
        (
          await f.pool.query(
            "SELECT count(*)::text n FROM photo_receipt_fact WHERE purchase_id=$1",
            [s.id],
          )
        ).rows[0].n,
      ).toBe("0");
      await expect(
        read(
          f,
          "incomplete-sources",
          { expectedView: before.view.viewToken },
          phone.id,
        ),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        incompleteSelectionSchema.parse(
          await read(f, "incomplete-sources", {}, phone.id),
        ).items,
      ).toEqual([]);
      await expect(propose(f, s.id)).rejects.toMatchObject({
        code: "exclusion_source_invalid",
      });
    }),
  30000,
);
it(
  "T21 accepted-then-cancelled and superseded revision histories never become incomplete candidates",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { acceptedAmount: "2345678" });
      await f.pool.query(
        "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation',version=version+1 WHERE id=$1",
        [s.id],
      );
      await f.check();
      const phone = phoneSelectionSchema.parse(await read(f, "phones"))
        .items[0]!;
      expect(
        incompleteSelectionSchema.parse(
          await read(f, "incomplete-sources", {}, phone.id),
        ).items,
      ).toEqual([]);
      await expect(propose(f, s.id)).rejects.toMatchObject({
        code: "exclusion_source_invalid",
      });
    }),
  30000,
);
it(
  "T21 byte arrival between proposal and independent decision refuses obsolete source",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      await f.check();
      const a = await reviewer(f);
      const p = await propose(f, s.id);
      await observe(f, s.id);
      await expect(
        f.phones.decide(a.token, f.campaignId, String(p.exclusion.id), {
          operationId: newId(),
          expectedVersion: 1,
          decision: "approve",
          reason: "Fictional independent review",
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(
          /exclusion_stale|version_conflict|exclusion_source_invalid/,
        ),
      });
    }),
  30000,
);
it(
  "T21 partition replacement invalidates phone and source views before proposal",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "received" });
      await f.check();
      const old = phoneSelectionSchema.parse(await read(f, "phones"));
      await f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional replacement phones",
        ...(await f.guard()),
        expectedCensusVersion: old.view.censusVersion,
        phones: old.items.map((p) => ({
          label: p.label,
          attendantIds: p.attendantIds,
        })),
      });
      await expect(
        read(f, "phones", { expectedView: old.view.viewToken }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      await expect(
        read(f, "incomplete-sources", {}, old.items[0]!.id),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(s.id).toBeTruthy();
    }),
  30000,
);
it(
  "T21 snapshot predecessor changes derived action and invalidates initial selection",
  () =>
    isolated(async (f) => {
      const before = managerSelectionSchema.parse(await read(f, "managers"));
      await save(f);
      await expect(
        read(f, "managers", { expectedView: before.view.viewToken }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        managerSelectionSchema.parse(await read(f, "managers")).view.kind,
      ).toBe("revision");
    }),
  30000,
);
it(
  "T21 unchanged historical result preserves exact stored checks after later intake and snapshots remain immutable",
  () =>
    isolated(async (f) => {
      await save(f);
      await f.check("revision");
      const u = await prepare(f, "revision");
      expect(u.data).toMatchObject({ state: "unchanged" });
      const id = String(u.data.reconciliationId);
      const before = storedChecklistSchema.parse(
        await read(f, "results", {}, id),
      );
      expect(before).toMatchObject({
        outcome: "unchanged",
        kind: "revision",
        historical: true,
        countBasis: "reconciliation_v1_stored",
      });
      const snapshot = (
        await f.pool.query(
          "SELECT to_jsonb(s) snapshot FROM giveaway_snapshot s",
        )
      ).rows;
      await historicalSale(f.pool, { state: "received" });
      expect(await read(f, "results", {}, id)).toEqual(before);
      expect(
        (
          await f.pool.query(
            "SELECT to_jsonb(s) snapshot FROM giveaway_snapshot s",
          )
        ).rows,
      ).toEqual(snapshot);
      expect(JSON.stringify(before)).not.toMatch(
        /sourceDigest|personId|bindingId|operationId/,
      );
    }),
  30000,
);
it(
  "T21 malformed retained check evidence returns 503 rather than synthesized pass",
  () =>
    isolated(async (f) => {
      await f.check();
      const p = await prepare(f);
      const id = String(p.data.reconciliationId);
      await seedHistorical(
        f.pool,
        "giveaway_reconciliation",
        "UPDATE giveaway_reconciliation SET content=jsonb_set(content,'{checks}','[]'::jsonb) WHERE id=$1",
        [id],
      );
      await expect(read(f, "results", {}, id)).rejects.toMatchObject({
        code: "temporarily_unavailable",
        status: 503,
      });
    }),
  30000,
);
it(
  "T21 generic failed writes do not disclose unknown versus ineligible targets",
  () =>
    isolated(async (f) => {
      const a = await f.actor(["sales"]);
      for (const target of [newId(), a.adminId])
        await expect(
          f.phones.designate(f.token, f.campaignId, {
            operationId: newId(),
            expectedVersion: (await f.guard()).expectedVersion,
            managerAdminId: target,
            reason: "Fictional invalid selection",
          }),
        ).rejects.toMatchObject({ code: "manager_invalid" });
      const s = await historicalSale(f.pool, { state: "credited" });
      await f.check();
      const phone = phoneSelectionSchema.parse(await read(f, "phones"))
        .items[0]!;
      for (const target of [newId(), s.id])
        await expect(
          f.phones.propose(f.token, f.campaignId, phone.id, {
            operationId: newId(),
            kind: "initial",
            reason: "Fictional invalid source",
            ...(await f.guard()),
            expectedCensusVersion: 2,
            expectedPhoneVersion: phone.version,
            partialSources: [
              { purchaseId: target, expectedPurchaseVersion: 1 },
            ],
          }),
        ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
    }),
  30000,
);
it(
  "T21 read bounds reject excess filters empty tokens oversized cursors and limits",
  () =>
    isolated(async (f) => {
      for (const input of [
        { limit: 0 },
        { limit: 101 },
        { cursor: "" },
        { cursor: "x".repeat(4097) },
        { expectedView: "" },
        { stationId: newId() },
        { kind: "initial" },
        { eligible: true },
      ])
        await expect(read(f, "attendants", input)).rejects.toBeDefined();
    }),
  30000,
);
it(
  "T21 WHR-179 duplicate applicable source exclusions cannot certify or prepare",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      const ids = (
        await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
      ).rows.map((r) => r.attendant_id);
      await f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional two shared phones",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [
          { label: "Fictional first", attendantIds: ids },
          { label: "Fictional second", attendantIds: ids },
        ],
      });
      const choices = phoneSelectionSchema.parse(await read(f, "phones")),
        a = await reviewer(f),
        entries = [];
      for (const phone of choices.items) {
        const p = await propose(f, s.id, phone);
        await f.phones.decide(a.token, f.campaignId, String(p.exclusion.id), {
          operationId: newId(),
          expectedVersion: 1,
          decision: "approve",
          reason: "Fictional independent approval",
        });
        entries.push({
          phoneId: phone.id,
          expectedPhoneVersion: phone.version,
          result: "unavailable",
          exclusionId: p.exclusion.id,
        });
      }
      await expect(
        f.phones.check(f.token, f.campaignId, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional conflicting attribution",
          ...(await f.guard()),
          expectedCensusVersion: choices.view.censusVersion,
          entries,
        }),
      ).rejects.toBeDefined();
      const db = await f.pool.connect();
      try {
        const r = await phoneReadiness(db, f.campaignId, "initial");
        expect(r.status.state).not.toBe("complete");
      } finally {
        db.release();
      }
    }),
  30000,
);

/** Freeze only the database clock expression; actual PostgreSQL compares exact stored instants. */
function databaseClock(pool: pg.Pool, initial: string) {
  const connect = pool.connect;
  let now = initial;
  pool.connect = new Proxy(connect, {
    apply(target, receiver, args) {
      if (args.length) return Reflect.apply(target, receiver, args);
      return Promise.resolve(Reflect.apply(target, receiver, args)).then(
        (client) => {
          const query = client.query,
            release = client.release;
          client.query = new Proxy(query, {
            apply(q, context, params) {
              if (typeof params[0] === "string")
                params[0] = params[0].replaceAll(
                  "clock_timestamp()",
                  `'${now}'::timestamptz`,
                );
              return Reflect.apply(q, context, params);
            },
          });
          client.release = (...args: unknown[]) => {
            client.query = query;
            client.release = release;
            return Reflect.apply(release, client, args);
          };
          return client;
        },
      );
    },
  });
  return {
    set(value: string) {
      now = value;
    },
    restore() {
      pool.connect = connect;
    },
  };
}
it(
  "T21 exact cutoff equality blocks and phase crossing invalidates view without a generation write",
  () =>
    isolated(async (f) => {
      // Historical policy pins are seeded before the reads. No test writes occur between phase reads.
      const deadline = (
        await f.pool.query(
          "SELECT to_char((clock_timestamp()+interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') at",
        )
      ).rows[0].at;
      await seedHistorical(
        f.pool,
        "settings_version",
        "UPDATE settings_version SET purchase_cutoff=$2,upload_deadline=$2,grace_hours=0 WHERE campaign_id=$1",
        [f.campaignId, deadline],
      );
      const clock = databaseClock(f.pool, deadline);
      try {
        const equal = await checklist(f);
        expect(equal.checks.find((x) => x.name === "timing")).toMatchObject({
          blocking: "1",
          outcome: "unresolved",
          reasonCodes: expect.arrayContaining(["before_cutoff", "grace_open"]),
        });
        const next = (
          await f.pool.query(
            "SELECT to_char(($1::timestamptz+interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') at",
            [deadline],
          )
        ).rows[0].at;
        clock.set(next);
        await expect(
          read(f, "checklist", { expectedView: equal.view.viewToken }),
        ).rejects.toMatchObject({ code: "read_view_stale" });
        const later = await checklist(f);
        expect(later.view.guard.expectedDataVersion).toBe(
          equal.view.guard.expectedDataVersion,
        );
        expect(later.checks.find((x) => x.name === "timing")).toMatchObject({
          blocking: "0",
          outcome: "resolved",
        });
      } finally {
        clock.restore();
      }
    }),
  30000,
);
it(
  "T21 revoked manager action fails current authorization before old cursor decoding",
  () =>
    isolated(async (f) => {
      const first = attendantSelectionSchema.parse(
        await read(f, "attendants", { limit: 1 }),
      );
      const role = (
        await f.pool.query("SELECT role_id FROM admin WHERE id=$1", [
          fixtureId(5),
        ])
      ).rows[0].role_id;
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='giveawayFinalize'",
        [role],
      );
      await expect(
        read(f, "attendants", { cursor: first.nextCursor, limit: 1 }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }),
  30000,
);
it(
  "T21 byte arrival after approval invalidates phone certification and preparation",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      await f.check();
      const a = await reviewer(f);
      const phone = phoneSelectionSchema.parse(await read(f, "phones")),
        p = await propose(f, s.id);
      await f.phones.decide(a.token, f.campaignId, String(p.exclusion.id), {
        operationId: newId(),
        expectedVersion: 1,
        decision: "approve",
        reason: "Fictional independent review",
      });
      await observe(f, s.id);
      await expect(
        f.phones.check(f.token, f.campaignId, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional stale phone certification",
          ...(await f.guard()),
          expectedCensusVersion: phone.view.censusVersion,
          entries: [
            {
              phoneId: phone.items[0]!.id,
              expectedPhoneVersion: phone.items[0]!.version,
              result: "unavailable",
              exclusionId: p.exclusion.id,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
      await expect(prepare(f)).rejects.toMatchObject({
        code: "finalization_blocked",
      });
    }),
  30000,
);
it(
  "T21 new intake after preparation prevents confirmation without rewriting historical result",
  () =>
    isolated(async (f) => {
      await f.check();
      const prepared = await prepare(f);
      const p = z
          .object({
            id: z.string(),
            contentDigest: z.string(),
            reconciliationId: z.string(),
          })
          .parse(prepared.data),
        guard = await f.guard();
      const before = await read(f, "results", {}, p.reconciliationId);
      await historicalSale(f.pool, { state: "received" });
      await expect(
        confirmGiveaway(
          f.pool,
          f.token,
          f.campaignId,
          {
            operationId: newId(),
            previewId: p.id,
            contentDigest: p.contentDigest,
            ...guard,
          },
          undefined,
          config,
        ),
      ).rejects.toMatchObject({
        code: expect.stringMatching(
          /version_conflict|finalization_blocked|preview_stale/,
        ),
      });
      expect(await read(f, "results", {}, p.reconciliationId)).toEqual(before);
      expect(
        (await f.pool.query("SELECT count(*)::text n FROM giveaway_snapshot"))
          .rows[0].n,
      ).toBe("0");
    }),
  30000,
);
it(
  "T21 shared account partitions keep both phones and require independent canonical approval",
  () =>
    isolated(async (f) => {
      const ids = (
        await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
      ).rows.map((r) => r.attendant_id);
      await f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional shared partitions",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [
          { label: "Fictional one", attendantIds: ids },
          { label: "Fictional two", attendantIds: ids },
        ],
      });
      const phones = phoneSelectionSchema.parse(await read(f, "phones"));
      expect(phones.items).toHaveLength(2);
      for (const phone of phones.items)
        expect(phone.attendantIds.sort()).toEqual([...ids].sort());
      const sale = await historicalSale(f.pool, { state: "received" }),
        p = await propose(f, sale.id),
        alias = await reviewer(f, true);
      await expect(
        f.phones.decide(alias.token, f.campaignId, String(p.exclusion.id), {
          operationId: newId(),
          expectedVersion: 1,
          decision: "approve",
          reason: "Fictional alias approval",
        }),
      ).rejects.toMatchObject({ code: "independent_admin_required" });
    }),
  30000,
);
it(
  "T21 response budget continues large phone pages without dropping or truncating partitions",
  () =>
    isolated(async (f) => {
      const ids = (
        await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
      ).rows.map((r) => r.attendant_id);
      // Phone labels remain valid schema strings, but together exceed the HTTP response budget.
      const phoneRows = Array.from({ length: 100 }, (_, i) => ({
        label: `Fictional outdoor pump handset with protective shade number ${i}`,
        attendantIds: ids,
      }));
      await f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional large phone census",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: phoneRows,
      });
      const first = phoneSelectionSchema.parse(
        await read(f, "phones", { limit: 100 }),
      );
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
        32768,
      );
      const all = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = phoneSelectionSchema.parse(
          await read(f, "phones", {
            limit: 100,
            cursor,
            expectedView: first.view.viewToken,
          }),
        );
        all.push(...page.items);
        cursor = page.nextCursor;
      }
      expect(all).toHaveLength(100);
      expect(new Set(all.map((x) => x.id)).size).toBe(100);
      for (const phone of all)
        expect(phone.attendantIds.sort()).toEqual([...ids].sort());
    }),
  30000,
);
it(
  "T21 eligibility independently retains unknown campaign relevance without ordinary holds",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "received" });
      await seedHistorical(
        f.pool,
        "settings_version",
        "UPDATE settings_version SET launch_at='2026-11-01',purchase_start='2026-11-04T12:00:00Z' WHERE campaign_id=$1",
        [f.campaignId],
      );
      const c = await checklist(f);
      expect(c.checks.find((x) => x.name === "holds")?.blocking).toBe("0");
      expect(c.checks.find((x) => x.name === "eligibility")).toMatchObject({
        blocking: "1",
        outcome: "unresolved",
        reasonCodes: expect.arrayContaining(["timing_unresolved"]),
      });
      expect(s.id).toBeTruthy();
    }),
  30000,
);
it(
  "T21 proven late complete-photo sources are settled exclusions rather than missing proof",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, {});
      await seedHistorical(
        f.pool,
        "settings_version",
        "UPDATE settings_version SET launch_at='2026-11-01',purchase_start='2026-11-01' WHERE campaign_id=$1",
        [f.campaignId],
      );
      const c = await checklist(f);
      expect(
        c.checks.find((x) => x.name === "complete_photo_deadline"),
      ).toMatchObject({
        checked: "0",
        blocking: "0",
        outcome: "not_applicable",
        reasonCodes: ["no_applicable_sources"],
      });
      expect(c.checks.find((x) => x.name === "eligibility")?.blocking).toBe(
        "0",
      );
      expect(s.id).toBeTruthy();
    }),
  30000,
);
it(
  "T21 mutation source and partition limits stay 100 and real HTTP body limit stays 32 KiB",
  () =>
    isolated(async (f) => {
      await f.check();
      const page = phoneSelectionSchema.parse(await read(f, "phones")),
        phone = page.items[0]!;
      await expect(
        f.phones.propose(f.token, f.campaignId, phone.id, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional bounded selection",
          ...(await f.guard()),
          expectedCensusVersion: page.view.censusVersion,
          expectedPhoneVersion: phone.version,
          partialSources: Array.from({ length: 101 }, () => ({
            purchaseId: newId(),
            expectedPurchaseVersion: 1,
          })),
        }),
      ).rejects.toBeInstanceOf(z.ZodError);
      await expect(
        f.phones.census(f.token, f.campaignId, {
          operationId: newId(),
          kind: "initial",
          reason: "Fictional bounded partitions",
          ...(await f.guard()),
          expectedCensusVersion: page.view.censusVersion,
          phones: [
            {
              label: "Fictional oversized partition",
              attendantIds: Array.from({ length: 101 }, () => newId()),
            },
          ],
        }),
      ).rejects.toBeInstanceOf(z.ZodError);
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const result = await censusPOST(
          new Request(
            config.origin +
              "/api/admin/giveaway/" +
              f.campaignId +
              "/reconciliation/censuses",
            { method: "POST", headers, body: Buffer.concat(chunks) },
          ),
          { params: Promise.resolve({ campaignId: f.campaignId }) },
        );
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(await result.text());
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw Error("No listener");
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: "POST",
          headers: {
            cookie: `${COOKIE}=${f.token}`,
            origin: config.origin,
            "content-type": "application/json",
            "x-test-ip": "192.0.2.178",
          },
          body: JSON.stringify({ padding: "x".repeat(32768) }),
        });
        expect(response.status).toBe(413);
        expect((await response.json()).error).toMatchObject({
          code: "request_too_large",
          retryable: false,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await database().end();
      }
    }),
  30000,
);
it(
  "T21 disabled candidate role and still-verified person rebinding invalidate manager choices",
  () =>
    isolated(async (f) => {
      const a = await reviewer(f),
        before = managerSelectionSchema.parse(await read(f, "managers"));
      await f.pool.query(
        "UPDATE role SET enabled=false,version=version+1 WHERE id=$1",
        [a.roleId],
      );
      await expect(
        read(f, "managers", { expectedView: before.view.viewToken }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        managerSelectionSchema
          .parse(await read(f, "managers"))
          .items.some((x) => x.adminId === a.adminId),
      ).toBe(false);
      await f.pool.query(
        "UPDATE role SET enabled=true,version=version+1 WHERE id=$1",
        [a.roleId],
      );
      const current = managerSelectionSchema.parse(await read(f, "managers")),
        person = newId();
      await f.pool.query(
        "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
        [person, fixtureId(8)],
      );
      await f.pool.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,true)",
        [newId(), fixtureId(8), a.userId, person],
      );
      await expect(
        read(f, "managers", { expectedView: current.view.viewToken }),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        managerSelectionSchema
          .parse(await read(f, "managers"))
          .items.some((x) => x.adminId === a.adminId),
      ).toBe(true);
    }),
  30000,
);
it(
  "T21 authorized different caller and full phone parent cannot reuse a valid signed cursor",
  () =>
    isolated(async (f) => {
      await reviewer(f);
      const reader = await f.actor(["settings", "sales"]),
        ownerRole = newId();
      await f.pool.query(
        "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,true,true,1)",
        [ownerRole, `Fictional owner ${ownerRole}`],
      );
      await f.pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'settings'),($1,'sales')",
        [ownerRole],
      );
      await f.pool.query(
        "UPDATE admin SET role_id=$2,version=version+1 WHERE id=$1",
        [reader.adminId, ownerRole],
      );
      const first = managerSelectionSchema.parse(
        await read(f, "managers", { limit: 1 }),
      );
      expect(first.nextCursor).not.toBeNull();
      await expect(
        read(
          f,
          "managers",
          { limit: 1, cursor: first.nextCursor },
          undefined,
          reader.token,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
      const ids = (
        await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
      ).rows.map((r) => r.attendant_id);
      await f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional parent scope",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [
          { label: "Fictional first", attendantIds: ids },
          { label: "Fictional second", attendantIds: ids },
        ],
      });
      await historicalSale(f.pool, { state: "received" });
      await historicalSale(f.pool, { state: "received" });
      const phones = phoneSelectionSchema.parse(await read(f, "phones"));
      const source = incompleteSelectionSchema.parse(
        await read(f, "incomplete-sources", { limit: 1 }, phones.items[0]!.id),
      );
      expect(source.nextCursor).not.toBeNull();
      await expect(
        read(
          f,
          "incomplete-sources",
          { limit: 1, cursor: source.nextCursor },
          phones.items[1]!.id,
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }),
  30000,
);
it(
  "T21 required historical labels fail closed rather than guessing or omitting an account",
  () =>
    isolated(async (f) => {
      await f.pool.query("UPDATE auth_user SET display_name=$2 WHERE id=$1", [
        fixtureId(3),
        "Fictional ".repeat(120),
      ]);
      await expect(read(f, "attendants")).rejects.toMatchObject({
        code: "temporarily_unavailable",
        status: 503,
      });
    }),
  30000,
);
it(
  "T21 photo fact for a different asset remains unbound to the selected accepted evidence",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, {});
      await relevant(f, s);
      const evidence = await observe(f, s.id);
      await f.pool.query(
        "UPDATE photo_asset SET state='validated',final_key=$2,validated_digest=expected_digest,validated_bytes=100,width=10,height=10,media_type='image/jpeg',validated_at=clock_timestamp() WHERE id=$1",
        [evidence.asset, `fictional/final/${evidence.asset}`],
      );
      await f.pool.query(
        "INSERT INTO photo_receipt_fact(asset_id,observation_id,purchase_id,receipt_at) SELECT asset_id,id,purchase_id,receipt_at FROM photo_receipt_observation WHERE id=$1",
        [evidence.observation],
      );
      const c = await checklist(f);
      expect(
        c.checks.find((x) => x.name === "complete_photo_deadline"),
      ).toMatchObject({
        blocking: "1",
        outcome: "unresolved",
        reasonCodes: ["photo_proof_unbound"],
      });
      expect(c.readiness.blockers).toContain("uploads_unresolved");
    }),
  30000,
);
it(
  "T21 all projection reads leave certification reconciliation preview snapshot and source tables unchanged",
  () =>
    isolated(async (f) => {
      await f.check();
      const prepared = await prepare(f),
        id = String(prepared.data.reconciliationId),
        phone = phoneSelectionSchema.parse(await read(f, "phones")).items[0]!;
      const state = async () =>
        (
          await f.pool.query(
            `SELECT (SELECT count(*) FROM audit_event)::text audits,(SELECT count(*) FROM mutation_receipt)::text receipts,(SELECT count(*) FROM giveaway_reconciliation)::text reconciliations,(SELECT count(*) FROM giveaway_preview)::text previews,(SELECT count(*) FROM giveaway_snapshot)::text snapshots,(SELECT count(*) FROM giveaway_phone_check)::text checks,(SELECT count(*) FROM giveaway_preview_consumption)::text consumed,(SELECT count(*) FROM purchase_revision)::text revisions,(SELECT count(*) FROM purchase)::text purchases,to_jsonb(c) campaign FROM campaign c WHERE id=$1`,
            [f.campaignId],
          )
        ).rows;
      const before = await state();
      for (const action of [
        "checklist",
        "managers",
        "attendants",
        "phones",
      ] as const)
        await read(f, action);
      await read(f, "results", {}, id);
      await read(f, "incomplete-sources", {}, phone.id);
      expect(await state()).toEqual(before);
    }),
  30000,
);
it(
  "T21 acceptance after source selection invalidates view and cannot be proposed as incomplete",
  () =>
    isolated(async (f) => {
      const s = await historicalSale(f.pool, { state: "photo_pending" });
      await f.check();
      const phone = phoneSelectionSchema.parse(await read(f, "phones"))
          .items[0]!,
        before = incompleteSelectionSchema.parse(
          await read(f, "incomplete-sources", {}, phone.id),
        );
      expect(before.items.some((x) => x.purchaseId === s.id)).toBe(true);
      const asset = newId(),
        revision = newId(),
        db = await f.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(
          "UPDATE purchase SET status='finalizing',version=version+1 WHERE id=$1",
          [s.id],
        );
        await db.query(
          "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '1 hour',$5,100)",
          [asset, s.id, newId(), `fictional/${asset}`, "a".repeat(64)],
        );
        await db.query(
          "UPDATE photo_asset SET state='validated',final_key=$2,validated_digest=expected_digest,validated_bytes=100,width=10,height=10,media_type='image/jpeg',validated_at=clock_timestamp() WHERE id=$1",
          [asset, `fictional/final/${asset}`],
        );
        await db.query(
          `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,kind,state,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,evidence_asset_id) SELECT $1,id,1,$2,$3,'fictional acceptance','original','proposed',clock_timestamp(),amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,$4 FROM purchase WHERE id=$5`,
          [revision, newId(), fixtureId(3), asset, s.id],
        );
        await db.query(
          "UPDATE purchase_revision SET state='accepted',decision_actor_id=$2,decision_reason='Fictional acceptance',decided_at=clock_timestamp() WHERE id=$1",
          [revision, fixtureId(3)],
        );
        await db.query(
          "UPDATE purchase SET status='credited',current_revision_id=$2,version=version+1 WHERE id=$1",
          [s.id, revision],
        );
        await db.query(
          "INSERT INTO sync_validation(purchase_id,policy_version,reasons,campaign_eligible) VALUES($1,2,'[]',false)",
          [s.id],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
      await expect(
        read(
          f,
          "incomplete-sources",
          { expectedView: before.view.viewToken },
          phone.id,
        ),
      ).rejects.toMatchObject({ code: "read_view_stale" });
      expect(
        incompleteSelectionSchema.parse(
          await read(f, "incomplete-sources", {}, phone.id),
        ).items,
      ).toEqual([]);
      await expect(propose(f, s.id)).rejects.toMatchObject({
        code: "exclusion_source_invalid",
      });
    }),
  30000,
);
it(
  "T21 required purchase accounts cannot lose assignment or identity through ordinary constrained writes",
  () =>
    isolated(async (f) => {
      await historicalSale(f.pool, { state: "received" });
      // The conservative purchase branch also protects older retained layouts. In this schema,
      // a purchase with no station assignment history cannot be produced through valid writes.
      await expect(
        seedHistorical(
          f.pool,
          "assignment",
          "DELETE FROM assignment WHERE attendant_id=$1",
          [fixtureId(6)],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        seedHistorical(
          f.pool,
          "auth_user",
          "DELETE FROM auth_user WHERE id=$1",
          [fixtureId(3)],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        f.pool.query("UPDATE auth_user SET display_name=NULL WHERE id=$1", [
          fixtureId(3),
        ]),
      ).rejects.toMatchObject({ code: "23502" });
      expect(
        attendantSelectionSchema
          .parse(await read(f, "attendants"))
          .items.some((x) => x.attendantId === fixtureId(6)),
      ).toBe(true);
    }),
  30000,
);
it(
  "T21 known valid foreign-schema campaign phone and stored result IDs return identical not_found",
  () =>
    isolated(async (f) => {
      const ownUrl = process.env.DATABASE_URL,
        other = await giveawayFixture();
      try {
        await other.check();
        const prepared = await prepare(other);
        const foreignPhone = phoneSelectionSchema.parse(
          await read(other, "phones"),
        ).items[0]!.id;
        await expect(
          readProjection(
            f.pool,
            config.secret,
            f.token,
            other.campaignId,
            "checklist",
          ),
        ).rejects.toMatchObject({ code: "not_found", status: 404 });
        await expect(
          read(f, "results", {}, String(prepared.data.reconciliationId)),
        ).rejects.toMatchObject({ code: "not_found", status: 404 });
        await expect(
          read(f, "incomplete-sources", {}, foreignPhone),
        ).rejects.toMatchObject({ code: "not_found", status: 404 });
        for (const action of ["results", "incomplete-sources"] as const)
          await expect(read(f, action, {}, newId())).rejects.toMatchObject({
            code: "not_found",
            status: 404,
          });
      } finally {
        await other.close();
        process.env.DATABASE_URL = ownUrl;
      }
    }),
  30000,
);
it(
  "T21 a single oversized retained result returns 413 over real HTTP without partial evidence",
  () =>
    isolated(async (f) => {
      await f.check();
      const p = await prepare(f),
        id = String(p.data.reconciliationId);
      await seedHistorical(
        f.pool,
        "giveaway_reconciliation",
        "UPDATE giveaway_reconciliation SET content=jsonb_set(content,'{checks,0,checked}',to_jsonb($2::text)) WHERE id=$1",
        [id, "1".repeat(33000)],
      );
      vi.resetModules();
      const { GET } =
        await import("../../src/app/api/admin/giveaway/[campaignId]/reconciliation/results/[reconciliationId]/route");
      const server = createServer(async (req, res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const result = await GET(
          new Request(
            config.origin +
              "/api/admin/giveaway/" +
              f.campaignId +
              "/reconciliation/results/" +
              id,
            { headers },
          ),
          {
            params: Promise.resolve({
              campaignId: f.campaignId,
              reconciliationId: id,
            }),
          },
        );
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(await result.text());
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw Error("No listener");
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
            headers: {
              cookie: `${COOKIE}=${f.token}`,
              "x-test-ip": "192.0.2.179",
            },
          }),
          body = await response.json();
        expect(response.status).toBe(413);
        expect(body).not.toHaveProperty("data");
        expect(body.error).toMatchObject({
          code: "request_too_large",
          retryable: false,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        const { database } = await import("../../src/server/lib/db");
        await database().end();
      }
    }),
  30000,
);
it(
  "T21 missing protected source digest cannot be serialized as a historical pass",
  () =>
    isolated(async (f) => {
      await f.check();
      const p = await prepare(f),
        id = String(p.data.reconciliationId);
      await seedHistorical(
        f.pool,
        "giveaway_reconciliation",
        "UPDATE giveaway_reconciliation SET content=content-'sourceDigest' WHERE id=$1",
        [id],
      );
      await expect(read(f, "results", {}, id)).rejects.toMatchObject({
        code: "temporarily_unavailable",
        status: 503,
      });
    }),
  30000,
);
it(
  "T21 mismatched retained actor binding cannot be serialized as a historical pass",
  () =>
    isolated(async (f) => {
      await f.check();
      const p = await prepare(f),
        id = String(p.data.reconciliationId),
        a = await reviewer(f);
      await seedHistorical(
        f.pool,
        "giveaway_reconciliation",
        "UPDATE giveaway_reconciliation SET content=jsonb_set(content,'{actorId}',to_jsonb($2::text)) WHERE id=$1",
        [id, a.adminId],
      );
      await expect(read(f, "results", {}, id)).rejects.toMatchObject({
        code: "temporarily_unavailable",
        status: 503,
      });
    }),
  30000,
);

it.each([
  [
    "invalid protected source digest",
    "jsonb_set(content,'{sourceDigest}','123'::jsonb)",
  ],
  [
    "unchanged outcome without predecessor",
    "jsonb_set(jsonb_set(content,'{outcome}','\"unchanged\"'::jsonb),'{previousSnapshotId}','null'::jsonb)",
  ],
  [
    "duplicate approved exclusion IDs",
    "jsonb_set(content,'{approvedExclusionIds}','[\"00000000-0000-7000-8000-000000000001\",\"00000000-0000-7000-8000-000000000001\"]'::jsonb)",
  ],
])(
  "T21 %s cannot be serialized as a historical pass",
  async (_name, expression) => {
    await isolated(async (f) => {
      await f.check();
      const prepared = await prepare(f),
        id = String(prepared.data.reconciliationId);
      await seedHistorical(
        f.pool,
        "giveaway_reconciliation",
        `UPDATE giveaway_reconciliation SET content=${expression} WHERE id=$1`,
        [id],
      );
      await expect(read(f, "results", {}, id)).rejects.toMatchObject({
        code: "temporarily_unavailable",
        status: 503,
      });
    });
  },
  30000,
);
it("T21 verified caller binding revoked while waiting for security lock denies inventory", async () => {
  await isolated(async (f) => {
    const db = await f.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
      const inserted = await db.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT $1,station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$2 ORDER BY version DESC LIMIT 1",
        [newId(), fixtureId(2)],
      );
      expect(inserted.rowCount).toBe(1);
      pending = read(f, "phones").then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await f.waitForLock("security_state");
      await db.query("COMMIT");
      expect(
        (
          await f.pool.query(
            "SELECT verified FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
            [fixtureId(2)],
          )
        ).rows[0].verified,
      ).toBe(false);
      expect(await pending).toMatchObject({
        error: { code: "independent_admin_required", status: 403 },
      });
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pending;
    }
  });
}, 30000);

it.each([
  ["missing", "content-'operationId'", "23502"],
  ["invalid", "jsonb_set(content,'{operationId}','123'::jsonb)", "22P02"],
])(
  "T21 %s protected operation ID is prevented by native generated-column constraints",
  async (_name, expression, code) => {
    await isolated(async (f) => {
      await f.check();
      const prepared = await prepare(f),
        id = String(prepared.data.reconciliationId);
      await expect(
        seedHistorical(
          f.pool,
          "giveaway_reconciliation",
          `UPDATE giveaway_reconciliation SET content=${expression} WHERE id=$1`,
          [id],
        ),
      ).rejects.toMatchObject({ code });
      expect(await read(f, "results", {}, id)).toMatchObject({ id });
    });
  },
  30000,
);
