"use client";
import { usePathname } from "next/navigation";
import { AccessGate } from "../_components/runtime";
import { HistoryList, SaleView } from "./history-view";
export default function HistoryPage() {
  const path = usePathname().split("/").filter(Boolean);
  return (
    <AccessGate>
      {path[2] ? (
        <SaleView
          key={`${path[2]}:${path[3] ?? ""}`}
          saleId={path[2]}
          editing={path[3] === "correct"}
        />
      ) : (
        <HistoryList />
      )}
    </AccessGate>
  );
}
