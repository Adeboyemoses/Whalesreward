import { recordedTimingPolicy } from "../settings/policy";
import { meterHealth } from "../reviews/meter-config";
import {
  reviewEvidenceConfiguration,
  reviewEvidenceApprovalValid,
} from "../reviews/config";
import { reviewEvidenceV1Installed } from "../reviews/evidence-evaluator";
import {
  healthEnvironmentValid,
  policyConfiguration,
  type Configuration,
} from "./policies";
import { database } from "../../lib/db";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { transaction } from "../../lib/transaction";
import { adminSessionConfig, requirePolicy } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
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

export async function getHealth(
  probe: () => Promise<void> = probeDatabase,
  authorize: (env: Configuration) => Promise<boolean> = async () => false,
  configurationPool?: pg.Pool,
) {
  const env = Object.freeze({ ...process.env });
  const configuration = policyConfiguration(env);
  let ok = true;
  try {
    const policy = reviewEvidenceConfiguration(env);
    if (healthEnvironmentValid(env) && policy && reviewEvidenceV1Installed()) {
      const db = configurationPool ?? database();
      configuration.policies.reviewEvidence =
        (await reviewEvidenceApprovalValid(db, policy))
          ? "configured"
          : "unconfigured";
    }
  } catch {
    ok = false; // Approval storage is part of database readiness.
  }
  try {
    if (healthEnvironmentValid(env) && env.WHR_METER_POLICY)
      configuration.policies.meter = (await transaction(
        configurationPool ?? database(),
        async (db) => await meterHealth(db, env),
      ))
        ? "configured"
        : "unconfigured";
  } catch {
    ok = false;
  }
  try {
    if (healthEnvironmentValid(env)) {
      const db = configurationPool ?? database();
      configuration.policies.timing = await transaction(db, async (client) => {
        await client.query("SET LOCAL statement_timeout='1000ms'");
        return (await recordedTimingPolicy(client))
          ? "configured"
          : "unconfigured";
      });
    }
  } catch {
    ok = false;
  }
  const { policies } = configuration;
  const fullyConfigured = Object.values(policies).every(
    (status) => status === "configured",
  );
  const deployedVersion = env.APP_VERSION || version;
  try {
    await probe();
  } catch {
    ok = false;
  }
  // Probe first: permission revoked during the probe must not expose diagnostics.
  let privileged = false;
  try {
    privileged = healthEnvironmentValid(env) && (await authorize(env));
  } catch {
    /* Public projection on any auth failure. */
  }
  return {
    ok,
    version: deployedVersion,
    db: ok ? "ok" : "unavailable",
    fullyConfigured,
    ...(privileged ? { policies } : {}),
  };
}

export async function healthResponse(
  request: Request,
  dependencies: { probe?: () => Promise<void>; pool?: pg.Pool } = {},
) {
  const health = await getHealth(
    dependencies.probe,
    async (env) => {
      const token = cookieToken(request);
      if (!token) return false;
      requirePolicy(adminSessionConfig(env));
      return transaction(dependencies.pool ?? database(), async (db) => {
        await securityLock(db);
        const actor = await requireAdminSession(db, token);
        requirePermission(actor, "settings");
        return true;
      });
    },
    dependencies.pool,
  );
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", Vary: "Cookie" },
  });
}
