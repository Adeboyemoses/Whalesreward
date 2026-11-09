import { expect, it } from "vitest";
import { canonicalJson, payloadDigest } from "./canonical";
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
