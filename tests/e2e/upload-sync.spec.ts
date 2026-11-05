import { expect, test, type Page } from "@playwright/test";
import {
  installAttendantFake,
  type AttendantFake,
  ids,
} from "../fixtures/attendant-http-fake";
import {
  fillSale,
  rows,
  save,
  signIn,
  waitForWorker,
} from "../fixtures/offline-browser";

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function savedOffline(page: Page, fake: AttendantFake, gas = false) {
  await signIn(page, gas ? "favour.james" : "grace.okon");
  await waitForWorker(page);
  await fillSale(page, { gas, value: gas ? "15000.00" : "20000.00" });
  fake.setOffline(true);
  await page.context().setOffline(true);
  await save(page);
  return (await rows(page))[0]!;
}
async function reconnect(page: Page, fake: AttendantFake) {
  fake.setOffline(false);
  await page.context().setOffline(false);
}
// A routed PUT/request count is not a durable failure acknowledgement. Wait
// through both the error patch and finally's lease release before replacing
// the document, so these cases exercise retry of a completed failed attempt.
async function photoFailureSettled(page: Page, operationId: string) {
  await expect
    .poll(async () => {
      const row = (await rows(page)).find(
        (row) => row.operationId === operationId,
      );
      return {
        error: row?.lastErrorCode,
        attempted: (row?.attempts ?? 0) > 0,
        scheduled: !!row?.nextAttemptAt,
        lease: row?.syncLease,
      };
    })
    .toEqual({
      error: "photo_upload_failed",
      attempted: true,
      scheduled: true,
      lease: null,
    });
}

async function synced(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Sale synced", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}

test("I-22 I-26 offline restart reconnect displays credit only after one authoritative outcome", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  const original = await savedOffline(page, fake);
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(
    reopened.getByRole("heading", { name: "Saved on phone", exact: true }),
  ).toBeVisible();
  expect((await rows(reopened))[0]!.original).toEqual(original.original);
  await reconnect(reopened, fake);
  await synced(reopened);
  const after = (await rows(reopened))[0]!;
  expect(after.original).toEqual(original.original);
  expect(after.photoBlob).toEqual(original.photoBlob);
  expect([...fake.sync.records.values()].map((r) => r.credits)).toEqual([1]);
  await reopened.reload();
  await synced(reopened);
  expect([...fake.sync.records.values()].map((r) => r.credits)).toEqual([1]);
  await reopened.goto("/attendant/uploads");
  await expect(
    reopened.getByRole("heading", {
      name: "All uploads complete",
      exact: true,
    }),
  ).toBeVisible();
});

test("I-26 successful photo PUT never displays Synced while finalization is pending", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setFinalizePending(true);
  await savedOffline(page, fake);
  await reconnect(page, fake);
  await expect
    .poll(
      () => fake.sync.calls.filter((c) => c.path.endsWith("/finalize")).length,
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Sale synced", exact: true }),
  ).toHaveCount(0);
  expect((await rows(page))[0]!.photoBlob.size).toBeGreaterThan(0);
  expect([...fake.sync.records.values()][0]!.credits).toBe(0);
  fake.sync.setFinalizePending(false);
  await synced(page);
});

for (const lost of ["submit", "finalize"] as const) {
  test(`I-22 lost ${lost} response reconciles the same sale without a second credit`, async ({
    page,
    context,
  }) => {
    const fake = await installAttendantFake(context, { sync: true });
    if (lost === "submit") fake.sync.loseNextSubmit();
    else fake.sync.loseNextFinalize();
    const original = await savedOffline(page, fake);
    await reconnect(page, fake);
    await synced(page);
    expect(
      fake.sync.calls.some((c) =>
        c.path.endsWith(`/by-operation/${original.operationId}`),
      ),
    ).toBe(true);
    expect([...fake.sync.records.values()].map((r) => r.credits)).toEqual([1]);
    expect((await rows(page))[0]!.original).toEqual(original.original);
    expect(
      new Set(
        fake.sync.calls
          .filter((c) => c.path.endsWith("/finalize"))
          .map((c) => JSON.stringify(c.body)),
      ).size,
    ).toBe(1);
  });
}

test("I-25 partial photo failure retains evidence and retry uses the original sale", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setPutFailure(true);
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await photoFailureSettled(page, original.operationId);
  await page.goto("/attendant/uploads");
  await expect(
    page.getByText("Photo upload failed", { exact: true }),
  ).toBeVisible();
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  expect([...fake.sync.records.values()][0]!.credits).toBe(0);
  fake.sync.setPutFailure(false);
  await page
    .getByRole("button", { name: "Retry uploads", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "All uploads complete", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(fake.sync.records.size).toBe(1);
  expect([...fake.sync.records.values()][0]!.credits).toBe(1);
  const retried = (await rows(page))[0]!;
  expect(retried.original).toEqual(original.original);
  expect(retried.photoBlob).toEqual(original.photoBlob);
  expect(retried.serverStatus?.photoValidated).toBe(true);
});

test("I-25 expired permission renews permission identity without changing the sale or photo", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.expireNextPermission();
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await synced(page);
  const permissions = fake.sync.calls.filter((c) =>
    c.path.endsWith("/upload-permission"),
  );
  expect(permissions.length).toBeGreaterThanOrEqual(2);
  expect(
    new Set(
      permissions.map((c) => (c.body as { operationId: string }).operationId),
    ).size,
  ).toBeGreaterThanOrEqual(2);
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  expect(fake.sync.records.size).toBe(1);
});

test("I-22 manual retry honors server Retry-After and retains the original", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setThrottle(10);
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await expect.poll(() => fake.sync.calls.length).toBeGreaterThan(0);
  await page.goto("/attendant/uploads");
  const count = fake.sync.calls.length;
  const button = page.getByRole("button", {
    name: "Retry uploads",
    exact: true,
  });
  if (await button.isEnabled()) await button.click();
  await page.waitForTimeout(500);
  expect(fake.sync.calls.length).toBe(count);
  expect((await rows(page))[0]!.original).toEqual(original.original);
  await expect(page.getByText("Sale synced", { exact: true })).toHaveCount(0);
});

test("I-31 I-35 photo-complete mixed holds leave the upload count but never claim credit", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setOutcome("held", [
    { kind: "price", reasonCode: "price_uncertain" },
    { kind: "card", reasonCode: "replaced_card" },
    { kind: "date", reasonCode: "capture_date_uncertain" },
  ]);
  await savedOffline(page, fake);
  await reconnect(page, fake);
  await expect(
    page.getByRole("heading", { name: "Awaiting price review", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("Card eligibility review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sale date review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sale synced", exact: true }),
  ).toHaveCount(0);
  expect([...fake.sync.records.values()][0]!.credits).toBe(0);
  await page.goto("/attendant/uploads");
  await expect(
    page.getByText("0 sales waiting", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Awaiting price review", { exact: true }).first(),
  ).toBeVisible();
});

test("I-27 cancelled missing customer never claims its photo reached the server", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setOutcome("cancelled");
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await expect.poll(async () => (await rows(page))[0]!.state).toBe("cancelled");
  await page.goto("/attendant/uploads");
  await expect(
    page.getByText(/Every sale and photo.*reached the server/),
  ).toHaveCount(0);
  await expect(
    page.getByText(/customer.*not found|No customer/i).first(),
  ).toBeVisible();
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  expect(
    fake.sync.calls.filter((c) => c.path.startsWith("/storage/")),
  ).toHaveLength(0);
});

test("I-06 leaving pending locks uploads and hides the original account from the next attendant", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  const original = await savedOffline(page, fake);
  await page.goto("/attendant/account/hand-over");
  await page
    .getByRole("button", { name: "Sign out with pending sales", exact: true })
    .click();
  await reconnect(page, fake);
  await signIn(page, "favour.james");
  await page.goto("/attendant/uploads");
  await expect(page.getByText("Amina Bello", { exact: true })).toHaveCount(0);
  expect(
    fake.sync.calls.filter(
      (c) =>
        c.accountId === ids.favour &&
        (JSON.stringify(c.body) ?? "").includes(String(original.operationId)),
    ),
  ).toHaveLength(0);
  expect((await rows(page))[0]!.original).toEqual(original.original);
});

test("I-26 I-30 gas receipt uses server credit with Cylinder and the captured kilogram values", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  await savedOffline(page, fake, true);
  await reconnect(page, fake);
  await synced(page);
  await expect(page.getByText("Cylinder", { exact: true })).toBeVisible();
  await expect(page.getByText("₦15,000.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/About 10(?:\.00)? (?:kg|kilograms)/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Record next sale", exact: true })
    .click();
  await expect(page.getByLabel("Bought into", { exact: true })).toHaveValue(
    "Cylinder",
  );
  await expect(page.getByLabel("Amount in naira", { exact: true })).toHaveValue(
    "",
  );
});

test("I-06 upload-first signs out only after pending data is durably uploaded", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setPutPaused(true);
  const original = await savedOffline(page, fake);
  await page.goto("/attendant/account/hand-over");
  await reconnect(page, fake);
  await page
    .getByRole("button", { name: "Upload, then sign out", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fake.sync.calls.filter((c) => c.path.startsWith("/storage/")).length,
    )
    .toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/attendant\/account\/hand-over$/);
  expect(fake.activeSession()?.account.id).toBe(ids.grace);
  expect([...fake.sync.records.values()][0]!.credits).toBe(0);
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  fake.sync.setPutPaused(false);
  await expect(page).toHaveURL(/\/attendant\/sign-in$/, { timeout: 20000 });
  expect(fake.activeSession()).toBeNull();
  expect([...fake.sync.records.values()][0]!.credits).toBe(1);
  expect([...fake.sync.records.values()][0]!.original).toEqual(
    original.original,
  );
});

test("I-25 rejected immutable photo stays available for support without replacement sale", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setInvalidPhoto(true);
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  expect((await rows(page))[0]!.original).toEqual(original.original);
  expect(fake.sync.records.size).toBe(1);
  expect([...fake.sync.records.values()][0]!.credits).toBe(0);
  const receiptUrl = page.url();
  const rejected = (await rows(page))[0]!;
  const writeCalls = () =>
    fake.sync.calls.filter(
      (call) =>
        call.path.endsWith("/finalize") || call.path.startsWith("/storage/"),
    );
  const writesBefore = writeCalls().length;
  const readsBefore = fake.sync.calls.filter((call) =>
    call.path.includes("/by-operation/"),
  ).length;
  await page.goto("/attendant/account");
  await page.goto(receiptUrl);
  await expect
    .poll(
      () =>
        fake.sync.calls.filter((call) => call.path.includes("/by-operation/"))
          .length,
    )
    .toBeGreaterThan(readsBefore);
  // Allow two foreground timer passes after the receipt's authoritative refresh.
  await page.waitForTimeout(2200);
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/manager/i).first()).toBeVisible();
  const reopened = (await rows(page))[0]!;
  expect(reopened.state).toBe("needs_attention");
  expect(reopened.lastErrorCode).toBe("photo_invalid");
  expect(reopened.original).toEqual(original.original);
  expect(reopened.photoBlob).toEqual(original.photoBlob);
  expect(reopened.finalizeRequest).toEqual(rejected.finalizeRequest);
  expect(writeCalls()).toHaveLength(writesBefore);
});

for (const leave of ["Stay signed in", "Account navigation"] as const) {
  test(`I-06 ${leave} cancels pending upload-first sign-out intent`, async ({
    page,
    context,
  }) => {
    const fake = await installAttendantFake(context, { sync: true });
    fake.sync.setPutPaused(true);
    const original = await savedOffline(page, fake);
    await page.goto("/attendant/account/hand-over");
    await reconnect(page, fake);
    await page
      .getByRole("button", { name: "Upload, then sign out", exact: true })
      .click();
    await expect
      .poll(
        () =>
          fake.sync.calls.filter((c) => c.path.startsWith("/storage/")).length,
      )
      .toBeGreaterThan(0);
    if (leave === "Stay signed in")
      await page
        .getByRole("button", { name: "Stay signed in", exact: true })
        .click();
    else await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page).toHaveURL(/\/attendant\/account$/);
    fake.sync.setPutPaused(false);
    if (leave === "Stay signed in") {
      await expect
        .poll(() => [...fake.sync.records.values()][0]?.status.credited, {
          timeout: 20000,
        })
        .toBe(true);
    } else {
      // A full navigation abandons the old request and may retain its live lease.
      // This regression checks logout intent; restart/lease recovery is separate.
      await expect
        .poll(() => [...fake.sync.permissions.values()].some((p) => p.uploaded))
        .toBe(true);
    }
    expect((await rows(page))[0]!.original).toEqual(original.original);
    expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/attendant\/account$/);
    expect(fake.activeSession()?.account.id).toBe(ids.grace);
    expect(fake.calls.filter((c) => c.path.endsWith("/sign-out"))).toHaveLength(
      0,
    );
  });
}

test("I-25 expired storage PUT permission preserves the signed-in account and resumes safely", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setPutForbidden(true);
  const original = await savedOffline(page, fake);
  await reconnect(page, fake);
  await photoFailureSettled(page, original.operationId);
  await page.goto("/attendant/uploads");
  await expect(
    page.getByRole("heading", { name: "Pending uploads", exact: true }),
  ).toBeVisible();
  expect(fake.activeSession()?.account.id).toBe(ids.grace);
  expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
  fake.sync.setPutForbidden(false);
  fake.sync.expireNextPermission();
  await page
    .getByRole("button", { name: "Retry uploads", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "All uploads complete", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(fake.sync.records.size).toBe(1);
  expect([...fake.sync.records.values()][0]!.credits).toBe(1);
  const retried = (await rows(page))[0]!;
  expect(retried.original).toEqual(original.original);
  expect(retried.photoBlob).toEqual(original.photoBlob);
  expect(retried.serverStatus?.photoValidated).toBe(true);
});
