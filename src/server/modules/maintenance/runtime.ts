import pg from "pg";
import { createSecureContext } from "node:tls";
import { X509Certificate } from "node:crypto";
import { createMaintenanceStorage } from "../../adapters/maintenance-storage.ts";
import { logger } from "../../lib/logger.ts";
import { runMaintenance } from "./service.ts";
import { MaintenanceError, type MaintenanceJob } from "./types.ts";

/** Separate credentials, never the web's broad database/storage credentials. Production TLS waits for WHR-206. */
export function maintenanceDatabaseConfig(
  env: NodeJS.ProcessEnv,
): pg.PoolConfig {
  try {
    const url = new URL(env.MAINTENANCE_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    let ssl: pg.PoolConfig["ssl"];
    if (env.WHR_ENV === "production") throw new Error();
    if (env.WHR_ENV === "staging") {
      if (!env.DATABASE_CA_CERT) throw new Error();
      new X509Certificate(env.DATABASE_CA_CERT);
      createSecureContext({ ca: env.DATABASE_CA_CERT });
      ssl = { ca: env.DATABASE_CA_CERT, rejectUnauthorized: true };
    } else if (!local) throw new Error();
    // pg accepts host, TLS and timeout overrides in connection-string query
    // parameters. Keep only explicit server options (e.g. private search_path).
    for (const key of [...url.searchParams.keys()])
      if (key !== "options") url.searchParams.delete(key);
    return {
      connectionString: url.toString(),
      ssl,
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
      lock_timeout: 3000,
      idle_in_transaction_session_timeout: 15000,
    };
  } catch {
    throw new MaintenanceError("invalid_configuration");
  }
}
function configuredStorage(env: NodeJS.ProcessEnv) {
  const endpoint = env.MAINTENANCE_STORAGE_ENDPOINT,
    region = env.MAINTENANCE_STORAGE_REGION,
    bucket = env.MAINTENANCE_STORAGE_BUCKET,
    accessKeyId = env.MAINTENANCE_STORAGE_ACCESS_KEY_ID,
    secretAccessKey = env.MAINTENANCE_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey)
    throw new MaintenanceError("invalid_configuration");
  return createMaintenanceStorage({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    sessionToken: env.MAINTENANCE_STORAGE_SESSION_TOKEN,
  });
}
export async function maintenanceMain(job: MaintenanceJob) {
  let pool: pg.Pool | undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    pool = new pg.Pool(maintenanceDatabaseConfig(process.env));
    pool.on("error", () =>
      logger.error({ event: "maintenance.database_unavailable", job }),
    );
    const storage = configuredStorage(process.env);
    const result = await runMaintenance({
      pool,
      storage,
      job,
      signal: controller.signal,
    });
    logger.info({ event: "maintenance.finished", job, ...result });
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    const code =
      error instanceof MaintenanceError ? error.code : "invalid_configuration";
    logger.error({ event: "maintenance.failed", job, errorCode: code });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool?.end();
  }
}
