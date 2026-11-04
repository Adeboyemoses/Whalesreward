import { describe, expect, it } from "vitest";
import { galleryEnabled, isStaging } from "./environment";

describe("staging isolation", () => {
  it("enables staging only for its exact environment name", () => {
    expect(isStaging({ WHR_ENV: "staging" })).toBe(true);
    expect(isStaging({ WHR_ENV: "production" })).toBe(false);
  });
  it("keeps the production gallery closed even if its flag is set", () => {
    expect(
      galleryEnabled({
        NODE_ENV: "production",
        WHR_ENV: "production",
        WHR_ENABLE_DEV_GALLERY: "true",
      }),
    ).toBe(false);
    expect(
      galleryEnabled({
        NODE_ENV: "production",
        WHR_ENABLE_DEV_GALLERY: "true",
      }),
    ).toBe(false);
  });
  it("requires the staging flag and allows local development", () => {
    expect(
      galleryEnabled({
        NODE_ENV: "production",
        WHR_ENV: "staging",
        WHR_ENABLE_DEV_GALLERY: "true",
      }),
    ).toBe(true);
    expect(galleryEnabled({ NODE_ENV: "production", WHR_ENV: "staging" })).toBe(
      false,
    );
    expect(galleryEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});
