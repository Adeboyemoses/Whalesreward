import { expect, it } from "vitest";
import { createLogger } from "./logger";
it("redacts sensitive structured fields at any nesting depth without mutating input", () => {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line: string) => {
      lines.push(line);
    },
  });
  const source = {
    purchaseId: "purchase-1",
    phone: "secret-phone",
    nested: {
      items: [
        {
          child: {
            password: "secret-password",
            token: "secret-token",
            signedUrl: "secret-url",
            authorization: "secret-header",
            cookie: "secret-cookie",
            code: "secret-code",
          },
        },
      ],
    },
  };
  logger.info(source, "purchase.received");
  const output = lines.join("");
  expect(output).toContain("purchase-1");
  expect(output).not.toContain("secret-");
  expect(source.phone).toBe("secret-phone");
});
it("redacts child logger bindings and error context", () => {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line: string) => {
      lines.push(line);
    },
  });
  logger
    .child({
      account: {
        passwordHash: "secret-hash",
        resetToken: "secret-reset",
        phoneNumber: "secret-phone",
      },
    })
    .info(
      { nested: { session: { secretVerifier: "secret-verifier" } } },
      "security.event",
    );
  expect(lines.join("")).not.toContain("secret-");
});
it("redacts P-23 receipt bytes and evidence at any nesting depth", () => {
  const lines: string[] = [];
  const logger = createLogger({
    write: (line: string) => {
      lines.push(line);
    },
  });
  logger.info(
    {
      lookupReceipt: "receipt-canary",
      nested: {
        lookup_receipt_input: { a: "receipt-canary" },
        lookup_receipt_claims: "receipt-canary",
      },
    },
    "purchase.received",
  );
  expect(lines.join("")).not.toContain("receipt-canary");
});
