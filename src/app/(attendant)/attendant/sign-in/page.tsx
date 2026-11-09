"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { Eye, EyeOff } from "lucide-react";
import { Button, TextField, Notice } from "@/ui";
import type { FirstPasswordInput } from "@/client/types";
import { Frame, useAttendant, message } from "../_components/runtime";

function FirstPassword() {
  const { client, online } = useAttendant();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<FirstPasswordInput | null>(null);
  const live = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      receipt.current = null;
    };
  }, []);
  function edit(change: () => void) {
    receipt.current = null;
    setError(null);
    change();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || !online || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const input = receipt.current ?? {
      operationId: v7(),
      currentPassword: current,
      newPassword: password,
      confirmPassword: confirmation,
    };
    receipt.current = input;
    try {
      await client.completeFirstPassword(input);
      if (!live.current) return;
      receipt.current = null;
      setCurrent("");
      setPassword("");
      setConfirmation("");
      setVisible(false);
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      if (live.current) setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <Frame title="Change your first password" noNav signIn>
      <div>
        <h1 className="wr-page-title">Change your first password</h1>
        <p className="wr-secondary">
          Choose your own password, then sign in online again before recording
          sales.
        </p>
      </div>
      <Notice>
        Recording and uploads stay locked until you change this password and
        sign in again. Sales and photos already on this phone stay under their
        original account.
      </Notice>
      {!online && (
        <Notice tone="inverse">
          Connect to the internet to change your first password.
        </Notice>
      )}
      <form className="wr-sign-in-form" onSubmit={submit}>
        <TextField
          label="Current password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          value={current}
          onChange={(e) => edit(() => setCurrent(e.target.value))}
          maxLength={1024}
          required
          disabled={busy}
        />
        <TextField
          label="New password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(e) => edit(() => setPassword(e.target.value))}
          minLength={12}
          maxLength={1024}
          required
          disabled={busy}
          helper="Use a different password with 12 to 1024 characters."
        />
        <TextField
          label="Confirm new password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => edit(() => setConfirmation(e.target.value))}
          minLength={12}
          maxLength={1024}
          required
          disabled={busy}
          error={error ?? undefined}
        />
        <Button
          variant="secondary"
          aria-label={visible ? "Hide passwords" : "Show passwords"}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          icon={visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        >
          {visible ? "Hide passwords" : "Show passwords"}
        </Button>
        <Button
          type="submit"
          cta
          disabled={
            !online || !client || !current || !password || !confirmation
          }
          loading={busy}
        >
          {busy ? "Changing password…" : "Change password"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            receipt.current = null;
            setCurrent("");
            setPassword("");
            setConfirmation("");
            setVisible(false);
            void client?.signOut();
          }}
        >
          Cancel
        </Button>
      </form>
    </Frame>
  );
}
function SignIn() {
  const { client, online, state, error: initialError } = useAttendant();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!client || !online || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await client.signIn(username, password);
      if (
        live.current &&
        result.access === "active" &&
        result.session?.captureContextId ===
          client.getState().session?.captureContextId
      )
        router.replace("/attendant/sale");
    } catch (e) {
      if (live.current) setError(message(e));
    } finally {
      if (live.current) {
        setPassword("");
        setVisible(false);
        setBusy(false);
      }
      inFlight.current = false;
    }
  }
  return (
    <Frame title="Sign in" noNav signIn>
      <div>
        <h1 className="wr-page-title">Sign in</h1>
        <p className="wr-secondary">Use the account assigned to your pump.</p>
      </div>
      {!online && (
        <Notice tone="inverse">
          <b>No connection.</b> Signing in and switching accounts need the
          internet. Connect and try again.
        </Notice>
      )}
      {state?.logoutPending && (
        <Notice tone="warning">
          Signed out on this phone. Connect to finish signing out before signing
          in again.
        </Notice>
      )}
      {state?.notice && state.notice !== error && (
        <Notice>{state.notice}</Notice>
      )}
      <form className="wr-sign-in-form" onSubmit={signIn}>
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          className={error ? "wr-username wr-invalid" : "wr-username"}
          mono
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={64}
          required
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "attendant-password-error" : undefined}
        />
        <TextField
          label="Password"
          id="attendant-password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={1024}
          required
          disabled={busy}
          error={error ?? undefined}
          action={
            <Button
              variant="secondary"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
              icon={visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            />
          }
        />
        {!error && initialError && (
          <Notice tone="danger" role="alert">
            {initialError}
          </Notice>
        )}
        {!error && online && (
          <Notice>
            Internet is required to sign in or switch accounts. Offline
            recording lasts <b>24 hours</b> after an online sign-in.
          </Notice>
        )}
        <Button
          type="submit"
          cta
          disabled={!online || !client || !username || !password}
          loading={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="wr-help wr-centered">
        Forgot your password? Ask a station manager for help.
      </p>
      <div className="wr-help wr-sign-in-footer">Whales Energy</div>
    </Frame>
  );
}
export default function SignInPage() {
  const { state } = useAttendant();
  return state?.access === "password_change_required" &&
    state.restrictedSession ? (
    <FirstPassword key={state.restrictionId} />
  ) : (
    <SignIn />
  );
}
