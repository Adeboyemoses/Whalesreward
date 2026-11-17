import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import { adminDetail, heldSale } from "../reviews/helpers";
import { data } from "../sales-history/helpers";
import type { OwnDetail } from "../sales-history/helpers";
import {
  releaseFixture,
  boundarySale,
  preparation,
  uploadSheet,
  proposalBody,
  post,
  type Proposal,
} from "../fixtures/held-release-browser";

test.use({ trace: "off", video: "off", screenshot: "off" });
for (const path of ["ordinary", "P-29"] as const) {
  test(`WHR-181 ${path} date resolution keeps original Values over real HTTP`, async ({
    request,
  }) => {
    test.setTimeout(120000);
    const page = { request } as Page;
    const f = await releaseFixture(page);
    try {
      const sale =
        path === "ordinary"
          ? await heldSale(f, ["date"], "2000000", "before", undefined, false)
          : await boundarySale(f, "date");
      const before = await adminDetail(page, sale.id);
      const originalRow = async () =>
        (
          await f.db.query(
            "SELECT to_jsonb(r)-ARRAY['state','version','decision_actor_id','decision_reason','decided_at'] value FROM purchase_revision r WHERE purchase_id=$1 AND kind='original'",
            [sale.id],
          )
        ).rows[0]!.value;
      const originalBefore = await originalRow();
      expect(before.original.verifiedSaleDate).toBeNull();
      const base = `/api/admin/sales/${sale.id}`;
      if (path === "ordinary") {
        const hold = before.holds.find(
          (h) => h.kind === "date" && h.state === "open",
        )!;
        const body = {
          operationId: v7(),
          expectedVersion: before.version,
          expectedRevisionId: before.currentRevisionId,
          expectedHoldVersion: hold.version,
          verifiedSaleDate: "2026-11-10",
          reason:
            "Retained photo and complete server history establish the sale day",
          evidence: {
            assetId: before.evidence.assetId,
            referenceIds: [],
            notes: "Inspected retained fictional meter photo",
          },
        };
        const first = await post(
          request,
          `${base}/holds/${hold.id}/date-decision`,
          body,
        );
        expect(
          await post(request, `${base}/holds/${hold.id}/date-decision`, body),
        ).toEqual(first);
        expect(first.after.verifiedSaleDate).toBe("2026-11-10");
      } else {
        const prep = await preparation(page, sale.id, "date");
        expect(prep.original).toEqual(before.original);
        const sheet = await uploadSheet(page, sale.id, prep);
        const proposal = (await post(
          request,
          `${base}/release-proposals`,
          proposalBody(prep, sheet.assetId),
          201,
        )) as Proposal;
        expect((await adminDetail(page, sale.id)).original).toEqual(
          before.original,
        );
        const current = await adminDetail(f.reviewer, sale.id);
        const body = {
          operationId: v7(),
          expectedVersion: current.version,
          expectedRevisionId: current.currentRevisionId,
          expectedProposalVersion: proposal.version,
          outcome: "approve",
          reason:
            "Independently checked the matching paper entry and retained photo",
        };
        const first = await post(
          f.reviewer.request,
          `${base}/release-proposals/${proposal.id}/decision`,
          body,
        );
        expect(
          await post(
            f.reviewer.request,
            `${base}/release-proposals/${proposal.id}/decision`,
            body,
          ),
        ).toEqual(first);
      }
      const after = await adminDetail(page, sale.id);
      expect(after.original).toEqual(before.original);
      expect(await originalRow()).toEqual(originalBefore);
      const verified = path === "ordinary" ? "2026-11-10" : "2026-11-11";
      expect(after.verifiedSaleDate).toBe(verified);
      expect(after.displayedValues.verifiedSaleDate).toBe(verified);
      expect(after.displayedSource).toBe("accepted_revision");
      expect(after.credited).toBe(true);
      const own = await data<OwnDetail>(
        f.phone.request,
        `/api/attendant/sales/${sale.id}`,
      );
      expect(own.original).toEqual(before.original);
      expect(own.verifiedSaleDate).toBe(verified);
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
            [sale.id],
          )
        ).rows[0]!.n,
      ).toBe(1);
    } finally {
      await f.close();
    }
  });
}
