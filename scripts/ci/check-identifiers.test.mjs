import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource, applyAllowlist } from "./check-identifiers.mjs";

const random = "random" + "UUID";
const sqlV4 = "gen_random_" + "uuid";
const extensionV4 = "uuid_generate_" + "v4";
const coreV4 = "uuid" + "v4";

for (const source of [
  `crypto.${random}()`,
  `crypto["${random}"]()`,
  `const generate = crypto.${random}; generate()`,
  `import { ${random} as generate } from "node:crypto"; generate()`,
  `const { ${random}: generate } = require("crypto"); generate()`,
  'import { v4 as generate } from "uuid"; generate()',
  'import * as uuid from "uuid"; uuid.v4()',
  'const { v4: generate } = require("uuid"); generate()',
  'const { v4 } = require("uuid"); v4()',
  'export { v4 as newId } from "uuid"',
  'require("uuid")["v4"]()',
  `db.query("INSERT INTO item(id) VALUES(pg_catalog.${sqlV4}())")`,
  `db.query(\`SELECT pg_catalog."${coreV4}" /* gap */ -- rationale\n ()\`);`,
]) {
  test(`rejects TypeScript generator: ${source}`, () => {
    assert.ok(scanSource("src/example.ts", source).length > 0);
  });
}

for (const source of [
  `CREATE TABLE item(id uuid DEFAULT ${sqlV4}());`,
  `CREATE TABLE item(id uuid DEFAULT public."${extensionV4}" ());`,
  `CREATE FUNCTION example() RETURNS uuid AS $$ BEGIN RETURN ${sqlV4}(); END $$ LANGUAGE plpgsql;`,
  `CREATE TABLE item(id uuid DEFAULT ${sqlV4} /* generator */ ());`,
  `CREATE TABLE item(id uuid DEFAULT ${sqlV4} -- rationale\n ());`,
  `CREATE TABLE item(id uuid DEFAULT public."${extensionV4}" /* gap */ -- rationale\n /* second gap */ ());`,
  `CREATE TABLE item(id uuid DEFAULT pg_catalog."${coreV4}" -- rationale\r\n ());`,
  "CREATE TABLE item(id uuid DEFAULT " + "uuid" + "v4());",
]) {
  test(`rejects SQL generator: ${source}`, () => {
    assert.ok(scanSource("prisma/migrations/new/migration.sql", source).length);
  });
}

test("embedded SQL comments do not conceal generators or alter source evidence", () => {
  const source = `db.query(\`SELECT ${sqlV4} -- rationale\n ()\`);`;
  const findings = scanSource("src/example.ts", source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].source, source.split("\n")[0]);
  assert.equal(findings[0].line, 1);
  assert.equal(
    scanSource(
      "src/example.ts",
      `const watermark = "-- fictional"; db.query("SELECT ${sqlV4}()");`,
    ).length,
    1,
  );
});

for (const source of [
  "id String @id @default(uuid())",
  "id String @id @default(uuid(4))",
]) {
  test(`rejects Prisma v4 default: ${source}`, () => {
    assert.ok(scanSource("prisma/schema.prisma", source).length);
  });
}

test("accepts canonical v7 generators and validators", () => {
  for (const [path, source] of [
    ["src/id.ts", 'import { v7 } from "uuid"; v7(); z.uuidv4(); z.uuidv7()'],
    ["migration.sql", "SELECT whr_uuid_v7()"],
    ["schema.prisma", "id String @id @default(uuid(7))"],
  ])
    assert.deepEqual(scanSource(path, source), []);
});

test("allowlist is exact, counted, justified and expires when removed", () => {
  const path = "src/path.ts",
    source = `const key = crypto.${random}();`;
  const findings = scanSource(path, source);
  const entry = {
    path,
    source,
    count: 1,
    reason: "Random storage object key, never an entity ID.",
  };
  assert.deepEqual(applyAllowlist(findings, [entry]), []);
  assert.ok(applyAllowlist(scanSource(path, source + source), [entry]).length);
  assert.ok(
    applyAllowlist(scanSource(path, source.replace("key", "id")), [entry])
      .length,
  );
  assert.ok(applyAllowlist([], [entry]).length);
  assert.ok(applyAllowlist(findings, [{ ...entry, reason: "" }]).length);
  assert.ok(applyAllowlist(findings, [{ ...entry, path: "**" }]).length);
});
