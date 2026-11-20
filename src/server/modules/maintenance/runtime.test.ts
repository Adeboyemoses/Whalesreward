import { rootCertificates } from "node:tls";
import { expect, it } from "vitest";
import { maintenanceDatabaseConfig } from "./runtime";
it("maintenance runtime rejects remote plaintext and production pending approved TLS extension", () => {
  expect(() =>
    maintenanceDatabaseConfig({
      NODE_ENV: "test",
      MAINTENANCE_DATABASE_URL:
        "postgresql://fixture:fixture@database.invalid/test",
    }),
  ).toThrow("invalid_configuration");
  expect(() =>
    maintenanceDatabaseConfig({
      NODE_ENV: "test",
      WHR_ENV: "production",
      MAINTENANCE_DATABASE_URL: "postgresql://fixture:fixture@localhost/test",
    }),
  ).toThrow("invalid_configuration");
  expect(() =>
    maintenanceDatabaseConfig({
      NODE_ENV: "test",
      WHR_ENV: "staging",
      MAINTENANCE_DATABASE_URL: "postgresql://fixture:fixture@localhost/test",
    }),
  ).toThrow("invalid_configuration");
  expect(
    maintenanceDatabaseConfig({
      NODE_ENV: "test",
      MAINTENANCE_DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1/test",
    }).max,
  ).toBe(2);
});

it("staging maintenance database uses dedicated credentials and verified CA without URL SSL overrides", () => {
  const ca = rootCertificates[0]!;
  const config = maintenanceDatabaseConfig({
    NODE_ENV: "test",
    WHR_ENV: "staging",
    MAINTENANCE_DATABASE_URL:
      "postgresql://fixture:fixture@database.invalid/test?sslmode=disable&ssl=false",
    DATABASE_CA_CERT: ca,
  });
  expect(config.ssl).toEqual({ ca, rejectUnauthorized: true });
  expect(config.connectionString).not.toContain("sslmode");
  expect(config.connectionString).not.toContain("ssl=false");
  expect(() =>
    maintenanceDatabaseConfig({
      NODE_ENV: "test",
      WHR_ENV: "staging",
      MAINTENANCE_DATABASE_URL:
        "postgresql://fixture:fixture@database.invalid/test",
      DATABASE_CA_CERT: "fictional malformed CA",
    }),
  ).toThrow("invalid_configuration");
});

it("maintenance URL query cannot replace validated host or bounded client timeouts", () => {
  const config = maintenanceDatabaseConfig({
    NODE_ENV: "test",
    MAINTENANCE_DATABASE_URL:
      "postgresql://fixture:fixture@127.0.0.1/test?host=remote.invalid&query_timeout=0&connection_timeout=0",
  });
  expect(new URL(config.connectionString!).hostname).toBe("127.0.0.1");
  expect(new URL(config.connectionString!).search).toBe("");
  expect(config.query_timeout).toBe(6000);
  expect(config.connectionTimeoutMillis).toBe(5000);
});
