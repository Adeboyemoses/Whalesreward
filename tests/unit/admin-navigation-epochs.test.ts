import { expect, it } from "vitest";
import {
  AdminSessionStore,
  type AdminSession,
} from "../../src/client/admin-session";
import { AdminError, type adminRequest } from "../../src/client/admin-api";
const authority = (
  id = "fictional-a",
  permissions: string[] = ["users", "roles"],
) =>
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
it("I-07 old-account successful reads never publish into a newly adopted account", async () => {
  const late = deferred<unknown>();
  const store = new AdminSessionStore(
    (() => late.promise) as typeof adminRequest,
  );
  store.adopt(authority());
  const request = store.request("users/search", {});
  store.adopt(authority("fictional-b"));
  late.resolve({ items: ["private-old-account"] });
  await expect(request).rejects.toMatchObject({ code: "obsolete" });
  expect(store.getSnapshot().session?.account.id).toBe("fictional-b");
});
it("I-09 pending successful refresh cannot undo a definitive denial", async () => {
  const late = deferred<AdminSession>();
  const store = new AdminSessionStore(((path: string) =>
    path === "session"
      ? late.promise
      : Promise.reject(
          new AdminError("permission_denied", 403),
        )) as typeof adminRequest);
  store.adopt(authority());
  const refresh = store.refresh();
  await expect(store.request("users/search", {})).rejects.toBeInstanceOf(
    AdminError,
  );
  late.resolve(authority());
  await refresh;
  expect(store.getSnapshot().session).toBeNull();
  expect(store.lists.size).toBe(0);
});
it("I-09 changed grants replace the authority epoch and clear cached records", async () => {
  const store = new AdminSessionStore((async () =>
    authority("fictional-a", ["roles"])) as typeof adminRequest);
  store.adopt(authority());
  store.lists.set("users", { items: ["old"] });
  const previous = store.getSnapshot().epoch;
  await store.refresh();
  expect(store.getSnapshot().epoch).toBe(previous + 1);
  expect(store.lists.size).toBe(0);
  expect(store.getSnapshot().session?.permissions).toEqual(["roles"]);
});
for (const code of ["delegation_denied", "origin_rejected"])
  it(`I-07 domain refusal ${code} does not invalidate current identity`, async () => {
    const store = new AdminSessionStore((async () => {
      throw new AdminError(code, 403);
    }) as typeof adminRequest);
    store.adopt(authority());
    await expect(store.request("roles", {})).rejects.toMatchObject({ code });
    expect(store.getSnapshot().session?.account.id).toBe("fictional-a");
  });
