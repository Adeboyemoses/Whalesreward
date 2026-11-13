import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  barrier,
  correctionsFixture,
} from "../helpers/corrections-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import type { CorrectionSubmission } from "../../src/shared/contracts/sales";

describe("M3 independent PostgreSQL correction adversaries", () => {
  let f: Awaited<ReturnType<typeof correctionsFixture>>;
  let service: ReturnType<typeof createCorrectionsService>;
  beforeAll(async () => {
    f = await correctionsFixture();
    service = createCorrectionsService({ pool: f.pool, storage: f.storage });
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  const historical = {
    signedInAt: "2026-11-09T10:00:00Z",
    receivedAt: "2026-11-09T11:00:00Z",
  };
  function submission(
    sale: Awaited<ReturnType<typeof f.sale>>,
    edit: CorrectionSubmission["edit"] = {
      basis: "amount",
      enteredAmountKobo: "3000001",
    },
  ): CorrectionSubmission {
    return {
      operationId: newId(),
      expectedVersion: sale.version,
      basedOnRevisionId: sale.revisionId,
      edit,
      evidenceAssetId: sale.photoId,
      reason: "Correct a fictional entered value",
    };
  }

  it.each([
    ["2026-11-09T22:59:59.999Z", "before_midnight", "accepted", "3000001"],
    ["2026-11-09T23:00:00.000Z", "late", "awaiting_review", "2000000"],
  ])(
    "I-37 durable receipt %s decides the exact Lagos midnight boundary",
    async (receivedAt, timing, state, amount) => {
      const sale = await f.sale(undefined, historical);
      const input = submission(sale);
      const receipt = await f.atReceipt(
        "correction_request",
        sale.purchaseId,
        receivedAt,
        () => service.submit(sale.token, sale.purchaseId, input),
      );
      expect(receipt.data.serverReceivedAt).toBe(receivedAt);
      expect(receipt.data.timing).toBe(timing);
      expect(receipt.data.cutoffAtReceipt).toBe("2026-11-09T23:00:00.000Z");
      await service.processNext();
      const result = await service.byOperation(
        sale.token,
        sale.purchaseId,
        input.operationId,
      );
      expect(result.state).toBe(state);
      expect(result.timing).toBe(timing);
      expect(await f.snapshot(sale.purchaseId)).toMatchObject({
        amount,
        original_amount: "2000000",
        accepted_count: 1,
        transaction_count: 1,
        evidence_asset_id: sale.photoId,
        rate: "100000",
      });
      const replay = await f.atReceipt(
        "correction_request",
        sale.purchaseId,
        "2026-11-10T23:00:00.000Z",
        () => service.submit(sale.token, sale.purchaseId, input),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.data).toEqual(receipt.data);
      const events = (
        await f.pool.query(
          "SELECT * FROM audit_event WHERE target_id=$1 AND action LIKE 'correction_%' ORDER BY occurred_at,id",
          [sale.purchaseId],
        )
      ).rows;
      expect(events.map((e) => e.action)).toEqual(
        state === "accepted"
          ? ["correction_received", "correction_applied"]
          : ["correction_received"],
      );
      expect(events[0].before).toMatchObject({
        amountKobo: "2000000",
        calculation: "captured_rate",
        credited: true,
        correctionState: null,
      });
      expect(events[0].after).toMatchObject({
        amountKobo: "2000000",
        calculation: "captured_rate",
        credited: true,
        correctionState: "pending_validation",
      });
      if (state === "accepted") {
        expect(events[1].actor_snapshot).toMatchObject({
          kind: "system",
          service: "validation",
        });
        expect(events[1].after).toMatchObject({
          amountKobo: amount,
          calculation: "captured_rate",
          credited: true,
        });
      }
      expect(
        (
          await service.byOperation(
            sale.token,
            sale.purchaseId,
            input.operationId,
          )
        ).serverReceivedAt,
      ).toBe(receivedAt);
    },
  );

  it("I-22/I-39 two devices racing one purchase reserve one proposal and preserve the original", async () => {
    const sale = await f.sale(undefined, historical);
    const inputs = [submission(sale), submission(sale)];
    const results = await Promise.all(
      inputs.map(async (input) => {
        try {
          return {
            ok: true as const,
            result: await service.submit(sale.token, sale.purchaseId, input),
          };
        } catch (error) {
          return { ok: false as const, error };
        }
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(
      (results.find((r) => !r.ok) as { error: unknown }).error,
    ).toMatchObject({ status: 409 });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM correction_request WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      original_amount: "2000000",
      transaction_count: 1,
    });
    await service.processNext();
  });

  it("I-22 same correction operation with changed content conflicts before stale version checks", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    await service.submit(sale.token, sale.purchaseId, input);
    await expect(
      service.submit(sale.token, sale.purchaseId, {
        ...input,
        edit: { basis: "amount", enteredAmountKobo: "3000002" },
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    await service.processNext();
  });

  it("I-29 correction above 2^53 keeps exact kobo and captured rate while original remains immutable", async () => {
    const sale = await f.sale(undefined, historical);
    const before = await f.snapshot(sale.purchaseId);
    const input = submission(sale, {
      basis: "amount",
      enteredAmountKobo: "9007199254740993",
    });
    await f.atReceipt(
      "correction_request",
      sale.purchaseId,
      "2026-11-09T22:59:59.999Z",
      () => service.submit(sale.token, sale.purchaseId, input),
    );
    await service.processNext();
    const result = await service.byOperation(
      sale.token,
      sale.purchaseId,
      input.operationId,
    );
    expect(result.state).toBe("accepted");
    expect(result.proposed).toMatchObject({
      amountKobo: "9007199254740993",
      enteredAmountKobo: "9007199254740993",
      quantity: "90071992547.41",
      rateKobo: "100000",
      quantityPrecision: 2,
      priceVersionId: sale.priceId,
    });
    const after = await f.snapshot(sale.purchaseId);
    expect(after).toMatchObject({
      amount: "9007199254740993",
      quantity: "90071992547.410000",
      original_amount: before.original_amount,
      original_quantity: before.original_quantity,
      price_version_id: before.price_version_id,
      expected_photo_digest: before.expected_photo_digest,
      accepted_count: 1,
      transaction_count: 1,
      evidence_asset_id: sale.photoId,
    });
  });

  it.each([
    [2, "1.10", "110006"],
    [3, "1.101", "110106"],
  ] as const)(
    "I-29 quantity correction retains precision %i and rounds money once",
    async (precision, quantity, amount) => {
      const sale = await f.sale(async (source) => {
        const priceId = newId();
        await f.pool.query(
          "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,'019a5000-0000-7000-8000-000000000009',2,100005,'NGN',$3,$4,'019a5000-0000-7000-8000-000000000005','Fictional precise quantity price')",
          [
            priceId,
            source.stationId,
            precision,
            new Date(source.start.getTime() - 30_000),
          ],
        );
        source.original.priceVersionId = priceId;
        source.original.rateKobo = "100005";
        source.original.quantityPrecision = precision;
        source.original.entry = {
          basis: "quantity",
          enteredQuantity: "1",
          quantity: "1",
          amountKobo: "100005",
        };
      }, historical);
      const input = submission(sale, {
        basis: "quantity",
        enteredQuantity: quantity,
      });
      await f.atReceipt(
        "correction_request",
        sale.purchaseId,
        "2026-11-09T22:59:59.999Z",
        () => service.submit(sale.token, sale.purchaseId, input),
      );
      await service.processNext();
      const result = await service.byOperation(
        sale.token,
        sale.purchaseId,
        input.operationId,
      );
      expect(result.state).toBe("accepted");
      expect(result.proposed).toMatchObject({
        basis: "quantity",
        amountKobo: amount,
        enteredQuantity: quantity.replace(/0$/, ""),
        rateKobo: "100005",
        quantityPrecision: precision,
      });
      expect(await f.snapshot(sale.purchaseId)).toMatchObject({
        amount,
        original_amount: "100005",
        accepted_count: 1,
        transaction_count: 1,
      });
      const current = await f.snapshot(sale.purchaseId);
      await expect(
        service.submit(sale.token, sale.purchaseId, {
          ...submission(sale),
          operationId: newId(),
          expectedVersion: current.version,
          basedOnRevisionId: current.revision_id,
          edit: { basis: "amount", enteredAmountKobo: "100006" },
        }),
      ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    },
  );

  it("I-37/I-38 a long offline original with a cross-day capture interval cannot reopen automatic correction", async () => {
    const sale = await f.sale(
      async (source) => {
        source.original.appCapturedAt = "2026-11-09T10:59:59Z";
      },
      {
        signedInAt: "2026-11-08T22:00:00Z",
        receivedAt: "2026-11-09T11:00:00Z",
      },
    );
    expect(sale.status.state).toBe("credited");
    const input = submission(sale);
    const receipt = await f.atReceipt(
      "correction_request",
      sale.purchaseId,
      "2026-11-09T11:01:00.000Z",
      () => service.submit(sale.token, sale.purchaseId, input),
    );
    expect(receipt.data.timing).toBe("unresolved");
    expect(receipt.data.cutoffAtReceipt).toBeNull();
    await service.processNext();
    expect(
      (
        await service.byOperation(
          sale.token,
          sale.purchaseId,
          input.operationId,
        )
      ).state,
    ).toBe("awaiting_review");
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      original_amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
    const frozen = (
      await f.pool.query(
        "SELECT correction_cutoff_at,correction_date_reliable,correction_time_policy_version FROM purchase WHERE id=$1",
        [sale.purchaseId],
      )
    ).rows[0];
    expect(frozen.correction_cutoff_at).toBeNull();
    expect(frozen.correction_date_reliable).toBe(false);
    expect(frozen.correction_time_policy_version).toBeTruthy();
    await expect(
      f.pool.query(
        "UPDATE purchase SET correction_cutoff_at='2026-11-10T23:00:00Z',correction_date_reliable=true,version=version+1 WHERE id=$1",
        [sale.purchaseId],
      ),
    ).rejects.toThrow("correction clock frozen");
    expect(
      (
        await service.byOperation(
          sale.token,
          sale.purchaseId,
          input.operationId,
        )
      ).timing,
    ).toBe("unresolved");
  });

  it("I-39 stale purchase and foreign base guards cannot create correction history", async () => {
    const sale = await f.sale(undefined, historical);
    const other = await f.sale(undefined, historical);
    await expect(
      service.submit(sale.token, sale.purchaseId, {
        ...submission(sale),
        expectedVersion: sale.version - 1,
      }),
    ).rejects.toMatchObject({ code: "version_conflict", status: 409 });
    // M3's common object rule deliberately hides foreign revision ownership.
    await expect(
      service.submit(sale.token, sale.purchaseId, {
        ...submission(sale),
        basedOnRevisionId: other.revisionId,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM correction_request WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
  });

  it("I-09 revocation during slow evidence validation fences the worker and terminates its proposal", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    await f.atReceipt(
      "correction_request",
      sale.purchaseId,
      "2026-11-09T22:59:59.999Z",
      () => service.submit(sale.token, sale.purchaseId, input),
    );
    const gate = barrier();
    f.onRead(() => gate.pause());
    const processing = service.processNext();
    try {
      await gate.entered;
      await f.pool.query(
        "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
        [sale.sessionId],
      );
    } finally {
      f.onRead();
      gate.release();
    }
    await processing;
    const row = (
      await f.pool.query(
        "SELECT state,validation_error FROM correction_request WHERE operation_id=$1",
        [input.operationId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      state: "rejected",
      validation_error: "authority_lost",
    });
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      original_amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
  });

  it("I-52 an expired worker lease can restart without allowing the stale worker to replace credit", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    const submitted = await f.atReceipt(
      "correction_request",
      sale.purchaseId,
      "2026-11-09T22:59:59.999Z",
      () => service.submit(sale.token, sale.purchaseId, input),
    );
    const gate = barrier();
    f.onRead(() => gate.pause());
    const stale = service.processNext();
    try {
      await gate.entered;
      await f.pool.query(
        "UPDATE correction_request SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [submitted.data.id],
      );
      f.onRead();
      const restarted = createCorrectionsService({
        pool: f.pool,
        storage: f.storage,
      });
      expect(await restarted.processNext()).toBe(true);
    } finally {
      f.onRead();
      gate.release();
    }
    const beforeStale = await f.snapshot(sale.purchaseId);
    await stale;
    expect(await f.snapshot(sale.purchaseId)).toEqual(beforeStale);
    expect(beforeStale).toMatchObject({
      amount: "3000001",
      accepted_count: 1,
      transaction_count: 1,
    });
    expect(
      (
        await service.byOperation(
          sale.token,
          sale.purchaseId,
          input.operationId,
        )
      ).state,
    ).toBe("accepted");
  });

  it("I-52 a fifth-attempt crash with an expired lease reaches a durable terminal result", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    const submitted = await service.submit(sale.token, sale.purchaseId, input);
    // Legal durable crash boundary: the fifth claim committed, but its process died.
    await f.pool.query(
      "UPDATE correction_request SET attempts=5,lease_token=$2,lease_until=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [submitted.data.id, newId()],
    );
    const restarted = createCorrectionsService({
      pool: f.pool,
      storage: f.storage,
    });
    expect(await restarted.processNext()).toBe(true);
    const terminal = (
      await f.pool.query(
        "SELECT state,validation_error,attempts,lease_token FROM correction_request WHERE id=$1",
        [submitted.data.id],
      )
    ).rows[0];
    expect(terminal.state).toBe("rejected");
    expect(terminal.validation_error).toBeTruthy();
    expect(terminal.attempts).toBe(5);
    expect(terminal.lease_token).toBeNull();
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      original_amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
    expect(await restarted.processNext()).toBe(false);
  });

  it("I-52 lost storage configuration settles bounded durable work without a status GET", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    const submitted = await service.submit(sale.token, sale.purchaseId, input);
    const unconfigured = createCorrectionsService({
      pool: f.pool,
      storage: {
        ...f.storage,
        async read() {
          throw new Error("Storage configuration unavailable");
        },
      },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await f.pool.query(
        "UPDATE correction_request SET next_attempt_at=clock_timestamp() WHERE id=$1",
        [submitted.data.id],
      );
      expect(await unconfigured.processNext()).toBe(true);
      expect(await f.snapshot(sale.purchaseId)).toMatchObject({
        amount: "2000000",
        accepted_count: 1,
        transaction_count: 1,
      });
    }
    const row = (
      await f.pool.query(
        "SELECT state,validation_error,attempts,first_received_at,decided_by_user_id FROM correction_request WHERE id=$1",
        [submitted.data.id],
      )
    ).rows[0];
    expect(row).toMatchObject({
      state: "rejected",
      validation_error: "evidence_unavailable",
      attempts: 5,
      decided_by_user_id: null,
    });
    expect(row.first_received_at.toISOString()).toBe(
      submitted.data.serverReceivedAt,
    );
    expect(await unconfigured.processNext()).toBe(false);
  });

  it("I-46 a later accepted correction marks reconciliation and leaves the finalized snapshot byte-identical", async () => {
    const campaignId = newId(),
      settingsId = newId(),
      snapshotId = newId();
    const sale = await f.sale(async (source) => {
      await f.pool.query(
        "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional correction campaign',1,false)",
        [campaignId, source.stationId],
      );
      await f.pool.query(
        "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,'2026-11-09T09:00:00Z','2026-11-09T11:01:00Z','2026-11-09T11:05:00Z','Africa/Lagos','2026-11-09T09:00:00Z','019a5000-0000-7000-8000-000000000005','Fictional campaign policy')",
        [settingsId, source.stationId, campaignId],
      );
    }, historical);
    expect(sale.status.state).toBe("credited");
    expect(
      (
        await f.pool.query(
          "SELECT campaign_eligible FROM sync_validation WHERE purchase_id=$1",
          [sale.purchaseId],
        )
      ).rows[0].campaign_eligible,
    ).toBe(true);
    // Trusted finalized M4 history; this suite tests later correction, not finalization intake.
    await f.pool.query(
      "INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,operation_id,actor_id,reason,tie_rule,finalized_at) VALUES($1,$2,$3,1,$4,'019a5000-0000-7000-8000-000000000005','Fictional finalized history','competition','2026-11-09T11:10:00Z')",
      [snapshotId, campaignId, settingsId, newId()],
    );
    await f.pool.query(
      "INSERT INTO giveaway_snapshot_source(id,snapshot_id,purchase_id,revision_id,included) VALUES($1,$2,$3,$4,true)",
      [newId(), snapshotId, sale.purchaseId, sale.revisionId],
    );
    await f.pool.query(
      "INSERT INTO giveaway_snapshot_row(id,snapshot_id,customer_id,category,qualifying_spend_kobo,currency,transaction_count,overall_rank,category_rank) VALUES($1,$2,'019a5000-0000-7000-8000-000000000026','car_owner',2000000,'NGN',1,1,1)",
      [newId(), snapshotId],
    );
    const frozen = async () =>
      (
        await f.pool.query(
          "SELECT row_to_json(s)::text AS snapshot,(SELECT json_agg(r ORDER BY r.id)::text FROM giveaway_snapshot_row r WHERE snapshot_id=s.id) AS rows,(SELECT json_agg(x ORDER BY x.id)::text FROM giveaway_snapshot_source x WHERE snapshot_id=s.id) AS sources FROM giveaway_snapshot s WHERE id=$1",
          [snapshotId],
        )
      ).rows[0];
    const before = await frozen();
    await f.atReceipt(
      "correction_request",
      sale.purchaseId,
      "2026-11-09T22:59:59.999Z",
      () => service.submit(sale.token, sale.purchaseId, submission(sale)),
    );
    await service.processNext();
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "3000001",
      accepted_count: 1,
      transaction_count: 1,
    });
    expect(await frozen()).toEqual(before);
    expect(
      (
        await f.pool.query(
          "SELECT reconciliation_required FROM campaign WHERE id=$1",
          [campaignId],
        )
      ).rows[0].reconciliation_required,
    ).toBe(true);
  });

  it.each(["approve", "reject"] as const)(
    "P-19 %s requires both grants and an independent reviewer without rewriting authorship",
    async (outcome) => {
      const sale = await f.sale(undefined, historical);
      const executor = await f.actor(["sales", "corrections"]);
      const authorizer = await f.actor(["sales", "corrections"]);
      const reviewer = await f.actor(["sales", "corrections"]);
      const salesOnly = await f.actor(["sales"]);
      const correctionsOnly = await f.actor(["corrections"]);
      expect(executor.adminId).not.toBe(executor.userId);
      expect(authorizer.adminId).not.toBe(authorizer.userId);
      const recovered = await f.recovered(sale, executor, authorizer);
      const input = {
        operationId: newId(),
        expectedVersion: recovered.purchaseVersion,
        expectedRevisionId: sale.revisionId,
        expectedCorrectionVersion: recovered.version,
        outcome,
        reason: "Independent review of the fictional recovered proposal",
      };
      for (const forbidden of [
        executor,
        authorizer,
        salesOnly,
        correctionsOnly,
      ])
        await expect(
          service.decide(
            forbidden.token,
            sale.purchaseId,
            recovered.correctionId,
            input,
          ),
        ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      const before = await f.snapshot(sale.purchaseId);
      expect(before).toMatchObject({ amount: "2000000", transaction_count: 1 });
      const result = await service.decide(
        reviewer.token,
        sale.purchaseId,
        recovered.correctionId,
        input,
      );
      expect(result).toMatchObject({
        outcome,
        creditedAfter: true,
        actor: { id: reviewer.adminId },
        before: { amountKobo: "2000000" },
        after: { amountKobo: outcome === "approve" ? "3000000" : "2000000" },
      });
      const provenance = (
        await f.pool.query(
          "SELECT state,authorship,verified_author_attendant_id,submitted_by_user_id,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,first_received_at FROM correction_request WHERE id=$1",
          [recovered.correctionId],
        )
      ).rows[0];
      expect(provenance).toMatchObject({
        state: outcome === "approve" ? "accepted" : "rejected",
        authorship: "unverified_recovery",
        verified_author_attendant_id: null,
        submitted_by_user_id: executor.userId,
        recovery_executor_id: executor.adminId,
        recovery_authorizing_admin_id: authorizer.adminId,
        policy_blocks: [],
      });
      expect(provenance.first_received_at.toISOString()).toBe(
        "2026-11-09T22:59:59.999Z",
      );
      expect(
        await service.decide(
          reviewer.token,
          sale.purchaseId,
          recovered.correctionId,
          input,
        ),
      ).toEqual(result);
      for (const forbidden of [executor, authorizer])
        await expect(
          service.decide(
            forbidden.token,
            sale.purchaseId,
            recovered.correctionId,
            input,
          ),
        ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='corrections'",
        [reviewer.roleId],
      );
      await expect(
        service.decide(
          reviewer.token,
          sale.purchaseId,
          recovered.correctionId,
          input,
        ),
      ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
      expect(await f.snapshot(sale.purchaseId)).toMatchObject({
        amount: outcome === "approve" ? "3000000" : "2000000",
        original_amount: "2000000",
        accepted_count: 1,
        transaction_count: 1,
      });
    },
  );

  it("I-09/P-19 a reviewer losing a grant during photo I/O cannot approve or consume the proposal", async () => {
    const sale = await f.sale(undefined, historical);
    const executor = await f.actor(["sales", "corrections"]),
      authorizer = await f.actor(["sales", "corrections"]),
      reviewer = await f.actor(["sales", "corrections"]);
    const recovered = await f.recovered(sale, executor, authorizer);
    const input = {
      operationId: newId(),
      expectedVersion: recovered.purchaseVersion,
      expectedRevisionId: sale.revisionId,
      expectedCorrectionVersion: 1,
      outcome: "approve",
      reason: "Fictional independent review",
    };
    const gate = barrier();
    f.onRead(() => gate.pause());
    const deciding = service.decide(
      reviewer.token,
      sale.purchaseId,
      recovered.correctionId,
      input,
    );
    // Attach the rejection handler before releasing the barrier.
    const denied = expect(deciding).rejects.toMatchObject({
      code: "permission_denied",
      status: 403,
    });
    try {
      await gate.entered;
      await f.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='corrections'",
        [reviewer.roleId],
      );
    } finally {
      f.onRead();
      gate.release();
    }
    await denied;
    expect(
      (
        await f.pool.query(
          "SELECT state,policy_blocks FROM correction_request WHERE id=$1",
          [recovered.correctionId],
        )
      ).rows[0],
    ).toEqual({
      state: "awaiting_review",
      policy_blocks: ["correction_authorship_unverified"],
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM sale_decision WHERE correction_id=$1",
          [recovered.correctionId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
  });

  it("I-39 two independent reviewers racing approve and reject commit one decision", async () => {
    const sale = await f.sale(undefined, historical);
    const executor = await f.actor(["sales", "corrections"]),
      authorizer = await f.actor(["sales", "corrections"]);
    const reviewers = [
      await f.actor(["sales", "corrections"]),
      await f.actor(["sales", "corrections"]),
    ];
    const recovered = await f.recovered(sale, executor, authorizer);
    const results = await Promise.all(
      reviewers.map(async (reviewer, index) => {
        try {
          return {
            ok: true as const,
            result: await service.decide(
              reviewer.token,
              sale.purchaseId,
              recovered.correctionId,
              {
                operationId: newId(),
                expectedVersion: recovered.purchaseVersion,
                expectedRevisionId: sale.revisionId,
                expectedCorrectionVersion: 1,
                outcome: index ? "reject" : "approve",
                reason: "Fictional independent competing review",
              },
            ),
          };
        } catch (error) {
          return { ok: false as const, error };
        }
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(
      (results.find((r) => !r.ok) as { error: unknown }).error,
    ).toMatchObject({ status: 409 });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM sale_decision WHERE correction_id=$1",
          [recovered.correctionId],
        )
      ).rows[0].count,
    ).toBe(1);
    const winner = results.find((r) => r.ok)!;
    if (!winner.ok) throw new Error("Expected one committed decision");
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      amount: winner.result.after.amountKobo,
      original_amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
  });

  it("I-39 cancellation while evidence is in flight closes the proposal and prevents worker credit", async () => {
    const sale = await f.sale(undefined, historical);
    const input = submission(sale);
    await service.submit(sale.token, sale.purchaseId, input);
    const gate = barrier();
    f.onRead(() => gate.pause());
    const processing = service.processNext();
    try {
      await gate.entered;
      await f.pool.query(
        "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional independently authorized cancellation',version=version+1 WHERE id=$1",
        [sale.purchaseId],
      );
    } finally {
      f.onRead();
      gate.release();
    }
    await processing;
    expect(
      (
        await service.byOperation(
          sale.token,
          sale.purchaseId,
          input.operationId,
        )
      ).state,
    ).toBe("rejected");
    expect(await f.snapshot(sale.purchaseId)).toMatchObject({
      status: "cancelled",
      amount: "2000000",
      original_amount: "2000000",
      transaction_count: 0,
    });
    await expect(
      service.submit(sale.token, sale.purchaseId, {
        ...input,
        operationId: newId(),
      }),
    ).rejects.toMatchObject({ code: "sale_not_correctable", status: 409 });
  });

  it("I-29/I-41 accepted original money, captured rate and photo binding are immutable", async () => {
    const sale = await f.sale();
    expect(sale.status.state).toBe("credited");
    const before = await f.snapshot(sale.purchaseId);
    for (const assignment of [
      "amount_kobo=amount_kobo+1",
      "rate_kobo=rate_kobo+1",
      "expected_photo_digest=repeat('b',64)",
    ])
      await expect(
        f.pool.query(`UPDATE purchase SET ${assignment} WHERE id=$1`, [
          sale.purchaseId,
        ]),
      ).rejects.toThrow();
    expect(await f.snapshot(sale.purchaseId)).toEqual(before);
    expect(before).toMatchObject({
      amount: "2000000",
      original_amount: "2000000",
      accepted_count: 1,
      transaction_count: 1,
    });
  });

  it("I-25 accepted evidence cannot be rebound to another purchase", async () => {
    const first = await f.sale();
    const second = await f.sale();
    const before = await f.snapshot(first.purchaseId);
    await expect(
      f.pool.query(
        "UPDATE purchase_revision SET evidence_asset_id=$2 WHERE id=$1",
        [first.revisionId, second.photoId],
      ),
    ).rejects.toThrow();
    expect(await f.snapshot(first.purchaseId)).toEqual(before);
    expect(before.evidence_asset_id).toBe(first.photoId);
  });
});
