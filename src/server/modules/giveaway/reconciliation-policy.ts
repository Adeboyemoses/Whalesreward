import { createHash } from "node:crypto";
/** Versioned reviewed semantics; registration never binds a station or activates policy. */
export const RECONCILIATION_ARTIFACT = `reconciliation-v1
trusted server now strictly after purchase cutoff and upload deadline; zero grace included
current accepted revision; exact money; independent holds corrections duplicate flags and P29 proposals block
complete photo bytes sealed and durably observed before validation; exact bound fact; no backdating
named live manager with kind-specific grant and verified canonical person; complete physical phone census
unavailable phone exact proposal and independent canonical person; no accepted or complete-byte partial source
partial exclusion suppresses upload obligation only; unknown phone-only count remains absent
check pins source generation timing census designation policy predecessor; every writer invalidates previews
immutable numbered snapshots and audited revisions; replay before stale checks after current authority
`;
export const RECONCILIATION_DIGEST = createHash("sha256")
  .update(RECONCILIATION_ARTIFACT)
  .digest("hex");
