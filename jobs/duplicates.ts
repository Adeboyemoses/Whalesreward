import { database } from "../src/server/lib/db";
import { runDuplicateBatch } from "../src/server/modules/duplicates/service";
const pool = database();
try {
  for (
    let batches = 0;
    batches < 100 && (await runDuplicateBatch(pool));
    batches++
  );
} finally {
  await pool.end();
}
