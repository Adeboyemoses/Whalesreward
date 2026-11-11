"use client";
import { useParams } from "next/navigation";
import { AccessGate } from "../../../_components/runtime";
import { SaleView } from "../../history-view";
export default function SaleCorrectionPage() {
  const { saleId } = useParams<{ saleId: string }>();
  return (
    <AccessGate>
      <SaleView key={saleId} saleId={saleId} editing />
    </AccessGate>
  );
}
