import { expect, it } from "vitest";
import { ReviewLeaseGate } from "./admin-checklist-lease";
it("does not redisplay a cached grant after leaving and returning to the same URL", () => {
  const gate = new ReviewLeaseGate();
  const first = {},
    returned = {};
  const path = "/admin/leaderboards/finalize/phones";
  gate.mount(first, path);
  const check = gate.begin(first, path)!;
  expect(gate.accept(first, path, check)).toBe(true);
  expect(gate.authorized(first, path)).toBe(true);
  gate.release(first);
  expect(gate.authorized(first, path)).toBe(false);
  expect(gate.authorized(returned, path)).toBe(false);
  gate.mount(returned, path);
  expect(gate.authorized(returned, path)).toBe(false);
  const fresh = gate.begin(returned, path)!;
  expect(gate.accept(returned, path, fresh)).toBe(true);
  expect(gate.authorized(returned, path)).toBe(true);
});
it("rejects a late authority result from an unmounted or superseded validation generation", () => {
  const gate = new ReviewLeaseGate();
  const old = {},
    current = {};
  const path = "/admin/leaderboards/finalize/phones";
  gate.mount(old, path);
  const late = gate.begin(old, path)!;
  gate.release(old);
  gate.mount(current, path);
  expect(gate.accept(old, path, late)).toBe(false);
  expect(gate.authorized(current, path)).toBe(false);
  const slow = gate.begin(current, path)!;
  const latest = gate.begin(current, path)!;
  expect(gate.accept(current, path, slow)).toBe(false);
  expect(gate.accept(current, path, latest)).toBe(true);
  // Cleanup from an older concurrent mount cannot revoke the active mount.
  gate.release(old);
  expect(gate.authorized(current, path)).toBe(true);
  gate.mount(current, "/admin/leaderboards/finalize");
  expect(gate.authorized(current, path)).toBe(false);
});
