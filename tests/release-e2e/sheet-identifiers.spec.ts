import { test, expect, type Page } from "@playwright/test";
import { adminDetail } from "../reviews/helpers";
import { authId } from "../../src/shared/contracts/auth";
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
test("reservation identifiers survive real HTTP upload, finalize and proposal", async ({
  request,
}) => {
  test.setTimeout(120000);
  const page = { request } as Page;
  const fixture = await releaseFixture(page);
  try {
    const sale = await boundarySale(fixture, "card");
    const prep = await preparation(page, sale.id, "card");
    const sheet = await uploadSheet(page, sale.id, prep);
    expect(authId.safeParse(sheet.uploadId).success).toBe(true);
    expect(authId.safeParse(sheet.assetId).success).toBe(true);
    const stored = await fixture.db.query(
      "SELECT s.staging_key,v.final_key,v.display_key FROM held_release_sheet s JOIN held_release_sheet_validation v ON v.asset_id=s.id WHERE s.id=$1",
      [sheet.assetId],
    );
    for (const key of Object.values(stored.rows[0])) {
      expect(key).toMatch(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    const proposal = (await post(
      request,
      `/api/admin/sales/${sale.id}/release-proposals`,
      proposalBody(prep, sheet.assetId),
      201,
    )) as Proposal;
    expect(proposal.state).toBe("pending");
    expect(proposal.target).toEqual(prep.target);
    expect((await adminDetail(page, sale.id)).credited).toBe(false);
    const invalid = await request.post(
      `/api/admin/sales/${sale.id}/release-sheet-uploads/00000000-0000-4000-8000-000000000001/upload-url`,
      { headers: { Origin: "http://127.0.0.1:3000" }, data: {} },
    );
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_request");
  } finally {
    await fixture.close();
  }
});
