import { database } from "../src/server/lib/db";
import { adminConfig } from "../src/server/modules/admin-access/config";
import { processMail } from "../src/server/modules/admin-access/mail";
const optedIn =
  !!process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER !== "noop";
const pool = optedIn ? database() : undefined;
try {
  for (let n = 0; pool && n < 100; n++) {
    if (!(await processMail(pool, adminConfig())).processed) break;
  }
} catch {
  throw new Error("Admin mail worker failed");
} finally {
  await pool?.end();
}
