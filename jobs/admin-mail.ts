import { database } from "../src/server/lib/db";
import { adminConfig } from "../src/server/modules/admin-access/config";
import { processMail } from "../src/server/modules/admin-access/mail";
const pool = database();
try {
  for (let n = 0; n < 100; n++) {
    if (!(await processMail(pool, adminConfig())).processed) break;
  }
} finally {
  await pool.end();
}
