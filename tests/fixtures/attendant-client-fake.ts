import { v7 as uuidv7 } from "uuid";
import type { AttendantApi } from "../../src/client/api";
import { ClientError, type Session, type Lookup } from "../../src/client/types";
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
  revocationFails = false;
  async signIn() {
    return structuredClone(this.current);
  }
  async signOut() {
    if (this.revocationFails)
      throw new ClientError("network_unavailable", "Unavailable");
  }
  async session() {
    return structuredClone(this.current);
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
