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
  expect(output).not.toContain("purchase-1");
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
        lookup_receipt_input_json: "receipt-canary",
        lookup_receipt_claims: "receipt-canary",
      },
    },
    "purchase.received",
  );
  expect(lines.join("")).not.toContain("receipt-canary");
});
it("drops arbitrary request data, messages, raw errors and forged safe keys", () => {
  const lines: string[] = [];
  const log = createLogger({
    write: (line: string) => {
      lines.push(line);
    },
  });
  const canary = "PRIVATE_CANARY_08012345678";
  log.child({ headers: { arbitrary: canary }, hostname: canary }).error(
    {
      event: canary,
      reason: canary,
      status: canary,
      body: canary,
      query: { x: canary },
      err: new Error(canary),
      counts: { scanned: canary },
    },
    canary,
  );
  log.info(canary);
  log.info({
    event: "maintenance.finished",
    job: "orphans",
    status: "succeeded",
    counts: { scanned: 7, arbitrary: canary },
  });
  expect(lines.join("")).not.toContain(canary);
  expect(JSON.parse(lines[2]!)).toMatchObject({
    event: "maintenance.finished",
    counts: { scanned: 7 },
  });
  expect(lines.join("")).not.toContain("hostname");
});
