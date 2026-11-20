import { z } from "zod";
import { test, expect } from "../leaderboards/test";
import { checklistFixture, api } from "../checklist/helpers";
import { authId } from "../../src/shared/contracts/auth";

// P-30 PhoneExclusion response shape. Id fields retain the unchanged M1
// canonical UUIDv7 validator; this is a real HTTP response, never a fake API.
const exclusion = z.strictObject({
  id: authId,
  campaignId: authId,
  phoneId: authId,
  version: z.number().int().positive(),
  censusId: authId,
  censusVersion: z.number().int().positive(),
  phoneVersion: z.number().int().positive(),
  designationId: authId,
  settingsVersionId: authId,
  policyVersion: z.string(),
  previousSnapshotId: authId.nullable(),
  phoneLabel: z.string(),
  attendants: z.array(
    z.strictObject({
      id: authId,
      staffCode: z.string(),
      name: z.string(),
      username: z.string(),
    }),
  ),
  partialSources: z.array(z.unknown()).length(0),
  kind: z.enum(["initial", "revision"]),
  state: z.literal("superseded"),
  proposedBy: z.strictObject({
    id: authId,
    code: z.string(),
    name: z.string(),
  }),
  proposedAt: z.iso.datetime(),
  decidedBy: z.null(),
  decidedAt: z.null(),
  reason: z.string(),
  decisionReason: z.null(),
  auditEventId: authId,
});

test("WHR-217 real HTTP supersede returns canonical UUIDv7 detail and list while retaining original audit and exclusion links", async ({
  request,
  leaderboardStack,
}) => {
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const proposal = await f.propose(census.phones.items[0]!.id);
    const id = proposal.result.exclusion.id;
    const before = (
      await f.pool.query(
        "SELECT to_jsonb(e)::text body FROM giveaway_phone_exclusion e WHERE id=$1",
        [id],
      )
    ).rows[0].body;
    const proposalAudit = (
      await f.pool.query(
        "SELECT content->>'auditEventId' id FROM giveaway_phone_exclusion WHERE id=$1",
        [id],
      )
    ).rows[0].id;
    await f.census("Fictional replacement after unavailable proposal");
    const route = `giveaway/${f.campaignId}/reconciliation/exclusions`;
    const detail = exclusion.parse(await api(f.actor, `${route}/${id}`));
    const list = z
      .strictObject({
        items: z.array(exclusion),
        nextCursor: z.string().nullable(),
      })
      .parse(await api(f.actor, route));
    expect(detail.id).toBe(id);
    expect(list.items).toContainEqual(detail);
    expect(detail.auditEventId).not.toBe(proposalAudit);
    const transition = (
      await f.pool.query(
        "SELECT * FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 ORDER BY version DESC LIMIT 1",
        [id],
      )
    ).rows[0];
    expect(authId.parse(transition.id)).toBe(transition.id);
    expect(transition.content.auditEventId).toBe(detail.auditEventId);
    const event = (
      await f.pool.query("SELECT * FROM audit_event WHERE id=$1", [
        detail.auditEventId,
      ])
    ).rows[0];
    expect(event.action).toBe("giveaway_phone_unavailable_superseded");
    expect(event.related_event_ids).toContain(proposalAudit);
    expect(event.correlation_id).toBe(detail.auditEventId);
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(e)::text body FROM giveaway_phone_exclusion e WHERE id=$1",
          [id],
        )
      ).rows[0].body,
    ).toBe(before);
  } finally {
    await f.close();
  }
});
