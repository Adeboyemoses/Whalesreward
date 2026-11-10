"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ScanLine } from "lucide-react";
import { v7 } from "uuid";
import {
  registrationSchema,
  type categorySchema,
} from "@/shared/contracts/customers-cards";
import type { z } from "zod";
import {
  Button,
  TextField,
  Notice,
  ResultBlock,
  KeyValueList,
  Brand,
} from "@/ui";
import {
  HttpRegistrationApi,
  RegistrationOperation,
  registrationUncertain,
  type RegistrationReceipt,
  type ExistingCustomer,
} from "@/client/registration-api";
import { ClientError } from "@/client/types";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  message,
  formatTime,
  pumpName,
  useSaleHandoff,
} from "../_components/runtime";
import { Camera } from "../_components/camera";
type Category = z.infer<typeof categorySchema>;
const categories: { value: Category; label: string }[] = [
  { value: "car_owner", label: "Car owner" },
  { value: "commercial_bus_driver", label: "Commercial bus" },
  { value: "three_wheeler_user", label: "Three-wheeler" },
  { value: "bike_user", label: "Bike" },
  { value: "keg_buyer", label: "Keg buyer" },
  { value: "cooking_gas_customer", label: "Cooking gas" },
];
const categoryLabel = (category: Category) =>
  categories.find((item) => item.value === category)!.label;
export function Registration() {
  return (
    <AccessGate>
      <RegistrationFlow />
    </AccessGate>
  );
}
function RegistrationFlow() {
  const { client, state, online } = useAttendant();
  const session = state!.session!;
  const router = useRouter();
  const pathname = usePathname();
  const handoff = useSaleHandoff();
  const [api] = useState(() => new HttpRegistrationApi());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [candidate] = useState(() => handoff.registrationCandidate(session));
  const [card, setCard] = useState(candidate?.cardCode ?? "");
  const [source, setSource] = useState<"code" | "qr">(
    candidate?.source ?? "code",
  );
  useEffect(() => {
    handoff.clearRegistration();
  }, [handoff]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [existing, setExisting] = useState<ExistingCustomer | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (pathname !== `/attendant/register/${receipt?.customer.id}/done`)
      setReceipt(null);
  }
  const operation = useRef<RegistrationOperation | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const working = useRef(false);
  const authority = `${session.account.id}:${session.captureContextId}`;
  const currentAuthority = () => {
    const current = client?.getState();
    return current?.access === "active" && current.session
      ? `${current.session.account.id}:${current.session.captureContextId}`
      : null;
  };
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      generation.current++;
    };
    const clearPage = () => {
      generation.current++;
      operation.current?.clear();
      operation.current = null;
      setName("");
      setPhone("");
      setCategory("");
      setCard("");
      setReceipt(null);
      setExisting(null);
      setDuplicate(false);
      setUncertain(false);
      setError(null);
      setCamera(false);
      setCategoriesOpen(false);
    };
    window.addEventListener("pagehide", clearPage);
    window.addEventListener("pageshow", clearPage);
    return () => {
      window.removeEventListener("pagehide", clearPage);
      window.removeEventListener("pageshow", clearPage);
      mounted.current = false;
      invalidate();
      operation.current?.clear();
      operation.current = null;
    };
  }, [generation]);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    invalidate();
    return invalidate;
  }, [pathname]);
  const doneId = pathname.match(
    /^\/attendant\/register\/([^/]+)\/done\/?$/,
  )?.[1];
  const result = doneId && receipt?.customer.id === doneId ? receipt : null;
  function clearDraft() {
    generation.current++;
    operation.current?.clear();
    operation.current = null;
    setName("");
    setPhone("");
    setCategory("");
    setCard("");
    setSource("code");
    setExisting(null);
    setDuplicate(false);
    setUncertain(false);
    setError(null);
    setCategoriesOpen(false);
    setCamera(false);
  }
  function reset() {
    clearDraft();
    setReceipt(null);
    go(router, "/attendant/register", true);
  }
  function live(request: number, route: string) {
    return (
      mounted.current &&
      generation.current === request &&
      currentAuthority() === authority &&
      window.location.pathname === route
    );
  }
  async function failure(e: unknown, request: number, route: string) {
    await client!.observeAuthorityError(e, session);
    if (live(request, route)) setError(message(e));
  }
  async function submit() {
    if (!client || working.current || !online) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    const route = pathname;
    try {
      await client.checkAccess();
      if (!live(request, route) || !navigator.onLine) return;
      if (!operation.current) {
        const body = registrationSchema.safeParse({
          operationId: v7(),
          name,
          phone,
          category,
          card: source === "qr" ? { source, qr: card } : { source, code: card },
        });
        if (!body.success || !phone.trim())
          throw new ClientError(
            "invalid_request",
            "Complete the customer details and check the printed card number.",
          );
        operation.current = new RegistrationOperation(
          body.data,
          authority,
          currentAuthority,
        );
      }
      const registered = await operation.current.send(api);
      if (!live(request, route)) return;
      clearDraft();
      setReceipt(registered);
      go(router, `/attendant/register/${registered.customer.id}/done`);
    } catch (e) {
      await client.observeAuthorityError(e, session);
      if (!live(request, route)) return;
      const unknown = registrationUncertain(e);
      setUncertain(unknown);
      if (!unknown) {
        operation.current?.clear();
        operation.current = null;
      }
      if (e instanceof ClientError && e.code === "phone_in_use") {
        setDuplicate(true);
        setExisting(null);
      } else setError(message(e));
    } finally {
      if (mounted.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function lookupExisting() {
    if (!client || working.current || !online || !duplicate) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setExisting(null);
    const request = ++generation.current;
    const route = pathname;
    const searchedPhone = phone;
    try {
      await client.checkAccess();
      if (!live(request, route) || !navigator.onLine) return;
      const found = await api.lookupPhone(searchedPhone);
      if (live(request, route)) setExisting(found);
    } catch (e) {
      await failure(e, request, route);
    } finally {
      if (mounted.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function startSale(customerId: string, code: string | null) {
    if (!client || working.current || !online || !code) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    const route = pathname;
    try {
      await client.checkAccess();
      if (!live(request, route) || !navigator.onLine) return;
      const found = await client.lookupCurrent(code);
      if (!found || found.customer.id !== customerId)
        throw new ClientError(
          "card_unavailable",
          "This customer has no usable matching card. Ask a station manager for help.",
        );
      if (!live(request, route) || !navigator.onLine) return;
      handoff.offer({
        accountId: session.account.id,
        contextId: session.captureContextId,
        cardCode: code,
        customerId,
      });
      clearDraft();
      setReceipt(null);
      go(router, "/attendant/sale");
    } catch (e) {
      await failure(e, request, route);
    } finally {
      if (mounted.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const context = (
    <>
      {session.station.name} <span className="wr-dot">·</span>{" "}
      {pumpName(session.pump.code)}
      {!doneId && (
        <>
          {" "}
          <span className="wr-dot">·</span> <b>Internet required</b>
        </>
      )}
    </>
  );
  const complete = name.trim() && phone.trim() && category && card.trim();
  const locked = busy || uncertain;
  const existingUsable = !!existing?.cardCode && existing.cardUsable;
  return (
    <div className="wr-registration">
      <Frame
        title={doneId ? "Customer registered" : "Register customer"}
        active="Register"
        context={context}
        action={
          doneId ? (
            <>
              {result && (
                <Button
                  cta
                  disabled={!online}
                  loading={busy}
                  onClick={() =>
                    void startSale(result.customer.id, result.cardCode)
                  }
                >
                  {online
                    ? `Record a sale for ${result.customer.name.split(/\s+/)[0]}`
                    : "Connect to record a sale"}
                </Button>
              )}
              <Button variant="secondary" onClick={reset}>
                Register another customer
              </Button>
            </>
          ) : (
            <>
              {duplicate && (
                <Button
                  cta
                  loading={busy}
                  disabled={!online || (!!existing && !existingUsable)}
                  onClick={() =>
                    void (existing
                      ? startSale(existing.customer.id, existing.cardCode)
                      : lookupExisting())
                  }
                >
                  {existing
                    ? `Open ${existing.customer.name} and record a sale`
                    : "Find existing customer"}
                </Button>
              )}
              <Button
                cta={!duplicate}
                variant={duplicate ? "secondary" : "primary"}
                disabled={!online || !complete || duplicate}
                loading={busy}
                onClick={() => void submit()}
              >
                {!online
                  ? "Connect to register"
                  : uncertain
                    ? "Retry this registration"
                    : "Register and link card"}
              </Button>
              <p className="wr-help">
                {duplicate
                  ? "One account per phone number."
                  : "The customer ID is generated automatically."}
              </p>
            </>
          )
        }
      >
        {!online && (
          <Notice tone="inverse">
            Internet is required to register a customer. Connect to register.
          </Notice>
        )}
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {uncertain && (
          <Notice tone="warning">
            The result is not confirmed. Retry sends the same details and
            operation ID. Keep this page open until confirmed; ask a station
            manager for help before starting a different registration.
          </Notice>
        )}
        {doneId ? (
          result ? (
            <>
              <ResultBlock title="Card linked">
                {result.customer.name} can start earning on the next sale.
              </ResultBlock>
              <div className="wr-loyalty-card">
                <div className="wr-loyalty-head">
                  <Brand surface="" />
                  <span className="wr-historical">Registration receipt</span>
                </div>
                <div>
                  <div className="wr-sub">Loyalty member</div>
                  <div className="wr-code wr-accent">{result.cardCode}</div>
                </div>
                <div className="wr-loyalty-foot">
                  <div>
                    <b>{result.customer.name}</b>
                    <div className="wr-sub">
                      {categoryLabel(result.customer.category)} ·{" "}
                      <span className="wr-mono">
                        {result.customer.customerCode}
                      </span>
                    </div>
                  </div>
                  <div className="wr-sub">
                    Whales Energy · {result.registeredAtStation.name}
                  </div>
                </div>
              </div>
              <div className="wr-card">
                <KeyValueList
                  items={[
                    { label: "Phone", value: result.customer.phone },
                    {
                      label: "Category",
                      value: categoryLabel(result.customer.category),
                    },
                    {
                      label: "Registered by",
                      value: `${result.registeredBy.name} · ${result.registeredBy.code}`,
                    },
                    {
                      label: "Registered",
                      value: formatTime(result.registeredAt),
                    },
                  ]}
                />
              </div>
              <p className="wr-help">
                This receipt records the original registration. The current card
                is checked online before a new sale.
              </p>
            </>
          ) : (
            <Notice role="status">
              This registration receipt is no longer on this page. Scan the
              customer’s card on New sale, or register another customer. No
              customer details are restored from this link.
            </Notice>
          )
        ) : (
          <>
            {duplicate && (
              <Notice tone="danger" role="alert">
                <b>This phone number already has an account.</b>
                <br />
                Find the existing customer instead of registering again. Phone
                changes and replacement cards are done by an admin.
              </Notice>
            )}
            <section className="wr-section">
              <h2 className="wr-section-title">Customer details</h2>
              <TextField
                label="Customer name"
                autoComplete="off"
                maxLength={120}
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label="Phone number"
                inputMode="tel"
                autoComplete="off"
                maxLength={32}
                value={phone}
                disabled={locked}
                error={
                  duplicate
                    ? existing
                      ? `Registered to ${existing.customer.name} · ${existing.customer.customerCode}${existing.cardCode ? ` · card ${existing.cardCode}` : ". No active card."}`
                      : "This phone number already has an account."
                    : undefined
                }
                helper="One account per phone number."
                onChange={(e) => {
                  generation.current++;
                  setPhone(e.target.value);
                  setDuplicate(false);
                  setExisting(null);
                  setError(null);
                }}
              />
              <div className="wr-field">
                <div className="wr-label">
                  <span id="registration-category-label">
                    Customer category
                  </span>
                  <span className="wr-hint">Fixed at registration</span>
                </div>
                <Button
                  className="wr-category-trigger"
                  variant="secondary"
                  aria-labelledby="registration-category-label registration-category-value"
                  aria-expanded={categoriesOpen}
                  aria-controls="registration-categories"
                  disabled={locked}
                  onClick={() => setCategoriesOpen(!categoriesOpen)}
                >
                  <span id="registration-category-value">
                    {category ? categoryLabel(category) : "Choose a category"}
                  </span>
                  <ChevronDown aria-hidden />
                </Button>
                {categoriesOpen && (
                  <div
                    id="registration-categories"
                    className="wr-category-panel"
                    role="group"
                    aria-label="Customer categories"
                  >
                    {categories.map((item) => (
                      <Button
                        variant="secondary"
                        key={item.value}
                        aria-pressed={category === item.value}
                        onClick={() => {
                          setCategory(item.value);
                          setCategoriesOpen(false);
                        }}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="wr-help">
                  Decides the customer&apos;s leaderboard. It cannot be changed
                  by attendants later.
                </div>
              </div>
            </section>
            <section className="wr-section">
              <h2 className="wr-section-title">Loyalty card</h2>
              <TextField
                label="Card number"
                mono
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={32}
                value={card}
                disabled={locked}
                onChange={(e) => {
                  setCard(e.target.value);
                  setSource("code");
                }}
                action={
                  <Button
                    variant="secondary"
                    disabled={locked || !online}
                    icon={<ScanLine aria-hidden />}
                    onClick={() => setCamera(true)}
                  >
                    Scan
                  </Button>
                }
                helper={
                  duplicate
                    ? "The failed registration did not link this card."
                    : "Scan or type an unused card from an active batch."
                }
              />
            </section>
            {existing && !existingUsable && (
              <Notice tone="warning">
                This customer has no usable active card. Ask a station manager
                for help. Registration cannot replace a card.
              </Notice>
            )}
            {existing && (
              <Button
                variant="secondary"
                disabled={busy || !online}
                onClick={() => void lookupExisting()}
              >
                Find existing customer again
              </Button>
            )}
          </>
        )}
        {camera && (
          <Camera
            mode="qr"
            onClose={() => setCamera(false)}
            onPhoto={() => {}}
            onCode={(value) => {
              setCard(value);
              setSource("qr");
            }}
          />
        )}
      </Frame>
    </div>
  );
}
