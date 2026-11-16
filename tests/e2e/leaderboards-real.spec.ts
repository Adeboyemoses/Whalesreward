import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  leaderboardFixture,
  api,
  prepare,
  confirm,
  guard,
  type Preview,
  type Snapshot,
} from "../leaderboards/helpers";
import { seedId } from "../station/helpers";

test.setTimeout(90000);
test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  screenshot: "off",
});

for (const state of ["before_cutoff", "grace_open"] as const) {
  test(`I-45 trusted ${state} blocker prevents review and shows the exact campaign boundary`, async ({
    page,
  }) => {
    const f = await leaderboardFixture(page);
    try {
      const c = await f.configure(state);
      const readiness = await api<{
        blockers: string[];
        canPrepare: boolean;
        campaign: {
          timing: { purchaseCutoff: string; uploadDeadline: string };
        };
      }>(page, `giveaway/${c.id}/readiness`);
      expect(readiness.blockers).toContain(state);
      expect(readiness.canPrepare).toBe(false);
      await page.goto("/admin/leaderboards/finalize");
      await expect(page.getByRole("main")).toContainText(
        state === "before_cutoff"
          ? /cutoff has not passed/i
          : /grace period is still open/i,
      );
      await expect(page.getByRole("main")).toContainText(
        readiness.campaign.timing.purchaseCutoff,
      );
      await expect(page.getByRole("main")).toContainText(
        readiness.campaign.timing.uploadDeadline,
      );
      await expect(
        page.getByRole("button", {
          name: "Review final snapshot",
          exact: true,
        }),
      ).toBeDisabled();
    } finally {
      await f.close();
    }
  });
}

async function capture(page: Page, id: string) {
  const saveImages = Boolean(process.env.WHR_CAPTURE_LEADERBOARDS);
  const path = new URL("../design-parity/leaderboards/", import.meta.url);
  if (saveImages) await mkdir(path, { recursive: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      controls: [
        ...document.querySelectorAll<
          HTMLButtonElement | HTMLInputElement | HTMLSelectElement
        >("main button, main input, main select, main textarea"),
      ]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          label: e.getAttribute("aria-label") ?? e.textContent?.trim() ?? e.id,
          height: e.getBoundingClientRect().height,
        })),
    }));
    expect(
      metrics.scrollWidth,
      `${id} must fit its ${width}px viewport`,
    ).toBeLessThanOrEqual(width);
    if (width < 900)
      for (const control of metrics.controls)
        expect(
          control.height,
          `${id} ${width}px control ${control.label} must be at least 48px high`,
        ).toBeGreaterThanOrEqual(48);
    if (saveImages) {
      await page.screenshot({
        path: new URL(`${id}-${width}.built.png`, path).pathname,
        fullPage: true,
      });
      await writeFile(
        new URL(`${id}-${width}.metrics.json`, path),
        JSON.stringify(metrics, null, 2) + "\n",
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("I-45 unset campaign is not configured, never a sample ranking, and direct confirmation saves nothing", async ({
  page,
}) => {
  const f = await leaderboardFixture(page, ["leaderboards"]);
  try {
    await page.goto("/admin/leaderboards");
    await expect(page.getByRole("main")).toContainText(/not configured/i);
    await expect(page.getByRole("main")).not.toContainText(
      /sample period|₦85,000|Chidi Okafor/,
    );
    await expect(
      page.getByRole("link", { name: "View purchases", exact: true }),
    ).toHaveCount(0);
    await page.goto("/admin/leaderboards/finalize");
    await expect(page.getByRole("main")).toContainText(/not configured/i);
    await expect(
      page.getByRole("button", { name: "Review final snapshot", exact: true }),
    ).toHaveCount(0);
    await page.goto("/admin/leaderboards/finalize/confirm");
    await expect(page.getByRole("main")).toContainText(
      /no reviewed change|no reviewed.*confirm/i,
    );
    await expect(
      page.getByRole("button", {
        name: "Confirm and save snapshot",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (await f.pool.query("SELECT count(*)::int n FROM giveaway_snapshot"))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-43 I-44 exact all-time spend, shared ranks, category paging and changed generations never invent a tie breaker", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.sale({ customerId: seedId(26), amount: "9007199254740993000" });
    await f.sale({ customerId: seedId(27), amount: "9007199254740993000" });
    for (let i = 0; i < 25; i++) {
      const customerId = v7();
      await f.pool.query(
        "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,$3,$4,'car_owner',1)",
        [
          customerId,
          `PAGING${i}`,
          `Fictional Buyer ${i}`,
          `+2348000001${String(i).padStart(3, "0")}`,
        ],
      );
      await f.sale({ customerId, amount: "1234500" });
    }
    await page.goto("/admin/leaderboards");
    await page
      .getByLabel("Ranking basis", { exact: true })
      .selectOption("recorded_all_time");
    const main = page.getByRole("main");
    await expect(main).toContainText("₦90,071,992,547,409,930.00");
    await expect(main).toContainText(/recorded|all.time/i);
    await expect(main).toContainText("Shared rank");
    const rows = page.getByRole("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(25);
    await expect(rows.nth(0)).toContainText("Shared rank");
    await expect(rows.nth(1)).toContainText("Shared rank");
    const overall = await api<{
      items: { rank: string; sharedRank: boolean }[];
    }>(page, "leaderboards?basis=recorded_all_time&limit=25");
    expect(overall.items.slice(0, 3).map((row) => row.rank)).toEqual([
      "1",
      "1",
      "3",
    ]);
    await page.getByRole("button", { name: /next/i }).first().click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Shared rank");
    await page
      .getByLabel("Customer category", { exact: true })
      .selectOption("cooking_gas_customer");
    await expect(main).toContainText(
      /no .*purchases|no .*customers|no .*rank/i,
    );
    await page
      .getByLabel("Customer category", { exact: true })
      .selectOption("car_owner");
    await expect(rows).toHaveCount(25);
    const first = await api<{ items: { rank: string; sharedRank: boolean }[] }>(
      page,
      "leaderboards?basis=recorded_all_time&category=car_owner&limit=25",
    );
    expect(first.items[0]).toMatchObject({ rank: "1", sharedRank: false });
    await f.sale({ amount: "100" });
    await page.getByRole("button", { name: /next/i }).first().click();
    await expect(main).toContainText(/changed|refresh/i);
    await expect(rows).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("I-44 configured campaigns still allow a separately labelled all-time ranking with no campaign query parameter", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.sale({ amount: "2876543" });
    await f.configure();
    await page.goto("/admin/leaderboards");
    await expect(
      page.getByRole("table", { name: "Overall spend ranking" }),
    ).toContainText("₦28,765.43");
    const pending = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/admin/leaderboards" &&
        url.searchParams.get("basis") === "recorded_all_time"
      );
    });
    await page
      .getByLabel("Ranking basis", { exact: true })
      .selectOption("recorded_all_time");
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    const query = new URL(response.url()).searchParams;
    expect(query.has("campaignId")).toBe(false);
    expect(query.has("category")).toBe(false);
    expect(query.has("cursor")).toBe(false);
    await expect(page.getByRole("main")).toContainText(
      "All-time recorded spend · not a giveaway result.",
    );
    await expect(
      page.getByRole("table", { name: "Overall spend ranking" }),
    ).toContainText("₦28,765.43");
    await expect(
      page.getByRole("link", { name: "Finalize leaderboard", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("I-46 a concurrent saved revision invalidates a history cursor and Retry restarts from the first page", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    const sale = await f.sale({ amount: "3100001" });
    const c = await f.configure();
    const save = async (kind: "initial" | "revision") => {
      await f.phoneCheck(kind);
      const preview = await api<Preview>(
        page,
        `giveaway/${c.id}/previews`,
        {
          operationId: v7(),
          kind,
          reason: "Fictional history pagination preparation",
          ...guard(await f.campaign()),
        },
        201,
      );
      return api<Snapshot>(
        page,
        `giveaway/${c.id}/snapshots${preview.guard.expectedPreviousSnapshotId ? `/${preview.guard.expectedPreviousSnapshotId}/revisions` : ""}`,
        {
          operationId: v7(),
          previewId: preview.id,
          contentDigest: preview.contentDigest,
          ...preview.guard,
        },
        201,
      );
    };
    await save("initial");
    await f.changeAmount(sale.id, "3200001");
    const second = await save("revision");
    const listPath = `/api/admin/giveaway/${c.id}/snapshots`;
    // The first page is fetched from the actual server with a smaller legal
    // page size. Its cursor and the later stale-generation 409 are real.
    await page.route(`**${listPath}?*`, async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("cursor")) url.searchParams.set("limit", "1");
      await route.fulfill({
        response: await route.fetch({ url: url.toString() }),
      });
    });
    await page.goto("/admin/leaderboards/finalize");
    const history = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Snapshot and revision history",
          exact: true,
        }),
      })
      .first();
    await expect(
      history.getByRole("button", { name: "Revision 2", exact: true }),
    ).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
    await f.changeAmount(sale.id, "3300001");
    const third = await save("revision");
    expect(third.number).toBe(3);
    const refused = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === listPath &&
        url.searchParams.has("cursor") &&
        response.status() === 409
      );
    });
    await history.getByRole("button", { name: "Next", exact: true }).click();
    expect((await (await refused).json()).error.code).toBe("read_view_stale");
    await expect(history.getByRole("alert")).toContainText(/changed|refresh/i);
    const retried = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === listPath &&
        response.status() === 200,
    );
    await history.getByRole("button", { name: "Retry", exact: true }).click();
    const response = await retried;
    expect(new URL(response.url()).searchParams.has("cursor")).toBe(false);
    const result = (await response.json()).data as { items: Snapshot[] };
    expect(result.items[0]?.id).toBe(third.id);
    expect(result.items[0]?.id).not.toBe(second.id);
    await expect(
      history.getByRole("button", { name: "Revision 3", exact: true }),
    ).toBeVisible();
    await expect(history.getByRole("alert")).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("I-46 grouped readiness reports actual blockers and honest unavailable checklist without per-check rows", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.sale({ state: "held", amount: "3333300" });
    await f.sale({ state: "photo_pending", amount: "4444400" });
    const c = await f.configure();
    const readiness = await api<{
      canPrepare: boolean;
      blockers: string[];
      counts: Record<string, string>;
      phoneCheck: { state: string };
    }>(page, `giveaway/${c.id}/readiness`);
    expect(readiness.canPrepare).toBe(false);
    expect(readiness.counts.holds).toBe("1");
    expect(readiness.counts.uploads).toBe("1");
    expect(readiness.phoneCheck.state).toBe("missing");
    await page.goto("/admin/leaderboards/finalize");
    const main = page.getByRole("main");
    await expect(main).toContainText("Finalization checks");
    await expect(main).toContainText(/not available yet/i);
    await expect(main).toContainText(/held sales|held.sale/i);
    await expect(main).toContainText(/upload/i);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review final snapshot", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator('a[href*="/finalize/phones"],a[href*="/finalize/manager"]'),
    ).toHaveCount(0);
    await expect(main).not.toContainText(
      /9 checks passed|0 unsent|all phones empty/i,
    );
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        overlappingGroups: [
          ...document.querySelectorAll(".wr-giveaway-page .wr-kv-row"),
        ]
          .filter((row) => {
            const label = row.querySelector("dt")?.getBoundingClientRect();
            const value = row.querySelector("dd")?.getBoundingClientRect();
            return (
              label &&
              value &&
              label.right > value.left + 1 &&
              label.bottom > value.top + 1
            );
          })
          .map((row) => row.textContent?.trim()),
      }));
      expect(
        layout.pageWidth,
        `${width}px readiness must not overflow the page`,
      ).toBeLessThanOrEqual(layout.viewport);
      expect(
        layout.overlappingGroups,
        `${width}px readiness labels and values must not overlap`,
      ).toEqual([]);
    }
  } finally {
    await f.close();
  }
});

test("I-46 reviewed preview saves once, immutable history survives identity and accepted revision changes, and unchanged reconciliation adds no snapshot", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.isolateInstrumentationReads();
    const sale = await f.sale({ amount: "1370001" });
    await f.sale({
      customerId: seedId(27),
      product: "cooking_gas",
      amount: "1370001",
    });
    const c = await f.configure();
    await page.goto("/admin/leaderboards");
    await expect(page.getByRole("main")).toContainText("₦13,700.01");
    await capture(page, "E01");
    await page.goto("/admin/leaderboards/finalize");
    await expect(page.getByRole("main")).toContainText(/not available yet/i);
    await capture(page, "E02");
    await f.phoneCheck();
    await page.reload();
    const readiness = await api<{
      canPrepare: boolean;
      canConfirm: boolean;
      blockers: string[];
    }>(page, `giveaway/${c.id}/readiness`);
    expect(readiness).toMatchObject({ canPrepare: true, canConfirm: false });
    expect(readiness.blockers).toContain("reconciliation_required");
    const preview = await prepare(page, "Fictional initial browser result");
    await expect(page.getByRole("main")).toContainText(
      /Snapshot preview.*not saved/,
    );
    await expect(page.getByRole("main")).toContainText(
      "Fictional initial browser result",
    );
    await capture(page, "E04");
    const initial = await confirm(page);
    expect(initial.number).toBe(1);
    await expect(page.getByRole("main")).toContainText("Snapshot 1 saved");
    const stored = await f.observe<unknown>(
      `giveaway/${c.id}/snapshots/${initial.id}`,
    );
    const frozenRows = await f.observe<{
      items: { name: string; rank: string; sharedRank: boolean }[];
    }>(`giveaway/${c.id}/snapshots/${initial.id}/rows`);
    expect(frozenRows.items).toHaveLength(2);
    expect(frozenRows.items.every((r) => r.rank === "1" && r.sharedRank)).toBe(
      true,
    );
    await f.renameCustomer(seedId(26), "Fictional changed customer");
    await f.changeAmount(sale.id, "1470001");
    await f.phoneCheck("revision");
    await page.reload();
    const revisedPreview = await prepare(
      page,
      "Fictional revised browser result",
      true,
    );
    expect(revisedPreview.id).not.toBe(preview.id);
    await expect(page.getByRole("main")).toContainText("₦14,700.01");
    const revised = await confirm(page, true);
    expect(revised).toMatchObject({
      number: 2,
      previousSnapshotId: initial.id,
    });
    await expect(page.getByRole("main")).toContainText("Snapshot 2 saved");
    await capture(page, "E03");
    expect(await f.observe(`giveaway/${c.id}/snapshots/${initial.id}`)).toEqual(
      stored,
    );
    expect(
      await f.observe(`giveaway/${c.id}/snapshots/${initial.id}/rows`),
    ).toEqual(frozenRows);
    await page
      .getByLabel("Saved snapshot", { exact: true })
      .selectOption(initial.id);
    await expect(page.getByRole("main")).toContainText("Amina Bello");
    await expect(page.getByRole("main")).toContainText("₦13,700.01");
    await f.phoneCheck("revision");
    // Exercise the saved screen's refresh action rather than re-reading every
    // historical source collection just to obtain current reconciliation guards.
    const refreshed = page.waitForResponse((response) =>
      response.url().endsWith(`/giveaway/${c.id}/readiness`),
    );
    await page
      .getByRole("button", { name: "Refresh current readiness", exact: true })
      .click();
    expect((await refreshed).status()).toBe(200);
    const unchanged = (await prepare(
      page,
      "Fictional unchanged browser reconciliation",
      true,
    )) as unknown as { state: string; currentSnapshotId: string };
    expect(unchanged).toMatchObject({
      state: "unchanged",
      currentSnapshotId: revised.id,
    });
    await expect(page.getByRole("main")).toContainText(
      /saved result is unchanged.*no new snapshot/i,
    );
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await f.close();
  }
});

test("I-46 lost confirmation response stays uncertain across navigation and retries identical operation once", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.sale({ amount: "1734500" });
    const c = await f.configure();
    await f.phoneCheck();
    await page.goto("/admin/leaderboards/finalize");
    await prepare(page, "Fictional lost response result");
    let first: string | null = null;
    let historical: Snapshot | null = null;
    const endpoint = `**/api/admin/giveaway/${c.id}/snapshots`;
    await page.route(
      endpoint,
      async (route) => {
        first = route.request().postData();
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        historical = (await response.json()).data as Snapshot;
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Confirm and save snapshot", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(/uncertain/i);
    await expect(page.getByRole("main")).not.toContainText("Snapshot 1 saved");
    await page
      .getByRole("link", { name: "Back to leaderboards", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Finalize leaderboard", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(/uncertain/i);
    let retry: string | null = null;
    page.on("request", (request) => {
      if (
        request.url().endsWith(`/giveaway/${c.id}/snapshots`) &&
        request.method() === "POST"
      )
        retry = request.postData();
    });
    await page
      .getByRole("button", {
        name: /retry.*request|retry.*confirm|retry.*save/i,
      })
      .click();
    await expect(page.getByRole("main")).toContainText("Snapshot 1 saved");
    expect(retry).toBe(first);
    expect(historical).not.toBeNull();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM mutation_receipt WHERE operation_id=$1",
          [JSON.parse(first!).operationId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-09 I-11 source changes refuse stale confirmation and revoked authority clears pending preview", async ({
  page,
}) => {
  const f = await leaderboardFixture(page);
  try {
    await f.sale({ amount: "1934500" });
    const c = await f.configure();
    await f.phoneCheck();
    await page.goto("/admin/leaderboards/finalize");
    const preview = await prepare(page, "Fictional stale browser result");
    await f.renameCustomer(seedId(26), "Fictional later display");
    await page
      .getByRole("button", { name: "Confirm and save snapshot", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(
      /out of date|changed|can no longer|stale/i,
    );
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await page.goto("/admin/leaderboards/finalize");
    await f.phoneCheck();
    await page.reload();
    const next = await prepare(page, "Fictional authority changed result");
    expect(next.id).not.toBe(preview.id);
    await f.pool.query(
      "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
      [f.userId],
    );
    await page
      .getByRole("button", { name: "Confirm and save snapshot", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Confirm and save snapshot",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Fictional authority changed result"),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-11 leaderboard-only viewer sees live rows but cannot inspect purchases or finalize", async ({
  page,
}) => {
  const f = await leaderboardFixture(page, ["leaderboards"]);
  try {
    await f.sale({ amount: "2345600" });
    const c = await f.configure();
    await page.goto("/admin/leaderboards");
    await expect(page.getByRole("main")).toContainText("₦23,456.00");
    await expect(
      page.getByRole("link", { name: "View purchases", exact: true }),
    ).toHaveCount(0);
    await page.goto("/admin/leaderboards/finalize");
    await expect(
      page.getByRole("button", { name: "Review final snapshot", exact: true }),
    ).toHaveCount(0);
    const refusal = await page.request.post(
      `/api/admin/giveaway/${c.id}/previews`,
      {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          operationId: v7(),
          kind: "initial",
          reason: "Fictional denied mutation",
          expectedVersion: c.version,
          expectedSettingsVersionId: c.settingsVersionId,
          expectedDataVersion: c.dataVersion,
          expectedPreviousSnapshotId: null,
        },
      },
    );
    expect(refusal.status()).toBe(403);
  } finally {
    await f.close();
  }
});
