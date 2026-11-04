"use client";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { Button, KeyValueList } from "@/ui";
import {
  AccessGate,
  Frame,
  useAttendant,
  useOwnCount,
  productName,
  pumpName,
  formatTime,
  WindowNotice,
} from "../_components/runtime";
function Expired() {
  const { state, online } = useAttendant();
  const count = useOwnCount();
  const router = useRouter();
  const session = state!.session!;
  return (
    <Frame
      title="Offline access expired"
      context="Your pending uploads remain on this phone."
      noNav
      action={
        <>
          <Button
            cta
            disabled={!online}
            onClick={() => router.push("/attendant/sign-in")}
          >
            Continue to sign-in
          </Button>
          {!online && (
            <p className="wr-help">Connect to the internet to sign in.</p>
          )}
        </>
      }
    >
      <div className="wr-result">
        <div className="wr-result-icon wr-held">
          <WifiOff aria-hidden />
        </div>
        <h2>Recording paused</h2>
        <p>Reconnect and sign in with the same account to continue.</p>
      </div>
      <div className="wr-card">
        <KeyValueList
          items={[
            { label: "Attendant", value: session.account.name },
            {
              label: "Username / ID",
              value: (
                <span className="wr-username">
                  {session.account.username} · {session.account.staffCode}
                </span>
              ),
              mono: true,
            },
            {
              label: "Assigned pump",
              value: `${pumpName(session.pump.code)} · ${productName[session.product.code]}`,
            },
            {
              label: "Last online sign-in",
              value: formatTime(session.lastOnlineSignInAt),
            },
            {
              label: "Offline access ended",
              value: formatTime(session.offlineExpiresAt),
            },
          ]}
        />
      </div>
      <div className="wr-card wr-quiet">
        <h2 className="wr-person-title">
          {count === null
            ? "Pending sales and photos preserved"
            : `${count} sales and photos preserved`}
        </h2>
        <p>
          Uploads are paused. Sign in online as {session.account.username} to
          resume. These sales keep their original attendant, pump and captured
          price.
        </p>
      </div>
      <WindowNotice />
    </Frame>
  );
}
export default function ExpiredPage() {
  return (
    <AccessGate allowExpired>
      <Expired />
    </AccessGate>
  );
}
