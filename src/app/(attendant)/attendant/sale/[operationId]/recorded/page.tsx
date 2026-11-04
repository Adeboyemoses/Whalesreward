"use client";
import { useParams } from "next/navigation";
import { AccessGate } from "../../../_components/runtime";
import { Receipt } from "../../../_components/receipt";
export default function RecordedPage() {
  const { operationId } = useParams<{ operationId: string }>();
  return (
    <AccessGate>
      <Receipt operationId={operationId} />
    </AccessGate>
  );
}
