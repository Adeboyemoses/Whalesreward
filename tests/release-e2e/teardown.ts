import pg from "pg";
export default async function teardown() {
  const schema = process.env.WHR_RELEASE_BROWSER_SCHEMA;
  const source = new URL(process.env.DATABASE_URL!);
  if (
    !schema ||
    !/^whr_release_[a-f0-9]{16}$/.test(schema) ||
    !["127.0.0.1", "localhost"].includes(source.hostname)
  )
    throw new Error("Unsafe disposable schema cleanup");
  source.searchParams.delete("options");
  const pool = new pg.Pool({ connectionString: source.href });
  try {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}
