export function localTestDatabase(raw: string | undefined) {
  if (!raw) throw new Error("Reports browser tests require DATABASE_URL");
  const url = new URL(raw);
  if (
    url.search !== "" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(
      url.hostname,
    ) ||
    !/(?:test|e2e|whr25)/i.test(url.pathname) ||
    ["staging", "production"].includes(process.env.WHR_ENV ?? "")
  )
    throw new Error(
      "Reports browser tests require an explicitly local test database",
    );
  return url;
}
