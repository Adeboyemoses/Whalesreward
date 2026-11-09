import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { v7 } from "uuid";
import {
  registrationFixture,
  fillRegistration,
  api,
} from "../../customers-cards/helpers";
import { seedId } from "../../station/helpers";
import { fillSale, save, waitForWorker } from "../../fixtures/offline-browser";

const output = "tests/design-parity/m2-smoke-fixes/screenshots";
const warning = (page: Page) =>
  page
    .locator(".wr-notice")
    .filter({ hasText: /Your pump assignment has changed|New pump assigned:/ });

async function capture(page: Page, id: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^(Loading|Opening|Refreshing|Checking)/ }),
  ).toHaveCount(0);
  const metrics = await page.evaluate(() => {
    const root = document.querySelector(".wr-root");
    const active = document.activeElement;
    const focus = active ? getComputedStyle(active) : null;
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rootWidth: root?.getBoundingClientRect().width,
      bodyFont: root ? getComputedStyle(root).fontFamily : null,
      focus: {
        tag: active?.tagName,
        width: focus?.outlineWidth,
        style: focus?.outlineStyle,
        color: focus?.outlineColor,
      },
      notices: Array.from(document.querySelectorAll(".wr-notice")).map(
        (node) => ({
          text: node.textContent,
          background: getComputedStyle(node).backgroundColor,
          width: node.getBoundingClientRect().width,
        }),
      ),
      shortTargets: Array.from(
        document.querySelectorAll("button,input,select,a"),
      )
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.height < 48;
        })
        .map((node) => ({
          tag: node.tagName,
          text:
            node.getAttribute("aria-label") ?? node.textContent?.slice(0, 60),
          height: node.getBoundingClientRect().height,
        })),
    };
  });
  await mkdir(output, { recursive: true });
  await writeFile(
    `${output}/${id}-390.metrics.json`,
    JSON.stringify(metrics, null, 2) + "\n",
  );
  await page.screenshot({
    path: `${output}/${id}-390.built.png`,
    fullPage: true,
  });
  expect(metrics.documentWidth, `${id} overflow`).toBeLessThanOrEqual(390);
  expect(metrics.shortTargets, `${id} phone targets`).toEqual([]);
  return metrics;
}

test("A24 unknown and invalid card states and A06 candidate prefill at390", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    const field = page.getByLabel("Or enter the card number", { exact: true });
    await field.fill("Z9Z9Z9Z");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Register this customer", exact: true }),
    ).toBeVisible();
    await capture(page, "A24-SaleCustomerNotFound");
    await page
      .getByRole("button", { name: "Register this customer", exact: true })
      .click();
    await expect(page).toHaveURL(/\/attendant\/register$/);
    await expect(page.getByLabel("Card number", { exact: true })).toHaveValue(
      "Z9Z9Z9Z",
    );
    await fillRegistration(page, "Z9Z9Z9Z", "08030000101", "Amina Bello");
    await capture(page, "A06-RegisterPrefilled");
    await page.getByRole("link", { name: "Sale", exact: true }).click();
    await field.fill("I9Z9Z9Z");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(
      page.getByText("Enter the seven-character code printed on the card.", {
        exact: true,
      }),
    ).toBeVisible();
    await field.focus();
    const metrics = await capture(page, "A24-InvalidCardFormat");
    expect(metrics.focus.style).toBe("solid");
    expect(parseFloat(metrics.focus.width ?? "0")).toBeGreaterThanOrEqual(2);
  } finally {
    await f.db.end();
  }
});

test("A17 persistent cross-screen warning and original queue fixture at390", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  // Fictional live camera imagery supplies the visual fixture only. Real phone
  // capture and IndexedDB persistence still create both pending rows.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const draw = () => {
        const drawing = canvas.getContext("2d")!;
        drawing.fillStyle = "white";
        drawing.fillRect(0, 0, 640, 480);
        drawing.fillStyle = "black";
        drawing.font = "36px sans-serif";
        drawing.fillText("Fictional meter 20.000 litres", 10, 120);
      };
      draw();
      const timer = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      stream
        .getVideoTracks()[0]!
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  const f = await registrationFixture(page);
  try {
    // Local transport refusal keeps the real atomic phone records pending;
    // no business-success response or server credit is substituted.
    await page.route("**/api/sync/**", (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: "temporarily_unavailable",
            message: "Fictional local transport unavailable",
            retryable: true,
          },
          serverTime: new Date().toISOString(),
          requestId: v7(),
        },
      }),
    );
    await waitForWorker(page);
    await fillSale(page, { value: "20000.00" });
    await context.setOffline(true);
    await save(page);
    await page
      .getByRole("button", { name: "Record next sale", exact: true })
      .click();
    await fillSale(page, { value: "10000.00" });
    await save(page);
    await context.setOffline(false);
    await api(page.request, `attendants/${f.attendant.id}/assignment`, {
      operationId: v7(),
      expectedVersion: f.attendant.version,
      expectedAssignmentId: f.attendant.assignment!.id,
      pumpId: seedId(16),
      expectedPumpVersion: 1,
      reason: "Fictional local A17 parity fixture",
    });
    await page.goto("/attendant/account");
    await expect(warning(page)).toHaveCount(1);
    await expect(
      page.getByRole("button", {
        name: "Sign out to switch pump",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "A17-PumpChange");
    for (const [route, label, id] of [
      ["/attendant/sale", "Sale", "A17-SaleWarning"],
      ["/attendant/register", "Register", "A17-RegisterWarning"],
      ["/attendant/uploads", "Uploads", "A17-UploadsWarning"],
    ]) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(warning(page)).toHaveCount(1);
      await capture(page, id);
    }
  } finally {
    await context.setOffline(false);
    await f.db.end();
  }
});
