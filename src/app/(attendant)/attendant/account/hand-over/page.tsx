"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, UserRound } from "lucide-react";
import { Button, Notice } from "@/ui";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  useOwnPendingWork,
  message,
  pumpName,
  productName,
} from "../../_components/runtime";
function Handover() {
  const { client, state, online } = useAttendant();
  const { pending, error: pendingError } = useOwnPendingWork();
  const count = pending ? pending.sales + pending.corrections : null;
  const hasCorrections = !!pending?.corrections;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const session = state!.session!;
  const mounted = useRef(false);
  const logoutIntent = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      logoutIntent.current += 1;
    };
  }, []);
  function staySignedIn() {
    logoutIntent.current += 1;
    setUploading(false);
    go(router, "/attendant/account");
  }
  async function signOut() {
    if (!client || flight.current) return;
    flight.current = true;
    uploadFlight.current = false;
    setUploading(false);
    const intent = ++logoutIntent.current;
    const stillHere = () => mounted.current && logoutIntent.current === intent;
    const accountId = session.account.id;
    const contextId = session.captureContextId;
    const current = () =>
      stillHere() &&
      client.getState().session?.account.id === accountId &&
      client.getState().session?.captureContextId === contextId;
    setBusy(true);
    setError(null);
    try {
      const latest = await client.ownPendingUploads();
      if (!current()) return;
      if (
        !pending ||
        latest.sales !== pending.sales ||
        latest.corrections !== pending.corrections
      ) {
        setError(
          "The pending count changed. Check the saved work still on this phone, then confirm sign-out again.",
        );
        return;
      }
      if (!current()) return;
      await client.signOut();
      if (stillHere()) go(router, "/attendant/sign-in", true);
    } catch (e) {
      if (stillHere() && client.getState().access === "signed_out")
        go(router, "/attendant/sign-in", true);
      else if (current()) setError(message(e));
    } finally {
      if (current()) setBusy(false);
      if (stillHere()) flight.current = false;
    }
  }
  async function uploadFirst() {
    if (!client || uploadFlight.current || flight.current || !online) return;
    uploadFlight.current = true;
    const intent = ++logoutIntent.current;
    const stillHere = () => mounted.current && logoutIntent.current === intent;
    setUploading(true);
    setError(null);
    const accountId = session.account.id;
    const contextId = session.captureContextId;
    const current = () =>
      stillHere() &&
      client.getState().access === "active" &&
      client.getState().session?.account.id === accountId &&
      client.getState().session?.captureContextId === contextId;
    try {
      await client.retryUploads();
      if (!current()) return;
      const latest = await client.ownPendingUploads();
      if (!current()) return;
      if (latest.sales || latest.corrections) {
        setError(
          latest.corrections
            ? "Some sales or corrections are still pending. Uploads will retry while you stay signed in, respecting any retry delay. You can also sign out and leave them on this phone. Prior accepted sale values remain effective."
            : "Some sales are still pending. Uploads will retry while you stay signed in, respecting any retry delay. You can also sign out and leave them on this phone.",
        );
        return;
      }
      if (!current()) return;
      await client.signOut();
      if (stillHere()) go(router, "/attendant/sign-in", true);
    } catch (e) {
      if (current()) setError(message(e));
    } finally {
      if (stillHere()) uploadFlight.current = false;
      if (current()) setUploading(false);
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
              <Button
                cta
                loading={uploading}
                disabled={!online || count === null || busy}
                icon={<CloudUpload aria-hidden />}
                onClick={() => void uploadFirst()}
              >
                {uploading ? "Uploading…" : "Upload, then sign out"}
              </Button>
              <p className="wr-help">
                {online
                  ? hasCorrections
                    ? "Sign-out follows confirmed upload of every sale and correction. A correction awaiting review does not change accepted values."
                    : "Sign-out follows confirmed upload. Sales held for review are not credited."
                  : hasCorrections
                    ? "Connect to the internet to upload. Sales and corrections stay on this phone."
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
                : hasCorrections
                  ? "Sign out with pending changes"
                  : "Sign out with pending sales"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={staySignedIn}>
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
            : hasCorrections
              ? `${pending!.sales} ${pending!.sales === 1 ? "sale" : "sales"} · ${pending!.corrections} ${pending!.corrections === 1 ? "correction" : "corrections"} still pending`
              : `${count} ${count === 1 ? "sale" : "sales"} still pending`}
        </h2>
        <p>
          {hasCorrections
            ? "Saved corrections remain on this phone until the server receives them. Their prior accepted sale values remain effective until a server decision. Any original sales still waiting to upload have not been added to loyalty yet."
            : "These sales and photos remain on this phone. They have not been added to loyalty yet."}
        </p>
      </div>
      <Notice>
        If you sign out now, uploads pause. Sign in to this same account again
        to resume. The next account cannot see these{" "}
        {hasCorrections ? "sales or corrections" : "sales"}.
      </Notice>
      {pendingError && (
        <Notice tone="danger" role="alert">
          {pendingError}
        </Notice>
      )}
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
