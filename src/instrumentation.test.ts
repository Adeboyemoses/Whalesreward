import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { logger } from "./server/lib/logger";
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
  const log = vi.spyOn(logger, "error").mockImplementation(() => {});
  await expect(register()).rejects.toThrow("test exit sentinel");
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log).toHaveBeenCalledExactlyOnceWith({
    event: "email.config_invalid",
    reason: "config_invalid",
    setting: "EMAIL_ALLOWED_RECIPIENTS",
  });
});
it("allows production startup without activating a provider", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "production");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", undefined);
  vi.stubEnv("EMAIL_PROVIDER", undefined);
  await expect(register()).resolves.toBeUndefined();
});

it("reports prefixed token startup failure without credentials", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WHR_ENV", "staging");
  vi.stubEnv("EMAIL_PROVIDER", "zoho_cpaas");
  vi.stubEnv("ZOHO_CPAAS_API_URL", "https://cpaas.zoho.com/v1.1/email");
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "Zoho-enczapikey private-startup-canary");
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("test exit sentinel");
  });
  const log = vi.spyOn(logger, "error").mockImplementation(() => {});
  await expect(register()).rejects.toThrow("test exit sentinel");
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log.mock.calls).toEqual([
    [
      {
        event: "email.config_invalid",
        reason: "token_has_prefix",
        setting: "ZOHO_CPAAS_TOKEN",
      },
    ],
  ]);
});
