"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button, DataTable, Notice, StatusPill, TextField } from "@/ui";
import {
  createAttendantSchema,
  assignAttendantSchema,
} from "@/shared/contracts/station";
import { useAdminSession } from "./session";
import { PreviousContext } from "./station-context";
import {
  attendantSchema,
  pumpSchema,
  assignmentEventSchema,
  assignmentReceiptSchema,
  assignmentEndReceiptSchema,
  type Attendant,
  type Pump,
  type AssignmentReceipt,
  type AssignmentEndReceipt,
} from "@/client/station-types";
import { freezeChange, type FrozenChange } from "@/client/station-api";
import { adminTime } from "@/client/admin-display";
import {
  Attribution,
  AssignmentRule,
  AssignmentHistory,
  PageHead,
  Sheet,
  SelectField,
  Reason,
  KeyValueList,
  Loading,
  ErrorNotice,
  MutationState,
  useAll,
  useRead,
  useMutation,
  useReceipt,
  productNames,
  unitPlural,
} from "./station-common";
type Applied =
  | { kind: "created"; attendant: Attendant }
  | { kind: "assignment"; receipt: AssignmentReceipt }
  | { kind: "ended"; receipt: AssignmentEndReceipt };
export function handoverText(attendant: Attendant) {
  return attendant.handover === "fresh_sign_in_required"
    ? "Fresh online sign-in required"
    : attendant.handover === "unassigned"
      ? "Unassigned"
      : "Assignment acknowledged";
}
export function AppliedNotice({ value }: { value: Applied | undefined }) {
  if (!value) return null;
  if (value.kind === "created")
    return (
      <Notice tone="success" role="status">
        <b>Attendant created.</b> Give {value.attendant.name} their username and
        temporary password through your agreed handover. The password is never
        shown in this account. They must change it and sign in online again
        before recording sales.
      </Notice>
    );
  if (value.kind === "assignment")
    return (
      <Notice tone="success" role="status">
        <b>Assignment recorded.</b> This confirmation configured{" "}
        {value.receipt.attendant.name} for{" "}
        {value.receipt.attendant.assignment?.pump.name}. They must sign out and
        sign in online with their own account. Earlier and pending sales keep
        their original details; this is not proof that every device has updated.
      </Notice>
    );
  const x = value.receipt;
  return (
    <Notice tone="success" role="status">
      <b>Assignment ended.</b> Applied receipt: {x.attendant.name}, assignment{" "}
      <span className="wr-mono">{x.ended.assignmentId}</span> ended{" "}
      {adminTime(x.ended.effectiveUntil)} by {x.ended.actor.name} ·{" "}
      {x.ended.actor.code}. Reason: {x.ended.reason}. All their server sessions
      were revoked. Past and queued sales are kept. A disconnected phone learns
      this when it reconnects. This receipt is the original unassigned snapshot;
      current assignment is shown separately below.
    </Notice>
  );
}
export function Attendants() {
  const { session, store } = useAdminSession();
  const [filters, setFilters] = useState<{ query: string; pumpId: string }>(
    () =>
      (store.lists.get("station:filters:attendants") as
        { query: string; pumpId: string } | undefined) ?? {
        query: "",
        pumpId: "",
      },
  );
  const [query, setQuery] = useState(filters.query);
  const pumps = useAll("pumps", pumpSchema);
  const list = useAll("attendants/search", attendantSchema, {
    ...(filters.query ? { query: filters.query } : {}),
    ...(filters.pumpId ? { pumpId: filters.pumpId } : {}),
  });
  function filter(next: typeof filters) {
    store.lists.set("station:filters:attendants", next);
    setFilters(next);
  }
  return (
    <>
      <PageHead
        title="Attendants"
        eyebrow={session?.station?.name ?? "Station"}
        subtitle="Personal accounts and pump assignments"
        action={
          <Link className="wr-btn wr-btn-primary" href="/admin/attendants/new">
            Create attendant
          </Link>
        }
      />
      <form
        className="wr-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          filter({ ...filters, query: query.trim() });
        }}
      >
        <TextField
          label="Find an attendant"
          placeholder="Name, username or attendant ID"
          type="search"
          maxLength={120}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectField
          label="Assigned pump"
          value={filters.pumpId}
          required={false}
          onChange={(value) => filter({ ...filters, pumpId: value })}
        >
          <option value="">All pumps</option>
          {pumps.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {productNames[p.product.code]}
            </option>
          ))}
        </SelectField>
        <Button variant="secondary" type="submit">
          Search
        </Button>
      </form>
      <ErrorNotice error={pumps.error} />
      <Loading {...list} label="Refreshing attendants…" />
      {list.data && <AttendantTable items={list.data} />}
      <p className="wr-help">
        Each attendant uses their own login. Every sale records their identity
        and the pump used at capture.
      </p>
    </>
  );
}
export function AttendantTable({ items }: { items: Attendant[] }) {
  return (
    <>
      <DataTable
        caption="Attendant accounts"
        summary={`${items.length} accounts`}
        columns={[
          { key: "name", label: "Attendant" },
          { key: "username", label: "Username" },
          { key: "pump", label: "Assigned pump" },
          { key: "product", label: "Product" },
          { key: "action", label: "" },
        ]}
        rows={items.map((x) => ({
          id: x.id,
          cells: {
            name: (
              <>
                <b>{x.name}</b>
                <span className="wr-sub wr-mono">{x.staffCode}</span>
              </>
            ),
            username: (
              <span className="wr-mono wr-station-account">{x.username}</span>
            ),
            pump: x.assignment?.pump.name ?? "Unassigned",
            product: x.assignment
              ? productNames[x.assignment.product.code]
              : "Unassigned",
            action: (
              <Link href={`/admin/attendants/${x.id}`}>View account</Link>
            ),
          },
        }))}
      />
      {items.length === 0 && <p>No attendants match these filters.</p>}
    </>
  );
}
export function CreateAttendant() {
  const { session } = useAdminSession();
  const router = useRouter(),
    receipt = useReceipt(),
    pumps = useAll("pumps", pumpSchema);
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [pumpId, setPumpId] = useState(""),
    [error, setError] = useState("");
  const [frozen, setFrozen] = useState<FrozenChange<object> | null>(null);
  const selected = pumps.data?.find((p) => p.id === pumpId);
  const mutation = useMutation(attendantSchema, (attendant) => {
    setPassword("");
    setVisible(false);
    setFrozen(null);
    receipt.save(
      `/admin/attendants/${attendant.id}`,
      {
        kind: "created",
        attendant,
      },
      { path: `attendants/${attendant.id}`, value: attendant },
    );
    router.push(`/admin/attendants/${attendant.id}`);
  });
  const submitting = useRef(false);
  async function create() {
    if (
      !selected ||
      submitting.current ||
      mutation.uncertain ||
      mutation.blocked
    )
      return;
    const change = freezeChange("attendants", {
      name,
      username,
      password,
      pumpId,
      expectedPumpVersion: selected.version,
    });
    const parsed = createAttendantSchema.safeParse(change.body);
    if (!parsed.success) {
      setError(
        "Enter a full name, a unique 3–40 character username, a password of 12–1024 characters without control characters and a pump.",
      );
      return;
    }
    setError("");
    submitting.current = true;
    setFrozen(change);
    const outcome = await mutation.submit(change);
    submitting.current = false;
    if (outcome === "rejected") {
      setPassword("");
      setVisible(false);
      setFrozen(null);
    }
  }
  function reload() {
    setPassword("");
    setVisible(false);
    setFrozen(null);
    setPumpId("");
    mutation.reset();
    pumps.reload(true);
  }
  const locked = mutation.busy || mutation.uncertain;
  return (
    <>
      <PageHead
        title="Create attendant"
        eyebrow="Attendants / New account"
        subtitle="Give one attendant their own sales-entry account"
        back={{ href: "/admin/attendants", label: "Back to attendants" }}
      />
      <div className="wr-two-col">
        <Sheet title="Account details">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField
              label="Full name"
              value={name}
              maxLength={120}
              required
              disabled={locked}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Username"
              value={username}
              maxLength={40}
              required
              disabled={locked}
              autoCapitalize="none"
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
              helper="3–40 letters, numbers, dots, underscores or dashes; stored in lowercase."
            />
            <TextField
              label="Password"
              type={visible ? "text" : "password"}
              value={password}
              required
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
              disabled={locked}
              onChange={(e) => setPassword(e.target.value)}
              helper="Use 12–1024 characters. Passwords never appear in account details."
              action={
                <Button
                  variant="secondary"
                  disabled={locked}
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                  icon={visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                />
              }
            />
            <SelectField
              label="Assign pump"
              value={pumpId}
              disabled={locked || pumps.loading}
              onChange={setPumpId}
            >
              <option value="">Select a pump</option>
              {pumps.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {productNames[p.product.code]}
                </option>
              ))}
            </SelectField>
            {selected && (
              <p className="wr-help">
                {productNames[selected.product.code]} · quantities in{" "}
                {unitPlural(selected.product.unit)}. The assigned pump sets the
                product and quantity unit.
              </p>
            )}
            <Loading {...pumps} label="Loading available pumps…" />
            <ErrorNotice error={error} />
            <MutationState
              state={mutation}
              retry={frozen ? () => void mutation.submit(frozen) : undefined}
              reload={reload}
            />
            <div className="wr-station-actions">
              <Button
                type="submit"
                loading={mutation.busy}
                disabled={mutation.uncertain || mutation.blocked || !selected}
              >
                {mutation.busy ? "Creating account…" : "Create account"}
              </Button>
              <Link
                href="/admin/attendants"
                onClick={() => {
                  setPassword("");
                  setVisible(false);
                  setFrozen(null);
                }}
              >
                Cancel
              </Link>
            </div>
          </form>
        </Sheet>
        <Sheet title="Assignment rules" quiet>
          <KeyValueList
            items={[
              { label: "Station", value: session?.station?.name ?? "Station" },
              { label: "Access", value: "Attendant" },
              { label: "Attendant ID", value: "Generated on creation" },
            ]}
          />
          <p>
            Sales are restricted to the assigned pump. The product comes from
            that pump automatically.
          </p>
          <p className="wr-help">
            The permanent attendant ID stays with the person. Historical sales
            retain the identity and pump recorded at capture. A new attendant
            must change their first password, then sign in online again.
          </p>
        </Sheet>
      </div>
    </>
  );
}
export function AttendantProfile({ id }: { id: string }) {
  const { session } = useAdminSession();
  const data = useRead(`attendants/${id}`, attendantSchema);
  const pumps = useAll("pumps", pumpSchema);
  const history = useAll(`attendants/${id}/assignments`, assignmentEventSchema);
  const applied = useReceipt().get<Applied>(`/admin/attendants/${id}`);
  const x = data.data;
  return (
    <>
      <PageHead
        title={x?.name ?? "Attendant account details"}
        eyebrow="Attendants / Account details"
        subtitle={x ? `${x.staffCode} · ${x.username}` : undefined}
        back={{ href: "/admin/attendants", label: "Back to attendants" }}
      />
      <Loading {...data} label="Loading attendant account…" />
      {!data.data && <PreviousContext kind="attendants" />}
      {x && (
        <>
          <AppliedNotice value={applied} />
          <div className="wr-two-col">
            <Sheet title="Personal account">
              <StatusPill
                small
                tone={
                  x.handover === "fresh_sign_in_required"
                    ? "pending"
                    : "neutral"
                }
              >
                {handoverText(x)}
              </StatusPill>
              <KeyValueList
                items={[
                  { label: "Full name", value: x.name },
                  {
                    label: "Permanent attendant ID",
                    value: x.staffCode,
                    mono: true,
                  },
                  {
                    label: "Username",
                    value: (
                      <span className="wr-station-account">{x.username}</span>
                    ),
                    mono: true,
                  },
                  { label: "Role", value: "Attendant" },
                  {
                    label: "Station",
                    value: session?.station?.name ?? "Station",
                  },
                ]}
              />
              <div className="wr-station-actions">
                <Link
                  className="wr-btn wr-btn-secondary"
                  href={`/admin/attendants/${id}/assign`}
                >
                  Change pump assignment
                </Link>
                {x.assignment && (
                  <Link
                    className="wr-btn wr-btn-secondary"
                    href={`/admin/attendants/${id}/end`}
                  >
                    End assignment
                  </Link>
                )}
              </div>
            </Sheet>
            <Sheet title="Current pump assignment" quiet>
              <h2>{x.assignment?.pump.name ?? "Unassigned"}</h2>
              <p>
                {x.assignment
                  ? `${productNames[x.assignment.product.code]} · quantity recorded in ${unitPlural(x.assignment.product.unit)}`
                  : "No active pump assignment. Sign-in is unavailable until a manager assigns a pump."}
              </p>
              <p className="wr-help">
                The attendant signs in using their own username and password,
                including when a device is shared. Earlier sales and queued
                uploads keep their original details.
              </p>
            </Sheet>
          </div>
          <AssignmentHistory
            {...history}
            items={history.data}
            pumpNames={new Map((pumps.data ?? []).map((p) => [p.id, p.name]))}
          />
          <Attribution />
        </>
      )}
    </>
  );
}
type GuardBody = {
  expectedVersion: number;
  expectedAssignmentId: string | null;
  reason: string;
  pumpId?: string;
  expectedPumpVersion?: number;
};
type Review = { attendant: Attendant; pump: Pump | null; reason: string };
export function AssignmentEditor({
  id,
  pumpId,
  contextPumpId,
  confirm = false,
  end = false,
}: {
  id?: string;
  pumpId?: string;
  contextPumpId?: string;
  confirm?: boolean;
  end?: boolean;
}) {
  const router = useRouter(),
    { session } = useAdminSession(),
    receipt = useReceipt();
  const candidates = useAll("assignment-candidates", attendantSchema);
  const pumps = useAll("pumps", pumpSchema);
  const [selectedId, setSelectedId] = useState(id ?? ""),
    [targetId, setTargetId] = useState(pumpId ?? ""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const [frozen, setFrozen] = useState<FrozenChange<GuardBody> | null>(null),
    [review, setReview] = useState<Review | null>(null);
  const selected = candidates.data?.find((x) => x.id === selectedId),
    target = pumps.data?.find((p) => p.id === targetId);
  const canProfile = session?.permissions?.includes("attendants");
  const base = contextPumpId
    ? `/admin/pumps/${contextPumpId}/end/${id}`
    : pumpId
      ? `/admin/pumps/${pumpId}/assign`
      : `/admin/attendants/${id}/${end ? "end" : "assign"}`;
  const returnHref = contextPumpId
    ? `/admin/pumps/${contextPumpId}`
    : pumpId
      ? `/admin/pumps/${pumpId}`
      : `/admin/attendants/${id}`;
  const mutation = useMutation<AssignmentReceipt | AssignmentEndReceipt>(
    end ? assignmentEndReceiptSchema : assignmentReceiptSchema,
    (value) => {
      const path =
        pumpId || contextPumpId
          ? `/admin/pumps/${pumpId ?? contextPumpId}`
          : canProfile
            ? `/admin/attendants/${value.attendant.id}`
            : `/admin/pumps/${"ended" in value ? value.ended.pumpId : value.attendant.assignment?.pump.id}`;
      receipt.save(
        path,
        "ended" in value
          ? { kind: "ended", receipt: value }
          : { kind: "assignment", receipt: value },
        canProfile
          ? { path: `attendants/${value.attendant.id}`, value: value.attendant }
          : undefined,
      );
      setFrozen(null);
      router.push(path);
    },
  );
  function prepare() {
    if (mutation.busy || mutation.uncertain || mutation.blocked) return;
    if (!selected || (!end && !target)) return;
    const text = reason.trim();
    if (!text) {
      setError("Enter a reason before reviewing this change.");
      return;
    }
    if (end && !selected.assignment) {
      setError(
        "This attendant is already unassigned. Reload the current record.",
      );
      return;
    }
    if (!end && target?.id === selected.assignment?.pump.id) {
      setError("Choose a different pump before reviewing.");
      return;
    }
    const body: GuardBody = {
      expectedVersion: selected.version,
      expectedAssignmentId: selected.assignment?.id ?? null,
      reason: text,
      ...(!end && target
        ? { pumpId: target.id, expectedPumpVersion: target.version }
        : {}),
    };
    const change = freezeChange(
      `attendants/${selected.id}/assignment${end ? "/end" : ""}`,
      body,
    );
    if (!end && !assignAttendantSchema.safeParse(change.body).success) {
      setError(
        "The assignment could not be reviewed. Reload the current records.",
      );
      return;
    }
    setReview({
      attendant: structuredClone(selected),
      pump: target ? structuredClone(target) : null,
      reason: text,
    });
    setFrozen(change);
    setError("");
    mutation.reset();
    router.push(base + "/confirm");
  }
  function reload() {
    setFrozen(null);
    setReview(null);
    setReason("");
    candidates.reload(true);
    pumps.reload(true);
    mutation.reset();
    router.replace(base);
  }
  const reviewing = confirm || mutation.uncertain || mutation.blocked;
  const shown = reviewing ? (review?.attendant ?? selected) : selected;
  const title = end
    ? "End assignment"
    : pumpId
      ? (target?.name ?? "Assign attendant")
      : "Change pump assignment";
  const busy = mutation.busy || mutation.uncertain;
  return (
    <>
      <PageHead
        title={title}
        eyebrow={
          pumpId ? "Station pumps / Pump details" : "Attendants / Assignment"
        }
        subtitle={shown ? `${shown.name} · ${shown.staffCode}` : undefined}
        back={{
          href: confirm ? base : returnHref,
          label: confirm
            ? "Back to assignment"
            : pumpId
              ? "Back to pump"
              : "Back to account",
        }}
      />
      <Loading {...candidates} label="Loading attendant assignment…" />
      <ErrorNotice error={pumps.error} />
      {!candidates.loading && id && !selected && (
        <Notice tone="danger" role="alert">
          This attendant is unavailable. Reload the current record before
          continuing.
        </Notice>
      )}
      <div className="wr-two-col">
        <Sheet
          title={
            reviewing
              ? end
                ? "Confirm end assignment"
                : "Confirm pump assignment"
              : end
                ? "End assignment"
                : "Assign attendant to this pump"
          }
        >
          {reviewing ? (
            frozen && review ? (
              <>
                <KeyValueList
                  items={[
                    { label: "Attendant", value: review.attendant.name },
                    {
                      label: "Permanent ID",
                      value: review.attendant.staffCode,
                      mono: true,
                    },
                    { label: "Username", value: review.attendant.username },
                    {
                      label: end ? "Current pump" : "Previous pump",
                      value: review.attendant.assignment
                        ? `${review.attendant.assignment.pump.name} · ${productNames[review.attendant.assignment.product.code]}`
                        : "Unassigned",
                    },
                    ...(!end
                      ? [
                          {
                            label: "New pump",
                            value: review.pump
                              ? `${review.pump.name} · ${productNames[review.pump.product.code]}`
                              : "Unavailable",
                          },
                        ]
                      : []),
                    {
                      label: "Pending uploads",
                      value:
                        "Unknown on this device; original sales stay under this account",
                    },
                    {
                      label: "Takes effect",
                      value: end
                        ? "All server sessions are revoked on confirmation"
                        : "Fresh online sign-in required before using the new pump",
                    },
                    { label: "Reason", value: review.reason },
                  ]}
                />
                <Notice tone="warning">
                  {end
                    ? "This ends the current pump assignment and signs the attendant out on every device at the server. They cannot sign in until reassigned. Past and queued sales are kept. A disconnected phone learns of revocation when it reconnects."
                    : "This updates the same person’s assignment. They must sign out and sign in online before using the new pump. Pending uploads keep the original account and pump details."}
                </Notice>
                <MutationState
                  state={mutation}
                  reload={reload}
                  retry={() => void mutation.submit(frozen)}
                />
                <div className="wr-station-actions">
                  <Button
                    loading={mutation.busy}
                    disabled={mutation.uncertain || mutation.blocked}
                    onClick={() => void mutation.submit(frozen)}
                  >
                    {mutation.busy
                      ? "Confirming…"
                      : end
                        ? "Confirm end assignment"
                        : "Confirm assignment"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || mutation.blocked}
                    onClick={() => {
                      setFrozen(null);
                      mutation.reset();
                      router.push(base);
                    }}
                  >
                    Keep editing
                  </Button>
                  <Link href={returnHref}>Cancel</Link>
                </div>
              </>
            ) : (
              <>
                <Notice role="alert">
                  Review this change again before confirming.
                </Notice>
                <Link href={base}>Back to assignment</Link>
              </>
            )
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                prepare();
              }}
            >
              {!id ? (
                <SelectField
                  label="Attendant account"
                  value={selectedId}
                  disabled={busy}
                  onChange={setSelectedId}
                >
                  <option value="">Select an attendant</option>
                  {candidates.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.username} ·{" "}
                      {x.assignment?.pump.name ?? "Unassigned"}
                    </option>
                  ))}
                </SelectField>
              ) : (
                shown && (
                  <KeyValueList
                    items={[
                      { label: "Attendant", value: shown.name },
                      {
                        label: "Permanent ID",
                        value: shown.staffCode,
                        mono: true,
                      },
                      { label: "Username", value: shown.username },
                    ]}
                  />
                )
              )}
              <p className="wr-help">
                Current assignment:{" "}
                {selected?.assignment
                  ? `${selected.assignment.pump.name} · ${productNames[selected.assignment.product.code]}`
                  : "Unassigned"}
                . Pending uploads are unknown on this device and keep their
                original details.
              </p>
              {!end && !pumpId && (
                <SelectField
                  label="New pump"
                  value={targetId}
                  disabled={busy || pumps.loading}
                  onChange={setTargetId}
                >
                  <option value="">Select a pump</option>
                  {pumps.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {productNames[p.product.code]}
                    </option>
                  ))}
                </SelectField>
              )}
              <Reason
                label={
                  end ? "Reason for ending assignment" : "Reason for assignment"
                }
                value={reason}
                disabled={busy}
                onChange={setReason}
              />
              <ErrorNotice error={error} />
              <div className="wr-station-actions">
                <Button
                  type="submit"
                  disabled={
                    !selected || (!end && !target) || !reason.trim() || busy
                  }
                >
                  {end ? "Review end assignment" : "Review assignment"}
                </Button>
                <Link href={returnHref}>Cancel</Link>
              </div>
            </form>
          )}
        </Sheet>
        <AssignmentRule />
      </div>
      {selected && (
        <SelectedHistory
          key={selected.id}
          id={selected.id}
          pumps={pumps.data ?? []}
        />
      )}
    </>
  );
}
function SelectedHistory({ id, pumps }: { id: string; pumps: Pump[] }) {
  const history = useAll(`attendants/${id}/assignments`, assignmentEventSchema);
  return (
    <AssignmentHistory
      {...history}
      items={history.data}
      pumpNames={new Map(pumps.map((p) => [p.id, p.name]))}
    />
  );
}
export type { Applied };
