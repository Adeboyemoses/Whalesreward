import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { v7 } from "uuid";
import type pg from "pg";
import type { Session, OriginalSale, SaleStatus } from "../../src/client/types";
import { amountToQuantity, quantityToAmount } from "../../src/shared/quantity";
import {
  stationFixture,
  api,
  seedId,
  attendantSignIn,
} from "../station/helpers";
import { ensureLocalCardBucket } from "../customers-cards/storage";
import { installLocalStorageBridge } from "../fixtures/local-storage-bridge";
import type { z } from "zod";
import type {
  attendantSaleDetailSchema,
  saleDetailSchema,
  AttendantCorrection,
} from "../../src/shared/contracts/sales";

export type OwnDetail = z.infer<typeof attendantSaleDetailSchema>;
export type AdminDetail = z.infer<typeof saleDetailSchema>;
export const origin = "http://127.0.0.1:3000";

export async function data<T>(
  request: APIRequestContext,
  path: string,
  input?: unknown,
  status = 200,
): Promise<T> {
  const response =
    input === undefined
      ? await request.get(path)
      : await request.post(path, {
          headers: { Origin: origin },
          data: input,
        });
  expect(
    response.status(),
    `Local endpoint ${new URL(path, origin).pathname}`,
  ).toBe(status);
  return (await response.json()).data as T;
}

export async function salesFixture(
  adminPage: Page,
  browser: Browser,
  grants?: string[],
) {
  await ensureLocalCardBucket();
  const f = await stationFixture(adminPage, grants);
  const username = `sales.${v7().slice(-12)}`;
  const password = randomBytes(20).toString("hex");
  const attendant = await api<{ id: string; accountId: string }>(
    adminPage.request,
    "attendants",
    {
      operationId: v7(),
      name: "Grace Okon",
      username,
      password,
      pumpId: seedId(14),
      expectedPumpVersion: 1,
    },
    201,
  );
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [attendant.accountId],
  );
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ["camera"],
  });
  const suffix = v7().replaceAll("-", "").slice(-12).match(/.{4}/g)!.join(":");
  await context.setExtraHTTPHeaders({ "x-test-ip": `2001:db8::${suffix}` });
  // Independent fictional camera captures must not reuse identical evidence bytes.
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const captureId = crypto.randomUUID();
      const draw = () => {
        const drawing = canvas.getContext("2d")!;
        drawing.fillStyle = "white";
        drawing.fillRect(0, 0, 640, 480);
        drawing.fillStyle = "black";
        drawing.font = "30px sans-serif";
        drawing.fillText("Fictional meter 20.000 litres", 10, 120);
        drawing.font = "12px monospace";
        drawing.fillText(captureId, 10, 450);
      };
      draw();
      const timer = window.setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      stream
        .getVideoTracks()[0]!
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  const phone = await context.newPage();
  await installLocalStorageBridge(phone);
  await attendantSignIn(phone, username, password);
  await expect(phone).toHaveURL(/\/attendant\/sale$/);
  return {
    ...f,
    attendant,
    username,
    password,
    phone,
    context,
    async close() {
      await context.close();
      await f.db.end();
    },
  };
}

/** Actual HTTP acceptance and real private local object storage, with fictional meter bytes. */
export async function acceptedSale(
  phone: Pick<Page, "request">,
  basis: "amount" | "quantity" = "amount",
  value = "2000000",
  cardCode = "A7K3M9Q",
  medium: OriginalSale["medium"] = "vehicle",
) {
  const session = await data<Session>(phone.request, "/api/attendant/session");
  const lookupResponse = await phone.request.post(
    "/api/attendant/cards/lookup",
    {
      headers: { Origin: origin, "X-WR-Lookup-Receipt": "1" },
      data: { source: "code", code: cardCode },
    },
  );
  expect(lookupResponse.status()).toBe(200);
  const lookup = (await lookupResponse.json()).data;
  const photoFixtureId = v7();
  const bytes = await sharp(
    Buffer.from(
      `<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="#17344e"/><rect x="75" y="100" width="490" height="155" rx="12" fill="#e2e8dd"/><text x="320" y="155" text-anchor="middle" font-family="monospace" font-size="26" fill="#122230">FICTIONAL TEST METER</text><text x="320" y="220" text-anchor="middle" font-family="monospace" font-size="52" fill="#122230">20.000 L</text><text x="20" y="380" font-family="monospace" font-size="10" fill="#ffffff">${photoFixtureId}</text></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  const quantity =
    basis === "amount"
      ? amountToQuantity(
          BigInt(value),
          BigInt(session.price.rateKobo),
          session.price.quantityPrecision,
        )
      : value;
  const amount =
    basis === "amount"
      ? value
      : quantityToAmount(
          value,
          BigInt(session.price.rateKobo),
          session.price.quantityPrecision,
        ).toString();
  const original: OriginalSale = {
    operationId: v7(),
    captureContextId: session.captureContextId,
    assignmentId: session.assignment.id,
    cardCode,
    lookupReceipt: lookup.lookupReceipt,
    appCapturedAt: new Date().toISOString(),
    priceVersionId: session.price.priceVersionId,
    rateKobo: session.price.rateKobo,
    currency: "NGN",
    quantityPrecision: session.price.quantityPrecision,
    unit: session.product.unit,
    medium,
    entry:
      basis === "amount"
        ? { basis, enteredAmountKobo: value, amountKobo: amount, quantity }
        : { basis, enteredQuantity: value, amountKobo: amount, quantity },
    photo: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      mediaType: "image/jpeg",
    },
  };
  let status = await data<SaleStatus>(
    phone.request,
    "/api/sync/sales",
    original,
    201,
  );
  await expect
    .poll(async () => {
      status = await data<SaleStatus>(
        phone.request,
        `/api/sync/sales/by-operation/${original.operationId}`,
      );
      return status.state;
    })
    .toBe("photo_pending");
  const upload = await data<{
    uploadId: string;
    url: string;
    headers: Record<string, string>;
  }>(phone.request, `/api/sync/sales/${status.purchaseId}/upload-permission`, {
    operationId: v7(),
    ...original.photo,
  });
  const local = new URL(upload.url);
  expect(local.hostname).toBe("127.0.0.1");
  expect(local.port).toBe("9000");
  const sent = await phone.request.put(upload.url, {
    headers: upload.headers,
    data: bytes,
  });
  expect(sent.ok()).toBe(true);
  const finalize = {
    operationId: v7(),
    uploadId: upload.uploadId,
    expectedVersion: status.version,
  };
  await data<SaleStatus>(
    phone.request,
    `/api/sync/sales/${status.purchaseId}/finalize`,
    finalize,
  );
  await expect
    .poll(async () => {
      status = await data<SaleStatus>(
        phone.request,
        `/api/sync/sales/by-operation/${original.operationId}`,
      );
      return status.state;
    })
    .toBe("credited");
  const detail = await data<OwnDetail>(
    phone.request,
    `/api/attendant/sales/${status.purchaseId}`,
  );
  return { original, status, detail, photoId: upload.uploadId };
}

export async function submitCorrection(
  phone: Pick<Page, "request">,
  sale: Awaited<ReturnType<typeof acceptedSale>>,
  value = "2200000",
  late = false,
  db?: pg.Client,
) {
  const detail = await data<OwnDetail>(
    phone.request,
    `/api/attendant/sales/${sale.status.purchaseId}`,
  );
  const input = {
    operationId: v7(),
    expectedVersion: detail.version,
    basedOnRevisionId: detail.currentRevisionId,
    edit:
      detail.displayedValues.basis === "amount"
        ? { basis: "amount", enteredAmountKobo: value }
        : { basis: "quantity", enteredQuantity: value },
    evidenceAssetId: detail.evidence.assetId,
    reason: "Meter amount was entered incorrectly",
  };
  const trigger = `test_late_${v7().replaceAll("-", "")}`;
  if (late) {
    if (!db)
      throw new Error("Late receipt fixture requires its local connection");
    // Change only this operation's trusted insertion clock. Domain validation and audit remain real.
    await db.query(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id::text=TG_ARGV[0] THEN NEW.first_received_at=NEW.cutoff_at_receipt; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON correction_request FOR EACH ROW EXECUTE FUNCTION ${trigger}('${input.operationId}')`,
    );
  }
  try {
    await data<AttendantCorrection>(
      phone.request,
      `/api/attendant/sales/${detail.id}/corrections`,
      input,
      201,
    );
  } finally {
    if (late) {
      await db!.query(`DROP TRIGGER ${trigger} ON correction_request`);
      await db!.query(`DROP FUNCTION ${trigger}()`);
    }
  }
  let correction!: AttendantCorrection;
  await expect
    .poll(
      async () => {
        correction = await data<AttendantCorrection>(
          phone.request,
          `/api/attendant/sales/${detail.id}/corrections/by-operation/${input.operationId}`,
        );
        return correction.state;
      },
      { timeout: 30000 },
    )
    .toBe(late ? "awaiting_review" : "accepted");
  return { input, correction };
}

/** New fictional normal admin with only the explicitly named grants. */
export async function adminActor(db: pg.Client, grants: string[]) {
  const roleId = v7(),
    userId = v7(),
    adminId = v7(),
    username = `review.${v7().slice(-12)}`,
    password = randomBytes(20).toString("hex");
  await db.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
    [roleId, `Sales review ${roleId}`],
  );
  for (const grant of grants)
    await db.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
      [roleId, grant],
    );
  await db.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,false,now())",
    [userId, username],
  );
  await db.query(
    "INSERT INTO admin(id,user_id,admin_code,role_id,version) VALUES($1,$2,$3,$4,1)",
    [adminId, userId, `REVIEW-${adminId}`, roleId],
  );
  await db.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [v7(), userId, await hashPassword(password)],
  );
  return { roleId, userId, adminId, username, password };
}

/** Trusted seeded recovery provenance, preserving all DB binding/immutability guards. */
export async function recoveredProposal(
  db: pg.Client,
  sale: Awaited<ReturnType<typeof acceptedSale>>,
  executor: Awaited<ReturnType<typeof adminActor>>,
  authorizer: Awaited<ReturnType<typeof adminActor>>,
) {
  const correctionId = v7(),
    revisionId = v7(),
    operationId = v7();
  const session = (
    await db.query(
      "SELECT id FROM auth_session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [executor.userId],
    )
  ).rows[0];
  if (!session) throw new Error("Executor must have a live local session");
  await db.query("BEGIN");
  try {
    await db.query(
      `INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,version,authority_session_id,reserved_purchase_version,receipt)
VALUES($1,$2,$3,$4,'fictional trusted recovery','fictional trusted recovery',$5,$6,$7,clock_timestamp(),NULL,'p20-bounded-day-v1','unresolved','awaiting_review','Fictional recovered numeric proposal',$8,NULL,'unverified_recovery',$9,$10,ARRAY['correction_authorship_unverified'],1,$11,$6+1,'{}')`,
      [
        correctionId,
        sale.detail.id,
        sale.detail.seller.attendantId,
        operationId,
        sale.detail.currentRevisionId,
        sale.detail.version,
        revisionId,
        executor.userId,
        executor.adminId,
        authorizer.adminId,
        session.id,
      ],
    );
    await db.query(
      `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,rate_kobo,price_version_id,medium,evidence_asset_id,calculation_mode,correction_id)
SELECT $1,purchase_id,revision_number+1,$2,$3,'fictional trusted recovery',id,'admin_correction','proposed','Fictional recovered numeric proposal',clock_timestamp(),3000000,30,currency,unit,quantity_precision,basis,3000000,rate_kobo,price_version_id,medium,evidence_asset_id,'captured_rate',$4 FROM purchase_revision WHERE id=$5`,
      [
        revisionId,
        operationId,
        executor.userId,
        correctionId,
        sale.detail.currentRevisionId,
      ],
    );
    await db.query(
      "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
      [sale.detail.id, sale.detail.version],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  return { correctionId, operationId };
}

export async function noHistoryOrPhotoCache(page: Page) {
  const urls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(
    urls.filter((url) =>
      /\/api\/(?:attendant\/sales|admin)|\/final\//.test(url),
    ),
  ).toEqual([]);
}

export async function correctionRows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("whales-capture-v1");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    try {
      return await new Promise<
        import("../../src/client/offline/correction-types").CorrectionOutboxRow[]
      >((resolve, reject) => {
        const q = db
          .transaction("corrections")
          .objectStore("corrections")
          .getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    } finally {
      db.close();
    }
  });
}
