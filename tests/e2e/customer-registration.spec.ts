import { test, expect } from "@playwright/test";
import {
  registrationFixture,
  fillRegistration,
  noPII,
} from "../customers-cards/helpers";
test.use({ trace: "off", video: "off", screenshot: "off" });
test("I-02 I-14 online registration links once and requires fresh card lookup before sale", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await page.goto("/attendant/register");
    await expect(
      page.getByRole("heading", { name: "Register customer", exact: true }),
    ).toBeVisible();
    const phone = await fillRegistration(page, f.codes[0]!);
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    await expect(page).toHaveURL(/\/attendant\/register\/[a-f0-9-]+\/done$/);
    await expect(page.getByText("Card linked", { exact: true })).toBeVisible();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM customer WHERE phone_normalized=$1",
          ["+234" + phone.slice(1)],
        )
      ).rows[0].n,
    ).toBe(1);
    await noPII(page, [phone, "+234" + phone.slice(1)]);
    const lookup = page.waitForResponse((r) =>
      r.url().endsWith("/api/attendant/cards/lookup"),
    );
    await page
      .getByRole("button", { name: "Record a sale for Amina", exact: true })
      .click();
    expect((await lookup).status()).toBe(200);
    await expect(page).toHaveURL(/\/attendant\/sale$/);
  } finally {
    await f.db.end();
  }
});

test("I-15 normalized duplicate phone uses a separate exact lookup and does not consume the candidate card", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    const phone = (await import("../customers-cards/helpers")).phoneNumber();
    const response = await page.request.post("/api/attendant/customers", {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: {
        operationId: (await import("uuid")).v7(),
        name: "Amina Bello",
        phone,
        category: "car_owner",
        card: { source: "code", code: f.codes[0]! },
      },
    });
    expect(response.status()).toBe(201);
    await page.goto("/attendant/register");
    await fillRegistration(
      page,
      f.codes[1]!,
      "+234" + phone.slice(1),
      "Tunde Adebayo",
    );
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    await expect(
      page.getByText("This phone number already has an account.", {
        exact: true,
      }),
    ).toBeVisible();
    const lookup = page.waitForResponse((r) =>
      r.url().endsWith("/api/attendant/customers/lookup"),
    );
    await page
      .getByRole("button", { name: "Find existing customer", exact: true })
      .click();
    expect((await lookup).status()).toBe(200);
    await expect(
      page.getByRole("button", {
        name: "Open Amina Bello and record a sale",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await f.db.query("SELECT state FROM card WHERE code=$1", [f.codes[1]!]))
        .rows[0].state,
    ).toBe("unassigned");
    await noPII(page, [phone, "+234" + phone.slice(1)]);
  } finally {
    await f.db.end();
  }
});
test("I-14 uncertain registration retries the original operation and creates one customer", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await page.goto("/attendant/register");
    const phone = await fillRegistration(page, f.codes[0]!);
    const bodies: unknown[] = [];
    await page.route("**/api/attendant/customers", async (route) => {
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(bodies.length === 1 ? 201 : 200);
      if (bodies.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    await page.getByRole("button", { name: /Retry/ }).click();
    await expect(page).toHaveURL(/\/attendant\/register\/[a-f0-9-]+\/done$/);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM customer WHERE phone_normalized=$1",
          ["+234" + phone.slice(1)],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.reload();
    await expect(page.getByText("Card linked", { exact: true })).toHaveCount(0);
    await noPII(page, [phone, "+234" + phone.slice(1)]);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.db.end();
  }
});
test("I-02 registration requires connectivity and does not renew the capture window", async ({
  page,
  context,
}) => {
  const f = await registrationFixture(page);
  try {
    const before = (
      await f.db.query(
        "SELECT last_online_sign_in_at FROM auth_session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [f.attendant.accountId],
      )
    ).rows;
    await page.goto("/attendant/register");
    await fillRegistration(page, f.codes[0]!);
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Connect to register", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
    const after = (
      await f.db.query(
        "SELECT last_online_sign_in_at FROM auth_session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [f.attendant.accountId],
      )
    ).rows;
    expect(after).toEqual(before);
  } finally {
    await context.setOffline(false);
    await f.db.end();
  }
});
