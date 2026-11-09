import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import {
  registrationFixture,
  fillRegistration,
  stationFixture,
  api,
} from "./helpers";
test("I-14 unset phone policy refuses real registration without linking a card", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await page.goto("/attendant/register");
    await fillRegistration(page, f.codes[0]!);
    const refusal = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/attendant/customers",
    );
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    const r = await refusal;
    expect(r.status()).toBe(503);
    expect((await r.json()).error.code).toBe("phone_policy_unconfigured");
    await expect(page.getByText("Card linked", { exact: true })).toHaveCount(0);
    expect(
      (await f.db.query("SELECT state FROM card WHERE code=$1", [f.codes[0]]))
        .rows[0].state,
    ).toBe("unassigned");
  } finally {
    await f.db.end();
  }
});
test("I-20 unset print layout refuses PDF while independent Excel preparation remains available", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    const b = await api<{ id: string; version: number }>(
      page.request,
      "card-batches",
      { operationId: v7(), name: "Fictional policy stock", count: 2 },
      201,
    );
    await page.goto(`/admin/cards/${b.id}`);
    await page
      .getByRole("button", { name: "Review export preparation", exact: true })
      .click();
    const refusal = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/card-batches/${b.id}/exports`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm export preparation", exact: true })
      .click();
    const r = await refusal;
    expect(r.status()).toBe(503);
    expect((await r.json()).error.code).toBe("print_layout_unconfigured");
    await expect(
      page.getByText(
        "The print layout is not configured. PDF preparation is unavailable. Excel register remains available.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Export Excel register", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review export preparation", exact: true })
      .click();
    const excel = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/card-batches/${b.id}/exports`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm export preparation", exact: true })
      .click();
    expect((await excel).status()).toBe(202);
    expect(
      (
        await f.db.query("SELECT status,version FROM card_batch WHERE id=$1", [
          b.id,
        ])
      ).rows,
    ).toEqual([{ status: "generated", version: 1 }]);
  } finally {
    await f.db.end();
  }
});

test("I-20 actual short-lived prepared file expires without changing inventory", async ({
  page,
}) => {
  const { ensureLocalCardBucket } = await import("./storage");
  await ensureLocalCardBucket();
  const f = await stationFixture(page);
  try {
    const b = await api<{ id: string; version: number }>(
      page.request,
      "card-batches",
      { operationId: v7(), name: "Fictional expiry stock", count: 1 },
      201,
    );
    await page.goto(`/admin/cards/${b.id}`);
    await page
      .getByRole("button", { name: "Export Excel register", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review export preparation", exact: true })
      .click();
    const settled = page.waitForResponse(
      async (r) =>
        r.request().method() === "GET" &&
        /\/exports\/[a-f0-9-]+$/.test(new URL(r.url()).pathname) &&
        r.status() === 200 &&
        ["ready", "expired"].includes((await r.json()).data?.state),
    );
    await page
      .getByRole("button", { name: "Confirm export preparation", exact: true })
      .click();
    const data = (await (await settled).json()).data;
    if (data.state === "ready")
      await new Promise((resolve) => setTimeout(resolve, 1100));
    const file = await page.request.get(
      `/api/admin/card-batches/${b.id}/exports/${data.id}/file`,
    );
    expect(file.status()).toBe(410);
    expect((await file.json()).error.code).toBe("export_expired");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Download XLSX", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await f.db.query("SELECT status,version FROM card_batch WHERE id=$1", [
          b.id,
        ])
      ).rows,
    ).toEqual([{ status: "generated", version: 1 }]);
    expect(
      (await f.db.query("SELECT state FROM card WHERE batch_id=$1", [b.id]))
        .rows,
    ).toEqual([{ state: "unassigned" }]);
  } finally {
    await f.db.end();
  }
});
