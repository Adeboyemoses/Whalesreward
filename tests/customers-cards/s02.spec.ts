import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { fixture } from "../admin-access/admin-access.fixtures";
import { ensureLocalCardBucket } from "./storage";
import {
  CustomerAdminApi,
  freezeCustomerChange,
  pageOf,
  customerFile,
} from "../../src/client/customer-admin-api";
import {
  batchSchema,
  cardExportSchema,
} from "../../src/shared/contracts/customers-cards";

for (const [format, initialState] of (["pdf", "xlsx"] as const).flatMap(
  (format) =>
    (["generated", "printed", "active"] as const).map(
      (state) => [format, state] as const,
    ),
)) {
  test(`I-20 s02 ${format} ${initialState} production prepare poll download and same-operation replay verify at every boundary`, async ({
    request,
  }) => {
    await ensureLocalCardBucket();
    const f = await fixture();
    const originalFetch = globalThis.fetch;
    try {
      await f.db.query(
        "UPDATE auth_user SET must_change_password=false WHERE id=$1",
        [f.userId],
      );
      const login = await request.post("/api/admin/sign-in", {
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Idempotency-Key": v7(),
          "x-test-ip": `2001:db8::${format === "pdf" ? "a" : "b"}`,
        },
        data: { username: f.username, password: f.password },
      });
      expect(login.status(), "fictional local login").toBe(200);
      // Bridge transport only: run the unchanged browser client decoders against
      // actual production HTTP bytes, preserving the real envelope and MIME.
      globalThis.fetch = async (input, init) => {
        const path = String(input);
        if (!path.startsWith("/api/admin/"))
          throw new Error("Local admin transport only");
        const headers = Object.fromEntries(
          new Headers(init?.headers).entries(),
        );
        const result = await request.fetch(path, {
          method: init?.method ?? "GET",
          headers: { ...headers, Origin: "http://127.0.0.1:3000" },
          ...(typeof init?.body === "string" ? { data: init.body } : {}),
        });
        expect(
          result.status(),
          `${format} ${init?.method ?? "GET"} boundary`,
        ).toBeGreaterThanOrEqual(200);
        expect(
          result.status(),
          `${format} ${init?.method ?? "GET"} boundary`,
        ).toBeLessThan(300);
        return new Response(new Uint8Array(await result.body()), {
          status: result.status(),
          headers: {
            "Content-Type": result.headers()["content-type"] ?? "",
            "Cache-Control": result.headers()["cache-control"] ?? "",
          },
        });
      };
      const client = new CustomerAdminApi();
      let batch = await client.commit(
        freezeCustomerChange("card-batches", {
          name: "Fictional s02 export stock",
          count: 10,
        }),
        batchSchema,
      );
      for (const action of initialState === "active"
        ? ["mark-printed", "activate"]
        : initialState === "printed"
          ? ["mark-printed"]
          : [])
        batch = await client.commit(
          freezeCustomerChange(`card-batches/${batch.id}/${action}`, {
            expectedVersion: batch.version,
            reason: "Fictional local s02 lifecycle review",
          }),
          batchSchema,
        );
      const original = (
        await f.db.query(
          "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
          [batch.id],
        )
      ).rows;
      const change = freezeCustomerChange(`card-batches/${batch.id}/exports`, {
        format,
        expectedVersion: batch.version,
      });
      const prepared = await client.commit(change, cardExportSchema);
      expect(prepared).toMatchObject({
        batchId: batch.id,
        format,
        batchVersion: batch.version,
      });
      expect(
        (await client.commit(change, cardExportSchema)).id,
        "prepare replay before polling",
      ).toBe(prepared.id);
      await expect
        .poll(
          async () =>
            (
              await client.read(
                `card-batches/${batch.id}/exports/${prepared.id}`,
                cardExportSchema,
              )
            ).state,
          { timeout: 30_000 },
        )
        .toBe("ready");
      const ready = await client.read(
        `card-batches/${batch.id}/exports/${prepared.id}`,
        cardExportSchema,
      );
      expect(ready).toMatchObject({
        batchId: batch.id,
        format,
        batchVersion: batch.version,
        state: "ready",
      });
      expect(
        (await client.commit(change, cardExportSchema)).id,
        "prepare replay after readiness",
      ).toBe(prepared.id);
      const listed = await client.read(
        `card-batches/${batch.id}/exports?limit=25`,
        pageOf(cardExportSchema),
      );
      expect(listed.items.some((item) => item.id === prepared.id)).toBe(true);
      let current = batch;
      if (batch.status !== "active") {
        const action =
          batch.status === "generated" ? "mark-printed" : "activate";
        current = await client.commit(
          freezeCustomerChange(`card-batches/${batch.id}/${action}`, {
            expectedVersion: batch.version,
            reason: "Fictional local s02 later lifecycle review",
          }),
          batchSchema,
        );
        const historical = await client.commit(change, cardExportSchema);
        expect(
          historical.id,
          "replay after lifecycle change retains immutable export",
        ).toBe(prepared.id);
        expect(historical.batchVersion).toBe(batch.version);
        expect(historical.batchStatus).toBe(batch.status);
      }
      const file = await customerFile(
        batch.id,
        prepared.id,
        format,
        () => true,
      );
      const bytes = Buffer.from(await file.arrayBuffer());
      if (format === "pdf") {
        expect(
          bytes.subarray(0, 5).toString(),
          "customerFile PDF signature",
        ).toBe("%PDF-");
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(
          1,
        );
      } else {
        expect(
          [...bytes.subarray(0, 4)],
          "customerFile XLSX signature",
        ).toEqual([80, 75, 3, 4]);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(bytes as never);
        const values = JSON.stringify(
          book.worksheets.map((sheet) => sheet.getSheetValues()),
        );
        for (const item of original) expect(values).toContain(item.code);
      }
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int n FROM card_export WHERE batch_id=$1",
            [batch.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await f.db.query(
            "SELECT status,version FROM card_batch WHERE id=$1",
            [batch.id],
          )
        ).rows,
      ).toEqual([{ status: current.status, version: current.version }]);
      expect(
        (
          await f.db.query(
            "SELECT code,qr_payload,state FROM card WHERE batch_id=$1 ORDER BY code",
            [batch.id],
          )
        ).rows,
      ).toEqual(original);
    } finally {
      globalThis.fetch = originalFetch;
      await f.db.end();
    }
  });
}
