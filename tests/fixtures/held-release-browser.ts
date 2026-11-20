import {
  expect,
  test,
  request as requestFactory,
  type Browser,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { v7 } from "uuid";
import { reviewFixture, heldSale, type ReviewKind } from "../reviews/helpers";
import { browserReleasePolicy } from "../reviews/release-browser-policy";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";
import { data, origin } from "../sales-history/helpers";
import { seedId, api, type Attendant } from "../station/helpers";
import type { AttendantSession } from "../../src/shared/contracts/auth";
import { ensureLocalCardBucket } from "../customers-cards/storage";
import type { z } from "zod";
import type {
  releasePreparationSchema,
  releaseProposalSchema,
} from "../../src/shared/contracts/held-release";

export type Preparation = z.infer<typeof releasePreparationSchema>;
export type Proposal = z.infer<typeof releaseProposalSchema>;
export type PaperCaptureRange = {
  from: string;
  through: string;
  timezone: "Africa/Lagos";
};
export type ReleaseFixture = Awaited<ReturnType<typeof releaseFixture>>;

export async function bindEnabledPeople(db: {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}) {
  // Complete-install gate intentionally covers every enabled account in this isolated schema.
  await db.query(
    `INSERT INTO held_release_person(id,station_id)
    SELECT id,$1 FROM auth_user u WHERE enabled AND NOT EXISTS
      (SELECT 1 FROM held_release_person p WHERE p.id=u.id)`,
    [seedId(8)],
  );
  await db.query(
    `INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified)
    SELECT id,$1,id,id,1,true FROM auth_user u WHERE enabled AND NOT EXISTS
      (SELECT 1 FROM held_release_person_binding b WHERE b.user_id=u.id AND b.station_id=$1)`,
    [seedId(8)],
  );
}

export async function restoreUnknownPeople(db: ReleaseFixture["db"]) {
  await db.query(
    `INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified)
    SELECT whr_uuid_v7(),$1,u.id,u.id,b.version+1,true FROM auth_user u
    JOIN LATERAL(SELECT version,verified FROM held_release_person_binding WHERE user_id=u.id AND station_id=$1 ORDER BY version DESC LIMIT 1)b ON NOT b.verified WHERE u.enabled`,
    [seedId(8)],
  );
}
export async function historical(
  db: ReleaseFixture["db"],
  table: string,
  sql: string,
  values: unknown[],
) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid fixture table");
  await db.query("BEGIN");
  try {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await db.query(sql, values);
    await db.query("SET CONSTRAINTS ALL IMMEDIATE");
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/** Request-only fixture exercises the same real HTTP/MinIO paths when GUI launch is unavailable.
 * The Page-shaped adapter exposes request only and is never passed to UI assertions.
 */
async function apiReviewFixture(
  adminRequest: APIRequestContext,
  pumpId = seedId(14),
) {
  await ensureLocalCardBucket();
  const f = await fixture();
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [f.userId],
  );
  const sign = await adminRequest.post("/api/admin/sign-in", {
    headers: { Origin: origin, "Idempotency-Key": v7() },
    data: { username: f.username, password: f.password },
  });
  expect(sign.status()).toBe(200);
  const password = randomBytes(20).toString("hex"),
    username = `release.${v7().slice(-12)}`;
  const attendant = await api<{ id: string; accountId: string }>(
    adminRequest,
    "attendants",
    {
      operationId: v7(),
      name: "Grace Okon",
      username,
      password,
      pumpId,
      expectedPumpVersion: 1,
    },
    201,
  );
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [attendant.accountId],
  );
  const phoneRequest = await requestFactory.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      "x-test-ip": `2001:db8::${v7().replaceAll("-", "").slice(-12).match(/.{4}/g)!.join(":")}`,
    },
  });
  const phoneSign = await phoneRequest.post("/api/attendant/sign-in", {
    headers: { Origin: origin, "Idempotency-Key": v7() },
    data: { username, password, deviceId: v7() },
  });
  expect(phoneSign.status()).toBe(200);
  const customerId = v7(),
    cardId = v7(),
    batchId = v7(),
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const cardCode = Array.from(
    randomBytes(7),
    (b) => alphabet[b % alphabet.length],
  ).join("");
  await f.db.query(
    "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,'Amina Bello',$3,'car_owner',1)",
    [
      customerId,
      `QA-${customerId}`,
      `+23480${String(BigInt("0x" + randomBytes(6).toString("hex")) % 100000000n).padStart(8, "0")}`,
    ],
  );
  await f.db.query(
    "INSERT INTO card_batch(id,batch_code,status,version,created_by) VALUES($1,$2,'generated',1,$3)",
    [batchId, `QA-${batchId}`, f.adminId],
  );
  await f.db.query(
    "UPDATE card_batch SET status='printed',version=2 WHERE id=$1",
    [batchId],
  );
  await f.db.query(
    "UPDATE card_batch SET status='active',version=3 WHERE id=$1",
    [batchId],
  );
  await f.db.query(
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
    [cardId, batchId, cardCode],
  );
  await f.db.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,'2026-11-01T00:00:00Z',$4,'Fictional release browser fixture')",
    [v7(), cardId, customerId, f.userId],
  );
  await f.db.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    cardId,
  ]);
  return {
    ...f,
    attendant,
    username,
    password,
    phone: { request: phoneRequest } as Page,
    cardId,
    cardCode,
    batchId,
    customerId,
    async close() {
      await phoneRequest.dispose();
      await f.db.end();
    },
  } as Awaited<ReturnType<typeof reviewFixture>>;
}
export async function releaseFixture(
  page: Page,
  browser?: Browser,
  options: { pumpId?: string } = {},
) {
  const apiOnlyPhone = !browser || !!options.pumpId;
  const f = apiOnlyPhone
    ? await apiReviewFixture(page.request, options.pumpId)
    : await reviewFixture(page, browser!, false);
  const second = await fixture();
  await second.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [second.userId],
  );
  const ip = `2001:db8::${v7().replaceAll("-", "").slice(-12).match(/.{4}/g)!.join(":")}`;
  const context = browser
    ? await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { "x-test-ip": ip },
      })
    : null;
  const secondRequest = !browser
    ? await requestFactory.newContext({
        baseURL: origin,
        extraHTTPHeaders: { "x-test-ip": ip },
      })
    : null;
  const reviewer = context
    ? await context.newPage()
    : ({ request: secondRequest! } as Page);
  if (browser) {
    await signIn(reviewer, second.username, second.password);
    await expect(reviewer).not.toHaveURL(
      /\/admin\/(?:sign-in|first-password)$/,
    );
  } else {
    const sign = await secondRequest!.post("/api/admin/sign-in", {
      headers: { Origin: origin, "Idempotency-Key": v7() },
      data: { username: second.username, password: second.password },
    });
    expect(sign.status()).toBe(200);
  }
  await bindEnabledPeople(f.db);
  await restoreUnknownPeople(f.db);
  const p = browserReleasePolicy;
  await f.db.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,$7,'Fictional isolated browser v2 approval') ON CONFLICT DO NOTHING",
    [
      p.activation.approvalReference,
      p.release,
      p.digest,
      p.revision,
      p.scope.stationId,
      p.scope.environment,
      p.activation.activatedAt,
    ],
  );
  await f.db.query(
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) SELECT $1,$2,$3,$4,$5,'Fictional isolated browser v2 approval' WHERE NOT EXISTS(SELECT 1 FROM review_evidence_configuration WHERE id=$1)",
    [seedId(9173), p.scope.stationId, p.scope.environment, p.revision, p],
  );
  await f.db.query("BEGIN");
  try {
    await f.db.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
    await f.db.query(
      "INSERT INTO station_reporting_state(station_id) VALUES($1) ON CONFLICT DO NOTHING",
      [seedId(8)],
    );
    await f.db.query(
      "SELECT station_id FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
      [seedId(8)],
    );
    if (
      !(
        await f.db.query(
          "SELECT id FROM settings_version WHERE station_id=$1",
          [seedId(8)],
        )
      ).rows.length
    ) {
      const campaign = v7(),
        timing = v7();
      await f.db.query(
        "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional release browser campaign',1,false)",
        [campaign, seedId(8)],
      );
      await f.db.query(
        "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z','2026-12-02T00:00:00Z','Africa/Lagos','2026-11-01T00:00:00Z',$4,'Fictional local retained timing')",
        [timing, seedId(8), campaign, f.adminId],
      );
      await f.db.query(
        "UPDATE station_reporting_state SET settings_version=1,current_settings_version_id=$2 WHERE station_id=$1",
        [seedId(8), timing],
      );
      await f.db.query(
        "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
        [campaign, timing],
      );
    }
    await f.db.query("COMMIT");
  } catch (error) {
    await f.db.query("ROLLBACK");
    throw error;
  }
  if (browser) {
    await installReleaseStorageBridge(page);
    await installReleaseStorageBridge(reviewer);
  }
  return {
    ...f,
    reviewer,
    adminRequest: page.request,
    second,
    browserBased: !apiOnlyPhone,
    async close() {
      if (context) {
        await page.unrouteAll({ behavior: "wait" });
        await reviewer.unrouteAll({ behavior: "wait" });
      }
      // Best-effort diagnostics for the separate reviewer page, before teardown.
      if (context && !reviewer.isClosed()) {
        try {
          await writeFile(
            test.info().outputPath("reviewer-context.md"),
            await reviewer.locator("body").ariaSnapshot({ timeout: 3000 }),
          );
        } catch {
          // Diagnostic capture must not replace the original failure or skip cleanup.
        }
      }
      await context?.close();
      await secondRequest?.dispose();
      await second.db.end();
      await f.close();
    },
  };
}

export async function boundarySale(
  f: ReleaseFixture,
  kind: ReviewKind,
  entry: {
    basis?: "amount" | "quantity";
    value?: string;
    medium?: "vehicle" | "cylinder";
  } = {},
) {
  const sale = await heldSale(
    f,
    [kind],
    entry.value ?? "2000000",
    kind === "card" ? "ambiguous" : "before",
    undefined,
    f.browserBased,
    entry.basis ?? "amount",
    entry.medium ?? "vehicle",
  );
  if (kind === "date") {
    await historical(
      f.db,
      "capture_context",
      "UPDATE capture_context SET signed_in_at='2026-11-10T22:30:00Z',offline_expires_at='2026-11-11T22:30:00Z' WHERE id=$1",
      [sale.original.captureContextId],
    );
    await historical(
      f.db,
      "purchase",
      "UPDATE purchase SET server_received_at='2026-11-10T23:30:00Z',capture_lower_bound='2026-11-10T22:30:00Z',app_captured_at='2026-11-10T22:30:00Z' WHERE id=$1",
      [sale.id],
    );
  }
  if (kind === "capture") {
    await historical(
      f.db,
      "assignment",
      "UPDATE assignment SET effective_until='2026-11-10T12:30:00Z' WHERE id=$1",
      [sale.original.assignmentId],
    );
  }
  if (kind === "price") {
    const original = (
      await f.db.query("SELECT * FROM product_price_version WHERE id=$1", [
        sale.original.priceVersionId,
      ])
    ).rows[0];
    const price = v7();
    const version = (
      await f.db.query(
        "SELECT max(version)::int+1 n FROM product_price_version WHERE product_id=$1",
        [original.product_id],
      )
    ).rows[0].n;
    const rate = (BigInt(original.rate_kobo) + 10000n).toString();
    const at = `2026-11-10T12:${String(30 + (version - 2) * 5).padStart(2, "0")}:00Z`;
    await f.db.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,$4,$6,'NGN',2,$7,$5,'Fictional browser rate boundary')",
      [price, seedId(8), original.product_id, version, f.adminId, rate, at],
    );
    await f.db.query(
      "INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,before,after,reason,occurred_at) VALUES($1,$2,'user','price_activated','product',$3,'{}',$4,'Fictional browser boundary',$5)",
      [
        v7(),
        f.userId,
        original.product_id,
        {
          priceVersionId: price,
          version,
          rateKobo: rate,
          quantityPrecision: 2,
        },
        at,
      ],
    );
  }
  if (kind === "capture") {
    // The retained sale belongs to an ended historical assignment. M2 P-10/P-21
    // requires a separate current assignment and fresh sign-in for live reads.
    // Never reopen that historical interval or rebind the original capture context.
    const retained = async () =>
      (
        await f.db.query(
          `SELECT p.version,p.current_revision_id,p.capture_context_id,p.assignment_id,p.pump_id,
             p.capture_lower_bound::text,p.server_received_at::text,p.app_captured_at::text,
             (SELECT id FROM purchase_revision WHERE purchase_id=p.id AND revision_number=1) original_revision_id,
             a.effective_from::text,a.effective_until::text,
             c.signed_in_at::text,c.offline_expires_at::text,c.revoked_at::text
           FROM purchase p JOIN assignment a ON a.id=p.assignment_id
           JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1`,
          [sale.id],
        )
      ).rows[0];
    const before = await retained();
    expect(before.assignment_id).toBe(sale.original.assignmentId);
    expect(new Date(before.effective_until).toISOString()).toBe(
      "2026-11-10T12:30:00.000Z",
    );
    expect(
      (await f.phone.request.get(`/api/attendant/sales/${sale.id}`)).status(),
    ).toBe(401);
    const attendant = await api<Attendant>(
      f.adminRequest,
      `attendants/${f.attendant.id}`,
    );
    expect(attendant.assignment).toBeNull();
    const pump = await api<{ version: number }>(
      f.adminRequest,
      `pumps/${before.pump_id}`,
    );
    const assigned = await api<{ attendant: Attendant }>(
      f.adminRequest,
      `attendants/${f.attendant.id}/assignment`,
      {
        operationId: v7(),
        expectedVersion: attendant.version,
        expectedAssignmentId: null,
        pumpId: before.pump_id,
        expectedPumpVersion: pump.version,
        reason: "Fictional current assignment after the retained capture",
      },
    );
    expect(assigned.attendant.accountId).toBe(f.attendant.accountId);
    expect(assigned.attendant.assignment!.id).not.toBe(before.assignment_id);
    const signed = await f.phone.request.post("/api/attendant/sign-in", {
      headers: { Origin: origin, "Idempotency-Key": v7() },
      data: { username: f.username, password: f.password, deviceId: v7() },
    });
    expect(signed.status()).toBe(200);
    const session = (await signed.json()).data as AttendantSession;
    expect(session.account.id).toBe(f.attendant.id);
    expect(session.assignment.id).toBe(assigned.attendant.assignment!.id);
    expect(session.captureContextId).not.toBe(before.capture_context_id);
    expect(session.reassignmentRequiresSignIn).toBe(false);
    expect(
      Date.parse(assigned.attendant.assignment!.effectiveFrom),
    ).toBeGreaterThan(Date.parse(before.effective_until));
    const currentContext = (
      await f.db.query(
        `SELECT a.user_id,c.assignment_id FROM capture_context c
         JOIN attendant a ON a.id=c.attendant_id WHERE c.id=$1`,
        [session.captureContextId],
      )
    ).rows[0];
    expect(currentContext.user_id).toBe(f.attendant.accountId);
    expect(currentContext.assignment_id).toBe(session.assignment.id);
    expect(await retained()).toEqual(before);
    const own = await data<{ id: string }>(
      f.phone.request,
      `/api/attendant/sales/${sale.id}`,
    );
    expect(own.id).toBe(sale.id);
    const history = await data<{ items: { id: string }[] }>(
      f.phone.request,
      `/api/attendant/sales/${sale.id}/history?kind=revisions`,
    );
    expect(history.items.map((revision) => revision.id)).toContain(
      before.original_revision_id,
    );
  }
  // Fixtures represent original held purchases, before any accepted revision or credit.
  // Keep the revision and pointer coherent: the next real purchase update checks both.
  await f.db.query("BEGIN");
  try {
    await f.db.query("ALTER TABLE purchase DISABLE TRIGGER USER");
    await f.db.query("ALTER TABLE purchase_revision DISABLE TRIGGER USER");
    await f.db.query(
      "UPDATE purchase_revision SET state='proposed' WHERE purchase_id=$1 AND state='accepted'",
      [sale.id],
    );
    await f.db.query(
      "UPDATE purchase SET current_revision_id=NULL WHERE id=$1",
      [sale.id],
    );
    await f.db.query("ALTER TABLE purchase_revision ENABLE TRIGGER USER");
    await f.db.query("ALTER TABLE purchase ENABLE TRIGGER USER");
    await f.db.query("COMMIT");
  } catch (error) {
    await f.db.query("ROLLBACK");
    throw error;
  }
  return sale;
}

export async function preparation(
  page: Pick<Page, "request">,
  id: string,
  kind: ReviewKind,
) {
  return data<Preparation>(
    page.request,
    `/api/admin/sales/${id}/release-preparation?kind=${kind}`,
  );
}
export async function sheetBytes(
  kind: "price" | "card" | "date" | "capture" = "card",
  outcome: "confirm" | "cancel" = "confirm",
  values = { amountKobo: "2000000", quantity: "20.00", rateKobo: "100000" },
  supportedLabel?: string,
  amountOnly = false,
) {
  const naira = (k: string) =>
    `${BigInt(k) / 100n}.${(BigInt(k) % 100n).toString().padStart(2, "0")}`;
  return sharp(
    Buffer.from(
      `<svg width="1000" height="550" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="550" fill="white"/><g fill="black" font-family="sans-serif" font-size="28"><text x="30" y="55">FICTIONAL SHIFT SHEET · entry 7</text><text x="30" y="120">${supportedLabel ?? (kind === "date" ? "11 Nov 2026 · 00:10–00:20" : "10 Nov 2026 · 13:10–13:20")} Africa/Lagos</text><text x="30" y="185">Amount NGN ${naira(values.amountKobo)}${amountOnly ? "" : ` · Quantity ${values.quantity} L`}</text><text x="30" y="250">${amountOnly ? "" : `Rate NGN ${naira(values.rateKobo)} per litre`}</text><text x="30" y="315">${outcome === "cancel" ? "ENTRY MARKED VOID · erroneous sale" : "Sale recorded · training fixture"}</text></g></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
}
export async function uploadSheet(
  page: Pick<Page, "request">,
  id: string,
  prep: Preparation,
  outcome: "confirm" | "cancel" = "confirm",
  observedCapture?: PaperCaptureRange,
) {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const minute = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const supportedLabel = observedCapture
    ? `${day.format(new Date(observedCapture.from))} · ${minute.format(new Date(observedCapture.from))}–${minute.format(new Date(observedCapture.through))}`
    : undefined;
  const bytes = await sheetBytes(
    prep.kind,
    outcome,
    prep.currentCandidate.values,
    supportedLabel,
  );
  const reservation = await data<{ uploadId: string; assetId: string }>(
    page.request,
    `/api/admin/sales/${id}/release-sheet-uploads`,
    {
      operationId: v7(),
      target: prep.target,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      contentType: "image/jpeg",
    },
    201,
  );
  const permission = await data<{ url: string }>(
    page.request,
    `/api/admin/sales/${id}/release-sheet-uploads/${reservation.uploadId}/upload-url`,
    {},
  );
  const url = new URL(permission.url);
  expect(url.hostname).toBe("127.0.0.1");
  url.protocol = "http:";
  expect(
    (
      await page.request.put(url.href, {
        headers: { "Content-Type": "image/jpeg" },
        data: bytes,
      })
    ).ok(),
  ).toBe(true);
  await data(
    page.request,
    `/api/admin/sales/${id}/release-sheet-uploads/${reservation.uploadId}/finalize`,
    { operationId: v7() },
  );
  return reservation;
}
export function proposalBody(
  prep: Preparation,
  sheetAssetId: string,
  outcome: "confirm" | "cancel" = "confirm",
  observedCapture?: PaperCaptureRange,
) {
  return {
    ...prep.guard,
    operationId: v7(),
    target: prep.target,
    meterAssetId: prep.meterAssetId,
    sheetAssetId,
    outcome,
    facts: {
      ...prep.originalContext,
      source: "shift_sheet",
      entryReference: "Shift A entry 7",
      recordedAmountKobo: prep.currentCandidate.values.amountKobo,
      recordedQuantity: prep.currentCandidate.values.quantity,
      recordedRateKobo: prep.original.rateKobo,
      observedCapture: observedCapture ?? {
        from:
          prep.kind === "date"
            ? "2026-11-10T23:10:00.000Z"
            : "2026-11-10T12:10:00.000Z",
        through:
          prep.kind === "date"
            ? "2026-11-10T23:20:59.999Z"
            : "2026-11-10T12:20:59.999Z",
        timezone: "Africa/Lagos",
      },
      finding: outcome === "confirm" ? "sale_recorded" : "entry_marked_void",
    },
    reason:
      outcome === "confirm"
        ? "The matching entry records this sale and supports the full copied time range"
        : "The matching entry is explicitly marked void because it records an erroneous sale",
  };
}
export async function post(
  request: APIRequestContext,
  path: string,
  body: unknown,
  status = 200,
) {
  const response = await request.post(path, {
    headers: { Origin: origin },
    data: body,
  });
  const json = await response.json();
  expect(response.status(), json.error?.code ?? "HTTP status").toBe(status);
  return json.data;
}
export async function installReleaseStorageBridge(page: Page) {
  await page.route(
    /\/api\/admin\/sales\/[^/]+\/(?:release-sheet-uploads\/[^/]+\/upload-url|release-proposals\/[^/]+\/photo-access|photo-access)$/,
    async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() !== 200) return route.fulfill({ response });
      const json = await response.json();
      const local = new URL(json.data.url);
      if (
        local.hostname !== "127.0.0.1" ||
        local.port !==
          new URL(
            process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
          ).port
      )
        throw new Error("Unexpected release fixture storage endpoint");
      local.protocol = "https:";
      json.data.url = local.href;
      await route.fulfill({ response, json });
    },
  );
  await page.route(
    `https://127.0.0.1:${new URL(process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000").port}/**`,
    async (route) => {
      const url = new URL(route.request().url());
      url.protocol = "http:";
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, PUT, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      if (!["GET", "PUT"].includes(route.request().method()))
        return route.abort("blockedbyclient");
      const response = await route.fetch({ url: url.href, maxRedirects: 0 });
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": origin,
        },
      });
    },
  );
}
