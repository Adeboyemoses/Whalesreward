import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Normalize provider defaults for web, Prisma and seed processes alike. */
export function databaseEnvironment(env) {
  if (env.WHR_ENV !== "staging") return { ...env };
  try {
    if (!env.DATABASE_URL || !env.DATABASE_CA_CERT) throw new Error();
    const url = new URL(env.DATABASE_URL);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error();
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", "/tmp/whr-db-ca.pem");
    return {
      ...env,
      DATABASE_URL: url.toString(),
      NODE_EXTRA_CA_CERTS: "/tmp/whr-db-ca.pem",
    };
  } catch {
    throw new Error("Staging database configuration is invalid");
  }
}

/** Prisma Migrate's schema engine uses its own TLS URL dialect, unlike pg. */
export function prismaDatabaseUrl(connectionString, staging) {
  if (!staging) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("sslaccept", "strict");
    url.searchParams.set("sslcert", "/tmp/whr-db-ca.pem");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    throw new Error("Staging database configuration is invalid");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let env;
  try {
    env = databaseEnvironment(process.env);
    if (env.WHR_ENV === "staging") {
      writeFileSync("/tmp/whr-db-ca.pem", env.DATABASE_CA_CERT, {
        mode: 0o600,
      });
    }
  } catch {
    console.error("Staging database configuration is invalid");
    process.exit(1);
  }
  const [command, ...args] = process.argv.slice(2);
  if (!command) process.exit(1);
  const child = spawn(command, args, { env, stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Application process could not start");
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
