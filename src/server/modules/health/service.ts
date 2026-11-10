import { cardPrintLayout } from "../cards/config";
import pg from "pg";
import { version } from "../../../../package.json";

let pool: pg.Pool | undefined;

async function probeDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 10000,
      query_timeout: 1500,
      statement_timeout: 1000,
      allowExitOnIdle: true,
    });
    // Idle connection errors must not crash the health process.
    pool.on("error", () => {});
  }
  await pool.query("SELECT 1");
}

export async function getHealth(probe: () => Promise<void> = probeDatabase) {
  const cardPrint = cardPrintLayout() ? "configured" : "unconfigured";
  const deployedVersion = process.env.APP_VERSION || version;
  try {
    await probe();
    return { ok: true, version: deployedVersion, db: "ok", cardPrint };
  } catch {
    return {
      ok: false,
      version: deployedVersion,
      db: "unavailable",
      cardPrint,
    };
  }
}
