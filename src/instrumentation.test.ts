import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
afterEach(() => vi.unstubAllEnvs());
it("refuses Node startup with a production recipient allowlist", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "production");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "ada@example.com");
  await expect(register()).rejects.toThrow("Email configuration is invalid");
});
it("allows production startup without activating a provider", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "production");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", undefined);
  vi.stubEnv("EMAIL_PROVIDER", undefined);
  await expect(register()).resolves.toBeUndefined();
});
