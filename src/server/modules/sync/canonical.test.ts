import { expect, it } from "vitest";
import { canonicalJson, jsonbRepresentable, payloadDigest } from "./canonical";
it("P-23 keeps omission/null legacy digests and freezes every other canonical JSON value", () => {
  const legacy = { operationId: "fictional-operation", cardCode: "A7K3M9Q" };
  expect(payloadDigest({ ...legacy, lookupReceipt: null })).toBe(
    payloadDigest(legacy),
  );
  expect(payloadDigest({ ...legacy, lookupReceipt: undefined })).toBe(
    payloadDigest(legacy),
  );
  for (const lookupReceipt of [false, 0, "", [], {}, "untrusted"])
    expect(payloadDigest({ ...legacy, lookupReceipt })).not.toBe(
      payloadDigest(legacy),
    );
  expect(payloadDigest({ ...legacy, lookupReceipt: { b: 2, a: 1 } })).toBe(
    payloadDigest({ ...legacy, lookupReceipt: { a: 1, b: 2 } }),
  );
});

it("P-23 canonicalizes deeply nested JSON within the request byte limit without recursion", () => {
  const encoded = "[".repeat(7000) + "0" + "]".repeat(7000);
  const evidence: unknown = JSON.parse(encoded);
  expect(canonicalJson(evidence) === encoded).toBe(true);
  expect(payloadDigest({ lookupReceipt: evidence })).toMatch(/^[a-f0-9]{64}$/);
});
it("preserves legacy recursively sorted JSON bytes", () => {
  expect(canonicalJson({ z: [{ b: 2, a: "\n" }, null, true], a: 1 })).toBe(
    '{"a":1,"z":[{"a":"\\n","b":2},null,true]}',
  );
});

it("preserves JSONB-incompatible Unicode evidence losslessly without changing its digest", () => {
  for (const value of [
    String.fromCharCode(0),
    String.fromCharCode(0xd800),
    String.fromCharCode(0xdc00),
    { [String.fromCharCode(0)]: 1 },
    [String.fromCharCode(0xdc00)],
  ]) {
    expect(jsonbRepresentable(value)).toBe(false);
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
    expect(payloadDigest({ lookupReceipt: value })).not.toBe(
      payloadDigest({ lookupReceipt: null }),
    );
  }
  for (const value of ["plain", "\\u0000", "😀", null, { good: [1, true] }])
    expect(jsonbRepresentable(value)).toBe(true);
});

it("P-23 Unicode-equivalent distinct keys have deterministic total ordering", () => {
  const a = { ä: 1, "a\u0308": 2, nested: { é: 3, "e\u0301": 4 } };
  const b = { nested: { "e\u0301": 4, é: 3 }, "a\u0308": 2, ä: 1 };
  expect(canonicalJson(a)).toBe(canonicalJson(b));
  expect(payloadDigest({ lookupReceipt: a })).toBe(
    payloadDigest({ lookupReceipt: b }),
  );
  expect(payloadDigest({ lookupReceipt: a })).not.toBe(
    payloadDigest({ lookupReceipt: { ...b, ä: 5 } }),
  );
});

it("keeps the historical sync-v1 Unicode-key digest for legacy originals and recovery manifests", () => {
  const manifest = {
    operationId: "fictional-operation",
    manifest: { ä: 1, "a\u0308": 2, z: 3 },
  };
  const legacy =
    "3c273de54ffa08efddb257ced14ece4654adde3fc1a0afc13eeefb87c6a33c16";
  expect(payloadDigest(manifest)).toBe(legacy);
  expect(payloadDigest({ ...manifest, lookupReceipt: null })).toBe(legacy);
});
