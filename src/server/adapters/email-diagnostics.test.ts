import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfig, type EmailOptions } from "./email-config";
import { sendEmail } from "./email";
import { logger } from "../lib/logger";
const env = {
  WHR_ENV: "staging",
  EMAIL_PROVIDER: "zoho_cpaas",
  ZOHO_CPAAS_API_URL: "https://cpaas.zoho.com/v1.1/email",
  ZOHO_CPAAS_TOKEN: "canary-private-token",
  EMAIL_FROM: "sender@example.com",
  EMAIL_ALLOWED_RECIPIENTS: "canary@example.com",
};
const message = {
  to: "canary@example.com",
  subject: "canary-private-subject",
  text: "https://example.com/#canary-private-link",
};
let warn: ReturnType<typeof vi.spyOn>;
const options = (): EmailOptions => ({
  adapter: "zoho_cpaas",
  staging: true,
  apiUrl: env.ZOHO_CPAAS_API_URL,
  token: env.ZOHO_CPAAS_TOKEN,
  from: env.EMAIL_FROM,
  allowedRecipients: [message.to],
});
beforeEach(() => {
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function logged(expected: Record<string, unknown>) {
  expect(warn.mock.calls).toEqual([
    [{ event: "email.send_failed", adapter: "zoho_cpaas", ...expected }],
  ]);
  const output = JSON.stringify(warn.mock.calls);
  for (const canary of [
    message.to,
    message.subject,
    message.text,
    env.EMAIL_FROM,
    env.ZOHO_CPAAS_TOKEN,
    "private-provider-detail",
  ])
    expect(output).not.toContain(canary);
}
describe("Zoho acceptance and safe diagnostics regression", () => {
  it.each([200, 201])(
    "accepts US HTTP %i with EM_104 and no warning",
    async (status) => {
      expect(emailConfig(env).apiUrl).toBe(env.ZOHO_CPAAS_API_URL);
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ data: [{ code: "EM_104" }] }), {
          status,
        }),
      );
      expect(await sendEmail(message, options())).toMatchObject({
        delivered: true,
      });
      expect(warn).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["Zoho-enczapikey raw-canary", "Zoho-enczapikeyraw-canary"])(
    "rejects prefixed token at configuration without its value: %s",
    (token) => {
      try {
        emailConfig({ ...env, ZOHO_CPAAS_TOKEN: token });
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toMatchObject({
          setting: "ZOHO_CPAAS_TOKEN",
          reason: "token_has_prefix",
        });
        expect(String(error)).not.toContain(token);
      }
    },
  );
  it.each([
    "https://cpaas.zoho.com/v1.1/email/",
    "https://cpaas.zoho.com/v1.1/email?x=1",
    "https://cpaas.zoho.com.evil.test/v1.1/email",
    "https://api.zeptomail.com/v1.1/email",
  ])("rejects endpoint variant %s", (apiUrl) => {
    expect(() => emailConfig({ ...env, ZOHO_CPAAS_API_URL: apiUrl })).toThrow();
  });
  it("logs one safe config setting for explicit and default invalid config", async () => {
    expect(
      await sendEmail(message, {
        ...options(),
        token: "Zoho-enczapikey private-provider-detail",
      }),
    ).toMatchObject({ delivered: false });
    logged({ reason: "config_invalid", setting: "ZOHO_CPAAS_TOKEN" });
    expect(fetch).not.toHaveBeenCalled();
    warn.mockClear();
    for (const [key, value] of Object.entries({ ...env, ZOHO_CPAAS_TOKEN: "" }))
      vi.stubEnv(key, value);
    expect(await sendEmail(message)).toMatchObject({ delivered: false });
    logged({ reason: "config_invalid", setting: "ZOHO_CPAAS_TOKEN" });
  });
  it("logs refusal once without a recipient or duplicate event", async () => {
    await sendEmail({ ...message, to: "other@example.com" }, options());
    logged({ reason: "config_invalid", setting: "EMAIL_ALLOWED_RECIPIENTS" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("classifies a private network error without repeating it", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error(message.text + env.ZOHO_CPAAS_TOKEN),
    );
    await sendEmail(message, options());
    logged({ reason: "network" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("classifies timeout without retry", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("private-provider-detail", "TimeoutError"),
    );
    await sendEmail(message, options());
    logged({ reason: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 500])(
    "retains HTTP %i and only validated provider code",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { error_code: "TM_3004", message: message.text },
            message: env.ZOHO_CPAAS_TOKEN,
          }),
          { status },
        ),
      );
      await sendEmail(message, options());
      logged({ reason: "http_status", status, error_code: "TM_3004" });
    },
  );
  it("reports an accepted HTTP status with provider failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { error_code: "SERR_157", detail: message.to },
        }),
        { status: 201 },
      ),
    );
    await sendEmail(message, options());
    logged({ reason: "provider_error", status: 201, error_code: "SERR_157" });
  });
  it.each([
    "TM_1\n",
    "T_1",
    "TOOLONG_1",
    "TM_123456",
    "TM_1 private-provider-detail",
    message.to,
  ])("drops unsafe provider error code %s", async (error_code) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { error_code } }), { status: 400 }),
    );
    await sendEmail(message, options());
    logged({ reason: "http_status", status: 400 });
  });
  it.each(["", "not-json", "{}", '{"data":[]}', "x".repeat(16385)])(
    "classifies invalid successful response case %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 201 }));
      await sendEmail(message, options());
      logged({ reason: "response_invalid", status: 201 });
    },
  );
  it.each(["", "not-json", "x".repeat(16385)])(
    "retains HTTP failure when response cannot be parsed %#",
    async (body) => {
      vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 500 }));
      await sendEmail(message, options());
      logged({ reason: "http_status", status: 500 });
    },
  );
});

it("bounds a stalled response stream and retains only its status", async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.mocked(fetch).mockResolvedValue(
    new Response(new ReadableStream({ start() {} }), { status: 201 }),
  );
  const pending = sendEmail(message, options());
  setTimeout(
    () =>
      controller.abort(
        new DOMException("private-provider-detail", "TimeoutError"),
      ),
    10,
  );
  await expect(pending).resolves.toMatchObject({ delivered: false });
  logged({ reason: "timeout", status: 201 });
});
it("does not downgrade non-acceptance status despite an EM_104 body", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ data: [{ code: "EM_104" }] }), {
      status: 202,
    }),
  );
  await sendEmail(message, options());
  logged({ reason: "http_status", status: 202 });
});
it.each([
  ["WHR_ENV", { WHR_ENV: "production", EMAIL_ALLOWED_RECIPIENTS: undefined }],
  ["EMAIL_PROVIDER", { EMAIL_PROVIDER: "private-provider-detail" }],
  [
    "ZOHO_CPAAS_API_URL",
    { ZOHO_CPAAS_API_URL: "https://example.com/private-provider-detail" },
  ],
  ["ZOHO_CPAAS_TOKEN", { ZOHO_CPAAS_TOKEN: "" }],
  ["EMAIL_FROM", { EMAIL_FROM: "private-provider-detail" }],
  [
    "EMAIL_ALLOWED_RECIPIENTS",
    { EMAIL_ALLOWED_RECIPIENTS: "private-provider-detail" },
  ],
])(
  "configuration validation identifies only setting %s",
  (setting, override) => {
    try {
      emailConfig({ ...env, ...override });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ setting, reason: "config_invalid" });
      expect(String(error)).not.toContain("private-provider-detail");
    }
  },
);

it.each([200, 201])(
  "HTTP %i EM_104 acknowledgement wins over an unrelated diagnostic error code",
  async (status) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ code: "EM_104" }], error_code: "TM_3004" }),
        { status },
      ),
    );
    await expect(sendEmail(message, options())).resolves.toMatchObject({
      delivered: true,
    });
    expect(warn).not.toHaveBeenCalled();
  },
);

it("bounds an invalid adapter name rather than logging its private value", async () => {
  vi.stubEnv("EMAIL_PROVIDER", "private-provider-detail");
  await sendEmail(message);
  expect(warn.mock.calls).toEqual([
    [
      {
        event: "email.send_failed",
        adapter: "unknown",
        reason: "config_invalid",
        setting: "EMAIL_PROVIDER",
      },
    ],
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it("logs only the Mailpit setting name for an unsafe local endpoint", async () => {
  await sendEmail(message, {
    adapter: "mailpit",
    mailpitUrl: "https://example.com/private-provider-detail",
  });
  expect(warn.mock.calls).toEqual([
    [
      {
        event: "email.send_failed",
        adapter: "mailpit",
        reason: "config_invalid",
        setting: "MAILPIT_URL",
      },
    ],
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
