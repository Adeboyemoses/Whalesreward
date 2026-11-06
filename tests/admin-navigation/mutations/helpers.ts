import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import { fixture, signIn } from "../../admin-access/admin-access.fixtures";
test.use({ trace: "off", video: "off", screenshot: "off" });
export async function setup(page: Page) {
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
export async function edit(page: Page, path: string, kind: "user" | "role") {
  await page.goto(path);
  await expect(
    page.getByLabel(kind === "user" ? "Role" : "Role name", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.assign(window, { __mutationDocument: true }),
  );
}
export async function review(
  page: Page,
  kind: "user" | "role",
  reason: string,
) {
  await page.getByLabel("Reason", { exact: true }).fill(reason);
  await page
    .getByRole("button", { name: `Review ${kind}`, exact: true })
    .click();
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
}
