import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import type { Page } from "@playwright/test";
import {
  checklistFixture,
  api,
  guard,
  signInChecklist,
} from "../checklist/helpers";
import { authId } from "../../src/shared/contracts/auth";
import { exclusionSchema } from "../../src/client/admin-checklist-schemas";
import { seedId } from "../station/helpers";

import { captureChecklistResponsive } from "../checklist/fidelity";

test.use({ deviceScaleFactor: 2 });

type Fixture = Awaited<ReturnType<typeof checklistFixture>>;
const base = "/admin/leaderboards/finalize";
async function unavailableDraft(page: Page, f: Fixture, phoneId: string) {
  await page.goto(`${base}/phones/${phoneId}/unavailable`);
  await page
    .getByLabel("Why is this phone unavailable?", { exact: true })
    .fill("Fictional frozen candidate evidence before authority change");
  await page
    .getByRole("button", {
      name: "Review unavailable-phone proposal",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Submit for independent approval",
      exact: true,
    }),
  ).toBeVisible();
}
async function approve(f: Fixture, phoneId: string) {
  const proposed = await f.propose(phoneId, []);
  const reviewer = await f.otherActor();
  await api(
    reviewer,
    `giveaway/${f.campaignId}/reconciliation/exclusions/${proposed.result.exclusion.id}/decision`,
    {
      operationId: v7(),
      expectedVersion: proposed.result.exclusion.version,
      decision: "approve",
      reason: "Fictional independent phone-only review",
    },
  );
  return proposed.result.exclusion.id;
}

for (const authority of ["manager", "person"] as const) {
  test(`I-09 frozen unavailable review is evicted after ${authority} loss without changed session grants while lawful history remains readable`, async ({
    page,
    leaderboardStack,
  }) => {
    const f = await checklistFixture(page.request, leaderboardStack.origin);
    try {
      await f.configure();
      await f.designate();
      const census = await f.census();
      const phone = census.phones.items[0]!;
      await unavailableDraft(page, f, phone.id);
      const grants = (
        await f.pool.query(
          "SELECT permission_code FROM role_permission WHERE role_id=$1 ORDER BY permission_code",
          [f.owner],
        )
      ).rows;
      if (authority === "manager") {
        const next = await f.otherActor();
        await api(
          f.actor,
          `giveaway/${f.campaignId}/reconciliation/manager`,
          {
            operationId: v7(),
            expectedVersion: (await f.campaign()).version,
            managerAdminId: next.adminId,
            reason: "Fictional manager replaced during frozen review",
          },
          201,
        );
      } else {
        await f.pool.query(
          "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT gen_random_uuid(),station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
          [f.userId],
        );
      }
      await page
        .getByRole("link", { name: "Back to phone census", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Phone census",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Submit for independent approval",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "Fictional frozen candidate evidence before authority change",
          { exact: true },
        ),
      ).toHaveCount(0);
      await expect(
        page.getByText(phone.id, { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByLabel("Why is this phone unavailable?", { exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await f.pool.query(
            "SELECT permission_code FROM role_permission WHERE role_id=$1 ORDER BY permission_code",
            [f.owner],
          )
        ).rows,
      ).toEqual(grants);
      expect(
        (
          await f.pool.query(
            "SELECT count(*)::int n FROM giveaway_phone_exclusion WHERE campaign_id=$1",
            [f.campaignId],
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(page).not.toHaveURL(/sign-in/);
    } finally {
      await f.close();
    }
  });
}

test("I-09 independent approver direct unavailable URL stays signed in without requesting manager-only candidates", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const reviewer = await f.otherActor();
    await page.context().clearCookies();
    await signInChecklist(page, reviewer);
    const selectorReads: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/reconciliation/selection/"))
        selectorReads.push(new URL(r.url()).pathname);
    });
    await page.goto(`${base}/phones/${census.phones.items[0]!.id}/unavailable`);
    await expect(
      page.getByRole("heading", {
        name: "Phone unavailable",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Review unavailable-phone proposal",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Back to phone census", exact: true }),
    ).toBeVisible();
    expect(selectorReads).toEqual([]);
    await page
      .getByRole("link", { name: "Back to phone census", exact: true })
      .click();
    await expect(
      page.getByText(census.phones.items[0]!.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/sign-in/);
  } finally {
    await f.close();
  }
});

test("I-46 superseded unavailable history remains readable alongside the current census and inspection", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const proposal = await f.propose(census.phones.items[0]!.id);
    const replacement = await f.census(
      "Fictional replacement after unavailable proposal",
    );
    const detail = await api<{ state: string; auditEventId: string }>(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${proposal.result.exclusion.id}`,
    );
    expect(detail.state).toBe("superseded");
    const parsed = exclusionSchema.safeParse(detail);
    const validAuditId = authId.safeParse(detail.auditEventId).success;
    console.log("SUPERSEDED_CONTRACT", JSON.stringify({
      route: "/api/admin/giveaway/:campaignId/reconciliation/exclusions/:exclusionId",
      status: 200, state: detail.state, auditEventId: detail.auditEventId,
      auditIdValid: validAuditId,
      schemaIssues: parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
    }));
    expect(validAuditId, "M1 Id and M4 Exclusion.auditEventId require canonical UUIDv7").toBe(true);
    await page.goto(`${base}/phones`);
    await expect(
      page.getByText(replacement.phones.items[0]!.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Review complete phone check",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`${base}/exclusions/${proposal.result.exclusion.id}`);
    await expect(
      page
        .getByText(
          "Earlier evidence is stale. This proposal no longer applies. Review the current phone census and submit a new proposal if needed.",
          {
            exact: true,
          },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText(proposal.body.reason, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^(Approve|Reject) unavailable phone$/,
      }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/sign-in/);
    await captureChecklistResponsive(page, "Superseded-proposal");
  } finally {
    await f.close();
  }
});

for (const status of [429, 503]) {
  test(`I-09 transient ${status} on a later account page resumes the identical cursor and view without repeating the first page`, async ({
    page,
    leaderboardStack,
  }) => {
    const f = await checklistFixture(page.request, leaderboardStack.origin);
    try {
      await f.configure();
      await f.designate();
      const history = await f.historicalAccounts(99);
      const urls: string[] = [];
      let failedUrl: string | null = null;
      await page.route(
        "**/reconciliation/selection/attendants?**",
        async (route) => {
          const url = route.request().url();
          urls.push(url);
          if (new URL(url).searchParams.has("cursor") && failedUrl === null) {
            failedUrl = url;
            await route.fulfill({
              status,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code:
                    status === 429 ? "rate_limited" : "temporarily_unavailable",
                  message: "Fictional transient read failure",
                  retryable: true,
                },
                serverTime: new Date().toISOString(),
                requestId: v7(),
              }),
            });
          } else await route.continue();
        },
      );
      await page.goto(`${base}/phones`);
      await expect(
        page.getByRole("main").getByRole("alert").first(),
      ).toBeVisible();
      expect(failedUrl).not.toBeNull();
      await expect(
        page.getByRole("button", { name: "Review census", exact: true }),
      ).toHaveCount(0);
      const firstUrl = urls[0]!;
      await page
        .getByRole("button", { name: "Refresh complete evidence", exact: true })
        .first()
        .click();
      await expect(
        page.getByText(`Missing account: ${history[98]!.attendantId}`, {
          exact: true,
        }),
      ).toBeVisible();
      expect(urls.filter((u) => u === firstUrl)).toHaveLength(1);
      expect(urls.filter((u) => u === failedUrl)).toHaveLength(2);
      await expect(
        page.getByRole("button", { name: "Review census", exact: true }),
      ).toBeDisabled();
    } finally {
      await f.close();
    }
  });
}

test("I-46 approved unavailability cannot select empty on the old census and duplicate phone labels retain independent controls", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const initial = await f.census("Fictional shared label");
    const phone = initial.phones.items[0]!;
    const exclusionId = await approve(f, phone.id);
    await page.goto(`${base}/phones`);
    const inspection = page.getByRole("combobox", {
      name: new RegExp(`Inspection result.*${phone.id}`),
    });
    await expect(inspection).toBeVisible();
    const empty = inspection.locator('option[value="empty"]');
    expect((await empty.count()) === 0 || (await empty.isDisabled())).toBe(
      true,
    );
    await expect(
      page.getByRole("button", { name: "Phone available again", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Phone available again", exact: true })
      .click();
    await expect(
      page.getByText(
        "This phone is available again. Record a new census and phone check.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Review complete phone check",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_check WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
    const c = await f.campaign();
    await api(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/censuses`,
      {
        operationId: v7(),
        kind: "initial",
        ...guard(c),
        expectedCensusVersion: initial.phones.view.censusVersion,
        reason: "Fictional replacement census with equal labels",
        phones: [
          {
            id: phone.id,
            label: phone.label,
            attendantIds: phone.attendantIds,
          },
          { label: phone.label, attendantIds: [seedId(6)] },
        ],
      },
      201,
    );
    await page.reload();
    const controls = page.getByRole("combobox", { name: /Inspection result/ });
    await expect(controls).toHaveCount(2);
    const ids = await controls.evaluateAll((nodes) => nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(Boolean)).toBe(true);
    const names = await controls.evaluateAll((nodes) =>
      nodes.map(
        (n) =>
          n.getAttribute("aria-label") ||
          document.querySelector(`label[for="${n.id}"]`)?.textContent,
      ),
    );
    expect(new Set(names).size).toBe(2);
    const retained = await api<{ state: string }>(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${exclusionId}`,
    );
    expect(retained.state).toBe("approved");
    await captureChecklistResponsive(page, "Duplicate-label-controls");
  } finally {
    await f.close();
  }
});

const policyCopy =
  "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.";
test("I-46 known missing policy leaves a complete census draft readable but disables certification", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure("finished", { reconciliationPolicy: false });
    await f.designate();
    const live = await f.checklist();
    expect(live.view.reconciliationPolicyVersion).toBeNull();
    await page.goto(`${base}/phones`);
    await expect(
      page.getByText(policyCopy, { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add phone", exact: true }).click();
    await page
      .getByLabel("Phone label · 1", { exact: true })
      .fill("Fictional policyless census draft");
    for (const id of [seedId(6), seedId(7)])
      await page
        .getByRole("checkbox", { name: new RegExp(id + " · phone 1") })
        .check();
    await page
      .getByLabel("Census reason", { exact: true })
      .fill("Fictional census draft while policy is unavailable");
    await page
      .getByRole("checkbox", {
        name: "I have included every relevant phone and account partition, including phones used by staff who have left.",
        exact: true,
      })
      .check();
    await expect(
      page.getByRole("button", { name: "Review census", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Review complete phone check",
        exact: true,
      }),
    ).toBeDisabled();
    await captureChecklistResponsive(page, "Policy-blocked-census");
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_census WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-46 failure-only policy refusal at proposal confirmation shows the prerequisite and saves no proposal", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    await unavailableDraft(page, f, census.phones.items[0]!.id);
    // Failure-only transport injection covers deploy/configuration-race error handling.
    // Policy bindings are immutable: this does not claim a legal DB transition.
    await page.route("**/reconciliation/phones/*/exclusions", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "reconciliation_policy_unconfigured",
            message: "Finalization policy is not configured.",
            retryable: false,
          },
          serverTime: new Date().toISOString(),
          requestId: v7(),
        }),
      }),
    );
    await page
      .getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(policyCopy, { exact: true }).first(),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      page.getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("I-09 manager discovery refuses Settings timing mixed with a newer selector guard before review", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    const campaign = await f.configure();
    let changed = false;
    await page.route(/\/api\/admin\/settings(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      if (!changed) {
        changed = true;
        const timing = v7();
        await f.pool.query(
          `INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version)
          SELECT $1,station_id,campaign_id,version+1,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,clock_timestamp(),actor_id,'Fictional timing changed between Settings and selector',timing_policy_version FROM settings_version WHERE id=$2`,
          [timing, campaign.settingsVersionId],
        );
        await f.pool.query(
          "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
          [f.campaignId, timing],
        );
        await f.pool.query(
          "UPDATE station_reporting_state SET current_settings_version_id=$2 WHERE station_id=$1",
          [seedId(8), timing],
        );
      }
      await route.fulfill({ response });
    });
    await page.goto(`${base}/manager`);
    await expect(
      page.getByRole("main").getByRole("alert").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review designation", exact: true }),
    ).toHaveCount(0);
    expect(changed).toBe(true);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_manager_designation WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-09 first confirmation revalidates person authority before sending a protected proposal and retains the lawful session", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    await unavailableDraft(page, f, census.phones.items[0]!.id);
    await f.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT gen_random_uuid(),station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [f.userId],
    );
    const posts: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/phones\/[^/]+\/exclusions$/.test(new URL(r.url()).pathname)
      )
        posts.push("proposal");
    });
    await page
      .getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(posts).toEqual([]);
    await expect(
      page.getByText(
        "Fictional frozen candidate evidence before authority change",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/sign-in/);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-09 losing person verification retains lawful census exclusion and check history without manager candidate requests", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const exclusionId = await approve(f, census.phones.items[0]!.id);
    await f.certify(census.phones.items[0]!.id, exclusionId);
    await f.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT gen_random_uuid(),station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [f.userId],
    );
    const selectors: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/reconciliation/selection/"))
        selectors.push("selector");
    });
    await page.goto(`${base}/phones`);
    await expect(
      page.getByText(census.phones.items[0]!.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByText("Phone unavailable · exclusion approved", { exact: false })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByLabel("Phone-check reason", { exact: true }),
    ).toHaveCount(0);
    await page.goto(`${base}/exclusions/${exclusionId}`);
    await expect(
      page.getByText(exclusionId, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^(Approve|Reject) unavailable phone$/,
      }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/sign-in/);
    expect(selectors).toEqual([]);
    await captureChecklistResponsive(page, "Read-only-proposal-history");
  } finally {
    await f.close();
  }
});
