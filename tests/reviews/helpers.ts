import { expect, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import type pg from "pg";
import { browserReviewPolicy } from "./policy";
import {
  acceptedSale,
  salesFixture,
  data,
  type AdminDetail,
} from "../sales-history/helpers";
import { seedId, attendantSignIn } from "../station/helpers";

export const saleDay = "2026-11-10";
export type ReviewKind = "price" | "card" | "date" | "capture";
export type Fixture = Awaited<ReturnType<typeof reviewFixture>>;

export async function reviewFixture(page: Page, browser: Browser) {
  const f = await salesFixture(page, browser);
  const p = browserReviewPolicy;
  await f.db.query("BEGIN");
  await f.db.query("SELECT pg_advisory_xact_lock(9171701)");
  await f.db.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,$7,'Fictional local browser approval') ON CONFLICT DO NOTHING",
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
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) SELECT $1,$2,$3,$4,$5,'Fictional local browser approval' WHERE NOT EXISTS(SELECT 1 FROM review_evidence_configuration WHERE id=$1)",
    [seedId(9171), p.scope.stationId, p.scope.environment, p.revision, p],
  );
  await f.db.query("COMMIT");
  const customerId = v7(),
    cardId = v7(),
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
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
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
    [cardId, seedId(28), code],
  );
  await f.db.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,'2026-11-01T00:00:00Z',$4,'Fictional review fixture')",
    [v7(), cardId, customerId, f.userId],
  );
  await f.db.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    cardId,
  ]);
  return { ...f, cardId, cardCode: code, customerId };
}

/** Historical fixtures only; decisions still traverse real HTTP, storage and transaction guards. */
async function historical(
  db: pg.Client,
  table: string,
  sql: string,
  args: unknown[],
) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid test table");
  await db.query("BEGIN");
  try {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await db.query(sql, args);
    await db.query("SET CONSTRAINTS ALL IMMEDIATE");
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
export async function heldSale(
  f: Fixture,
  kinds: ReviewKind[],
  value = "1000000",
  cardOutcome: "before" | "after" | "ambiguous" = "before",
) {
  const sale = await acceptedSale(f.phone, "amount", value, f.cardCode);
  const id = sale.detail.id;
  // Frozen original interval is wholly on 10 November; card-before uses late receipt
  // after the original expiry to establish U < E <= R without trusting the phone.
  const start = kinds.includes("card")
    ? "2026-11-09T13:00:00Z"
    : "2026-11-10T12:00:00Z";
  const expiry = kinds.includes("card")
    ? "2026-11-10T13:00:00Z"
    : "2026-11-11T12:00:00Z";
  const receipt = kinds.includes("card")
    ? "2026-11-10T15:00:00Z"
    : "2026-11-10T13:00:00Z";
  await historical(
    f.db,
    "capture_context",
    "UPDATE capture_context SET signed_in_at=$2,offline_expires_at=$3 WHERE id=$1",
    [sale.original.captureContextId, start, expiry],
  );
  await historical(
    f.db,
    "assignment",
    "UPDATE assignment SET effective_from='2026-11-08T00:00:00Z' WHERE id=$1",
    [sale.original.assignmentId],
  );
  await historical(
    f.db,
    "purchase",
    "UPDATE purchase SET server_received_at=$2,app_captured_at=$3,capture_lower_bound=$3,lookup_receipt_status='fallback',lookup_receipt_claims=NULL,status='held',version=version+1 WHERE id=$1",
    [id, receipt, start],
  );
  const price = (
    await f.db.query("SELECT * FROM product_price_version WHERE id=$1", [
      sale.original.priceVersionId,
    ])
  ).rows[0];
  // Complete historical rate provenance used by the actual evidence evaluator.
  await f.db.query(
    "INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,before,after,reason,occurred_at) SELECT $1,$2,'user','price_activated','product',$3,'{}',$4,'Fictional browser price provenance',$5 WHERE NOT EXISTS(SELECT 1 FROM audit_event WHERE action='price_activated' AND target_id=$3 AND after->>'priceVersionId'=$6)",
    [
      v7(),
      f.userId,
      price.product_id,
      {
        priceVersionId: price.id,
        version: price.version,
        rateKobo: String(price.rate_kobo),
        quantityPrecision: price.quantity_precision,
      },
      price.effective_from,
      price.id,
    ],
  );
  for (const kind of kinds) {
    if (kind === "capture") {
      for (const code of [
        "capture_authorization_unresolved",
        "capture_time_unresolved",
      ]) {
        await f.db.query(
          "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,'fictional browser fixture',clock_timestamp(),1)",
          [v7(), id, code],
        );
      }
    } else {
      await f.db.query(
        "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)",
        [
          v7(),
          id,
          kind,
          sale.detail.currentRevisionId,
          kind === "price"
            ? "price_uncertain"
            : kind === "card"
              ? "replaced_card"
              : "capture_date_uncertain",
        ],
      );
    }
  }
  if (kinds.includes("capture") || kinds.includes("date")) {
    const existing = await f.db.query(
      "SELECT id FROM settings_version WHERE station_id=$1",
      [seedId(8)],
    );
    if (!existing.rows.length) {
      const campaign = v7();
      await f.db.query(
        "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional browser campaign',1,false)",
        [campaign, seedId(8)],
      );
      await f.db.query(
        "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z','2026-12-02T00:00:00Z','Africa/Lagos','2026-11-01T00:00:00Z',$4,'Fictional browser campaign')",
        [v7(), seedId(8), campaign, seedId(5)],
      );
    }
  }
  if (kinds.includes("card")) {
    const next = v7();
    const code = Array.from(
      randomBytes(7),
      (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 31],
    ).join("");
    const at =
      cardOutcome === "before"
        ? "2026-11-10T14:00:00Z"
        : cardOutcome === "after"
          ? start
          : "2026-11-10T12:30:00Z";
    await f.db.query(
      "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
      [next, seedId(28), code],
    );
    await f.db.query(
      "UPDATE card_customer_link SET ended_at=$2 WHERE card_id=$1 AND ended_at IS NULL",
      [f.cardId, at],
    );
    await f.db.query(
      "UPDATE card SET state='retired',retired_at=$2,retirement_reason='replaced',replaced_by_card_id=$3,version=version+1 WHERE id=$1",
      [f.cardId, at, next],
    );
    await f.db.query(
      "INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,before,after,reason,occurred_at) VALUES($1,$2,'user','card_replaced','card',$3,'{}',$4,'Fictional historical card replacement',$5)",
      [
        v7(),
        f.userId,
        f.cardId,
        { customerId: f.customerId, replacementCardId: next },
        at,
      ],
    );
  }
  const detail = await data<AdminDetail>(
    f.phone.request,
    `/api/attendant/sales/${id}`,
  );
  expect(detail.credited).toBe(false);
  // A fresh sign-in gives the phone a current capture context; the held purchase
  // keeps its original historical context and interval unchanged.
  await attendantSignIn(f.phone, f.username, f.password);
  await expect(f.phone).toHaveURL(/\/attendant\/sale$/);
  return { ...sale, id };
}

export async function adminDetail(page: Page, id: string) {
  return data<AdminDetail>(page.request, `/api/admin/sales/${id}`);
}
export async function openReview(
  page: Page,
  id: string,
  kind: ReviewKind | "duplicate",
) {
  await page.goto(
    `/admin/sales/${id}/${kind === "duplicate" ? "duplicate" : kind + "-review"}`,
  );
  await expect(
    page.getByLabel("Decision reason", { exact: true }),
  ).toBeVisible();
}
export async function explain(page: Page) {
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill("Reviewed the retained original and server records");
  const notes = page.getByLabel(/Evidence notes/);
  if (await notes.count())
    await notes.fill(
      "Explanation of the review; server records establish the facts",
    );
  expect(
    await page.locator('input[type="file"],input[type="url"]').count(),
  ).toBe(0);
}
export async function confirm(page: Page, action: string, status = 200) {
  await page.getByRole("button", { name: action, exact: true }).click();
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/decision$|-decision$/.test(new URL(r.url()).pathname),
  );
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  const result = await response;
  const json = await result.json();
  expect(result.status(), JSON.stringify(json.error ?? {})).toBe(status);
  return json.data;
}
