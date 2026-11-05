import { describe, expect, it } from "vitest";
import { emailConfig } from "./email-config";
const staging = {
  WHR_ENV: "staging",
  EMAIL_PROVIDER: "zoho_cpaas",
  ZOHO_CPAAS_API_URL: "https://cpaas.zoho.eu/v1.1/email",
  ZOHO_CPAAS_TOKEN: "fictional-provider-secret",
  EMAIL_FROM: "sender@example.com",
  EMAIL_ALLOWED_RECIPIENTS: "ada@example.com, grace@example.com",
};
describe("staging email configuration", () => {
  it("defaults local to Mailpit and staging to no-op", () => {
    expect(emailConfig({}).adapter).toBe("mailpit");
    expect(emailConfig({ WHR_ENV: "staging" }).adapter).toBe("noop");
  });
  it("loads only exact normalized recipient addresses", () => {
    expect(emailConfig(staging)).toMatchObject({
      adapter: "zoho_cpaas",
      allowedRecipients: ["ada@example.com", "grace@example.com"],
    });
    for (const value of [
      "",
      "*@example.com",
      "example.com",
      "ada@example.com,",
      "Ada <ada@example.com>",
    ])
      expect(() =>
        emailConfig({ ...staging, EMAIL_ALLOWED_RECIPIENTS: value }),
      ).toThrow("Email configuration is invalid");
  });
  it("rejects production allowlists even without a provider", () => {
    for (const env of [{ WHR_ENV: "production" }, { NODE_ENV: "production" }])
      expect(() =>
        emailConfig({ ...env, EMAIL_ALLOWED_RECIPIENTS: "" }),
      ).toThrow("Email configuration is invalid");
    expect(() => emailConfig({ ...staging, WHR_ENV: "production" })).toThrow();
    expect(() => emailConfig({ ...staging, WHR_ENV: undefined })).toThrow();
  });
  it("rejects missing credentials, unsafe endpoint and unknown selection without including values", () => {
    for (const override of [
      { ZOHO_CPAAS_TOKEN: "" },
      { EMAIL_FROM: "bad\naddress" },
      { ZOHO_CPAAS_API_URL: "https://cpaas.zoho.eu.evil.test/v1.1/email" },
      { ZOHO_CPAAS_API_URL: "https://cpaas.zoho.eu/v1.1/email?secret=bad" },
      { EMAIL_PROVIDER: "other" },
    ])
      expect(() => emailConfig({ ...staging, ...override })).toThrow(
        "Email configuration is invalid",
      );
  });
});
