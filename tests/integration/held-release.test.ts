import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { fixtureId } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";
import {
  releasePerson,
  requireIndependentReleasePerson,
} from "../../src/server/modules/reviews/release-people";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
const role = `held_release_test_${randomBytes(6).toString("hex")}`;
let station: string;
async function bind(
  user: string,
  person: string,
  version = 1,
  verified = true,
) {
  const id = newId();
  await db.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,$5,$6)",
    [id, station, user, person, version, verified],
  );
  return id;
}
describe("P-29 real-Postgres identity and retained history", () => {
  beforeAll(async () => {
    db = await evidenceDatabase();
    station = (await db.pool.query("SELECT id FROM station LIMIT 1")).rows[0]
      .id;
    await db.pool.query(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    const schema = (await db.pool.query("SELECT current_schema() name")).rows[0]
      .name as string;
    if (!/^evidence_[a-f0-9]+$/.test(schema))
      throw new Error("Disposable schema required");
    await db.pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await db.pool.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
    );
  }, 30000);
  afterAll(async () => {
    if (db) {
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.pool.query(`DROP ROLE ${role}`);
      await db.close();
    }
  });
  it("SR-03 unknown identity binding denies rather than trusting account separation", async () => {
    await expect(
      releasePerson(db.pool, station, fixtureId(2)),
    ).rejects.toMatchObject({ code: "independence_unverifiable", status: 403 });
  });
  it("SR-03 two accounts bound to the same person cannot approve one another", async () => {
    const person = newId();
    await db.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, station],
    );
    const users = (
      await db.pool.query("SELECT id FROM auth_user ORDER BY id LIMIT 2")
    ).rows.map((r) => r.id as string);
    await bind(users[0]!, person);
    await bind(users[1]!, person);
    await expect(
      requireIndependentReleasePerson(db.pool, station, users[0]!, [users[1]!]),
    ).rejects.toMatchObject({
      code: "independent_reviewer_required",
      status: 403,
    });
    await expect(
      requireIndependentReleasePerson(db.pool, newId(), users[0]!, [users[1]!]),
    ).rejects.toMatchObject({ code: "independence_unverifiable" });
  });
  it("SR-03 latest unverified binding denies without falling back to historical verification", async () => {
    const user = (
      await db.pool.query(
        "SELECT user_id,person_id FROM held_release_person_binding ORDER BY user_id LIMIT 1",
      )
    ).rows[0];
    await bind(user.user_id, user.person_id, 2, false);
    await expect(
      releasePerson(db.pool, station, user.user_id),
    ).rejects.toMatchObject({ code: "independence_unverifiable" });
  });
  it("SR-08 non-superuser cannot update or delete retained person-binding history", async () => {
    const client = await db.pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      expect(
        (
          await client.query(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0].rolsuper,
      ).toBe(false);
      await expect(
        client.query(
          "UPDATE held_release_person_binding SET verified=NOT verified",
        ),
      ).rejects.toThrow();
      await expect(
        client.query("DELETE FROM held_release_person_binding"),
      ).rejects.toThrow();
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  });
  it("SR-08 non-superuser cannot truncate retained person-binding history", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await expect(
        client.query("TRUNCATE held_release_person_binding"),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("P-29 structural boundary admission", () => {
  let database: Awaited<ReturnType<typeof evidenceDatabase>>;
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    database = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    await database?.close();
    vi.unstubAllEnvs();
  });
  it.each(["card", "price"] as const)(
    "SR-01 %s material boundary admits only its independently valid paper range",
    async (kind) => {
      const { heldReleaseFixture } =
        await import("../helpers/held-release-fixture");
      const { releaseProposalInputSchema } =
        await import("../../src/shared/contracts/held-release");
      const { classifyReleaseAdmission } =
        await import("../../src/server/modules/reviews/release-admission");
      const x = await heldReleaseFixture(database, kind);
      const body = releaseProposalInputSchema.parse({
        ...(await x.h.guard(x.sale.purchaseId)),
        target: x.target,
        outcome: "confirm",
        sheetAssetId: newId(),
        meterAssetId: x.sale.assetId,
        facts: x.facts,
      });
      const client = await database.pool.connect();
      try {
        await client.query("BEGIN");
        const admission = await classifyReleaseAdmission(
          client,
          x.sale.purchaseId,
          body,
        );
        expect(admission.boundaries.length).toBeGreaterThan(0);
        expect(admission.originalInterval.L).not.toEqual(
          admission.attestedInterval.L,
        );
        expect(admission.conclusions).toHaveLength(1);
        const disjoint = {
          ...body,
          facts: {
            ...body.facts,
            observedCapture: {
              ...body.facts.observedCapture,
              from: "2026-11-12T12:00:00.000Z",
              through: "2026-11-12T12:10:00.000Z",
            },
          },
        };
        await expect(
          classifyReleaseAdmission(client, x.sale.purchaseId, disjoint),
        ).rejects.toMatchObject({ code: "evidence_insufficient" });
      } finally {
        client.release();
      }
    },
  );
});
