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
  type PaperCaptureRange,
} from "../fixtures/held-release-browser";
import { adminDetail } from "../reviews/helpers";
import { data } from "../sales-history/helpers";

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
    page.getByLabel("Two-person release", { exact: true }),
  ).toBeVisible();
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
async function addPhoto(page: Page, prep: Preparation, bytes?: Buffer) {
  await page.getByLabel("Choose JPEG", { exact: true }).setInputFiles({
    name: "fictional-entry.jpg",
    mimeType: "image/jpeg",
    buffer:
      bytes ??
      (await sheetBytes("date", "confirm", prep.currentCandidate.values)),
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
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
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
    if (final.credited) {
      await expect(
        f.reviewer.getByText("Loyalty credit recorded", { exact: true }),
      ).toBeVisible();
      await expect(
        f.reviewer.getByLabel("Two-person release", { exact: true }),
      ).not.toContainText(
        "This sale stays held until a different authorized person can review it.",
      );
    } else
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
          `INSERT INTO purchase SELECT (jsonb_populate_record(NULL::purchase,to_jsonb(p)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'sale_code',$4::text,'current_revision_id',NULL,'resolution_candidate_revision_id',NULL,'status','cancelled','cancellation_reason','Fictional obsolete queue fixture'))).* FROM purchase p WHERE id=$1`,
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

test("R1 R2 R3 all-kind written-brief fidelity before any sheet upload", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  for (const kind of ["price", "card", "date", "capture"] as const) {
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
      await captureView(page, `R1-${kind}`);
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
    } finally {
      await f.close();
    }
  }
});

test("R2 R7 R8 independent written-brief fidelity across all four kinds at 1440, 390 and 360 pixels", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  for (const kind of ["price", "card", "date", "capture"] as const) {
    // Card fixtures retain retirement history; later kinds need their own card.
    const f = await releaseFixture(page, browser);
    try {
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
      let paperRange: PaperCaptureRange | undefined;
      if (kind === "price") {
        const price = (
          await f.db.query(
            `SELECT p.effective_from,
              (SELECT min(n.effective_from) FROM product_price_version n
               WHERE n.product_id=p.product_id AND n.effective_from>p.effective_from) next_boundary
             FROM product_price_version p WHERE p.id=$1`,
            [prep.original.priceVersionId],
          )
        ).rows[0];
        expect(price.next_boundary).not.toBeNull();
        const from =
          Math.ceil(
            Math.max(
              Date.parse("2026-11-10T12:10:00.000Z"),
              new Date(price.effective_from).getTime() + 60000,
            ) / 60000,
          ) * 60000;
        paperRange = {
          from: new Date(from).toISOString(),
          through: new Date(from + 59999).toISOString(),
          timezone: "Africa/Lagos",
        };
        expect(Date.parse(paperRange.through)).toBeLessThan(
          new Date(price.next_boundary).getTime(),
        );
      }
      const sheet = await uploadSheet(
          page,
          sale.id,
          prep,
          "confirm",
          paperRange,
        ),
        proposal = (await post(
          page.request,
          `/api/admin/sales/${sale.id}/release-proposals`,
          proposalBody(prep, sheet.assetId, "confirm", paperRange),
          201,
        )) as Proposal;
      await open(f.reviewer, sale.id, kind, proposal.id);
      await expect(
        f.reviewer
          .getByText("Awaiting another reviewer", { exact: true })
          .first(),
      ).toBeVisible();
      await captureView(f.reviewer, `R7-R8-${kind}`);
    } finally {
      await f.close();
    }
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
        page.getByText(
          denial === "ordinary_review_required"
            ? "The records can settle this through the ordinary review."
            : denial === "not_admissible"
              ? "The records do not admit a two-person release. Continue ordinary review or leave the sale held."
              : "We can't verify that you're an independent reviewer. Ask an authorized administrator to check staff identity records. This sale stays held.",
          { exact: true },
        ),
      ).toBeVisible();
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
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
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
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
      .fill(
        "Reject this obsolete proposal after inspecting the current record",
      );
    await f.reviewer
      .getByRole("button", { name: "Reject proposal", exact: true })
      .click();
    // The stale mutation must happen after prepareDecision freezes its guard.
    const confirmDecision = f.reviewer.getByRole("button", {
      name: "Confirm decision",
      exact: true,
    });
    await expect(confirmDecision).toBeVisible();
    await expect(confirmDecision).toBeEnabled();
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

async function inspectIndependentPhotos(page: Page, saleCode: string) {
  await page
    .getByRole("button", { name: "Load original meter photo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load sheet photo", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: `Original meter evidence for sale ${saleCode}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: `Sheet entry for sale ${saleCode}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel(reviewerAttestation, { exact: true }).check();
}

test("P1 regression: same-view independent rejection refreshes preparation before a new blank proposal", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    await open(f.reviewer, x.sale.id, "date", x.proposal.id);
    await f.reviewer
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
      .fill("The original proposal needs a fresh transcription and review");
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
    const afterRejection = await adminDetail(f.reviewer, x.sale.id);
    expect(afterRejection.version).toBeGreaterThan(
      x.prep.guard.expectedVersion,
    );
    await f.reviewer
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    for (const label of [
      "Entry reference",
      "Amount written in the entry (₦)",
      "Quantity written in the entry (litres)",
      "Rate written in the entry (₦ / litre)",
      "Proposal reason",
    ])
      await expect(f.reviewer.getByLabel(label, { exact: true })).toHaveValue(
        "",
      );
    await f.reviewer
      .getByRole("button", { name: /^Use sheet photo proposed / })
      .click();
    const prep = await preparation(f.reviewer, x.sale.id, "date");
    await fillDateForm(f.reviewer, prep);
    await f.reviewer
      .getByRole("button", { name: "Review proposal", exact: true })
      .click();
    const sent = f.reviewer.waitForRequest(
      (r) =>
        r.method() === "POST" &&
        new URL(r.url()).pathname ===
          `/api/admin/sales/${x.sale.id}/release-proposals`,
    );
    const response = f.reviewer.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname ===
          `/api/admin/sales/${x.sale.id}/release-proposals`,
    );
    await f.reviewer
      .getByRole("button", { name: "Confirm proposal", exact: true })
      .click();
    expect((await sent).postDataJSON()).toMatchObject({
      expectedVersion: afterRejection.version,
      expectedRevisionId: afterRejection.currentRevisionId,
    });
    expect((await response).status()).toBe(201);
    await expect(
      f.reviewer
        .getByText("Awaiting another reviewer", { exact: true })
        .first(),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

for (const outcome of ["confirm", "cancel"] as const) {
  test(`P1 regression: same-view ${outcome} refreshes surrounding original status, ordinary actions and history`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
    const f = await releaseFixture(page, browser);
    try {
      const sale = await boundarySale(f, "date"),
        prep = await preparation(page, sale.id, "date"),
        sheet = await uploadSheet(page, sale.id, prep, outcome);
      const proposal = (await post(
        page.request,
        `/api/admin/sales/${sale.id}/release-proposals`,
        proposalBody(prep, sheet.assetId, outcome),
        201,
      )) as Proposal;
      await open(f.reviewer, sale.id, "date", proposal.id);
      const original = f.reviewer
        .locator("section.wr-sheet")
        .filter({
          has: f.reviewer.getByRole("heading", {
            name: "Original purchase",
            exact: true,
          }),
        })
        .first();
      const history = f.reviewer
        .locator("section.wr-sheet")
        .filter({
          has: f.reviewer.getByRole("heading", {
            name: "Activity and audit trail",
            exact: true,
          }),
        })
        .first();
      await expect(
        original.getByText("Not credited", { exact: true }),
      ).toBeVisible();
      await inspectIndependentPhotos(f.reviewer, sale.detail.saleCode);
      const reason =
        outcome === "cancel"
          ? "The matching entry explicitly records this sale as void and erroneous"
          : "The independent inspection supports this sale date and complete entry range";
      await f.reviewer
        .getByLabel("Two-person release", { exact: true })
        .getByLabel("Decision reason", { exact: true })
        .fill(reason);
      await f.reviewer
        .getByRole("button", { name: "Approve proposal", exact: true })
        .click();
      await f.reviewer
        .getByRole("button", { name: "Confirm decision", exact: true })
        .click();
      await expect(
        f.reviewer.getByRole("heading", {
          name: "Release decision recorded",
          exact: true,
        }),
      ).toBeVisible();
      const fresh = await adminDetail(f.reviewer, sale.id);
      await expect(
        original.getByText(
          fresh.credited ? "Recorded spend included" : "Not credited",
          { exact: true },
        ),
      ).toBeVisible();
      if (outcome === "cancel")
        await expect(
          original.getByText("Cancelled", { exact: true }),
        ).toBeVisible();
      await expect(
        f.reviewer.getByRole("button", {
          name: "Review verified date",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        f.reviewer.getByText(
          "This review is closed. The original and decision history remain available.",
          { exact: true },
        ),
      ).toBeVisible();
      const recorded = await data<Proposal>(
        f.reviewer.request,
        `/api/admin/sales/${sale.id}/release-proposals/${proposal.id}`,
      );
      expect(recorded.decision?.reason).toBe(reason);
      const decision = fresh.decisions.find(
        (d) => d.id === recorded.decision?.result?.id,
      );
      expect(decision).toBeDefined();
      const ordinaryReason =
        outcome === "cancel"
          ? "Held sale cancelled after independent review"
          : "Held sale confirmed after independent review";
      expect(decision!.reason).toBe(ordinaryReason);
      await expect(
        f.reviewer.getByText(`Decision reason: ${reason}`, { exact: true }),
      ).toBeVisible();
      const decisionRow = history.getByRole("listitem").filter({
        has: f.reviewer.getByText(decision!.auditEventId, { exact: true }),
      });
      await expect(decisionRow).toHaveCount(1);
      await expect(
        decisionRow.getByText(ordinaryReason, { exact: true }),
      ).toBeVisible();
      await expect(
        decisionRow.getByText(decision!.auditEventId, { exact: true }),
      ).toBeVisible();
      await f.reviewer
        .getByRole("button", { name: "Refresh sale", exact: true })
        .last()
        .click();
      await expect(
        original.getByText(
          fresh.credited ? "Recorded spend included" : "Not credited",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        decisionRow.getByText(decision!.auditEventId, { exact: true }),
      ).toBeVisible();
      await expect(
        f.reviewer.getByRole("heading", {
          name: "Release decision recorded",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await f.close();
    }
  });
}

for (const photo of ["sheet", "meter"] as const) {
  test(`P1 regression: R9 ${photo} expiry prevents a new approval until fresh inspection and review`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
    const f = await releaseFixture(page, browser);
    try {
      const x = await pendingFixture(page, f);
      await f.reviewer.clock.install();
      const accessPath =
        photo === "sheet"
          ? `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/photo-access`
          : `/api/admin/sales/${x.sale.id}/photo-access`;
      const ordinaryMeterRead =
        photo === "meter"
          ? f.reviewer.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === accessPath &&
                response.request().method() === "POST",
            )
          : null;
      await open(f.reviewer, x.sale.id, "date", x.proposal.id);
      if (ordinaryMeterRead)
        expect((await ordinaryMeterRead).status()).toBe(200);
      let issued = 0;
      await f.reviewer.route(`**${accessPath}`, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const json = await response.json();
        if (++issued === 1)
          json.data.expiresAt = new Date(Date.now() + 5000).toISOString();
        await route.fulfill({ response, json });
      });
      await inspectIndependentPhotos(f.reviewer, x.sale.detail.saleCode);
      await f.reviewer
        .getByLabel("Two-person release", { exact: true })
        .getByLabel("Decision reason", { exact: true })
        .fill(
          "I independently inspected the copied facts and complete time range",
        );
      await f.reviewer
        .getByRole("button", { name: "Approve proposal", exact: true })
        .click();
      await expect(
        f.reviewer.getByRole("heading", {
          name: "Review approval",
          exact: true,
        }),
      ).toBeVisible();
      const writes: unknown[] = [];
      f.reviewer.on("request", (r) => {
        if (
          r.method() === "POST" &&
          new URL(r.url()).pathname.endsWith(
            `/release-proposals/${x.proposal.id}/decision`,
          )
        )
          writes.push(r.postDataJSON());
      });
      await f.reviewer.clock.fastForward(10000);
      await expect(
        f.reviewer.getByText("Photo access expired. Load the photo again.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        f.reviewer.getByRole("button", {
          name: "Confirm decision",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(writes).toHaveLength(0);
      await expect(
        f.reviewer.getByLabel(reviewerAttestation, { exact: true }),
      ).not.toBeChecked();
      await expect(
        f.reviewer.getByRole("button", {
          name: "Reject proposal",
          exact: true,
        }),
      ).toBeEnabled();
      await f.reviewer
        .getByRole("button", { name: "Load photo again", exact: true })
        .click();
      await f.reviewer.getByLabel(reviewerAttestation, { exact: true }).check();
      await f.reviewer
        .getByRole("button", { name: "Approve proposal", exact: true })
        .click();
      await expect(
        f.reviewer.getByRole("heading", {
          name: "Review approval",
          exact: true,
        }),
      ).toBeVisible();
      await f.reviewer
        .getByRole("button", { name: "Confirm decision", exact: true })
        .click();
      await expect(
        f.reviewer.getByRole("heading", {
          name: "Release decision recorded",
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
}

test("P1 regression: uncertain approval retry retains its frozen request after photo access expires", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const x = await pendingFixture(page, f);
    await f.reviewer.clock.install();
    await open(f.reviewer, x.sale.id, "date", x.proposal.id);
    await inspectIndependentPhotos(f.reviewer, x.sale.detail.saleCode);
    await f.reviewer
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
      .fill(
        "The independently checked entry supports this unchanged sale date",
      );
    const writes: unknown[] = [];
    await f.reviewer.route(
      `**/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      async (route) => {
        writes.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (writes.length === 1) await route.abort("failed");
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
    await f.reviewer.clock.fastForward(300001);
    await expect(
      f.reviewer.getByRole("button", {
        name: "Retry same decision",
        exact: true,
      }),
    ).toBeEnabled();
    await f.reviewer
      .getByRole("button", { name: "Retry same decision", exact: true })
      .click();
    await expect(
      f.reviewer.getByRole("heading", {
        name: "Release decision recorded",
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
  } finally {
    await f.close();
  }
});

test("Matrix: quantity-basis cooking gas keeps kilograms, captured precision and blank transcriptions", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser, {
    pumpId: "019a5000-0000-7000-8000-000000000017",
  });
  try {
    const sale = await boundarySale(f, "date", {
      basis: "quantity",
      value: "20.25",
      medium: "cylinder",
    });
    const prep = await preparation(page, sale.id, "date");
    expect(prep.original).toMatchObject({
      basis: "quantity",
      unit: "kilogram",
      quantity: "20.25",
      quantityPrecision: 2,
    });
    await open(page, sale.id, "date");
    const original = page
      .locator("section.wr-sheet")
      .filter({
        has: page.getByRole("heading", {
          name: "Original purchase",
          exact: true,
        }),
      })
      .first();
    await expect(original.getByText("Quantity", { exact: true })).toBeVisible();
    await expect(original).toContainText("kilograms");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    const quantity = page.getByLabel(
      "Quantity written in the entry (kilograms)",
      { exact: true },
    );
    await expect(quantity).toHaveValue("");
    await expect(
      page.getByLabel("Rate written in the entry (₦ / kilogram)", {
        exact: true,
      }),
    ).toHaveValue("");
    await expect(
      page.getByText("Up to 2 decimals, as captured.", { exact: true }),
    ).toBeVisible();
    await quantity.fill("20.251");
    await page
      .getByRole("button", { name: "Review proposal", exact: true })
      .click();
    await expect(
      page
        .getByText("Enter a positive quantity with no more than 2 decimals.", {
          exact: true,
        })
        .last(),
    ).toBeVisible();
    await expect(quantity).toHaveValue("20.251");
    await captureView(page, "matrix-quantity-kilograms");
  } finally {
    await f.close();
  }
});

for (const precision of ["date", "second", "millisecond"] as const) {
  test(`Matrix: ${precision} paper precision preserves full encoded range and explicit absent fields`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
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
      const label =
        precision === "date"
          ? "11 Nov 2026 · date only"
          : precision === "second"
            ? "11 Nov 2026 · 00:10:05–00:20:06"
            : "11 Nov 2026 · 00:10:05.123–00:20:06.456";
      await addPhoto(
        page,
        prep,
        await sheetBytes(
          "date",
          "confirm",
          prep.currentCandidate.values,
          label,
          true,
        ),
      );
      await fillDateForm(page, prep);
      await page
        .getByLabel("Quantity not written in this entry", { exact: true })
        .check();
      await page
        .getByLabel("Rate not written in this entry", { exact: true })
        .check();
      if (precision === "date") {
        await page
          .getByRole("radio", { name: "Date only", exact: true })
          .check();
        await page
          .getByLabel("Sale date in the entry", { exact: true })
          .fill("2026-11-11");
      } else {
        await page
          .getByRole("radio", {
            name: precision === "second" ? "Second" : "Millisecond",
            exact: true,
          })
          .check();
        await page
          .getByLabel("Earliest supported time", { exact: true })
          .fill(precision === "second" ? "00:10:05" : "00:10:05.123");
        await page
          .getByLabel("Latest supported time", { exact: true })
          .fill(precision === "second" ? "00:20:06" : "00:20:06.456");
      }
      await page
        .getByRole("button", { name: "Review proposal", exact: true })
        .click();
      await expect(
        page.getByText("Not written in the entry", { exact: true }).first(),
      ).toBeVisible();
      const sent = page.waitForRequest(
        (r) =>
          r.method() === "POST" &&
          new URL(r.url()).pathname ===
            `/api/admin/sales/${sale.id}/release-proposals`,
      );
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname ===
            `/api/admin/sales/${sale.id}/release-proposals`,
      );
      await page
        .getByRole("button", { name: "Confirm proposal", exact: true })
        .click();
      const body = (await sent).postDataJSON();
      expect(body.facts).toMatchObject({
        recordedQuantity: null,
        recordedRateKobo: null,
      });
      expect(body.facts.observedCapture).toEqual({
        timezone: "Africa/Lagos",
        from:
          precision === "date"
            ? "2026-11-10T23:00:00.000Z"
            : precision === "second"
              ? "2026-11-10T23:10:05.000Z"
              : "2026-11-10T23:10:05.123Z",
        through:
          precision === "date"
            ? "2026-11-11T22:59:59.999Z"
            : precision === "second"
              ? "2026-11-10T23:20:06.999Z"
              : "2026-11-10T23:20:06.456Z",
      });
      expect((await response).status()).toBe(201);
    } finally {
      await f.close();
    }
  });
}

test("Matrix: staged numeric candidate is separate from immutable original and never prefills paper fields", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date"),
      candidate = v7();
    await f.db.query(
      "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','price_resolution','reason','Fictional staged meter candidate','based_on_revision_id',r.id,'amount_kobo',1900000,'quantity',19,'calculation_mode','meter_evidence','verified_sale_date','2026-11-11'))).* FROM purchase_revision r WHERE r.purchase_id=$1 AND r.kind='original'",
      [sale.id, candidate, v7()],
    );
    await f.db.query(
      "UPDATE purchase SET resolution_candidate_revision_id=$2,version=version+1 WHERE id=$1",
      [sale.id, candidate],
    );
    const prep = await preparation(page, sale.id, "date");
    expect(prep.currentCandidate).toMatchObject({
      revisionId: candidate,
      source: "resolution_candidate",
      values: { amountKobo: "1900000", quantity: "19" },
    });
    expect(prep.original.amountKobo).toBe("2000000");
    await open(page, sale.id, "date");
    await page
      .getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      })
      .click();
    const release = page.locator('[aria-label="Two-person release"]');
    await expect(release).toContainText("₦20,000.00");
    await expect(release).toContainText("₦19,000.00");
    await expect(
      release.getByText("Currently recorded", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByLabel("Amount written in the entry (₦)", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Quantity written in the entry (litres)", {
        exact: true,
      }),
    ).toHaveValue("");
    await captureView(page, "matrix-later-candidate");
  } finally {
    await f.close();
  }
});

test("Matrix: release clears only the date hold and displays remaining price hold without a credit claim", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date"),
      sibling = v7();
    const original = (
      await f.db.query(
        "SELECT id FROM purchase_revision WHERE purchase_id=$1 AND kind='original'",
        [sale.id],
      )
    ).rows[0].id;
    await f.db.query(
      "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'price','open',$3,'price_uncertain',1)",
      [sibling, sale.id, original],
    );
    const prep = await preparation(page, sale.id, "date"),
      sheet = await uploadSheet(page, sale.id, prep);
    const proposal = (await post(
      page.request,
      `/api/admin/sales/${sale.id}/release-proposals`,
      proposalBody(prep, sheet.assetId),
      201,
    )) as Proposal;
    const x = { sale, prep, sheet, proposal };
    await open(f.reviewer, x.sale.id, "date", x.proposal.id);
    await inspectIndependentPhotos(f.reviewer, x.sale.detail.saleCode);
    await f.reviewer
      .getByLabel("Two-person release", { exact: true })
      .getByLabel("Decision reason", { exact: true })
      .fill(
        "The entry settles only the date; the separate price hold remains open",
      );
    await f.reviewer
      .getByRole("button", { name: "Approve proposal", exact: true })
      .click();
    await f.reviewer
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    await expect(
      f.reviewer.getByText("Still held for review", { exact: true }),
    ).toBeVisible();
    await expect(
      f.reviewer.getByText(
        "This decision cleared only the selected review. The remaining checks below still prevent credit.",
        { exact: true },
      ),
    ).toBeVisible();
    const current = await adminDetail(f.reviewer, x.sale.id);
    expect(current.credited).toBe(false);
    expect(current.holds.find((h) => h.id === sibling)?.state).toBe("open");
    await expect(
      f.reviewer.getByText("Loyalty credit recorded", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});

for (const condition of ["demoted-proposer", "policy-off-transport"] as const) {
  test(`Matrix: ${condition} preserves independent rejection without permitting approval`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
    const f = await releaseFixture(page, browser);
    try {
      const x = await pendingFixture(page, f);
      if (condition === "demoted-proposer")
        await f.db.query(
          "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
          [f.userId],
        );
      else {
        // App-only boundary injection: the real inactive-policy mutation is covered by core SR-06.
        // This does not pretend to activate/deactivate the running server's immutable policy.
        await f.reviewer.route(
          `**/api/admin/sales/${x.sale.id}/release-preparation?kind=date`,
          (route) =>
            route.fulfill({
              status: 409,
              json: {
                error: {
                  code: "release_policy_unconfigured",
                  message: "Fictional inactive preparation",
                  retryable: false,
                },
                serverTime: new Date().toISOString(),
                requestId: v7(),
              },
            }),
        );
      }
      await open(f.reviewer, x.sale.id, "date", x.proposal.id);
      await f.reviewer
        .getByLabel("Two-person release", { exact: true })
        .getByLabel("Decision reason", { exact: true })
        .fill(
          "Independently reject this proposal while its approval prerequisites are unavailable",
        );
      if (condition === "demoted-proposer") {
        await inspectIndependentPhotos(f.reviewer, x.sale.detail.saleCode);
        await f.reviewer
          .getByRole("button", { name: "Approve proposal", exact: true })
          .click();
        await f.reviewer
          .getByRole("button", { name: "Confirm decision", exact: true })
          .click();
        await expect(
          f.reviewer.getByText("This proposal needs a fresh review", {
            exact: true,
          }),
        ).toBeVisible();
      } else {
        await expect(
          f.reviewer
            .getByText(
              /Two-person release isn't switched on for this station\./,
            )
            .first(),
        ).toBeVisible();
        await expect(
          f.reviewer.getByRole("button", {
            name: "Approve proposal",
            exact: true,
          }),
        ).toBeDisabled();
      }
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
      expect((await adminDetail(f.reviewer, x.sale.id)).credited).toBe(false);
    } finally {
      await f.close();
    }
  });
}

test("Matrix: pending hold and proposal use a distinct-sale giveaway union and safe audit/attendant projections", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await releaseFixture(page, browser);
  try {
    const sale = await boundarySale(f, "date"),
      prep = await preparation(page, sale.id, "date");
    const campaign = (
      await f.db.query("SELECT id FROM campaign WHERE station_id=$1", [
        prep.originalContext.stationId,
      ])
    ).rows[0].id;
    const before = (await data(
      page.request,
      `/api/admin/giveaway/${campaign}/readiness`,
    )) as { counts: { holds: string; policyBlocks: string } };
    const sheet = await uploadSheet(page, sale.id, prep),
      body = proposalBody(prep, sheet.assetId);
    const proposal = (await post(
      page.request,
      `/api/admin/sales/${sale.id}/release-proposals`,
      body,
      201,
    )) as Proposal;
    const after = (await data(
      page.request,
      `/api/admin/giveaway/${campaign}/readiness`,
    )) as {
      counts: { holds: string; policyBlocks: string };
      blockers: string[];
    };
    expect(after.counts.holds).toBe(before.counts.holds);
    expect(after.counts.policyBlocks).toBe(before.counts.policyBlocks);
    expect(after.blockers).toContain("reviews_unresolved");
    const audit = (await post(page.request, "/api/admin/audit/search", {
      targetId: sale.id,
      limit: 100,
    })) as { items: { id: string; action: string }[] };
    const event = audit.items.find((e) => e.action === "held_release_proposed");
    expect(event).toBeDefined();
    await page.goto(`/admin/audit/${event!.id}`);
    await expect(
      page.getByRole("heading", { name: "Release proposed", exact: true }),
    ).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).not.toContainText(body.reason);
    await expect(main).not.toContainText(body.facts.entryReference);
    await expect(main).not.toContainText(sheet.assetId);
    const own = (await data(
      f.phone.request,
      `/api/attendant/sales/${sale.id}`,
    )) as Record<string, unknown>;
    for (const field of [
      "pendingRelease",
      "facts",
      "sheetAssetId",
      "proposedBy",
      "releaseProposalId",
    ])
      expect(own).not.toHaveProperty(field);
    expect(JSON.stringify(own)).not.toContain(proposal.id);
    expect(JSON.stringify(own)).not.toContain(body.facts.entryReference);
    await page.goto("/admin/leaderboards/finalize");
    await expect(
      page.getByText("Reviews still need decisions", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Sales with holds or pending hold releases", { exact: true })
        .locator(".."),
    ).toContainText(after.counts.holds);
    await expect(
      page
        .getByText("Sales with policy checks or pending capture releases", {
          exact: true,
        })
        .locator(".."),
    ).toContainText(after.counts.policyBlocks);
  } finally {
    await f.close();
  }
});
