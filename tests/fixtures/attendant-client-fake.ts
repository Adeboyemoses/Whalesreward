import { v7 as uuidv7 } from "uuid";
import type { AttendantApi } from "../../src/client/api";
import {
  ClientError,
  type Session,
  type AuthSession,
  type ConfiguredAssignment,
  type FirstPasswordInput,
  type Lookup,
  type SyncResult,
  type UploadPermission,
  type OriginalSale,
  type UploadPermissionRequest,
  type FinalizeRequest,
} from "../../src/client/types";
export function sessionFixture(now: number, accountId = uuidv7()): Session {
  const at = new Date(now).toISOString();
  return {
    account: {
      id: accountId,
      staffCode: "STAFF002",
      name: "Grace Okon",
      username: "grace.okon",
    },
    station: {
      id: uuidv7(),
      code: "WH01",
      name: "Whales Energy",
      timezone: "Africa/Lagos",
    },
    assignment: { id: uuidv7(), version: 1 },
    pump: { id: uuidv7(), code: "P02" },
    product: { id: uuidv7(), code: "pms", unit: "litre" },
    price: {
      priceVersionId: uuidv7(),
      version: 1,
      rateKobo: "100000",
      currency: "NGN",
      quantityPrecision: 3,
      effectiveFrom: at,
      fetchedAt: at,
    },
    captureContextId: uuidv7(),
    lastOnlineSignInAt: at,
    offlineExpiresAt: new Date(now + 86400000).toISOString(),
    sessionExpiresAt: new Date(now + 86400000).toISOString(),
    serverTime: at,
    reassignmentRequiresSignIn: false,
  };
}
export class FakeAttendantApi implements AttendantApi {
  constructor(public current: Session) {}
  async submitSale(_original: OriginalSale): Promise<SyncResult> {
    void _original;
    throw new ClientError("network_unavailable", "Unavailable");
  }
  async saleStatus(_operationId: string): Promise<SyncResult> {
    void _operationId;
    throw new ClientError("network_unavailable", "Unavailable");
  }
  async uploadPermission(
    _purchaseId: string,
    _input: UploadPermissionRequest,
  ): Promise<UploadPermission> {
    void _purchaseId;
    void _input;
    throw new ClientError("network_unavailable", "Unavailable");
  }
  async uploadPhoto(_permission: UploadPermission, _blob: Blob): Promise<void> {
    void _permission;
    void _blob;
    throw new ClientError("network_unavailable", "Unavailable");
  }
  async finalizeSale(
    _purchaseId: string,
    _input: FinalizeRequest,
  ): Promise<SyncResult> {
    void _purchaseId;
    void _input;
    throw new ClientError("network_unavailable", "Unavailable");
  }
  revocationFails = false;
  async signIn(): Promise<AuthSession> {
    return structuredClone(this.current);
  }
  async signOut() {
    if (this.revocationFails)
      throw new ClientError("network_unavailable", "Unavailable");
  }
  async session(): Promise<AuthSession> {
    return structuredClone(this.current);
  }
  async completeFirstPassword(_input: FirstPasswordInput): Promise<void> {
    void _input;
  }
  async configuredAssignment(): Promise<ConfiguredAssignment> {
    return {
      configured: {
        ...this.current.assignment,
        pump: { ...this.current.pump, name: this.current.pump.code },
        product: this.current.product,
        effectiveFrom: this.current.lastOnlineSignInAt,
      },
      acknowledgedAssignmentId: this.current.assignment.id,
      reassignmentRequiresSignIn: this.current.reassignmentRequiresSignIn,
    };
  }
  async lookup(
    input: { source: "code"; code: string } | { source: "qr"; qr: string },
  ): Promise<Lookup> {
    return {
      cardCode: input.source === "code" ? input.code : input.qr,
      customer: { id: uuidv7(), name: "Amina Bello", category: "car_owner" },
      lookedUpAt: this.current.serverTime,
    };
  }
}
