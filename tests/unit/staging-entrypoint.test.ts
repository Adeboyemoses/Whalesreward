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

it("gives the Prisma migration engine its own strict TLS dialect without mutating pg settings", async () => {
  const { prismaDatabaseUrl } =
    await import("../../scripts/deploy/entrypoint.mjs");
  const pgUrl =
    "postgresql://fictional:fictional@database.example.com/whr?sslmode=verify-full&sslrootcert=/tmp/whr-db-ca.pem";
  const prismaUrl = new URL(prismaDatabaseUrl(pgUrl, true));
  expect(prismaUrl.searchParams.get("sslmode")).toBe("require");
  expect(prismaUrl.searchParams.get("sslaccept")).toBe("strict");
  expect(prismaUrl.searchParams.get("sslcert")).toBe("/tmp/whr-db-ca.pem");
  expect(prismaUrl.searchParams.has("sslrootcert")).toBe(false);
  expect(new URL(pgUrl).searchParams.get("sslmode")).toBe("verify-full");
  expect(prismaDatabaseUrl(pgUrl, false)).toBe(pgUrl);
});
