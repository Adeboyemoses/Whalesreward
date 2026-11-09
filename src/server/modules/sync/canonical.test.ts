import { expect, it } from "vitest";
import { payloadDigest } from "./canonical";
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
