"use client";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { Button, KeyValueList, Notice } from "@/ui";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  useOwnCount,
  productName,
  pumpName,
  WindowNotice,
} from "../_components/runtime";
function Account() {
  const { state } = useAttendant();
  const count = useOwnCount();
  const router = useRouter();
  const session = state!.session!;
  return (
    <Frame
      title="Your account"
      context="This account is assigned to one pump."
      active="Account"
    >
      <div className="wr-card wr-quiet wr-person">
        <span className="wr-person-icon">
          <UserRound aria-hidden />
        </span>
        <div>
          <h2 className="wr-person-title">{session.account.name}</h2>
          <p className="wr-secondary">
            Attendant · {pumpName(session.pump.code)} ·{" "}
            {productName[session.product.code]}
          </p>
        </div>
      </div>
      <div className="wr-card">
        <KeyValueList
          items={[
            {
              label: "Username",
              value: (
                <span className="wr-username">{session.account.username}</span>
              ),
              mono: true,
            },
            {
              label: "Attendant ID",
              value: session.account.staffCode,
              mono: true,
            },
            { label: "Station", value: session.station.name },
            {
              label: "Assigned pump",
              value: `${pumpName(session.pump.code)} · ${productName[session.product.code]}`,
            },
            {
              label: "Pending uploads",
              value:
                count === null
                  ? "Checking…"
                  : `${count} ${count === 1 ? "sale" : "sales"}`,
            },
          ]}
        />
      </div>
      {session.reassignmentRequiresSignIn && (
        <Notice tone="warning">
          Your pump assignment has changed. Sign out and sign in online with
          your own account before using the new pump.
        </Notice>
      )}
      <Notice>
        Every sale keeps its original attendant and pump. If an admin changes
        your pump, sign out and sign in online with your own account before
        using it. Never use a colleague&apos;s login.
      </Notice>
      <WindowNotice />
      <Button
        variant="secondary"
        cta
        icon={<LogOut aria-hidden />}
        onClick={() => go(router, "/attendant/account/hand-over")}
      >
        Sign out / hand over device
      </Button>
    </Frame>
  );
}
export default function AccountPage() {
  return (
    <AccessGate>
      <Account />
    </AccessGate>
  );
}
