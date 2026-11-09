"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { Button, KeyValueList, Notice } from "@/ui";
import type { ConfiguredAssignment } from "@/client/types";
import { needsUpload } from "@/client/offline/sync-status";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  useOwnSales,
  productName,
  pumpName,
  WindowNotice,
  message,
} from "../_components/runtime";
function Account() {
  const { client, state, online, reassignmentRequiresSignIn } = useAttendant();
  const { rows } = useOwnSales();
  const router = useRouter();
  const session = state!.session!;
  const count = rows ? rows.filter(needsUpload).length : null;
  const [configured, setConfigured] = useState<ConfiguredAssignment | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!client || !online) return;
    let live = true;
    void client
      .configuredAssignment()
      .then(
        (result) => {
          if (live) {
            setConfigured(result);
            setError(null);
          }
        },
        (failure) => {
          if (live) setError(message(failure));
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, online, session.captureContextId, session.serverTime, retry]);
  const changed =
    reassignmentRequiresSignIn ||
    session.reassignmentRequiresSignIn ||
    !!configured?.reassignmentRequiresSignIn;
  const newAssignment = configured?.reassignmentRequiresSignIn
    ? configured.configured
    : undefined;
  const pendingPumps = new Map<string, number>();
  for (const row of rows ?? [])
    if (needsUpload(row))
      pendingPumps.set(
        row.captureDisplay.pumpCode,
        (pendingPumps.get(row.captureDisplay.pumpCode) ?? 0) + 1,
      );
  const signOut = () => go(router, "/attendant/account/hand-over");
  return (
    <Frame
      title="Your account"
      context="This account is assigned to one pump."
      active="Account"
      assignmentChanged={changed}
      configuredAssignment={newAssignment}
      action={
        changed ? (
          <>
            <Button cta icon={<LogOut aria-hidden />} onClick={signOut}>
              Sign out to switch pump
            </Button>
            <p className="wr-help">
              Only this same account can sign back in to resume its pending
              uploads.
            </p>
          </>
        ) : undefined
      }
    >
      <div className="wr-card wr-quiet wr-person">
        <span className="wr-avatar wr-person-icon">
          <UserRound aria-hidden />
        </span>
        <div>
          <h2 className="wr-person-title">{session.account.name}</h2>
          <p className="wr-secondary">
            Attendant · {pumpName(session.pump.code)} ·{" "}
            {productName[session.product.code]}
            {changed ? " (current session)" : ""}
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
              label: changed ? "Current pump" : "Assigned pump",
              value: `${pumpName(session.pump.code)} · ${productName[session.product.code]}`,
            },
            ...(newAssignment
              ? [
                  {
                    label: "New assignment",
                    value: `${newAssignment.pump.name} · ${productName[newAssignment.product.code]}`,
                  },
                ]
              : []),
            {
              label: "Pending uploads",
              value:
                count === null
                  ? "Checking…"
                  : `${count} ${count === 1 ? "sale" : "sales"}${changed && pendingPumps.size ? " · captured at " + [...pendingPumps].map(([pump]) => pumpName(pump)).join(", ") : ""}`,
            },
          ]}
        />
      </div>
      {online && loading && (
        <p className="wr-help" role="status">
          Checking configured assignment…
        </p>
      )}
      {error && (
        <Notice tone="warning" role="alert">
          {error}{" "}
          {online && (
            <Button
              variant="ghost"
              onClick={() => {
                setLoading(true);
                setRetry((v) => v + 1);
              }}
            >
              Check assignment again
            </Button>
          )}
        </Notice>
      )}
      {!changed && (
        <Notice>
          Every sale keeps its original attendant and pump. If an admin changes
          your pump, sign out and sign in online with your own account before
          using it. Never use a colleague&apos;s login.
        </Notice>
      )}
      {!changed && <WindowNotice />}
      {!changed && (
        <Button
          variant="secondary"
          cta
          icon={<LogOut aria-hidden />}
          onClick={signOut}
        >
          Sign out / hand over device
        </Button>
      )}
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
