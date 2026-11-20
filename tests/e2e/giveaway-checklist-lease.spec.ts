import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import { checklistFixture, api } from "../checklist/helpers";
import { captureChecklistResponsive } from "../checklist/fidelity";

test.use({ deviceScaleFactor: 2 });

const base = "/admin/leaderboards/finalize";
const reason = "Fictional protected frozen review before leaving checklist";

for (const authority of ["manager", "person"] as const) {
  test(`I-09 same-URL checklist remount never inserts a frozen review after ${authority} loss while current authority is unresolved`, async ({
    page,
    leaderboardStack,
  }) => {
    const f = await checklistFixture(page.request, leaderboardStack.origin);
    let release = () => {};
    try {
      await f.configure();
      await f.designate();
      const census = await f.census();
      const phone = census.phones.items[0]!;
      await page.goto(`${base}/phones/${phone.id}/unavailable`);
      await page
        .getByLabel("Why is this phone unavailable?", { exact: true })
        .fill(reason);
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
      await page
        .getByRole("navigation", { name: "Admin", exact: true })
        .getByRole("link", { name: "Sales", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Sales", exact: true, level: 1 }),
      ).toBeVisible();
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
            reason: "Fictional manager replaced outside checklist",
          },
          201,
        );
      } else {
        await f.pool.query(
          "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT $2,station_id,user_id,person_id,version+1,false FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
          [f.userId, v7()],
        );
      }
      const denied = await f.actor.request.get(
        `${leaderboardStack.origin}/api/admin/giveaway/${f.campaignId}/reconciliation/selection/phones?limit=1`,
      );
      expect(denied.status()).toBe(403);
      expect((await denied.json()).error.code).toBe(
        authority === "manager"
          ? "permission_denied"
          : "independent_admin_required",
      );
      await page.evaluate(
        ({ reason }) => {
          const state = { inserted: [] as string[] };
          (
            window as unknown as { leaseObservation: typeof state }
          ).leaseObservation = state;
          new MutationObserver((records) => {
            for (const record of records) {
              const nodes =
                record.type === "characterData"
                  ? [record.target]
                  : [...record.addedNodes];
              for (const node of nodes) {
                const text = node.textContent ?? "";
                if (text.includes(reason))
                  state.inserted.push("protected reason");
                if (text.includes("Submit for independent approval"))
                  state.inserted.push("confirmation");
              }
            }
          }).observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        },
        { reason },
      );
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/reconciliation/checklist**", async (route) => {
        await gate;
        await route.continue();
      });
      const request = page.waitForRequest((r) =>
        r.url().includes("/reconciliation/checklist"),
      );
      await page.evaluate(() => history.back());
      await request;
      const inserted = await page.evaluate(
        () =>
          (window as unknown as { leaseObservation: { inserted: string[] } })
            .leaseObservation.inserted,
      );
      const response = page.waitForResponse((r) =>
        r.url().includes("/reconciliation/checklist"),
      );
      release();
      expect((await response).status()).toBe(200);
      await expect(
        page.getByRole("button", {
          name: "Submit for independent approval",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        (
          await f.pool.query(
            "SELECT permission_code FROM role_permission WHERE role_id=$1 ORDER BY permission_code",
            [f.owner],
          )
        ).rows,
      ).toEqual(grants);
      await expect(page).not.toHaveURL(/sign-in/);
      console.log(
        "CHECKLIST_REMOUNT",
        JSON.stringify({
          authority,
          forbiddenSelectorStatus: denied.status(),
          inserted,
        }),
      );
      expect(
        inserted,
        "No protected review may enter the DOM before current mount authority is validated",
      ).toEqual([]);
    } finally {
      release();
      await f.close();
    }
  });
}

test("I-22 I-46 an uncertain initial phone-check retry retains its original kind after another admin saves the initial snapshot", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    await f.pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='giveawayRevise'",
      [f.owner],
    );
    const phone = census.phones.items[0]!;
    await page.goto(`${base}/phones`);
    await page
      .getByRole("combobox", {
        name: new RegExp(`Inspection result.*${phone.id}`),
      })
      .selectOption("empty");
    await page
      .getByLabel("Phone-check reason", { exact: true })
      .fill("Fictional uncertain initial complete inspection");
    await page
      .getByRole("button", { name: "Review complete phone check", exact: true })
      .click();
    const bodies: string[] = [];
    let lost = false;
    await page.route("**/reconciliation/phone-checks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postData()!);
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Record complete phone check", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry same request", exact: true }),
    ).toBeVisible();
    const other = await f.otherActor();
    const { guard } = await import("../checklist/helpers");
    const preview = await api<{
      id: string;
      contentDigest: string;
      guard: Record<string, unknown>;
    }>(
      other,
      `giveaway/${f.campaignId}/previews`,
      {
        operationId: v7(),
        kind: "initial",
        reason:
          "Fictional independent initial result after uncertain phone check",
        ...guard(await f.campaign()),
      },
      201,
    );
    const snapshot = await api<{ id: string }>(
      other,
      `giveaway/${f.campaignId}/snapshots`,
      {
        operationId: v7(),
        previewId: preview.id,
        contentDigest: preview.contentDigest,
        ...preview.guard,
      },
      201,
    );
    expect((await f.campaign()).latestSnapshotId).toBe(snapshot.id);
    expect(JSON.parse(bodies[0]!).kind).toBe("initial");
    // The unchanged server authorizes the original kind before its stored receipt.
    // This real replay proves legality independently of the client policy.
    await api(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/phone-checks`,
      JSON.parse(bodies[0]!),
    );
    await page
      .getByRole("button", { name: "Retry same request", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toBe(bodies[0]);
    await expect(
      page.getByText(
        "Phone check recorded. Run the finalization checklist to review a snapshot.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_check WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-46 refreshing current readiness shows a later independent unchanged reconciliation without rewriting the saved snapshot", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  try {
    const { guard } = await import("../checklist/helpers");
    const { prepare } = await import("../leaderboards/helpers");
    await f.isolateInstrumentationReads();
    await f.configure();
    await f.designate();
    await f.phoneCheck();
    const preview = await api<{
      id: string;
      contentDigest: string;
      guard: Record<string, unknown>;
    }>(
      f.actor,
      `giveaway/${f.campaignId}/previews`,
      {
        operationId: v7(),
        kind: "initial",
        reason: "Fictional immutable initial predecessor",
        ...guard(await f.campaign()),
      },
      201,
    );
    const snapshot = await api<{ id: string }>(
      f.actor,
      `giveaway/${f.campaignId}/snapshots`,
      {
        operationId: v7(),
        previewId: preview.id,
        contentDigest: preview.contentDigest,
        ...preview.guard,
      },
      201,
    );
    const original = await f.observe(
      `giveaway/${f.campaignId}/snapshots/${snapshot.id}`,
    );
    const rows = await f.observe(
      `giveaway/${f.campaignId}/snapshots/${snapshot.id}/rows`,
    );
    const sources = await f.observe(
      `giveaway/${f.campaignId}/snapshots/${snapshot.id}/sources`,
    );
    await f.phoneCheck("revision");
    await page.goto(base);
    const own = (await prepare(
      page,
      "Fictional own unchanged reconciliation A",
      true,
    )) as unknown as { state: string; reconciliationId: string };
    expect(own.state).toBe("unchanged");
    const latest = page.getByRole("region", {
      name: "Latest historical reconciliation",
      exact: true,
    });
    await expect(latest).toContainText(own.reconciliationId);
    const other = await f.otherActor();
    const later = await api<{ state: string; reconciliationId: string }>(
      other,
      `giveaway/${f.campaignId}/previews`,
      {
        operationId: v7(),
        kind: "revision",
        reason: "Fictional independent unchanged reconciliation B",
        ...guard(await f.campaign()),
      },
    );
    expect(later.state).toBe("unchanged");
    expect(later.reconciliationId).not.toBe(own.reconciliationId);
    const refreshed = page.waitForResponse((r) =>
      r.url().endsWith(`/giveaway/${f.campaignId}/reconciliation/checklist`),
    );
    await page
      .getByRole("button", { name: "Refresh current readiness", exact: true })
      .click();
    expect((await (await refreshed).json()).data.latestStoredResultId).toBe(
      later.reconciliationId,
    );
    await expect(latest).toContainText(later.reconciliationId);
    await expect(latest).toContainText(
      "Fictional independent unchanged reconciliation B",
    );
    const ownReceipt = page.getByRole("region", {
      name: "Your recorded reconciliation receipt",
      exact: true,
    });
    await expect(ownReceipt).toContainText(own.reconciliationId);
    await expect(ownReceipt).toContainText(
      "Fictional own unchanged reconciliation A",
    );
    await expect(
      latest.getByText("Passed during preparation", { exact: true }),
    ).toHaveCount(9);
    await expect(
      ownReceipt.getByText("Passed during preparation", { exact: true }),
    ).toHaveCount(9);
    await captureChecklistResponsive(page, "Concurrent-reconciliation-history");
    expect(
      await f.observe(`giveaway/${f.campaignId}/snapshots/${snapshot.id}`),
    ).toEqual(original);
    expect(
      await f.observe(`giveaway/${f.campaignId}/snapshots/${snapshot.id}/rows`),
    ).toEqual(rows);
    expect(
      await f.observe(
        `giveaway/${f.campaignId}/snapshots/${snapshot.id}/sources`,
      ),
    ).toEqual(sources);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [f.campaignId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-09 an authorized response from a previous checklist mount cannot authorize its later remount", async ({
  page,
  leaderboardStack,
}) => {
  const f = await checklistFixture(page.request, leaderboardStack.origin);
  let releaseOld = () => {};
  let releaseCurrent = () => {};
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const phone = census.phones.items[0]!;
    await page.goto(`${base}/phones/${phone.id}/unavailable`);
    await page
      .getByLabel("Why is this phone unavailable?", { exact: true })
      .fill(reason);
    let captured = () => {};
    const oldCaptured = new Promise<void>((resolve) => {
      captured = resolve;
    });
    let delivered = () => {};
    const oldDelivered = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let first = true;
    await page.route("**/reconciliation/selection/phones?**", async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      captured();
      await oldGate;
      await route.fulfill({ response }); // Actual earlier authorized response, not fabricated success.
      delivered();
    });
    await page
      .getByRole("button", {
        name: "Review unavailable-phone proposal",
        exact: true,
      })
      .click();
    await oldCaptured;
    await page
      .getByRole("navigation", { name: "Admin", exact: true })
      .getByRole("link", { name: "Sales", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sales", exact: true, level: 1 }),
    ).toBeVisible();
    const next = await f.otherActor();
    await api(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/manager`,
      {
        operationId: v7(),
        expectedVersion: (await f.campaign()).version,
        managerAdminId: next.adminId,
        reason: "Fictional manager changed after prior-mount authorized read",
      },
      201,
    );
    releaseOld();
    await oldDelivered;
    await page.evaluate(
      ({ reason }) => {
        const state = { inserted: [] as string[] };
        (
          window as unknown as { leaseObservation: typeof state }
        ).leaseObservation = state;
        new MutationObserver((records) => {
          for (const record of records) {
            const nodes =
              record.type === "characterData"
                ? [record.target]
                : [...record.addedNodes];
            for (const node of nodes) {
              const text = node.textContent ?? "";
              if (text.includes(reason))
                state.inserted.push("protected reason");
              if (text.includes("Submit for independent approval"))
                state.inserted.push("confirmation");
            }
          }
        }).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      },
      { reason },
    );
    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    await page.route("**/reconciliation/checklist**", async (route) => {
      await gate;
      await route.continue();
    });
    const request = page.waitForRequest((r) =>
      r.url().includes("/reconciliation/checklist"),
    );
    await page.evaluate(() => history.back());
    await request;
    const inserted = await page.evaluate(
      () =>
        (window as unknown as { leaseObservation: { inserted: string[] } })
          .leaseObservation.inserted,
    );
    const response = page.waitForResponse((r) =>
      r.url().includes("/reconciliation/checklist"),
    );
    releaseCurrent();
    expect((await response).status()).toBe(200);
    const denied = await f.actor.request.get(
      `${leaderboardStack.origin}/api/admin/giveaway/${f.campaignId}/reconciliation/selection/phones?limit=1`,
    );
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("permission_denied");
    await expect(
      page.getByRole("button", {
        name: "Submit for independent approval",
        exact: true,
      }),
    ).toHaveCount(0);
    console.log(
      "CHECKLIST_OLD_RESPONSE",
      JSON.stringify({
        actualOldStatus: 200,
        forbiddenCurrentStatus: denied.status(),
        inserted,
      }),
    );
    expect(
      inserted,
      "Earlier mount response must not authorize the remounted review",
    ).toEqual([]);
  } finally {
    releaseOld();
    releaseCurrent();
    await f.close();
  }
});
