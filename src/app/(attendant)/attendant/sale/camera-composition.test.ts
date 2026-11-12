import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { transpileModule, ScriptTarget } from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { v7 } from "uuid";
import {
  AttendantClient,
  type CaptureDraft,
} from "../../../../client/offline/client";
import { CaptureDatabase } from "../../../../client/offline/db";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../../../tests/fixtures/attendant-client-fake";
import type { Session } from "../../../../client/types";
import { DraftComposition } from "./draft-composition";

// Execute the screen's actual handler, rather than a second implementation of
// its async ordering. React rendering is covered separately by browser tests.
const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const handler = page.slice(
  page.indexOf("  async function startCamera("),
  page.indexOf("  function composeInput("),
);
const compiled = transpileModule(handler, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;
let client: AttendantClient, db: CaptureDatabase, api: FakeAttendantApi;
let now: number;
const setCamera = vi.fn(),
  setError = vi.fn();
let draft: CaptureDraft | null;
let ensureDraft: ReturnType<typeof vi.fn>;
let startCamera: (mode: "photo" | "qr") => Promise<void>;
beforeEach(async () => {
  now = Date.parse("2026-11-12T10:00:00Z");
  const runtimeId = v7();
  db = new CaptureDatabase(`camera-order-${v7()}`);
  api = new FakeAttendantApi(sessionFixture(now));
  client = new AttendantClient(
    api,
    db,
    () => ({ wall: now, mono: 0, runtimeId }),
    () => true,
  );
  await client.initialize();
  await client.signIn("grace.okon", "fictional");
  draft = null;
  setCamera.mockClear();
  setError.mockClear();
  const composition = new DraftComposition();
  ensureDraft = vi.fn(async () => {
    draft = await composition.start(
      () => client.beginCapture(),
      () => {},
    );
    return draft;
  });
  startCamera = new Function(
    "client",
    "request",
    "mounted",
    "contextId",
    "markCaptureStarted",
    "ensureDraft",
    "setCamera",
    "setError",
    "message",
    `${compiled}; return startCamera;`,
  )(
    client,
    { current: 0 },
    { current: true },
    api.current.captureContextId,
    () => {},
    ensureDraft,
    setCamera,
    setError,
    String,
  );
});
afterEach(async () => {
  client.close();
  await db.delete();
});
it("photo intent freezes the original price before a pending session response released in the same turn", async () => {
  let entered!: () => void, release!: (session: Session) => void;
  const requested = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const response = new Promise<Session>((resolve) => {
    release = resolve;
  });
  api.session = async () => {
    entered();
    return response;
  };
  const refreshing = client.refresh();
  await requested;
  const opening = startCamera("photo");
  release({
    ...api.current,
    price: {
      ...api.current.price,
      version: 2,
      priceVersionId: v7(),
      rateKobo: "120000",
    },
  });
  await Promise.all([opening, refreshing]);
  expect(setError).not.toHaveBeenCalled();
  expect(setCamera).toHaveBeenCalledWith("photo");
  expect(client.getState().session?.price.version).toBe(2);
  expect(draft?.session.price).toEqual(api.current.price);
});
it("QR opening checks authority without composing a sale", async () => {
  await startCamera("qr");
  expect(ensureDraft).not.toHaveBeenCalled();
  expect(setCamera).toHaveBeenCalledWith("qr");
});
it("expired photo intent cannot open the camera or reserve a draft", async () => {
  now += 86_400_001;
  await startCamera("photo");
  expect(setCamera).not.toHaveBeenCalled();
  expect(draft).toBeNull();
});

it("an already composed draft does not bypass renewed camera authority checks", async () => {
  await startCamera("photo");
  expect(draft).not.toBeNull();
  setCamera.mockClear();
  now += 86_400_001;
  await startCamera("photo");
  expect(setCamera).not.toHaveBeenCalled();
});
