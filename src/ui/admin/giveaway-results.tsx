"use client";
import { useCallback } from "react";
import Link from "next/link";
import type {
  Source,
  Snapshot,
  Preview,
} from "@/client/admin-giveaway-schemas";
import { categories, type Category } from "@/client/customer-admin-types";
import { reportMoney } from "@/client/admin-reports-api";
import { adminTime, adminAction } from "@/client/admin-display";
import { formatAggregateQuantity } from "@/shared/aggregate-display";
import { KeyValueList, Notice } from "@/ui";
import { Sheet } from "./station-common";
import {
  GiveawayReadState,
  Pager,
  RankingTable,
  TotalFacts,
  useGiveawayApi,
  useGiveawayRead,
  usePageCursor,
} from "./giveaway-common";
export function FrozenRanking({
  campaignId,
  collection,
  id,
  category,
}: {
  campaignId: string;
  collection: "previews" | "snapshots";
  id: string;
  category?: Category;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.rows(campaignId, collection, id, category, pages.cursor),
    [api, campaignId, collection, id, category, pages.cursor],
  );
  const result = useGiveawayRead(
    `rows:${id}:${category}:${pages.cursor}`,
    load,
  );
  return (
    <section>
      <GiveawayReadState {...result} />
      {result.data && (
        <>
          <RankingTable
            caption={
              collection === "previews"
                ? "Snapshot preview ranking · not saved"
                : "Final snapshot ranking"
            }
            rows={result.data.items}
          />
          {!result.data.items.length && (
            <Notice>No qualifying purchases in this category.</Notice>
          )}
          <Pager
            previous={pages.previous}
            next={!!result.data.nextCursor}
            busy={result.busy}
            onPrevious={pages.back}
            onNext={() => pages.next(result.data!.nextCursor)}
          />
        </>
      )}
    </section>
  );
}
export function ExcludedValues({
  exclusions,
}: {
  exclusions: Snapshot["exclusions"];
}) {
  return (
    <Sheet title="Excluded record values">
      <p className="wr-help">
        A record may have several exclusion reasons. These counts and values
        overlap and must not be added.
      </p>
      {!exclusions.length ? (
        <p>No excluded records reported.</p>
      ) : (
        <KeyValueList
          items={exclusions.map((e) => ({
            label: adminAction(e.reason),
            value: `${e.records} records · ${reportMoney(e.spend)}`,
          }))}
        />
      )}
    </Sheet>
  );
}
export function EvidenceFacts({ value }: { value: Snapshot | Preview }) {
  return (
    <KeyValueList
      items={[
        { label: "Campaign ID", value: value.campaignId, mono: true },
        {
          label: "Previous snapshot ID",
          value: value.previousSnapshotId ?? "None",
          mono: true,
        },
        {
          label: "Reconciliation ID",
          value: value.reconciliationId,
          mono: true,
        },
        { label: "Phone check ID", value: value.phoneCheckId, mono: true },
        {
          label: "Reconciliation policy",
          value: value.reconciliationPolicyVersion,
        },
        {
          label: "Source data version",
          value:
            "guard" in value
              ? value.guard.expectedDataVersion
              : value.sourceDataVersion,
          mono: true,
        },
        {
          label: "Settings version ID",
          value:
            ("guard" in value
              ? value.guard.expectedSettingsVersionId
              : value.settingsVersionId) ?? "Not configured",
          mono: true,
        },
        { label: "Tie rule", value: value.tieRule },
        ...("auditEventId" in value
          ? [{ label: "Audit event ID", value: value.auditEventId, mono: true }]
          : []),
      ]}
    />
  );
}
export function SnapshotSummary({ snapshot }: { snapshot: Snapshot }) {
  return (
    <>
      <p>
        {adminTime(snapshot.finalizedAt)} · {snapshot.actor.name} /{" "}
        <span className="wr-mono">{snapshot.actor.code}</span>
      </p>
      <p>
        <b>Reason:</b> {snapshot.reason}
      </p>
      <TotalFacts totals={snapshot.totals} customers={snapshot.customers} />
      <details>
        <summary>Saved evidence and lineage</summary>
        <EvidenceFacts value={snapshot} />
      </details>
    </>
  );
}
function SourceFacts({ source }: { source: Source | null }) {
  if (!source) return <p>Not present</p>;
  return (
    <KeyValueList
      items={[
        { label: "Purchase ID", value: source.purchaseId, mono: true },
        {
          label: "Accepted revision ID",
          value: source.revisionId ?? "None",
          mono: true,
        },
        { label: "Purchase version", value: String(source.purchaseVersion) },
        { label: "Included", value: source.included ? "Yes" : "No" },
        {
          label: "Exclusion reasons",
          value: source.reasons.map(adminAction).join(" · ") || "None",
        },
        {
          label: "Customer ID",
          value: source.customerId ?? "Unresolved",
          mono: true,
        },
        {
          label: "Fixed category",
          value: source.category ? categories[source.category] : "Unresolved",
        },
        {
          label: "Amount",
          value: reportMoney([
            { currency: source.currency, amountKobo: source.amountKobo },
          ]),
        },
        {
          label: "Quantity",
          value: formatAggregateQuantity(source.quantity, source.unit),
        },
        { label: "Values source", value: adminAction(source.valuesSource) },
        {
          label: "Photo asset ID",
          value: source.photoAssetId ?? "None",
          mono: true,
        },
        { label: "Details received", value: source.detailsReceivedAt },
        {
          label: "Complete-photo receipt",
          value: source.photoReceiptAt ?? "No trusted receipt reported",
        },
        {
          label: "Timing policy version",
          value: source.timingPolicyVersion ?? "Not configured",
        },
        {
          label: "Phone exclusion ID",
          value: source.phoneExclusionId ?? "None",
          mono: true,
        },
      ]}
    />
  );
}
export function SnapshotSources({
  campaignId,
  id,
}: {
  campaignId: string;
  id: string;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.sources(campaignId, id, pages.cursor),
    [api, campaignId, id, pages.cursor],
  );
  const result = useGiveawayRead(`sources:${id}:${pages.cursor}`, load);
  return (
    <Sheet title="Immutable snapshot sources">
      <GiveawayReadState {...result} />
      {result.data && (
        <>
          {result.data.items.map((s) => (
            <details key={s.purchaseId}>
              <summary>
                <span className="wr-mono">{s.purchaseId}</span> ·{" "}
                {s.included ? "Included" : "Excluded"}
              </summary>
              <SourceFacts source={s} />
            </details>
          ))}
          {!result.data.items.length && <p>No source records.</p>}
          <Pager
            previous={pages.previous}
            next={!!result.data.nextCursor}
            busy={result.busy}
            onPrevious={pages.back}
            onNext={() => pages.next(result.data!.nextCursor)}
          />
        </>
      )}
    </Sheet>
  );
}
export function CustomerChanges({
  campaignId,
  collection,
  id,
}: {
  campaignId: string;
  collection: "previews" | "snapshots";
  id: string;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.customerChanges(campaignId, collection, id, pages.cursor),
    [api, campaignId, collection, id, pages.cursor],
  );
  const result = useGiveawayRead(`customers:${id}:${pages.cursor}`, load);
  return (
    <Sheet title="Customer ranking changes">
      <GiveawayReadState {...result} />
      {result.data && (
        <>
          {result.data.items.map((c) => (
            <section className="wr-giveaway-change" key={c.customerId}>
              <p className="wr-mono">{c.customerId}</p>
              <div className="wr-two-col">
                {(["before", "after"] as const).map((side) => (
                  <div key={side}>
                    <h3>
                      {side === "before"
                        ? "Previous snapshot"
                        : "Reviewed result"}
                    </h3>
                    {c[side] ? (
                      <>
                        <p>
                          {c[side].name} ·{" "}
                          <span className="wr-mono">
                            {c[side].customerCode}
                          </span>
                        </p>
                        <p>
                          Rank {c[side].rank}
                          {c[side].sharedRank ? " · Shared rank" : ""} ·{" "}
                          {categories[c[side].category]}
                        </p>
                        <TotalFacts totals={c[side].totals} customers="1" />
                      </>
                    ) : (
                      <p>Not present</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!result.data.items.length && <p>No customer ranking changes.</p>}
          <Pager
            previous={pages.previous}
            next={!!result.data.nextCursor}
            busy={result.busy}
            onPrevious={pages.back}
            onNext={() => pages.next(result.data!.nextCursor)}
          />
        </>
      )}
    </Sheet>
  );
}
export function PurchaseChanges({
  campaignId,
  collection,
  id,
  audit,
}: {
  campaignId: string;
  collection: "previews" | "snapshots";
  id: string;
  audit: boolean;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.purchaseChanges(campaignId, collection, id, pages.cursor),
    [api, campaignId, collection, id, pages.cursor],
  );
  const result = useGiveawayRead(`purchases:${id}:${pages.cursor}`, load);
  return (
    <Sheet title="Purchase source changes">
      <GiveawayReadState {...result} />
      {result.data && (
        <>
          {result.data.items.map((c) => (
            <details className="wr-giveaway-change" key={c.purchaseId}>
              <summary className="wr-mono">{c.purchaseId}</summary>
              <div className="wr-two-col">
                <div>
                  <h3>Previous snapshot</h3>
                  <SourceFacts source={c.before} />
                </div>
                <div>
                  <h3>Reviewed result</h3>
                  <SourceFacts source={c.after} />
                </div>
              </div>
              <p>Recorded decision events:</p>
              {c.decisionEventIds.length ? (
                c.decisionEventIds.map((e) => (
                  <p className="wr-mono" key={e}>
                    {audit ? <Link href={`/admin/audit/${e}`}>{e}</Link> : e}
                  </p>
                ))
              ) : (
                <p>No decision events reported.</p>
              )}
            </details>
          ))}
          {!result.data.items.length && <p>No purchase source changes.</p>}
          <Pager
            previous={pages.previous}
            next={!!result.data.nextCursor}
            busy={result.busy}
            onPrevious={pages.back}
            onNext={() => pages.next(result.data!.nextCursor)}
          />
        </>
      )}
    </Sheet>
  );
}
