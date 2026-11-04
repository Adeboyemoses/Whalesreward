import { expect, it, vi } from "vitest";
import { sendEmail } from "./email";

it("discards staging email without sending or logging its sensitive content", async () => {
  vi.stubEnv("WHR_ENV", "staging");
  const log = vi.spyOn(console, "info");
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(
    await sendEmail({
      to: "ada@example.com",
      subject: "Private reset",
      text: "fictional-token",
    }),
  ).toEqual({ delivered: false, adapter: "noop" });
  expect(log).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
