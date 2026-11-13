import { test, expect } from "@playwright/test";
import { auditFixture } from "../../audit/helpers";
import { mkdir } from "node:fs/promises";

test.use({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  trace: "off",
});
test("G01–G05 independent audit fidelity at 1440 px", async ({ page }) => {
  const f = await auditFixture(page);
  try {
    const folder = "tests/design-parity/audit";
    await mkdir(folder, { recursive: true });
    await page.goto("/admin/audit");
    await page.getByLabel("Target ID", { exact: true }).fill(f.targetId);
    await expect(
      page.getByRole("link", { name: "View", exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${folder}/G01-AuditHistory.built.png`,
      fullPage: true,
    });
    for (const [board, id] of [
      ["G02-AuditEvent", f.ids[0]],
      ["G03-CorrectionAudit", f.correction],
      ["G04-AttendantAudit", f.attendant],
      ["G05-SystemAudit", f.system],
    ]) {
      await page.goto(`/admin/audit/${id}`);
      await expect(
        page.getByRole("heading", { name: /^Event record/ }),
      ).toBeVisible();
      await page.screenshot({
        path: `${folder}/${board}.built.png`,
        fullPage: true,
      });
    }
  } finally {
    await f.db.end();
  }
});
