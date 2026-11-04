import { expect, it } from "vitest";
import pg from "pg";

it("connects to PostgreSQL and sees the applied empty migration baseline", async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for integration tests");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20261104000000_baseline",
    );
    const probe = await client.query<{ value: number }>(
      "SELECT 1::integer AS value",
    );
    expect(probe.rows[0]?.value).toBe(1);
  } finally {
    await client.end();
  }
});
