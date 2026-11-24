import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { v7 as newId } from "uuid";
import { z } from "zod";
import { checkDatabaseEnvironment } from "./review-evidence.mjs";
import {
  writeAudit,
  auditSystem,
} from "../../src/server/modules/audit/write.ts";
import { invalidatePersonDependants } from "../../src/server/modules/giveaway/person-invalidation.ts";

export const usage = `Usage: pnpm ops:person create|bind|rebind|unbind|disable|verify|list
  --station UUID --environment development|test|staging|production
  create: --person NEW_UUIDv7
  bind|rebind|verify: --user UUID --person UUID --expected-binding-version N
  unbind: --user UUID --expected-binding-version N
  disable: --person UUID
  verify: --verification-reference OPAQUE_REFERENCE
  Writes: --authorization OPAQUE_REFERENCE --reason-code CODE
  [--dry-run | --apply --expected-revision NEXT_REVISION]
  list: [--user UUID | --person UUID] [--history] [--limit 1..100] [--cursor CURSOR]
  list --revision N: exact private commit reconciliation (no other list options)
Default: read-only dry run. DATABASE_URL must be supplied in your shell only.`;
export class PersonOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "PersonOperatorError";
  }
}
/** @returns {never} */
const fail = (code) => {
  throw new PersonOperatorError(code);
};
const id = z.uuid().transform((v) => v.toLowerCase());
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/);
const inputSchema = z
  .strictObject({
    action: z.enum([
      "create",
      "bind",
      "rebind",
      "unbind",
      "disable",
      "verify",
      "list",
    ]),
    stationId: id,
    environment: z.enum(["development", "test", "staging", "production"]),
    personId: id.nullable(),
    userId: id.nullable(),
    expectedBindingVersion: natural.max(2147483647).nullable(),
    authorizationReference: reference.nullable(),
    reasonCode: z
      .enum([
        "initial_provisioning",
        "alias_link",
        "identity_correction",
        "identity_uncertain",
        "offboarding",
        "verification_completed",
      ])
      .nullable(),
    verificationReference: reference.nullable(),
    apply: z.boolean(),
    expectedRevision: natural.positive().nullable(),
    history: z.boolean(),
    cursor: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable(),
    limit: z.number().int().min(1).max(100),
    revision: natural.positive().nullable(),
  })
  .superRefine((v, ctx) => {
    const bad = () =>
      ctx.addIssue({ code: "custom", message: "invalid_input" });
    if (v.action === "list") {
      if (
        v.apply ||
        v.expectedRevision !== null ||
        v.expectedBindingVersion !== null ||
        v.authorizationReference !== null ||
        v.reasonCode !== null ||
        v.verificationReference !== null ||
        (v.userId && v.personId)
      )
        bad();
      if (
        v.revision !== null &&
        (v.userId || v.personId || v.history || v.cursor || v.limit !== 25)
      )
        bad();
      return;
    }
    if (
      !v.authorizationReference ||
      !v.reasonCode ||
      v.history ||
      v.cursor ||
      v.limit !== 25 ||
      v.revision !== null ||
      (v.apply && v.expectedRevision === null)
    )
      bad();
    if (["create", "disable"].includes(v.action)) {
      if (!v.personId || v.userId || v.expectedBindingVersion !== null) bad();
      if (
        v.action === "create" &&
        v.personId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          v.personId,
        )
      )
        bad();
    } else {
      if (
        !v.userId ||
        v.expectedBindingVersion === null ||
        (v.action !== "unbind" && !v.personId) ||
        (v.action === "unbind" && v.personId)
      )
        bad();
      if (
        v.action === "bind"
          ? v.expectedBindingVersion !== 0
          : v.expectedBindingVersion === 0
      )
        bad();
    }
    if ((v.action === "verify") !== (v.verificationReference !== null)) bad();
    const reasons = {
      create: ["initial_provisioning", "alias_link"],
      bind: ["initial_provisioning", "alias_link"],
      rebind: ["identity_correction"],
      unbind: ["identity_uncertain", "offboarding"],
      disable: ["identity_uncertain", "offboarding"],
      verify: ["verification_completed"],
    };
    if (!reasons[v.action]?.includes(v.reasonCode)) bad();
  });
export function parseArguments(args) {
  let [action, ...flags] = args;
  action =
    { "create-person": "create", "disable-person": "disable" }[action] ??
    action;
  const switches = new Set(["--apply", "--dry-run", "--history"]);
  const valued = new Set([
    "--station",
    "--environment",
    "--person",
    "--user",
    "--expected-binding-version",
    "--authorization",
    "--reason-code",
    "--verification-reference",
    "--expected-revision",
    "--cursor",
    "--limit",
    "--revision",
  ]);
  const values = new Map();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (values.has(flag)) fail("invalid_arguments");
    if (switches.has(flag)) values.set(flag, true);
    else if (valued.has(flag) && flags[i + 1]) values.set(flag, flags[++i]);
    else fail("invalid_arguments");
  }
  if (values.has("--apply") && values.has("--dry-run"))
    fail("invalid_arguments");
  const num = (flag) => {
    if (!values.has(flag)) return null;
    const raw = values.get(flag);
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail("invalid_arguments");
    return Number(raw);
  };
  if (action === "list" && (values.has("--apply") || values.has("--dry-run")))
    fail("invalid_arguments");
  if (
    action !== "list" &&
    ["--history", "--cursor", "--limit", "--revision"].some((k) =>
      values.has(k),
    )
  )
    fail("invalid_arguments");
  if (
    values.has("--revision") &&
    ["--user", "--person", "--history", "--cursor", "--limit"].some((k) =>
      values.has(k),
    )
  )
    fail("invalid_arguments");
  return validateInput({
    action,
    stationId: values.get("--station"),
    environment: values.get("--environment"),
    personId: values.get("--person") ?? null,
    userId: values.get("--user") ?? null,
    expectedBindingVersion: num("--expected-binding-version"),
    authorizationReference: values.get("--authorization") ?? null,
    reasonCode: values.get("--reason-code") ?? null,
    verificationReference: values.get("--verification-reference") ?? null,
    apply: values.has("--apply"),
    expectedRevision: num("--expected-revision"),
    history: values.has("--history"),
    cursor: values.get("--cursor") ?? null,
    limit: num("--limit") ?? 25,
    revision: num("--revision"),
  });
}
function validateInput(input) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) fail("invalid_input");
  return parsed.data;
}
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function scope(db, input) {
  await checkDatabaseEnvironment(db, input.environment).catch(() =>
    fail("database_identity_mismatch"),
  );
  const rows = (await db.query("SELECT id FROM station ORDER BY id")).rows;
  if (rows.length !== 1 || rows[0].id !== input.stationId)
    fail("station_scope_invalid");
}
async function inventory(db, stationId) {
  // Fetch only safe identifiers/state. Profiles and evidence are never selected.
  const accounts = await db.query(
    "SELECT u.id,u.kind,u.enabled,(a.id IS NOT NULL) is_admin FROM auth_user u LEFT JOIN admin a ON a.user_id=u.id ORDER BY u.id",
  );
  const people = await db.query(
    "SELECT id FROM held_release_person WHERE station_id=$1 ORDER BY id",
    [stationId],
  );
  const bindings = await db.query(
    "SELECT id,user_id,person_id,version,verified FROM held_release_person_binding WHERE station_id=$1 ORDER BY user_id,version",
    [stationId],
  );
  const latest = new Map();
  for (const b of bindings.rows) {
    const previous = latest.get(b.user_id);
    if (b.version !== (previous?.version ?? 0) + 1)
      fail("binding_history_inconsistent");
    latest.set(b.user_id, b);
  }
  return {
    accounts: accounts.rows,
    people: people.rows,
    bindings: bindings.rows,
    latest,
    fingerprint: digest([accounts.rows, people.rows, bindings.rows]),
  };
}
function counts(inv, changes = []) {
  const latest = new Map(inv.latest);
  for (const b of changes)
    latest.set(b.userId, { person_id: b.personId, verified: b.verified });
  const enabled = inv.accounts.filter((a) => a.enabled);
  return {
    enabledAccountGaps: enabled.filter((a) => !latest.get(a.id)?.verified)
      .length,
    distinctVerifiedEnabledAdmins: new Set(
      enabled
        .filter((a) => a.is_admin && latest.get(a.id)?.verified)
        .map((a) => latest.get(a.id).person_id),
    ).size,
  };
}
async function revision(db, input) {
  const row = (
    await db.query(
      "SELECT coalesce(max(revision),0)::text revision FROM person_provisioning_event WHERE station_id=$1 AND environment=$2",
      [input.stationId, input.environment],
    )
  ).rows[0];
  const current = BigInt(row.revision);
  if (current > BigInt(Number.MAX_SAFE_INTEGER)) fail("revision_exhausted");
  return Number(current);
}
function rowKey(row) {
  return [row.personId ?? "", row.userId ?? "", row.version ?? 0, row.id ?? ""];
}
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
async function list(db, input, rev, inv) {
  if (input.revision !== null) {
    const event = (
      await db.query(
        "SELECT id,station_id,environment,revision::text,action,actor_code,authorization_reference,reason_code,person_id,user_id,verification_reference,recorded_at FROM person_provisioning_event WHERE station_id=$1 AND environment=$2 AND revision=$3",
        [input.stationId, input.environment, input.revision],
      )
    ).rows[0];
    if (!event) return { result: "not_recorded", revision: input.revision };
    const bindings = (
      await db.query(
        "SELECT c.user_id,b.id,b.person_id,b.version,b.verified,o.id old_binding_id,o.person_id old_person_id,o.version old_version,o.verified old_verified FROM person_provisioning_binding c JOIN held_release_person_binding b ON b.id=c.new_binding_id LEFT JOIN held_release_person_binding o ON o.id=c.old_binding_id WHERE c.event_id=$1 ORDER BY c.user_id",
        [event.id],
      )
    ).rows;
    const campaigns = (
      await db.query(
        "SELECT campaign_id,old_version,new_version,old_data_version::text,new_data_version::text,manager_cleared FROM person_provisioning_campaign WHERE event_id=$1 ORDER BY campaign_id",
        [event.id],
      )
    ).rows;
    return {
      result: "recorded",
      revision: input.revision,
      event,
      bindings,
      campaigns,
    };
  }
  const accounts = new Map(inv.accounts.map((a) => [a.id, a]));
  const selected = input.history ? inv.bindings : [...inv.latest.values()];
  const rows = selected.map((b) => ({
    id: b.id,
    personId: b.person_id,
    userId: b.user_id,
    version: b.version,
    verified: b.verified,
    enabled: accounts.get(b.user_id)?.enabled ?? false,
    kind: accounts.get(b.user_id)?.kind ?? null,
    effective: inv.latest.get(b.user_id)?.id === b.id,
  }));
  for (const a of inv.accounts)
    if (!inv.latest.has(a.id))
      rows.push({
        id: null,
        personId: null,
        userId: a.id,
        version: 0,
        verified: false,
        enabled: a.enabled,
        kind: a.kind,
        effective: true,
      });
  const associated = new Set(selected.map((b) => b.person_id));
  for (const p of inv.people)
    if (!associated.has(p.id))
      rows.push({
        id: p.id,
        personId: p.id,
        userId: null,
        version: null,
        verified: false,
        enabled: null,
        kind: null,
        effective: true,
      });
  let filtered = rows
    .filter(
      (r) =>
        (!input.userId || r.userId === input.userId) &&
        (!input.personId || r.personId === input.personId),
    )
    .sort((a, b) => compareKeys(rowKey(a), rowKey(b)));
  const binding = digest([
    input.stationId,
    input.environment,
    input.userId,
    input.personId,
    input.history,
    rev,
    inv.fingerprint,
  ]);
  if (input.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      );
    } catch {
      fail("cursor_invalid");
    }
    if (
      !cursor ||
      Object.keys(cursor).sort().join(",") !== "binding,key" ||
      cursor.binding !== binding ||
      !Array.isArray(cursor.key) ||
      cursor.key.length !== 4 ||
      typeof cursor.key[0] !== "string" ||
      typeof cursor.key[1] !== "string" ||
      !Number.isSafeInteger(cursor.key[2]) ||
      typeof cursor.key[3] !== "string"
    )
      fail("cursor_stale");
    if (!filtered.some((r) => compareKeys(rowKey(r), cursor.key) === 0))
      fail("cursor_invalid");
    filtered = filtered.filter((r) => compareKeys(rowKey(r), cursor.key) > 0);
  }
  const page = filtered.slice(0, input.limit);
  const nextCursor =
    filtered.length > input.limit
      ? Buffer.from(
          JSON.stringify({ binding, key: rowKey(page.at(-1)) }),
        ).toString("base64url")
      : null;
  return {
    result: "inventory",
    scope: { stationId: input.stationId, environment: input.environment },
    revision: rev,
    rows: page,
    nextCursor,
    ...counts(inv),
  };
}
async function plan(db, input, inv) {
  const current = input.userId ? inv.latest.get(input.userId) : null;
  if (input.userId && !inv.accounts.some((a) => a.id === input.userId))
    fail("target_not_found");
  if (
    input.action !== "create" &&
    input.personId &&
    !inv.people.some((p) => p.id === input.personId)
  )
    fail("target_not_found");
  if (input.action === "create") {
    if (
      (
        await db.query("SELECT 1 FROM held_release_person WHERE id=$1", [
          input.personId,
        ])
      ).rowCount
    )
      fail("person_exists");
    return { personId: input.personId, bindings: [], noChange: false };
  }
  if (input.action === "disable") {
    const aliases = [...inv.latest.values()]
      .filter((b) => b.person_id === input.personId && b.verified)
      .sort((a, b) => a.user_id.localeCompare(b.user_id));
    return {
      personId: input.personId,
      bindings: aliases.map((b) => successor(b, b.person_id, false)),
      noChange: aliases.length === 0,
    };
  }
  if (input.expectedBindingVersion !== (current?.version ?? 0))
    fail("binding_version_conflict");
  if (input.action === "bind" && current) fail("binding_history_exists");
  if (input.action !== "bind" && !current) fail("binding_missing");
  const personId = input.personId ?? current.person_id;
  const verified = input.action === "verify";
  if (input.action === "verify" && current.person_id !== personId)
    fail("binding_person_mismatch");
  if (
    (input.action === "rebind" && current.person_id === personId) ||
    (input.action === "verify" && current.verified) ||
    (input.action === "unbind" && !current.verified)
  )
    return { personId, bindings: [], noChange: true };
  return {
    personId,
    bindings: [
      current
        ? successor(current, personId, verified)
        : {
            id: newId(),
            userId: input.userId,
            personId,
            version: 1,
            verified: false,
            oldBindingId: null,
            oldVersion: null,
            oldVerified: null,
          },
    ],
    noChange: false,
  };
}
function successor(current, personId, verified) {
  if (current.version >= 2147483647) fail("binding_version_exhausted");
  return {
    id: newId(),
    userId: current.user_id,
    personId,
    version: current.version + 1,
    verified,
    oldBindingId: current.id,
    oldVersion: current.version,
    oldVerified: current.verified,
  };
}
function applyCommand(input, rev) {
  const args = [
    "pnpm ops:person",
    input.action,
    "--station",
    input.stationId,
    "--environment",
    input.environment,
  ];
  for (const [flag, value] of [
    ["--person", input.personId],
    ["--user", input.userId],
    ["--expected-binding-version", input.expectedBindingVersion],
    ["--authorization", input.authorizationReference],
    ["--reason-code", input.reasonCode],
    ["--verification-reference", input.verificationReference],
  ])
    if (value !== null) args.push(flag, String(value));
  return [...args, "--apply", "--expected-revision", String(rev)].join(" ");
}
/** Operator replies are action-specific JSON objects rather than app contracts.
 * Kept dynamic at this JS-only API boundary; tests inspect the result category.
 * @returns {Promise<any>}
 */
export async function operate(pool, rawInput) {
  const input = validateInput(rawInput);
  let db;
  try {
    db = await pool.connect();
  } catch {
    fail("database_unavailable");
  }
  let committing = false;
  try {
    await db.query(
      input.apply
        ? "BEGIN ISOLATION LEVEL READ COMMITTED"
        : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    // The security row is shared with runtime authorities and release activation.
    if (input.apply) {
      const locked = await db.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      if (locked.rowCount !== 1) fail("security_state_missing");
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('person-provisioning:'||$1::text||':'||$2::text,0))",
        [input.stationId, input.environment],
      );
    }
    await scope(db, input);
    if (input.apply && input.action !== "create") {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
        [input.stationId],
      );
      const state = await db.query(
        "SELECT station_id FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
        [input.stationId],
      );
      if (state.rowCount !== 1) fail("reporting_state_missing");
      await db.query(
        "SELECT id FROM campaign WHERE station_id=$1 ORDER BY id FOR UPDATE",
        [input.stationId],
      );
    }
    const rev = await revision(db, input);
    const inv = await inventory(db, input.stationId);
    if (input.action === "list") {
      const result = await list(db, input, rev, inv);
      await db.query("ROLLBACK");
      return result;
    }
    const next = rev + 1;
    if (!Number.isSafeInteger(next)) fail("revision_exhausted");
    if (input.expectedRevision !== null && input.expectedRevision !== next)
      fail("revision_conflict");
    const intended = await plan(db, input, inv);
    const campaigns = intended.bindings.length
      ? (
          await db.query(
            "SELECT c.id,c.version,EXISTS(SELECT 1 FROM giveaway_manager_designation d JOIN admin a ON a.id=d.manager_admin_id WHERE d.id=c.manager_designation_id AND a.user_id=ANY($2::uuid[])) manager_cleared FROM campaign c WHERE c.station_id=$1 ORDER BY c.id",
            [input.stationId, intended.bindings.map((b) => b.userId)],
          )
        ).rows
      : [];
    const summary = {
      scope: { stationId: input.stationId, environment: input.environment },
      revision: next,
      action: input.action,
      personId: intended.personId,
      bindings: intended.bindings,
      ...counts(inv, intended.bindings),
      invalidationCount: campaigns.length,
      managerClearanceCount: campaigns.filter((c) => c.manager_cleared).length,
    };
    if (intended.noChange) {
      await db.query("ROLLBACK");
      return { ...summary, result: "no_change" };
    }
    if (!input.apply) {
      await db.query("ROLLBACK");
      return {
        ...summary,
        result: "preview",
        applyCommand: applyCommand(input, next),
      };
    }
    // Recheck persisted identity inside the same write transaction immediately before mutation.
    await scope(db, input);
    if (input.action === "create")
      await db.query(
        "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
        [intended.personId, input.stationId],
      );
    for (const b of intended.bindings)
      await db.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,$5,$6)",
        [b.id, input.stationId, b.userId, b.personId, b.version, b.verified],
      );
    const invalidation = intended.bindings.length
      ? await invalidatePersonDependants(
          db,
          input.stationId,
          intended.bindings.map((b) => b.userId),
        )
      : { campaigns: [] };
    const eventId = newId();
    await db.query(
      "INSERT INTO person_provisioning_event(id,station_id,environment,revision,action,authorization_reference,reason_code,person_id,user_id,verification_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        eventId,
        input.stationId,
        input.environment,
        next,
        input.action,
        input.authorizationReference,
        input.reasonCode,
        intended.personId,
        input.userId,
        input.verificationReference,
      ],
    );
    for (const b of intended.bindings)
      await db.query(
        "INSERT INTO person_provisioning_binding(event_id,user_id,old_binding_id,new_binding_id) VALUES($1,$2,$3,$4)",
        [eventId, b.userId, b.oldBindingId, b.id],
      );
    for (const c of invalidation.campaigns)
      await db.query(
        "INSERT INTO person_provisioning_campaign(event_id,campaign_id,old_version,new_version,old_data_version,new_data_version,manager_cleared) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          eventId,
          c.id,
          c.oldVersion,
          c.version,
          c.oldDataVersion,
          c.dataVersion,
          c.managerCleared,
        ],
      );
    const actions = {
      create: "person_created",
      bind: "person_account_bound",
      rebind: "person_account_rebound",
      unbind: "person_account_unbound",
      disable: "person_bindings_disabled",
      verify: "person_binding_verified",
    };
    await writeAudit(db, {
      stationId: input.stationId,
      action: actions[input.action],
      actor: auditSystem("person-provisioning"),
      target: {
        kind: "person_provisioning_event",
        id: eventId,
        code: `PERSON-${eventId}`,
        subjectAtEvent: null,
      },
      reason: "Person provisioning recorded",
      before: null,
      after: {
        provisioningEventId: eventId,
        canonicalPersonId: intended.personId,
        provisioningRevision: String(next),
        provisioningBindingCount: String(intended.bindings.length),
        authorizationReference: input.authorizationReference,
        provisioningReasonCode: input.reasonCode,
      },
    });
    committing = true;
    await db.query("COMMIT");
    return { ...summary, result: "applied", eventId };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (committing) fail("commit_unknown");
    if (error instanceof PersonOperatorError) throw error;
    // Driver details can carry connection strings or SQL values. Never expose them.
    fail("operation_failed");
  } finally {
    db.release();
  }
}
export function formatResult(result) {
  return JSON.stringify(result);
}
export async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return 0;
  }
  let pool;
  try {
    const input = parseArguments(args);
    if (!process.env.DATABASE_URL) fail("database_url_required");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      lock_timeout: 10000,
      idle_in_transaction_session_timeout: 20000,
    });
    pool.on("error", () => {});
    console.log(formatResult(await operate(pool, input)));
    return 0;
  } catch (error) {
    console.error(
      error instanceof PersonOperatorError ? error.message : "operation_failed",
    );
    return 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));
