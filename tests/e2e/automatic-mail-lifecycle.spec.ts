import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomBytes, createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { test, expect } from "@playwright/test";
const require = createRequire(import.meta.url);

test("compiled web runtime automatically sends, keeps health responsive and drains real SIGTERM", async () => {
  test.setTimeout(60000);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const schema = `mail_runtime_${randomBytes(8).toString("hex")}`;
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const db = new pg.Pool({ connectionString: url.toString() });
  const secret = randomBytes(32).toString("hex");
  const inbox = "ada.williams@example.com";
  const id = randomUUID();
  let releaseMail: (() => void) | undefined;
  let received = 0;
  let output = "";
  const mail = createServer(async (req, res) => {
    for await (const _ of req) {
      void _;
    }
    received++;
    releaseMail = () => {
      releaseMail = undefined;
      res.writeHead(200);
      res.end("{}");
    };
  });
  let child: ReturnType<typeof spawn> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.query(
        await readFile(
          new URL(`${directory.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await db.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query(
      "UPDATE admin SET verification_generation=1,version=version+1 WHERE admin_code='ADMIN001'",
    );
    const target = createHmac("sha256", secret)
      .update(`admin-email-v1\0${inbox}`)
      .digest("hex");
    await db.query(
      "INSERT INTO mail_request(id,admin_id,purpose,generation,operation_id,target_digest,target_key_version,destination_email) SELECT $1,id,'verify_email',1,$2,$3,'v1',$4 FROM admin WHERE admin_code='ADMIN001'",
      [id, randomUUID(), target, inbox],
    );
    await new Promise<void>((resolve) => mail.listen(0, "127.0.0.1", resolve));
    const address = mail.address();
    if (!address || typeof address === "string")
      throw new Error("Stub unavailable");
    // Reserve a free local web port, then release it for the compiled Next process.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const portAddress = probe.address();
    if (!portAddress || typeof portAddress === "string")
      throw new Error("Port unavailable");
    const port = portAddress.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    child = spawn(
      process.execPath,
      [
        "scripts/deploy/entrypoint.mjs",
        process.execPath,
        require.resolve("next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          WHR_ENV: "local",
          EMAIL_PROVIDER: "mailpit",
          MAILPIT_URL: `http://127.0.0.1:${address.port}`,
          DATABASE_URL: url.toString(),
          BETTER_AUTH_SECRET: secret,
          BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
          WHR_ADMIN_RECEIPT_KEYS: undefined,
          WHR_ADMIN_RECEIPT_KEY_VERSION: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout!.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr!.on("data", (chunk) => {
      output += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", resolve);
    });
    await expect.poll(() => received, { timeout: 10000 }).toBe(1);
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
    expect(
      (await db.query("SELECT status FROM mail_request WHERE id=$1", [id]))
        .rows[0].status,
    ).toBe("sending");
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(child.exitCode).toBeNull(); // Native cleanup must wait for acknowledgement.
    releaseMail!();
    const exit = await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Server failed to drain")), 15000),
      ),
    ]);
    expect(exit).toBe(143);
    expect(received).toBe(1);
    expect(
      (
        await db.query("SELECT status,attempts FROM mail_request WHERE id=$1", [
          id,
        ])
      ).rows[0],
    ).toEqual({ status: "sent", attempts: 1 });
    expect(output).toContain('"event":"email.loop_shutdown","errors":0');
    expect(output).not.toContain(inbox);
    expect(output).not.toContain(secret);
  } finally {
    clearTimeout(deadline);
    releaseMail?.();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child!.once("close", resolve));
    }
    mail.closeAllConnections();
    await new Promise<void>((resolve) => mail.close(() => resolve()));
    await db.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  }
});
