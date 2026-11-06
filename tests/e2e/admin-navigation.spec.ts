import { test, expect, type Page } from "@playwright/test";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";

test.use({ trace: "off", video: "off", screenshot: "off" });
async function ready(page: Page) {
  const f = await fixture();
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [f.userId],
  );
  await signIn(page, f.username, f.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/users");
  await expect(
    page.getByRole("heading", { name: "Portal users", exact: true }),
  ).toBeVisible();
  return f;
}
async function returnToTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

test("I-07 admin section and detail navigation preserve the document and session shell", async ({
  page,
}) => {
  const f = await ready(page);
  try {
    await page.evaluate(() =>
      Object.assign(window, { __adminDocumentSentinel: true }),
    );
    await page
      .getByRole("link", { name: "Roles & permissions", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
    await expect(
      page.getByRole("heading", { name: "Roles & permissions", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => "__adminDocumentSentinel" in window)).toBe(
      true,
    );
    await page
      .getByRole("link", { name: "View permissions", exact: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("heading", { name: /^Owner/ })
        .or(
          page.getByText("The Owner role cannot be edited", { exact: false }),
        ),
    ).toBeVisible();
    expect(await page.evaluate(() => "__adminDocumentSentinel" in window)).toBe(
      true,
    );
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Roles & permissions", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => "__adminDocumentSentinel" in window)).toBe(
      true,
    );
  } finally {
    await f.db.end();
  }
});

test("I-07 admin tab return retains visible data while session revalidation is pending", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const request = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    await page.route("**/api/admin/session", async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    });
    await returnToTab(page);
    await request;
    await expect(
      page.getByRole("heading", { name: "Portal users", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Loading account…", { exact: true }),
    ).toHaveCount(0);
    release();
  } finally {
    release();
    await f.db.end();
  }
});

test("I-09 admin background failure retains content but definitive revocation removes it", async ({
  page,
}) => {
  const f = await ready(page);
  try {
    await page.route("**/api/admin/session", (route) => route.abort("failed"));
    await returnToTab(page);
    await expect(
      page.getByRole("heading", { name: "Portal users", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      /connect|refresh|access|network/i,
    );
    await page.unroute("**/api/admin/session");
    await f.db.query(
      "UPDATE auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [f.userId],
    );
    await returnToTab(page);
    await expect(
      page.getByRole("heading", { name: "Portal users", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText(/session|sign|access/i);
    expect(
      (
        await page.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {},
        })
      ).status(),
    ).toBe(401);
  } finally {
    await f.db.end();
  }
});

test("I-49 admin navigation does not persist its account or grants in browser storage", async ({
  page,
}) => {
  const f = await ready(page);
  try {
    await page
      .getByRole("link", { name: "Roles & permissions", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
    const state = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      databases: (await indexedDB.databases()).map((db) => db.name),
      caches: await caches.keys(),
    }));
    expect(state).toEqual({
      local: [],
      session: [],
      databases: [],
      caches: [],
    });
  } finally {
    await f.db.end();
  }
});

test("I-09 returning visibility revalidates access without waiting for a focus event", async ({
  page,
}) => {
  const f = await ready(page);
  let calls = 0;
  try {
    await page.route("**/api/admin/session", async (route) => {
      calls++;
      await route.continue();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => calls).toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "Portal users", exact: true }),
    ).toBeVisible();
  } finally {
    await f.db.end();
  }
});

test("I-07 a pending user detail keeps its list context and inline loading state", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let started!: () => void;
  const request = new Promise<void>((r) => {
    started = r;
  });
  try {
    await page.route(`**/api/admin/users/${f.adminId}`, async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    });
    await page.evaluate(() =>
      Object.assign(window, { __adminDocumentSentinel: true }),
    );
    await page
      .getByRole("row")
      .filter({ hasText: f.username })
      .getByRole("link", { name: "Manage", exact: true })
      .click();
    await request;
    await expect(
      page.getByRole("heading", { name: "Portal users", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Loading details…", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => "__adminDocumentSentinel" in window)).toBe(
      true,
    );
    release();
    await expect(
      page.getByRole("heading", { name: /^Manage admin user/ }),
    ).toBeVisible();
  } finally {
    release();
    await f.db.end();
  }
});

test("I-07 healthy focus refresh keeps a draft but route changes clear credential drafts", async ({
  page,
}) => {
  const f = await ready(page);
  try {
    await page.getByRole("link", { name: "Create user", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill("Grace Okon");
    await page
      .getByLabel("Temporary password", { exact: true })
      .fill(f.password);
    const refreshed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/session") &&
        r.request().method() === "GET",
    );
    await returnToTab(page);
    await refreshed;
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Grace Okon",
    );
    expect(
      (await page
        .getByLabel("Temporary password", { exact: true })
        .inputValue()) === f.password,
    ).toBe(true);
    await page
      .getByRole("link", { name: "Roles & permissions", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Roles & permissions", exact: true }),
    ).toBeVisible();
    await page.goBack();
    expect(
      (
        await page
          .getByLabel("Temporary password", { exact: true })
          .inputValue()
      ).length,
    ).toBe(0);
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("");
  } finally {
    await f.db.end();
  }
});
