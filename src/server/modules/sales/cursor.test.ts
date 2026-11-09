import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";
const id = "0199a000-0000-7000-8000-000000000001";
describe("M3 scoped sale cursors", () => {
  it("preserves database receipt microseconds and binds actor/filter/collection scope", () => {
    const at = "2026-11-09T01:02:03.123456Z",
      scope = "admin:actor1:station1:filter1:revisions";
    const cursor = encodeCursor("fictional-secret", scope, at, id);
    expect(decodeCursor("fictional-secret", scope, cursor)).toMatchObject({
      at,
      id,
    });
    expect(() =>
      decodeCursor(
        "fictional-secret",
        "admin:actor2:station1:filter1:revisions",
        cursor,
      ),
    ).toThrow();
    expect(() =>
      decodeCursor("fictional-secret", scope, cursor + "x"),
    ).toThrow();
  });
});
