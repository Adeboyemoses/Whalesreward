import { expect, test, type Page } from "@playwright/test";
import { v7 } from "uuid";
import {
  stationFixture,
  api,
  registrationFixture,
  fillRegistration,
} from "../customers-cards/helpers";

// These client-boundary tests pair with the real HTTP/domain regressions. Both
// Playwright projects exercise the rendered messages at desktop and phone sizes.
test.use({ trace: "off", video: "off", screenshot: "off" });
const canary = "private policy configuration canary";
async function refuse(page: Page, path: string, code: string) {
  await page.route(path, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code, message: canary, retryable: false },
        serverTime: new Date().toISOString(),
        requestId: v7(),
      }),
    }),
  );
}
async function safeMessage(page: Page, message: string) {
  await expect(
    page.getByRole("alert").filter({ hasText: message }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(canary);
  await expect(page.locator("body")).not.toContainText(
    "The service is unavailable. Retry the same request",
  );
}

test("I-07 WHR-100 admin sign-in displays the approved auth policy 409 message", async ({
  page,
}) => {
  await refuse(page, "**/api/admin/sign-in", "auth_policy_unconfigured");
  await page.goto("/admin/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("fictional.policy");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Fictional-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await safeMessage(
    page,
    "Sign-in isn't set up on this server yet. Contact your system administrator.",
  );
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test("I-07 WHR-100 admin delegation 409 does not offer a role or imply user creation", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    await refuse(
      page,
      "**/api/admin/assignable-roles?*",
      "delegation_policy_unconfigured",
    );
    await page.goto("/admin/users/new");
    await safeMessage(
      page,
      "Access settings aren't set up on this server, so roles can't be changed. Contact your system administrator.",
    );
    await expect(
      page.getByLabel("Role", { exact: true }).locator("option"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Confirm change", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.db.end();
  }
});

test("I-12 WHR-100 email policy 409 leaves the address unverified in the portal", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    await refuse(
      page,
      `**/api/admin/users/${f.adminId}/verification-requests`,
      "delivery_unconfigured",
    );
    await page.goto(`/admin/users/${f.adminId}`);
    await page
      .getByRole("button", { name: "Send verification link", exact: true })
      .click();
    await safeMessage(
      page,
      "Email delivery is unavailable. The address remains unverified.",
    );
    await expect(
      page.getByText("Unverified", { exact: true }).first(),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/verification-sent/);
    expect(
      (
        await f.db.query("SELECT email_verified_at FROM admin WHERE id=$1", [
          f.adminId,
        ])
      ).rows[0].email_verified_at,
    ).toBeNull();
  } finally {
    await f.db.end();
  }
});

test("I-15 WHR-100 phone policy 409 gives station-manager guidance without linking a card", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await refuse(
      page,
      "**/api/attendant/customers",
      "phone_policy_unconfigured",
    );
    await page.goto("/attendant/register");
    const phone = await fillRegistration(page, f.codes[0]!);
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    await safeMessage(
      page,
      "Registration is not configured. Ask a station manager for help.",
    );
    await expect(page.getByText("Card linked", { exact: true })).toHaveCount(0);
    expect(
      (await f.db.query("SELECT state FROM card WHERE code=$1", [f.codes[0]]))
        .rows[0].state,
    ).toBe("unassigned");
    expect(
      (
        await f.db.query("SELECT id FROM customer WHERE phone_normalized=$1", [
          "+234" + phone.slice(1),
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.db.end();
  }
});

for (const failurePath of ["download", "metadata", "preview"] as const)
  test(`I-20 WHR-101 ${failurePath} failure offers a new export without downloading or changing stock`, async ({
    page,
  }) => {
    const f = await stationFixture(page);
    const downloads: string[] = [];
    page.on("download", (download) =>
      downloads.push(download.suggestedFilename()),
    );
    try {
      const batch = await api<{ id: string; version: number }>(
        page.request,
        "card-batches",
        { operationId: v7(), name: "Fictional policy message stock", count: 1 },
        201,
      );
      const artifact = {
        id: v7(),
        batchId: batch.id,
        format: "pdf",
        state: failurePath === "metadata" ? "failed" : "ready",
        preparedAt: new Date().toISOString(),
        snapshotAt: new Date().toISOString(),
        batchStatus: "generated",
        batchVersion: 1,
        cardCount: "1",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        failure: null,
      };
      await page.route(
        `**/api/admin/card-batches/${batch.id}/exports?*`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: { items: [artifact], nextCursor: null },
            }),
          }),
      );
      await refuse(
        page,
        `**/api/admin/card-batches/${batch.id}/exports/${artifact.id}/file`,
        "export_failed",
      );
      await page.route(
        `**/api/admin/card-batches/${batch.id}/exports/${artifact.id}`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: artifact }),
          }),
      );
      await page.goto(`/admin/cards/${batch.id}`);
      if (failurePath === "preview") {
        await page
          .getByRole("row")
          .filter({ hasText: "Ready" })
          .getByRole("link", { name: "Preview print sheet", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Load protected PDF preview",
            exact: true,
          })
          .click();
      } else if (failurePath === "download") {
        await page
          .getByRole("button", { name: "Download PDF", exact: true })
          .click();
      }
      const exportRow =
        failurePath === "preview"
          ? page.locator("main")
          : page.getByRole("row").filter({ hasText: "PDF" }).last();
      const fileError = exportRow
        .getByRole("alert")
        .filter({ hasText: "File preparation failed." });
      await expect(fileError).toHaveText(
        "File preparation failed. Prepare a new export.",
      );
      await expect(
        exportRow.getByRole("button", { name: "Download PDF", exact: true }),
      ).toHaveCount(0);
      await exportRow
        .getByRole("link", { name: "Prepare a new export", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Review export preparation", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Confirm export preparation",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText(canary);
      expect(downloads).toEqual([]);
      expect(
        (
          await f.db.query(
            "SELECT status,version FROM card_batch WHERE id=$1",
            [batch.id],
          )
        ).rows,
      ).toEqual([{ status: "generated", version: 1 }]);
      expect(
        (
          await f.db.query("SELECT state FROM card WHERE batch_id=$1", [
            batch.id,
          ])
        ).rows,
      ).toEqual([{ state: "unassigned" }]);
    } finally {
      await f.db.end();
    }
  });
