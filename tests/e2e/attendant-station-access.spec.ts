import { test, expect } from "@playwright/test";
import {
  stationFixture,
  createAttendant,
  attendantSignIn,
  captureStorage,
} from "../station/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("I-01 I-03 restricted first-password access creates no capture window until fresh online sign-in", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  const phone = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const p = await phone.newPage();
  const next = "  Fictional-新-password-2026  ";
  try {
    await attendantSignIn(p, child.username, child.password);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    expect((await captureStorage(p)).windows).toEqual([]);
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await p.reload();
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await p.goto("/attendant/sale");
    await expect(p).toHaveURL(/\/attendant\/sign-in$/);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await p
      .getByLabel("Current password", { exact: true })
      .fill(child.password);
    await p.getByLabel("New password", { exact: true }).fill(next);
    await p.getByLabel("Confirm new password", { exact: true }).fill(next);
    const complete = p.waitForResponse(
      (r) =>
        r.url().endsWith("/api/attendant/first-password") &&
        r.request().method() === "POST",
    );
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    expect((await complete).status()).toBe(204);
    await expect(
      p.getByText(
        "Password changed. Sign in online again before recording sales.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(p.getByLabel("Password", { exact: true })).toHaveValue("");
    expect((await captureStorage(p)).windows).toEqual([]);
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await p.getByLabel("Username", { exact: true }).fill(child.username);
    await p.getByLabel("Password", { exact: true }).fill(next);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p).toHaveURL(/\/attendant\/sale$/);
    expect((await captureStorage(p)).activeAccountId).toBe(child.attendant.id);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await phone.close();
    await f.db.end();
  }
});

test("I-09 revoked restricted session cannot change a password or create an offline anchor", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  const phone = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const p = await phone.newPage();
  try {
    await attendantSignIn(p, child.username, child.password);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await f.db.query(
      "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
      [child.attendant.accountId],
    );
    await p
      .getByLabel("Current password", { exact: true })
      .fill(child.password);
    await p
      .getByLabel("New password", { exact: true })
      .fill("Fictional-replacement-2026");
    await p
      .getByLabel("Confirm new password", { exact: true })
      .fill("Fictional-replacement-2026");
    const result = p.waitForResponse((r) =>
      r.url().endsWith("/api/attendant/first-password"),
    );
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    expect((await result).status()).toBe(401);
    await expect(p.getByLabel("Password", { exact: true })).toBeVisible();
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect((await captureStorage(p)).windows).toEqual([]);
    expect(
      (
        await f.db.query(
          "SELECT must_change_password FROM auth_user WHERE id=$1",
          [child.attendant.accountId],
        )
      ).rows[0].must_change_password,
    ).toBe(true);
  } finally {
    await phone.close();
    await f.db.end();
  }
});
