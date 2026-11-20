import { createHash, createHmac } from "node:crypto";
import pg from "pg";
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { newId } from "../../src/server/lib/ids";
import { evidenceDatabase } from "./review-evidence-fixture";

const endpoint =
  process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
const region = "us-east-1";
const credentials = {
  accessKeyId: "whr-local",
  secretAccessKey: "local-development-only",
};
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const mac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();

/** Local MinIO STS session has an explicit read-only policy; root is used only
 * to arrange fictional objects. No stored credential or environment file is read. */
async function readOnlySession(bucket: string) {
  const body = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    DurationSeconds: "3600",
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:ListBucket", "s3:ListBucketVersions"],
          Resource: [`arn:aws:s3:::${bucket}`],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetObjectVersion"],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    }),
  }).toString();
  const time = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = time.slice(0, 8);
  const host = new URL(endpoint).host;
  const signed = "content-type;host;x-amz-content-sha256;x-amz-date";
  const headers = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-content-sha256:${hash(body)}\nx-amz-date:${time}\n`;
  const canonical = `POST\n/\n\n${headers}\n${signed}\n${hash(body)}`;
  const scope = `${date}/${region}/sts/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${time}\n${scope}\n${hash(canonical)}`;
  const key = mac(
    mac(mac(mac(`AWS4${credentials.secretAccessKey}`, date), region), "sts"),
    "aws4_request",
  );
  const signature = createHmac("sha256", key)
    .update(stringToSign)
    .digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Amz-Date": time,
      "X-Amz-Content-Sha256": hash(body),
      Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Local STS fixture rejected (${response.status})`);
  const xml = await response.text();
  const value = (name: string) => {
    const match = new RegExp(`<${name}>([^<]+)</${name}>`).exec(xml);
    if (!match?.[1]) throw new Error("Local STS fixture response invalid");
    return match[1];
  };
  return {
    accessKeyId: value("AccessKeyId"),
    secretAccessKey: value("SecretAccessKey"),
    sessionToken: value("SessionToken"),
  };
}

export async function maintenanceFixture() {
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !process.env.DATABASE_URL ||
    !local.has(new URL(process.env.DATABASE_URL).hostname) ||
    !local.has(new URL(endpoint).hostname)
  )
    throw new Error("Maintenance fixtures require local PostgreSQL and MinIO");
  const db = await evidenceDatabase();
  const schema = (await db.pool.query("SELECT current_schema() AS s")).rows[0]
    .s as string;
  const user = (
    await db.pool.query(
      "SELECT current_user AS u,rolsuper FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  const role = user.rolsuper
    ? `maintenance_${newId().replaceAll("-", "")}`
    : "whr210_runtime";
  if (user.rolsuper) {
    await db.pool.query(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await db.pool.query(`GRANT ${role} TO ${user.u}`);
  }
  await db.pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await db.pool.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`,
  );
  await db.pool.query(
    `GRANT INSERT,UPDATE ON maintenance_run,maintenance_job TO ${role}`,
  );
  await db.pool.query(
    `GRANT INSERT ON maintenance_object,maintenance_finding,maintenance_page TO ${role}`,
  );
  const runtime = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public -c role=${role}`,
    max: 6,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    lock_timeout: 3000,
    query_timeout: 6000,
  });
  const bucket = `maintenance-${newId()}`;
  const admin = new S3Client({
    endpoint,
    region,
    credentials,
    forcePathStyle: true,
  });
  await admin.send(new CreateBucketCommand({ Bucket: bucket }));
  await admin.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  const session = await readOnlySession(bucket);
  const storageConfig = {
    endpoint,
    region,
    bucket,
    ...session,
    forcePathStyle: true,
  };
  const reader = new S3Client({
    endpoint,
    region,
    credentials: session,
    forcePathStyle: true,
  });
  return {
    ...db,
    runtime,
    schema,
    role,
    bucket,
    admin,
    reader,
    storageConfig,
    async put(key: string, bytes: Buffer) {
      return admin.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }),
      );
    },
    async versions() {
      const result = await admin.send(
        new ListObjectVersionsCommand({ Bucket: bucket }),
      );
      return (result.Versions ?? [])
        .map((v) => ({ key: v.Key, version: v.VersionId, size: v.Size }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    },
    async bytes(key: string, versionId?: string) {
      const result = await admin.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
        }),
      );
      return Buffer.from(await result.Body!.transformToByteArray());
    },
    async domainDigest() {
      const tables = (
        await db.pool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' AND table_name NOT LIKE 'maintenance_%' ORDER BY table_name",
          [schema],
        )
      ).rows;
      const digest = createHash("sha256");
      for (const { table_name: table } of tables) {
        if (!/^[a-z_]+$/.test(table)) throw new Error("Unsafe fixture table");
        const rows = await db.pool.query(
          `SELECT to_jsonb(t)::text AS content FROM ${table} t ORDER BY to_jsonb(t)::text`,
        );
        digest.update(table).update(JSON.stringify(rows.rows));
      }
      return digest.digest("hex");
    },
    async close() {
      reader.destroy();
      admin.destroy();
      await runtime.end();
      await db.close();
      if (user.rolsuper) {
        const root = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
        });
        await root.query(`DROP ROLE ${role}`);
        await root.end();
      }
    },
  };
}
