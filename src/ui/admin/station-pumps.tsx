"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DataTable, TextField, StatusPill, Notice } from "@/ui";
import { createPumpSchema } from "@/shared/contracts/station";
import { useAdminSession } from "./session";
import { PreviousContext } from "./station-context";
import {
  pumpSchema,
  attendantSchema,
  productsSchema,
  pumpAssignmentEventSchema,
  type Pump,
  type Attendant,
} from "@/client/station-types";
import { freezeChange, type FrozenChange } from "@/client/station-api";
import {
  PageHead,
  Sheet,
  SelectField,
  KeyValueList,
  Loading,
  ErrorNotice,
  MutationState,
  AssignmentHistory,
  useAll,
  useRead,
  useMutation,
  useReceipt,
  productNames,
  rate,
  unitPlural,
} from "./station-common";
import {
  AppliedNotice,
  handoverText,
  type Applied,
} from "./station-attendants";
export function Pumps() {
  const { session } = useAdminSession();
  const allowed = !!session?.permissions?.some(
    (x) => x === "pumps" || x === "attendants",
  );
  const list = useAll("pumps", pumpSchema);
  const candidates = useAll(
    "assignment-candidates",
    attendantSchema,
    undefined,
    allowed,
  );
  return (
    <>
      <PageHead
        title="Station pumps"
        eyebrow={session?.station?.name ?? "Station"}
        subtitle="Pump products and attendant assignments"
        action={
          session?.permissions?.includes("pumps") ? (
            <Link className="wr-btn wr-btn-primary" href="/admin/pumps/new">
              Add pump
            </Link>
          ) : undefined
        }
      />
      <Loading {...list} label="Refreshing station pumps…" />
      {list.data && (
        <PumpTable
          items={list.data}
          candidates={candidates.data ?? undefined}
        />
      )}
      <ErrorNotice error={candidates.error} />
      <p className="wr-help">
        Create a pump, then assign an attendant from their personal account. All
        pumps selling the same product inherit its station price.
      </p>
    </>
  );
}
export function PumpTable({
  items,
  candidates,
}: {
  items: Pump[];
  candidates?: Attendant[];
}) {
  return (
    <>
      <DataTable
        caption="Registered pumps"
        summary={`${items.length} pumps`}
        columns={[
          { key: "name", label: "Pump" },
          { key: "product", label: "Product" },
          { key: "price", label: "Shared product price", amount: true },
          { key: "attendants", label: "Assigned attendants" },
          { key: "action", label: "" },
        ]}
        rows={items.map((x) => {
          const names = candidates?.filter(
            (a) => a.assignment?.pump.id === x.id,
          );
          return {
            id: x.id,
            cells: {
              name: (
                <>
                  <b>{x.name}</b>
                  <span className="wr-sub wr-mono">{x.code}</span>
                </>
              ),
              product: productNames[x.product.code],
              price: rate(x.price, x.product.unit),
              attendants:
                x.attendantCount === "0" ? (
                  <StatusPill small>Unassigned</StatusPill>
                ) : names &&
                  BigInt(names.length) === BigInt(x.attendantCount) ? (
                  names.map((a) => a.name).join(", ")
                ) : (
                  `${x.attendantCount} configured`
                ),
              action: <Link href={`/admin/pumps/${x.id}`}>Manage pump</Link>,
            },
          };
        })}
      />
      {items.length === 0 && <p>No pumps registered yet.</p>}
    </>
  );
}
export function CreatePump() {
  const { session } = useAdminSession();
  const router = useRouter(),
    receipt = useReceipt(),
    products = useRead("products", productsSchema);
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  const [frozen, setFrozen] = useState<FrozenChange<object> | null>(null);
  const selected = products.data?.items.find((p) => p.code === code);
  const mutation = useMutation(pumpSchema, (pump) => {
    receipt.save(
      `/admin/pumps/${pump.id}`,
      { kind: "pump-created", pump },
      { path: `pumps/${pump.id}`, value: pump },
    );
    setFrozen(null);
    router.push(`/admin/pumps/${pump.id}`);
  });
  const submitting = useRef(false);
  async function create() {
    if (submitting.current || mutation.uncertain || mutation.blocked) return;
    const change = freezeChange("pumps", { name, productCode: code });
    if (!createPumpSchema.safeParse(change.body).success) {
      setError("Enter a unique pump name and select its product.");
      return;
    }
    setError("");
    submitting.current = true;
    setFrozen(change);
    await mutation.submit(change);
    submitting.current = false;
  }
  function reload() {
    setFrozen(null);
    mutation.reset();
    products.reload(true);
  }
  return (
    <>
      <PageHead
        title="Add pump"
        eyebrow="Station pumps / New pump"
        subtitle="Set the product, then assign an attendant"
        back={{ href: "/admin/pumps", label: "Back to station pumps" }}
      />
      <div className="wr-two-col">
        <Sheet title="Pump details">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField
              label="Pump name"
              value={name}
              maxLength={120}
              required
              disabled={mutation.busy || mutation.uncertain}
              onChange={(e) => setName(e.target.value)}
              helper="Must be unique at this station."
            />
            <SelectField
              label="Product"
              value={code}
              disabled={mutation.busy || mutation.uncertain || products.loading}
              onChange={setCode}
            >
              <option value="">Select a product</option>
              {products.data?.items.map((p) => (
                <option key={p.id} value={p.code}>
                  {productNames[p.code]}
                </option>
              ))}
            </SelectField>
            {selected && (
              <p className="wr-help">
                Quantity in {unitPlural(selected.unit)}. The product sets the
                quantity unit and station selling price.
              </p>
            )}
            <Loading {...products} label="Loading station products…" />
            <ErrorNotice error={error} />
            <MutationState
              state={mutation}
              reload={reload}
              retry={frozen ? () => void mutation.submit(frozen) : undefined}
            />
            <div className="wr-station-actions">
              <Button
                type="submit"
                loading={mutation.busy}
                disabled={mutation.uncertain || mutation.blocked || !selected}
              >
                {mutation.busy ? "Adding pump…" : "Add pump"}
              </Button>
              <Link href="/admin/pumps">Cancel</Link>
            </div>
          </form>
        </Sheet>
        <Sheet title="Station setup" quiet>
          <KeyValueList
            items={[
              { label: "Station", value: session?.station?.name ?? "Station" },
              { label: "Pump ID", value: "Generated on creation" },
              { label: "Attendants", value: "Assigned separately" },
            ]}
          />
          <p className="wr-help">
            Attendants assigned to this pump inherit its product automatically.
            Selling price comes from the station’s product price.
          </p>
        </Sheet>
      </div>
    </>
  );
}
export function PumpDetails({ id }: { id: string }) {
  const { session } = useAdminSession();
  const allowed = !!session?.permissions?.some(
    (x) => x === "pumps" || x === "attendants",
  );
  const canProfile = !!session?.permissions?.includes("attendants");
  const data = useRead(`pumps/${id}`, pumpSchema);
  const people = useAll(
    `pumps/${id}/attendants`,
    attendantSchema,
    undefined,
    allowed,
  );
  const history = useAll(
    `pumps/${id}/assignments`,
    pumpAssignmentEventSchema,
    undefined,
    allowed,
  );
  const pumps = useAll("pumps", pumpSchema, undefined, allowed);
  const applied = useReceipt().get<
    Applied | { kind: "pump-created"; pump: Pump }
  >(`/admin/pumps/${id}`);
  const x = data.data;
  return (
    <>
      <PageHead
        title={x?.name ?? "Pump details"}
        eyebrow="Station pumps / Pump details"
        subtitle={
          x ? `${session?.station?.name ?? "Station"} · ${x.code}` : undefined
        }
        back={{ href: "/admin/pumps", label: "Back to station pumps" }}
      />
      <Loading {...data} label="Loading pump details…" />
      {!data.data && <PreviousContext kind="pumps" />}
      {x && (
        <>
          {applied?.kind === "pump-created" ? (
            <Notice tone="success" role="status">
              <b>Pump added.</b> {applied.pump.name} is registered with the
              shared {productNames[applied.pump.product.code]} product settings.
              Assign an attendant to start recording sales on it.
            </Notice>
          ) : (
            <AppliedNotice value={applied} />
          )}
          <div className="wr-two-col">
            <Sheet title="Pump details">
              <KeyValueList
                items={[
                  { label: "Pump name", value: x.name },
                  { label: "Pump ID", value: x.code, mono: true },
                  { label: "Product", value: productNames[x.product.code] },
                  { label: "Quantity unit", value: x.product.unit },
                  {
                    label: "Quantity decimals",
                    value: x.price?.quantityPrecision ?? "Not configured",
                  },
                  {
                    label: "Shared product price",
                    value: `${rate(x.price, x.product.unit)}${x.price ? ` · version ${x.price.version}` : ""}`,
                  },
                ]}
              />
              <p className="wr-help">
                Product edits, removal and deactivation are not in this release.
                Changes never alter historical sale snapshots.
              </p>
            </Sheet>
            <Sheet title="Assigned attendants" quiet>
              {allowed ? (
                <>
                  <Loading
                    {...people}
                    label="Refreshing assigned attendants…"
                  />
                  {people.data?.length === 0 && (
                    <p>No attendant assigned yet.</p>
                  )}
                  {people.data?.map((a) => (
                    <div className="wr-card" key={a.id}>
                      <b>{a.name}</b>
                      <StatusPill
                        tone={
                          a.handover === "fresh_sign_in_required"
                            ? "pending"
                            : "neutral"
                        }
                        small
                      >
                        {handoverText(a)}
                      </StatusPill>
                      <p className="wr-help">
                        {a.username} ·{" "}
                        <span className="wr-mono">{a.staffCode}</span>
                      </p>
                      <div className="wr-station-actions">
                        {canProfile && (
                          <Link href={`/admin/attendants/${a.id}`}>
                            View account
                          </Link>
                        )}
                        <Link href={`/admin/pumps/${id}/end/${a.id}`}>
                          End assignment
                        </Link>
                      </div>
                    </div>
                  ))}
                  <Link
                    className={`wr-btn wr-station-assign ${people.data?.length ? "wr-btn-secondary" : "wr-btn-primary"}`}
                    href={`/admin/pumps/${id}/assign`}
                  >
                    {people.data?.length
                      ? "Assign another attendant"
                      : "Assign attendant"}
                  </Link>
                  <p className="wr-help">
                    Use an existing personal attendant account. Each person has
                    one pump assignment.
                  </p>
                </>
              ) : (
                <p>
                  {x.attendantCount} configured. Attendant details require pump
                  or attendant management access.
                </p>
              )}
            </Sheet>
          </div>
          {allowed && (
            <>
              <ErrorNotice error={pumps.error} />
              <AssignmentHistory
                {...history}
                items={history.data}
                pumpNames={
                  new Map((pumps.data ?? []).map((p) => [p.id, p.name]))
                }
              />
            </>
          )}
        </>
      )}
    </>
  );
}
