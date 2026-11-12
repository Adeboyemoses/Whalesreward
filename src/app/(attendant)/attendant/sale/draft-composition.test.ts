import { describe, expect, it, vi } from "vitest";
import { DraftComposition } from "./draft-composition";
import type { CaptureDraft } from "@/client/offline/client";
const draft = {
  operationId: "one",
  appCapturedAt: "2026-11-12T10:00:00Z",
  session: { price: { version: 1 } },
} as CaptureDraft;
describe("P-27 meaningful composition", () => {
  it("protects synchronously and deduplicates overlapping first inputs without replacing frozen facts", async () => {
    let resolve!: (value: CaptureDraft) => void;
    const begin = vi.fn(
        () =>
          new Promise<CaptureDraft>((done) => {
            resolve = done;
          }),
      ),
      protect = vi.fn(),
      composition = new DraftComposition();
    expect(begin).not.toHaveBeenCalled();
    const first = composition.start(begin, protect),
      second = composition.start(begin, protect);
    expect(protect).toHaveBeenCalledOnce();
    expect(begin).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    resolve(draft);
    expect(await first).toBe(draft);
    expect(await composition.start(begin, protect)).toBe(draft);
    expect(begin).toHaveBeenCalledOnce();
  });
  it("discard invalidates pending preparation and a later sale gets a fresh snapshot", async () => {
    let resolve!: (value: CaptureDraft) => void;
    const composition = new DraftComposition();
    const old = composition.start(
      () =>
        new Promise<CaptureDraft>((done) => {
          resolve = done;
        }),
      () => {},
    );
    composition.discard();
    const fresh = { ...draft, operationId: "new" };
    expect(
      await composition.start(
        async () => fresh,
        () => {},
      ),
    ).toBe(fresh);
    resolve(draft);
    expect(await old).toBeNull();
    expect(
      await composition.start(
        async () => draft,
        () => {},
      ),
    ).toBe(fresh);
  });
  it("failed preparation can retry while a selected draft keeps its identity and evidence", async () => {
    const composition = new DraftComposition();
    await expect(
      composition.start(
        async () => {
          throw Error("storage");
        },
        () => {},
      ),
    ).rejects.toThrow("storage");
    await composition.start(
      async () => draft,
      () => {},
    );
    const selected = {
      ...draft,
      selectedLookup: {
        cardCode: "A7K3M9Q",
        lookupReceipt: null,
        customer: null,
      },
    };
    composition.select(selected);
    expect(
      await composition.start(
        async () => draft,
        () => {},
      ),
    ).toBe(selected);
  });
});
