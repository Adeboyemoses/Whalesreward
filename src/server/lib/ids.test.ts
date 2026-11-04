import { expect, it } from "vitest";
import { validate, version } from "uuid";
import { newId } from "./ids";
it("generates distinct valid UUIDv7 identifiers, independent of display codes", () => {
  const ids = Array.from({ length: 1000 }, () => newId());
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(7);
  }
});
