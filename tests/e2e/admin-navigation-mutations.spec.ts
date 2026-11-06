import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";
test.use({ trace: "off", video: "off", screenshot: "off" });
async function setup(page: Page) {
  const actor = await fixture();
  const roleId = v7();
  await actor.db.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
    [roleId, `Navigation ${roleId}`],
  );
  await actor.db.query(
    "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'reports')",
    [roleId],
  );
  const target = await fixture(roleId);
  await actor.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [actor.userId],
  );
  await signIn(page, actor.username, actor.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.evaluate(() =>
    Object.assign(window, { __mutationDocument: true }),
  );
  return {
    actor,
    target,
    roleId,
    close: async () => {
      await actor.db.end();
      await target.db.end();
    },
  };
}
async function edit(page: Page, path: string, kind: "user" | "role") {
  await page.goto(path);
  await expect(
    page.getByLabel(kind === "user" ? "Role" : "Role name", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.assign(window, { __mutationDocument: true }),
  );
}
async function review(page: Page, kind: "user" | "role", reason: string) {
  await page.getByLabel("Reason", { exact: true }).fill(reason);
  await page
    .getByRole("button", { name: `Review ${kind}`, exact: true })
    .click();
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
}
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
          { exact: true },
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
for (const pending of [
  "patch",
  "verification-send",
  "verification-followup",
] as const)
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
