import pg from "pg";
import { v7 } from "uuid";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname) ||
  !url.pathname.startsWith("/whr_admin_nav_")
)
  throw new Error("Use an isolated local admin navigation database");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  const count = Number(
    (await db.query("SELECT count(*) FROM admin")).rows[0].count,
  );
  if (count !== 1 && count !== 10)
    throw new Error("Fixture shape must be freshly seeded or already prepared");
  const owner = (
    await db.query("SELECT id FROM role WHERE is_owner=true LIMIT 1")
  ).rows[0].id;
  if (count === 1)
    for (let i = 0; i < 9; i++) {
      const id = v7(),
        adminId = v7(),
        username = `browser.${id.slice(-12)}`;
      await db.query(
        "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,false,now())",
        [id, username],
      );
      await db.query(
        "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
        [adminId, id, `TEST-${adminId}`, `${username}@example.com`, owner],
      );
    }
  console.log({
    admins: (await db.query("SELECT count(*) FROM admin")).rows[0].count,
    roles: (await db.query("SELECT count(*) FROM role")).rows[0].count,
  });
} finally {
  await db.end();
}
