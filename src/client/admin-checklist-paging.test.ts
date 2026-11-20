import { describe, expect, it } from "vitest";
import { evidenceWindow } from "./admin-checklist-paging";
describe("complete evidence with visual browsing pages", () => {
  it("browses all 101 identities without removing any from the complete reviewed set", () => {
    const complete = Array.from({ length: 101 }, (_, i) => `account-${i}`);
    const pages = Array.from({ length: 5 }, (_, i) =>
      evidenceWindow(complete, i),
    );
    expect(pages.flatMap((p) => p.items)).toEqual(complete);
    expect(complete).toHaveLength(101);
    expect(pages[0]).toMatchObject({
      previous: false,
      next: true,
      start: 0,
      page: 0,
      pages: 5,
    });
    expect(pages[4]).toMatchObject({
      previous: true,
      next: false,
      start: 100,
      page: 4,
      pages: 5,
    });
  });
  it("keeps a changed or shortened evidence set on a valid page", () => {
    expect(evidenceWindow(["retained"], 7)).toMatchObject({
      items: ["retained"],
      page: 0,
      previous: false,
      next: false,
    });
    expect(evidenceWindow([], 1)).toMatchObject({
      items: [],
      page: 0,
      pages: 1,
    });
  });
});
