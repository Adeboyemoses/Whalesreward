import { test, expect } from "@playwright/test";
import { setup, edit } from "./helpers";
test.use({ trace: "off", video: "off", screenshot: "off" });
for (const pending of ["verification-send", "verification-followup"] as const)
  test(`I-07 late ${pending} completion cannot rewrite a departed route`, async ({
    page,
  }) => {
    const f = await setup(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started!: () => void;
    const held = new Promise<void>((r) => {
      started = r;
    });
    let delivered!: () => void;
    const delivery = new Promise<void>((r) => {
      delivered = r;
    });
    try {
      await edit(page, `/admin/users/${f.target.adminId}`, "user");
      await page.route(
        `**/api/admin/users/${f.target.adminId}**`,
        async (route) => {
          const request = route.request();
          const match =
            pending === "verification-send"
              ? request.url().endsWith("verification-requests")
              : request.method() === "GET" &&
                request.url().endsWith(f.target.adminId);
          if (!match) return route.continue();
          const response = await route.fetch();
          expect(response.status()).toBe(
            pending === "verification-send" ? 202 : 200,
          );
          started();
          await gate;
          await route.fulfill({ response });
          delivered();
        },
      );
      await page
        .getByRole("button", { name: "Send verification link", exact: true })
        .click();
      await held;
      await page
        .getByRole("link", { name: "Roles & permissions", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/admin\/roles$/);
      await expect(
        page.getByRole("heading", { name: "Roles & permissions", exact: true }),
      ).toBeVisible();
      release();
      await delivery;
      // Rendering barrier after the delivered network response; no timer-based sleep.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page).toHaveURL(/\/admin\/roles$/);
      await expect(
        page.getByRole("heading", { name: "Roles & permissions", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: /Verification (link queued|delivery)|Manage admin user|Review access change/,
        }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => "__mutationDocument" in window)).toBe(
        true,
      );
    } finally {
      release();
      await f.close();
    }
  });

test("I-12 a queued verification acknowledgement survives navigation but is not fabricated on reload", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await edit(page, `/admin/users/${f.target.adminId}`, "user");
    await page
      .getByRole("button", { name: "Send verification link", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/users/${f.target.adminId}/verification-sent$`),
    );
    await expect(
      page.getByRole("heading", {
        name: "Verification link queued",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Sending does not verify", { exact: false }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to user", exact: true }).click();
    await expect(
      page.getByLabel("Account status", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Verification (link queued|delivery)/,
      }),
    ).toHaveCount(0);
    await page.goto(`/admin/users/${f.target.adminId}/verification-sent`);
    await expect(
      page.getByRole("heading", { name: "Verification delivery", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Verification link queued",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await f.actor.db.query(
          "SELECT id FROM mail_request WHERE admin_id=$1 AND purpose='verify_email'",
          [f.target.adminId],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

for (const pending of ["send", "followup"] as const)
  test(`I-12 late resend ${pending} cannot reopen delivery after Back to user on the same record`, async ({
    page,
  }) => {
    const f = await setup(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let started!: () => void;
    const held = new Promise<void>((r) => {
      started = r;
    });
    let delivered!: () => void;
    const delivery = new Promise<void>((r) => {
      delivered = r;
    });
    try {
      await edit(page, `/admin/users/${f.target.adminId}`, "user");
      await page
        .getByRole("button", { name: "Send verification link", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Verification link queued",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/admin/users/${f.target.adminId}/verification-sent$`),
      );
      await page.route(
        `**/api/admin/users/${f.target.adminId}**`,
        async (route) => {
          const request = route.request();
          const match =
            pending === "send"
              ? request.method() === "POST"
              : request.method() === "GET" &&
                request.url().endsWith(f.target.adminId);
          if (!match) return route.continue();
          const response = await route.fetch();
          expect(response.status()).toBe(pending === "send" ? 202 : 200);
          started();
          await gate;
          await route.fulfill({ response });
          delivered();
        },
      );
      await page
        .getByRole("button", { name: "Resend link", exact: true })
        .click();
      await held;
      await page
        .getByRole("link", { name: "Back to user", exact: true })
        .click();
      await expect(
        page.getByLabel("Account status", { exact: true }),
      ).toBeVisible();
      release();
      await delivery;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page).toHaveURL(
        new RegExp(`/admin/users/${f.target.adminId}$`),
      );
      await expect(
        page.getByLabel("Account status", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: /Verification (link queued|delivery)/,
        }),
      ).toHaveCount(0);
    } finally {
      release();
      await f.close();
    }
  });
