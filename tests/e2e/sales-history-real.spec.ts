import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import {
  salesFixture,
  acceptedSale,
  submitCorrection,
  data,
  noHistoryOrPhotoCache,
  correctionRows,
  adminActor,
  recoveredProposal,
  type OwnDetail,
  type AdminDetail,
  origin,
} from "../sales-history/helpers";
import { fillSale, rows, waitForWorker } from "../fixtures/offline-browser";
import { signIn as adminSignIn } from "../admin-access/admin-access.fixtures";
import { seedId, api, attendantSignIn } from "../station/helpers";

// Evidence URLs and credentials stay out of traces, screenshots and videos.
test.use({
  actionTimeout: 15000,
  trace: "off",
  video: "off",
  screenshot: "off",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
async function ownDetails(phone: Page, id: string) {
  await phone.goto(`/attendant/history/${id}`);
  await expect(
    phone.getByRole("heading", { name: "Sale details", exact: true }),
  ).toBeVisible();
}
async function correctionEditor(phone: Page, id: string) {
  await phone.goto(`/attendant/history/${id}/correct`);
  await expect(
    phone.getByRole("heading", { name: "Correct sale", exact: true }),
  ).toBeVisible();
}
async function confirmReview(
  page: Page,
  action: "Approve correction" | "Reject request",
  reason: string,
) {
  await page.getByLabel("Decision reason", { exact: true }).fill(reason);
  await page.getByRole("button", { name: action, exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
}

test("I-29 P-22 amount correction preserves kobo, recorded basis, reason and retained photo on real endpoints", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone);
    await f.phone.goto("/attendant/history");
    await expect(
      f.phone.getByRole("heading", { name: "Sales history", exact: true }),
    ).toBeVisible();
    await expect(
      f.phone.getByText("Amina Bello", { exact: true }),
    ).toBeVisible();
    await ownDetails(f.phone, sale.detail.id);
    const evidence = await f.phone.request.get(
      `/api/attendant/sales/${sale.detail.id}/photo`,
    );
    expect(evidence.headers()["content-type"]).toContain("image/jpeg");
    expect(evidence.headers()["cache-control"]).toContain("no-store");
    await correctionEditor(f.phone, sale.detail.id);
    const save = f.phone.getByRole("button", {
      name: "Save correction",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await f.phone.getByLabel("Amount (₦)", { exact: true }).fill("22000.01");
    await expect(save).toBeDisabled();
    await f.phone
      .getByLabel("Reason", { exact: true })
      .fill("Meter amount was entered incorrectly");
    await expect(save).toBeEnabled();
    const request = f.phone.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        r.url().endsWith(`/sales/${sale.detail.id}/corrections`),
    );
    await save.click();
    const body = (await request).postDataJSON();
    expect(body.edit).toEqual({
      basis: "amount",
      enteredAmountKobo: "2200001",
    });
    expect(body.evidenceAssetId).toBe(sale.photoId);
    expect(Object.keys(body.edit)).toEqual(["basis", "enteredAmountKobo"]);
    await expect
      .poll(
        async () => {
          const current = await data<OwnDetail>(
            f.phone.request,
            `/api/attendant/sales/${sale.detail.id}`,
          );
          return current.displayedValues.amountKobo;
        },
        { timeout: 30000 },
      )
      .toBe("2200001");
    const current = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.detail.id}`,
    );
    await expect(
      f.phone.getByText("Correction applied", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    expect(current.original.amountKobo).toBe("2000000");
    expect(current.displayedValues.quantity).toBe("22");
    expect(
      current.revisions.filter((r) => r.state === "accepted"),
    ).toHaveLength(1);
    await noHistoryOrPhotoCache(f.phone);
  } finally {
    await f.close();
  }
});

test("I-29 P-22 quantity correction uses captured rate and rejects excess precision without basis switching", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone, "quantity", "20");
    await correctionEditor(f.phone, sale.detail.id);
    const input = f.phone.getByLabel(/^Quantity/),
      save = f.phone.getByRole("button", {
        name: "Save correction",
        exact: true,
      });
    await input.fill("21.001");
    await f.phone
      .getByLabel("Reason", { exact: true })
      .fill("Meter quantity was entered incorrectly");
    await expect(save).toBeDisabled();
    await input.fill("21.25");
    await expect(save).toBeEnabled();
    const sent = f.phone.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        r.url().endsWith(`/sales/${sale.detail.id}/corrections`),
    );
    await save.click();
    expect((await sent).postDataJSON().edit).toEqual({
      basis: "quantity",
      enteredQuantity: "21.25",
    });
    await expect
      .poll(
        async () => {
          const d = await data<OwnDetail>(
            f.phone.request,
            `/api/attendant/sales/${sale.detail.id}`,
          );
          return d.displayedValues.amountKobo;
        },
        { timeout: 30000 },
      )
      .toBe("2125000");
    const current = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.detail.id}`,
    );
    const switchRequest = await f.phone.request.post(
      `/api/attendant/sales/${sale.detail.id}/corrections`,
      {
        headers: { Origin: origin },
        data: {
          operationId: v7(),
          expectedVersion: current.version,
          basedOnRevisionId: current.currentRevisionId,
          edit: { basis: "amount", enteredAmountKobo: "2200000" },
          reason: "Fictional wrong basis",
          evidenceAssetId: sale.photoId,
        },
      },
    );
    expect(switchRequest.status()).toBe(400);
  } finally {
    await f.close();
  }
});

test("I-22 I-38 offline original and correction retain separate identities and wait for accepted original", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await salesFixture(page, browser);
  try {
    await waitForWorker(f.phone);
    await fillSale(f.phone, { value: "20000.00" });
    await f.context.setOffline(true);
    await f.phone
      .getByRole("button", { name: /^Save sale(?: on phone)?$/ })
      .click();
    await expect(
      f.phone.getByRole("heading", { name: "Saved on phone", exact: true }),
    ).toBeVisible();
    const original = (await rows(f.phone))[0]!;
    await f.phone.getByRole("link", { name: "History", exact: true }).click();
    await f.phone.getByText("Amina Bello", { exact: true }).click();
    await f.phone
      .getByRole("link", { name: "Correct sale", exact: true })
      .or(f.phone.getByRole("button", { name: "Correct sale", exact: true }))
      .click();
    await f.phone.getByLabel("Amount (₦)", { exact: true }).fill("23000.00");
    await f.phone
      .getByLabel("Reason", { exact: true })
      .fill("Fictional offline numeric correction");
    await f.phone
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect
      .poll(async () => (await correctionRows(f.phone))[0]?.state)
      .toBe("waiting_original");
    const localCorrection = (await correctionRows(f.phone))[0]!;
    await expect(
      f.phone.getByText(/Waiting for the original/i).first(),
    ).toBeVisible();
    expect((await rows(f.phone))[0]!.original).toEqual(original.original);
    expect(localCorrection.originalOperationId).toBe(original.operationId);
    expect(localCorrection.operationId).not.toBe(original.operationId);
    expect(localCorrection.submission).toBeNull();
    expect(localCorrection.serverCorrection).toBeNull();
    const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
    f.phone.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/api\/(sync\/sales$|attendant\/sales\/[^/]+\/corrections$)/.test(
          new URL(r.url()).pathname,
        )
      )
        seen.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() });
    });
    await f.context.setOffline(false);
    await expect
      .poll(
        async () => {
          return (
            await f.db.query(
              "SELECT count(*)::int n FROM correction_request WHERE originating_attendant_id=$1 AND state='accepted'",
              [f.attendant.id],
            )
          ).rows[0].n;
        },
        { timeout: 45000 },
      )
      .toBe(1);
    const originalRequest = seen.find((r) => r.path === "/api/sync/sales")!,
      correctionRequest = seen.find((r) => r.path.endsWith("/corrections"))!;
    expect(originalRequest.body.operationId).toBe(original.operationId);
    expect(correctionRequest.body.operationId).not.toBe(original.operationId);
    expect(correctionRequest.body.basedOnRevisionId).toBeTruthy();
    const db = (
      await f.db.query(
        "SELECT p.amount_kobo::text original,r.amount_kobo::text effective,(SELECT count(*)::int FROM purchase_revision x WHERE x.purchase_id=p.id AND state='accepted') accepted FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.operation_id=$1",
        [original.operationId],
      )
    ).rows[0];
    expect(db).toEqual({
      original: "2000000",
      effective: "2300000",
      accepted: 1,
    });
    await noHistoryOrPhotoCache(f.phone);
  } finally {
    await f.close();
  }
});

test("I-22 lost correction response reuses its frozen operation and credits one revision", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone);
    await correctionEditor(f.phone, sale.detail.id);
    await f.phone.getByLabel("Amount (₦)", { exact: true }).fill("24000.00");
    await f.phone
      .getByLabel("Reason", { exact: true })
      .fill("Fictional correction response interruption");
    let lost = false;
    const bodies: unknown[] = [];
    await f.phone.route(
      `**/api/attendant/sales/${sale.detail.id}/corrections`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        bodies.push(route.request().postDataJSON());
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          return route.abort("connectionreset");
        }
        return route.continue();
      },
    );
    await f.phone
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          return (
            await f.db.query(
              "SELECT count(*)::int n FROM correction_request WHERE purchase_id=$1 AND state='accepted'",
              [sale.detail.id],
            )
          ).rows[0].n;
        },
        { timeout: 30000 },
      )
      .toBe(1);
    await f.phone.reload();
    await expect
      .poll(
        async () => {
          const d = await data<OwnDetail>(
            f.phone.request,
            `/api/attendant/sales/${sale.detail.id}`,
          );
          return d.displayedValues.amountKobo;
        },
        { timeout: 30000 },
      )
      .toBe("2400000");
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM correction_request WHERE purchase_id=$1",
          [sale.detail.id],
        )
      ).rows[0].n,
    ).toBe(1);
    if (bodies.length > 1)
      for (const body of bodies) expect(body).toEqual(bodies[0]);
    await expect
      .poll(
        async () => {
          return (await correctionRows(f.phone))[0]?.state;
        },
        { timeout: 30000 },
      )
      .toBe("accepted");
    expect((await correctionRows(f.phone))[0]?.submission).toEqual(bodies[0]);
  } finally {
    await f.phone.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-07 admin search preserves exact customer scope and uses whole-filter summary without unsupported actions", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone),
      second = await acceptedSale(f.phone, "amount", "1000000");
    const scoped = await data<{
      summary: { records: string; spend: { amountKobo: string }[] };
      items: Array<{ id: string }>;
    }>(page.request, "/api/admin/sales/search", {
      customerId: seedId(26),
      limit: 1,
    });
    const total = await f.db.query(
      "SELECT coalesce(sum(r.amount_kobo),0)::text spend FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.customer_id=$1 AND p.status='credited'",
      [seedId(26)],
    );
    expect(scoped.items).toHaveLength(1);
    expect(scoped.summary.spend[0]?.amountKobo).toBe(total.rows[0].spend);
    await page.goto(`/admin/sales?customerId=${seedId(26)}`);
    await expect(
      page.getByLabel("Search sales", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Clear customer filter", exact: true }).or(
        page.getByRole("button", {
          name: "Clear customer filter",
          exact: true,
        }),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Search sales", { exact: true })
      .fill(sale.detail.saleCode);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("link", { name: "View", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/sales/${sale.detail.id}`));
    for (const name of ["Correct sale", "Mark as duplicate", "Cancel sale"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    await page
      .getByRole("link", { name: "Back to sales", exact: true })
      .click();
    expect(
      new URL(page.url()).searchParams.get("customerId") ??
        new URL(page.url()).searchParams.get("customer"),
    ).toBe(seedId(26));
    await expect(page.getByLabel("Search sales", { exact: true })).toHaveValue(
      sale.detail.saleCode,
    );
    await noHistoryOrPhotoCache(page);
    expect(second.detail.customer?.id).toBe(sale.detail.customer?.id);
  } finally {
    await f.close();
  }
});

test("I-37 late correction needs explicit reasoned review and leaves prior contribution until approval", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone);
    const late = await submitCorrection(f.phone, sale, "2200000", true, f.db);
    expect(late.correction.timing).toBe("late");
    const before = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.detail.id}`,
    );
    expect(before.displayedValues.amountKobo).toBe("2000000");
    await page.goto(`/admin/sales/${sale.detail.id}/late-correction`);
    await expect(
      page.getByRole("heading", {
        name: /^Late correction request/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve correction", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Decision reason", { exact: true })
      .fill("Fictional meter review confirms the entered amount");
    await page
      .getByRole("button", { name: "Approve correction", exact: true })
      .click();
    expect(
      (
        await f.db.query("SELECT state FROM correction_request WHERE id=$1", [
          late.correction.id,
        ])
      ).rows[0].state,
    ).toBe("awaiting_review");
    await page
      .getByRole("button", { name: "Keep reviewing", exact: true })
      .click();
    expect(
      (
        await f.db.query("SELECT state FROM correction_request WHERE id=$1", [
          late.correction.id,
        ])
      ).rows[0].state,
    ).toBe("awaiting_review");
    await confirmReview(
      page,
      "Approve correction",
      "Fictional independent meter review confirmed",
    );
    await expect
      .poll(async () => {
        return (
          await f.db.query("SELECT state FROM correction_request WHERE id=$1", [
            late.correction.id,
          ])
        ).rows[0].state;
      })
      .toBe("accepted");
    const after = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.detail.id}`,
    );
    expect(after.original.amountKobo).toBe("2000000");
    expect(after.displayedValues.amountKobo).toBe("2200000");
    expect(after.decisions).toHaveLength(1);
    const repeated = await page.request.post(
      `/api/admin/sales/${sale.detail.id}/corrections/${late.correction.id}/decision`,
      {
        headers: { Origin: origin },
        data: {
          operationId: v7(),
          expectedVersion: after.version,
          expectedRevisionId: after.currentRevisionId,
          expectedCorrectionVersion: late.correction.version,
          outcome: "approve",
          reason: "Fictional closed review",
        },
      },
    );
    expect(repeated.status()).toBe(409);
    expect((await repeated.json()).error.code).toBe("review_closed");
  } finally {
    await f.close();
  }
});

test("I-07 P-19 recovered authorship remains unverified and both original makers are refused", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await salesFixture(page, browser);
  const executor = await adminActor(f.db, ["sales", "corrections"]),
    authorizer = await adminActor(f.db, ["sales", "corrections"]),
    reader = await adminActor(f.db, ["sales"]);
  const contexts = [];
  try {
    const sale = await acceptedSale(f.phone);
    const ex = await browser.newContext({ baseURL: origin }),
      au = await browser.newContext({ baseURL: origin }),
      rd = await browser.newContext({ baseURL: origin });
    contexts.push(ex, au, rd);
    const exPage = await ex.newPage(),
      auPage = await au.newPage(),
      rdPage = await rd.newPage();
    for (const [p, a] of [
      [exPage, executor],
      [auPage, authorizer],
      [rdPage, reader],
    ] as const) {
      await p
        .context()
        .setExtraHTTPHeaders({ "x-test-ip": `2001:db8::${v7().slice(-4)}` });
      await adminSignIn(p, a.username, a.password);
      await expect(p).not.toHaveURL(/sign-in$/);
    }
    const proposal = await recoveredProposal(f.db, sale, executor, authorizer);
    await exPage.goto(`/admin/sales/${sale.detail.id}/late-correction`);
    await expect(exPage.getByText(/unverified/i).first()).toBeVisible();
    await expect(
      exPage.getByRole("button", { name: "Approve correction", exact: true }),
    ).toHaveCount(0);
    for (const p of [exPage, auPage]) {
      const current = await data<AdminDetail>(
        p.request,
        `/api/admin/sales/${sale.detail.id}`,
      );
      const response = await p.request.post(
        `/api/admin/sales/${sale.detail.id}/corrections/${proposal.correctionId}/decision`,
        {
          headers: { Origin: origin },
          data: {
            operationId: v7(),
            expectedVersion: current.version,
            expectedRevisionId: current.currentRevisionId,
            expectedCorrectionVersion: 1,
            outcome: "reject",
            reason: "Fictional maker must be refused",
          },
        },
      );
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe("permission_denied");
    }
    await rdPage.goto(`/admin/sales/${sale.detail.id}/late-correction`);
    await expect(
      rdPage.getByRole("button", { name: "Approve correction", exact: true }),
    ).toHaveCount(0);
    await page.goto(`/admin/sales/${sale.detail.id}/late-correction`);
    await expect(page.getByText(/unverified/i).first()).toBeVisible();
    await confirmReview(
      page,
      "Reject request",
      "Independent review could not authenticate this proposal",
    );
    await expect
      .poll(async () => {
        return (
          await f.db.query("SELECT state FROM correction_request WHERE id=$1", [
            proposal.correctionId,
          ])
        ).rows[0].state;
      })
      .toBe("rejected");
    const retained = await data<AdminDetail>(
      page.request,
      `/api/admin/sales/${sale.detail.id}`,
    );
    expect(retained.displayedValues.amountKobo).toBe("2000000");
    expect(retained.corrections[0]?.authorship).toBe("unverified_recovery");
  } finally {
    for (const c of contexts) await c.close();
    await f.close();
  }
});

test("I-06 pending correction and server history stay with originating account after handover", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone);
    const otherUsername = `handover.${v7().slice(-12)}`,
      otherPassword = `Fictional-${v7()}`;
    const second = await api<{ id: string; accountId: string }>(
      page.request,
      "attendants",
      {
        operationId: v7(),
        name: "Favour James",
        username: otherUsername,
        password: otherPassword,
        pumpId: seedId(14),
        expectedPumpVersion: 1,
      },
      201,
    );
    await f.db.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [second.accountId],
    );
    await correctionEditor(f.phone, sale.detail.id);
    await f.phone.getByLabel("Amount (₦)", { exact: true }).fill("25000.00");
    await f.phone
      .getByLabel("Reason", { exact: true })
      .fill("Fictional pending account correction");
    await f.context.setOffline(true);
    await f.phone
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect
      .poll(async () => (await correctionRows(f.phone)).length)
      .toBe(1);
    await f.phone.getByRole("link", { name: "Account", exact: true }).click();
    await f.phone
      .getByRole("button", { name: "Sign out / hand over device", exact: true })
      .click();
    await f.phone
      .getByRole("button", { name: /^Sign out(?: with pending sales)?$/ })
      .click();
    await expect(f.phone).toHaveURL(/\/attendant\/sign-in$/);
    await f.context.setOffline(false);
    await attendantSignIn(f.phone, otherUsername, otherPassword);
    await expect(f.phone).toHaveURL(/\/attendant\/sale$/);
    await f.phone.getByRole("link", { name: "History", exact: true }).click();
    await expect(
      f.phone.getByRole("heading", { name: "Sales history", exact: true }),
    ).toBeVisible();
    await expect(f.phone.getByText("Amina Bello", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      f.phone.getByText("Fictional pending account correction", {
        exact: true,
      }),
    ).toHaveCount(0);
    const foreign = await f.phone.request.get(
      `/api/attendant/sales/${sale.detail.id}`,
    );
    expect(foreign.status()).toBe(404);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM correction_request WHERE purchase_id=$1",
          [sale.detail.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
