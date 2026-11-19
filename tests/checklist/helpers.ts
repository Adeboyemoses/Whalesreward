import {
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import { fixture } from "../admin-access/admin-access.fixtures";
import {
  leaderboardRecords,
  api,
  guard,
  type Campaign,
} from "../leaderboards/helpers";
import { seedId } from "../station/helpers";
import {
  checklistProjectionSchema,
  managerSelectionSchema,
  attendantSelectionSchema,
  phoneSelectionSchema,
  incompleteSelectionSchema,
} from "../../src/shared/contracts/giveaway-projections";

export { api, guard };
export async function checklistFixture(
  client: APIRequestContext,
  origin: string,
) {
  const identity = await fixture();
  await identity.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [identity.userId],
  );
  const login = await client.post("/api/admin/sign-in", {
    headers: {
      Origin: origin,
      "Idempotency-Key": v7(),
      "x-test-ip": `2001:db8::${v7().slice(-4)}`,
    },
    data: { username: identity.username, password: identity.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const actor = { request: client, url: () => origin };
  const f = await leaderboardRecords(actor, identity);
  const contexts: APIRequestContext[] = [];
  async function bind(userId: string, personId = v7()) {
    await f.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [personId, seedId(8)],
    );
    await f.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
      [v7(), seedId(8), userId, personId],
    );
    return personId;
  }
  const personId = await bind(identity.userId);
  async function otherActor(
    permissions: string[] = [
      "sales",
      "leaderboards",
      "giveawayFinalize",
      "giveawayRevise",
    ],
    samePerson = false,
    owner = false,
  ) {
    const roleId = v7(),
      userId = v7(),
      adminId = v7();
    const username = `checklist.${userId.slice(-12)}`,
      password = randomBytes(24).toString("hex");
    await f.pool.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,$3,true,1)",
      [roleId, `Fictional checklist role ${roleId}`, owner],
    );
    for (const p of permissions)
      await f.pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
        [roleId, p],
      );
    await f.pool.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Fictional independent reviewer',true,1,false,now())",
      [userId, username],
    );
    await f.pool.query(
      "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
      [adminId, userId, `CHECK-${adminId}`, `${username}@example.com`, roleId],
    );
    await f.pool.query(
      "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
      [v7(), userId, await hashPassword(password)],
    );
    await bind(userId, samePerson ? personId : undefined);
    const context = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { "x-test-ip": `2001:db8::${userId.slice(-4)}` },
    });
    contexts.push(context);
    const r = await context.post("/api/admin/sign-in", {
      headers: { Origin: origin, "Idempotency-Key": v7() },
      data: { username, password },
    });
    expect(r.status(), await r.text()).toBe(200);
    return {
      request: context,
      url: () => origin,
      userId,
      adminId,
      roleId,
      username,
      password,
    };
  }
  async function checklist() {
    return checklistProjectionSchema.parse(
      await api(actor, `giveaway/${f.campaignId}/reconciliation/checklist`),
    );
  }
  async function designate() {
    const choices = managerSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/managers`,
      ),
    );
    expect(choices.items.map((i) => i.adminId)).toContain(identity.adminId);
    return api<{ campaign: Campaign }>(
      actor,
      `giveaway/${f.campaignId}/reconciliation/manager`,
      {
        operationId: v7(),
        expectedVersion: choices.view.guard.expectedVersion,
        managerAdminId: identity.adminId,
        reason: "Fictional station manager for checklist smoke",
      },
      201,
    );
  }
  async function census(label = "Fictional checklist handset") {
    const first = attendantSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/attendants?limit=1`,
      ),
    );
    const attendants = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = attendantSelectionSchema.parse(
        await api(
          actor,
          `giveaway/${f.campaignId}/reconciliation/selection/attendants?${new URLSearchParams({ limit: "1", expectedView: first.view.viewToken, cursor })}`,
        ),
      );
      expect(next.view.viewToken).toBe(first.view.viewToken);
      attendants.push(...next.items);
      cursor = next.nextCursor;
    }
    const body = {
      operationId: v7(),
      kind: first.view.kind,
      reason: "Fictional full physical census including ended assignments",
      ...first.view.guard,
      expectedCensusVersion: first.view.censusVersion,
      phones: [{ label, attendantIds: attendants.map((a) => a.attendantId) }],
    };
    const receipt = await api(
      actor,
      `giveaway/${f.campaignId}/reconciliation/censuses`,
      body,
      201,
    );
    const phones = phoneSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    expect(phones.items).toHaveLength(1);
    return { receipt, phones, attendants, body };
  }
  async function propose(phoneId: string, purchaseIds: string[] = []) {
    const sources = incompleteSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones/${phoneId}/incomplete-sources`,
      ),
    );
    const phones = phoneSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones?${new URLSearchParams({ expectedView: sources.view.viewToken })}`,
      ),
    );
    const phone = phones.items.find((p) => p.id === phoneId)!;
    const selected = purchaseIds.map((id) =>
      sources.items.find((s) => s.purchaseId === id)!,
    );
    expect(selected.every(Boolean)).toBe(true);
    const body = {
      operationId: v7(),
      kind: sources.view.kind,
      reason: "Fictional lost handset independently checked",
      ...sources.view.guard,
      expectedCensusVersion: sources.view.censusVersion,
      expectedPhoneVersion: phone.version,
      partialSources: selected.map((s) => ({
        purchaseId: s.purchaseId,
        expectedPurchaseVersion: s.purchaseVersion,
      })),
    };
    const result = await api<{
      exclusion: {
        id: string;
        version: number;
        state: string;
        partialSources: unknown[];
      };
      campaign: Campaign;
    }>(
      actor,
      `giveaway/${f.campaignId}/reconciliation/phones/${phoneId}/exclusions`,
      body,
      201,
    );
    return { result, body, sources };
  }
  async function certify(phoneId: string, exclusionId: string | null = null) {
    const phones = phoneSelectionSchema.parse(
      await api(
        actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    const phone = phones.items.find((p) => p.id === phoneId)!;
    const body = {
      operationId: v7(),
      kind: phones.view.kind,
      reason: "Fictional complete physical phone inspection",
      ...phones.view.guard,
      expectedCensusVersion: phones.view.censusVersion,
      entries: [
        {
          phoneId,
          expectedPhoneVersion: phone.version,
          result: exclusionId ? "unavailable" : "empty",
          exclusionId,
        },
      ],
    };
    return api(
      actor,
      `giveaway/${f.campaignId}/reconciliation/phone-checks`,
      body,
      201,
    );
  }
  return {
    ...f,
    actor,
    async configure(
      state: "finished" | "before_cutoff" | "grace_open" = "finished",
    ) {
      const c = await f.configure(state);
      // Stage 2b manager discovery also reads Settings, whose canonical pointer
      // must agree with the fictional timing row created by the Stage 2a helper.
      await f.pool.query(
        "UPDATE station_reporting_state SET current_settings_version_id=$2 WHERE station_id=$1",
        [seedId(8), c.settingsVersionId],
      );
      return c;
    },
    async historicalAccounts(count: number) {
      const rows = Array.from({ length: count }, (_, i) => ({
        userId: v7(),
        attendantId: v7(),
        assignmentId: v7(),
        i,
      }));
      for (const row of rows) {
        await f.pool.query(
          "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,$3,false,1,false,now())",
          [
            row.userId,
            `history.${row.userId}`,
            `Fictional historical account ${row.i}`,
          ],
        );
        await f.pool.query(
          "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
          [row.attendantId, row.userId, `HIST-${row.i}`],
        );
        await f.pool.query(
          "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,effective_until,changed_by,reason) VALUES($1,$2,$3,1,'2000-01-01T00:00:00Z'::timestamptz+$4::int*interval '2 minutes','2000-01-01T00:00:00Z'::timestamptz+($4::int+1)*interval '2 minutes',$5,'Fictional ended account history')",
          [
            row.assignmentId,
            row.attendantId,
            seedId(13),
            row.i,
            identity.adminId,
          ],
        );
      }
      return rows;
    },
    personId,
    otherActor,
    checklist,
    designate,
    census,
    propose,
    certify,
    get campaignId() {
      return f.campaignId;
    },
    async close() {
      for (const c of contexts) await c.dispose();
      await f.close();
    },
  };
}

export async function signInChecklist(
  page: Page,
  f: { username: string; password: string },
) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(f.username);
  await page.getByLabel("Password", { exact: true }).fill(f.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/admin\/sign-in$/);
}
