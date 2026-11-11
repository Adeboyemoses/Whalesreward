import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import { ClientError, type OutboxRow } from "../types";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../tests/fixtures/attendant-client-fake";
import type { AttendantSalesApi, AttendantSaleDetail } from "../sales-api";
import type {
  AttendantCorrection,
  CorrectionSubmission,
} from "../../shared/contracts/sales";
import { numericCorrection, valuesDigest } from "./correction-values";
let now: number,
  online: boolean,
  auth: FakeAttendantApi,
  db: CaptureDatabase,
  client: AttendantClient;
let detail: AttendantSaleDetail;
class SalesFake implements AttendantSalesApi {
  sent: CorrectionSubmission[] = [];
  receipts = new Map<string, AttendantCorrection>();
  lost = false;
  reject: ClientError | null = null;
  held: Promise<void> | null = null;
  async list() {
    return { items: [detail], nextCursor: null };
  }
  async detail() {
    return structuredClone(detail);
  }
  async history() {
    return { items: [], nextCursor: null };
  }
  async photo() {
    return new Blob(["jpeg"], { type: "image/jpeg" });
  }
  async correction(_purchase: string, operation: string) {
    const found = this.receipts.get(operation);
    if (!found) throw new ClientError("not_found", "not found", 404);
    return structuredClone(found);
  }
  async submitCorrection(purchase: string, body: CorrectionSubmission) {
    this.sent.push(structuredClone(body));
    if (this.held) await this.held;
    if (this.reject) throw this.reject;
    const old = this.receipts.get(body.operationId);
    if (old) return structuredClone(old);
    const { values } = numericCorrection(
      detail.displayedValues,
      body.edit.basis === "amount"
        ? `${BigInt(body.edit.enteredAmountKobo) / 100n}.${(BigInt(body.edit.enteredAmountKobo) % 100n).toString().padStart(2, "0")}`
        : body.edit.enteredQuantity,
    );
    const r: AttendantCorrection = {
      id: v7(),
      purchaseId: purchase,
      operationId: body.operationId,
      version: 1,
      basedOnRevisionId: body.basedOnRevisionId,
      proposed: values,
      reason: body.reason,
      serverReceivedAt: new Date(now).toISOString(),
      cutoffAtReceipt: null,
      timing: "late",
      state: "awaiting_review",
      decidedAt: null,
      authorship: "authenticated_attendant",
      policyBlocks: [],
    };
    this.receipts.set(body.operationId, r);
    if (this.lost) {
      this.lost = false;
      throw new ClientError("network_unavailable", "lost");
    }
    return structuredClone(r);
  }
}
let sales: SalesFake;
const open: AttendantClient[] = [];
beforeEach(async () => {
  now = Date.parse("2026-11-11T10:00:00Z");
  online = true;
  auth = new FakeAttendantApi(sessionFixture(now));
  sales = new SalesFake();
  db = new CaptureDatabase("corrections-" + v7());
  client = new AttendantClient(
    auth,
    db,
    () => ({ wall: now, mono: now, runtimeId: "test" }),
    () => online,
    () => online,
    sales,
  );
  open.push(client);
  await client.initialize();
  await client.signIn("grace.okon", "fictional");
  const s = auth.current;
  const values = {
    amountKobo: "2000000",
    quantity: "20",
    currency: "NGN" as const,
    unit: "litre" as const,
    basis: "amount" as const,
    enteredAmountKobo: "2000000",
    enteredQuantity: null,
    rateKobo: "100000",
    priceVersionId: s.price.priceVersionId,
    quantityPrecision: 3,
    medium: "vehicle" as const,
    calculation: "captured_rate" as const,
    verifiedSaleDate: null,
  };
  detail = {
    id: v7(),
    operationId: v7(),
    saleCode: "S001",
    version: 2,
    customer: {
      id: v7(),
      customerCode: "C001",
      name: "Amina Bello",
      category: "car_owner",
    },
    capturedCardCode: "A7K3M9X",
    seller: {
      attendantId: s.account.id,
      accountId: v7(),
      staffCode: s.account.staffCode,
      name: s.account.name,
      username: s.account.username,
    },
    station: { id: s.station.id, code: s.station.code },
    pump: s.pump,
    product: "pms",
    appCapturedAt: s.serverTime,
    serverReceivedAt: s.serverTime,
    verifiedSaleDate: null,
    state: "credited",
    credited: true,
    currentRevisionId: v7(),
    displayedValues: values,
    displayedSource: "accepted_revision",
    holds: [],
    policyBlocks: [],
    duplicateFlag: false,
    correctionPending: false,
    original: values,
    evidence: {
      assetId: v7(),
      state: "validated",
      sha256: "a".repeat(64),
      validatedAt: s.serverTime,
    },
    correctionWindow: { cutoff: null, automaticEligible: true, reason: "open" },
    revisions: [],
    corrections: [],
    decisions: [],
    historyCursors: { revisions: null, corrections: null, decisions: null },
  };
});
afterEach(async () => {
  for (const c of open) c.close();
  open.length = 0;
  await db.delete();
});
async function saveLocal() {
  const draft = await client.beginCapture();
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  return client.saveCapture(draft, {
    cardCode: "A7K3M9X",
    customerCache: await client.lookup("A7K3M9X"),
    medium: "vehicle",
    basis: "amount",
    value: "20000",
    photo: { blob, sha256, bytes: blob.size, mediaType: "image/jpeg" },
  });
}
async function acceptedLocal(row: OutboxRow) {
  detail = {
    ...detail,
    operationId: row.operationId,
    evidence: { ...detail.evidence, sha256: row.photoDigest },
  };
  await db.outbox.update([auth.current.account.id, row.operationId], {
    state: "credited",
    purchaseId: detail.id,
    serverVersion: detail.version,
    serverStatus: {
      purchaseId: detail.id,
      operationId: row.operationId,
      saleCode: detail.saleCode,
      version: detail.version,
      state: "credited",
      detailsReceived: true,
      photoValidated: true,
      credited: true,
      currentRevisionId: detail.currentRevisionId,
      customer: null,
      holds: [],
      cancellationReason: null,
      pendingReason: null,
      serverReceivedAt: detail.serverReceivedAt,
    },
  });
}
describe("separate durable numeric corrections", () => {
  it("uses the own attendant profile ID with a distinct auth-user ID and preserves exact frozen values", async () => {
    const saved = await client.saveCorrection({
      source: { kind: "server", detail },
      value: "20000.01",
      reason: "Meter amount entered incorrectly",
    });
    expect(detail.seller.attendantId).toBe(auth.current.account.id);
    expect(detail.seller.accountId).not.toBe(auth.current.account.id);
    expect(saved.operationId).not.toBe(detail.operationId);
    expect(saved.edit).toEqual({
      basis: "amount",
      enteredAmountKobo: "2000001",
    });
    expect(saved.baseValuesDigest).toBe(
      await valuesDigest(detail.displayedValues),
    );
    expect(saved.submission?.basedOnRevisionId).toBe(detail.currentRevisionId);
    expect(await db.outbox.count()).toBe(0);
    expect(detail.displayedValues.amountKobo).toBe("2000000");
    expect(await client.ownCorrections()).toHaveLength(1);
  });
  it("allows only one pending local correction even with simultaneous save calls", async () => {
    const input = {
      source: { kind: "server" as const, detail },
      value: "21000",
      reason: "Meter amount",
    };
    const results = await Promise.allSettled([
      client.saveCorrection(input),
      client.saveCorrection(input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.corrections.count()).toBe(1);
  });
  it("waits for the original then binds only a matching accepted revision and retained photo", async () => {
    const row = await saveLocal();
    const correction = await client.saveCorrection({
      source: { kind: "local", operationId: row.operationId },
      value: "21000",
      reason: "Meter amount",
    });
    expect(correction.state).toBe("waiting_original");
    expect(correction.submission).toBeNull();
    await client.retryUploads();
    expect(sales.sent).toHaveLength(0);
    await acceptedLocal(row);
    now += 70000;
    await client.retryUploads();
    const stored = (await client.ownCorrections())[0]!;
    expect(stored.submission?.basedOnRevisionId).toBe(detail.currentRevisionId);
    expect(stored.serverCorrection?.state).toBe("awaiting_review");
    expect((await client.ownSale(row.operationId))!.original).toEqual(
      row.original,
    );
  });
  it("retains a changed original base for attention without rebasing or posting", async () => {
    const row = await saveLocal();
    await client.saveCorrection({
      source: { kind: "local", operationId: row.operationId },
      value: "21000",
      reason: "Meter amount",
    });
    await acceptedLocal(row);
    detail.displayedValues = {
      ...detail.displayedValues,
      amountKobo: "1900000",
      enteredAmountKobo: "1900000",
      quantity: "19",
    };
    await client.retryUploads();
    const stored = (await client.ownCorrections())[0]!;
    expect(stored.state).toBe("needs_attention");
    expect(stored.lastErrorCode).toBe("base_revision_changed");
    expect(stored.submission).toBeNull();
    expect(sales.sent).toHaveLength(0);
  });
  it("refuses a foreign accepted original even when its auth-user ID equals the local profile ID", async () => {
    const original = await saveLocal();
    await client.saveCorrection({
      source: { kind: "local", operationId: original.operationId },
      value: "21000",
      reason: "Meter amount",
    });
    await acceptedLocal(original);
    detail.seller = {
      ...detail.seller,
      attendantId: v7(),
      accountId: auth.current.account.id,
    };
    await client.retryUploads();
    expect(sales.sent).toHaveLength(0);
    expect((await client.ownCorrections())[0]!.submission).toBeNull();
    expect((await client.ownCorrections())[0]!.lastErrorCode).toBe(
      "invalid_response",
    );
  });
  it("reconciles a lost success response after restart with the same operation and no second POST", async () => {
    sales.lost = true;
    const saved = await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    await client.retryUploads();
    expect((await client.ownCorrections())[0]!.serverCorrection).toBeNull();
    now += 70000;
    const second = new AttendantClient(
      auth,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono: now, runtimeId: "restart" }),
      () => online,
      () => online,
      sales,
    );
    open.push(second);
    await second.initialize();
    await second.retryUploads();
    expect(sales.sent).toHaveLength(1);
    const stored = (await second.ownCorrections())[0]!;
    expect(stored.serverCorrection?.operationId).toBe(saved.operationId);
    expect(stored.state).toBe("awaiting_review");
    expect(stored.submission).toEqual(saved.submission);
  });
  it("polls pending validation and review to a terminal server outcome without another POST", async () => {
    const saved = await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    await client.retryUploads();
    const receipt = sales.receipts.get(saved.operationId)!;
    sales.receipts.set(saved.operationId, {
      ...receipt,
      version: 2,
      state: "pending_validation",
    });
    now += 31000;
    await client.retryUploads();
    expect((await client.ownCorrections())[0]!.state).toBe(
      "pending_validation",
    );
    sales.receipts.set(saved.operationId, {
      ...receipt,
      version: 3,
      state: "accepted",
      decidedAt: new Date(now).toISOString(),
    });
    now += 2100;
    await client.retryUploads();
    expect((await client.ownCorrections())[0]!.state).toBe("accepted");
    expect(sales.sent).toHaveLength(1);
  });
  it("retries a transient first-send failure with the exact frozen body despite newer sale versions", async () => {
    const saved = await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    sales.reject = new ClientError("temporarily_unavailable", "temporary", 503);
    await client.retryUploads();
    detail.version = 20;
    sales.reject = null;
    now += 70000;
    await client.retryUploads();
    expect(sales.sent).toHaveLength(2);
    expect(sales.sent[0]).toEqual(saved.submission);
    expect(sales.sent[1]).toEqual(saved.submission);
    expect((await client.ownCorrections())[0]!.state).toBe("awaiting_review");
  });
  it("never changes frozen guards on a definitive stale base rejection", async () => {
    const saved = await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    sales.reject = new ClientError("base_revision_changed", "changed", 409);
    detail.version++;
    await client.retryUploads();
    expect((await client.ownCorrections())[0]!.submission).toEqual(
      saved.submission,
    );
    expect((await client.ownCorrections())[0]!.state).toBe("needs_attention");
    expect(sales.sent[0]?.expectedVersion).toBe(2);
  });
  it("rejects foreign ownership, missing evidence, meter bases, blank reason and unchanged values", async () => {
    const save = (d = detail, value = "21000", reason = "Meter amount") =>
      client.saveCorrection({
        source: { kind: "server", detail: d },
        value,
        reason,
      });
    await expect(
      save({
        ...detail,
        seller: {
          ...detail.seller,
          attendantId: v7(),
          accountId: auth.current.account.id,
        },
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      save({ ...detail, evidence: { ...detail.evidence, state: "deleted" } }),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    await expect(
      save({
        ...detail,
        displayedValues: {
          ...detail.displayedValues,
          calculation: "meter_evidence",
        },
      }),
    ).rejects.toMatchObject({ code: "sale_not_correctable" });
    await expect(save(detail, "21000", "  ")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(save(detail, "20000")).rejects.toMatchObject({
      code: "no_change",
    });
  });
  it("hides the previous account's corrections and never sends them under the next account", async () => {
    await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    const original = auth.current;
    await client.signOut();
    auth.current = sessionFixture(now);
    await client.signIn("favour.james", "fictional");
    expect(await client.ownCorrections()).toEqual([]);
    await client.retryUploads();
    expect(sales.sent).toHaveLength(0);
    await client.signOut();
    auth.current = original;
    await client.signIn("grace.okon", "fictional");
    expect(await client.ownCorrections()).toHaveLength(1);
  });
  it("fences a delayed correction response when another tab signs out", async () => {
    let release!: () => void;
    sales.held = new Promise<void>((r) => (release = r));
    await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    const running = client.retryUploads();
    await expect.poll(() => sales.sent.length).toBe(1);
    const other = new AttendantClient(
      auth,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono: now, runtimeId: "other" }),
      () => online,
      () => online,
      sales,
    );
    open.push(other);
    await other.initialize();
    await other.signOut();
    release();
    await running;
    expect((await db.corrections.toArray())[0]!.serverCorrection).toBeNull();
    expect(await client.ownCorrections()).toEqual([]);
  });
  it("pauses save and uploads at 24 hours while preserving the saved correction", async () => {
    await client.saveCorrection({
      source: { kind: "server", detail },
      value: "21000",
      reason: "Meter amount",
    });
    now += 86400000;
    await client.retryUploads();
    expect(sales.sent).toHaveLength(0);
    await expect(
      client.saveCorrection({
        source: { kind: "server", detail },
        value: "22000",
        reason: "Meter amount",
      }),
    ).rejects.toMatchObject({ code: "access_expired" });
    expect(await client.ownCorrections()).toHaveLength(1);
  });
  it("uses exact quantity rounding and refuses excess recorded precision", () => {
    const base = {
      ...detail.displayedValues,
      basis: "quantity" as const,
      enteredAmountKobo: null,
      enteredQuantity: "20",
    };
    expect(numericCorrection(base, "20.001").values.amountKobo).toBe("2000100");
    expect(() => numericCorrection(base, "20.0001")).toThrow();
  });
  it("upgrades a populated v1 database without losing original rows or photos", async () => {
    const name = "upgrade-" + v7();
    const old = new Dexie(name);
    old.version(1).stores({
      outbox:
        "[originatingAccountId+operationId],[originatingAccountId+state],[originatingAccountId+nextAttemptAt]",
      windows: "originatingAccountId",
      customers: "[originatingAccountId+cardCode]",
      meta: "key",
    });
    const row = await saveLocal();
    await old.table("outbox").put(row);
    await old
      .table("meta")
      .put({ key: "installation", activeAccountId: auth.current.account.id });
    old.close();
    const upgraded = new CaptureDatabase(name);
    try {
      expect((await upgraded.outbox.toArray())[0]?.photoBlob.size).toBe(
        row.photoBlob.size,
      );
      expect(await upgraded.corrections.count()).toBe(0);
      expect(await upgraded.meta.get("installation")).toMatchObject({
        activeAccountId: auth.current.account.id,
      });
    } finally {
      await upgraded.delete();
    }
  });
});
