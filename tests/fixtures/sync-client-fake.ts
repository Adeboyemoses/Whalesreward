import { v7 as uuidv7 } from "uuid";
import { FakeAttendantApi } from "./attendant-client-fake";
import {
  ClientError,
  type SaleStatus,
  type OriginalSale,
  type SyncResult,
  type UploadPermissionRequest,
  type UploadPermission,
  type FinalizeRequest,
} from "../../src/client/types";
/** Test-only server model: credit changes solely in finalize, never PUT. */
export class SyncClientFake extends FakeAttendantApi {
  originals = new Map<string, OriginalSale>();
  statuses = new Map<string, SaleStatus>();
  permissions = new Map<string, UploadPermission>();
  permissionKeys: string[] = [];
  finalizeBodies: FinalizeRequest[] = [];
  calls: string[] = [];
  loseSubmit = false;
  loseFinalize = false;
  failPut = false;
  expirePermission = false;
  throttle: number | null = null;
  finalizeHeld = false;
  beforeSubmit: (() => Promise<void>) | null = null;
  beforePut: (() => Promise<void>) | null = null;
  statusResult(s: SaleStatus): SyncResult {
    return { status: structuredClone(s), retryAfterMs: null };
  }
  override async submitSale(original: OriginalSale): Promise<SyncResult> {
    this.calls.push("submit");
    await this.beforeSubmit?.();
    if (this.throttle)
      throw new ClientError("rate_limited", "Wait", 429, this.throttle, true);
    let status = this.statuses.get(original.operationId);
    if (!status) {
      this.originals.set(original.operationId, structuredClone(original));
      status = {
        purchaseId: uuidv7(),
        operationId: original.operationId,
        saleCode: "S001",
        version: 1,
        state: "photo_pending",
        detailsReceived: true,
        photoValidated: false,
        credited: false,
        currentRevisionId: null,
        customer: { id: uuidv7(), name: "Amina Bello", category: "car_owner" },
        holds: [],
        cancellationReason: null,
        pendingReason: "photo_required",
        serverReceivedAt: this.current.serverTime,
      };
      this.statuses.set(original.operationId, status);
    }
    if (this.loseSubmit) {
      this.loseSubmit = false;
      throw new ClientError("network_unavailable", "Lost");
    }
    return this.statusResult(status);
  }
  override async saleStatus(operationId: string): Promise<SyncResult> {
    this.calls.push("status");
    const status = this.statuses.get(operationId);
    if (!status) throw new ClientError("sale_not_found", "Absent", 404);
    return this.statusResult(status);
  }
  override async uploadPermission(
    _purchaseId: string,
    input: UploadPermissionRequest,
  ): Promise<UploadPermission> {
    this.calls.push("permission");
    this.permissionKeys.push(input.operationId);
    if (this.expirePermission) {
      this.expirePermission = false;
      throw new ClientError("upload_permission_expired", "Expired", 409);
    }
    let permission = this.permissions.get(input.operationId);
    if (!permission) {
      permission = {
        uploadId: uuidv7(),
        method: "PUT",
        url: "https://storage.example.com/staging",
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: new Date(
          Date.parse(this.current.serverTime) + 300000,
        ).toISOString(),
        maxBytes: 8388608,
      };
      this.permissions.set(input.operationId, permission);
    }
    return structuredClone(permission);
  }
  override async uploadPhoto(_permission: UploadPermission, _blob: Blob) {
    void _permission;
    void _blob;
    this.calls.push("put");
    await this.beforePut?.();
    if (this.failPut)
      throw new ClientError("photo_upload_failed", "Failed", 503, null, true);
  }
  override async finalizeSale(
    purchaseId: string,
    input: FinalizeRequest,
  ): Promise<SyncResult> {
    this.calls.push("finalize");
    this.finalizeBodies.push(structuredClone(input));
    const status = [...this.statuses.values()].find(
      (s) => s.purchaseId === purchaseId,
    )!;
    if (status.state !== "credited" && status.state !== "held") {
      Object.assign(status, {
        version: 2,
        state: this.finalizeHeld ? "held" : "credited",
        photoValidated: true,
        credited: !this.finalizeHeld,
        currentRevisionId: this.finalizeHeld ? null : uuidv7(),
        pendingReason: null,
        holds: this.finalizeHeld
          ? [
              { kind: "price", reasonCode: "price_uncertain" },
              { kind: "card", reasonCode: "replaced_card" },
            ]
          : [],
      });
    }
    if (this.loseFinalize) {
      this.loseFinalize = false;
      throw new ClientError("network_unavailable", "Lost");
    }
    return this.statusResult(status);
  }
}
