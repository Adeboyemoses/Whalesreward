"use client";

import { useState, type ReactNode } from "react";
import { ScanLine, ArrowLeft, Eye, EyeOff } from "lucide-react";
import {
  AppHeader,
  BottomNav,
  Button,
  TextField,
  SegmentedControl,
  StatusPill,
  Notice,
  KeyValueList,
  ListRow,
  PhotoCapture,
  ResultBlock,
  LoyaltyCard,
  Sidebar,
  DataTable,
  KPI,
  Attention,
  AttendantShell,
  AdminShell,
  type NavItem,
  type NavLabel,
  type Tone,
} from "@/ui";

const names = [
  "AppHeader",
  "BottomNav",
  "Button",
  "TextField",
  "SegmentedControl",
  "StatusPill",
  "Notice",
  "KeyValueList",
  "ListRow",
  "PhotoCapture",
  "ResultBlock",
  "LoyaltyCard",
  "Sidebar",
  "DataTable",
  "KPI",
  "Attention",
  "AttendantShell",
  "AdminShell",
];
const nav: NavItem[] = [
  "Sale",
  "Register",
  "History",
  "Uploads",
  "Account",
].map((label) => ({
  label: label as NavLabel,
  href: `#${label === "Account" ? "KeyValueList" : label === "Uploads" ? "ListRow" : label === "Sale" ? "AttendantShell" : label === "Register" ? "TextField" : "DataTable"}`,
}));
const sidebar = [
  "Overview",
  "Sales",
  "Customers",
  "Leaderboards",
  "Attendants",
  "Loyalty cards",
  "Station pumps",
  "Product prices",
  "Reports",
  "Audit history",
  "Settings",
  "Admin users & roles",
].map((label) => ({
  label,
  href: label === "Sales" ? "#DataTable" : "#AdminShell",
  count: label === "Sales" ? 4 : undefined,
}));
const context = (
  <>
    <span>Station 01</span>
    <span className="wr-dot">·</span>
    <span>Pump 02</span>
    <span className="wr-dot">·</span>
    <span>PMS</span>
    <span className="wr-dot">·</span>
    <b>Grace Okon</b>
    <span className="wr-dot">·</span>
    <span className="wr-mono">grace.okon</span>
  </>
);
const receipt = [
  { label: "Recorded by", value: "Grace Okon" },
  { label: "Attendant ID", value: "STAFF002", mono: true },
  { label: "Product", value: "PMS · Pump 02" },
  { label: "Bought into", value: "Vehicle" },
  { label: "Quantity", value: "20 litres" },
  { label: "Rate used", value: "₦1,000.00 / litre" },
];
function Section({
  name,
  children,
  wide = false,
}: {
  name: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section id={name} data-component={name} className="wr-gallery-section">
      <h2 className="display-sm">{name}</h2>
      <div data-preview className="wr-gallery-preview">
        <div className={wide ? "wr-gallery-wide" : "wr-gallery-phone"}>
          {children}
        </div>
      </div>
    </section>
  );
}
const statuses: { label: string; tone: Tone }[] = [
  { label: "Synced", tone: "synced" },
  { label: "Saved on phone", tone: "pending" },
  { label: "Awaiting price review", tone: "held" },
  { label: "Photo upload failed", tone: "failed" },
  { label: "Offline", tone: "offline" },
  { label: "Online", tone: "online" },
  { label: "Registered", tone: "neutral" },
];
function FixtureRows() {
  return (
    <div className="wr-list">
      <ListRow
        href="#KeyValueList"
        name="Amina Bello"
        amount="₦20,000.00"
        metadata="20 litres · Vehicle · 21 Oct 2026 · 10:42 AM"
        status="Synced"
        tone="synced"
        action="Editable until midnight"
      />
      <ListRow
        href="#KeyValueList"
        name="Tunde Adebayo"
        amount="₦10,000.00"
        metadata="10 litres · Keg · 10:45 AM"
        status="Saved on phone"
        tone="pending"
      />
      <ListRow
        href="#PhotoCapture"
        name="Amina Bello"
        amount="₦15,000.00"
        metadata="15 litres · Bike · 10:42 AM"
        status="Photo upload failed"
        tone="failed"
      />
    </div>
  );
}
function FixtureTable() {
  return (
    <DataTable
      caption="Recorded purchases"
      summary="9 records shown · 6 completed · ₦85,000.00 recorded spend"
      columns={[
        { key: "customer", label: "Sale / customer" },
        { key: "purchase", label: "Purchase", amount: true },
        { key: "attendant", label: "Attendant / pump" },
        { key: "status", label: "Status" },
        { key: "action", label: "Action", align: "right" },
      ]}
      rows={[
        {
          id: "S001",
          name: "Amina Bello",
          amount: "₦20,000.00",
          quantity: "20 litres",
          status: "Completed",
          tone: "synced",
        },
        {
          id: "S003",
          name: "Tunde Adebayo",
          amount: "₦15,000.00",
          quantity: "15 litres",
          status: "Possible duplicate",
          tone: "held",
        },
        {
          id: "S006",
          name: "Amina Bello",
          amount: "₦8,000.00",
          quantity: "8 litres",
          status: "Incomplete upload",
          tone: "pending",
        },
      ].map((row) => ({
        id: row.id,
        cells: {
          customer: (
            <>
              <b>{row.name}</b>
              <span className="wr-sub">
                <span className="wr-mono">{row.id}</span> · 10:42 AM
              </span>
            </>
          ),
          purchase: (
            <>
              {row.amount}
              <span className="wr-sub">{row.quantity} · PMS</span>
            </>
          ),
          attendant: (
            <>
              <b>Grace Okon</b>
              <span className="wr-sub">grace.okon · Pump 02</span>
            </>
          ),
          status: (
            <StatusPill tone={row.tone as Tone} small>
              {row.status}
            </StatusPill>
          ),
          action: (
            <a
              className="wr-btn-link"
              aria-label={`View sale ${row.id}`}
              href="#KeyValueList"
            >
              View
            </a>
          ),
        },
      }))}
    />
  );
}
function FixtureKpis() {
  return (
    <div className="wr-kpis">
      <KPI
        label="Recorded spend today"
        value="₦70,000.00"
        footnote="Completed sales only"
      />
      <KPI
        label="Completed purchases"
        value="5"
        footnote="Details and photo received"
      />
      <KPI label="Customers registered" value="5" footnote="Since launch" />
    </div>
  );
}
function FixtureAttention() {
  return (
    <div className="wr-attn">
      <Attention
        count={1}
        title="Late correction"
        reason="Admin decision required"
        href="#DataTable"
      />
      <Attention
        count={2}
        title="Incomplete uploads"
        reason="Photos pending"
        href="#DataTable"
      />
      <Attention
        count={1}
        title="Possible duplicate"
        reason="Counted until cancelled"
        href="#DataTable"
      />
    </div>
  );
}

export default function Gallery() {
  const [basis, setBasis] = useState("amount");
  const [medium, setMedium] = useState("Vehicle");
  const [value, setValue] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [taken, setTaken] = useState(true);
  const [connection, setConnection] = useState<"online" | "offline">("online");
  const [active, setActive] = useState<NavLabel>("Sale");
  const [message, setMessage] = useState(
    "Preview controls do not record sales.",
  );
  return (
    <div className="wr-root wr-gallery">
      <header className="wr-gallery-intro">
        <h1 className="display-lg">Design system gallery</h1>
        <Notice>
          Development fixtures only. No accounts, purchases, uploads or loyalty
          credit are created.
        </Notice>
        <nav aria-label="Gallery components" className="wr-gallery-links">
          {names.map((name) => (
            <a key={name} href={`#${name}`}>
              {name}
            </a>
          ))}
        </nav>
        <p className="wr-help" role="status">
          {message}
        </p>
      </header>
      <Section name="AppHeader">
        <AppHeader title="New sale" context={context} connection={connection} />
        <Button
          variant="secondary"
          onClick={() =>
            setConnection(connection === "online" ? "offline" : "online")
          }
        >
          Toggle connection preview
        </Button>
        {connection === "offline" && (
          <Notice tone="inverse">
            <b>Offline.</b> Preview of capture within the 24-hour access window.
          </Notice>
        )}
      </Section>
      <Section name="BottomNav">
        <BottomNav items={nav} active={active} pending={2} />
        <SegmentedControl
          label="Active navigation preview"
          value={active}
          options={[
            { value: "Sale", label: "Sale" },
            { value: "Uploads", label: "Uploads" },
            { value: "Account", label: "Account" },
          ]}
          onChange={(value) => setActive(value as NavLabel)}
        />
        <BottomNav items={nav} active="Account" pending={0} />
      </Section>
      <Section name="Button">
        <Button
          cta
          onClick={() =>
            setMessage("Save sale preview selected. No sale was recorded.")
          }
        >
          Save sale
        </Button>
        <div className="wr-gallery-wrap">
          <Button
            icon={<ScanLine aria-hidden="true" strokeWidth={1.75} />}
            onClick={() =>
              setMessage("Scan QR preview selected. No camera opened.")
            }
          >
            Scan QR
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMessage("Find preview selected.")}
          >
            Find
          </Button>
          <Button
            variant="ghost"
            icon={<ArrowLeft aria-hidden="true" strokeWidth={1.75} />}
            onClick={() => setMessage("Back preview selected.")}
          >
            Back
          </Button>
        </div>
        <div className="wr-gallery-wrap">
          <Button disabled aria-describedby="save-disabled">
            Save sale
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              setMessage("Sign-out preview only. No session changed.")
            }
          >
            Sign out with pending sales
          </Button>
          <Button
            variant="link"
            onClick={() => setMessage("Edit cancelled in preview.")}
          >
            Cancel edit
          </Button>
        </div>
        <p id="save-disabled" className="wr-help">
          Scan or enter a card to begin.
        </p>
        <Button loading>Saving…</Button>
        <Button variant="secondary" small>
          Small admin variant
        </Button>
      </Section>
      <Section name="TextField">
        <TextField
          id="preview-phone"
          label="Phone number"
          placeholder="080… or +234…"
          inputMode="tel"
          helper="One account per phone number."
        />
        <TextField
          id="preview-card"
          label="Card number"
          mono
          defaultValue="A7K3M9Q"
          action={
            <Button
              variant="secondary"
              icon={<ScanLine aria-hidden="true" strokeWidth={1.75} />}
              onClick={() => setMessage("Scan preview selected.")}
            >
              Scan
            </Button>
          }
        />
        <TextField
          id="preview-amount"
          label="Amount"
          hint="Two decimals max"
          prefix="₦"
          large
          defaultValue="100.015"
          error="Enter an amount with at most two decimals."
        />
        <TextField
          label="Password"
          type={passwordVisible ? "text" : "password"}
          autoComplete="off"
          action={
            <Button
              variant="secondary"
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              onClick={() => setPasswordVisible(!passwordVisible)}
              icon={
                passwordVisible ? (
                  <EyeOff aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )
              }
            />
          }
        />
        <TextField
          label="Bought into"
          value="Cylinder"
          readOnly
          helper="Cooking gas uses Cylinder."
        />
      </Section>
      <Section name="SegmentedControl">
        <SegmentedControl
          label="Entry basis"
          value={basis}
          options={[
            { value: "amount", label: "Amount (₦)" },
            { value: "quantity", label: "Litres" },
          ]}
          onChange={(next) => {
            setBasis(next);
            setValue("");
          }}
        />
        <TextField
          label={basis === "amount" ? "Entered amount" : "Entered litres"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          helper="Switching clears the typed value."
        />
        <SegmentedControl
          label="Bought into"
          value={medium}
          options={["Vehicle", "Keg", "Three-wheeler", "Bike"].map((label) => ({
            value: label,
            label,
          }))}
          onChange={setMedium}
        />
        <TextField label="Gas bought into" value="Cylinder" readOnly />
        <SegmentedControl
          label="Gas entry basis"
          value="amount"
          options={[
            { value: "amount", label: "Amount (₦)" },
            { value: "kilograms", label: "Kilograms" },
          ]}
          onChange={() => setMessage("Kilograms preview selected.")}
        />
        <SegmentedControl
          label="Disabled entry preview"
          value="amount"
          disabled
          options={[
            { value: "amount", label: "Amount" },
            { value: "quantity", label: "Litres" },
          ]}
          onChange={() => {}}
        />
      </Section>
      <Section name="StatusPill" wide>
        <div className="wr-gallery-wrap">
          {statuses.map((status) => (
            <StatusPill key={status.label} tone={status.tone}>
              {status.label}
            </StatusPill>
          ))}
          <StatusPill tone="synced" small>
            Completed
          </StatusPill>
          <StatusPill tone="held" small>
            Possible duplicate
          </StatusPill>
          <StatusPill tone="pending" small>
            Printed
          </StatusPill>
          <StatusPill tone="pending">Uploading</StatusPill>
          <StatusPill tone="held">Held</StatusPill>
          <StatusPill tone="online" plain>
            Online
          </StatusPill>
        </div>
      </Section>
      <Section name="Notice">
        <Notice>
          Corrections must reach the server <b>before midnight on 21 Oct</b>.
        </Notice>
        <Notice tone="warning">
          <b>Saved on phone.</b> This sale is not counted toward loyalty until
          it uploads.
        </Notice>
        <Notice tone="success">
          Details and photo received. Added to the customer&apos;s loyalty
          total.
        </Notice>
        <Notice tone="danger">
          The captured price could not be verified.{" "}
          <b>An admin needs to review this sale.</b>
        </Notice>
        <Notice tone="inverse">
          <b>Offline.</b> You can keep recording sales for 24 hours after your
          last online sign-in.
        </Notice>
      </Section>
      <Section name="KeyValueList">
        <div className="wr-card">
          <KeyValueList items={receipt} total="₦20,000.00" />
        </div>
      </Section>
      <Section name="ListRow">
        <FixtureRows />
      </Section>
      <Section name="PhotoCapture">
        <PhotoCapture
          onCapture={() => {
            setTaken(true);
            setMessage("Photo fixture selected. No camera opened.");
          }}
        />
        <PhotoCapture
          src={taken ? "/design-system/meter-fixture.svg" : undefined}
          alt="Fictional meter fixture, not capture evidence"
          takenAt="10:42 AM"
          onCapture={() => setTaken(!taken)}
        />
        <PhotoCapture
          onCapture={() => setMessage("Camera-denial fixture only.")}
          error="Camera access was denied. Allow the camera and try again."
        />
        <StatusPill tone="failed">Photo upload failed</StatusPill>
        <PhotoCapture
          src="/design-system/meter-fixture.svg"
          alt="Retained fictional meter fixture"
          takenAt="10:42 AM"
          onCapture={() => setMessage("Retake preview selected.")}
        />
      </Section>
      <Section name="ResultBlock" wide>
        <div className="wr-gallery-results">
          <div className="wr-card">
            <ResultBlock title="Sale synced">
              Details and photo received. Added to the customer&apos;s loyalty
              total.
            </ResultBlock>
          </div>
          <div className="wr-card">
            <ResultBlock title="Saved on phone" tone="pending">
              Upload pending. Not counted toward loyalty until it uploads.
            </ResultBlock>
          </div>
          <div className="wr-card">
            <ResultBlock title="Awaiting price review" tone="held">
              Not counted toward loyalty until an admin reviews it.
            </ResultBlock>
          </div>
          <div className="wr-card">
            <ResultBlock title="Recording paused" tone="failed">
              No new sale recorded. Reconnect and sign in with the same account.
            </ResultBlock>
          </div>
        </div>
      </Section>
      <Section name="LoyaltyCard">
        <LoyaltyCard
          name="Amina Bello"
          code="A7K3M9Q"
          category="Car owner"
          customerId="CUST001"
          station="Station 01"
        />
      </Section>
      <Section name="Sidebar" wide>
        <div className="wr-gallery-sidebar">
          <Sidebar items={sidebar} active="Overview" station="Station 01" />
        </div>
      </Section>
      <Section name="DataTable" wide>
        <FixtureTable />
      </Section>
      <Section name="KPI" wide>
        <FixtureKpis />
      </Section>
      <Section name="Attention" wide>
        <FixtureAttention />
      </Section>
      <section id="AttendantShell" data-component="AttendantShell">
        <h2 className="display-sm">Attendant shell</h2>
        <div className="wr-gallery-shell">
          <AttendantShell
            title="Component preview"
            context={context}
            nav={nav}
            active="Sale"
            pending={2}
            action={
              <Button
                cta
                onClick={() => setMessage("Shell action preview selected.")}
              >
                Preview action
              </Button>
            }
          >
            <Notice>Fictional shell preview. No sale is recorded.</Notice>
            <TextField label="Card number" placeholder="e.g. A7K3M9Q" mono />
            <PhotoCapture
              onCapture={() => setMessage("Shell camera preview only.")}
            />
            <div className="wr-card">
              <KeyValueList items={receipt} />
            </div>
          </AttendantShell>
        </div>
      </section>
      <section id="AdminShell" data-component="AdminShell">
        <h2 className="display-sm">Admin shell</h2>
        <div className="wr-gallery-shell">
          <AdminShell items={sidebar} active="Overview" station="Station 01">
            <div className="wr-pagehead">
              <div>
                <p className="wr-eyebrow">Station 01 · Fixture preview</p>
                <h1 className="wr-page-title">Overview</h1>
              </div>
            </div>
            <FixtureKpis />
            <FixtureAttention />
            <FixtureTable />
          </AdminShell>
        </div>
      </section>
    </div>
  );
}
