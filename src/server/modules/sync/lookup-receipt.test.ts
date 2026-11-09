import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newId } from "../../lib/ids";
import {
  signLookupReceipt,
  verifyLookupReceipt,
  lookupReceiptConfig,
} from "./lookup-receipt";
const key = randomBytes(32);
const ring = { activeKid: "test", keys: new Map([["test", key]]) };
const claims = () => ({
  version: 1 as const,
  purpose: "capture_lookup" as const,
  captureContextId: newId(),
  originatingAccountId: newId(),
  stationId: newId(),
  cardId: newId(),
  cardCode: "A7K3M9Q",
  customerId: newId(),
  cardCustomerLinkId: newId(),
  issuedAt: "2026-11-10T10:00:00.000Z",
  expiresAt: "2026-11-11T09:00:00.000Z",
});
describe("P-23 receipt codec", () => {
  it("authenticates strict canonical claims and supports retained verification keys", () => {
    const c = claims(),
      encoded = signLookupReceipt(c, ring)!;
    expect(verifyLookupReceipt(encoded, ring)).toEqual(c);
    expect(
      verifyLookupReceipt(encoded, {
        activeKid: "next",
        keys: new Map([...ring.keys, ["next", randomBytes(32)]]),
      }),
    ).toEqual(c);
    expect(
      verifyLookupReceipt(encoded, {
        activeKid: "next",
        keys: new Map([["next", randomBytes(32)]]),
      }),
    ).toBeNull();
  });
  it("rejects malformed, tampered, oversize and noncanonical evidence without throwing", () => {
    const encoded = signLookupReceipt(claims(), ring)!;
    for (const bad of [
      null,
      {},
      3,
      false,
      [],
      "x".repeat(2049),
      encoded + "=",
      encoded.replace("lr1", "lr2"),
      encoded.slice(0, -1) + "!",
      encoded.replace(".test.", ".unknown."),
    ])
      expect(verifyLookupReceipt(bad, ring)).toBeNull();
  });
  it("uses configuration only and safely disables incomplete or malformed configuration", () => {
    expect(lookupReceiptConfig({})).toEqual({
      activeKid: null,
      keys: new Map(),
    });
    expect(
      lookupReceiptConfig({
        WHR_LOOKUP_RECEIPT_ACTIVE_KID: "test",
        WHR_LOOKUP_RECEIPT_KEYS: "bad",
      }).activeKid,
    ).toBeNull();
    expect(
      lookupReceiptConfig({
        WHR_LOOKUP_RECEIPT_ACTIVE_KID: "test",
        WHR_LOOKUP_RECEIPT_KEYS: JSON.stringify({
          test: key.toString("base64url"),
        }),
      }).activeKid,
    ).toBe("test");
  });
});

it("P-23 rejects signed noncanonical JSON, unknown claims, versions, purpose and invalid MAC", () => {
  const c = claims();
  const encode = (json: string) => {
    const head = `lr1.test.${Buffer.from(json).toString("base64url")}`;
    return `${head}.${createHmac("sha256", key).update(head).digest("base64url")}`;
  };
  for (const json of [
    JSON.stringify(c, null, 2),
    JSON.stringify({ ...c, extra: 1 }),
    JSON.stringify({ ...c, version: 2 }),
    JSON.stringify({ ...c, purpose: "other" }),
    JSON.stringify({
      ...c,
      captureContextId: c.captureContextId.toUpperCase(),
    }),
    JSON.stringify({ ...c, issuedAt: "2026-11-10T10:00:00Z" }),
    JSON.stringify(c).replace("{", '{"version":1,'),
    JSON.stringify(Object.fromEntries(Object.entries(c).reverse())),
  ])
    expect(verifyLookupReceipt(encode(json), ring)).toBeNull();
  const receipt = signLookupReceipt(c, ring)!;
  expect(
    verifyLookupReceipt(receipt, {
      activeKid: "test",
      keys: new Map([["test", randomBytes(32)]]),
    }),
  ).toBeNull();
});

it("P-23 rejects a correctly MACed UTF-8 BOM-prefixed payload", () => {
  const payload = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(claims())),
  ]);
  const prefix = `lr1.test.${payload.toString("base64url")}`;
  const encoded = `${prefix}.${createHmac("sha256", key).update(prefix).digest("base64url")}`;
  expect(verifyLookupReceipt(encoded, ring) === null).toBe(true);
});
