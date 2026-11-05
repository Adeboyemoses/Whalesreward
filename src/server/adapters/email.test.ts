import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";
import { emailConfig } from "./email-config";
import { logger } from "../lib/logger";
const message = {
  to: "ada@example.com",
  subject: "Verify email",
  text: "private-link-token",
  html: "<a>private-link-token</a>",
};
const options = emailConfig({
  WHR_ENV: "staging",
  EMAIL_PROVIDER: "zoho_cpaas",
  ZOHO_CPAAS_API_URL: "https://cpaas.zoho.eu/v1.1/email",
  ZOHO_CPAAS_TOKEN: "fictional-secret",
  EMAIL_FROM: "sender@example.com",
  EMAIL_ALLOWED_RECIPIENTS: "ada@example.com",
});
let server: Server;
let stubUrl: string;
let requests: { headers: unknown; body: unknown }[];
let status = 200;
let payload = JSON.stringify({ data: [{ code: "EM_104" }], message: "OK" });
let redirect: string | undefined;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  requests = [];
  status = 200;
  payload = JSON.stringify({ data: [{ code: "EM_104" }], message: "OK" });
  redirect = undefined;
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(status, {
      "content-type": "application/json",
      ...(redirect ? { location: redirect } : {}),
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No stub port");
  stubUrl = `http://127.0.0.1:${address.port}`;
  // Transport substitution exists only in tests; production config still permits only EU HTTPS.
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    expect(String(url)).toBe("https://cpaas.zoho.eu/v1.1/email");
    return realFetch(stubUrl, init);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe("Zoho staging email contract", () => {
  it("sends one marked request with documented authentication and disabled tracking", async () => {
    expect(await sendEmail(message, options)).toMatchObject({
      delivered: true,
      adapter: "zoho_cpaas",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      headers: { authorization: "Zoho-enczapikey fictional-secret" },
      body: {
        from: { address: "sender@example.com" },
        to: [{ email_address: { address: "ada@example.com" } }],
        subject: "[Staging] Verify email",
        textbody: expect.stringContaining("This is a test message"),
        htmlbody: expect.stringContaining("This is a test message"),
        track_clicks: false,
        track_opens: false,
      },
    });
  });
  it("refuses non-allowlisted recipients before network with no private data logged", async () => {
    const log = vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const to of [
      "other@example.com",
      "ada+tag@example.com",
      "ada@example.com.evil.test",
      "ada@example.com,other@example.com",
    ])
      expect(await sendEmail({ ...message, to }, options)).toMatchObject({
        delivered: false,
        failure: "delivery_unavailable",
      });
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(log.mock.calls).toEqual(
      Array.from({ length: 4 }, () => [
        { event: "email.recipient_refused", adapter: "zoho_cpaas" },
      ]),
    );
  });
  it("never calls a provider when staging has no configuration", async () => {
    vi.stubEnv("WHR_ENV", "staging");
    vi.stubEnv("EMAIL_PROVIDER", undefined);
    expect(await sendEmail(message)).toEqual({
      delivered: false,
      adapter: "noop",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 429, 500, 503])(
    "maps HTTP %i to unavailable without retry or response leakage",
    async (code) => {
      status = code;
      payload = "private-provider-error";
      expect(await sendEmail(message, options)).toEqual({
        delivered: false,
        adapter: "zoho_cpaas",
        failure: "delivery_unavailable",
      });
      expect(requests).toHaveLength(1);
    },
  );
  it.each(["not-json", '{"data":[{"code":"OTHER"}]}', '{"data":[]}', "{}"])(
    "rejects malformed acceptance %s",
    async (value) => {
      payload = value;
      expect(await sendEmail(message, options)).toMatchObject({
        delivered: false,
      });
      expect(requests).toHaveLength(1);
    },
  );
  it("bounds the response body", async () => {
    payload = "x".repeat(17000);
    expect(await sendEmail(message, options)).toMatchObject({
      delivered: false,
    });
    expect(requests).toHaveLength(1);
  });
  it("refuses redirects without forwarding credentials", async () => {
    status = 307;
    redirect = stubUrl;
    expect(await sendEmail(message, options)).toMatchObject({
      delivered: false,
    });
    expect(requests).toHaveLength(1);
  });
  it("bounds timeout and suppresses network errors without retry", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => AbortSignal.abort());
    expect(await sendEmail(message, options)).toMatchObject({
      delivered: false,
    });
    expect(timeout).toHaveBeenCalledWith(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });
  it("returns a fixed failure when transport throws private details", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error("fictional-secret ada@example.com private-link-token"),
    );
    expect(await sendEmail(message, options)).toEqual({
      delivered: false,
      adapter: "zoho_cpaas",
      failure: "delivery_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
