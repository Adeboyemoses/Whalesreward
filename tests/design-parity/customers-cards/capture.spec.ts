import { decodedPDFCodes } from "../../customers-cards/pdf";
import { historicalSale } from "../../customers-cards/historical";
import { ensureLocalCardBucket } from "../../customers-cards/storage";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  registrationFixture,
  fillRegistration,
  api,
} from "../../customers-cards/helpers";
import { seedId } from "../../station/helpers";
import { v7 } from "uuid";
import { phoneNumber } from "../../customers-cards/helpers";
const out = "tests/design-parity/customers-cards/screenshots";
async function shot(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^(Loading|Opening|Refreshing|Checking)/ }),
  ).toHaveCount(0);
  const metrics = await page.evaluate(() => {
    const boxes = (node: Node | null) => {
      if (!node) return [];
      const r = document.createRange();
      r.selectNodeContents(node);
      return Array.from(r.getClientRects(), (b) => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      }));
    };
    const footer = Array.from(document.querySelectorAll("p")).find(
      (n) =>
        n.textContent ===
        "Counts toward loyalty after the details and photo sync.",
    );
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      loyaltyCards: Array.from(
        document.querySelectorAll(".wr-loyalty-card"),
      ).map((card) => {
        const identity = card.querySelector(
          ".wr-loyalty-foot > div:first-child .wr-sub",
        );
        const station = card.querySelector(".wr-loyalty-foot > .wr-sub");
        const mono = card.querySelector(".wr-loyalty-foot .wr-mono");
        return {
          identity: boxes(identity),
          station: boxes(station),
          monoFont: mono ? getComputedStyle(mono).fontFamily : null,
          wordmark: boxes(
            card.querySelector(".wr-brand-name")?.firstChild ?? null,
          ),
        };
      }),
      wordmark: boxes(
        document.querySelector(".wr-brand-name")?.firstChild ?? null,
      ),
      loyaltyFooter: boxes(footer ?? null),
      shortTargets:
        innerWidth <= 390
          ? Array.from(document.querySelectorAll("button,input,select,a"))
              .filter((n) => {
                const r = n.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && r.height < 48;
              })
              .map((n) => ({
                tag: n.tagName,
                label:
                  n.getAttribute("aria-label") ?? n.textContent?.slice(0, 60),
                height: n.getBoundingClientRect().height,
              }))
          : [],
    };
  });
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/${id}-${width}.metrics.json`,
    JSON.stringify(metrics, null, 2) + "\n",
  );
  await page.screenshot({
    path: `${out}/${id}-${width}.built.png`,
    fullPage: true,
  });
  expect(metrics.document, `${id} overflow`).toBeLessThanOrEqual(width);
  if (id.startsWith("A")) {
    expect(new Set(metrics.wordmark.map((r) => r.y)).size).toBe(1);
    expect(metrics.shortTargets).toEqual([]);
    for (const card of metrics.loyaltyCards) {
      expect(
        new Set(card.identity.map((r) => Math.round(r.y))).size,
        "category and mono customer ID stay together",
      ).toBe(1);
      expect(
        new Set(card.station.map((r) => Math.round(r.y))).size,
        "station endorsement stays together",
      ).toBe(1);
      expect(
        new Set(card.wordmark.map((r) => Math.round(r.y))).size,
        "card wordmark stays one line",
      ).toBe(1);
      expect(card.monoFont).toContain("IBM Plex Mono");
    }

    if (metrics.loyaltyFooter.length)
      expect(new Set(metrics.loyaltyFooter.map((r) => r.y)).size).toBe(1);
  }
}
for (const width of [390, 360])
  test(`A06 A25 A07 and A24 registration boards at ${width}`, async ({
    page,
  }) => {
    const f = await registrationFixture(page);
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/attendant/register");
      await expect(
        page.getByLabel("Customer name", { exact: true }),
      ).toBeVisible();
      const phone = await fillRegistration(page, f.codes[0]!);
      await shot(page, "A06-Register", width);
      await page
        .getByRole("button", { name: "Register and link card", exact: true })
        .click();
      await expect(page).toHaveURL(/\/done$/);
      await shot(page, "A07-RegisterSuccess", width);
      await page
        .getByRole("button", { name: "Register another customer", exact: true })
        .click();
      await fillRegistration(page, f.codes[1]!, phone, "Tunde Adebayo");
      await page
        .getByRole("button", { name: "Register and link card", exact: true })
        .click();
      await expect(
        page
          .getByText("This phone number already has an account.", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Find existing customer", exact: true })
        .click();
      await expect(
        page
          .getByRole("button", {
            name: "Open Amina Bello and record a sale",
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await shot(page, "A25-RegisterDuplicatePhone", width);
      await page.goto("/attendant/sale");
      await page
        .getByLabel("Or enter the card number", { exact: true })
        .fill("Z9Y8X7W");
      await page.getByRole("button", { name: "Find", exact: true }).click();
      await expect(
        page
          .getByText(/A card that is not yet linked must first be registered/)
          .first(),
      ).toBeVisible();
      await shot(page, "A24-SaleCustomerNotFound", width);
    } finally {
      await f.db.end();
    }
  });
for (const width of [1440, 390])
  test(`C01 B05 S08 and seven card boards at ${width}`, async ({ page }) => {
    test.setTimeout(120000);
    await ensureLocalCardBucket();
    const f = await registrationFixture(page);
    try {
      if (
        !(
          await f.db.query("SELECT 1 FROM purchase WHERE customer_id=$1", [
            seedId(26),
          ])
        ).rowCount
      ) {
        await historicalSale(f.db, { amount: "2000000" });
        await historicalSale(f.db, {
          amount: "800000",
          state: "photo_pending",
        });
        await historicalSale(f.db, { amount: "1000000", state: "held" });
      }
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/admin/customers");
      await expect(
        page.getByLabel("Find a customer", { exact: true }),
      ).toBeVisible();
      await shot(page, "C01-Customers", width);
      await page.goto(`/admin/customers/${seedId(26)}`);
      await expect(
        page.getByRole("heading", { name: "Amina Bello", exact: true }),
      ).toBeVisible();
      await shot(page, "B05-CustomerProfile", width);
      await page
        .getByRole("link", { name: "View customer sales", exact: true })
        .or(
          page.getByRole("button", {
            name: "View customer sales",
            exact: true,
          }),
        )
        .click();
      await expect(page).toHaveURL(/\/admin\/sales\?customer=/);
      await shot(page, "S08-CustomerSales", width);
      await api(
        page.request,
        "card-batches",
        { operationId: v7(), name: "November card batch", count: 4 },
        201,
      );
      await page.goto("/admin/cards");
      await expect(
        page.getByRole("heading", { name: "Loyalty cards", exact: true }),
      ).toBeVisible();
      await shot(page, "B06-LoyaltyCards", width);
      await page.goto("/admin/cards/generate");
      await page
        .getByLabel("Batch name", { exact: true })
        .fill("November card stock");
      await page.getByLabel("Number of cards", { exact: true }).fill("4");
      await shot(page, "K01-GenerateCards", width);
      await page
        .getByRole("button", { name: "Review batch", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: /^Confirm new batch/ }),
      ).toBeVisible();
      await shot(page, "K04-GenerateConfirm", width);
      await page
        .getByRole("button", { name: "Generate cards", exact: true })
        .click();
      await page.getByRole("link", { name: "View batch", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/cards\/[a-f0-9-]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      await shot(page, "K02-CardBatch", width);
      await page.goto(`/admin/cards/${id}/mark-printed`);
      await page
        .getByLabel("Reason / print reference", { exact: true })
        .fill("Fictional print run checked at Station 01");
      await shot(page, "K05-MarkPrinted", width);
      await page
        .getByRole("button", { name: "Review status change", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm status change", exact: true })
        .click();
      await page
        .getByRole("link", { name: "View current batch", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/admin/cards/${id}$`));
      await page.goto(`/admin/cards/${id}/activate`);
      await page
        .getByLabel("Reason for activation", { exact: true })
        .fill("Fictional stock checked");
      await page
        .getByRole("button", { name: "Review status change", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm status change", exact: true })
        .click();
      await page
        .getByRole("link", { name: "View current batch", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/admin/cards/${id}$`));
      const inventory = (
        await f.db.query(
          "SELECT code FROM card WHERE batch_id=$1 ORDER BY code",
          [id],
        )
      ).rows;
      for (const [index, name] of ["Amina Bello", "Tunde Adebayo"].entries()) {
        const registered = await page.request.post("/api/attendant/customers", {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {
            operationId: v7(),
            name,
            phone: phoneNumber(),
            category: "car_owner",
            card: { source: "code", code: inventory[index].code },
          },
        });
        expect(registered.status()).toBe(201);
      }
      await f.db.query(
        "UPDATE card SET state='retired',retired_at=clock_timestamp(),retirement_reason='Fictional historical card loss',version=version+1 WHERE batch_id=$1 AND code=$2",
        [id, inventory[1].code],
      );
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Cards in this batch", exact: true })
          .getByText("Retired", { exact: true }),
      ).toBeVisible();
      await shot(page, "K06-CardBatchActive", width);
      await page
        .getByRole("button", { name: "Export PDF print sheet", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Review export preparation", exact: true })
        .click();
      const ready = page.waitForResponse(
        async (r) =>
          r.request().method() === "GET" &&
          /\/exports\/[a-f0-9-]+$/.test(new URL(r.url()).pathname) &&
          r.status() === 200 &&
          (await r.json()).data?.state === "ready",
      );
      await page
        .getByRole("button", {
          name: "Confirm export preparation",
          exact: true,
        })
        .click();
      await ready;
      await expect(
        page.getByRole("button", { name: "Download PDF", exact: true }).first(),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Preview print sheet", exact: true })
        .last()
        .click();
      await expect(page).toHaveURL(/\/print-preview/);
      const previewResponse = page.waitForResponse((r) =>
        /\/exports\/[a-f0-9-]+\/file$/.test(new URL(r.url()).pathname),
      );
      await page
        .getByRole("button", {
          name: "Load protected PDF preview",
          exact: true,
        })
        .click();
      await expect(
        page.getByTitle("Prepared card print sheet PDF", { exact: true }),
      ).toHaveAttribute("src", /^blob:/);
      const pdfResponse = await previewResponse;
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()["content-type"]).toContain(
        "application/pdf",
      );
      const pdf = Buffer.from(
        await page
          .getByTitle("Prepared card print sheet PDF", { exact: true })
          .evaluate(async (frame) =>
            Array.from(
              new Uint8Array(
                await (
                  await fetch((frame as HTMLIFrameElement).src)
                ).arrayBuffer(),
              ),
            ),
          ),
      );
      const codes = (
        await f.db.query(
          "SELECT code FROM card WHERE batch_id=$1 AND state='unassigned' ORDER BY code",
          [id],
        )
      ).rows.map((r) => r.code);
      expect(await decodedPDFCodes(pdf)).toEqual(codes);
      await mkdir("tests/design-parity/customers-cards/artifacts", {
        recursive: true,
      });
      await writeFile(
        `tests/design-parity/customers-cards/artifacts/K03-prepared-${width}.pdf`,
        pdf,
      );
      await writeFile(
        `tests/design-parity/customers-cards/artifacts/K03-QR-${width}.json`,
        JSON.stringify({ count: codes.length, codes }, null, 2) + "\n",
      );
      await shot(page, "K03-CardPrintPreview", width);
      const batch = await api<{ status: string }>(
        page.request,
        `card-batches/${id}`,
      );
      expect(batch.status).toBe("active");
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int n FROM card WHERE batch_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(4);
    } finally {
      await f.db.end();
    }
  });
