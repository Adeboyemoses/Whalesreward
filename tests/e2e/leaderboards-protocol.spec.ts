import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import { fixture } from "../admin-access/admin-access.fixtures";
import {
  api,
  guard,
  leaderboardRecords,
  type Preview,
  type Snapshot,
} from "../leaderboards/helpers";

/** Runs without launching a browser: verifies this suite's real HTTP setup even
 * when the host cannot launch Chromium. It does not substitute for UI checks. */
test("I-46 real HTTP setup prepares, confirms, replays and preserves the prior snapshot across an accepted-source revision", async ({
  request,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const identity = await fixture();
  await identity.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [identity.userId],
  );
  const login = await request.post("/api/admin/sign-in", {
    headers: { Origin: leaderboardStack.origin, "Idempotency-Key": v7() },
    data: { username: identity.username, password: identity.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const actor = { request, url: () => leaderboardStack.origin };
  const f = await leaderboardRecords(actor, identity);
  try {
    const sale = await f.sale({ amount: "1370001" });
    const c = await f.configure();
    await f.phoneCheck();
    const prepared = await api<Preview>(
      actor,
      `giveaway/${c.id}/previews`,
      {
        operationId: v7(),
        kind: "initial",
        reason: "Fictional HTTP initial result",
        ...guard(await f.campaign()),
      },
      201,
    );
    const confirmation = {
      operationId: v7(),
      previewId: prepared.id,
      contentDigest: prepared.contentDigest,
      ...prepared.guard,
    };
    const initial = await api<Snapshot>(
      actor,
      `giveaway/${c.id}/snapshots`,
      confirmation,
      201,
    );
    expect(initial.number).toBe(1);
    expect(
      await api(actor, `giveaway/${c.id}/snapshots`, confirmation),
    ).toEqual(initial);
    const stored = await api(
      actor,
      `giveaway/${c.id}/snapshots/${initial.id}/sources`,
    );
    await f.changeAmount(sale.id, "1470001");
    await f.phoneCheck("revision");
    const revisionPreview = await api<Preview>(
      actor,
      `giveaway/${c.id}/previews`,
      {
        operationId: v7(),
        kind: "revision",
        reason: "Fictional HTTP revised result",
        ...guard(await f.campaign()),
      },
      201,
    );
    const revised = await api<Snapshot>(
      actor,
      `giveaway/${c.id}/snapshots/${initial.id}/revisions`,
      {
        operationId: v7(),
        previewId: revisionPreview.id,
        contentDigest: revisionPreview.contentDigest,
        ...revisionPreview.guard,
      },
      201,
    );
    expect(revised).toMatchObject({
      number: 2,
      previousSnapshotId: initial.id,
    });
    expect(
      await api(actor, `giveaway/${c.id}/snapshots/${initial.id}/sources`),
    ).toEqual(stored);
    await f.phoneCheck("revision");
    const unchanged = await api(actor, `giveaway/${c.id}/previews`, {
      operationId: v7(),
      kind: "revision",
      reason: "Fictional HTTP unchanged result",
      ...guard(await f.campaign()),
    });
    expect(unchanged).toMatchObject({
      state: "unchanged",
      currentSnapshotId: revised.id,
    });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_snapshot WHERE campaign_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await f.close();
  }
});
