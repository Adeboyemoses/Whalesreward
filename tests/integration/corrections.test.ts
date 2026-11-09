import { readFile } from "node:fs/promises";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { digest } from "../../src/server/modules/auth/crypto";
import sharp from "sharp";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { newId } from "../../src/server/lib/ids";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { syncFixture, fixtureId, changePrice } from "../helpers/sync-fixture";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
const objects = new Map<string, Buffer>();
const storage: EvidenceStorage = {
  async signPut(key) {
    return { url: key, headers: {} };
  },
  async read(key) {
    const b = objects.get(key);
    if (!b) throw new Error("missing");
    return b;
  },
  async writeFinal(key, bytes) {
    objects.set(key, bytes);
  },
};
const sync = createSyncService({ pool, storage }),
  svc = createCorrectionsService({ pool, storage });
let jpeg: Buffer;
async function fixture(held = false) {
  const f = await syncFixture(pool, jpeg);
  if (held) await changePrice(pool, f);
  const s = await sync.submit(f.token, f.original);
  const u = await sync.uploadPermission(f.token, s.status.purchaseId, {
    operationId: newId(),
    ...f.original.photo,
  });
  const a = (
    await pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
      u.uploadId,
    ])
  ).rows[0];
  objects.set(a.staging_key, jpeg);
  const done = await sync.finalize(f.token, s.status.purchaseId, {
    operationId: newId(),
    expectedVersion: s.status.version,
    uploadId: u.uploadId,
  });
  if (held) {
    const r = (
      await pool.query(
        "SELECT id FROM purchase_revision WHERE purchase_id=$1",
        [done.purchaseId],
      )
    ).rows[0];
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "UPDATE purchase_revision SET state='accepted',version=version+1,decision_actor_id=$2,decision_reason='Trusted prior review fixture',decided_at=clock_timestamp() WHERE id=$1",
        [r.id, f.userId],
      );
      await db.query(
        "UPDATE purchase SET current_revision_id=$2,version=version+1 WHERE id=$1",
        [done.purchaseId, r.id],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    done.currentRevisionId = r.id;
    done.version++;
  }
  return {
    ...f,
    purchaseId: done.purchaseId,
    body: {
      operationId: newId(),
      expectedVersion: done.version,
      basedOnRevisionId: done.currentRevisionId!,
      edit: { basis: "amount" as const, enteredAmountKobo: "3000000" },
      evidenceAssetId: u.uploadId,
      reason: "Corrected meter amount",
    },
  };
}
async function pending(id: string) {
  return (
    await pool.query("SELECT * FROM correction_request WHERE id=$1", [id])
  ).rows[0];
}
async function drain() {
  for (let i = 0; i < 25 && (await svc.processNext()); i++);
}
async function adminToken() {
  await pool.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [fixtureId(2)],
  );
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
    [newId(), fixtureId(2), digest(token)],
  );
  return token;
}
async function late(f: Awaited<ReturnType<typeof fixture>>) {
  const name = `test_primary_receipt_${newId().replaceAll("-", "")}`;
  await pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purchase_id::text=TG_ARGV[0] THEN NEW.first_received_at=NEW.cutoff_at_receipt; END IF; RETURN NEW; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON correction_request FOR EACH ROW EXECUTE FUNCTION ${name}('${f.purchaseId}')`,
  );
  try {
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    await drain();
    return await svc.byOperation(
      f.token,
      f.purchaseId,
      result.data.operationId,
    );
  } finally {
    await pool.query(`DROP TRIGGER ${name} ON correction_request`);
    await pool.query(`DROP FUNCTION ${name}()`);
  }
}
async function guard(
  purchaseId: string,
  c: { version: number },
  outcome: "approve" | "reject" = "approve",
) {
  const p = (
    await pool.query(
      "SELECT version,current_revision_id FROM purchase WHERE id=$1",
      [purchaseId],
    )
  ).rows[0];
  return {
    operationId: newId(),
    expectedVersion: p.version,
    expectedRevisionId: p.current_revision_id,
    expectedCorrectionVersion: c.version,
    outcome,
    reason: "Independent correction review",
  };
}
async function interveningRevision(
  f: Awaited<ReturnType<typeof fixture>>,
  candidate = false,
) {
  const id = newId(),
    db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (!candidate)
      await db.query(
        "UPDATE purchase_revision SET state='superseded',version=version+1 WHERE id=$1",
        [f.body.basedOnRevisionId],
      );
    await db.query(
      `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,decision_actor_id,decision_reason,decided_at) SELECT $1,purchase_id,(SELECT max(revision_number)+1 FROM purchase_revision WHERE purchase_id=$2),$3,$4,payload_digest,id,'admin_correction',$5,'Trusted intervening review fixture',clock_timestamp(),amount_kobo+100000,quantity+1,currency,unit,quantity_precision,basis,entered_amount_kobo+100000,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,$4,'Trusted intervening review fixture',clock_timestamp() FROM purchase_revision WHERE id=$6`,
      [
        id,
        f.purchaseId,
        newId(),
        fixtureId(2),
        candidate ? "proposed" : "accepted",
        f.body.basedOnRevisionId,
      ],
    );
    await db.query(
      `UPDATE purchase SET ${candidate ? "resolution_candidate_revision_id" : "current_revision_id"}=$2,version=version+1 WHERE id=$1`,
      [f.purchaseId, id],
    );
    await db.query("COMMIT");
    return id;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
describe("M3 durable own correction processing", () => {
  beforeAll(async () => {
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
  });
  afterAll(() => pool.end());
  it("reserves receipt and base, then replaces one accepted contribution without rewriting original", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    expect(result.data.state).toBe("pending_validation");
    await drain();
    const c = await svc.byOperation(f.token, f.purchaseId, f.body.operationId);
    expect(c.state).toBe("accepted");
    expect(c.serverReceivedAt).toBe(result.data.serverReceivedAt);
    const p = (
      await pool.query(
        "SELECT p.amount_kobo::text AS original,r.amount_kobo::text AS effective,(SELECT count(*)::int FROM purchase_revision WHERE purchase_id=p.id AND state='accepted') AS count FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1",
        [f.purchaseId],
      )
    ).rows[0];
    expect(p).toEqual({ original: "2000000", effective: "3000000", count: 1 });
    expect((await svc.submit(f.token, f.purchaseId, f.body)).data).toEqual(
      result.data,
    );
  });
  it("same operation changed material content conflicts before stale version; another pending edit cannot replace it", async () => {
    const f = await fixture();
    await svc.submit(f.token, f.purchaseId, f.body);
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        reason: "Different reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        operationId: newId(),
        expectedVersion: f.body.expectedVersion + 1,
      }),
    ).rejects.toMatchObject({ code: "correction_pending" });
    await drain();
  });
  it("rejects unsupported basis changes, replacement evidence and fake recovery provenance", async () => {
    const f = await fixture();
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        edit: { basis: "quantity", enteredQuantity: "30" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        evidenceAssetId: newId(),
      }),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        authorship: "authenticated_attendant",
      }),
    ).rejects.toThrow();
  });
  it("unavailable retained bytes preserve receipt and original then terminalize after bounded failures", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    const a = (
      await pool.query("SELECT final_key FROM photo_asset WHERE id=$1", [
        f.body.evidenceAssetId,
      ])
    ).rows[0];
    objects.delete(a.final_key);
    for (let i = 0; i < 5; i++) {
      await pool.query(
        "UPDATE correction_request SET next_attempt_at=clock_timestamp() WHERE id=$1",
        [result.data.id],
      );
      await drain();
    }
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "evidence_unavailable",
    });
    expect(
      (await svc.byOperation(f.token, f.purchaseId, f.body.operationId))
        .serverReceivedAt,
    ).toBe(result.data.serverReceivedAt);
    expect(
      (
        await pool.query(
          "SELECT amount_kobo::text FROM purchase_revision WHERE id=(SELECT current_revision_id FROM purchase WHERE id=$1)",
          [f.purchaseId],
        )
      ).rows[0].amount_kobo,
    ).toBe("2000000");
  });
  it("rechecks live authority after slow evidence read and does not revive a revoked session", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    const slow = createCorrectionsService({
      pool,
      storage: {
        ...storage,
        async read(key, max) {
          const bytes = await storage.read(key, max);
          await pool.query(
            "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
            [f.sessionId],
          );
          return bytes;
        },
      },
    });
    expect(await slow.processNext()).toBe(true);
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "authority_lost",
      decided_by_user_id: null,
    });
  });
  it("expired exhausted claim is rejected without inventing a reviewer, and cancellation closes pending causally", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    await pool.query(
      "UPDATE correction_request SET attempts=5,lease_token=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [result.data.id, newId()],
    );
    await drain();
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "validation_exhausted",
      decided_by_user_id: null,
    });
    const g = await fixture();
    const c = await svc.submit(g.token, g.purchaseId, g.body);
    await pool.query(
      "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation',version=version+1 WHERE id=$1",
      [g.purchaseId],
    );
    expect(await pending(c.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "sale_cancelled",
      decided_by_user_id: null,
    });
  });
  it("late review approval and lost-response replay replace the contribution exactly once", async () => {
    const f = await fixture(),
      c = await late(f),
      token = await adminToken();
    expect(c.state).toBe("awaiting_review");
    const body = await guard(f.purchaseId, c);
    const decision = await svc.decide(token, f.purchaseId, c.id, body);
    expect(decision.creditedAfter).toBe(true);
    expect(decision.after.amountKobo).toBe("3000000");
    expect(await svc.decide(token, f.purchaseId, c.id, body)).toEqual(decision);
    await expect(
      svc.decide(token, f.purchaseId, c.id, {
        ...body,
        reason: "Changed review reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [f.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("rejects a stale-base proposal with current guards while preserving the intervening accepted revision", async () => {
    const f = await fixture(),
      c = await late(f),
      token = await adminToken();
    const newer = await interveningRevision(f);
    await expect(
      svc.decide(token, f.purchaseId, c.id, await guard(f.purchaseId, c)),
    ).rejects.toMatchObject({ code: "base_revision_changed" });
    const decision = await svc.decide(
      token,
      f.purchaseId,
      c.id,
      await guard(f.purchaseId, c, "reject"),
    );
    expect(decision.appliedRevisionId).toBe(newer);
    expect(decision.before.amountKobo).toBe("2100000");
    expect(decision.after).toEqual(decision.before);
    expect((await pending(c.id)).state).toBe("rejected");
  });
  it("never overwrites a staged resolution candidate; stale proposal rejection leaves it intact", async () => {
    const f = await fixture(),
      c = await late(f),
      token = await adminToken();
    const candidate = await interveningRevision(f, true);
    await expect(
      svc.decide(token, f.purchaseId, c.id, await guard(f.purchaseId, c)),
    ).rejects.toMatchObject({ code: "base_revision_changed" });
    await svc.decide(
      token,
      f.purchaseId,
      c.id,
      await guard(f.purchaseId, c, "reject"),
    );
    expect(
      (
        await pool.query(
          "SELECT current_revision_id,resolution_candidate_revision_id FROM purchase WHERE id=$1",
          [f.purchaseId],
        )
      ).rows[0],
    ).toEqual({
      current_revision_id: f.body.basedOnRevisionId,
      resolution_candidate_revision_id: candidate,
    });
  });
  it("numeric approval preserves unrelated price hold and zero contribution with its historical validation", async () => {
    const f = await fixture(true),
      c = await late(f),
      token = await adminToken();
    const before = (
      await pool.query(
        "SELECT id FROM purchase_hold WHERE purchase_id=$1 AND state='open'",
        [f.purchaseId],
      )
    ).rows;
    const result = await svc.decide(
      token,
      f.purchaseId,
      c.id,
      await guard(f.purchaseId, c),
    );
    expect(result.creditedAfter).toBe(false);
    expect(result.remainingHolds.map((h) => h.id)).toEqual(
      before.map((h) => h.id),
    );
    expect(result.after.amountKobo).toBe("3000000");
    expect(
      (
        await pool.query(
          "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
          [f.purchaseId],
        )
      ).rows[0].reasons,
    ).toContain("price_uncertain");
  });
});
