import { expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

/** Independent real-browser capture. All content comes from the disposable
 * fictional schema; the app is neither mocked nor supplied board sample data. */
export async function captureChecklist(page: Page, state: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const measured = await page.evaluate(() => ({
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scale: devicePixelRatio,
    },
    pageWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    controls: [
      ...document.querySelectorAll<HTMLElement>(
        "main button, main select, main textarea, main a.wr-btn, main .wr-checklist-choice",
      ),
    ]
      .map((e) => ({
        label: e.getAttribute("aria-label") ?? e.textContent?.trim() ?? "",
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      }))
      .filter((r) => r.width > 0 && r.height > 0),
  }));
  expect(
    measured.pageWidth,
    `${state} must not overflow the page`,
  ).toBeLessThanOrEqual(measured.viewport.width);
  if (measured.viewport.width <= 390)
    expect(
      measured.controls.filter((r) => r.height < 44),
      `${state} phone targets must meet the absolute44pxfloor`,
    ).toEqual([]);
  const dir = process.env.WHR_CHECKLIST_CAPTURE;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: `${dir}/${state}-${measured.viewport.width}.built.png`,
      fullPage: true,
    });
    await writeFile(
      `${dir}/${state}-${measured.viewport.width}.json`,
      JSON.stringify(measured, null, 2) + "\n",
    );
  }
}
