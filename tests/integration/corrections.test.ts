import { readFile } from "node:fs/promises";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { digest } from "../../src/server/modules/auth/crypto";
import sharp from "sharp";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  handleCorrections,
  correctionStorage,
} from "../../src/server/modules/corrections/http";
import { COOKIE as ATTENDANT_COOKIE } from "../../src/server/modules/auth/http";
import { COOKIE as ADMIN_COOKIE } from "../../src/server/modules/admin-access/http";
import { database } from "../../src/server/lib/db";
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
async function fixture(held = false, sellerName?: string) {
  const f = await syncFixture(pool, jpeg);
  if (sellerName) {
    const id = newId();
    await pool.query(
      `INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) SELECT $1,attendant_id,assignment_id,signed_in_at,offline_expires_at,$3,seller_username,device_binding_digest FROM capture_context WHERE id=$2`,
      [id, f.original.captureContextId, sellerName],
    );
    f.original.captureContextId = id;
  }
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
async function resolvedPriceFixture() {
  const f = await fixture(true);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "UPDATE purchase_hold SET state='resolved',resolved_by=$2,resolution_operation_id=$3,resolution_reason='Trusted captured-price confirmation',resolved_at=clock_timestamp(),resolution_revision_id=$4,version=version+1 WHERE purchase_id=$1 AND kind='price' AND state='open'",
      [f.purchaseId, fixtureId(5), newId(), f.body.basedOnRevisionId],
    );
    await db.query(
      "UPDATE purchase SET status='credited',version=version+1 WHERE id=$1",
      [f.purchaseId],
    );
    await db.query("COMMIT");
    f.body.expectedVersion++;
    return f;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
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
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("BETTER_AUTH_URL", "https://corrections.example.test");
    vi.stubEnv("WHR_ENV", "test");
    // Disable only automatic scheduling; HTTP session, Origin, schema and service checks remain real.
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.spyOn(correctionStorage, "read").mockImplementation(storage.read);
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
  afterAll(async () => {
    await Promise.all([pool.end(), database().end()]);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
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
    const audit = (
      await pool.query(
        "SELECT operation_id,reason,before,after FROM audit_event WHERE id=$1",
        [decision.auditEventId],
      )
    ).rows[0];
    expect(audit.operation_id).toBe(decision.operationId);
    expect(audit.reason).toBe(decision.reason);
    expect(audit.before.amountKobo).toBe("2100000");
    expect(audit.after.amountKobo).toBe("2100000");
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
  it.each(["automatic", "late"] as const)(
    "a %s correction preserves a legitimately resolved price hold and its original history",
    async (kind) => {
      const f = await resolvedPriceFixture();
      let id: string;
      if (kind === "automatic") {
        const received = await svc.submit(f.token, f.purchaseId, f.body);
        id = received.data.id;
        await drain();
        expect((await pending(id)).state).toBe("accepted");
      } else {
        const c = await late(f);
        id = c.id;
        const result = await svc.decide(
          await adminToken(),
          f.purchaseId,
          c.id,
          await guard(f.purchaseId, c),
        );
        expect(result.creditedAfter).toBe(true);
      }
      const row = (
        await pool.query(
          "SELECT p.status,r.amount_kobo::text,s.reasons,(SELECT count(*)::int FROM purchase_revision WHERE purchase_id=p.id AND state='accepted') AS accepted FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id JOIN sync_validation s ON s.purchase_id=p.id WHERE p.id=$1",
          [f.purchaseId],
        )
      ).rows[0];
      expect(row).toEqual({
        status: "credited",
        amount_kobo: "3000000",
        reasons: ["price_uncertain"],
        accepted: 1,
      });
      expect((await pending(id)).state).toBe("accepted");
    },
  );
  it("correction audit records exact effective changes, actual operations and immutable executor/seller snapshots without private payloads", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE auth_user SET display_name='Grace +2348000000099 token=fictional-private-value' WHERE id=$1",
      [f.userId],
    );
    const received = await svc.submit(f.token, f.purchaseId, f.body);
    const intake = (
      await pool.query(
        "SELECT a.*,to_jsonb(a)->'actor_snapshot' AS actor_snapshot,to_jsonb(a)->'originating_seller_snapshot' AS originating_seller_snapshot FROM audit_event a WHERE target_id=$1 AND action='correction_received'",
        [f.purchaseId],
      )
    ).rows[0];
    expect(intake.reason).toBe(f.body.reason);
    expect(intake.before.amountKobo).toBe("2000000");
    expect(intake.after.amountKobo).toBe("2000000");
    expect(intake.actor_snapshot).toMatchObject({
      kind: "attendant",
      userId: f.userId,
    });
    expect(intake.originating_seller_snapshot).toMatchObject({
      attendantId: f.attendantId,
      accountId: f.userId,
    });
    await drain();
    const applied = (
      await pool.query(
        "SELECT a.*,to_jsonb(a)->'actor_snapshot' AS actor_snapshot,to_jsonb(a)->'originating_seller_snapshot' AS originating_seller_snapshot FROM audit_event a WHERE target_id=$1 AND action='correction_applied'",
        [f.purchaseId],
      )
    ).rows[0];
    expect(applied.reason).toBe(f.body.reason);
    expect(applied.operation_id).toBe(f.body.operationId);
    expect(applied.before.amountKobo).toBe("2000000");
    expect(applied.after.amountKobo).toBe("3000000");
    expect(applied.before.quantity).toBe("20");
    expect(applied.after.quantity).toBe("30");
    expect(applied.actor_user_id).toBeNull();
    expect(applied.actor_snapshot).toEqual({
      kind: "system",
      service: "validation",
      nameAtEvent: "Correction validation",
    });
    expect(applied.originating_seller_snapshot).toMatchObject({
      attendantId: f.attendantId,
      accountId: f.userId,
    });
    expect(JSON.stringify([intake, applied])).not.toMatch(
      /2348000000099|fictional-private-value|final\/|staging\/|https?:/,
    );
    expect((await pending(received.data.id)).state).toBe("accepted");
    const g = await fixture(),
      c = await late(g),
      body = await guard(g.purchaseId, c),
      decision = await svc.decide(await adminToken(), g.purchaseId, c.id, body);
    const event = (
      await pool.query(
        "SELECT a.*,to_jsonb(a)->'actor_snapshot' AS actor_snapshot,to_jsonb(a)->'originating_seller_snapshot' AS originating_seller_snapshot FROM audit_event a WHERE id=$1",
        [decision.auditEventId],
      )
    ).rows[0];
    expect(event.operation_id).toBe(body.operationId);
    expect(event.reason).toBe(body.reason);
    expect(event.before.amountKobo).toBe("2000000");
    expect(event.after.amountKobo).toBe("3000000");
    expect(event.actor_user_id).toBe(fixtureId(2));
    expect(event.actor_snapshot).toMatchObject({
      kind: "admin",
      userId: fixtureId(2),
      code: "ADMIN001",
      roleAtEvent: "Owner",
    });
    expect(event.originating_seller_snapshot).toMatchObject({
      accountId: g.userId,
    });
  });
  it.each([
    "Call +2348000000099",
    "token=fictional-private-value",
    "OTP: 123456",
    "OTP 123456",
    "token fictional-private-value",
    "Call 080****0099",
    "Receipt https://private.example.test/object",
  ])(
    "rejects private correction reason before audit persistence: %s",
    async (reason) => {
      const f = await fixture();
      await expect(
        svc.submit(f.token, f.purchaseId, { ...f.body, reason }),
      ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target_id=$1 AND action='correction_received'",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM correction_request WHERE purchase_id=$1",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      const c = await late(f);
      await expect(
        svc.decide(await adminToken(), f.purchaseId, c.id, {
          ...(await guard(f.purchaseId, c)),
          reason,
        }),
      ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target_id=$1 AND action IN ('correction_approved','correction_rejected')",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sale_decision WHERE purchase_id=$1",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect((await pending(c.id)).state).toBe("awaiting_review");
    },
  );
  it.each([
    "+234 800 000 0099",
    "+234.800.000.0099",
    "+1.(000).000.0000",
    "+1 (000) 000-0000",
    "+44 (0000) 000-000",
    "2348000000099",
    "+234 (800) 000-0099",
    "(+234)-800-000-0099",
    "+ 2 3 4 (8 0 0) 0 0 0-0 0 9 9",
    "+234 (0) 800 000 0099",
    "(080) 000-00099",
    "0 (8 0 0) 000 0099",
    "+234 (80*) ***-0099",
    "(080) ****-0099",
  ])(
    "HTTP rejects formatted phone in submit and decision without domain writes: %s",
    async (phone) => {
      const f = await fixture();
      const reason = `Call ${phone}`;
      const post = (
        action: "submit" | "decide",
        body: unknown,
        token: string,
        id?: string,
      ) =>
        handleCorrections(
          new Request(
            `https://corrections.example.test/api/${action === "submit" ? "attendant" : "admin"}/sales/${f.purchaseId}/corrections${id ? `/${id}/decision` : ""}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                Origin: "https://corrections.example.test",
                cookie: `${action === "submit" ? ATTENDANT_COOKIE : ADMIN_COOKIE}=${token}`,
              },
              body: JSON.stringify(body),
            },
          ),
          action,
          f.purchaseId,
          id,
        );
      const before = (
        await pool.query(
          "SELECT version,current_revision_id FROM purchase WHERE id=$1",
          [f.purchaseId],
        )
      ).rows[0];
      const response = await post("submit", { ...f.body, reason }, f.token);
      const text = await response.text();
      expect(response.status, text).toBe(400);
      expect(JSON.parse(text).error).toEqual({
        code: "invalid_request",
        message: "This request could not be completed.",
        retryable: false,
      });
      expect(text).not.toContain(phone);
      expect(
        (
          await pool.query(
            "SELECT version,current_revision_id FROM purchase WHERE id=$1",
            [f.purchaseId],
          )
        ).rows[0],
      ).toEqual(before);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM correction_request WHERE purchase_id=$1",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target_id=$1 AND action LIKE 'correction_%'",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      const c = await late(f),
        proposal = await pending(c.id),
        guardBefore = await guard(f.purchaseId, c);
      const rejected = await post(
        "decide",
        { ...guardBefore, reason },
        await adminToken(),
        c.id,
      );
      const error = await rejected.text();
      expect(rejected.status, error).toBe(400);
      expect(JSON.parse(error).error.code).toBe("invalid_request");
      expect(error).not.toContain(phone);
      expect(await pending(c.id)).toEqual(proposal);
      expect(await guard(f.purchaseId, c)).toMatchObject({
        expectedVersion: guardBefore.expectedVersion,
        expectedRevisionId: guardBefore.expectedRevisionId,
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sale_decision WHERE purchase_id=$1",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target_id=$1 AND action IN ('correction_approved','correction_rejected')",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it("HTTP accepts numeric operational reasons and redacts formatted phone actor and original seller snapshots", async () => {
    const phone = "+234.800.000.0099",
      f = await fixture(false, `Grace ${phone}`);
    await pool.query("UPDATE auth_user SET display_name=$2 WHERE id=$1", [
      f.userId,
      `Grace ${phone}`,
    ]);
    const input = {
      ...f.body,
      reason:
        "Correct 2 + 3 litres at pump 3; amount 3000000 kobo, quantity 30.00",
    };
    const response = await handleCorrections(
      new Request(
        `https://corrections.example.test/api/attendant/sales/${f.purchaseId}/corrections`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "https://corrections.example.test",
            cookie: `${ATTENDANT_COOKIE}=${f.token}`,
          },
          body: JSON.stringify(input),
        },
      ),
      "submit",
      f.purchaseId,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const received = await response.json();
    expect(received.data.reason).toBe(input.reason);
    await drain();
    const events = (
      await pool.query(
        "SELECT actor_snapshot,originating_seller_snapshot FROM audit_event WHERE target_id=$1 AND action LIKE 'correction_%' ORDER BY occurred_at",
        [f.purchaseId],
      )
    ).rows;
    expect(events[0].actor_snapshot.nameAtEvent).toBe("Grace [phone removed]");
    expect(events[0].originating_seller_snapshot.name).toBe(
      "Grace [phone removed]",
    );
    expect(JSON.stringify(events)).not.toContain(phone);
    const g = await fixture(),
      c = await late(g),
      body = {
        ...(await guard(g.purchaseId, c)),
        reason: "Confirmed 30 litres from 3000000 kobo at pump 3",
      };
    const decision = await handleCorrections(
      new Request(
        `https://corrections.example.test/api/admin/sales/${g.purchaseId}/corrections/${c.id}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "https://corrections.example.test",
            cookie: `${ADMIN_COOKIE}=${await adminToken()}`,
          },
          body: JSON.stringify(body),
        },
      ),
      "decide",
      g.purchaseId,
      c.id,
    );
    expect(decision.status, await decision.clone().text()).toBe(200);
    expect((await decision.json()).data.reason).toBe(body.reason);
  });
  it.each(["+234 800 000 0099", "+234 (800) 000-0099", "+234.800.000.0099"])(
    "HTTP decision independently rejects formatted phone with unchanged proposal: %s",
    async (phone) => {
      const f = await fixture(),
        c = await late(f),
        before = await pending(c.id),
        body = { ...(await guard(f.purchaseId, c)), reason: `Call ${phone}` };
      const response = await handleCorrections(
        new Request(
          `https://corrections.example.test/api/admin/sales/${f.purchaseId}/corrections/${c.id}/decision`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Origin: "https://corrections.example.test",
              cookie: `${ADMIN_COOKIE}=${await adminToken()}`,
            },
            body: JSON.stringify(body),
          },
        ),
        "decide",
        f.purchaseId,
        c.id,
      );
      const text = await response.text();
      expect(response.status, text).toBe(400);
      expect(JSON.parse(text).error).toEqual({
        code: "invalid_request",
        message: "This request could not be completed.",
        retryable: false,
      });
      expect(text).not.toContain(phone);
      expect(await pending(c.id)).toEqual(before);
      expect(
        (
          await pool.query(
            "SELECT version,current_revision_id FROM purchase WHERE id=$1",
            [f.purchaseId],
          )
        ).rows[0],
      ).toEqual({
        version: body.expectedVersion,
        current_revision_id: body.expectedRevisionId,
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sale_decision WHERE purchase_id=$1",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target_id=$1 AND action IN ('correction_approved','correction_rejected')",
            [f.purchaseId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
});
