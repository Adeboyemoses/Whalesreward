import { test, expect } from "@playwright/test";
import {
  salesFixture,
  acceptedSale,
  submitCorrection,
  data,
  noHistoryOrPhotoCache,
  type OwnDetail,
} from "../sales-history/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });
test("I-26 I-48 real sale/photo fixture and correction use actual accepted bytes and no-store M3 reads", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await salesFixture(page, browser);
  try {
    const sale = await acceptedSale(f.phone);
    expect(sale.detail.evidence.state).toBe("validated");
    expect(sale.detail.currentRevisionId).not.toBeNull();
    const stream = await f.phone.request.get(
      `/api/attendant/sales/${sale.detail.id}/photo`,
    );
    expect(stream.status()).toBe(200);
    expect(stream.headers()["content-type"]).toContain("image/jpeg");
    expect(stream.headers()["cache-control"]).toContain("no-store");
    expect((await stream.body()).length).toBeGreaterThan(100);
    const correction = await submitCorrection(f.phone, sale, "2200000");
    expect(correction.correction.state).toBe("accepted");
    const detail = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.detail.id}`,
    );
    expect(detail.displayedValues.amountKobo).toBe("2200000");
    expect(detail.original.amountKobo).toBe("2000000");
    const own = await f.phone.request.get("/api/attendant/sales");
    expect(own.headers()["cache-control"]).toContain("no-store");
    const access = await page.request.post(
      `/api/admin/sales/${sale.detail.id}/photo-access`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: { assetId: sale.photoId },
      },
    );
    expect(access.status()).toBe(200);
    expect(access.headers()["cache-control"]).toContain("no-store");
    const grant = (await access.json()).data;
    const image = await page.request.get(grant.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["cache-control"]).toContain("no-store");
    await noHistoryOrPhotoCache(f.phone);
  } finally {
    await f.close();
  }
});
