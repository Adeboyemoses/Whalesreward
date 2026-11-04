"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, UserRound } from "lucide-react";
import { needsUpload } from "@/client/offline/sync-status";
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
  const count = useOwnCount();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const session = state!.session!;
  async function signOut() {
    if (!client || flight.current) return;
    flight.current = true;
    const accountId = session.account.id;
    const contextId = session.captureContextId;
    const current = () =>
      client.getState().session?.account.id === accountId &&
      client.getState().session?.captureContextId === contextId;
    setBusy(true);
    setError(null);
    try {
      const pending = (await client.ownSales()).filter(needsUpload).length;
      if (!current()) return;
      if (pending !== count) {
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
      else if (current()) setError(message(e));
    } finally {
      if (current()) setBusy(false);
      flight.current = false;
    }
  }
  async function uploadFirst() {
    if (!client || uploadFlight.current || flight.current || !online) return;
    uploadFlight.current = true;
    setUploading(true);
    setError(null);
    const accountId = session.account.id;
    const contextId = session.captureContextId;
    const current = () =>
      client.getState().access === "active" &&
      client.getState().session?.account.id === accountId &&
      client.getState().session?.captureContextId === contextId;
    try {
      await client.retryUploads();
      if (!current()) return;
      const pending = (await client.ownSales()).filter(needsUpload).length;
      if (!current()) return;
      if (pending) {
        setError(
          "Some sales are still pending. Uploads will retry while you stay signed in, respecting any retry delay. You can also sign out and leave them on this phone.",
        );
        return;
      }
      await client.signOut();
      go(router, "/attendant/sign-in", true);
    } catch (e) {
      if (current()) setError(message(e));
    } finally {
      uploadFlight.current = false;
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
                  ? "Sign-out follows confirmed upload. Sales held for review are not credited."
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
