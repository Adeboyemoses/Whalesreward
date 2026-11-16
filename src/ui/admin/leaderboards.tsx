"use client";
import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AdminSession } from "@/client/admin-session";
import { categorySchema } from "@/shared/contracts/customers-cards";
import type { Category } from "@/client/customer-admin-types";
import { adminTime } from "@/client/admin-display";
import { reportMoney } from "@/client/admin-reports-api";
import { Button, Notice } from "@/ui";
import { PageHead, SelectField, Sheet } from "./station-common";
import {
  CategoryField,
  GiveawayReadState,
  Pager,
  RankingTable,
  useGiveawayApi,
  useGiveawayRead,
  usePageCursor,
} from "./giveaway-common";
export function LeaderboardsPage({ session }: { session: AdminSession }) {
  const api = useGiveawayApi(),
    search = useSearchParams(),
    router = useRouter();
  const cat = categorySchema.safeParse(search.get("category")),
    category = cat.success ? cat.data : undefined;
  const basis =
    search.get("basis") === "recorded_all_time"
      ? "recorded_all_time"
      : "campaign_qualifying";
  const load = useCallback(() => api.campaign(), [api]);
  const result = useGiveawayRead("campaign", load);
  const change = (nextBasis: string, nextCategory?: Category) =>
    router.push(
      `/admin/leaderboards?${new URLSearchParams({ basis: nextBasis, ...(nextCategory ? { category: nextCategory } : {}) })}`,
    );
  if (!session.permissions?.includes("leaderboards"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow leaderboard access.
      </Notice>
    );
  return (
    <div className="wr-giveaway-page">
      <PageHead
        title="Leaderboards"
        eyebrow={session.station?.name ?? "Station"}
        subtitle="Customer rankings by total spend"
      />
      <GiveawayReadState {...result} />
      <div className="wr-giveaway-toolbar">
        <SelectField
          label="Ranking basis"
          value={basis}
          onChange={(v) => change(v, category)}
        >
          <option value="campaign_qualifying">Campaign qualifying spend</option>
          <option value="recorded_all_time">All-time recorded spend</option>
        </SelectField>
        <CategoryField value={category} onChange={(v) => change(basis, v)} />
      </div>
      {!result.busy &&
        !result.error &&
        (basis === "campaign_qualifying" && !result.data?.campaign ? (
          <Notice tone="warning">
            <b>Not configured.</b> Giveaway campaign values are not configured.
            No qualifying rankings are available.
          </Notice>
        ) : (
          <LiveRanking
            key={basis + ":" + category + ":" + result.data?.campaign?.id}
            basis={basis}
            campaignId={result.data?.campaign?.id}
            category={category}
            sales={!!session.permissions?.includes("sales")}
          />
        ))}
      <div className="wr-two-col">
        <Sheet title="What is counted">
          <p>
            {basis === "recorded_all_time"
              ? "Completed, non-cancelled recorded purchases across all time, separate from campaign qualification."
              : "Completed, non-cancelled purchases within the eligible period. No minimum purchase amount applies."}
          </p>
          <p>
            Possible duplicates remain counted until cancelled. Late corrections
            retain their recorded values until approved.
          </p>
        </Sheet>
        <Sheet title="Before announcing winners">
          <p>
            Reconcile eligible uploads against the configured upload deadline
            and resolve outstanding reviews.
          </p>
          <p>
            The client distributes prizes manually and decides any tied final
            winner slot.
          </p>
          {basis === "campaign_qualifying" && (
            <Link
              className="wr-btn wr-btn-secondary"
              href={`/admin/leaderboards/finalize${category ? `?category=${category}` : ""}`}
            >
              Finalize leaderboard
            </Link>
          )}
          {session.permissions?.includes("settings") && (
            <Link
              className="wr-btn wr-btn-ghost"
              href="/admin/settings/giveaway"
            >
              Set campaign values
            </Link>
          )}
        </Sheet>
      </div>
    </div>
  );
}
export function LiveRanking({
  basis = "campaign_qualifying",
  campaignId,
  category,
  sales = false,
  caption,
}: {
  basis?: "campaign_qualifying" | "recorded_all_time";
  campaignId?: string;
  category?: Category;
  sales?: boolean;
  caption?: string;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.rankings(basis, campaignId, category, pages.cursor),
    [api, basis, campaignId, category, pages.cursor],
  );
  const result = useGiveawayRead(
      `${basis}:${campaignId}:${category}:${pages.cursor}`,
      load,
    ),
    data = result.data;
  const refresh = () => {
    pages.reset();
    result.reload();
  };
  return (
    <section>
      <GiveawayReadState {...result} reload={refresh} />
      {data?.state === "unconfigured" ? (
        <Notice tone="warning">
          <b>Not configured.</b> Campaign values or timing policy are not
          configured. No qualifying rankings are available.
        </Notice>
      ) : (
        data && (
          <>
            <Notice>
              {basis === "recorded_all_time"
                ? "All-time recorded spend · not a giveaway result."
                : "Live qualifying rankings · provisional. Saved snapshots are viewed separately."}
            </Notice>
            <RankingTable
              caption={
                caption ??
                (category ? "Category spend ranking" : "Overall spend ranking")
              }
              summary={`${data.customers} customers · ${data.summary?.purchases ?? "0"} included purchases · ${data.summary ? reportMoney(data.summary.spend) : "Not configured"} · as of ${adminTime(data.asOf)}`}
              rows={data.items}
              sales={sales}
              category={category}
              basis={basis}
            />
            {data.items.length === 0 && (
              <Notice>
                {basis === "recorded_all_time"
                  ? "No recorded purchases in this category."
                  : "No qualifying purchases in this category."}
              </Notice>
            )}
            <Pager
              busy={result.busy}
              previous={pages.previous}
              next={!!data.nextCursor}
              onPrevious={pages.back}
              onNext={() => pages.next(data.nextCursor)}
            >
              <Button variant="ghost" onClick={refresh}>
                Refresh rankings
              </Button>
            </Pager>
          </>
        )
      )}
    </section>
  );
}
