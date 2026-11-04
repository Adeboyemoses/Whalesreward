import { expect, it } from "vitest";
import { databaseEnvironment } from "../../scripts/deploy/entrypoint.mjs";

it("requires TLS certificate validation for the bound staging database URL", () => {
  const env = databaseEnvironment({
    WHR_ENV: "staging",
    DATABASE_URL:
      "postgresql://fictional:fictional@database.example.com/whr?sslmode=require",
    DATABASE_CA_CERT: "fictional-ca",
  });
  const url = new URL(env.DATABASE_URL!);
  expect(url.searchParams.get("sslmode")).toBe("verify-full");
  expect(url.searchParams.get("sslrootcert")).toBe("/tmp/whr-db-ca.pem");
  expect(env.NODE_EXTRA_CA_CERTS).toBe("/tmp/whr-db-ca.pem");
});

it("fails closed without leaking malformed connection information", () => {
  expect(() =>
    databaseEnvironment({
      WHR_ENV: "staging",
      DATABASE_URL: "fictional-sensitive-invalid",
      DATABASE_CA_CERT: "fictional-ca",
    }),
  ).toThrow("Staging database configuration is invalid");
  expect(() =>
    databaseEnvironment({
      WHR_ENV: "staging",
      DATABASE_URL: "postgresql://fictional:fictional@example.com/whr",
    }),
  ).toThrow("Staging database configuration is invalid");
});
