import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("terminates Node startup with a production recipient allowlist without logging its value", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "production");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "ada@example.com");
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("test exit sentinel");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(register()).rejects.toThrow("test exit sentinel");
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log).toHaveBeenCalledExactlyOnceWith("Email configuration is invalid");
});
it("allows production startup without activating a provider", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "production");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", undefined);
  vi.stubEnv("EMAIL_PROVIDER", undefined);
  await expect(register()).resolves.toBeUndefined();
});
