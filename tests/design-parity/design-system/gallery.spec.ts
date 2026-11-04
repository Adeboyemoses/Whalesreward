import { expect, test, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const components = [
  "AppHeader",
  "BottomNav",
  "Button",
  "TextField",
  "SegmentedControl",
  "StatusPill",
  "Notice",
  "KeyValueList",
  "ListRow",
  "PhotoCapture",
  "ResultBlock",
  "LoyaltyCard",
  "Sidebar",
  "DataTable",
  "KPI",
  "Attention",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/gallery");
  await expect(
    page.getByRole("heading", { name: "Design system gallery", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
});

test("all documented components are available as clearly labelled development fixtures", async ({
  page,
}) => {
  await expect(
    page.getByText(
      "Development fixtures only. No accounts, purchases, uploads or loyalty credit are created.",
    ),
  ).toBeVisible();
  for (const name of components) {
    await expect(page.locator(`[data-component="${name}"]`)).toHaveCount(1);
  }
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(
    page.locator("a a, a button, button a, button button"),
  ).toHaveCount(0);
});

test("fields expose labels and actionable errors while disabled actions cannot submit", async ({
  page,
}) => {
  const fields = page.locator('[data-component="TextField"]');
  const amount = fields.getByRole("textbox", { name: /^Amount/ });
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  const errorId = await amount.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).toContainText(
    "Enter an amount with at most two decimals.",
  );
  const password = fields.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await fields.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await fields.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  const buttons = page.locator('[data-component="Button"]');
  await expect(
    buttons.getByRole("button", { name: "Save sale", exact: true }).last(),
  ).toBeDisabled();
  await expect(
    buttons.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  const find = buttons.getByRole("button", { name: "Find", exact: true });
  await find.focus();
  await page.keyboard.press("Tab");
  await expect(
    buttons.getByRole("button", { name: "Back", exact: true }),
  ).toBeFocused();
  expect(
    await buttons
      .getByRole("button", { name: "Back", exact: true })
      .evaluate((el) => getComputedStyle(el).outlineWidth),
  ).toBe("2px");
});

test("entry basis preserves button semantics and clears the typed value on a unit change", async ({
  page,
}) => {
  const section = page.locator('[data-component="SegmentedControl"]');
  const entry = section.getByRole("group", {
    name: "Entry basis",
    exact: true,
  });
  await expect(
    entry.getByRole("button", { name: "Amount (₦)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await section.getByLabel("Entered amount", { exact: true }).fill("20000.00");
  await entry.getByRole("button", { name: "Litres", exact: true }).click();
  await expect(
    entry.getByRole("button", { name: "Litres", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    entry.getByRole("button", { name: "Amount (₦)" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    section.getByLabel("Entered litres", { exact: true }),
  ).toHaveValue("");
  await expect(
    section.getByLabel("Gas bought into", { exact: true }),
  ).toHaveAttribute("readonly", "");
});

test("status words remain readable and navigation exposes the active destination and count", async ({
  page,
}) => {
  const status = page.locator('[data-component="StatusPill"]');
  for (const word of [
    "Synced",
    "Saved on phone",
    "Awaiting price review",
    "Photo upload failed",
    "Offline",
    "Online",
  ]) {
    await expect(status.getByText(word, { exact: true }).first()).toBeVisible();
  }
  const header = page.locator('[data-component="AppHeader"]');
  await header
    .getByRole("button", { name: "Toggle connection preview" })
    .click();
  await expect(header.locator(".wr-offline").first()).toContainText("Offline");
  const nav = page.locator('[data-component="BottomNav"]');
  await expect(nav.locator('a[aria-current="page"]')).toHaveCount(2);
  await expect(nav.getByLabel("2 pending uploads")).toHaveCount(1);
  await nav.getByRole("button", { name: "Uploads", exact: true }).click();
  await expect(nav.locator('a[aria-current="page"]').first()).toContainText(
    "Uploads",
  );
});

test("fonts are self-hosted and the naira amount uses the declared numeric font", async ({
  page,
}) => {
  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((item) => item.name)
      .filter((name) => /\.woff2(?:\?|$)/.test(name)),
  );
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(
    fontRequests.every(
      (url) => new URL(url).origin === "http://127.0.0.1:3101",
    ),
  ).toBe(true);
  const amount = page.locator('[data-component="KeyValueList"] .wr-total dd');
  await expect(amount).toHaveText("₦20,000.00");
  expect(
    await amount.evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("IBM Plex Sans");
  for (const family of ["Manrope", "IBM Plex Sans", "IBM Plex Mono"]) {
    expect(
      await page.evaluate(
        (font) => document.fonts.check(`16px "${font}"`),
        family,
      ),
    ).toBe(true);
  }
});

test("quantity metadata in amount table cells remains regular weight", async ({
  page,
}) => {
  const metadata = page
    .locator('[data-component="DataTable"] .wr-amount .wr-sub')
    .first();
  await expect(metadata).toHaveText("20 litres · PMS");
  expect(await metadata.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(
    "400",
  );
  expect(
    await metadata.evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("IBM Plex Sans");
});

test("Tailwind utilities use shared tokens and do not expose a default colour palette", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const utility = document.createElement("div");
    utility.className =
      "bg-whale-600 text-ink-900 p-4 rounded-card shadow-card font-body";
    const direct = document.createElement("div");
    Object.assign(direct.style, {
      backgroundColor: "var(--whale-600)",
      color: "var(--ink-900)",
      padding: "var(--space-4)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-sm)",
      fontFamily: "var(--font-sans)",
    });
    const defaultPalette = document.createElement("div");
    defaultPalette.className = "bg-red-500";
    document.body.append(utility, direct, defaultPalette);
    const properties = [
      "backgroundColor",
      "color",
      "paddingTop",
      "borderRadius",
      "boxShadow",
      "fontFamily",
    ] as const;
    const a = getComputedStyle(utility);
    const b = getComputedStyle(direct);
    const actual = properties.map((key) => a[key]);
    const expected = properties.map((key) => b[key]);
    const defaultBackground = getComputedStyle(defaultPalette).backgroundColor;
    utility.remove();
    direct.remove();
    defaultPalette.remove();
    return { actual, expected, defaultBackground };
  });
  // Tailwind composes the same token shadow after transparent ring/inset layers.
  const shadowIndex = 4;
  expect(result.actual[shadowIndex]).toContain(result.expected[shadowIndex]);
  expect(result.actual.filter((_, index) => index !== shadowIndex)).toEqual(
    result.expected.filter((_, index) => index !== shadowIndex),
  );
  expect(result.defaultBackground).toBe("rgba(0, 0, 0, 0)");
});

test("phone shell fits 360px and admin shell stacks below 900px without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const phone = page.locator('[data-component="AttendantShell"]');
  const photo = phone.getByRole("button", { name: /Take meter photo/ });
  expect((await photo.boundingBox())?.width).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 800, height: 900 });
  const admin = page.locator('[data-component="AdminShell"] .wr-admin');
  expect(await admin.evaluate((el) => getComputedStyle(el).flexDirection)).toBe(
    "column",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("compact controls and admin navigation keep phone touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const small = page
    .locator('[data-component="Button"]')
    .getByRole("button", { name: "Small admin variant" });
  const link = page
    .locator('[data-component="Button"]')
    .getByRole("button", { name: "Cancel edit" });
  const sidebarLink = page
    .locator('[data-component="Sidebar"] .wr-navlist a')
    .first();
  const tableLinks = await page.locator(".wr-table a.wr-btn-link").all();
  for (const link of tableLinks)
    expect((await link.boundingBox())?.width).toBeGreaterThanOrEqual(48);
  for (const control of [small, link, sidebarLink, ...tableLinks]) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  }
});

test("capture all component and surface examples for independent source comparison", async ({
  page,
}) => {
  const output = path.join(import.meta.dirname, "screenshots");
  // Hide Next’s development badge only in captures; it is tooling, not app UI.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await mkdir(output, { recursive: true });
  for (const name of components) {
    const desktop = ["Sidebar", "DataTable", "KPI", "Attention"].includes(name);
    await page.setViewportSize({ width: desktop ? 1472 : 422, height: 900 });
    await page
      .locator(`[data-component="${name}"] [data-preview]`)
      .screenshot({ path: path.join(output, `${name}.built.png`) });
  }
  for (const [name, width] of [
    ["AttendantShell", 360],
    ["AdminShell", 1440],
    ["AdminShell", 800],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator(`[data-component="${name}"]`)
      .screenshot({ path: path.join(output, `${name}-${width}.built.png`) });
  }
});

// Measure the actual glyph ranges, not white-space declarations or the wider capture frame.
async function renderedText(locator: Locator, text: string) {
  return locator.evaluate((element, phrase) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const content = nodes.map((node) => node.data).join("");
    const start = content.indexOf(phrase);
    if (start < 0) throw new Error(`Missing expected text: ${phrase}`);
    let offset = 0;
    const range = document.createRange();
    let parent: Element | null = null;
    for (const node of nodes) {
      if (start >= offset && start < offset + node.length) {
        range.setStart(node, start - offset);
        parent = node.parentElement;
      }
      const end = start + phrase.length;
      if (end > offset && end <= offset + node.length) {
        range.setEnd(node, end - offset);
        break;
      }
      offset += node.length;
    }
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const box = range.getBoundingClientRect();
    const style = getComputedStyle(parent ?? element);
    return {
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
    };
  }, text);
}

for (const width of [390, 360]) {
  test(`wordmark stays one line with visible connection at actual ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const component of ["AppHeader", "AttendantShell"]) {
      const header = page.locator(`[data-component="${component}"] .wr-header`);
      const wordmark = await renderedText(
        header.locator(".wr-brand"),
        "Whales Rewards",
      );
      expect(wordmark.lines, `${component} wordmark must never wrap`).toBe(1);
      expect(wordmark.fontFamily).toContain("Manrope");
      expect(wordmark.fontWeight).toBe("800");
      const pill = header.locator(".wr-pill").first();
      await expect(pill).toBeVisible();
      await expect(pill).toHaveText("Online");
      const pillBox = await pill.boundingBox();
      expect(wordmark.left).toBeGreaterThanOrEqual(0);
      expect(wordmark.right).toBeLessThanOrEqual(pillBox!.x);
      expect(pillBox!.x + pillBox!.width).toBeLessThanOrEqual(width);
    }
    const example = page.locator('[data-component="AppHeader"]');
    await example
      .getByRole("button", { name: "Toggle connection preview" })
      .click();
    const offline = await example
      .locator(".wr-header .wr-offline")
      .boundingBox();
    expect(offline).not.toBeNull();
    expect(offline!.x + offline!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`loyalty footer stacks intact mono identity and station lines at actual ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const card = page.locator(
      '[data-component="LoyaltyCard"] .wr-loyalty-card',
    );
    const name = await renderedText(card, "Amina Bello");
    const identity = await renderedText(card, "Car owner · CUST001");
    const station = await renderedText(card, "Whales Energy · Station 01");
    const id = await renderedText(card, "CUST001");
    expect(identity.lines, "category and customer ID must stay together").toBe(
      1,
    );
    expect(station.lines, "station endorsement must stay together").toBe(1);
    expect(identity.top).toBeGreaterThanOrEqual(name.bottom - 1);
    expect(station.top).toBeGreaterThanOrEqual(identity.bottom - 1);
    expect(id.fontFamily).toContain("IBM Plex Mono");
    const box = await card.boundingBox();
    for (const line of [name, identity, station]) {
      expect(line.left).toBeGreaterThanOrEqual(box!.x);
      expect(line.right).toBeLessThanOrEqual(box!.x + box!.width);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
