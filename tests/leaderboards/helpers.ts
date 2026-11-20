import {
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { v7 } from "uuid";
import { stationFixture, seedId } from "../station/helpers";
import { historicalSale } from "../helpers/cards-adversarial-fixture";

export type Campaign = {
  id: string;
  version: number;
  settingsVersionId: string | null;
  dataVersion: string;
  latestSnapshotId: string | null;
};
export type Preview = {
  id: string;
  contentDigest: string;
  guard: ReturnType<typeof guard>;
};
export type Snapshot = {
  id: string;
  number: number;
  previousSnapshotId: string | null;
  reason: string;
};
export const guard = (c: Campaign) => ({
  expectedVersion: c.version,
  expectedSettingsVersionId: c.settingsVersionId,
  expectedDataVersion: c.dataVersion,
  expectedPreviousSnapshotId: c.latestSnapshotId,
});
export async function api<T>(
  page: Pick<Page, "request" | "url">,
  path: string,
  input?: unknown,
  status = 200,
): Promise<T> {
  const response =
    input === undefined
      ? await page.request.get(`/api/admin/${path}`)
      : await page.request.post(`/api/admin/${path}`, {
          headers: { Origin: new URL(page.url()).origin },
          data: input,
        });
  expect(response.status(), `HTTP ${path}: ${await response.text()}`).toBe(
    status,
  );
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()).data as T;
}

/** Real records in the disposable leaderboard schema; all writes stay local. */
export async function leaderboardFixture(page: Page, permissions?: string[]) {
  const f = await stationFixture(page, permissions);
  return leaderboardRecords(page, f);
}
export async function leaderboardRecords(
  page: Pick<Page, "request" | "url">,
  f: Awaited<ReturnType<typeof stationFixture>>,
) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  expect(
    (await pool.query("SELECT current_schema() schema")).rows[0].schema,
  ).toBe(process.env.WHR_LEADERBOARD_TEST_SCHEMA);
  const ids: string[] = [];
  let observer: APIRequestContext | undefined;
  let reads = page;
  // Passive instrumentation must not spend the UI actor's rate-limit budget.
  // This is a separate real, least-privilege session in the guarded local schema;
  // manager/checklist/finalization POSTs below still use the primary browser.
  async function isolateInstrumentationReads() {
    if (observer) throw new Error("Instrumentation reader already created");
    const origin = new URL(page.url()).origin;
    expect(new URL(origin).hostname).toBe("127.0.0.1");
    const roleId = v7(),
      userId = v7(),
      adminId = v7();
    const username = `observer.${userId.slice(-12)}`;
    const password = randomBytes(24).toString("hex");
    await pool.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [roleId, `Fictional leaderboard observer ${roleId}`],
    );
    for (const permission of ["leaderboards", "sales"])
      await pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
        [roleId, permission],
      );
    await pool.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Fictional test observer',true,1,false,now())",
      [userId, username],
    );
    await pool.query(
      "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
      [adminId, userId, `TEST-${adminId}`, `${username}@example.com`, roleId],
    );
    await pool.query(
      "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
      [v7(), userId, await hashPassword(password)],
    );
    observer = await request.newContext({ baseURL: origin });
    const login = await observer.post("/api/admin/sign-in", {
      headers: { Origin: origin, "Idempotency-Key": v7() },
      data: { username, password },
    });
    expect(login.status(), await login.text()).toBe(200);
    reads = { request: observer, url: () => origin };
  }
  async function observe<T>(path: string): Promise<T> {
    return api<T>(reads, path);
  }
  let campaignId: string | null = null;
  async function campaign() {
    return (
      await api<{ campaign: Campaign | null }>(reads, "giveaway/campaign")
    ).campaign!;
  }
  async function sale(options: Parameters<typeof historicalSale>[1] = {}) {
    const row = await historicalSale(pool, options);
    ids.push(row.id);
    if (
      !["received", "photo_pending", "cancelled"].includes(
        options.state ?? "credited",
      )
    ) {
      const observation = v7();
      await pool.query(
        `INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at)
         SELECT $1,$2,$3,id,expected_digest,validated_digest,validated_bytes,$4,clock_timestamp() FROM photo_asset WHERE purchase_id=$3 AND state='validated'`,
        [
          observation,
          seedId(8),
          row.id,
          `fictional/leaderboard/${observation}`,
        ],
      );
      await pool.query(
        "INSERT INTO photo_receipt_fact(asset_id,observation_id,purchase_id,receipt_at) SELECT asset_id,id,purchase_id,receipt_at FROM photo_receipt_observation WHERE id=$1",
        [observation],
      );
    }
    return row;
  }
  async function configure(
    state: "finished" | "before_cutoff" | "grace_open" = "finished",
    options: { reconciliationPolicy?: boolean } = {},
  ) {
    campaignId = v7();
    const settingsId = v7();
    await pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional browser campaign',1,true)",
      [campaignId, seedId(8)],
    );
    await pool.query(
      `INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version)
       VALUES($1,$2,$3,1,'giveaway','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z',statement_timestamp()+$5::int*interval '1 hour',$6,statement_timestamp()+($5::int+$6::int)*interval '1 hour','Africa/Lagos',clock_timestamp(),$4,'Fictional finished browser window','campaign-timing-v1')`,
      [
        settingsId,
        seedId(8),
        campaignId,
        f.adminId,
        state === "before_cutoff" ? 1 : state === "grace_open" ? -1 : 0,
        state === "grace_open" ? 2 : 0,
      ],
    );
    await pool.query(
      "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
      [campaignId, settingsId],
    );
    if (options.reconciliationPolicy !== false)
      await pool.query(
        "INSERT INTO station_reconciliation_policy(station_id,policy_version) VALUES($1,'reconciliation-v1') ON CONFLICT DO NOTHING",
        [seedId(8)],
      );
    return campaign();
  }
  async function phoneCheck(kind: "initial" | "revision" = "initial") {
    if (!campaignId) throw new Error("Configure the fictional campaign first");
    const person = v7();
    const binding = await pool.query(
      "SELECT 1 FROM held_release_person_binding WHERE user_id=$1",
      [f.userId],
    );
    if (!binding.rowCount) {
      await pool.query(
        "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
        [person, seedId(8)],
      );
      await pool.query(
        "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
        [v7(), seedId(8), f.userId, person],
      );
      await api(
        page,
        `giveaway/${campaignId}/reconciliation/manager`,
        {
          operationId: v7(),
          expectedVersion: (await campaign()).version,
          managerAdminId: f.adminId,
          reason: "Fictional browser manager designation",
        },
        201,
      );
    }
    const existing = await api<{ census: { version: number } }>(
      reads,
      `giveaway/${campaignId}/reconciliation/phones`,
    );
    const attendants = (
      await pool.query("SELECT DISTINCT attendant_id FROM assignment")
    ).rows.map((r) => r.attendant_id as string);
    const census = await api<{ census: { version: number } }>(
      page,
      `giveaway/${campaignId}/reconciliation/censuses`,
      {
        operationId: v7(),
        kind,
        reason: "Fictional complete browser census",
        ...guard(await campaign()),
        expectedCensusVersion: existing.census.version,
        phones: [{ label: "Fictional handset", attendantIds: attendants }],
      },
      201,
    );
    const phones = await api<{
      phones: { items: { id: string; version: number }[] };
    }>(reads, `giveaway/${campaignId}/reconciliation/phones`);
    await api(
      page,
      `giveaway/${campaignId}/reconciliation/phone-checks`,
      {
        operationId: v7(),
        kind,
        reason: "Fictional complete phone inspection",
        ...guard(await campaign()),
        expectedCensusVersion: census.census.version,
        entries: phones.phones.items.map((p) => ({
          phoneId: p.id,
          expectedPhoneVersion: p.version,
          result: "empty",
          exclusionId: null,
        })),
      },
      201,
    );
  }
  async function renameCustomer(id: string, name: string) {
    await pool.query(
      "UPDATE customer SET name=$2,version=version+1 WHERE id=$1",
      [id, name],
    );
  }
  async function changeAmount(id: string, amount: string) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const current = (
        await db.query(
          "SELECT current_revision_id FROM purchase WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0].current_revision_id;
      const rid = v7();
      await db.query(
        "UPDATE purchase_revision SET state='superseded' WHERE id=$1",
        [current],
      );
      await db.query(
        `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,evidence_asset_id)
         SELECT $1,purchase_id,revision_number+1,$2,$3,'fictional browser correction',id,'attendant_correction','proposed','Fictional approved source correction',clock_timestamp(),$4::bigint,($4::bigint::numeric/1000000),currency,unit,quantity_precision,basis,$4::bigint,rate_kobo,price_version_id,medium,evidence_asset_id FROM purchase_revision WHERE id=$5`,
        [rid, v7(), seedId(3), amount, current],
      );
      await db.query(
        "UPDATE purchase_revision SET state='accepted',decision_actor_id=$2,decision_reason='Fictional accepted browser correction',decided_at=clock_timestamp() WHERE id=$1",
        [rid, f.userId],
      );
      await db.query(
        "UPDATE purchase SET current_revision_id=$2,version=version+1 WHERE id=$1",
        [id, rid],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  return {
    ...f,
    pool,
    ids,
    isolateInstrumentationReads,
    observe,
    sale,
    campaign,
    configure,
    phoneCheck,
    renameCustomer,
    changeAmount,
    get campaignId() {
      return campaignId;
    },
    async close() {
      await observer?.dispose();
      await pool.end();
      await f.db.end();
    },
  };
}

export async function prepare(page: Page, reason: string, revision = false) {
  await page
    .getByLabel(revision ? "Revision reason" : "Reconciliation reason", {
      exact: true,
    })
    .fill(reason);
  const pending = page.waitForResponse(
    (r) =>
      /\/giveaway\/[^/]+\/previews$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: revision ? "Prepare audited revision" : "Review final snapshot",
      exact: true,
    })
    .click();
  const response = await pending;
  expect([200, 201], await response.text()).toContain(response.status());
  const result = (await response.json()).data;
  // A successful POST precedes navigation and E04's fresh readiness/preview reads.
  // Mutate sources or authority only after the reviewed preview is actionable.
  // Unchanged reconciliation is a receipt on E03, with no confirmation action.
  if (result.state !== "unchanged")
    await expect(
      page.getByRole("button", {
        name: revision
          ? "Confirm and save revision"
          : "Confirm and save snapshot",
        exact: true,
      }),
    ).toBeEnabled();
  return result as Preview;
}
export async function confirm(page: Page, revision = false) {
  const pending = page.waitForResponse(
    (r) =>
      /\/giveaway\/[^/]+\/snapshots(?:\/[^/]+\/revisions)?$/.test(r.url()) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: revision
        ? "Confirm and save revision"
        : "Confirm and save snapshot",
      exact: true,
    })
    .click();
  const response = await pending;
  expect([200, 201], await response.text()).toContain(response.status());
  return (await response.json()).data as Snapshot;
}
