import { describe, expect, it } from "vitest";
import {
  CustomerRecoveryApi,
  sameRecoveryContext,
  recoveryMessage,
} from "./customer-recovery-api";
import { AdminError, type adminRequest } from "./admin-api";
import { freezeCustomerChange } from "./customer-admin-api";
const id = "01930200-0000-7000-8000-000000000001";
const cardId = "01930200-0000-7000-8000-000000000002";
const context = {
  customerId: id,
  customerVersion: 1,
  phoneMasked: "•••• 0000",
  activeCard: { id: cardId, code: "ABCD234", version: 1 },
};
const request = (value: unknown) => (async () => value) as typeof adminRequest;
describe("customer recovery response and review guards", () => {
  it("rejects a context from another customer or carrying raw personal data", async () => {
    await expect(
      new CustomerRecoveryApi(
        request({ ...context, customerId: cardId }),
      ).context(id),
    ).rejects.toMatchObject({ code: "invalid_response" });
    await expect(
      new CustomerRecoveryApi(
        request({ ...context, destination: "not permitted" }),
      ).context(id),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("requires the exact reviewed customer and card versions", () => {
    expect(sameRecoveryContext(context, structuredClone(context))).toBe(true);
    expect(
      sameRecoveryContext(context, { ...context, customerVersion: 2 }),
    ).toBe(false);
    expect(
      sameRecoveryContext(context, {
        ...context,
        activeCard: { ...context.activeCard, version: 2 },
      }),
    ).toBe(false);
    expect(sameRecoveryContext(context, { ...context, activeCard: null })).toBe(
      false,
    );
  });
  it("accepts a bound phone receipt and refuses another operation's receipt", async () => {
    const change = freezeCustomerChange(`customers/${id}/phone-change`, {
      expectedVersion: 1,
      activeCardCode: "ABCD234",
      reason: "Customer requested an update",
    });
    const receipt = {
      id: cardId,
      operationId: change.body.operationId,
      customerId: id,
      customerVersion: 2,
      kind: "phone_change",
      oldPhoneMasked: "•••• 0000",
      newPhoneMasked: "•••• 0001",
      oldCardCode: null,
      newCardCode: null,
      verification: "card_present",
      actor: { id, code: "ADMIN001", name: "Ada Williams" },
      reason: "Customer requested an update",
      appliedAt: "2026-11-13T00:00:00.000Z",
      auditEventId: cardId,
    };
    await expect(
      new CustomerRecoveryApi(request(receipt)).apply(
        id,
        change,
        "phone_change",
      ),
    ).resolves.toEqual(receipt);
    await expect(
      new CustomerRecoveryApi(request({ ...receipt, operationId: id })).apply(
        id,
        change,
        "phone_change",
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("uses only generic verification failure and exact unconfigured copy", () => {
    expect(
      recoveryMessage(new AdminError("verification_unavailable", 422)),
    ).toBe("Verification is unavailable. Request another code and try again.");
    expect(
      recoveryMessage(new AdminError("phone_verification_unconfigured", 409)),
    ).toBe("Lost-card replacement isn't switched on yet");
  });
});
