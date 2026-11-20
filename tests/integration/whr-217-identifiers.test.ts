import { expect, it } from "vitest";
import { authId } from "../../src/shared/contracts/auth";
import { newId } from "../../src/server/lib/ids";
import { giveawayFixture } from "../helpers/giveaway-fixture";

it("WHR-217 deferred supersession generates canonical audit and transition UUIDv7 without changing proposal links", async () => {
  const f = await giveawayFixture();
  try {
    await f.check();
    const c = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const proposal = await f.phones.propose(
      f.token,
      f.campaignId,
      c.content.phones[0].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional unavailable phone",
        ...(await f.guard()),
        expectedCensusVersion: c.version,
        expectedPhoneVersion: 1,
        partialSources: [],
      },
    );
    const original = (
      await f.pool.query(
        "SELECT to_jsonb(e)::text value FROM giveaway_phone_exclusion e WHERE id=$1",
        [proposal.exclusion.id],
      )
    ).rows[0].value;
    await f.phones.census(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional replacement census",
      ...(await f.guard()),
      expectedCensusVersion: c.version,
      phones: c.content.phones.map(
        (p: { id: string; label: string; attendantIds: string[] }) => ({
          id: p.id,
          label: p.label,
          attendantIds: p.attendantIds,
        }),
      ),
    });
    const transition = (
      await f.pool.query(
        "SELECT * FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
        [proposal.exclusion.id],
      )
    ).rows[0];
    expect(transition.state).toBe("superseded");
    expect(authId.safeParse(transition.id).success).toBe(true);
    expect(authId.safeParse(transition.content.auditEventId).success).toBe(
      true,
    );
    const audit = (
      await f.pool.query("SELECT * FROM audit_event WHERE id=$1", [
        transition.content.auditEventId,
      ])
    ).rows[0];
    expect(audit.related_event_ids).toContain(proposal.exclusion.auditEventId);
    expect(audit.correlation_id).toBe(audit.id);
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(e)::text value FROM giveaway_phone_exclusion e WHERE id=$1",
          [proposal.exclusion.id],
        )
      ).rows[0].value,
    ).toBe(original);
  } finally {
    await f.close();
  }
}, 30000);

it("WHR-217 SQL UUIDv7 generator sets Unix milliseconds, version and variant with unique random payloads", async () => {
  const f = await giveawayFixture();
  try {
    const before = Date.now();
    const rows = (
      await f.pool.query<{ id: string }>(
        "SELECT whr_uuid_v7()::text id FROM generate_series(1,1024)",
      )
    ).rows;
    const after = Date.now();
    expect(new Set(rows.map((r) => r.id)).size).toBe(1024);
    for (const { id } of rows) {
      expect(authId.safeParse(id).success).toBe(true);
      const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
      expect(ms).toBeGreaterThanOrEqual(before - 1000);
      expect(ms).toBeLessThanOrEqual(after + 1000);
    }
  } finally {
    await f.close();
  }
}, 30000);

it("WHR-217 legacy preflight refuses real historical supersession and preserves immutable audit, exclusion and transition links byte-for-byte", async () => {
  const f = await giveawayFixture();
  try {
    const { readFile } = await import("node:fs/promises");
    const old = await readFile(
      new URL(
        "../../prisma/migrations/20261116071000_giveaway_reconciliation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const start = old.indexOf("CREATE FUNCTION supersede_phone_exclusions()");
    const end = old.indexOf(
      "CREATE CONSTRAINT TRIGGER phone_exclusion_pin_supersession",
      start,
    );
    // Reinstall the exact deployed function, then remove the additive helper to
    // reproduce the pre-upgrade database without rewriting any fixture IDs.
    await f.pool.query(
      old
        .slice(start, end)
        .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
    );
    await f.pool.query("DROP FUNCTION whr_uuid_v7()");
    await f.check();
    const c = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const p = await f.phones.propose(
      f.token,
      f.campaignId,
      c.content.phones[0].id,
      {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional historical unavailable phone",
        ...(await f.guard()),
        expectedCensusVersion: c.version,
        expectedPhoneVersion: 1,
        partialSources: [],
      },
    );
    await f.phones.census(f.token, f.campaignId, {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional historical replacement census",
      ...(await f.guard()),
      expectedCensusVersion: c.version,
      phones: c.content.phones.map(
        (p: { id: string; label: string; attendantIds: string[] }) => ({
          id: p.id,
          label: p.label,
          attendantIds: p.attendantIds,
        }),
      ),
    });
    const transition = (
      await f.pool.query(
        "SELECT * FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
        [p.exclusion.id],
      )
    ).rows[0];
    expect(transition.id[14]).toBe("4");
    expect(transition.content.auditEventId[14]).toBe("4");
    const audit = (
      await f.pool.query("SELECT * FROM audit_event WHERE id=$1", [
        transition.content.auditEventId,
      ])
    ).rows[0];
    expect(audit.related_event_ids).toContain(p.exclusion.auditEventId);
    async function originalRows() {
      return (
        await f.pool.query(`SELECT
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)::text FROM giveaway_phone_exclusion e) exclusions,
        (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM giveaway_phone_exclusion_transition t) transitions,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)::text FROM audit_event a) audits`)
      ).rows[0];
    }
    const before = await originalRows();
    const originalFunction = (
      await f.pool.query(
        "SELECT pg_get_functiondef('supersede_phone_exclusions()'::regprocedure) body",
      )
    ).rows[0].body;
    const migration = await readFile(
      new URL(
        "../../prisma/migrations/20261120140000_canonical_uuid_v7/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const db = await f.pool.connect();
    try {
      await expect(db.query(migration)).rejects.toMatchObject({
        code: "23514",
        message:
          "WHR-217 legacy identifiers require a reviewed preservation migration",
        detail:
          "supersession_audits=1 exclusion_transitions=1 validation_blocks=0",
      });
      await db.query("ROLLBACK");
      expect(
        (
          await db.query(
            "SELECT to_regprocedure(format('%I.whr_uuid_v7()',current_schema())) AS fn",
          )
        ).rows[0].fn,
      ).toBeNull();
      expect(
        (
          await db.query(
            "SELECT pg_get_functiondef('supersede_phone_exclusions()'::regprocedure) body",
          )
        ).rows[0].body,
      ).toBe(originalFunction);
    } finally {
      db.release();
    }
    expect(await originalRows()).toEqual(before);
  } finally {
    await f.close();
  }
}, 30000);

it("WHR-217 legacy validation-block IDs are explicitly counted and never rewritten", async () => {
  const f = await giveawayFixture();
  try {
    const { historicalSale } =
      await import("../helpers/cards-adversarial-fixture");
    const { readFile } = await import("node:fs/promises");
    const sale = await historicalSale(f.pool, {});
    const legacyId = "00000000-0000-4000-8000-000000000217";
    await f.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_authorization_unresolved','p20-1',clock_timestamp(),1)",
      [legacyId, sale.id],
    );
    const before = (
      await f.pool.query(
        "SELECT to_jsonb(b)::text body FROM purchase_validation_block b WHERE id=$1",
        [legacyId],
      )
    ).rows[0].body;
    const migration = await readFile(
      new URL(
        "../../prisma/migrations/20261120140000_canonical_uuid_v7/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const db = await f.pool.connect();
    try {
      await expect(db.query(migration)).rejects.toMatchObject({
        code: "23514",
        detail:
          "supersession_audits=0 exclusion_transitions=0 validation_blocks=1",
      });
      await db.query("ROLLBACK");
    } finally {
      db.release();
    }
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(b)::text body FROM purchase_validation_block b WHERE id=$1",
          [legacyId],
        )
      ).rows[0].body,
    ).toBe(before);
  } finally {
    await f.close();
  }
}, 30000);
