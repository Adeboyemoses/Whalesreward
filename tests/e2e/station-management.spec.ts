import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import {
  stationFixture,
  createAttendant,
  seedId,
  api,
  type Attendant,
} from "../station/helpers";
import { installAssignmentEndFake } from "../station/assignment-end-fake";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("I-04 station pump creation derives its product and cancellation creates nothing", async ({
  page,
}) => {
  const f = await stationFixture(page);
  const name = `Fictional pump ${v7()}`;
  try {
    await page.goto("/admin/pumps/new");
    await expect(
      page.getByRole("heading", { name: "Add pump", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Pump name", { exact: true }).fill(name);
    await page.getByLabel("Product", { exact: true }).selectOption("pms");
    await page
      .getByRole("link", { name: "Cancel", exact: true })
      .or(page.getByRole("button", { name: "Cancel", exact: true }))
      .click();
    expect(
      (
        await f.db.query("SELECT count(*)::int AS n FROM pump WHERE name=$1", [
          name,
        ])
      ).rows[0].n,
    ).toBe(0);
    await page.goto("/admin/pumps/new");
    await page.getByLabel("Pump name", { exact: true }).fill(name);
    await page.getByLabel("Product", { exact: true }).selectOption("pms");
    await page.getByRole("button", { name: "Add pump", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/pumps\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", { name: "Pump details", exact: true }),
    ).toBeVisible();
    const result = (
      await f.db.query(
        "SELECT p.name,p.product_id FROM pump p WHERE p.name=$1",
        [name],
      )
    ).rows;
    expect(result).toEqual([{ name, product_id: seedId(9) }]);
    await expect(
      page.getByRole("button", { name: /deactivate|remove pump|disable/i }),
    ).toHaveCount(0);
  } finally {
    await f.db.end();
  }
});

test("I-32 reviewed price activation uses exact kobo and preserves prior versions", async ({
  page,
}, info) => {
  const f = await stationFixture(page);
  const code = info.project.name === "attendant" ? "diesel" : "pms";
  const product = code === "pms" ? seedId(9) : seedId(10);
  try {
    const previous = (
      await f.db.query(
        "SELECT id,rate_kobo::text,quantity_precision,version FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT1".replace(
          "LIMIT1",
          "LIMIT 1",
        ),
        [product],
      )
    ).rows[0];
    await page.goto(`/admin/prices/${code}/edit`);
    await expect(
      page.getByRole("heading", { name: /price$/i }).first(),
    ).toBeVisible();
    const rate = page.getByLabel(/New price/);
    await rate.fill("1.001");
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Fictional exact-rate check");
    await page
      .getByRole("button", { name: "Review price change", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm new price", exact: true }),
    ).toHaveCount(0);
    await rate.fill("90071992547409.91");
    await page
      .getByLabel("Quantity decimal places", { exact: true })
      .selectOption("3");
    await page
      .getByRole("button", { name: "Review price change", exact: true })
      .click();
    await expect(
      page.getByText("₦90,071,992,547,409.91", { exact: false }).first(),
    ).toBeVisible();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM product_price_version WHERE product_id=$1",
          [product],
        )
      ).rows[0].n,
    ).toBe(Number(previous.version));
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(rate).toHaveValue("90071992547409.91");
    await page
      .getByRole("button", { name: "Review price change", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm new price", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/prices(?:\?.*)?$/);
    const after = (
      await f.db.query(
        "SELECT rate_kobo::text,quantity_precision,version FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
        [product],
      )
    ).rows[0];
    expect(after).toEqual({
      rate_kobo: "9007199254740991",
      quantity_precision: 3,
      version: previous.version + 1,
    });
    expect(
      (
        await f.db.query(
          "SELECT rate_kobo::text,quantity_precision FROM product_price_version WHERE id=$1",
          [previous.id],
        )
      ).rows[0],
    ).toEqual({
      rate_kobo: previous.rate_kobo,
      quantity_precision: previous.quantity_precision,
    });
  } finally {
    await f.db.end();
  }
});

test("I-01 attendant creation never defaults or redisplays its temporary password", async ({
  page,
}) => {
  const f = await stationFixture(page);
  const username = `favour.${v7().slice(-12)}`;
  const password = "Fictional-creation-2026";
  try {
    await page.goto("/admin/attendants/new");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await page.getByLabel("Full name", { exact: true }).fill("Favour James");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByLabel("Assign pump", { exact: true })
      .selectOption(seedId(14));
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/attendants\/[0-9a-f-]+$/);
    await expect(page.getByText(password, { exact: true })).toHaveCount(0);
    const user = (
      await f.db.query(
        "SELECT a.id,u.must_change_password FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE u.username_normalized=$1",
        [username],
      )
    ).rows[0];
    expect(user.must_change_password).toBe(true);
    const stored = await page.evaluate(() =>
      JSON.stringify([localStorage, sessionStorage]),
    );
    expect(stored).not.toContain(password);
    await expect(
      page.getByRole("button", { name: /Reset password|Disable account/i }),
    ).toHaveCount(0);
  } finally {
    await f.db.end();
  }
});

test("I-05 reviewed reassignment keeps the personal identity and closes the original interval", async ({
  page,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  try {
    await page.goto(`/admin/attendants/${child.attendant.id}/assign`);
    await page
      .getByLabel(/New pump|Assign pump|Pump/, { exact: false })
      .last()
      .selectOption(seedId(16));
    await page
      .getByLabel("Reason for assignment", { exact: true })
      .fill("Fictional pump maintenance");
    await page
      .getByRole("button", { name: "Review assignment", exact: true })
      .click();
    await expect(
      page.getByText("Fictional pump maintenance", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm assignment", exact: true })
      .click();
    await expect(
      page.getByText("Fresh online sign-in required", { exact: false }).first(),
    ).toBeVisible();
    const current = await api<Attendant>(
      page.request,
      `attendants/${child.attendant.id}`,
    );
    expect(current.id).toBe(child.attendant.id);
    expect(current.assignment?.pump.id).toBe(seedId(16));
    expect(
      (
        await f.db.query(
          "SELECT effective_until IS NOT NULL AS closed,reason FROM assignment WHERE id=$1",
          [child.attendant.assignment!.id],
        )
      ).rows[0],
    ).toEqual({
      closed: true,
      reason: "Initial assignment at account creation",
    });
  } finally {
    await f.db.end();
  }
});

for (const loseResponse of [false, true])
  test(`I-09 P-21 client contract fake ${loseResponse ? "uncertain replay" : "confirmation"} ends only the exact reviewed assignment`, async ({
    page,
  }) => {
    const f = await stationFixture(page);
    const child = await createAttendant(page);
    const fake = await installAssignmentEndFake(
      page,
      child.attendant,
      { id: f.adminId, code: `TEST-${f.adminId}`, name: "Ada Williams" },
      { loseFirstResponse: loseResponse },
    );
    try {
      await page.goto(`/admin/attendants/${child.attendant.id}`);
      await page
        .getByRole("link", { name: "End assignment", exact: true })
        .or(page.getByRole("button", { name: "End assignment", exact: true }))
        .click();
      await page.getByLabel(/Reason/).fill("Fictional leaver offboarding");
      await page
        .getByRole("button", { name: "Review end assignment", exact: true })
        .click();
      expect(fake.calls).toHaveLength(0);
      await page
        .getByRole("button", { name: "Confirm end assignment", exact: true })
        .click();
      if (loseResponse) {
        await expect(
          page.getByRole("alert").filter({ hasText: /uncertain|connection/i }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: /retry.*confirm|confirm end assignment/i,
          })
          .first()
          .click();
      }
      await expect(
        page.getByText("Assignment ended", { exact: false }).first(),
      ).toBeVisible();
      expect(fake.effectCount).toBe(1);
      expect(fake.calls.length).toBe(loseResponse ? 2 : 1);
      expect(fake.calls[0]).toMatchObject({
        expectedVersion: child.attendant.version,
        expectedAssignmentId: child.attendant.assignment!.id,
        reason: "Fictional leaver offboarding",
      });
      if (loseResponse) expect(fake.calls[1]).toEqual(fake.calls[0]);
      // Fake provenance is explicit: the real database was never offboarded here.
      expect(
        (
          await f.db.query(
            "SELECT effective_until FROM assignment WHERE id=$1",
            [child.attendant.assignment!.id],
          )
        ).rows[0].effective_until,
      ).toBeNull();
    } finally {
      await f.db.end();
    }
  });

test("I-07 prices-only pump configuration never reads attendant identities", async ({
  page,
}) => {
  const f = await stationFixture(page, ["prices"]);
  const forbidden: string[] = [];
  page.on("request", (r) => {
    if (
      /\/api\/admin\/(?:attendants|assignment-candidates)|\/pumps\/[^/]+\/(?:attendants|assignments)/.test(
        r.url(),
      )
    )
      forbidden.push(new URL(r.url()).pathname);
  });
  try {
    await page.goto("/admin/pumps");
    await expect(
      page.getByRole("heading", { name: "Station pumps", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Grace Okon", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Add pump", exact: true }),
    ).toHaveCount(0);
    expect(forbidden).toEqual([]);
  } finally {
    await f.db.end();
  }
});

test("I-07 pumps-only assignment uses narrow candidates without broad account reads", async ({
  page,
}) => {
  const owner = await stationFixture(page);
  const child = await createAttendant(page);
  await owner.db.end();
  await page.context().clearCookies();
  const f = await stationFixture(page, ["pumps"]);
  const forbidden: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (
      path === "/api/admin/attendants/search" ||
      /^\/api\/admin\/attendants\/[^/]+$/.test(path)
    )
      forbidden.push(path);
  });
  try {
    await page.goto(`/admin/pumps/${seedId(16)}/assign`);
    await page
      .getByLabel("Attendant account", { exact: true })
      .selectOption(child.attendant.id);
    await page
      .getByLabel("Reason for assignment", { exact: true })
      .fill("Fictional pumps-only reassignment");
    await page
      .getByRole("button", { name: "Review assignment", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm assignment", exact: true })
      .click();
    await expect(
      page.getByText("Fresh online sign-in required", { exact: false }).first(),
    ).toBeVisible();
    expect(forbidden).toEqual([]);
    const rows = (
      await f.db.query(
        "SELECT pump_id FROM assignment WHERE attendant_id=$1 AND effective_until IS NULL",
        [child.attendant.id],
      )
    ).rows;
    expect(rows).toEqual([{ pump_id: seedId(16) }]);
  } finally {
    await f.db.end();
  }
});

test("I-07 every selectable pump remains available beyond the first server page", async ({
  page,
}) => {
  const f = await stationFixture(page);
  const target = v7();
  try {
    const fixtures = Array.from({ length: 106 }, (_, index) => ({
      id: index === 0 ? target : v7(),
      name: `Fictional picker pump ${index} ${target}`,
      code: `PICK-${index}-${target}`,
    }));
    await f.db.query(
      "INSERT INTO pump(id,station_id,code,name,product_id,enabled,version,created_at) SELECT x.id::uuid,$1::uuid,x.code,x.name,$2::uuid,true,1,CASE WHEN x.id=$3 THEN '2020-01-01'::timestamptz ELSE clock_timestamp() END FROM jsonb_to_recordset($4::jsonb) AS x(id text,name text,code text)",
      [seedId(8), seedId(9), target, JSON.stringify(fixtures)],
    );
    await page.goto("/admin/attendants/new");
    const picker = page.getByLabel("Assign pump", { exact: true });
    await expect(picker.locator(`option[value="${target}"]`)).toHaveCount(1);
    await picker.selectOption(target);
    await expect(picker).toHaveValue(target);
  } finally {
    await f.db.end();
  }
});
