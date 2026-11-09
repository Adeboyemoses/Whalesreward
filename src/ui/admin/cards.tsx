"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { AdminSession } from "@/client/admin-session";
import { AdminError } from "@/client/admin-api";
import {
  batchSchema,
  batchEventSchema,
  inventoryCardSchema,
  cardExportSchema,
  createBatchSchema,
  batchTransitionSchema,
  createExportSchema,
} from "@/shared/contracts/customers-cards";
import type { Batch, CardExport } from "@/client/customer-admin-types";
import { titleCase } from "@/client/customer-admin-types";
import {
  freezeCustomerChange,
  customerMessage,
  customerFile,
  type CustomerChange,
} from "@/client/customer-admin-api";
import { adminTime } from "@/client/admin-display";
import {
  Button,
  TextField,
  DataTable,
  KeyValueList,
  Notice,
  StatusPill,
} from "@/ui";
import { useAdminSession } from "./session";
import { useRead, useViewGuard } from "./station-common";
import {
  PageHead,
  Sheet,
  Reason,
  SelectField,
  Loading,
  PageControls,
  PageState,
  useCustomerApi,
  useCustomerPage,
  useMemory,
} from "./customers-common";
import "@/styles/customers-cards.css";
export function CardsPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  const [, , action] = path;
  const id = path[1],
    grants = session.permissions ?? [];
  if (!grants.includes("cards"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow this section.
      </Notice>
    );
  const required =
    id === "generate"
      ? "cardGenerate"
      : action === "mark-printed"
        ? "cardPrint"
        : action === "activate"
          ? "cardActivate"
          : action === "print-preview"
            ? "cardExport"
            : null;
  if (required && !grants.some((g) => g === required))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow this action.
      </Notice>
    );
  return (
    <div className="wr-customers-cards">
      {id === "generate" ? (
        <GenerateBatch confirm={action === "confirm"} />
      ) : id ? (
        <BatchScreen
          key={id + ":" + (action ?? "")}
          id={id}
          action={action}
          session={session}
        />
      ) : (
        <Batches session={session} />
      )}
    </div>
  );
}
function Batches({ session }: { session: AdminSession }) {
  const [status, setStatus] = useMemory("batch-filter", "");
  return (
    <>
      <PageHead
        title="Loyalty cards"
        eyebrow="Loyalty cards"
        subtitle="Generate, print, then activate for assignment"
        action={
          session.permissions?.includes("cardGenerate") ? (
            <Link
              className="wr-btn wr-btn-primary"
              href="/admin/cards/generate"
            >
              Generate batch
            </Link>
          ) : undefined
        }
      />
      <div className="wr-row">
        <StatusPill small tone="pending">
          Generated
        </StatusPill>{" "}
        →{" "}
        <StatusPill small tone="pending">
          Printed
        </StatusPill>{" "}
        →{" "}
        <StatusPill small tone="synced">
          Active
        </StatusPill>
        <p className="wr-secondary">
          New batches must be marked Printed, then activated before their
          unassigned cards can be linked to customers.
        </p>
      </div>
      <SelectField
        label="Batch status"
        required={false}
        value={status}
        onChange={setStatus}
      >
        <option value="">All batches</option>
        {["generated", "printed", "active"].map((s) => (
          <option key={s} value={s}>
            {titleCase(s)}
          </option>
        ))}
      </SelectField>
      <BatchResults key={status} status={status} />
      <p className="wr-help">
        Export does not change a batch’s status. Repeat exports keep the same
        codes.
      </p>
      <div className="wr-cc-two">
        <Sheet title="Print preview · card front">
          <Notice>
            Prepare a PDF from a batch to preview its reserved codes and actual
            QR images. Physical printing specifications require a configured
            print layout.
          </Notice>
        </Sheet>
        <Sheet title="Generate a batch">
          <p>
            Codes are 7 characters, collision-safe, generated on the server.
          </p>
          {session.permissions?.includes("cardGenerate") && (
            <Link
              className="wr-btn wr-btn-primary"
              href="/admin/cards/generate"
            >
              Generate
            </Link>
          )}
        </Sheet>
      </div>
    </>
  );
}
function BatchResults({ status }: { status: string }) {
  const page = useCustomerPage("card-batches", batchSchema, {
    status: status || undefined,
  });
  return (
    <>
      <PageState page={page} empty="No card batches found." />
      <DataTable
        caption="Card batches"
        summary={`${page.data?.items.length ?? 0} batches on this page`}
        columns={[
          { key: "name", label: "Batch" },
          { key: "status", label: "Batch status" },
          { key: "total", label: "Total", align: "right" },
          { key: "available", label: "Available to assign", align: "right" },
          { key: "action", label: "" },
        ]}
        rows={(page.data?.items ?? []).map((b) => ({
          id: b.id,
          cells: {
            name: (
              <>
                <b>{b.name}</b>
                <span className="wr-sub wr-mono">
                  {b.batchCode} · {adminTime(b.createdAt)}
                </span>
              </>
            ),
            status: <BatchPill status={b.status} />,
            total: b.total,
            available: b.availableToAssign,
            action: <Link href={`/admin/cards/${b.id}`}>View batch</Link>,
          },
        }))}
      />
      <PageControls page={page} />
    </>
  );
}
function BatchPill({ status }: { status: Batch["status"] }) {
  return (
    <StatusPill small tone={status === "active" ? "synced" : "pending"}>
      {titleCase(status)}
    </StatusPill>
  );
}
function Identification() {
  return (
    <Sheet title="Card identification" quiet>
      <KeyValueList
        items={[
          { label: "Printed code", value: "7 uppercase characters" },
          { label: "QR content", value: "Same printed code" },
          { label: "Customer information", value: "Not stored in the QR" },
        ]}
      />
      <p className="wr-help">
        The short code is separate from the customer’s permanent ID. Retired
        codes are not reused.
      </p>
    </Sheet>
  );
}
type Attempt<T> = {
  change: CustomerChange<object>;
  state: "review" | "uncertain" | "rejected" | "applied";
  error: string;
  receipt?: T;
};
function useCardChange<T>(key: string, schema: z.ZodType<T>) {
  const [attempt, setAttempt] = useMemory<Attempt<T> | null>(
    "change:" + key,
    null,
  );
  const { store } = useAdminSession();
  const api = useCustomerApi(),
    capture = useViewGuard();
  const [busy, setBusy] = useState(false);
  async function submit(onApplied?: (result: T) => void) {
    if (
      !attempt ||
      attempt.state === "rejected" ||
      attempt.state === "applied" ||
      store.lists.get("customers:lock:" + key)
    )
      return;
    const current = capture(),
      epoch = store.getSnapshot().epoch;
    const lock = Symbol();
    store.lists.set("customers:lock:" + key, lock);
    setBusy(true);
    setAttempt({ ...attempt, state: "uncertain", error: "" });
    try {
      const receipt = await api.commit(attempt.change, schema);
      if (current()) {
        setAttempt({ ...attempt, state: "applied", error: "", receipt });
        onApplied?.(receipt);
      }
    } catch (error) {
      if (current()) {
        const unknown =
          error instanceof AdminError &&
          (error.status === 0 ||
            (error.status >= 500 &&
              error.code !== "print_layout_unconfigured"));
        setAttempt({
          ...attempt,
          state: unknown ? "uncertain" : "rejected",
          error: customerMessage(error),
        });
      }
    } finally {
      if (
        store.getSnapshot().epoch === epoch &&
        store.lists.get("customers:lock:" + key) === lock
      )
        store.lists.delete("customers:lock:" + key);
      setBusy(false);
    }
  }
  return { attempt, setAttempt, submit, busy };
}
function ChangeNotice<T>({
  state,
}: {
  state: { attempt: Attempt<T> | null; busy: boolean };
}) {
  return (
    <>
      {state.attempt?.error && (
        <Notice tone="danger" role="alert">
          {state.attempt.error}
        </Notice>
      )}
      {state.attempt?.state === "uncertain" && (
        <Notice tone="warning">
          The result is uncertain. Retry the same confirmation to retrieve its
          original result. Do not start another change.
        </Notice>
      )}
      {state.attempt?.state === "applied" && (
        <Notice tone="success" role="status">
          Historical applied receipt. Reload the current batch to see its latest
          status.
        </Notice>
      )}
    </>
  );
}
function GenerateBatch({ confirm }: { confirm: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useMemory("generate-draft", {
    name: "",
    count: "",
  });
  const state = useCardChange("generate", batchSchema);
  const { attempt } = state;
  const [error, setError] = useState("");
  const frozen = attempt?.change.body as
    { name: string; count: number } | undefined;
  function review() {
    try {
      if (
        !/^\d+$/.test(draft.count) ||
        BigInt(draft.count) < 1n ||
        BigInt(draft.count) > 1000n
      )
        throw new Error("Enter a whole number from 1 to 1000.");
      const body = createBatchSchema.omit({ operationId: true }).parse({
        name: draft.name,
        count: parseInt(draft.count, 10),
      });
      state.setAttempt({
        change: freezeCustomerChange("card-batches", {
          name: body.name,
          count: body.count,
        }),
        state: "review",
        error: "",
      });
      router.push("/admin/cards/generate/confirm");
    } catch (e) {
      setError(
        e instanceof Error && !(e instanceof z.ZodError)
          ? e.message
          : "Enter a batch name and a whole number from 1 to 1000.",
      );
    }
  }
  const locked = attempt?.state === "uncertain" || attempt?.state === "applied";
  return (
    <>
      <PageHead
        title="Generate card batch"
        eyebrow="Loyalty cards / New batch"
        subtitle="Reserve codes before preparing cards for print"
        back={{ href: "/admin/cards", label: "Back to batches" }}
      />
      <div className="wr-cc-two">
        <Sheet title={confirm ? "Confirm new batch" : "Generate a batch"}>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <ChangeNotice state={state} />
          {(confirm || locked) && attempt ? (
            <>
              <KeyValueList
                items={[
                  { label: "Batch name", value: frozen?.name },
                  { label: "Number of cards", value: frozen?.count },
                  {
                    label: "Code format",
                    value: "7 uppercase characters · no 0, 1, I or O",
                  },
                  { label: "Starting status", value: "Generated" },
                  {
                    label: "Assignment",
                    value: "Blocked until Printed, then Active",
                  },
                ]}
              />
              <Notice>
                New cards start in a Generated batch and cannot be assigned
                until the batch is Printed, then Active. Codes are reserved on
                the server; generation can be retried safely.
              </Notice>
              {attempt.state === "applied" && attempt.receipt ? (
                <Link
                  className="wr-btn wr-btn-primary"
                  href={`/admin/cards/${attempt.receipt.id}`}
                >
                  View batch
                </Link>
              ) : (
                <Button
                  disabled={attempt.state === "rejected"}
                  loading={state.busy}
                  onClick={() => void state.submit()}
                >
                  {attempt.state === "uncertain"
                    ? "Retry same confirmation"
                    : "Generate cards"}
                </Button>
              )}
              {!locked && (
                <Link
                  className="wr-btn wr-btn-secondary"
                  href="/admin/cards/generate"
                >
                  Keep editing
                </Link>
              )}
              {attempt.state === "rejected" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    state.setAttempt(null);
                    router.push("/admin/cards/generate");
                  }}
                >
                  Review a new batch
                </Button>
              )}
            </>
          ) : confirm ? (
            <Notice>
              No reviewed batch is available. Return to Generate batch to review
              a new request.
            </Notice>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                review();
              }}
            >
              <TextField
                label="Batch name"
                value={draft.name}
                maxLength={120}
                required
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <TextField
                label="Number of cards"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={draft.count}
                required
                onChange={(e) => setDraft({ ...draft, count: e.target.value })}
              />
              <p className="wr-help">Enter 1–1000 cards per batch.</p>
              <Button type="submit">Review batch</Button>
            </form>
          )}
          {!locked && (
            <Link
              className="wr-btn wr-btn-secondary"
              href="/admin/cards"
              onClick={() => state.setAttempt(null)}
            >
              Cancel
            </Link>
          )}
          {attempt?.state === "applied" && (
            <Button
              variant="secondary"
              onClick={() => {
                state.setAttempt(null);
                setDraft({ name: "", count: "" });
                router.push("/admin/cards/generate");
              }}
            >
              Generate another batch
            </Button>
          )}
        </Sheet>
        <Identification />
      </div>
    </>
  );
}
function BatchScreen({
  id,
  action,
  session,
}: {
  id: string;
  action?: string;
  session: AdminSession;
}) {
  const result = useRead(`card-batches/${encodeURIComponent(id)}`, batchSchema),
    b = result.data;
  if (!b) return <Loading {...result} label="Loading batch…" />;
  if (action === "mark-printed" || action === "activate")
    return <BatchTransition batch={b} action={action} reload={result.reload} />;
  if (action === "print-preview") return <PrintPreview batch={b} />;
  if (action) return <Notice>This card page is unavailable.</Notice>;
  const grants = session.permissions ?? [];
  return (
    <>
      <PageHead
        title={b.name}
        eyebrow="Loyalty cards / Batch details"
        subtitle={
          <>
            <span className="wr-mono">{b.batchCode}</span> ·{" "}
            {adminTime(b.createdAt)}
          </>
        }
        back={{ href: "/admin/cards", label: "Back to batches" }}
      />
      <Loading {...result} label="Refreshing batch…" />
      <div className="wr-card wr-quiet wr-cc-status">
        <div>
          <div className="wr-secondary">Batch status</div>
          <h2>
            {titleCase(b.status)} <BatchPill status={b.status} />
          </h2>
          <p className="wr-help">
            {b.status === "active"
              ? "Unassigned cards can be linked to customers"
              : "Assignment blocked until this batch is Active"}
          </p>
        </div>
        {b.status === "generated" && grants.includes("cardPrint") ? (
          <Link
            className="wr-btn wr-btn-primary"
            href={`/admin/cards/${id}/mark-printed`}
          >
            Mark as printed
          </Link>
        ) : b.status === "printed" && grants.includes("cardActivate") ? (
          <Link
            className="wr-btn wr-btn-primary"
            href={`/admin/cards/${id}/activate`}
          >
            Activate batch
          </Link>
        ) : b.status === "active" ? (
          <p className="wr-help">
            Active is the final state. Retired cards are never restored by
            activation.
          </p>
        ) : null}
      </div>
      {grants.includes("cardExport") && <BatchExports key={id} batch={b} />}
      <Inventory key={id} batch={b} />
      <BatchHistory key={id + ":history"} id={id} />
    </>
  );
}
function BatchTransition({
  batch: b,
  action,
  reload,
}: {
  batch: Batch;
  action: "mark-printed" | "activate";
  reload: () => void;
}) {
  const target = action === "mark-printed" ? "printed" : "active",
    from = action === "mark-printed" ? "generated" : "printed";
  const key = b.id + ":" + action;
  const state = useCardChange(key, batchSchema);
  const [reason, setReason] = useMemory("reason:" + key, "");
  const [error, setError] = useState("");
  const body = state.attempt?.change.body as
    { reason?: string; expectedVersion?: number } | undefined;
  const stale =
    state.attempt?.state === "review" && body?.expectedVersion !== b.version;
  function review() {
    try {
      const parsed = batchTransitionSchema.omit({ operationId: true }).parse({
        expectedVersion: b.version,
        reason,
      });
      state.setAttempt({
        change: freezeCustomerChange(`card-batches/${b.id}/${action}`, {
          expectedVersion: parsed.expectedVersion,
          reason: parsed.reason,
        }),
        state: "review",
        error: "",
      });
    } catch {
      setError("Enter a reason for this status change.");
    }
  }
  return (
    <>
      <PageHead
        title={b.name}
        eyebrow="Loyalty cards / Batch details"
        subtitle={b.batchCode}
        back={{ href: `/admin/cards/${b.id}`, label: "Back to batch" }}
      />
      <div className="wr-cc-two">
        <Sheet title="Change batch status">
          <p>
            This change:{" "}
            <b>
              {titleCase(from)} to {titleCase(target)}
            </b>
            .{" "}
            {action === "mark-printed"
              ? "Printed alone does not release cards for assignment."
              : "Unassigned cards become available for assignment. Retired cards stay retired."}
          </p>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <ChangeNotice state={state} />
          {stale && (
            <Notice tone="warning">
              This batch changed. Review the current version again.
            </Notice>
          )}
          {!state.attempt ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                review();
              }}
            >
              <Reason
                label={
                  action === "mark-printed"
                    ? "Reason / print reference"
                    : "Reason for activation"
                }
                value={reason}
                onChange={setReason}
              />
              <Notice>
                Cancel leaves the status unchanged. There is no
                Generated-to-Active shortcut and no reverse transition.
              </Notice>
              <Button type="submit" disabled={b.status !== from}>
                Review status change
              </Button>
            </form>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: "Reviewed version", value: body?.expectedVersion },
                  { label: "Reason / print reference", value: body?.reason },
                  {
                    label: "Status change",
                    value: `${titleCase(from)} → ${titleCase(target)}`,
                  },
                ]}
              />
              {state.attempt.state !== "applied" && (
                <Button
                  disabled={stale || state.attempt.state === "rejected"}
                  loading={state.busy}
                  onClick={() => void state.submit()}
                >
                  {state.attempt.state === "uncertain"
                    ? "Retry same confirmation"
                    : "Confirm status change"}
                </Button>
              )}
              {state.attempt.state === "review" && !state.busy && (
                <Button
                  variant="secondary"
                  onClick={() => state.setAttempt(null)}
                >
                  Keep editing
                </Button>
              )}
              {(state.attempt.state === "rejected" || stale) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    state.setAttempt(null);
                    reload();
                  }}
                >
                  Reload and review current record
                </Button>
              )}
              {state.attempt.receipt && (
                <KeyValueList
                  items={[
                    {
                      label: "Applied status",
                      value: titleCase(state.attempt.receipt.status),
                    },
                    {
                      label: "Applied version",
                      value: state.attempt.receipt.version,
                    },
                  ]}
                />
              )}
            </>
          )}
          <Link
            className="wr-btn wr-btn-secondary"
            href={`/admin/cards/${b.id}`}
            onClick={() => {
              if (state.attempt?.state !== "uncertain") state.setAttempt(null);
            }}
          >
            {state.attempt?.state === "applied"
              ? "View current batch"
              : "Cancel"}
          </Link>
        </Sheet>
        <Sheet title="Batch">
          <KeyValueList
            items={[
              { label: "Batch", value: b.name },
              { label: "Batch ID", value: b.batchCode, mono: true },
              {
                label: "Current status",
                value: <BatchPill status={b.status} />,
              },
              {
                label: "Cards",
                value: `${b.total} total · ${b.unassigned} unassigned`,
              },
              { label: "Current version", value: b.version },
            ]}
          />
        </Sheet>
      </div>
    </>
  );
}
function Inventory({ batch: b }: { batch: Batch }) {
  const [filter, setFilter] = useMemory("inventory-filter:" + b.id, "");
  return (
    <>
      <SelectField
        label="Card status"
        required={false}
        value={filter}
        onChange={setFilter}
      >
        <option value="">All cards</option>
        {["unassigned", "linked", "retired"].map((s) => (
          <option key={s} value={s}>
            {titleCase(s)}
          </option>
        ))}
      </SelectField>
      <InventoryRows key={b.id + ":" + filter} batch={b} filter={filter} />
    </>
  );
}
function InventoryRows({ batch: b, filter }: { batch: Batch; filter: string }) {
  const page = useCustomerPage(
    `card-batches/${b.id}/cards`,
    inventoryCardSchema,
    { state: filter || undefined },
  );
  return (
    <>
      <PageState page={page} empty="No cards in this view." />
      <DataTable
        caption="Cards in this batch"
        summary={`${b.total} cards · ${b.unassigned} unassigned · ${b.linked} linked · ${b.retired} retired`}
        columns={[
          { key: "code", label: "Card code" },
          { key: "state", label: "Card status" },
          { key: "eligible", label: "Assignment eligibility" },
          { key: "customer", label: "Linked customer" },
        ]}
        rows={(page.data?.items ?? []).map((c) => ({
          id: c.id,
          cells: {
            code: <b className="wr-mono">{c.code}</b>,
            state: (
              <StatusPill
                small
                tone={
                  c.state === "linked"
                    ? "synced"
                    : c.state === "retired"
                      ? "failed"
                      : "neutral"
                }
              >
                {titleCase(c.state)}
              </StatusPill>
            ),
            eligible: c.assignmentEligible
              ? "Available to assign"
              : c.state === "linked"
                ? "Assigned"
                : c.state === "retired"
                  ? "Not available · retired"
                  : `Blocked · batch ${titleCase(b.status)}`,
            customer:
              c.state === "linked" ? (
                c.linkedCustomer ? (
                  <Link href={`/admin/customers/${c.linkedCustomer.id}`}>
                    {c.linkedCustomer.name} ·{" "}
                    <span className="wr-mono">
                      {c.linkedCustomer.customerCode}
                    </span>
                  </Link>
                ) : (
                  "Customer detail unavailable"
                )
              ) : c.state === "retired" ? (
                `Retired ${c.retiredAt ? adminTime(c.retiredAt) : "· time not recorded"}`
              ) : (
                "—"
              ),
          },
        }))}
      />
      <PageControls page={page} />
    </>
  );
}
function BatchHistory({ id }: { id: string }) {
  const page = useCustomerPage(`card-batches/${id}/history`, batchEventSchema);
  return (
    <Sheet title="Batch history">
      <PageState page={page} empty="No batch status history recorded." />
      <DataTable
        caption="Status changes"
        columns={[
          { key: "time", label: "Time" },
          { key: "change", label: "Status change" },
          { key: "actor", label: "Administrator" },
          { key: "reason", label: "Reason / print reference" },
        ]}
        rows={(page.data?.items ?? []).map((e) => ({
          id: e.id,
          cells: {
            time: adminTime(e.occurredAt),
            change: `${e.from ? titleCase(e.from) + " → " : ""}${titleCase(e.to)}`,
            actor: e.actor.name,
            reason: e.reason,
          },
        }))}
      />
      <PageControls page={page} />
    </Sheet>
  );
}

function BatchExports({ batch: b }: { batch: Batch }) {
  const [format, setFormat] = useMemory<"pdf" | "xlsx">(
    "export-format:" + b.id,
    "pdf",
  );
  return (
    <section className="wr-cc-exports">
      <div className="wr-row">
        <Button variant="secondary" onClick={() => setFormat("pdf")}>
          Export PDF print sheet
        </Button>
        <Button variant="secondary" onClick={() => setFormat("xlsx")}>
          Export Excel register
        </Button>
        <Link
          className="wr-btn wr-btn-secondary"
          href={`/admin/cards/${b.id}/print-preview`}
        >
          Preview print sheet
        </Link>
      </div>
      <p className="wr-help">
        PDF: unassigned cards with QR codes. Excel: all batch codes and
        statuses. Exporting does not change batch status.
      </p>
      <ExportPreparation key={b.id + ":" + format} batch={b} format={format} />
      <ExportHistory batch={b} />
    </section>
  );
}
function ExportPreparation({
  batch: b,
  format,
}: {
  batch: Batch;
  format: "pdf" | "xlsx";
}) {
  const state = useCardChange(
    "export:" + b.id + ":" + format,
    cardExportSchema,
  );
  const body = state.attempt?.change.body as
    { expectedVersion: number; format: string } | undefined;
  const stale =
    state.attempt?.state === "review" && body?.expectedVersion !== b.version;
  function review() {
    const value = createExportSchema.omit({ operationId: true }).parse({
      expectedVersion: b.version,
      format,
    });
    state.setAttempt({
      change: freezeCustomerChange(`card-batches/${b.id}/exports`, {
        expectedVersion: value.expectedVersion,
        format: value.format,
      }),
      state: "review",
      error: "",
    });
  }
  return (
    <Sheet
      title={
        format === "pdf"
          ? "PDF print sheet preparation"
          : "Excel register preparation"
      }
    >
      <ChangeNotice state={state} />
      {!state.attempt ? (
        <>
          <p>
            Prepare an immutable snapshot of this batch. Preparation is separate
            from downloading and physical printing.
          </p>
          <Button variant="secondary" onClick={review}>
            Review export preparation
          </Button>
        </>
      ) : (
        <>
          <KeyValueList
            items={[
              { label: "Format", value: body?.format.toUpperCase() },
              { label: "Reviewed batch version", value: body?.expectedVersion },
              { label: "Current batch status", value: titleCase(b.status) },
            ]}
          />
          {stale && (
            <Notice tone="warning">
              The batch changed. Review a new export using the current version.
            </Notice>
          )}
          {state.attempt.state !== "applied" && (
            <Button
              loading={state.busy}
              disabled={stale || state.attempt.state === "rejected"}
              onClick={() => void state.submit()}
            >
              {state.attempt.state === "uncertain"
                ? "Retry same confirmation"
                : "Confirm export preparation"}
            </Button>
          )}
          {state.attempt.receipt && (
            <ExportStatus
              key={state.attempt.receipt.id}
              batch={b}
              initial={state.attempt.receipt}
            />
          )}
          <Button
            variant="secondary"
            disabled={state.busy || state.attempt.state === "uncertain"}
            onClick={() => state.setAttempt(null)}
          >
            {state.attempt.state === "applied" ||
            state.attempt.state === "rejected" ||
            stale
              ? "Review a new export"
              : "Cancel"}
          </Button>
        </>
      )}
    </Sheet>
  );
}
function ExportHistory({ batch: b }: { batch: Batch }) {
  const page = useCustomerPage(
    `card-batches/${b.id}/exports`,
    cardExportSchema,
  );
  const [, setPreview] = useMemory<string | null>("preview:" + b.id, null);
  return (
    <Sheet title="Export history">
      <p className="wr-help">
        History records file preparation, not proof of download or physical
        printing.
      </p>
      <Button variant="secondary" onClick={page.reload}>
        Refresh export history
      </Button>
      <PageState page={page} empty="No exports prepared yet." />
      <DataTable
        caption="Prepared exports"
        columns={[
          { key: "snapshot", label: "Snapshot" },
          { key: "format", label: "Format" },
          { key: "state", label: "Preparation status" },
          { key: "count", label: "Cards in snapshot" },
          { key: "action", label: "" },
        ]}
        rows={(page.data?.items ?? []).map((e) => ({
          id: e.id,
          cells: {
            snapshot: (
              <>
                {adminTime(e.snapshotAt)}
                <span className="wr-sub">
                  {titleCase(e.batchStatus)} · version {e.batchVersion}
                </span>
              </>
            ),
            format: e.format.toUpperCase(),
            state: titleCase(e.state),
            count: e.cardCount,
            action:
              e.state === "ready" ? (
                <div className="wr-row">
                  {e.format === "pdf" && (
                    <Link
                      href={`/admin/cards/${b.id}/print-preview`}
                      onClick={() => setPreview(e.id)}
                    >
                      Preview print sheet
                    </Link>
                  )}
                  <FileAction batch={b} item={e} />
                </div>
              ) : (
                <ExportStatus batch={b} initial={e} />
              ),
          },
        }))}
      />
      <PageControls page={page} />
    </Sheet>
  );
}
function ExportStatus({
  batch: b,
  initial,
}: {
  batch: Batch;
  initial: CardExport;
}) {
  const result = useRead(
    `card-batches/${b.id}/exports/${initial.id}`,
    cardExportSchema,
  );
  const e = result.data ?? initial;
  const polls = useRef(0);
  useEffect(() => {
    if (e.state !== "pending" || polls.current >= 10) return;
    const timer = setTimeout(() => {
      polls.current++;
      result.reload();
    }, 2000);
    return () => clearTimeout(timer);
  }, [e, result]);
  const [, setPreview] = useMemory<string | null>("preview:" + b.id, null);
  return (
    <>
      <Loading {...result} label="Checking preparation…" />
      <p>
        <b>
          {e.format.toUpperCase()} · {titleCase(e.state)}
        </b>{" "}
        · {e.cardCount} cards · snapshot {adminTime(e.snapshotAt)} ·{" "}
        {titleCase(e.batchStatus)} version {e.batchVersion}
      </p>
      {e.state === "ready" ? (
        <div className="wr-row">
          <FileAction batch={b} item={e} />
          {e.format === "pdf" && (
            <Link
              className="wr-btn wr-btn-secondary"
              href={`/admin/cards/${b.id}/print-preview`}
              onClick={() => setPreview(e.id)}
            >
              Preview print sheet
            </Link>
          )}
        </div>
      ) : (
        <>
          <Notice tone={e.state === "pending" ? "info" : "warning"}>
            {e.state === "pending"
              ? "File preparation is pending. No download or physical printing is confirmed."
              : e.state === "expired"
                ? "This file has expired. Prepare a new export."
                : "File preparation failed. Inventory and batch status are unchanged."}
          </Notice>
          <Button
            variant="secondary"
            onClick={() => {
              polls.current = 0;
              result.reload();
            }}
          >
            Check export status
          </Button>
        </>
      )}
    </>
  );
}
function useProtectedFile() {
  const { store } = useAdminSession(),
    capture = useViewGuard();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const urls = useRef(new Set<string>());
  const lock = useRef(false);
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
    },
    [],
  );
  async function load(b: Batch, e: CardExport, onReady: (url: string) => void) {
    if (lock.current) return;
    const authorityCurrent = capture();
    const route = window.location.pathname + window.location.search;
    const current = () =>
      authorityCurrent() &&
      window.location.pathname + window.location.search === route;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const blob = await customerFile(b.id, e.id, e.format, current);
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      if (!current()) {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
        return;
      }
      onReady(url);
    } catch (error) {
      if (!current()) return;
      if (
        error instanceof AdminError &&
        (error.status === 401 || error.code === "permission_denied")
      )
        store.clear(
          "Your session ended or permissions changed. Sign in again.",
        );
      else setError(customerMessage(error));
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  return { load, error, busy };
}
function FileAction({ batch: b, item: e }: { batch: Batch; item: CardExport }) {
  const file = useProtectedFile();
  return (
    <>
      <Button
        variant="secondary"
        loading={file.busy}
        onClick={() =>
          void file.load(b, e, (url) => {
            const a = document.createElement("a");
            a.href = url;
            a.download = `${b.batchCode}-${e.id}.${e.format}`;
            a.click();
          })
        }
      >
        Download {e.format.toUpperCase()}
      </Button>
      {file.error && (
        <Notice tone="danger" role="alert">
          {file.error}
        </Notice>
      )}
    </>
  );
}
function PrintPreview({ batch: b }: { batch: Batch }) {
  const [selected] = useMemory<string | null>("preview:" + b.id, null);
  return (
    <>
      <PageHead
        title="Card print preview"
        eyebrow="Loyalty cards / Print proof"
        subtitle={b.batchCode}
        back={{ href: `/admin/cards/${b.id}`, label: "Back to batch" }}
      />
      <Notice>
        Unassigned codes only. This preview uses the same protected prepared PDF
        as the download. Previewing and exporting never mark the batch Printed
        or Active. Physical printing specifications require a configured print
        layout.
      </Notice>
      {selected ? (
        <PreparedPreview key={selected} batch={b} id={selected} />
      ) : (
        <>
          <Notice>
            No prepared PDF is selected. Prepare a PDF from batch details, then
            choose Preview print sheet in its preparation result or export
            history.
          </Notice>
          <Link
            className="wr-btn wr-btn-secondary"
            href={`/admin/cards/${b.id}`}
          >
            Back to batch
          </Link>
        </>
      )}
    </>
  );
}
function PreparedPreview({ batch: b, id }: { batch: Batch; id: string }) {
  const result = useRead(
    `card-batches/${b.id}/exports/${id}`,
    cardExportSchema,
  );
  const file = useProtectedFile();
  const [url, setUrl] = useState("");
  const e = result.data;
  return (
    <>
      <Loading {...result} label="Loading prepared PDF…" />
      {e && (
        <>
          <KeyValueList
            items={[
              { label: "Snapshot time", value: adminTime(e.snapshotAt) },
              { label: "Snapshot status", value: titleCase(e.batchStatus) },
              { label: "Snapshot version", value: e.batchVersion },
              { label: "Cards in snapshot", value: e.cardCount },
              { label: "Preparation status", value: titleCase(e.state) },
            ]}
          />
          {e.format !== "pdf" ? (
            <Notice>
              This export is an Excel register. Select a prepared PDF to
              preview.
            </Notice>
          ) : e.state !== "ready" ? (
            <ExportStatus batch={b} initial={e} />
          ) : (
            <>
              <Button
                variant="secondary"
                loading={file.busy}
                onClick={() => void file.load(b, e, setUrl)}
              >
                Load protected PDF preview
              </Button>
              <FileAction batch={b} item={e} />
              {url && (
                <iframe
                  className="wr-cc-pdf"
                  title="Prepared card print sheet PDF"
                  src={url}
                />
              )}
            </>
          )}
          {file.error && (
            <Notice tone="danger" role="alert">
              {file.error}
            </Notice>
          )}
        </>
      )}
    </>
  );
}
