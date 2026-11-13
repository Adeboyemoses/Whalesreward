import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import {
  recoveryFixture,
  fillPhone,
  fillIntake,
  identityState,
  verificationBridge,
} from "../customer-changes/helpers";
import { phoneNumber, noPII } from "../customers-cards/helpers";
import { api } from "../station/helpers";

// This suite deliberately has no trace, video, automatic screenshots or secret
// attachments. Configured verification uses the documented real-service bridge.
test.use({ trace: "off", video: "off", screenshot: "off" });

test("I-15 I-41 C02 requires card attestation, masks review and preserves identity in C05 history without OTP", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    const before = await identityState(f),
      nextPhone = phoneNumber();
    let otpCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("card-verifications")) otpCalls++;
    });
    await page.goto(`${f.root}/phone`);
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("New phone number", { exact: true }).fill(nextPhone);
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Customer changed network provider.");
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm change", exact: true }),
    ).toHaveCount(0);
    expect(await identityState(f)).toEqual(before);
    await fillPhone(page, nextPhone);
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    const review = page.locator(".wr-sheet").filter({
      has: page.getByRole("heading", {
        name: /^Confirm account change/,
      }),
    });
    await expect(review).toBeVisible();
    expect((await review.innerText()).includes(nextPhone)).toBe(false);
    expect((await review.innerText()).includes(f.phone)).toBe(false);
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(page.getByText(/Change applied/).first()).toBeVisible();
    await expect(
      page
        .getByRole("heading", {
          name: "Account change history",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(
          "Customer changed network provider; old line no longer in use.",
        )
        .first(),
    ).toBeVisible();
    const after = await identityState(f);
    expect(after[0]).toMatchObject({
      version: before[0].version + 1,
      phone_normalized: `+234${nextPhone.slice(1)}`,
      card_id: before[0].card_id,
    });
    expect(otpCalls).toBe(0);
    await noPII(page, [f.phone, nextPhone]);
    const history = await api<{
      items: { oldPhoneMasked: string; newPhoneMasked: string }[];
    }>(page.request, `customers/${f.customerId}/changes`);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.oldPhoneMasked).toBe(`•••• ${f.phone.slice(-4)}`);
    expect(history.items[0]!.newPhoneMasked).toBe(
      `•••• ${nextPhone.slice(-4)}`,
    );
  } finally {
    await f.db.end();
  }
});

test("I-15 C02 lost response retries the exact reviewed operation and applies one change", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  const bodies: unknown[] = [];
  try {
    await page.route(
      `**/api/admin/customers/${f.customerId}/phone-change`,
      async (route) => {
        bodies.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (bodies.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await page.goto(`${f.root}/phone`);
    await fillPhone(page);
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry same confirmation", exact: true })
      .click();
    await expect(page.getByText(/Change applied/).first()).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM customer_identity_change WHERE customer_id=$1",
          [f.customerId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.db.end();
  }
});

test("I-15 I-21 C02 refreshes context before review and refuses a changed card at confirm", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    await page.goto(`${f.root}/phone`);
    await fillPhone(page);
    // Prove review uses a newly read context, not initial profile guards.
    await f.db.query("UPDATE customer SET version=version+1 WHERE id=$1", [
      f.customerId,
    ]);
    const read = page.waitForResponse(
      (r) =>
        r.url().endsWith("/recovery-context") && r.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    expect((await (await read).json()).data.customerVersion).toBe(2);
    await expect(
      page.getByRole("alert").filter({ hasText: /changed/i }),
    ).toBeVisible();
    await fillPhone(page);
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm change", exact: true }),
    ).toBeVisible();
    await f.db.query("UPDATE card SET version=version+1 WHERE id=$1", [
      f.oldCardId,
    ]);
    const write = page.waitForResponse((r) =>
      r.url().endsWith("/phone-change"),
    );
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    const response = await write;
    expect(response.status()).toBe(409);
    expect(response.request().postDataJSON()).toMatchObject({
      expectedVersion: 2,
      expectedCardVersion: 2,
    });
    expect((await response.json()).error.code).toBe("card_changed");
    await expect(
      page.getByRole("alert").filter({ hasText: /card|changed/i }),
    ).toBeVisible();
    expect((await identityState(f))[0].phone_normalized).toBe(
      `+234${f.phone.slice(1)}`,
    );
  } finally {
    await f.db.end();
  }
});

test("I-21a unconfigured C03 offers C04 and intake records one open case without changing identity", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    const before = await identityState(f);
    await page.goto(`${f.root}/replace-card`);
    await page
      .getByRole("button", { name: "Send verification code", exact: true })
      .click();
    await expect(
      page.getByText("Lost-card replacement isn't switched on yet", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Record for manager review", exact: true })
      .click();
    await fillIntake(page);
    await page
      .getByRole("button", { name: "Review manager intake", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record for manager review", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Recorded for a manager, nothing changed yet",
        exact: true,
      }),
    ).toBeVisible();
    expect(await identityState(f)).toEqual(before);
    const cases = await api<{ items: { id: string }[] }>(
      page.request,
      `customers/${f.customerId}/manager-cases`,
    );
    expect(cases.items).toHaveLength(1);
    const duplicate = await page.request.post(
      `/api/admin/customers/${f.customerId}/manager-cases`,
      {
        headers: { origin: "http://127.0.0.1:3000" },
        data: {
          operationId: v7(),
          expectedVersion: 1,
          customerPresent: true,
          reason: "Customer cannot access the registered phone.",
          verificationNotes: "Passport inspected in person.",
        },
      },
    );
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error.code).toBe("case_already_open");
    await page.reload();
    await expect(
      page
        .getByText(/recorded for a manager|open case|awaiting.*decision/i)
        .first(),
    ).toBeVisible();
    expect(await identityState(f)).toEqual(before);
  } finally {
    await f.db.end();
  }
});

test("I-07 customers-only can read C05 history but cannot enter recovery actions", async ({
  page,
}) => {
  const f = await recoveryFixture(page, ["customers"]);
  try {
    await page.goto(f.root);
    await expect(
      page
        .getByRole("heading", {
          name: "Account change history",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Update phone number", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Replace lost card", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${f.root}/phone`);
    await expect(
      page.getByText(/permissions do not allow|permission|access/i).first(),
    ).toBeVisible();
    await expect(
      page.getByLabel("New phone number", { exact: true }),
    ).toHaveCount(0);
    const history = await page.request.get(
      `/api/admin/customers/${f.customerId}/changes`,
    );
    expect(history.status()).toBe(200);
    const context = await page.request.get(
      `/api/admin/customers/${f.customerId}/recovery-context`,
    );
    expect(context.status()).toBe(403);
  } finally {
    await f.db.end();
  }
});

test("I-09 revocation after review prevents a phone change and clears the actionable form", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    const before = await identityState(f);
    await page.goto(`${f.root}/phone`);
    await fillPhone(page);
    await page
      .getByRole("button", { name: "Review phone update", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm change", exact: true }),
    ).toBeVisible();
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE id=$1) AND permission_code='recovery'",
      [f.adminId],
    );

    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    expect(
      (
        await page.request.get(
          `/api/admin/customers/${f.customerId}/recovery-context`,
        )
      ).status(),
    ).toBe(403);
    await expect(
      page.getByRole("button", { name: "Confirm change", exact: true }),
    ).toHaveCount(0);
    expect(await identityState(f)).toEqual(before);
  } finally {
    await f.db.end();
  }
});

test("I-21 I-21a C03 verifies only through the server adapter, clears code memory and atomically replaces the card", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  const bridge = await verificationBridge(page, f.customerId);
  try {
    await page.goto(`${f.root}/replace-card`);
    await page
      .getByRole("button", { name: "Send verification code", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check verification status", exact: true })
      .click();
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Resend code/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Resend code", exact: true }),
    ).toBeEnabled({ timeout: 10000 });
    await page
      .getByRole("button", { name: "Resend code", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check verification status", exact: true })
      .click();
    await bridge.enterCode(true, true);
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: /verification|code/i }),
    ).toBeVisible();
    expect(bridge.errors).toContain("verification_unavailable");
    await page
      .getByRole("button", { name: "Check verification status", exact: true })
      .click();
    await expect(
      page.getByLabel("Verification code", { exact: true }),
    ).toBeVisible();
    expect(
      (await page.getByLabel("Verification code", { exact: true }).inputValue())
        .length === 0,
    ).toBe(true);
    await bridge.enterCode();
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();
    await expect(
      page.getByText("Phone verified", { exact: true }).first(),
    ).toBeVisible();
    expect(
      (await page.getByLabel("Verification code", { exact: true }).count()) ===
        0 ||
        (await page
          .getByLabel("Verification code", { exact: true })
          .inputValue()) === "",
    ).toBe(true);
    expect(await bridge.hasPersistedCode()).toBe(false);
    await page.evaluate(() => {
      Reflect.deleteProperty(window, "BarcodeDetector");
    });
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(
      page.getByText(
        "QR scanning is unavailable in this browser. Enter the printed code.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enter printed code", exact: true })
      .click();
    await page
      .getByLabel("Unused card number", { exact: true })
      .fill("A7K3M9Q");
    await page
      .getByLabel("Reason for replacement", { exact: true })
      .fill("Card lost; customer reported at the station in person.");
    await page
      .getByRole("button", { name: "Review replacement", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "This card is unavailable" }),
    ).toBeVisible();
    expect((await identityState(f))[0].card_id).toBe(f.oldCardId);
    await page
      .getByLabel("Unused card number", { exact: true })
      .fill(f.newCard.toLowerCase());
    await page
      .getByRole("button", { name: "Review replacement", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(page.getByText(/Change applied/).first()).toBeVisible();
    const states = (
      await f.db.query(
        "SELECT id,state FROM card WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[f.oldCardId, f.newCardId]],
      )
    ).rows;
    expect(states.find((c) => c.id === f.oldCardId)?.state).toBe("retired");
    expect(states.find((c) => c.id === f.newCardId)?.state).toBe("linked");
    expect((await identityState(f))[0]).toMatchObject({
      card_id: f.newCardId,
      phone_normalized: `+234${f.phone.slice(1)}`,
    });
    const history = await api<{
      items: { verification: string; newCardCode: string }[];
    }>(page.request, `customers/${f.customerId}/changes`);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      verification: "registered_phone_code",
      newCardCode: f.newCard,
    });
    expect(await bridge.hasPersistedCode()).toBe(false);
  } finally {
    await bridge.close();
    await f.db.end();
  }
});

test("I-02 recovery forms never queue an offline account change", async ({
  page,
  context,
}) => {
  const f = await recoveryFixture(page);
  try {
    const before = await identityState(f);
    await page.goto(`${f.root}/phone`);
    await fillPhone(page);
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Review phone update", exact: true }),
    ).toBeDisabled();
    expect(await identityState(f)).toEqual(before);
    await noPII(page, [f.phone]);
  } finally {
    await context.setOffline(false);
    await f.db.end();
  }
});

test("I-15 C02 explains unchanged and occupied phones without applying a change", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    const before = await identityState(f);
    for (const [phone, code] of [
      [f.phone, "no_change"],
      ["08000000027", "phone_in_use"],
    ]) {
      await page.goto(`${f.root}/phone`);
      await fillPhone(page, phone);
      await page
        .getByRole("button", { name: "Review phone update", exact: true })
        .click();
      const write = page.waitForResponse((r) =>
        r.url().endsWith("/phone-change"),
      );
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      const response = await write;
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe(code);
      await expect(
        page.getByRole("alert").filter({ hasText: /phone/i }),
      ).toBeVisible();
      expect(await identityState(f)).toEqual(before);
    }
  } finally {
    await f.db.end();
  }
});

test("I-07 managerRecovery can read an existing case but cannot create or approve an intake", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  try {
    const recorded = await api<{ id: string }>(
      page.request,
      `customers/${f.customerId}/manager-cases`,
      {
        operationId: v7(),
        expectedVersion: 1,
        customerPresent: true,
        reason: "Customer cannot access the registered phone.",
        verificationNotes: "Passport inspected in person.",
      },
      201,
    );
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE id=$1) AND permission_code='recovery'",
      [f.adminId],
    );
    await f.db.query(
      "INSERT INTO role_permission(role_id,permission_code) SELECT role_id,'managerRecovery' FROM admin WHERE id=$1",
      [f.adminId],
    );
    await page.goto(f.root);
    await expect(page.getByText(/manager|case/i).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Replace lost card", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          `/api/admin/customers/${f.customerId}/manager-cases/${recorded.id}`,
        )
      ).status(),
    ).toBe(200);
    const denied = await page.request.post(
      `/api/admin/customers/${f.customerId}/manager-cases`,
      {
        headers: { origin: "http://127.0.0.1:3000" },
        data: {
          operationId: v7(),
          expectedVersion: 1,
          customerPresent: true,
          reason: "Customer cannot access the registered phone.",
          verificationNotes: "Passport inspected in person.",
        },
      },
    );
    expect(denied.status()).toBe(403);
    expect((await identityState(f))[0].version).toBe(1);
  } finally {
    await f.db.end();
  }
});

test("I-09 C03 leaving during preflight prevents verification issuance", async ({
  page,
}) => {
  const f = await recoveryFixture(page);
  const bridge = await verificationBridge(page, f.customerId);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const fetched = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let posts = 0;
  try {
    await page.goto(`${f.root}/replace-card`);
    await expect(
      page.getByRole("button", { name: "Send verification code", exact: true }),
    ).toBeVisible();
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith(`/customers/${f.customerId}/card-verifications`)
      )
        posts++;
    });
    await page.route(
      `**/api/admin/customers/${f.customerId}/recovery-context`,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        ready();
        await held;
        await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Send verification code", exact: true })
      .click();
    await fetched;
    await page
      .getByRole("link", { name: "Back to profile", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${f.root}$`));
    await expect(
      page.getByRole("heading", { name: "Amina Bello", exact: true }),
    ).toBeVisible();
    const completed = page.waitForResponse((response) =>
      response.url().endsWith(`/customers/${f.customerId}/recovery-context`),
    );
    release();
    await completed;
    // Bounded negative observation: let the released continuation dispatch if stale.
    await page.waitForTimeout(1000);
    const challenges = await f.db.query(
      "SELECT count(*)::int AS count FROM verification_challenge WHERE customer_id=$1",
      [f.customerId],
    );
    expect({ posts, challenges: challenges.rows[0].count }).toEqual({
      posts: 0,
      challenges: 0,
    });
  } finally {
    release();
    await bridge.close();
    await f.db.end();
  }
});
