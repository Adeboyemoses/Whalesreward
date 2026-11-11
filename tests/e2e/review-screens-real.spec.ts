import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import {
  reviewFixture,
  heldSale,
  openReview,
  explain,
  confirm,
  adminDetail,
  saleDay,
} from "../reviews/helpers";
import { acceptedSale, data, adminActor } from "../sales-history/helpers";
import { signIn } from "../admin-access/admin-access.fixtures";

test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  actionTimeout: 15000,
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("I-22 I-35 duplicate keep-both uses latest pair guards and same-operation lost-response retry", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const a = await acceptedSale(f.phone, "amount", "1500000", f.cardCode);
    const b = await acceptedSale(f.phone, "amount", "1500000", f.cardCode);
    const pair = [a.detail.id, b.detail.id].sort();
    await f.db.query(
      "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional possible repeated purchase','open',1) ON CONFLICT DO NOTHING",
      [v7(), ...pair],
    );
    await openReview(page, a.detail.id, "duplicate");
    const beforeA = await adminDetail(page, a.detail.id),
      beforeB = await adminDetail(page, b.detail.id);
    await expect(
      page.getByText(b.detail.saleCode, { exact: false }).first(),
    ).toBeVisible();
    await explain(page);
    const bodies: unknown[] = [];
    let committed = false;
    await page.route(
      "**/api/admin/duplicate-flags/*/decision",
      async (route) => {
        bodies.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (!committed) {
          committed = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Clear the flag · keep both", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    const retry = page.getByRole("button", { name: /Retry.*decision/i });
    await expect(retry).toBeVisible();
    await expect(
      page.locator("textarea:enabled,input:not([type=hidden]):enabled"),
    ).toHaveCount(0);
    await retry.click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    const body = bodies[0] as {
      purchases: {
        id: string;
        expectedVersion: number;
        expectedRevisionId: string;
      }[];
    };
    expect(body.purchases).toEqual(
      expect.arrayContaining([
        {
          id: beforeA.id,
          expectedVersion: beforeA.version,
          expectedRevisionId: beforeA.currentRevisionId,
        },
        {
          id: beforeB.id,
          expectedVersion: beforeB.version,
          expectedRevisionId: beforeB.currentRevisionId,
        },
      ]),
    );
    const resultA = await adminDetail(page, a.detail.id),
      resultB = await adminDetail(page, b.detail.id);
    expect(resultA.credited).toBe(true);
    expect(resultB.credited).toBe(true);
    expect(resultA.duplicateFlags.every((flag) => flag.state !== "open")).toBe(
      true,
    );
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM sale_decision WHERE operation_id=$1",
          [(bodies[0] as { operationId: string }).operationId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-35 duplicate cancellation names one member and preserves the comparison sale", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const a = await acceptedSale(f.phone, "amount", "1500000", f.cardCode),
      b = await acceptedSale(f.phone, "amount", "1500000", f.cardCode);
    await f.db.query(
      "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional possible repeated purchase','open',1) ON CONFLICT DO NOTHING",
      [v7(), ...[a.detail.id, b.detail.id].sort()],
    );
    await openReview(page, a.detail.id, "duplicate");
    await explain(page);
    const target = page.getByRole("button", {
      name: "Cancel sale " + b.detail.saleCode,
      exact: true,
    });
    await target.click();
    const request = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/duplicate-flags/"),
    );
    await page
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    expect((await request).status()).toBe(200);
    await expect(
      page.getByText(
        `Sale ${b.detail.saleCode} was cancelled and has no loyalty credit. The other sale is unchanged.`,
        { exact: false },
      ),
    ).toBeVisible();
    expect((await adminDetail(page, b.detail.id)).state).toBe("cancelled");
    expect((await adminDetail(page, a.detail.id)).credited).toBe(true);
  } finally {
    await f.close();
  }
});

test("I-31 I-34 price decision keeps independent date hold and date verification uses one Lagos day", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["price", "date"]);
    await page.goto(`/admin/sales/reviews?customer=${f.customerId}`);
    await page.getByLabel("Review type", { exact: true }).selectOption("price");
    await expect(
      page.getByRole("row").filter({ hasText: sale.detail.saleCode }),
    ).toBeVisible();
    await page.getByLabel("Review type", { exact: true }).selectOption("date");
    await expect(
      page.getByRole("row").filter({ hasText: sale.detail.saleCode }),
    ).toBeVisible();
    await openReview(page, sale.id, "price");
    await expect(page.getByText(/Not available yet/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Correct from meter/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Cancel invalid sale/ }),
    ).toBeDisabled();
    await explain(page);
    const outcome = await confirm(page, "Confirm captured values");
    expect(outcome.creditedAfter).toBe(false);
    expect(
      outcome.remainingHolds.map((h: { kind: string }) => h.kind),
    ).toContain("date");
    await openReview(page, sale.id, "date");
    await explain(page);
    await expect(
      page.getByRole("button", { name: "Review verified date", exact: true }),
    ).toBeDisabled();
    // A native date control prevents malformed calendar input. Exercise the real
    // endpoint's adversarial rejection and its UI explanation without faking a response.
    await page.getByLabel("Verified sale date", { exact: true }).fill(saleDay);
    await page.route(
      "**/api/admin/sales/*/holds/*/date-decision",
      async (route) => {
        await route.continue({
          postData: JSON.stringify({
            ...route.request().postDataJSON(),
            verifiedSaleDate: "2026-02-31",
          }),
        });
      },
      { times: 1 },
    );
    await confirm(page, "Review verified date", 422);
    await expect(
      page.getByText(
        "Enter a valid Lagos calendar date supported by the records.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Reload and review current record",
        exact: true,
      })
      .click();
    await explain(page);
    await page
      .getByLabel("Verified sale date", { exact: true })
      .fill("2026-11-11");
    await confirm(page, "Review verified date", 422);
    await expect(
      page.getByText(
        "The verified date cannot be after the day the server received this sale.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Reload and review current record",
        exact: true,
      })
      .click();
    await explain(page);
    await page.getByLabel("Verified sale date", { exact: true }).fill(saleDay);
    const date = await confirm(page, "Review verified date");
    expect(date.outcome).toBe("verify_date");
    const current = await adminDetail(page, sale.id);
    expect(current.verifiedSaleDate).toBe(saleDay);
    expect(current.original.amountKobo).toBe("1000000");
    expect(current.holds.some((h) => h.state === "open")).toBe(false);
  } finally {
    await f.close();
  }
});

test("I-33 P-25 replaced-card ambiguity remains held despite explanatory notes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["card"], "1000000", "ambiguous");
    await openReview(page, sale.id, "card");
    await explain(page);
    await confirm(page, "Confirm valid earlier purchase", 422);
    await expect(
      page.getByText("The records don't settle this yet.", { exact: false }),
    ).toBeVisible();
    expect((await adminDetail(page, sale.id)).credited).toBe(false);
    expect(
      (await f.db.query("SELECT state FROM card WHERE id=$1", [f.cardId]))
        .rows[0].state,
    ).toBe("retired");
  } finally {
    await f.close();
  }
});

test("I-33 P-25 valid earlier card use confirms without reactivating the replaced card", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["card"]);
    await openReview(page, sale.id, "card");
    await explain(page);
    const decision = await confirm(page, "Confirm valid earlier purchase");
    expect(decision.outcome).toBe("confirm_earlier");
    expect(
      (await f.db.query("SELECT state FROM card WHERE id=$1", [f.cardId]))
        .rows[0].state,
    ).toBe("retired");
  } finally {
    await f.close();
  }
});

test("I-26 P-20 capture confirmation covers both blocks and retains an independent price hold", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["capture", "price"]);
    await openReview(page, sale.id, "capture");
    await explain(page);
    const result = await confirm(page, "Confirm capture");
    expect(result.creditedAfter).toBe(false);
    expect(
      result.remainingHolds.map((h: { kind: string }) => h.kind),
    ).toContain("price");
    expect(result.policyBlocks).not.toContain(
      "capture_authorization_unresolved",
    );
    expect(result.policyBlocks).not.toContain("capture_time_unresolved");
    const blocks = (
      await f.db.query(
        "SELECT closure_kind,resolved_at FROM purchase_validation_block WHERE purchase_id=$1",
        [sale.id],
      )
    ).rows;
    expect(blocks).toHaveLength(2);
    expect(
      blocks.every((b) => b.closure_kind === "confirmed" && b.resolved_at),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test("I-07 I-09 stale review and live permission revocation never apply a changed decision", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["price"]);
    await openReview(page, sale.id, "price");
    await explain(page);
    await page
      .getByRole("button", { name: "Confirm captured values", exact: true })
      .click();
    await f.db.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
      sale.id,
    ]);
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/price-decision"),
    );
    await page
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    expect((await response).status()).toBe(409);
    await expect(
      page.getByText(/changed|latest|refresh/i).first(),
    ).toBeVisible();
    expect(
      (await adminDetail(page, sale.id)).holds.some((h) => h.state === "open"),
    ).toBe(true);
    const actor = await adminActor(f.db, ["sales", "priceReview"]);
    const other = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
    });
    const reviewer = await other.newPage();
    try {
      await signIn(reviewer, actor.username, actor.password);
      await expect(reviewer).not.toHaveURL(/sign-in/);
      await openReview(reviewer, sale.id, "price");
      await explain(reviewer);
      await reviewer
        .getByRole("button", { name: "Confirm captured values", exact: true })
        .click();
      await f.db.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='priceReview'",
        [actor.roleId],
      );
      const denied = reviewer.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/price-decision"),
      );
      await reviewer
        .getByRole("button", { name: "Confirm decision", exact: true })
        .click();
      expect((await denied).status()).toBe(403);
      expect((await adminDetail(page, sale.id)).credited).toBe(false);
    } finally {
      await other.close();
    }
  } finally {
    await f.close();
  }
});

test("I-26 A14 own held detail uses plain language without proof inputs or internal codes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["price"]);
    for (const width of [390, 360]) {
      await f.phone.setViewportSize({ width, height: 844 });
      await f.phone.goto(`/attendant/history/${sale.id}`);
      await expect(
        f.phone.getByText("Awaiting price review", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        f.phone.getByText(/No need to record this sale again/),
      ).toBeVisible();
      await expect(f.phone.locator("body")).not.toContainText(
        "capture_authorization_unresolved",
      );
      expect(
        await f.phone.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const own = await data<{ credited: boolean }>(
      f.phone.request,
      `/api/attendant/sales/${sale.id}`,
    );
    expect(own.credited).toBe(false);
  } finally {
    await f.close();
  }
});

for (const kind of ["card", "capture"] as const) {
  test(`I-26 I-33 P-25 ${kind} cancellation requires uniformly invalid evidence and keeps history`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(90000);
    const f = await reviewFixture(page, browser);
    try {
      const sale = await heldSale(f, [kind], "1000000", "after");
      if (kind === "capture") {
        // Historical revocation at L proves the entire original interval unauthorized.
        // The fresh session used to view own history is a different context.
        await f.db.query(
          "UPDATE capture_context SET revoked_at=signed_in_at WHERE id=$1",
          [sale.original.captureContextId],
        );
      }
      await openReview(page, sale.id, kind);
      await explain(page);
      const result = await confirm(page, "Cancel invalid sale");
      expect(result.outcome).toBe("cancel");
      expect(result.creditedAfter).toBe(false);
      const detail = await adminDetail(page, sale.id);
      expect(detail.state).toBe("cancelled");
      expect(detail.original.amountKobo).toBe("1000000");
      expect(detail.evidence.state).toBe("validated");
      expect(detail.decisions.some((d) => d.outcome === "cancel")).toBe(true);
      if (kind === "capture") {
        const blocks = (
          await f.db.query(
            "SELECT closure_kind FROM purchase_validation_block WHERE purchase_id=$1",
            [sale.id],
          )
        ).rows;
        expect(blocks).toHaveLength(2);
        expect(blocks.every((b) => b.closure_kind === "cancelled")).toBe(true);
      }
    } finally {
      await f.close();
    }
  });
}
