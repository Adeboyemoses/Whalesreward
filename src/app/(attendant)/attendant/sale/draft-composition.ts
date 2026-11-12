import type { CaptureDraft } from "@/client/offline/client";
/** One composition boundary, including overlapping input while its transaction is pending. */
export class DraftComposition {
  private draft: CaptureDraft | null = null;
  private pending: Promise<CaptureDraft | null> | null = null;
  private generation = 0;
  start(
    begin: () => Promise<CaptureDraft>,
    protect: () => void,
  ): Promise<CaptureDraft | null> {
    if (this.draft) return Promise.resolve(this.draft);
    if (this.pending) return this.pending;
    // Protect capture before the first asynchronous read (WHR-90).
    protect();
    const generation = this.generation;
    const pending = begin()
      .then((draft) => {
        if (generation !== this.generation) return null;
        this.draft = draft;
        return draft;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
  select(draft: CaptureDraft): void {
    if (this.draft?.operationId === draft.operationId) this.draft = draft;
  }
  discard(): void {
    this.generation++;
    this.draft = null;
    this.pending = null;
  }
}
