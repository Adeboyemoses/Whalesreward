import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import { authId } from "../shared/contracts/auth";
import {
  campaignMatchesView,
  inventoryAuthority,
  checklistPolicyCopy,
} from "./admin-checklist-state";
import type { AdminSession } from "./admin-session";
import {
  checklistProjectionSchema,
  storedChecklistSchema,
  managerSelectionSchema,
  attendantSelectionSchema,
  phoneSelectionSchema,
  incompleteSelectionSchema,
  type projectionViewSchema,
} from "../shared/contracts/giveaway-projections";
import {
  managerSchema,
  censusSchema,
  phoneCheckSchema,
  exclusionSchema as proposalSchema,
  exclusionDecisionSchema,
} from "../shared/contracts/giveaway-phones";
import { campaignSchema, settingsSchema } from "../shared/contracts/settings";
import {
  censusMetaSchema,
  phoneSchema,
  exclusionSchema,
  pageSchema,
  phoneCheckReceiptSchema,
  phoneEntrySchema,
  censusReceiptSchema,
  managerReceiptSchema,
  exclusionReceiptSchema,
  checkReceiptSchema,
} from "./admin-checklist-schemas";
export type View = z.infer<typeof projectionViewSchema>;
export type Action = "manager" | "census" | "check" | "proposal" | "decision";
export type Pending = Readonly<{
  campaignId: string;
  action: Action;
  resourceId?: string;
  body: Readonly<Record<string, unknown>>;
}>;
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
const invalid = () => new AdminError("invalid_response", 200);
export class AdminChecklistApi {
  private chains = new Map<
    string,
    {
      result: unknown;
      cursor: string | undefined;
      view?: string;
      cursors: Set<string>;
      ids: Set<string>;
    }
  >();
  clearReads() {
    this.chains.clear();
  }
  constructor(private request: typeof adminRequest = adminRequest) {}
  private root(id: string) {
    return `giveaway/${authId.parse(id)}/reconciliation`;
  }
  private async read<T>(path: string, schema: z.ZodType<T>) {
    const p = schema.safeParse(await this.request<unknown>(path));
    if (!p.success) throw invalid();
    return p.data;
  }
  async campaign(settings = false) {
    if (settings) return (await this.read("settings", settingsSchema)).campaign;
    return (
      await this.read(
        "giveaway/campaign",
        z.strictObject({ campaign: campaignSchema.nullable() }),
      )
    ).campaign;
  }
  async checklist(id: string, expectedView?: string) {
    const r = await this.read(
      `${this.root(id)}/checklist${expectedView ? `?${new URLSearchParams({ expectedView })}` : ""}`,
      checklistProjectionSchema,
    );
    if (
      r.readiness.campaign.id !== id ||
      r.view.asOf !== r.readiness.asOf ||
      JSON.stringify(r.view.guard) !==
        JSON.stringify({
          expectedVersion: r.readiness.campaign.version,
          expectedSettingsVersionId: r.readiness.campaign.settingsVersionId,
          expectedDataVersion: r.readiness.campaign.dataVersion,
          expectedPreviousSnapshotId: r.readiness.campaign.latestSnapshotId,
        }) ||
      (expectedView && r.view.viewToken !== expectedView)
    )
      throw invalid();
    return r;
  }
  async stored(id: string, resultId: string) {
    const r = await this.read(
      `${this.root(id)}/results/${authId.parse(resultId)}`,
      storedChecklistSchema,
    );
    if (r.id !== resultId || r.campaignId !== id) throw invalid();
    return r;
  }
  private async all<
    S extends z.ZodType<{
      view: View;
      items: unknown[];
      nextCursor: string | null;
    }>,
  >(
    id: string,
    path: string,
    schema: S,
    key: (item: z.infer<S>["items"][number]) => string,
    expectedView?: string,
  ): Promise<z.infer<S>> {
    const chainKey = `${id}:${path}:${expectedView ?? ""}`;
    const saved = this.chains.get(chainKey);
    let result = saved?.result as z.infer<S> | undefined;
    let cursor = saved?.cursor;
    expectedView = saved?.view ?? expectedView;
    const cursors = saved?.cursors ?? new Set<string>();
    const ids = saved?.ids ?? new Set<string>();
    try {
      do {
        const q = new URLSearchParams({
          limit: "25",
          ...(expectedView ? { expectedView } : {}),
          ...(cursor ? { cursor } : {}),
        });
        const page = (await this.read(
          `${this.root(id)}/${path}?${q}`,
          schema,
        )) as z.infer<S>;
        if (expectedView && page.view.viewToken !== expectedView)
          throw new AdminError("read_view_stale", 409);
        if (
          result &&
          JSON.stringify({ ...result.view, asOf: "" }) !==
            JSON.stringify({ ...page.view, asOf: "" })
        )
          throw new AdminError("read_view_stale", 409);
        expectedView ??= page.view.viewToken;
        for (const row of page.items) {
          const k = key(row);
          if (ids.has(k)) throw invalid();
          ids.add(k);
        }
        if (result)
          result = {
            ...result,
            items: [...result.items, ...page.items],
            nextCursor: page.nextCursor,
          };
        else result = page;
        if (page.nextCursor && cursors.has(page.nextCursor)) throw invalid();
        if (page.nextCursor) cursors.add(page.nextCursor);
        cursor = page.nextCursor ?? undefined;
        this.chains.set(chainKey, {
          result,
          cursor,
          view: expectedView,
          cursors,
          ids,
        });
      } while (cursor);
      this.chains.delete(chainKey);
      return result!;
    } catch (e) {
      if (!readTransient(e)) this.chains.delete(chainKey);
      throw e;
    }
  }
  async managers(id: string, view?: string) {
    const r = await this.all(
      id,
      "selection/managers",
      managerSelectionSchema,
      (x) => x.adminId,
      view,
    );
    if (r.items.some((x) => !x.eligibleFor.includes(r.view.kind)))
      throw invalid();
    return r;
  }
  attendants(id: string, view?: string) {
    return this.all(
      id,
      "selection/attendants",
      attendantSelectionSchema,
      (x) => x.attendantId,
      view,
    );
  }
  phones(id: string, view?: string) {
    return this.all(
      id,
      "selection/phones",
      phoneSelectionSchema,
      (x) => x.id,
      view,
    );
  }
  sources(id: string, phoneId: string, view?: string) {
    return this.all(
      id,
      `selection/phones/${authId.parse(phoneId)}/incomplete-sources`,
      incompleteSelectionSchema,
      (x) => x.purchaseId,
      view,
    );
  }
  async managerContext(
    id: string,
    expectedView?: string,
    authorityOnly = false,
  ) {
    const campaign = await this.campaign(true);
    if (!campaign || campaign.id !== id) throw new AdminError("not_found", 404);
    const choices = authorityOnly
      ? await this.read(
          `${this.root(id)}/selection/managers?${new URLSearchParams({ limit: "1", ...(expectedView ? { expectedView } : {}) })}`,
          managerSelectionSchema,
        )
      : await this.managers(id, expectedView);
    if (!campaignMatchesView(campaign, choices.view.guard))
      throw new AdminError("read_view_stale", 409);
    return { campaign, choices };
  }
  /** Revalidates scoped read authority without sending a guessed mutation. */
  async authorize(
    p: Pending,
    view: View | undefined,
    session: AdminSession,
    replay = false,
  ) {
    if (p.action === "manager") {
      if (
        !session.role?.isOwner ||
        !session.permissions?.includes("settings") ||
        !session.permissions?.includes("sales")
      )
        throw new AdminError("owner_required", 403);
      if (replay) return;
      const context = await this.managerContext(
        p.campaignId,
        replay ? undefined : view?.viewToken,
        true,
      );
      if (
        !replay &&
        context.choices.view.guard.expectedVersion !== p.body.expectedVersion
      )
        throw new AdminError("read_view_stale", 409);
      return;
    }
    if (
      ![
        "sales",
        "leaderboards",
        p.body.kind === "revision" ? "giveawayRevise" : "giveawayFinalize",
      ].every((g) => session.permissions?.includes(g as never)) &&
      p.action !== "decision"
    )
      throw new AdminError("scope_lost", 403);
    if (p.action === "decision") {
      const e = await this.exclusion(p.campaignId, p.resourceId!);
      if (
        !session.permissions?.includes(
          e.kind === "revision" ? "giveawayRevise" : "giveawayFinalize",
        )
      )
        throw new AdminError("scope_lost", 403);
      const campaign =
        p.body.expectedCampaignVersion === undefined || replay
          ? null
          : await this.campaign();
      if (
        !replay &&
        (e.version !== p.body.expectedVersion ||
          e.state !== "pending" ||
          (p.body.expectedCampaignVersion !== undefined &&
            campaign?.version !== p.body.expectedCampaignVersion))
      )
        throw new AdminError("exclusion_stale", 409);
      return;
    }
    // An uncertain write is not a new discovery action. Its frozen kind can
    // remain authorized after a successor changes the current campaign kind.
    // No cached candidate review is shown while pending. The identical POST
    // still checks the original action grant and live manager/person authority
    // before returning a historical receipt; never rebase its request guard.
    if (replay) return;
    const current = await this.checklist(p.campaignId);
    if (
      !inventoryAuthority(session, {
        kind: current.view.kind,
        phoneCheck: current.readiness.phoneCheck,
        checks: current.checks,
      })
    )
      throw new AdminError("scope_lost", 403);
    // Initial confirmation validates canonical-person authority and the
    // originally reviewed discovery view before sending a new effect.
    await this.read(
      `${this.root(p.campaignId)}/selection/phones?${new URLSearchParams({ limit: "1", expectedView: view?.viewToken ?? current.view.viewToken })}`,
      phoneSelectionSchema,
    );
    if (!current.view.reconciliationPolicyVersion)
      throw new AdminError("reconciliation_policy_unconfigured", 409);
  }
  private async legacyPages<T>(
    key: string,
    fetchPage: (
      cursor?: string,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
    identity: (v: T) => string,
  ) {
    const saved = this.chains.get(key);
    const items = (saved?.result as T[] | undefined) ?? [];
    let cursor = saved?.cursor;
    const ids = saved?.ids ?? new Set<string>();
    const cursors = saved?.cursors ?? new Set<string>();
    try {
      do {
        const page = await fetchPage(cursor);
        for (const row of page.items) {
          const id = identity(row);
          if (ids.has(id)) throw invalid();
          ids.add(id);
        }
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw invalid();
        if (cursor) cursors.add(cursor);
        this.chains.set(key, { result: items, cursor, ids, cursors });
      } while (cursor);
      this.chains.delete(key);
      return items;
    } catch (e) {
      if (!readTransient(e)) this.chains.delete(key);
      throw e;
    }
  }
  async inventory(id: string) {
    let census: z.infer<typeof censusMetaSchema> | undefined;
    const items = await this.legacyPages(
      `inventory:${id}`,
      async (cursor) => {
        const p = await this.read(
          `${this.root(id)}/phones?${new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) })}`,
          z.strictObject({
            census: censusMetaSchema,
            phones: pageSchema(phoneSchema),
          }),
        );
        if (p.census.campaignId !== id) throw invalid();
        if (census && JSON.stringify(census) !== JSON.stringify(p.census))
          throw new AdminError("read_view_stale", 409);
        census = p.census;
        return p.phones;
      },
      (x) => x.id,
    );
    return { census: census!, items };
  }
  exclusions(id: string) {
    return this.legacyPages(
      `exclusions:${id}`,
      async (cursor) => {
        const p = await this.read(
          `${this.root(id)}/exclusions?${new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) })}`,
          pageSchema(exclusionSchema),
        );
        if (p.items.some((x) => x.campaignId !== id)) throw invalid();
        return p;
      },
      (x) => x.id,
    );
  }
  async exclusion(id: string, eid: string) {
    const r = await this.read(
      `${this.root(id)}/exclusions/${authId.parse(eid)}`,
      exclusionSchema,
    );
    if (r.id !== eid || r.campaignId !== id) throw invalid();
    return r;
  }
  async checkEvidence(id: string, checkId: string) {
    const check = await this.read(
      `${this.root(id)}/phone-checks/${authId.parse(checkId)}`,
      phoneCheckReceiptSchema,
    );
    if (check.id !== checkId || check.campaignId !== id) throw invalid();
    const entries = await this.legacyPages(
      `entries:${id}:${checkId}`,
      (cursor) =>
        this.read(
          `${this.root(id)}/phone-checks/${checkId}/entries?${new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) })}`,
          pageSchema(phoneEntrySchema),
        ),
      (x) => x.phoneId,
    );
    return { check, entries };
  }
  freeze(
    id: string,
    action: Action,
    input: unknown,
    resourceId?: string,
  ): Pending {
    authId.parse(id);
    if (resourceId) authId.parse(resourceId);
    const schema = {
      manager: managerSchema,
      census: censusSchema,
      check: phoneCheckSchema,
      proposal: proposalSchema,
      decision: exclusionDecisionSchema,
    }[action];
    const parsed = schema.parse(input);
    if ("phones" in parsed) {
      if (
        new Set(parsed.phones.flatMap((p) => (p.id ? [p.id] : []))).size !==
          parsed.phones.filter((p) => p.id).length ||
        parsed.phones.some(
          (p) => new Set(p.attendantIds).size !== p.attendantIds.length,
        )
      )
        throw new AdminError("invalid_request", 400);
    }
    if (new TextEncoder().encode(JSON.stringify(parsed)).length > 32768)
      throw new AdminError("request_too_large", 413);
    return freeze({
      campaignId: id,
      action,
      ...(resourceId ? { resourceId } : {}),
      body: parsed,
    });
  }
  async send(p: Pending) {
    const suffix = {
      manager: "manager",
      census: "censuses",
      check: "phone-checks",
      proposal: `phones/${p.resourceId}/exclusions`,
      decision: `exclusions/${p.resourceId}/decision`,
    }[p.action];
    const raw = await this.request<unknown>(
      `${this.root(p.campaignId)}/${suffix}`,
      p.body,
      "POST",
      p.body.operationId as string,
    );
    const schemas = {
      manager: managerReceiptSchema,
      census: censusReceiptSchema,
      check: checkReceiptSchema,
      proposal: exclusionReceiptSchema,
      decision: exclusionReceiptSchema,
    };
    const parsed = schemas[p.action].safeParse(raw);
    if (!parsed.success) throw invalid();
    const r = parsed.data;
    if (r.campaign.id !== p.campaignId) throw invalid();
    const b = p.body;
    if (
      p.action !== "decision" &&
      r.campaign.version !== Number(b.expectedVersion) + 1
    )
      throw invalid();
    if ("census" in r) {
      const census = censusMetaSchema.parse(r.census);
      if (
        census.campaignId !== p.campaignId ||
        census.version !== Number(b.expectedCensusVersion) + 1
      )
        throw invalid();
    }
    if (
      "phoneCheck" in r &&
      (r.phoneCheck.campaignId !== p.campaignId ||
        r.phoneCheck.kind !== b.kind ||
        r.phoneCheck.censusVersion !== b.expectedCensusVersion ||
        r.phoneCheck.settingsVersionId !== b.expectedSettingsVersionId ||
        r.phoneCheck.previousSnapshotId !== b.expectedPreviousSnapshotId)
    )
      throw invalid();
    if ("exclusion" in r) {
      const e = r.exclusion;
      if (p.action === "decision") {
        if (
          e.version !== Number(b.expectedVersion) + 1 ||
          e.state !== (b.decision === "approve" ? "approved" : "rejected") ||
          e.decisionReason !== b.reason
        )
          throw invalid();
      } else if (p.action === "proposal") {
        if (
          e.version !== 1 ||
          e.state !== "pending" ||
          e.reason !== b.reason ||
          e.kind !== b.kind ||
          e.phoneVersion !== b.expectedPhoneVersion ||
          e.censusVersion !== b.expectedCensusVersion ||
          e.settingsVersionId !== b.expectedSettingsVersionId ||
          e.previousSnapshotId !== b.expectedPreviousSnapshotId ||
          JSON.stringify(
            e.partialSources.map((x) => ({
              purchaseId: x.purchaseId,
              expectedPurchaseVersion: x.purchaseVersion,
            })),
          ) !== JSON.stringify(b.partialSources)
        )
          throw invalid();
      }
    }
    if (
      "exclusion" in r &&
      (r.exclusion.campaignId !== p.campaignId ||
        (p.action === "proposal"
          ? r.exclusion.phoneId !== p.resourceId
          : r.exclusion.id !== p.resourceId))
    )
      throw invalid();
    return r;
  }
}
export const checklistOperation = adminOperationId;
export function checklistMessage(e: unknown) {
  const code = e instanceof AdminError ? e.code : "";
  const messages: Record<string, string> = {
    read_view_stale:
      "Records changed while this list was loading. Refresh the complete list before reviewing.",
    manager_invalid:
      "This admin cannot be designated for this campaign action. Refresh the admin details and choose an eligible manager.",
    census_incomplete:
      "The census or phone check is incomplete. Cover every required account and every listed phone.",
    exclusion_source_invalid:
      "A listed sale cannot be excluded. Review its current version, originating account and evidence.",
    exclusion_pending: "An unavailable-phone proposal is awaiting a decision.",
    phone_exclusion_pending:
      "An unavailable-phone proposal is awaiting a decision.",
    exclusion_stale:
      "This proposal no longer applies. Review the current phone census and submit a new proposal if needed.",
    phone_check_stale:
      "This review is out of date. Refresh the evidence and review again.",
    version_conflict:
      "This review is out of date. Refresh the evidence and review again.",
    snapshot_superseded:
      "This review is out of date. Refresh the evidence and review again.",
    independent_admin_required:
      "A different verified person with the required permissions must decide this proposal.",
    owner_required: "Your current permissions do not allow this action.",
    permission_denied: "Your current permissions do not allow this action.",
    request_too_large:
      "This evidence is too large to record in one request. Nothing has been certified by this attempt. Contact support.",
    not_found: "This record is unavailable.",
    operation_conflict:
      "This request ID was used for different content. Stop and reload the recorded result before making another change.",
    invalid_request:
      "Check every field and required reason. Do not include phone numbers or secrets.",
    invalid_response: "Finalization evidence could not be loaded. Retry.",
    scope_lost:
      "Your current manager or verified-person authority no longer permits this action. Read-only history remains available.",
    reconciliation_policy_unconfigured: checklistPolicyCopy,
    finalization_blocked:
      "Phone checks can be recorded only after the upload deadline and with configured checklist policy. Refresh the current evidence.",
  };
  return messages[code] ?? "Finalization evidence could not be loaded. Retry.";
}

export function readTransient(e: unknown) {
  return (
    e instanceof AdminError &&
    (e.status === 0 || e.status === 429 || e.status >= 500)
  );
}
