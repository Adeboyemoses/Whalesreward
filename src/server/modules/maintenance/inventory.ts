import type pg from "pg";
import type { MaintenanceStorage } from "../../adapters/maintenance-storage.ts";
import { evidenceRead } from "./repo.ts";
import {
  MaintenanceError,
  type Cursor,
  type Finding,
  type Lease,
  type Limits,
  type Page,
} from "./types.ts";

/** Only identifiers and reference state leave the read-only transaction. No domain mutation functions are imported. */
async function objectReferences(pool: pg.Pool, key: string) {
  return evidenceRead(pool, async (db) => {
    const refs = (
      await db.query<{ id: string; purchase_id: string | null; kind: string }>(
        `
      SELECT id,purchase_id,'meter' AS kind FROM photo_asset WHERE staging_key=$1 OR final_key=$1
      UNION ALL SELECT id,purchase_id,'sheet' FROM held_release_sheet WHERE staging_key=$1
      UNION ALL SELECT asset_id,s.purchase_id,'sheet' FROM held_release_sheet_validation v JOIN held_release_sheet s ON s.id=v.asset_id WHERE final_key=$1 OR display_key=$1
      UNION ALL SELECT asset_id,purchase_id,'receipt' FROM photo_receipt_observation WHERE sealed_key=$1
      UNION ALL SELECT id,NULL::uuid,'export' FROM card_export WHERE object_key=$1
      UNION ALL SELECT id,NULL::uuid,'export' FROM report_export WHERE object_key=$1
      LIMIT 100`,
        [key],
      )
    ).rows;
    const purchaseIds = [
      ...new Set(
        refs
          .map((r) => r.purchase_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const relations = purchaseIds.length
      ? (
          await db.query<{ id: string }>(
            `
      SELECT id FROM purchase_hold WHERE purchase_id=ANY($1::uuid[])
      UNION ALL SELECT id FROM purchase_revision WHERE purchase_id=ANY($1::uuid[])
      UNION ALL SELECT id FROM correction_request WHERE purchase_id=ANY($1::uuid[]) AND lease_until IS NOT NULL
      UNION ALL SELECT id FROM held_release_proposal WHERE purchase_id=ANY($1::uuid[])
      LIMIT 100`,
            [purchaseIds],
          )
        ).rows
      : [];
    return {
      refs,
      referenceIds: [
        ...new Set([...refs.map((r) => r.id), ...relations.map((r) => r.id)]),
      ],
    };
  });
}
export async function orphanPage(
  pool: pg.Pool,
  storage: MaintenanceStorage,
  lease: Lease,
  limits: Limits,
  signal: AbortSignal,
): Promise<Page> {
  const phase = lease.cursor.phase;
  if (phase !== "staging" && phase !== "final")
    throw new MaintenanceError("invalid_configuration");
  const page = await storage.listVersions(
    `${phase}/`,
    lease.cursor.provider,
    limits.pageSize,
    signal,
  );
  const findings: Finding[] = [];
  let agedStaged = 0,
    unreferencedFinal = 0,
    deleteMarkers = 0;
  for (const object of page.objects) {
    if (object.lastModified.getTime() > lease.cutoff.getTime() - limits.agedMs)
      continue;
    const refs = await objectReferences(pool, object.key);
    const referenceIds = refs.referenceIds;
    const base = {
      object: { key: object.key, versionId: object.versionId },
      assetId: refs.refs.find((r) => r.kind === "meter" || r.kind === "sheet")
        ?.id,
      purchaseId:
        refs.refs.find((r) => r.purchase_id)?.purchase_id ?? undefined,
      referenceIds,
    };
    if (object.deleteMarker) {
      findings.push({ ...base, code: "delete_marker" });
      deleteMarkers++;
    } else if (phase === "staging") {
      findings.push({ ...base, code: "aged_staged" });
      agedStaged++;
    } else if (refs.refs.length === 0) {
      findings.push({ ...base, code: "unreferenced_final" });
      unreferencedFinal++;
    }
  }
  const cursor: Cursor = page.cursor
    ? { phase, provider: page.cursor, after: null }
    : phase === "staging"
      ? { phase: "final", provider: null, after: null }
      : { phase: "done", provider: null, after: null };
  return {
    cursor,
    findings,
    complete: cursor.phase === "done",
    counts: {
      scanned: page.objects.length,
      findings: findings.length,
      agedStaged,
      unreferencedFinal,
      deleteMarkers,
    },
  };
}

type Expected = {
  position: string;
  id: string;
  purchase_id: string;
  object_key: string;
  digest: string | null;
  bytes: string | null;
  stalled: boolean;
  requires_receipt: boolean;
  receipt_id: string | null;
  receipt_digest: string | null;
  receipt_bytes: string | null;
  receipt_key: string | null;
};
async function expectedPage(pool: pg.Pool, lease: Lease, limits: Limits) {
  return evidenceRead(
    pool,
    async (db) =>
      (
        await db.query<Expected>(
          `
    WITH expected AS (
      SELECT 'meter:'||a.id::text AS position,a.id,a.purchase_id,
        coalesce(a.final_key,a.staging_key) AS object_key,
        CASE WHEN a.final_key IS NULL THEN a.expected_digest ELSE a.validated_digest END AS digest,
        (CASE WHEN a.final_key IS NULL THEN a.expected_bytes ELSE a.validated_bytes END)::text AS bytes,
        (a.state NOT IN ('validated','deleted','rejected') AND a.created_at<=$1::timestamptz-$4*interval '1 millisecond') AS stalled,
        a.state IN ('validated','deleted') AS requires_receipt,
        f.observation_id AS receipt_id,o.observed_digest AS receipt_digest,o.observed_bytes::text AS receipt_bytes,o.sealed_key AS receipt_key
      FROM photo_asset a LEFT JOIN photo_receipt_fact f ON f.asset_id=a.id
      LEFT JOIN photo_receipt_observation o ON o.id=f.observation_id
      WHERE a.created_at<=$1
      UNION ALL
      SELECT 'sheet:'||s.id::text,s.id,s.purchase_id,coalesce(v.final_key,s.staging_key),s.sha256,s.bytes::text,
        v.asset_id IS NULL AND s.created_at<=$1::timestamptz-$4*interval '1 millisecond',false,NULL::uuid,NULL,NULL,NULL
      FROM held_release_sheet s LEFT JOIN held_release_sheet_validation v ON v.asset_id=s.id WHERE s.created_at<=$1
      UNION ALL
      SELECT 'sheet-display:'||s.id::text,s.id,s.purchase_id,v.display_key,NULL,NULL,false,false,NULL::uuid,NULL,NULL,NULL
      FROM held_release_sheet s JOIN held_release_sheet_validation v ON v.asset_id=s.id WHERE s.created_at<=$1
    ) SELECT * FROM expected WHERE ($2::text IS NULL OR position>$2) ORDER BY position LIMIT $3`,
          [lease.cutoff, lease.cursor.after, limits.pageSize, limits.agedMs],
        )
      ).rows,
  );
}
export async function reconciliationPage(
  pool: pg.Pool,
  storage: MaintenanceStorage,
  lease: Lease,
  limits: Limits,
  signal: AbortSignal,
): Promise<Page> {
  const expected = await expectedPage(pool, lease, limits);
  const findings: Finding[] = [];
  const counts: Record<string, number> = { scanned: expected.length };
  const counter = {
    missing_object: "missingObject",
    digest_mismatch: "digestMismatch",
    size_mismatch: "sizeMismatch",
    missing_digest: "missingDigest",
    missing_receipt: "missingReceipt",
    receipt_mismatch: "receiptMismatch",
    stalled_upload: "stalledUpload",
  } as const;
  for (const asset of expected) {
    const base = {
      assetId: asset.id,
      purchaseId: asset.purchase_id,
      referenceIds: asset.receipt_id ? [asset.receipt_id] : [],
    };
    const add = (code: keyof typeof counter) => {
      findings.push({ ...base, code });
      counts[counter[code]] = (counts[counter[code]] ?? 0) + 1;
    };
    const observed = await storage.observe(
      asset.object_key,
      null,
      8388608,
      signal,
    );
    if (!observed) add("missing_object");
    if (!asset.digest) add("missing_digest");
    else if (observed && observed.digest !== asset.digest)
      add("digest_mismatch");
    if (
      observed &&
      asset.bytes !== null &&
      BigInt(observed.size) !== BigInt(asset.bytes)
    )
      add("size_mismatch");
    if (asset.stalled) add("stalled_upload");
    if (asset.requires_receipt && !asset.receipt_id) add("missing_receipt");
    if (
      asset.receipt_id &&
      (asset.receipt_digest !== asset.digest ||
        asset.receipt_bytes !== asset.bytes ||
        asset.receipt_key !== asset.object_key)
    )
      add("receipt_mismatch");
  }
  counts.findings = findings.length;
  const complete = expected.length < limits.pageSize;
  const cursor: Cursor = {
    phase: complete ? "done" : "expected",
    provider: null,
    after: expected.at(-1)?.position ?? lease.cursor.after,
  };
  return { cursor, counts, findings, complete };
}
