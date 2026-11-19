import { test, expect } from "../leaderboards/test";
import { checklistFixture, signInChecklist } from "../checklist/helpers";
import { seedId } from "../station/helpers";
import { captureChecklist } from "../checklist/fidelity";

test.use({ deviceScaleFactor: 2 });

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
          level: 1,
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
        .getByRole("button", { name: "Keep reviewing", exact: true })
        .focus();
      await page.keyboard.press("Shift+Tab");
      const confirmation = page.getByRole("button", {
        name: "Confirm designation",
        exact: true,
      });
      await expect(confirmation).toBeFocused();
      expect(
        await confirmation.evaluate((e) => getComputedStyle(e).outlineWidth),
      ).toBe("2px");
      await captureChecklist(page, "Manager-review");
      await page
        .getByRole("button", { name: "Confirm designation", exact: true })
        .click();
      await expect(
        page.getByText(
          "Campaign station manager designated. Review the phone census before recording a new phone check.",
          { exact: false },
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
      await expect(page.getByText("· Disabled", { exact: true })).toBeVisible();
      await expect(
        page.getByText("· Assignment ended", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(6) + " · phone 1") })
        .check();
      await page
        .getByLabel("Census reason", { exact: true })
        .fill("Fictional census retains disabled and ended accounts");
      await page
        .getByRole("checkbox", { name: completeScope, exact: true })
        .check();
      await expect(
        page.getByText(`Missing account: ${seedId(7)}`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review census", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(7) + " · phone 1") })
        .check();
      await page
        .getByRole("button", { name: "Review census", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Review phone census", exact: true }),
      ).toBeVisible();
      await captureChecklist(page, "Census-review");
      await page
        .getByRole("button", { name: "Confirm phone census", exact: true })
        .click();
      await expect(
        page.getByText(
          "Phone census recorded. Inspect every listed phone or obtain independent approval for its unavailability.",
          { exact: false },
        ),
      ).toBeVisible();
      const discard = page.getByRole("button", {
        name: "Discard stale draft and review current evidence",
        exact: true,
      });
      await expect(discard).toBeVisible();
      await discard.click();
      const inspection = page.getByLabel(
        "Inspection result · Fictional complete inspection handset",
        { exact: true },
      );
      await expect(inspection).toBeEnabled();
      await inspection.selectOption({
        label: "Inspected · nothing remains unsent",
      });
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
      await expect(
        page
          .getByText("Inspection status: Checked · nothing remains unsent", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await captureChecklist(page, "Phone-check-recorded");
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
      await captureChecklist(page, "E02");
    } finally {
      await f.close();
    }
  });
}

for (const decision of ["approve", "reject"] as const) {
  test(`I-11/I-46 unavailable-phone UI reviews exact immutable sources and a different verified person records ${decision}`, async ({
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
      await page
        .getByRole("checkbox", { name: partial.id, exact: true })
        .check();
      await page
        .getByLabel("Why is this phone unavailable?", { exact: true })
        .fill(
          "Fictional unavailable handset independently inspected by records",
        );
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
          .getByText("attested by the manager", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      for (const width of [1440, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        await captureChecklist(page, "Unavailable-review");
      }
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
      for (const width of [1440, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        await captureChecklist(page, "Proposal-pending");
      }
      await page.getByLabel("Decision", { exact: true }).selectOption(decision);
      await page
        .getByLabel("Decision reason", { exact: true })
        .fill("Fictional independent full source and attribution review");
      await page
        .getByRole("button", { name: "Review decision", exact: true })
        .click();
      await page
        .getByRole("button", {
          name:
            decision === "approve" ? "Confirm approval" : "Confirm rejection",
          exact: true,
        })
        .click();
      await expect(
        page.getByText(
          decision === "approve"
            ? "Phone unavailability approved. Record a current complete phone check before preparing the result."
            : "Proposal rejected. This phone still needs inspection or a new proposal.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name:
            decision === "approve" ? "Confirm approval" : "Confirm rejection",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page
          .getByText(
            "Fictional independent full source and attribution review",
            {
              exact: true,
            },
          )
          .first(),
      ).toBeVisible();
      for (const width of [1440, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        await captureChecklist(
          page,
          decision === "approve" ? "Proposal-approved" : "Proposal-rejected",
        );
      }

      if (decision === "approve") {
        await page.context().clearCookies();
        await signInChecklist(page, f);
        await page.goto("/admin/leaderboards/finalize/phones");
        await expect(
          page.getByText(
            "This phone is available again. Record a new census and phone check.",
            { exact: false },
          ),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Phone available again", exact: true })
          .click();
        await expect(
          page.getByText(
            "This phone is available again. Record a new census and phone check.",
            { exact: false },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: "Review complete phone check",
            exact: true,
          }),
        ).toBeDisabled();
        for (const width of [1440, 390, 360]) {
          await page.setViewportSize({ width, height: 1000 });
          await captureChecklist(page, "Recovered-phone-choice");
        }
      }
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
}

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
      page
        .getByText(
          "The result of this request is uncertain. Retry the same request before starting another change.",
          { exact: true },
        )
        .first(),
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
        { exact: false },
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
    const owner = await f.otherActor(["settings", "sales"], false, true);
    await page.context().clearCookies();
    await signInChecklist(page, owner);
    await page.goto("/admin/leaderboards/finalize/manager");
    await expect(
      page.getByRole("heading", {
        name: "Campaign station manager",
        exact: true,
        level: 1,
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
        { exact: false },
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
    await expect(
      page
        .locator('[tabindex="-1"]')
        .filter({
          hasText:
            /out of date|Evidence has changed|Records changed while this list was loading/,
        })
        .first(),
    ).toBeFocused();
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

test("I-09/I-46 changed later account page clears the incomplete census view and requires a full refresh", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const history = await f.historicalAccounts(99);
    let pages = 0,
      changed = false;
    await page.route(
      "**/reconciliation/selection/attendants?**",
      async (route) => {
        pages++;
        if (!changed) {
          const response = await route.fetch();
          const body = await response.json();
          if (body.data.nextCursor) {
            changed = true;
            await f.pool.query(
              "UPDATE auth_user SET display_name='Fictional renamed historical account',auth_version=auth_version+1 WHERE id=$1",
              [history[98]!.userId],
            );
          }
          await route.fulfill({ response });
        } else await route.continue();
      },
    );
    await page.goto("/admin/leaderboards/finalize/phones");
    await expect(
      page
        .getByText(
          "Records changed while this list was loading. Refresh the complete list before reviewing.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    expect(pages).toBeGreaterThanOrEqual(2);
    await expect(
      page.getByLabel("Phone label · 1", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/reconciliation/selection/attendants?**");
    await page
      .getByRole("button", { name: "Refresh complete evidence", exact: true })
      .first()
      .click();
    await expect(
      page.getByText(
        "Census incomplete. Add a phone for every missing account.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(history[98]!.attendantId, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review census", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Add phone", exact: true }).click();
    const accountPages = page.getByRole("navigation", {
      name: "Attendant accounts · phone 1 pages",
      exact: true,
    });
    await expect(accountPages).toBeVisible();
    await expect(
      accountPages.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
    await expect(
      accountPages.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
    for (let pageIndex = 0; pageIndex < 4; pageIndex++)
      await accountPages
        .getByRole("button", { name: "Next", exact: true })
        .click();
    await expect(
      accountPages.getByRole("button", { name: "Previous", exact: true }),
    ).toBeEnabled();
    await expect(
      accountPages.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Attendant account to add · phone 1", { exact: true })
      .selectOption(history[98]!.attendantId);
    await page
      .getByRole("button", { name: "Add attendant account", exact: true })
      .click();
    await expect(
      page.getByText(`Missing account: ${history[98]!.attendantId}`, {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review census", exact: true }),
    ).toBeDisabled();
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

test("I-09 live grant revocation removes a protected reviewed draft on session refresh", async ({
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
      .fill("Fictional protected reason before authority revocation");
    await page
      .getByRole("button", { name: "Review designation", exact: true })
      .click();
    await f.pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
      [f.owner],
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("Fictional protected reason before authority revocation", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Confirm designation", exact: true }),
    ).toHaveCount(0);
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

test("I-46 historical preparation checks retain their original pass while refreshed live phone and upload outcomes become blocked", async ({
  page,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    await f.certify(census.phones.items[0]!.id);
    await page.goto("/admin/leaderboards/finalize");
    await page
      .getByLabel("Reconciliation reason", { exact: true })
      .fill(
        "Fictional historical checklist remains distinct from current records",
      );
    await page
      .getByRole("button", { name: "Review final snapshot", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Historical preparation checklist",
        exact: true,
      }),
    ).toBeVisible();
    const historical = page
      .getByRole("heading", {
        name: "Historical preparation checklist",
        exact: true,
      })
      .locator("..");
    await expect(
      historical.getByText("Passed during preparation", { exact: true }),
    ).toHaveCount(9);
    const prior = await historical.innerText();
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await captureChecklist(page, "Historical-preparation");
    }
    await f.sale({ state: "received", amount: "1470001" });
    await page
      .getByRole("button", { name: "Refresh current readiness", exact: true })
      .click();
    const live = page.getByRole("region", {
      name: "Finalization checklist",
      exact: true,
    });
    await expect(
      live.getByText("Blocked", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      live.getByText(
        "Phone evidence is stale. Recheck every phone against the current census.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await historical.innerText()).toBe(prior);
    await expect(
      page.getByRole("button", {
        name: "Confirm and save snapshot",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await f.close();
  }
});

for (const phase of ["before_cutoff", "grace_open"] as const) {
  test(`I-45 ${phase} remains a server-reported timing blocker and cannot record phone evidence`, async ({
    page,
    leaderboardStack,
  }) => {
    test.setTimeout(90000);
    const f = await checklistFixture(page.request, leaderboardStack.origin);
    try {
      await f.configure(phase);
      await f.designate();
      await page.goto("/admin/leaderboards/finalize/phones");
      await page
        .getByRole("button", { name: "Add phone", exact: true })
        .click();
      await page
        .getByLabel("Phone label · 1", { exact: true })
        .fill("Fictional phone draft before upload deadline");
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(6) + " · phone 1") })
        .check();
      await page
        .getByRole("checkbox", { name: new RegExp(seedId(7) + " · phone 1") })
        .check();
      await page
        .getByLabel("Census reason", { exact: true })
        .fill("Fictional draft cannot override trusted deadline");
      await page
        .getByRole("checkbox", { name: completeScope, exact: true })
        .check();
      await expect(
        page
          .getByText(/Phone checks can be recorded after the upload deadline:/)
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review census", exact: true }),
      ).toBeDisabled();
      await page.goto("/admin/leaderboards/finalize");
      const checks = page.getByRole("region", {
        name: "Finalization checklist",
        exact: true,
      });
      await expect(
        checks.getByText(
          phase === "before_cutoff"
            ? "Purchase cutoff has not passed."
            : "Upload grace period is still open.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Review final snapshot",
          exact: true,
        }),
      ).toBeDisabled();
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
}

test("I-46 missing campaign values and reconciliation policy stay blocked and unevaluable rather than fabricated zero or a pass", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional unconfigured checklist',1,true)",
      [seedId(99), seedId(8)],
    );
    await page.goto("/admin/leaderboards/finalize");
    const checks = page.getByRole("region", {
      name: "Finalization checklist",
      exact: true,
    });
    await expect(checks.getByRole("heading", { level: 4 })).toHaveCount(9);
    await expect(
      checks
        .getByText(
          "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      checks.getByText("Not evaluable", { exact: true }).first(),
    ).toBeVisible();
    for (const name of [
      "Incomplete uploads",
      "Complete-photo deadline",
      "Phone census and checks",
    ]) {
      const row = checks
        .getByRole("heading", { name, exact: true })
        .locator("..");
      await expect(row.getByText("Blocked", { exact: true })).toBeVisible();
      await expect(
        row.getByText("Not evaluable", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        row.getByText(
          /Resolved as of|Passed during preparation|Not applicable/,
        ),
      ).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "Review final snapshot", exact: true }),
    ).toBeDisabled();
  } finally {
    await f.close();
  }
});
