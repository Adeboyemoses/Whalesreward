import pg from "pg";
let pool: pg.Pool | undefined;
export function database(): pg.Pool {
  if (!process.env.DATABASE_URL)
    throw new Error("Database configuration is unavailable");
  return (pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  }));
}
