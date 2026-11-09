import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  registrationFixture,
  fillRegistration,
  api,
} from "../../customers-cards/helpers";
import { seedId } from "../../station/helpers";
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
        page.getByText("This phone number already has an account.", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Find existing customer", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Open Amina Bello and record a sale",
          exact: true,
        }),
      ).toBeVisible();
      await shot(page, "A25-RegisterDuplicatePhone", width);
      await page.goto("/attendant/sale");
      await page
        .getByLabel("Or enter the card number", { exact: true })
        .fill("Z9Y8X7W");
      await page.getByRole("button", { name: "Find", exact: true }).click();
      await expect(page.getByText(/Customer not found/).first()).toBeVisible();
      await shot(page, "A24-SaleCustomerNotFound", width);
    } finally {
      await f.db.end();
    }
  });
for (const width of [1440, 390])
  test(`C01 B05 S08 and seven card boards at ${width}`, async ({ page }) => {
    test.setTimeout(120000);
    const f = await registrationFixture(page);
    try {
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
      await page.goto("/admin/cards");
      await expect(
        page.getByRole("heading", { name: "Loyalty cards", exact: true }),
      ).toBeVisible();
      await shot(page, "B06-LoyaltyCards", width);
      await page.goto("/admin/cards/generate");
      await page
        .getByLabel("Batch name", { exact: true })
        .fill("November card stock");
      await page.getByLabel("Number of cards", { exact: true }).fill("12");
      await shot(page, "K01-GenerateCards", width);
      await page
        .getByRole("button", { name: "Review batch", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Confirm new batch", exact: true }),
      ).toBeVisible();
      await shot(page, "K04-GenerateConfirm", width);
      await page
        .getByRole("button", { name: "Generate cards", exact: true })
        .click();
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
      await expect(page).toHaveURL(new RegExp(`/admin/cards/${id}$`));
      await shot(page, "K06-CardBatchActive", width);
      await page
        .getByRole("button", { name: "Export PDF print sheet", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Review export preparation", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Confirm export preparation",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", { name: "Download PDF", exact: true }).first(),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Preview print sheet", exact: true })
        .last()
        .click();
      await expect(page).toHaveURL(/\/print-preview/);
      await page
        .getByRole("button", {
          name: "Load protected PDF preview",
          exact: true,
        })
        .click();
      await expect(
        page.getByTitle("Prepared card print sheet PDF", { exact: true }),
      ).toHaveAttribute("src", /^blob:/);
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
      ).toBe(12);
    } finally {
      await f.db.end();
    }
  });
