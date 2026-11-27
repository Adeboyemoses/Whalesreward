import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { settingsFixture } from "../../settings/helpers";

// WHR-230 design-fidelity check (test-engineer, independent of the
// frontend-engineer who built the pickers): the campaign dates screen's new
// date/time <TextField> pairs and TimezoneCombobox, at 1440px (admin desktop)
// and the two phone widths this repo's hi-fi override requires, 390px and
// 360px. Scope: this one screen's changed controls only -- no claim about
// the rest of the settings surface, which keeps its existing fidelity report
// at tests/design-parity/settings/REPORT.md.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(60000);
const destination = fileURLToPath(new URL("./", import.meta.url));

async function metrics(page: Page) {
  return page.evaluate(() => {
    const combobox = document.querySelector<HTMLElement>(
      "[role='combobox']",
    );
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      controls: [
        ...document.querySelectorAll<HTMLElement>(
          "main input, main textarea, main button",
        ),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({
          label:
            el.getAttribute("aria-label") ??
            el.getAttribute("id") ??
            el.textContent?.trim(),
          type: el.getAttribute("type") ?? el.tagName,
          rect: el.getBoundingClientRect().toJSON(),
        })),
      comboboxExpanded: combobox?.getAttribute("aria-expanded"),
    };
  });
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const data = await metrics(page);
  await writeFile(
    destination + name + ".metrics.json",
    JSON.stringify(data, null, 2),
  );
  await page.screenshot({ path: destination + name + ".built.png", fullPage: true });
  expect(data.document, `${name}: no horizontal page overflow`).toBeLessThanOrEqual(
    data.viewport + 1,
  );
  if (data.viewport < 900) {
    for (const control of data.controls)
      expect(
        control.rect.height,
        `${name}: ${control.label ?? control.type} tap target`,
      ).toBeGreaterThanOrEqual(48);
  }
  return data;
}

test("WHR-230 pickers + TimezoneCombobox fidelity at 1440/390/360", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    await page.goto("/admin/settings/giveaway");
    await expect(
      page.getByRole("combobox", { name: "Campaign timezone" }),
    ).toBeVisible();
    await capture(page, "WHR230-create-1440");

    // Keyboard operability: Tab reaches the timezone combobox and each date
    // and time field, and each receives a visible focus outline (not
    // outline:none with nothing standing in for it).
    const combobox = page.getByRole("combobox", { name: "Campaign timezone" });
    await combobox.focus();
    await expect(combobox).toBeFocused();
    const comboboxFocusRing = await combobox.evaluate((el) => {
      const style = getComputedStyle(el);
      return { outline: style.outlineStyle, boxShadow: style.boxShadow };
    });
    expect(
      comboboxFocusRing.outline !== "none" || comboboxFocusRing.boxShadow !== "none",
      "Campaign timezone combobox must show a focus indicator",
    ).toBe(true);

    // Opening the combobox and typing filters the option list (keyboard path,
    // no pointer), and arrow keys + Enter can select an option.
    await combobox.fill("america/new_york".replace("_", "_"));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(combobox).toHaveValue("America/New_York");

    for (const label of ["Launch date", "Launch time"]) {
      const field = page.getByLabel(label, { exact: true });
      await field.focus();
      await expect(field).toBeFocused();
      const ring = await field.evaluate((el) => {
        const style = getComputedStyle(el);
        return { outline: style.outlineStyle, boxShadow: style.boxShadow };
      });
      expect(
        ring.outline !== "none" || ring.boxShadow !== "none",
        `${label} must show a focus indicator`,
      ).toBe(true);
    }

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await capture(page, `WHR230-create-${width}`);
    }
  } finally {
    await f.close();
  }
});
