import { test, expect } from "../leaderboards/test";
import { mkdir } from "node:fs/promises";
import { checklistFixture, signInChecklist } from "../checklist/helpers";
import { seedId } from "../station/helpers";

const completeScope =
  "I have included every relevant phone and account partition, including phones used by staff who have left.";

for (const width of [1440, 390, 360]) {
  test(`I-46 checklist manager census and complete inspection use explicit reviews at ${width}px`, async ({
    page,
    leaderboardStack,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const f = await checklistFixture(page.request, leaderboardStack.origin);
    try {
      await f.pool.query(
        "UPDATE assignment SET effective_until=clock_timestamp() WHERE attendant_id=$1",
        [seedId(7)],
      );
      await f.pool.query(
        "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
        [seedId(4)],
      );
      await f.configure();
      await page.goto("/admin/leaderboards/finalize/manager");
      await expect(
        page.getByRole("heading", {
          name: "Campaign station manager",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByLabel("Campaign station manager", { exact: true })
        .selectOption(f.adminId);
      await page
        .getByLabel("Reason for designation", { exact: true })
        .fill("Fictional manager responsible for the complete census");
      await page
        .getByRole("button", { name: "Review designation", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Review manager designation",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Confirm designation", exact: true })
        .click();
      await expect(
        page.getByText(
          "Campaign station manager designated. Review the phone census before recording a new phone check.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.goto("/admin/leaderboards/finalize/phones");
      await expect(
        page.getByRole("heading", { name: "Phone census", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Unsent sales on phones: unknown until inspected.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText("Disabled", { exact: false })).toBeVisible();
      await expect(
        page.getByText("Assignment ended", { exact: false }),
      ).toBeVisible();
      if (
        (await page.getByLabel("Phone label · 1", { exact: true }).count()) ===
        0
      )
        await page
          .getByRole("button", { name: "Add phone", exact: true })
          .click();
      await page
        .getByLabel("Phone label · 1", { exact: true })
        .fill("Fictional complete inspection handset");
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(6) + " · phone 1") })
        .check();
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(7) + " · phone 1") })
        .check();
      await page
        .getByLabel("Census reason", { exact: true })
        .fill("Fictional census retains disabled and ended accounts");
      await page
        .getByRole("checkbox", { name: completeScope, exact: true })
        .check();
      await page
        .getByRole("button", { name: "Review census", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Review phone census", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Confirm phone census", exact: true })
        .click();
      await expect(
        page.getByText(
          "Phone census recorded. Inspect every listed phone or obtain independent approval for its unavailability.",
          { exact: true },
        ),
      ).toBeVisible();
      await page
        .getByLabel(
          "Inspection result · Fictional complete inspection handset",
          { exact: true },
        )
        .selectOption({ label: "Inspected · nothing remains unsent" });
      await page
        .getByLabel("Phone-check reason", { exact: true })
        .fill("Fictional physical inspection found no unsent records");
      await page
        .getByRole("button", {
          name: "Review complete phone check",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Record complete phone check",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await f.checklist()).readiness.phoneCheck.state)
        .toBe("complete");
      await page.goto("/admin/leaderboards/finalize");
      await expect(
        page.getByRole("heading", {
          name: "Finalization checklist",
          exact: true,
        }),
      ).toBeVisible();
      for (const name of [
        "Campaign timing",
        "Held sales",
        "Corrections",
        "Possible duplicates",
        "Two-person release proposals",
        "Incomplete uploads",
        "Complete-photo deadline",
        "Campaign eligibility",
        "Phone census and checks",
      ])
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      await expect(page.getByText(/Resolved as of/).first()).toBeVisible();
      await expect(
        page.getByText("Not applicable", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText(/not available yet/i)).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (process.env.WHR_CHECKLIST_CAPTURE) {
        await mkdir(process.env.WHR_CHECKLIST_CAPTURE, { recursive: true });
        await page.screenshot({
          path: `${process.env.WHR_CHECKLIST_CAPTURE}/E02-${width}.built.png`,
          fullPage: true,
        });
      }
    } finally {
      await f.close();
    }
  });
}

test("I-11/I-46 unavailable-phone UI reviews exact immutable sources and a different verified person approves", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    const partial = await f.sale({ state: "received", amount: "1370001" });
    await f.configure();
    await f.designate();
    const census = await f.census();
    const phone = census.phones.items[0]!;
    await page.goto(
      `/admin/leaderboards/finalize/phones/${phone.id}/unavailable`,
    );
    await expect(
      page.getByRole("heading", { name: "Phone unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "The number and value are unknown. Approval leaves these unsent originals out of the future campaign result; it creates no sale records.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: partial.id, exact: true }).check();
    await page
      .getByLabel("Why is this phone unavailable?", { exact: true })
      .fill("Fictional unavailable handset independently inspected by records");
    await page
      .getByRole("button", {
        name: "Review unavailable-phone proposal",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(partial.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByText("Phone attribution: attested by the manager", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    const submitted = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/phones/${phone.id}/exclusions`),
    );
    await page
      .getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      })
      .click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(201);
    const e = (await response.json()).data.exclusion;
    const reviewer = await f.otherActor();
    await page.context().clearCookies();
    await signInChecklist(page, reviewer);
    await page.goto(`/admin/leaderboards/finalize/exclusions/${e.id}`);
    await expect(
      page.getByRole("heading", {
        name: "Review unavailable-phone proposal",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(partial.id, { exact: true }).first(),
    ).toBeVisible();
    await page.getByLabel("Decision", { exact: true }).selectOption("approve");
    await page
      .getByLabel("Decision reason", { exact: true })
      .fill("Fictional independent full source and attribution review");
    await page
      .getByRole("button", { name: "Review decision", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm approval", exact: true })
      .click();
    await expect(
      page.getByText(
        "Phone unavailability approved. Record a current complete phone check before preparing the result.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm approval", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByText("Fictional independent full source and attribution review", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT status,current_revision_id FROM purchase WHERE id=$1",
          [partial.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "received", current_revision_id: null });
  } finally {
    await f.close();
  }
});

test("I-09 uncertain manager mutation retains the identical request across navigation before explicit retry", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await page.goto("/admin/leaderboards/finalize/manager");
    await page
      .getByLabel("Campaign station manager", { exact: true })
      .selectOption(f.adminId);
    await page
      .getByLabel("Reason for designation", { exact: true })
      .fill("Fictional uncertain manager designation");
    await page
      .getByRole("button", { name: "Review designation", exact: true })
      .click();
    const bodies: string[] = [];
    let lose = true;
    await page.route("**/reconciliation/manager", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postData()!);
      if (lose) {
        lose = false;
        const r = await route.fetch();
        expect(r.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Confirm designation", exact: true })
      .click();
    await expect(
      page.getByText(
        "The result of this request is uncertain. Retry the same request before starting another change.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Back to finalization checks", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Campaign station manager", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry same request", exact: true })
      .click();
    await expect(
      page.getByText(
        "Campaign station manager designated. Review the phone census before recording a new phone check.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_manager_designation WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-11 designation remains available to an Owner with settings and sales without a leaderboard or directory grant", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    const owner = await f.otherActor(["settings", "sales"]);
    await f.pool.query(
      "UPDATE role SET is_owner=true,version=version+1 WHERE id=$1",
      [owner.roleId],
    );
    await page.context().clearCookies();
    await signInChecklist(page, owner);
    await page.goto("/admin/leaderboards/finalize/manager");
    await expect(
      page.getByRole("heading", {
        name: "Campaign station manager",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Campaign station manager", { exact: true })
      .selectOption(f.adminId);
    await page
      .getByLabel("Reason for designation", { exact: true })
      .fill("Fictional narrow-authority Owner designation");
    await page
      .getByRole("button", { name: "Review designation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm designation", exact: true })
      .click();
    await expect(
      page.getByText(
        "Campaign station manager designated. Review the phone census before recording a new phone check.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT permission_code FROM role_permission WHERE role_id=$1 ORDER BY permission_code",
          [owner.roleId],
        )
      ).rows.map((r) => r.permission_code),
    ).toEqual(["sales", "settings"]);
  } finally {
    await f.close();
  }
});

test("I-09 stale manager selection requires an explicit refresh without silently retaining the reviewed choice", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await page.goto("/admin/leaderboards/finalize/manager");
    await page
      .getByLabel("Campaign station manager", { exact: true })
      .selectOption(f.adminId);
    await page
      .getByLabel("Reason for designation", { exact: true })
      .fill("Fictional reviewed choice before relevant census change");
    await page
      .getByRole("button", { name: "Review designation", exact: true })
      .click();
    // Another authorized operation advances the pinned campaign generation.
    await f.designate();
    await page
      .getByRole("button", { name: "Confirm designation", exact: true })
      .click();
    await expect(
      page
        .getByText(
          /out of date|Evidence has changed|Records changed while this list was loading/,
        )
        .first(),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_manager_designation WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      page.getByRole("button", { name: "Confirm designation", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});
