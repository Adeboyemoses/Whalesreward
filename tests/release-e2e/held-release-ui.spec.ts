import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { v7 } from "uuid";
import {
  releaseFixture,
  boundarySale,
  preparation,
  uploadSheet,
  proposalBody,
  post,
  sheetBytes,
  type Proposal,
  type ReleaseFixture,
  type Preparation,
} from "../fixtures/held-release-browser";
import { adminDetail } from "../reviews/helpers";

test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  actionTimeout: 15000,
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
const proposerAttestation =
  "I have inspected the sheet photo. The facts and time precision above are legible and faithfully copied.";
const reviewerAttestation =
  "I have independently inspected the sheet photo. The facts and time precision are legible and faithfully copied.";

async function captureView(page: Page, state: string) {
  const original = page.viewportSize();
  const dir = "tests/design-parity/held-release";
  await mkdir(dir, { recursive: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `${dir}/${state}-${width}.built.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  if (original) await page.setViewportSize(original);
}
async function open(page: Page, id: string, kind: string, proposal?: string) {
  await page.goto(
    `/admin/sales/${id}/${kind}-review${proposal ? `?proposal=${proposal}` : ""}`,
  );
  await expect(
    page.getByText("Loading release details…", { exact: true }),
  ).toHaveCount(0);
}
async function fillDateForm(page: Page, prep: Preparation) {
  const naira = (k: string) =>
    `${BigInt(k) / 100n}.${(BigInt(k) % 100n).toString().padStart(2, "0")}`;
  await page.getByRole("radio", { name: "Shift sheet", exact: true }).check();
  await page
    .getByLabel("Entry reference", { exact: true })
    .fill("Shift A entry 7");
  await page
    .getByLabel("Amount written in the entry (₦)", { exact: true })
    .fill(naira(prep.currentCandidate.values.amountKobo));
  await page
    .getByLabel("Quantity written in the entry (litres)", { exact: true })
    .fill(prep.currentCandidate.values.quantity);
  await page
    .getByLabel("Rate written in the entry (₦ / litre)", { exact: true })
    .fill(naira(prep.currentCandidate.values.rateKobo));
  await page.getByRole("radio", { name: "Time range", exact: true }).check();
  await page.getByRole("radio", { name: "Minute", exact: true }).check();
  await page
    .getByLabel("Earliest supported date", { exact: true })
    .fill("2026-11-11");
  await page
    .getByLabel("Earliest supported time", { exact: true })
    .fill("00:10");
  await page
    .getByLabel("Latest supported date", { exact: true })
    .fill("2026-11-11");
  await page.getByLabel("Latest supported time", { exact: true }).fill("00:20");
  await page.getByRole("radio", { name: "Sale recorded", exact: true }).check();
  await page
    .getByRole("radio", {
      name: "Confirm sale date from the entry",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Proposal reason", { exact: true })
    .fill(
      "The matching entry records this sale on the next Lagos day within its full supported minute range",
    );
  await page.getByLabel(proposerAttestation, { exact: true }).check();
}
async function addPhoto(page: Page, prep: Preparation) {
  await page.getByLabel("Choose JPEG", { exact: true }).setInputFiles({
    name: "fictional-entry.jpg",
    mimeType: "image/jpeg",
    buffer: await sheetBytes("date", "confirm", prep.currentCandidate.values),
  });
  await expect(
    page.getByText("Sheet photo preview", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use this photo", exact: true })
    .click();
  await expect(
    page.getByText("Photo received · entry still needs review", {
      exact: true,
    }),
  ).toBeVisible();
}

for (const kind of ["price", "card", "date", "capture"] as const) {
  test(`R1–R3 ${kind}: only positive protected admission opens blank attestation fields`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    const f = await releaseFixture(page, browser);
    try {
      const sale = await boundarySale(f, kind);
      await open(page, sale.id, kind);
      await expect(
        page.getByRole("button", {
          name: "Propose a release with a sheet photo",
          exact: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole("button", {
          name: "Propose a release with a sheet photo",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("This proposal will not credit or cancel the sale.", {
          exact: true,
        }),
      ).toBeVisible();
      for (const label of [
        "Entry reference",
        "Amount written in the entry (₦)",
        "Quantity written in the entry (litres)",
        "Rate written in the entry (₦ / litre)",
        "Proposal reason",
      ])
        await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
      await expect(
        page.getByLabel(proposerAttestation, { exact: true }),
      ).not.toBeChecked();
      await page
        .getByRole("button", { name: "Review proposal", exact: true })
        .click();
      await expect(
        page.getByText("Check the marked fields before reviewing.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Entry reference", { exact: true }),
      ).toHaveAttribute("aria-invalid", "true");
      const count = await f.db.query(
        "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
        [sale.id],
      );
      expect(count.rows[0].n).toBe(0);
    } finally {
      await f.close();
    }
  });
}

test("R2 R4–R11 minute attestation uploads, freezes lost proposal/decision responses and displays server credit", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date");
    await open(page, sale.id, "date");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    const prep = await preparation(page, sale.id, "date");
    await addPhoto(page, prep);
    await fillDateForm(page, prep);
    const bodies: unknown[] = [];
    await page.route(
      `**/api/admin/sales/${sale.id}/release-proposals`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        bodies.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect([200, 201]).toContain(response.status());
        if (bodies.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Review proposal", exact: true })
      .click();
    await expect(
      page
        .getByRole("heading", { name: "Review proposal", exact: true })
        .last(),
    ).toBeFocused();
    await expect(
      page.getByText("Submitting a proposal does not change loyalty credit.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm proposal", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry same proposal", exact: true }),
    ).toBeVisible();
    await captureView(page, "R10-uncertain-proposal");
    await page
      .getByRole("button", { name: "Retry same proposal", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    const body = bodies[0] as {
      facts: { observedCapture: { from: string; through: string } };
    };
    expect(body.facts.observedCapture).toEqual({
      from: "2026-11-10T23:10:00.000Z",
      through: "2026-11-10T23:20:59.999Z",
      timezone: "Africa/Lagos",
    });
    await expect(
      page.getByText("Awaiting another reviewer", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("You can't approve your own proposal.", { exact: true }),
    ).toBeVisible();
    const proposal = (
      await f.db.query(
        "SELECT id FROM held_release_proposal WHERE purchase_id=$1",
        [sale.id],
      )
    ).rows[0].id;
    const current = await adminDetail(page, sale.id);
    await open(f.reviewer, sale.id, "date", proposal);
    await f.reviewer
      .getByRole("button", { name: "Load original meter photo", exact: true })
      .click();
    await f.reviewer
      .getByRole("button", { name: "Load sheet photo", exact: true })
      .click();
    await expect(
      f.reviewer.getByRole("img", {
        name: `Sheet entry for sale ${sale.detail.saleCode}`,
        exact: true,
      }),
    ).toBeVisible();
    await f.reviewer.getByLabel(reviewerAttestation, { exact: true }).check();
    await f.reviewer
      .getByLabel("Decision reason", { exact: true })
      .last()
      .fill(
        "I independently inspected both images and verified the copied range and sale date",
      );
    const decisions: unknown[] = [];
    await f.reviewer.route(
      `**/api/admin/sales/${sale.id}/release-proposals/${proposal}/decision`,
      async (route) => {
        decisions.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (decisions.length === 1)
          await route.fulfill({
            response,
            body: "{malformed success",
            contentType: "application/json",
          });
        else await route.fulfill({ response });
      },
    );
    await f.reviewer
      .getByRole("button", { name: "Approve proposal", exact: true })
      .click();
    await f.reviewer
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    await expect(
      f.reviewer.getByRole("button", {
        name: "Retry same decision",
        exact: true,
      }),
    ).toBeVisible();
    await f.reviewer
      .getByRole("button", { name: "Retry same decision", exact: true })
      .click();
    await expect.poll(() => decisions.length).toBe(2);
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[0]).toMatchObject({
      expectedVersion: current.version,
      expectedRevisionId: current.currentRevisionId,
    });
    await expect(
      f.reviewer.getByText("Release decision recorded", { exact: true }),
    ).toBeVisible();
    await captureView(f.reviewer, "R11-recorded");
    const final = await adminDetail(page, sale.id);
    if (final.credited)
      await expect(
        f.reviewer.getByText("Loyalty credit recorded", { exact: true }),
      ).toBeVisible();
    else
      await expect(
        f.reviewer.getByText(
          /Still held for review|Decision recorded · not credited/,
          { exact: true },
        ),
      ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("R16 R18 protected failure is never empty and permission loss clears paper and unsent facts", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date");
    await page.route(
      `**/api/admin/sales/${sale.id}/release-proposals?*`,
      (route) =>
        route.fulfill({
          status: 503,
          json: {
            error: {
              code: "temporarily_unavailable",
              message: "Fictional unavailable",
              retryable: true,
            },
            serverTime: new Date().toISOString(),
            requestId: v7(),
          },
        }),
    );
    await open(page, sale.id, "date");
    await expect(
      page.getByText("Release details couldn't be loaded.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No release proposals recorded.", { exact: true }),
    ).toHaveCount(0);
    await page.unroute(`**/api/admin/sales/${sale.id}/release-proposals?*`);
    await open(page, sale.id, "date");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    await addPhoto(page, await preparation(page, sale.id, "date"));
    await page
      .getByLabel("Entry reference", { exact: true })
      .fill("PRIVATE-DRAFT-REFERENCE");
    await f.db.query(
      "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
      [f.userId],
    );
    await page
      .getByRole("button", { name: "Review proposal", exact: true })
      .click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect
      .poll(async () =>
        page.locator('input[value="PRIVATE-DRAFT-REFERENCE"]').count(),
      )
      .toBe(0);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  } finally {
    await f.close();
  }
});

async function pendingFixture(page: Page, f: ReleaseFixture) {
  const sale = await boundarySale(f, "date"),
    prep = await preparation(page, sale.id, "date"),
    sheet = await uploadSheet(page, sale.id, prep);
  const proposal = (await post(
    page.request,
    `/api/admin/sales/${sale.id}/release-proposals`,
    proposalBody(prep, sheet.assetId),
    201,
  )) as Proposal;
  return { sale, prep, sheet, proposal };
}

test("RD-07 complete server queue traverses over 100 tied-time stale proposals without inheriting ordinary filters", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    const codes = [x.sale.detail.saleCode];
    await f.db.query("BEGIN");
    try {
      for (let n = 0; n < 103; n++) {
        const purchase = v7(),
          proposal = v7(),
          sheet = v7(),
          code = `S-QUEUE-${n}-${purchase.slice(-6)}`;
        codes.push(code);
        await f.db.query(
          `INSERT INTO purchase SELECT (jsonb_populate_record(NULL::purchase,to_jsonb(p)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'sale_code',$4::text,'current_revision_id',NULL,'resolution_candidate_revision_id',NULL,'status','cancelled'))).* FROM purchase p WHERE id=$1`,
          [x.sale.id, purchase, v7(), code],
        );
        await f.db.query(
          `INSERT INTO held_release_sheet SELECT (jsonb_populate_record(NULL::held_release_sheet,to_jsonb(s)||jsonb_build_object('id',$2::text,'purchase_id',$3::text,'staging_key',$4::text))).* FROM held_release_sheet s WHERE id=$1`,
          [x.sheet.assetId, sheet, purchase, `staging/${sheet}`],
        );
        await f.db.query(
          `INSERT INTO held_release_proposal SELECT (jsonb_populate_record(NULL::held_release_proposal,to_jsonb(p)||jsonb_build_object('id',$2::text,'purchase_id',$3::text,'sheet_asset_id',$4::text,'proposed_at',$5::text,'content',p.content||jsonb_build_object('id',$2::text,'purchaseId',$3::text,'proposedAt',$5::text)))).* FROM held_release_proposal p WHERE id=$1`,
          [
            x.proposal.id,
            proposal,
            purchase,
            sheet,
            "2026-11-16T12:00:00.123456Z",
          ],
        );
        await f.db.query(
          "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
          [proposal, purchase],
        );
        await f.db.query(
          "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
          [v7(), proposal, f.userId],
        );
      }
      await f.db.query("COMMIT");
    } catch (error) {
      await f.db.query("ROLLBACK");
      throw error;
    }
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/release-proposals/pending"))
        requests.push(r.url());
    });
    await page.goto(`/admin/sales/reviews?customer=${f.customerId}`);
    await page
      .getByLabel("Review type", { exact: true })
      .selectOption({ label: "Pending releases" });
    await expect(
      page.getByLabel("Pending release kind", { exact: true }),
    ).toHaveValue("");
    const seen = new Set<string>();
    let pages = 0;
    while (true) {
      const rows = page
        .getByRole("table", { name: "Pending releases", exact: true })
        .locator("tbody tr");
      await expect(rows.first()).toBeVisible();
      for (const code of codes) {
        if (await rows.getByText(code, { exact: true }).count()) seen.add(code);
      }
      pages++;
      const next = page.getByRole("button", { name: "Next", exact: true });
      if (await next.isDisabled()) break;
      const response = page.waitForResponse(
        (r) =>
          r.url().includes("/release-proposals/pending") && r.status() === 200,
      );
      await next.click();
      const nextPage = (await (await response).json()).data as {
        items: { saleCode: string }[];
      };
      if (nextPage.items.length)
        await expect(
          rows.getByText(nextPage.items[0]!.saleCode, { exact: true }),
        ).toBeVisible();
      if (pages > 10)
        throw new Error("Pending cursor traversal did not terminate");
    }
    expect(seen.size).toBe(codes.length);
    expect(pages).toBeGreaterThan(4);
    expect(
      requests.every(
        (url) => !url.includes("customer") && !url.includes("day="),
      ),
    ).toBe(true);
    await expect(
      page
        .getByText(/Zero visible|visible.*block|does not.*giveaway|not.*global/)
        .first(),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("R2 R7 R8 independent written-brief fidelity across all four kinds at 1440, 390 and 360 pixels", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const f = await releaseFixture(page, browser);
  try {
    for (const kind of ["price", "card", "date", "capture"] as const) {
      const sale = await boundarySale(f, kind),
        prep = await preparation(page, sale.id, kind);
      await open(page, sale.id, kind);
      await page
        .getByRole("button", {
          name: "Propose a release with a sheet photo",
          exact: true,
        })
        .click();
      await captureView(page, `R2-${kind}`);
      await page
        .getByRole("button", { name: "Review proposal", exact: true })
        .click();
      await expect(
        page.getByText("Check the marked fields before reviewing.", {
          exact: true,
        }),
      ).toBeVisible();
      await captureView(page, `R3-${kind}`);
      const sheet = await uploadSheet(page, sale.id, prep),
        proposal = (await post(
          page.request,
          `/api/admin/sales/${sale.id}/release-proposals`,
          proposalBody(prep, sheet.assetId),
          201,
        )) as Proposal;
      await open(f.reviewer, sale.id, kind, proposal.id);
      await expect(
        f.reviewer
          .getByText("Awaiting another reviewer", { exact: true })
          .first(),
      ).toBeVisible();
      await captureView(f.reviewer, `R7-R8-${kind}`);
    }
  } finally {
    await f.close();
  }
});

for (const denial of [
  "ordinary_review_required",
  "not_admissible",
  "proposer_denied",
] as const) {
  test(`R1 ${denial}: an ordinary failure or denied preparation cannot open the propose form`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    const f = await releaseFixture(page, browser);
    try {
      const sale = await boundarySale(f, "date");
      await page.route(
        `**/api/admin/sales/${sale.id}/release-preparation?kind=date`,
        async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          const json = await response.json();
          if (denial === "proposer_denied")
            json.data.proposerAccess = {
              allowed: false,
              reason: "independence_unverifiable",
            };
          else
            json.data.admission =
              denial === "ordinary_review_required"
                ? { state: "ordinary_review_required", reason: "v1_settleable" }
                : { state: "not_admissible", reason: "history_incomplete" };
          await route.fulfill({ response, json });
        },
      );
      await open(page, sale.id, "date");
      await expect(
        page.getByRole("button", {
          name: "Propose a release with a sheet photo",
          exact: true,
        }),
      ).not.toBeEnabled();
      await expect(
        page.getByLabel("Proposal reason", { exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
            [sale.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await f.close();
    }
  });
}

test("R4 uncertain reserve and finalize retry their original operations without replacing the photo", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date"),
      prep = await preparation(page, sale.id, "date");
    await open(page, sale.id, "date");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    const reserves: unknown[] = [],
      finalizes: unknown[] = [];
    await page.route(
      `**/api/admin/sales/${sale.id}/release-sheet-uploads`,
      async (route) => {
        reserves.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect([200, 201]).toContain(response.status());
        if (reserves.length === 1)
          await route.fulfill({
            response,
            body: "{unreadable success",
            contentType: "application/json",
          });
        else await route.fulfill({ response });
      },
    );
    await page.route(
      `**/api/admin/sales/${sale.id}/release-sheet-uploads/*/finalize`,
      async (route) => {
        finalizes.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (finalizes.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await page.getByLabel("Choose JPEG", { exact: true }).setInputFiles({
      name: "fictional-entry.jpg",
      mimeType: "image/jpeg",
      buffer: await sheetBytes("date", "confirm", prep.currentCandidate.values),
    });
    await page
      .getByRole("button", { name: "Use this photo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry same photo upload", exact: true })
      .click();
    await expect.poll(() => finalizes.length).toBe(1);
    await page
      .getByRole("button", { name: "Retry same photo upload", exact: true })
      .click();
    await expect(
      page.getByText("Photo received · entry still needs review", {
        exact: true,
      }),
    ).toBeVisible();
    expect(reserves).toHaveLength(2);
    expect(reserves[1]).toEqual(reserves[0]);
    expect(finalizes).toHaveLength(2);
    expect(finalizes[1]).toEqual(finalizes[0]);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM held_release_sheet WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM held_release_proposal WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("R8 retained-photo keyboard viewer restores focus and expired inspection disables approval", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    await open(f.reviewer, x.sale.id, "date", x.proposal.id);
    await f.reviewer
      .getByRole("button", { name: "Load sheet photo", exact: true })
      .click();
    const sheet = f.reviewer.getByRole("region", {
      name: "Sheet photo",
      exact: true,
    });
    const openButton = sheet.getByRole("button", {
      name: "Open full size",
      exact: true,
    });
    await openButton.focus();
    await f.reviewer.keyboard.press("Enter");
    const dialog = f.reviewer.getByRole("dialog", {
      name: "Full size sheet photo",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
    await f.reviewer.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(openButton).toBeFocused();
    await f.reviewer.reload();
    await f.reviewer.route(
      `**/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/photo-access`,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const json = await response.json();
        json.data.expiresAt = new Date(Date.now() + 1200).toISOString();
        await route.fulfill({ response, json });
      },
    );
    await f.reviewer
      .getByRole("button", { name: "Load sheet photo", exact: true })
      .click();
    await expect(
      f.reviewer.getByText("Photo access expired. Load the photo again.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      f.reviewer.getByRole("button", { name: "Approve proposal", exact: true }),
    ).toBeDisabled();
    await f.reviewer
      .getByLabel("Decision reason", { exact: true })
      .last()
      .fill("The entry cannot be verified while access is expired");
    await expect(
      f.reviewer.getByRole("button", { name: "Reject proposal", exact: true }),
    ).toBeEnabled();
  } finally {
    await f.close();
  }
});

test("R12 R13 recorded rejected and superseded history do not invent loyalty outcomes or supersession time", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    const current = await adminDetail(page, x.sale.id);
    await post(
      f.reviewer.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: current.version,
        expectedRevisionId: current.currentRevisionId,
        expectedProposalVersion: x.proposal.version,
        outcome: "reject",
        reason: "The entry could not be independently confirmed",
      },
    );
    await open(page, x.sale.id, "date", x.proposal.id);
    await expect(
      page.getByRole("heading", { name: "Proposal rejected", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This proposal changed no sale values or holds. Check the current sale status below.",
        { exact: true },
      ),
    ).toBeVisible();
    const prep = await preparation(page, x.sale.id, "date");
    const next = (await post(
      page.request,
      `/api/admin/sales/${x.sale.id}/release-proposals`,
      proposalBody(prep, x.sheet.assetId),
      201,
    )) as Proposal;
    // A persisted terminal fixture tests the historical view independently of the already-covered mutation path.
    await f.db.query("BEGIN");
    try {
      await f.db.query(
        "UPDATE held_release_state SET state='superseded',version=version+1 WHERE proposal_id=$1",
        [next.id],
      );
      await f.db.query(
        "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,2,'superseded',NULL,'{}')",
        [v7(), next.id],
      );
      await f.db.query("COMMIT");
    } catch (error) {
      await f.db.query("ROLLBACK");
      throw error;
    }
    await open(page, x.sale.id, "date", next.id);
    await expect(
      page.getByRole("heading", { name: "Proposal superseded", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Supersession time unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve proposal", exact: true }),
    ).toHaveCount(0);
    expect((await adminDetail(page, x.sale.id)).credited).toBe(false);
  } finally {
    await f.close();
  }
});

test("R14 stale decision remains pending until explicit fresh independent rejection", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    await open(f.reviewer, x.sale.id, "date", x.proposal.id);
    await f.reviewer
      .getByLabel("Decision reason", { exact: true })
      .last()
      .fill(
        "Reject this obsolete proposal after inspecting the current record",
      );
    await f.reviewer
      .getByRole("button", { name: "Reject proposal", exact: true })
      .click();
    await f.db.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
      x.sale.id,
    ]);
    await f.reviewer
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    await expect(
      f.reviewer.getByText("This proposal needs a fresh review", {
        exact: true,
      }),
    ).toBeVisible();
    await captureView(f.reviewer, "R14-stale");
    expect(
      (
        await f.db.query(
          "SELECT state FROM held_release_state WHERE proposal_id=$1",
          [x.proposal.id],
        )
      ).rows[0].state,
    ).toBe("pending");
    await f.reviewer
      .getByRole("button", { name: "Refresh sale", exact: true })
      .first()
      .click();
    await f.reviewer
      .getByRole("button", { name: "Reject proposal", exact: true })
      .click();
    await f.reviewer
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    await expect(
      f.reviewer.getByRole("heading", {
        name: "Proposal rejected",
        exact: true,
      }),
    ).toBeVisible();
    await captureView(f.reviewer, "R12-rejected");
  } finally {
    await f.close();
  }
});

test("R4 retained same-sale sheet can be renewed after expiry and requires a fresh inspection", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f),
      current = await adminDetail(page, x.sale.id);
    await post(
      f.reviewer.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: current.version,
        expectedRevisionId: current.currentRevisionId,
        expectedProposalVersion: x.proposal.version,
        outcome: "reject",
        reason:
          "Original entry requires a fresh independently checked proposal",
      },
    );
    await open(page, x.sale.id, "date");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    let reads = 0;
    await page.route(
      `**/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/photo-access`,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const json = await response.json();
        if (++reads === 1)
          json.data.expiresAt = new Date(Date.now() + 1200).toISOString();
        await route.fulfill({ response, json });
      },
    );
    await page
      .getByRole("button", { name: /^Use sheet photo proposed / })
      .click();
    await expect(
      page.getByText("Photo access expired. Load the photo again.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Load photo again", exact: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("img", {
          name: `Sheet entry for sale ${x.sale.detail.saleCode}`,
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByLabel(proposerAttestation, { exact: true }),
    ).not.toBeChecked();
    expect(reads).toBe(2);
    await captureView(page, "R4-retained-renewed");
  } finally {
    await f.close();
  }
});
