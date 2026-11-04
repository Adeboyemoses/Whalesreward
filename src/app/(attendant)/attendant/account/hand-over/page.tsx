"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, UserRound } from "lucide-react";
import { Button, Notice } from "@/ui";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  useOwnCount,
  message,
  pumpName,
  productName,
} from "../../_components/runtime";
function Handover() {
  const { client, state, online } = useAttendant();
  const observedCount = useOwnCount();
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const count = confirmedCount ?? observedCount;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const session = state!.session!;
  async function signOut() {
    if (!client || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      const pending = (await client.ownSales()).filter(
        (row) => !["credited", "held", "cancelled"].includes(row.state),
      ).length;
      if (pending !== count) {
        setConfirmedCount(pending);
        setError(
          "The pending count changed. Check the sales still on this phone, then confirm sign-out again.",
        );
        return;
      }
      await client.signOut();
      go(router, "/attendant/sign-in", true);
    } catch (e) {
      if (client.getState().access === "signed_out")
        go(router, "/attendant/sign-in", true);
      else setError(message(e));
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }
  return (
    <Frame
      title="Hand over device"
      context="Check uploads before signing out."
      active="Account"
      action={
        <>
          {count !== 0 && (
            <>
              <Button cta disabled icon={<CloudUpload aria-hidden />}>
                Upload, then sign out
              </Button>
              <p className="wr-help">
                {online
                  ? "Uploads are not available yet. Keep these sales on this phone."
                  : "Connect to the internet to upload. Sales stay on this phone."}
              </p>
            </>
          )}
          <Button
            cta
            variant={count === 0 ? "primary" : "secondary"}
            loading={busy}
            disabled={count === null}
            onClick={() => void signOut()}
          >
            {busy
              ? "Signing out…"
              : count === 0
                ? "Sign out"
                : "Sign out with pending sales"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => go(router, "/attendant/account")}
          >
            Stay signed in
          </Button>
        </>
      }
    >
      <div className="wr-card wr-quiet wr-person">
        <span className="wr-avatar wr-person-icon">
          <UserRound aria-hidden />
        </span>
        <div>
          <h2 className="wr-person-title">{session.account.name}</h2>
          <p className="wr-secondary">
            {session.account.username} · {pumpName(session.pump.code)} ·{" "}
            {productName[session.product.code]} · {session.station.name}
          </p>
        </div>
      </div>
      <div className="wr-card">
        <h2 className="wr-person-title">
          {count === null
            ? "Checking pending sales…"
            : `${count} ${count === 1 ? "sale" : "sales"} still pending`}
        </h2>
        <p>
          These sales and photos remain on this phone. They have not been added
          to loyalty yet.
        </p>
      </div>
      <Notice>
        If you sign out now, uploads pause. Sign in to this same account again
        to resume. The next account cannot see these sales.
      </Notice>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </Frame>
  );
}
export default function HandoverPage() {
  return (
    <AccessGate>
      <Handover />
    </AccessGate>
  );
}
