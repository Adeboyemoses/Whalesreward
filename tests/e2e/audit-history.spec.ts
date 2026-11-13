import { test, expect } from "@playwright/test";
import { auditFixture } from "../audit/helpers";
import { api } from "../station/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("I-41 G01 combines filters, pages by cursor, resets on changes and preserves Back", async ({
  page,
}) => {
  const f = await auditFixture(page);
  try {
    await page.goto("/admin/audit");
    await page.getByLabel("Target ID", { exact: true }).fill(f.targetId);
    await page.getByLabel("Search history", { exact: true }).fill(f.marker);
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeEnabled();
    const nextPage = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/audit/search") &&
        !!r.request().postDataJSON().cursor,
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await nextPage;
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toBeEnabled();
    const view = page.getByRole("link", { name: "View", exact: true }).first();
    await expect(view).toHaveAttribute("href", `/admin/audit/${f.ids[4]}`);
    const href = await view.getAttribute("href");
    await view.click();
    await expect(
      page.getByRole("heading", { name: /^Event record/ }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Back to history", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("link", { name: "View", exact: true }).first(),
    ).toHaveAttribute("href", href!);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
    for (const [label, value] of [
      ["Area", "cards"],
      ["Performed by", "admin"],
    ]) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByLabel(label!, { exact: true }).selectOption(value!);
      await expect(
        page.getByRole("button", { name: "Previous", exact: true }),
      ).toBeDisabled();
    }
    await page.getByLabel("From", { exact: true }).fill("2026-11-03");
    await page.getByLabel("To", { exact: true }).fill("2026-11-02");
    await expect(
      page.getByRole("alert").filter({ hasText: /date|from|range|before/i }),
    ).toContainText(/date|from|range|before/i);
    const invalid = await page.request.post("/api/admin/audit/search", {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: { from: "2026-02-30" },
    });
    expect(invalid.status()).toBe(422);
    const boundary = await api<{ items: { id: string }[] }>(
      page.request,
      "audit/search",
      {
        targetId: f.targetId,
        from: "2026-11-02",
        to: "2026-11-02",
        limit: 100,
      },
    );
    expect(boundary.items).toHaveLength(12);
    const outside = await api<{ items: { id: string }[] }>(
      page.request,
      "audit/search",
      { query: f.legacy, from: "2026-11-02", to: "2026-11-02" },
    );
    expect(outside.items).toHaveLength(0);
    const previousDay = await api<{ items: { id: string }[] }>(
      page.request,
      "audit/search",
      { query: f.legacy, from: "2026-11-01", to: "2026-11-01" },
    );
    expect(previousDay.items.map((e) => e.id)).toEqual([f.legacy]);
  } finally {
    await f.db.end();
  }
});

test("I-41 G02–G05 display historical snapshots, exact changes, original seller and related links without phones or mutations", async ({
  page,
}) => {
  const f = await auditFixture(page);
  try {
    await f.db.query("UPDATE auth_user SET display_name=$1 WHERE id=$2", [
      "Renamed later",
      f.userId,
    ]);
    for (const event of [
      f.ids[0]!,
      f.correction,
      f.attendant,
      f.system,
      f.legacy,
    ]) {
      await page.goto(`/admin/audit/${event}`);
      await expect(
        page.getByRole("heading", { name: /^Event record/ }),
      ).toBeVisible();
      const text = await page.locator("main").innerText();
      expect(text).not.toContain("08012345678");
      expect(text).not.toContain("PrivateCanary");
      expect(text).not.toMatch(/[•*]{3,}\s*\d{4}/);
      await expect(
        page.getByRole("button", { name: /^(edit|delete|export)/i }),
      ).toHaveCount(0);
      if (event === f.correction) {
        await expect(
          page.getByText("Owner at event", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("₦10,000.00", { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText("₦12,000.00", { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Related events", exact: true }),
        ).toBeVisible();
        await expect(
          page.locator(`a[href="/admin/audit/${f.ids[0]}"]`),
        ).toBeVisible();
      }
      if ([f.correction, f.system, f.attendant].includes(event))
        await expect(
          page.getByText("Grace Okon", { exact: true }).last(),
        ).toBeVisible();
      if (event === f.system)
        await expect(
          page.getByText("Sync service", { exact: true }).first(),
        ).toBeVisible();
      if (event === f.legacy)
        await expect(
          page
            .getByText("older event, details not available", { exact: true })
            .first(),
        ).toBeVisible();
    }
  } finally {
    await f.db.end();
  }
});

test("I-07 I-09 sales/customers do not grant audit and live revocation denies list and detail", async ({
  page,
}) => {
  const f = await auditFixture(page, ["sales", "customers"]);
  try {
    for (const path of ["/admin/audit", `/admin/audit/${f.system}`]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: /Event record|Recorded events/ }),
      ).toHaveCount(0);
    }
    expect(
      (await page.request.get(`/api/admin/audit/${f.system}`)).status(),
    ).toBe(403);
    await f.db.query(
      "INSERT INTO role_permission(role_id,permission_code) SELECT role_id,'audit' FROM admin WHERE id=$1",
      [f.adminId],
    );
    await page.goto(`/admin/audit/${f.system}`);
    await expect(
      page.getByRole("heading", { name: /^Event record/ }),
    ).toBeVisible();
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE id=$1) AND permission_code='audit'",
      [f.adminId],
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /^Event record/ }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.post("/api/admin/audit/search", {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {},
        })
      ).status(),
    ).toBe(403);
  } finally {
    await f.db.end();
  }
});
