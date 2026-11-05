"use client";
import { useParams } from "next/navigation";
import { AccessGate } from "../../_components/runtime";
import { Receipt } from "../../_components/receipt";
export default function UploadDetailPage() {
  const { saleId } = useParams<{ saleId: string }>();
  return (
    <AccessGate>
      <Receipt operationId={saleId} uploadDetail />
    </AccessGate>
  );
}
