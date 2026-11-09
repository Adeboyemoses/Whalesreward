"use client";
import { DataTable } from "@/ui";
import { useAdminSession } from "./session";
import type { Attendant, Pump, StationPrice } from "@/client/station-types";
import { priceDisplay } from "@/client/station-api";
export function PreviousContext({
  kind,
}: {
  kind: "pumps" | "attendants" | "prices";
}) {
  const { store } = useAdminSession();
  let rows: { id: string; cells: Record<string, string> }[] = [];
  if (kind === "pumps") {
    const values = store.lists.get("station:data:all:pumps:") as
      Pump[] | undefined;
    rows = (values ?? []).map((x) => ({
      id: x.id,
      cells: { name: x.name, code: x.code, context: x.product.code },
    }));
  } else if (kind === "attendants") {
    const filters = store.lists.get("station:filters:attendants") as
      { query: string; pumpId: string } | undefined;
    const body = {
      ...(filters?.query ? { query: filters.query } : {}),
      ...(filters?.pumpId ? { pumpId: filters.pumpId } : {}),
    };
    const values = store.lists.get(
      "station:data:all:attendants/search:" + JSON.stringify(body),
    ) as Attendant[] | undefined;
    rows = (values ?? []).map((x) => ({
      id: x.id,
      cells: {
        name: x.name,
        code: x.staffCode,
        context: x.assignment?.pump.name ?? "Unassigned",
      },
    }));
  } else {
    const value = store.lists.get("station:data:read:prices") as
      { items: StationPrice[] } | undefined;
    rows = (value?.items ?? []).map((x) => ({
      id: x.product.id,
      cells: {
        name: x.product.code,
        code: x.price ? `Version ${x.price.version}` : "Not configured",
        context: x.price ? priceDisplay(x.price.rateKobo) : "Not configured",
      },
    }));
  }
  return rows.length ? (
    <section aria-label="Previous list context">
      <DataTable
        caption={
          kind === "pumps"
            ? "Registered pumps"
            : kind === "attendants"
              ? "Attendant accounts"
              : "Station selling prices"
        }
        columns={[
          { key: "name", label: kind === "prices" ? "Product" : "Name" },
          { key: "code", label: kind === "prices" ? "Version" : "ID" },
          { key: "context", label: kind === "prices" ? "Price" : "Assignment" },
        ]}
        rows={rows}
      />
    </section>
  ) : null;
}
