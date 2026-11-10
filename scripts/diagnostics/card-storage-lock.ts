// Run only after the local runtime matrix has populated a fresh fixture database.
import pg from "pg";
import { prepareCardExport } from "../../src/server/modules/cards/exports";
const target = new URL(process.env.DATABASE_URL!);
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/whr_app6_whr97_[a-z0-9_]+$/.test(target.pathname)
)
  throw new Error("Use an isolated local WHR-97 fixture database");
const pool = new pg.Pool({ connectionString: target.toString(), max: 2 });
const observer = new pg.Client({ connectionString: target.toString() });
await observer.connect();
try {
  const row = (
    await pool.query(
      "INSERT INTO card_export(id,batch_id,created_by,operation_id,format,batch_version,batch_status,batch_code,batch_name,snapshot_at,status) SELECT gen_random_uuid(),batch_id,created_by,gen_random_uuid(),'xlsx',batch_version,batch_status,batch_code,batch_name,clock_timestamp(),'pending' FROM card_export WHERE format='xlsx' LIMIT 1 RETURNING id",
    )
  ).rows[0];
  if (!row) throw new Error("Run the fixture matrix first");
  let entered!: () => void;
  const writeEntered = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const blocked = new Promise<void>((r) => (release = r));
  const safety = setTimeout(() => release(), 10000);
  const preparation = prepareCardExport(
    pool,
    {
      storage: {
        write: async () => {
          entered();
          await blocked;
        },
        read: async () => new Uint8Array(),
      },
    },
    row.id,
  );
  try {
    await Promise.race([
      writeEntered,
      preparation.then(() => {
        throw new Error("Preparation ended before storage");
      }),
    ]);
    const start = Date.now();
    const waiting = pool
      .query("SELECT id FROM security_state WHERE id=true FOR UPDATE")
      .then(() => Date.now() - start);
    await new Promise((r) => setTimeout(r, 2000));
    console.log(
      JSON.stringify({
        locks: (
          await observer.query(
            "SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
          )
        ).rows,
      }),
    );
    release();
    const securityLockWaitMs = await waiting;
    console.log(
      JSON.stringify({
        securityLockWaitMs,
        preparation: await preparation,
      }),
    );
  } finally {
    release();
    clearTimeout(safety);
    await preparation;
  }
} finally {
  await observer.end();
  await pool.end();
}
