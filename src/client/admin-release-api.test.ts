import { describe, expect, it, vi } from "vitest";
import { AdminReleaseApi, releaseUncertain } from "./admin-release-api";
import { AdminError, type adminRequest } from "./admin-api";
import type { AdminSaleDetail } from "./admin-sales-api";
import type { ReleaseProposal } from "./admin-release-api";
const id = (n: number) =>
  `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
describe("frozen release operations", () => {
  it("uses fresh accepted-pointer guard and proposal version for independent decision", () => {
    const api = new AdminReleaseApi();
    const sale = {
      id: id(1),
      version: 8,
      currentRevisionId: null,
    } as AdminSaleDetail;
    const proposal = {
      id: id(2),
      version: 3,
      guardAtProposal: { expectedVersion: 7, expectedRevisionId: id(9) },
    } as ReleaseProposal;
    const f = api.freezeDecision(
      id(10),
      sale,
      proposal,
      "reject",
      " Fresh independent reason ",
    );
    expect(f.path).toBe(`sales/${id(1)}/release-proposals/${id(2)}/decision`);
    expect(f.body).toMatchObject({
      expectedVersion: 8,
      expectedRevisionId: null,
      expectedProposalVersion: 3,
      outcome: "reject",
      reason: "Fresh independent reason",
    });
  });
  it("retains the original body key and actor after a malformed success or lost response", async () => {
    const transport = vi.fn().mockResolvedValue({ wrong: "shape" });
    const api = new AdminReleaseApi(transport as typeof adminRequest);
    const frozen = api.freezeRelease(id(10), id(1), "reserve", {
      target: { kind: "price", holdId: id(2), expectedHoldVersion: 1 },
      sha256: "a".repeat(64),
      bytes: 20,
      contentType: "image/jpeg",
    });
    await expect(api.reserve(frozen, id(10))).rejects.toMatchObject({
      code: "invalid_response",
    });
    transport.mockResolvedValue({ uploadId: id(5), assetId: id(6) });
    await expect(api.reserve(frozen, id(10))).resolves.toEqual({
      uploadId: id(5),
      assetId: id(6),
    });
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    await expect(api.reserve(frozen, id(11))).rejects.toMatchObject({
      code: "obsolete",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never accepts permissive or expired sheet access", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue({
        url: "javascript:alert(1)",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        assetId: id(6),
      });
    const api = new AdminReleaseApi(transport as typeof adminRequest);
    await expect(
      api.sheetAccess(id(1), {
        id: id(2),
        sheetAssetId: id(6),
      } as ReleaseProposal),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("keeps unknown parse failures transient and definitive stale separate", () => {
    expect(releaseUncertain(new SyntaxError())).toBe(true);
    expect(releaseUncertain(new AdminError("invalid_response", 200))).toBe(
      true,
    );
    expect(releaseUncertain(new AdminError("proposal_stale", 409))).toBe(false);
  });
});
