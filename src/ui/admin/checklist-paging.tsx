"use client";
import { useState } from "react";
import { evidenceWindow } from "@/client/admin-checklist-paging";
import { Button } from "@/ui";
export function useEvidencePage<T>(complete: readonly T[], key: string) {
  const [position, set] = useState({ key, page: 0 });
  const page = evidenceWindow(
    complete,
    position.key === key ? position.page : 0,
  );
  return {
    ...page,
    total: complete.length,
    back: () => set({ key, page: Math.max(0, page.page - 1) }),
    nextPage: () => set({ key, page: page.page + 1 }),
    last: (length: number) =>
      set({ key, page: Math.max(0, Math.ceil(length / 25) - 1) }),
  };
}
export function EvidencePager({
  pages,
  label,
  disabled = false,
}: {
  pages: {
    total: number;
    page: number;
    pages: number;
    previous: boolean;
    next: boolean;
    back: () => void;
    nextPage: () => void;
  };
  label: string;
  disabled?: boolean;
}) {
  if (pages.total <= 25) return null;
  return (
    <nav aria-label={label} className="wr-checklist-pages">
      <p>
        All {pages.total} records loaded. Page {pages.page + 1} of {pages.pages}
        . Complete reviews include every record.
      </p>
      <div className="wr-row wr-checklist-actions">
        <Button
          variant="secondary"
          disabled={disabled || !pages.previous}
          onClick={pages.back}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || !pages.next}
          onClick={pages.nextPage}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
