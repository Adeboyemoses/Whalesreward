import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaptureDatabase } from "../offline/db";
import { registerAttendantWorker } from "./register";
import {
  markCaptureStarted,
  markCaptureEnded,
  isUpdateFrozen,
} from "./update-safety";
let db: CaptureDatabase;
let stop: () => void;
let sw: EventTarget & {
  register: ReturnType<typeof vi.fn>;
  controller: object | null;
};
let waiting: { postMessage: ReturnType<typeof vi.fn> };
let reload: ReturnType<typeof vi.fn>;
function event(type: string, fields = {}) {
  return Object.assign(new Event(type), fields);
}
async function prepare() {
  const reply = vi.fn();
  sw.dispatchEvent(
    event("message", {
      source: waiting,
      data: { type: "WHR_PREPARE_UPDATE", token: "test" },
      ports: [{ postMessage: reply }],
    }),
  );
  await vi.waitFor(() => expect(reply).toHaveBeenCalled());
  return reply.mock.calls[0]![0];
}
beforeEach(async () => {
  db = new CaptureDatabase();
  vi.stubEnv("NODE_ENV", "production");
  waiting = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), {
    waiting,
    active: null,
    installing: null,
    update: vi.fn(async () => {}),
  });
  sw = Object.assign(new EventTarget(), {
    register: vi.fn(async () => registration),
    controller: {},
  });
  vi.stubGlobal("navigator", { serviceWorker: sw, onLine: true });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { documentElement: { inert: false } }),
  );
  reload = vi.fn();
  vi.stubGlobal("location", { pathname: "/attendant/sign-in", reload });
  stop = await registerAttendantWorker();
});
afterEach(async () => {
  stop();
  markCaptureEnded();
  await db.delete();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("reloads an idle empty client only after preparation and controller handover", async () => {
  sw.dispatchEvent(event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();
  expect(await prepare()).toBe(true);
  expect(isUpdateFrozen()).toBe(true);
  sw.dispatchEvent(event("controllerchange"));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});
it("does not prepare or reload during a capture", async () => {
  markCaptureStarted();
  expect(await prepare()).toBe(false);
  sw.dispatchEvent(event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();
});
it("does not prepare or reload while another account has pending sales", async () => {
  await db.outbox.put({
    originatingAccountId: "signed-out",
    operationId: "pending",
    state: "saved",
  } as never);
  expect(await prepare()).toBe(false);
  sw.dispatchEvent(event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();
  expect(await db.outbox.count()).toBe(1);
});
it("rechecks durable outbox before reload even after unanimous preparation", async () => {
  expect(await prepare()).toBe(true);
  await db.outbox.put({
    originatingAccountId: "other",
    operationId: "raced",
    state: "saved",
  } as never);
  sw.dispatchEvent(event("controllerchange"));
  await vi.waitFor(() => expect(isUpdateFrozen()).toBe(false));
  expect(reload).not.toHaveBeenCalled();
});
it("marks a capture before React receives the input event", async () => {
  location.pathname = "/attendant/sale";
  document.dispatchEvent(event("pointerdown"));
  expect(await prepare()).toBe(false);
});
