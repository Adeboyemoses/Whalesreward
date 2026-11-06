import { expect, it } from "vitest";
import { AdminSessionStore, type AdminSession } from "./admin-session";
import { AdminError, type adminRequest } from "./admin-api";
const session = (id = "A", permissions: string[] = ["users"]) =>
  ({
    state: "ready",
    account: { id, name: id, username: id },
    permissions,
  }) as AdminSession;
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("keeps the current screen authority while refresh is pending or unavailable", async () => {
  const d = deferred<AdminSession>();
  const s = new AdminSessionStore((() => d.promise) as typeof adminRequest);
  s.adopt(session());
  const epoch = s.getSnapshot().epoch;
  const p = s.refresh();
  expect(s.getSnapshot().session?.account.id).toBe("A");
  d.reject(new AdminError("network"));
  await p;
  expect(s.getSnapshot().epoch).toBe(epoch);
  expect(s.getSnapshot().session?.account.id).toBe("A");
  expect(s.getSnapshot().error).toContain("could not be refreshed");
});
it("fences old refresh success after sign-out and never restores its cached list", async () => {
  const d = deferred<AdminSession>();
  const s = new AdminSessionStore((() => d.promise) as typeof adminRequest);
  s.adopt(session());
  s.lists.set("users", [1]);
  const p = s.refresh();
  s.clear();
  d.resolve(session());
  await p;
  expect(s.getSnapshot().session).toBeNull();
  expect(s.lists.size).toBe(0);
});
it("old-account denial cannot invalidate a newly signed-in account", async () => {
  const d = deferred<never>();
  const s = new AdminSessionStore((() => d.promise) as typeof adminRequest);
  s.adopt(session());
  const p = s.request("users");
  s.adopt(session("B"));
  d.reject(new AdminError("unauthenticated", 401));
  await expect(p).rejects.toBeInstanceOf(AdminError);
  expect(s.getSnapshot().session?.account.id).toBe("B");
});
it("unchanged grants keep drafts but changed authority clears cached data", async () => {
  let next = session();
  const s = new AdminSessionStore((async () => next) as typeof adminRequest);
  s.adopt(session());
  s.lists.set("users", [1]);
  const epoch = s.getSnapshot().epoch;
  await s.refresh();
  expect(s.getSnapshot().epoch).toBe(epoch);
  next = session("B");
  await s.refresh();
  expect(s.lists.size).toBe(0);
  expect(s.getSnapshot().epoch).toBe(epoch + 1);
});
it("delegation refusal does not log out an otherwise-authorized admin", async () => {
  const s = new AdminSessionStore((async () => {
    throw new AdminError("delegation_denied", 403);
  }) as typeof adminRequest);
  s.adopt(session());
  await expect(s.request("roles", {})).rejects.toBeInstanceOf(AdminError);
  expect(s.getSnapshot().session?.account.id).toBe("A");
});
