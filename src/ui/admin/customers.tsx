"use client";
import Link from "next/link";
import {
  CustomerRecovery,
  CustomerChanges,
  ChangeReceipt,
  ManagerCases,
} from "./customer-recovery";
import { useSearchParams } from "next/navigation";
import type { AdminSession } from "@/client/admin-session";
import {
  customerProfileSchema,
  customerSaleSchema,
  customerSummarySchema,
} from "@/shared/contracts/customers-cards";
import { categories, titleCase } from "@/client/customer-admin-types";
import {
  formatAggregateNaira,
  formatAggregateQuantity,
} from "@/shared/aggregate-display";

import { adminTime } from "@/client/admin-display";
import {
  DataTable,
  KeyValueList,
  KPI,
  LoyaltyCard,
  Notice,
  StatusPill,
  TextField,
  Button,
} from "@/ui";
import { useRead } from "./station-common";
import {
  PageHead,
  Sheet,
  SelectField,
  Loading,
  PageControls,
  PageState,
  useCustomerPage,
  useMemory,
  productNames,
} from "./customers-common";
export function CustomerPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  const search = useSearchParams();
  const grants = session.permissions ?? [];
  const scoped = path[0] === "sales";
  const id = scoped ? search.get("customer") : path[1];
  if (!grants.includes("customers") || (scoped && !grants.includes("sales")))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow this section.
      </Notice>
    );
  if (scoped && !id)
    return (
      <Notice>Open a customer profile to view their purchase history.</Notice>
    );
  const mode = !scoped && id ? path[2] : undefined;
  if (mode && ["phone", "replace-card", "recovery"].includes(mode)) {
    if (!grants.includes("recovery"))
      return (
        <Notice tone="danger" role="alert">
          Your current permissions do not allow account changes.
        </Notice>
      );
    return (
      <div className="wr-customers-cards">
        <CustomerRecovery
          key={id + ":" + mode}
          id={id!}
          mode={mode as "phone" | "replace-card" | "recovery"}
        />
      </div>
    );
  }
  return (
    <div className="wr-customers-cards">
      {id ? (
        <CustomerDetail
          key={id + ":" + scoped}
          id={id}
          scoped={scoped}
          session={session}
        />
      ) : (
        <Customers />
      )}
    </div>
  );
}
function Customers() {
  const [filters, setFilters] = useMemory("search", {
    query: "",
    category: "",
  });
  const [draft, setDraft] = useMemory("search-draft", {
    query: "",
    category: "",
  });
  return (
    <>
      <PageHead
        title="Customers"
        eyebrow="Customers"
        subtitle="Customer accounts and loyalty cards"
      />
      <form
        className="wr-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft });
        }}
      >
        <TextField
          label="Find a customer"
          placeholder="Name, phone, card or customer ID"
          value={draft.query}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, query: e.target.value })}
        />
        <SelectField
          label="Customer category"
          required={false}
          value={draft.category}
          onChange={(category) => {
            setDraft({ ...draft, category });
            setFilters({ ...draft, category });
          }}
        >
          <option value="">All categories</option>
          {Object.entries(categories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <Button type="submit">Search</Button>
      </form>
      <CustomerResults key={JSON.stringify(filters)} filters={filters} />
    </>
  );
}
function CustomerResults({
  filters,
}: {
  filters: { query: string; category: string };
}) {
  const page = useCustomerPage(
    "customers/search",
    customerSummarySchema,
    {
      query: filters.query.trim() || undefined,
      category: filters.category || undefined,
    },
    true,
  );
  return (
    <>
      <PageState
        page={page}
        empty="No customers found. Try a different search or category."
      />
      <DataTable
        caption="Registered customers"
        summary={`${page.data?.items.length ?? 0} customers on this page · newest first`}
        columns={[
          { key: "customer", label: "Customer" },
          { key: "category", label: "Fixed category" },
          { key: "card", label: "Loyalty card" },
          { key: "spend", label: "Recorded spend", align: "right" },
          { key: "action", label: "" },
        ]}
        rows={(page.data?.items ?? []).map((c) => ({
          id: c.id,
          cells: {
            customer: (
              <>
                <b>{c.name}</b>
                <span className="wr-sub">{c.phoneMasked}</span>
              </>
            ),
            category: categories[c.category],
            card: c.activeCardCode ? (
              <>
                <b className="wr-mono">{c.activeCardCode}</b>
                <span className="wr-sub">
                  <StatusPill small tone="synced">
                    Active card
                  </StatusPill>
                </span>
              </>
            ) : (
              "No active card"
            ),
            spend: (
              <>
                <b>{formatAggregateNaira(c.recordedSpendKobo)}</b>
                <span className="wr-sub">
                  {c.completedPurchaseCount} purchases
                </span>
              </>
            ),
            action: <Link href={`/admin/customers/${c.id}`}>View</Link>,
          },
        }))}
      />
      <PageControls page={page} />
      <p className="wr-help">
        Spend includes completed purchases only. Pending uploads are shown
        separately in each profile. Phone numbers are masked; searching the
        visible suffix works.
      </p>
    </>
  );
}
function CustomerDetail({
  id,
  scoped,
  session,
}: {
  id: string;
  scoped: boolean;
  session: AdminSession;
}) {
  const result = useRead(
    `customers/${encodeURIComponent(id)}`,
    customerProfileSchema,
  );
  const c = result.data;
  const sales = session.permissions?.includes("sales");
  if (!c) return <Loading {...result} label="Loading customer…" />;
  return (
    <>
      <PageHead
        title={scoped ? "Sales" : c.name}
        eyebrow={scoped ? "Customers / Sales" : "Customers / Customer profile"}
        subtitle={
          scoped ? (
            "Purchase records and exceptions"
          ) : (
            <>
              <span className="wr-mono">{c.customerCode}</span> ·{" "}
              {categories[c.category]}
            </>
          )
        }
        back={{
          href: scoped ? `/admin/customers/${id}` : "/admin/customers",
          label: scoped ? "Back to customer" : "Back to customers",
        }}
      />
      <Loading {...result} label="Refreshing customer…" />
      {!scoped && <ChangeReceipt id={id} />}
      {scoped ? (
        <Notice>
          <b>
            Customer: {c.name} · {c.activeCardCode ?? "No active card"} ·{" "}
            {c.customerCode}
          </b>
          <p>
            All related customer purchases, including incomplete uploads and
            review exceptions. All dates.
          </p>
        </Notice>
      ) : (
        <>
          <div className="wr-cc-two">
            <Sheet
              title="Customer details"
              badge={<StatusPill small>Registered</StatusPill>}
            >
              <KeyValueList
                items={[
                  { label: "Customer name", value: c.name },
                  { label: "Customer ID", value: c.customerCode, mono: true },
                  { label: "Phone number", value: c.phoneMasked },
                  { label: "Fixed category", value: categories[c.category] },
                  { label: "Registered", value: adminTime(c.registeredAt) },
                  {
                    label: "Registered at",
                    value:
                      c.registeredAtStation?.name ?? "Unknown / not recorded",
                  },
                  {
                    label: "Registered by",
                    value: c.registeredBy?.name ?? "Unknown / not recorded",
                  },
                ]}
              />
              {session.permissions?.includes("recovery") && (
                <div className="wr-cc-actions">
                  <Link
                    className="wr-btn wr-btn-secondary"
                    href={`/admin/customers/${encodeURIComponent(id)}/phone`}
                  >
                    Update phone number
                  </Link>
                  <Link
                    className="wr-btn wr-btn-secondary"
                    href={`/admin/customers/${encodeURIComponent(id)}/replace-card`}
                  >
                    Replace lost card
                  </Link>
                </div>
              )}
            </Sheet>
            <Sheet title="Loyalty card">
              {c.activeCardCode ? (
                <LoyaltyCard
                  name={c.name}
                  code={c.activeCardCode}
                  category={categories[c.category]}
                  customerId={c.customerCode}
                  station={session.station?.name ?? ""}
                />
              ) : (
                <Notice>No active card is linked to this customer.</Notice>
              )}
              <p className="wr-help">
                The printed number and QR identify the same card. The customer
                ID stays the same when a card is replaced.
              </p>
            </Sheet>
          </div>
          <CustomerChanges id={id} />
          {(session.permissions?.includes("recovery") ||
            session.permissions?.includes("managerRecovery")) && (
            <ManagerCases id={id} />
          )}
          <div className="wr-cc-kpis">
            <KPI
              label="Recorded spend"
              value={formatAggregateNaira(c.recordedSpendKobo)}
              footnote="Completed, non-cancelled purchases"
            />
            <KPI
              label="Completed purchases"
              value={c.completedPurchaseCount}
              footnote={
                c.quantities
                  .map(
                    (q) =>
                      `${formatAggregateQuantity(q.quantity, q.unit)} · ${productNames[q.product]}`,
                  )
                  .join(" · ") || "No completed quantities"
              }
            />
            <KPI
              label="Pending"
              value={formatAggregateNaira(c.pending.amountKobo)}
              footnote={`${c.pending.count} uploads excluded until confirmed`}
            />
          </div>
        </>
      )}
      {sales ? (
        <>
          <PurchaseHistory key={id} id={id} scoped={scoped} />
          {!scoped && (
            <Link
              className="wr-btn wr-btn-secondary"
              href={`/admin/sales?customer=${encodeURIComponent(id)}`}
            >
              View customer sales
            </Link>
          )}
        </>
      ) : (
        <Notice>Sales access is required to view purchase history.</Notice>
      )}
      <p className="wr-help">
        Recorded spend is an operational total. Final giveaway eligibility is
        determined by campaign settings.
      </p>
    </>
  );
}
function PurchaseHistory({ id, scoped }: { id: string; scoped: boolean }) {
  const page = useCustomerPage(
    `customers/${encodeURIComponent(id)}/purchases`,
    customerSaleSchema,
  );
  return (
    <>
      <PageState page={page} empty="No purchases recorded for this customer." />
      <DataTable
        caption={scoped ? "Recorded purchases" : "Purchase history"}
        summary={`${page.data?.items.length ?? 0} records on this page · all dates`}
        columns={[
          { key: "sale", label: "Sale / capture time" },
          { key: "purchase", label: "Amount / quantity" },
          { key: "seller", label: "Attendant / pump" },
          { key: "status", label: "Status" },
        ]}
        rows={(page.data?.items ?? []).map((s) => ({
          id: s.id,
          cells: {
            sale: (
              <>
                <b className="wr-mono">{s.saleCode}</b>
                <span className="wr-sub">{adminTime(s.appCapturedAt)}</span>
              </>
            ),
            purchase: (
              <>
                <b>{formatAggregateNaira(s.amountKobo)}</b>
                <span className="wr-sub">
                  {formatAggregateQuantity(s.quantity, s.unit)} ·{" "}
                  {productNames[s.product]}
                </span>
              </>
            ),
            seller: (
              <>
                <b>{s.seller.name}</b>
                <span className="wr-sub">
                  {s.seller.username} · {s.pump.code}
                </span>
              </>
            ),
            status: (
              <>
                <StatusPill
                  small
                  tone={
                    s.credited
                      ? "synced"
                      : s.state === "cancelled"
                        ? "failed"
                        : ["received", "photo_pending", "finalizing"].includes(
                              s.state,
                            )
                          ? "pending"
                          : "held"
                  }
                >
                  {s.credited ? "Completed" : titleCase(s.state)}
                </StatusPill>
                {s.holds.map((h) => (
                  <span className="wr-sub" key={h.kind}>
                    {h.kind === "price"
                      ? "Awaiting price review"
                      : `${titleCase(h.kind)} review`}{" "}
                    · {h.reasonCode}
                  </span>
                ))}
                {s.duplicateFlag && (
                  <span className="wr-sub">Possible duplicate</span>
                )}
                {s.correctionPending && (
                  <span className="wr-sub">Correction pending</span>
                )}
                {!s.credited && <span className="wr-sub">Not credited</span>}
              </>
            ),
          },
        }))}
      />
      <PageControls page={page} />
    </>
  );
}
