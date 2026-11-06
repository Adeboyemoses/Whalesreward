import { test, expect } from "@playwright/test";
import { setup, edit, review } from "../admin-navigation/mutations/helpers";
test.use({ trace: "off", video: "off", screenshot: "off" });
for (const kind of ["user", "role"] as const)
  test(`I-07 sequential existing ${kind} saves refresh the editor, version and immutable history without reloading`, async ({
    page,
  }) => {
    const f = await setup(page);
    try {
      const id = kind === "user" ? f.target.adminId : f.roleId;
      const path = `/admin/${kind === "user" ? "users" : "roles"}/${id}`;
      await edit(page, path, kind);
      for (let i = 0; i < 2; i++) {
        if (kind === "user")
          await page
            .getByLabel("Account status", { exact: true })
            .selectOption(i === 0 ? "false" : "true");
        else
          await page
            .getByLabel("Role name", { exact: true })
            .fill(`Navigation ${f.roleId} ${i}`);
        const reason = `Sequential ${kind} save ${i}`;
        await review(page, kind, reason);
        const response = page.waitForResponse(
          (r) => r.request().method() === "PATCH" && r.url().includes(id),
        );
        await page
          .getByRole("button", { name: "Confirm change", exact: true })
          .click();
        expect((await response).status()).toBe(200);
        await expect(
          page.getByText("Not saved yet", { exact: true }),
        ).toHaveCount(0);
        await expect(page.getByLabel("Reason", { exact: true })).toBeVisible();
        await expect(
          page.getByText(reason, { exact: false }).last(),
        ).toBeVisible();
        expect(
          (
            await f.actor.db.query(
              `SELECT version FROM ${kind === "user" ? "admin" : "role"} WHERE id=$1`,
              [id],
            )
          ).rows[0].version,
        ).toBe(i + 2);
        expect(
          (
            await f.actor.db.query(
              "SELECT id FROM admin_access_event WHERE target_id=$1 AND reason=$2",
              [id, reason],
            )
          ).rowCount,
        ).toBe(1);
        expect(await page.evaluate(() => "__mutationDocument" in window)).toBe(
          true,
        );
      }
    } finally {
      await f.close();
    }
  });
for (const secondary of ["access-history", "assignable-roles"])
  test(`I-07 failed ${secondary} is a secondary warning and never fabricates verification delivery`, async ({
    page,
  }) => {
    const f = await setup(page);
    let sends = 0;
    page.on("request", (r) => {
      if (r.url().includes("verification-requests")) sends++;
    });
    try {
      await page.route(`**/api/admin/${secondary}?**`, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "unavailable",
              message: "Secondary read unavailable",
            },
          }),
        }),
      );
      await edit(page, `/admin/users/${f.target.adminId}`, "user");
      await expect(
        page.getByText(
          secondary === "access-history"
            ? "Access history could not be refreshed."
            : "Role choices could not be refreshed.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Manage admin user", exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: /Verification (link queued|delivery)/,
        }),
      ).toHaveCount(0);
      expect(sends).toBe(0);
      if (secondary === "assignable-roles") {
        // Existing role may remain visible, but failed choices cannot manufacture grants.
        const values = await page
          .getByLabel("Role", { exact: true })
          .locator("option")
          .evaluateAll((xs) => xs.map((x) => (x as HTMLOptionElement).value));
        expect(values.filter((v) => v && v !== f.roleId)).toEqual([]);
      }
    } finally {
      await f.close();
    }
  });
for (const pending of ["patch"] as const)
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
            pending === "patch"
              ? request.method() === "PATCH"
              : pending === "verification-send"
                ? request.url().endsWith("verification-requests")
                : request.method() === "GET" &&
                  request.url().endsWith(f.target.adminId);
          if (!match) return route.continue();
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          started();
          await gate;
          await route.fulfill({ response });
          delivered();
        },
      );
      if (pending === "patch") {
        await page
          .getByLabel("Account status", { exact: true })
          .selectOption("false");
        await review(page, "user", "Departed user save");
        await page
          .getByRole("button", { name: "Confirm change", exact: true })
          .click();
      } else
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
