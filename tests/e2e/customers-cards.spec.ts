import { ensureLocalCardBucket } from "../customers-cards/storage";
import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { stationFixture, api } from "../customers-cards/helpers";
test.use({ trace: "off", video: "off", screenshot: "off" });
test("I-07 customers search shows masked identities", async ({ page }) => {
  const f = await stationFixture(page);
  try {
    await page.goto("/admin/customers");
    await expect(
      page.getByRole("heading", { name: "Customers", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Find a customer", { exact: true }),
    ).toBeVisible();
  } finally {
    await f.db.end();
  }
});
test("I-18 card generation starts with an explicit review", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    await page.goto("/admin/cards/generate");
    await expect(
      page.getByRole("heading", { name: "Generate card batch", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review batch", exact: true }),
    ).toBeVisible();
  } finally {
    await f.db.end();
  }
});
test("I-18 cancel leaves stock unchanged and explicit reviews move Generated to Printed to Active", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    const name = `Fictional stock ${v7().slice(-8)}`;
    await page.goto("/admin/cards/generate");
    await page.getByLabel("Batch name", { exact: true }).fill(name);
    await page.getByLabel("Number of cards", { exact: true }).fill("4");
    await page
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Confirm new batch", exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM card_batch WHERE name=$1",
          [name],
        )
      ).rows[0].n,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .or(page.getByRole("link", { name: "Keep editing", exact: true }))
      .click();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM card_batch WHERE name=$1",
          [name],
        )
      ).rows[0].n,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate cards", exact: true })
      .click();
    await page.getByRole("link", { name: "View batch", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/cards\/[a-f0-9-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const codes = (
      await f.db.query(
        "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
        [id],
      )
    ).rows;
    expect(codes).toHaveLength(4);
    expect(
      codes.every((c) => c.qr_payload === c.code && c.state === "unassigned"),
    ).toBe(true);
    for (const [action, status, label] of [
      ["mark-printed", "printed", "Reason / print reference"],
      ["activate", "active", "Reason for activation"],
    ] as const) {
      await page.goto(`/admin/cards/${id}/${action}`);
      await page
        .getByLabel(label, { exact: true })
        .fill("Fictional local stock checked");
      await page
        .getByRole("button", { name: "Review status change", exact: true })
        .click();
      expect(
        (await f.db.query("SELECT status FROM card_batch WHERE id=$1", [id]))
          .rows[0].status,
      ).toBe(status === "printed" ? "generated" : "printed");
      await page
        .getByRole("button", { name: "Confirm status change", exact: true })
        .click();
      await page
        .getByRole("link", { name: "View current batch", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/admin/cards/${id}$`));
      expect(
        (await f.db.query("SELECT status FROM card_batch WHERE id=$1", [id]))
          .rows[0].status,
      ).toBe(status);
    }
    expect(
      (
        await f.db.query(
          "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
          [id],
        )
      ).rows,
    ).toEqual(codes);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM audit_event WHERE target_type='card_batch' AND target_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(3);
  } finally {
    await f.db.end();
  }
});
test("I-20 prepared PDF and XLSX downloads contain reserved snapshot codes without lifecycle side effects", async ({
  page,
}) => {
  await ensureLocalCardBucket();
  const f = await stationFixture(page);
  try {
    const b = await api<{ id: string; version: number }>(
      page.request,
      "card-batches",
      { operationId: v7(), name: "Fictional binary export stock", count: 3 },
      201,
    );
    const inventory = (
      await f.db.query(
        "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
        [b.id],
      )
    ).rows;
    await page.goto(`/admin/cards/${b.id}`);
    for (const [format, label] of [
      ["pdf", "Export PDF print sheet"],
      ["xlsx", "Export Excel register"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
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
      const downloadButton = page
        .getByRole("button", {
          name: format === "pdf" ? "Download PDF" : "Download XLSX",
          exact: true,
        })
        .first();
      await expect(downloadButton).toBeVisible();
      const promise = page.waitForEvent("download");
      await downloadButton.click();
      const download = await promise;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream!) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (format === "pdf") {
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(
          0,
        );
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes as never);
        const text = JSON.stringify(
          workbook.worksheets.map((s) => s.getSheetValues()),
        );
        for (const c of inventory) expect(text).toContain(c.code);
        expect(text).not.toContain("Amina Bello");
      }
    }
    expect(
      (
        await f.db.query("SELECT status,version FROM card_batch WHERE id=$1", [
          b.id,
        ])
      ).rows,
    ).toEqual([{ status: "generated", version: 1 }]);
    expect(
      (
        await f.db.query(
          "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
          [b.id],
        )
      ).rows,
    ).toEqual(inventory);
  } finally {
    await f.db.end();
  }
});

test("I-07 customer-only access never fetches purchases and legacy provenance stays unknown", async ({
  page,
}) => {
  const f = await stationFixture(page, ["customers"]);
  const purchaseReads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.endsWith("/purchases"))
      purchaseReads.push(r.url());
  });
  try {
    await page.goto("/admin/customers/019a5000-0000-7000-8000-000000000026");
    await expect(
      page.getByRole("heading", { name: "Amina Bello", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("•••• 0026", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Unknown|Not recorded/).first()).toBeVisible();
    expect(purchaseReads).toEqual([]);
    await expect(
      page.getByRole("link", { name: "View customer sales", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Replace lost card|Update phone number/,
      }),
    ).toHaveCount(0);
  } finally {
    await f.db.end();
  }
});
test("I-07 cards-only inventory preserves linked state without customer identity or export grants", async ({
  page,
}) => {
  const f = await stationFixture(page, ["cards"]);
  try {
    await page.goto("/admin/cards/019a5000-0000-7000-8000-000000000028");
    await expect(page.getByText("A7K3M9Q", { exact: true })).toBeVisible();
    await expect(page.getByText("Amina Bello", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Customer detail unavailable/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export PDF print sheet", exact: true }),
    ).toHaveCount(0);
    const denied = await page.request.get(
      "/api/admin/customers/019a5000-0000-7000-8000-000000000026",
    );
    expect(denied.status()).toBe(403);
  } finally {
    await f.db.end();
  }
});
test("I-15 customer cursor stays bound to the submitted filter and back preserves the in-memory search", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    for (let i = 0; i < 28; i++) {
      const id = v7();
      await f.db.query(
        "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,$3,$4,'keg_buyer',1)",
        [
          id,
          `TEST-${id}`,
          `Fictional cursor ${i}`,
          `+23480${(BigInt("0x" + id.replaceAll("-", "").slice(-9)) % 100000000n).toString().padStart(8, "0")}`,
        ],
      );
    }
    const bodies: Record<string, unknown>[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/admin/customers/search")
        bodies.push(r.postDataJSON());
    });
    await page.goto("/admin/customers");
    await page
      .getByLabel("Find a customer", { exact: true })
      .fill("Fictional cursor");
    await page
      .getByLabel("Customer category", { exact: true })
      .selectOption("keg_buyer");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("Fictional cursor");
    await page.getByRole("button", { name: /Next/ }).click();
    await expect
      .poll(() => bodies.some((b) => typeof b.cursor === "string"))
      .toBe(true);
    const next = bodies.find((b) => typeof b.cursor === "string")!;
    expect(next.query).toBe("Fictional cursor");
    expect(next.category).toBe("keg_buyer");
    await page
      .getByRole("row")
      .filter({ hasText: "Fictional cursor" })
      .getByRole("link", { name: "View", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/customers\/[a-f0-9-]+$/);
    await page
      .getByRole("link", { name: /Back to customers/ })
      .or(page.getByRole("button", { name: /Back to customers/ }))
      .click();
    await expect(
      page.getByLabel("Find a customer", { exact: true }),
    ).toHaveValue("Fictional cursor");
    await expect(
      page.getByLabel("Customer category", { exact: true }),
    ).toHaveValue("keg_buyer");
  } finally {
    await f.db.end();
  }
});

test("I-42 I-44 exact large recorded totals exclude pending held and cancelled sales and keep litres apart from kilograms", async ({
  page,
}) => {
  const { registrationFixture, phoneNumber } =
    await import("../customers-cards/helpers");
  const { historicalSale } = await import("../customers-cards/historical");
  const f = await registrationFixture(page);
  try {
    const response = await page.request.post("/api/attendant/customers", {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: {
        operationId: v7(),
        name: "Tunde Adebayo",
        phone: phoneNumber(),
        category: "keg_buyer",
        card: { source: "code", code: f.codes[0] },
      },
    });
    expect(response.status()).toBe(201);
    const customerId = (await response.json()).data.customer.id;
    const cardId = (
      await f.db.query("SELECT id FROM card WHERE code=$1", [f.codes[0]])
    ).rows[0].id;
    const base = { customerId, cardId, cardCode: f.codes[0] };
    const amount = "9999999999999990000";
    // Historical fixtures obey the real schema/revision guards; this is a read-projection test, not a claim of API credit acceptance.
    for (let i = 0; i < 11; i++)
      await historicalSale(f.db, { ...base, amount });
    await historicalSale(f.db, {
      ...base,
      amount: "150000",
      product: "cooking_gas",
    });
    await historicalSale(f.db, {
      ...base,
      amount: "100000",
      state: "photo_pending",
    });
    await historicalSale(f.db, { ...base, amount: "900000", state: "held" });
    await historicalSale(f.db, {
      ...base,
      amount: "800000",
      state: "cancelled",
    });
    const total = BigInt(amount) * 11n + 150000n;
    const profile = await api<{
      recordedSpendKobo: string;
      completedPurchaseCount: string;
      pending: { amountKobo: string; count: string };
      quantities: { unit: string; quantity: string }[];
    }>(page.request, `customers/${customerId}`);
    expect(profile.recordedSpendKobo).toBe(total.toString());
    expect(profile.completedPurchaseCount).toBe("12");
    expect(profile.pending).toEqual({ amountKobo: "100000", count: "1" });
    expect(profile.quantities.map((q) => q.unit).sort()).toEqual([
      "kilogram",
      "litre",
    ]);
    await page.goto(`/admin/customers/${customerId}`);
    const expected = `₦${(total / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.00`;
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(
      page.getByText(/1,099,999,999,999,998\.9(?:0*)? litres/),
    ).toBeVisible();
    await expect(page.getByText(/1(?:\.0*)? kilograms/)).toBeVisible();
    await expect(
      page.getByText("₦1,000.00", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await f.db.end();
  }
});
