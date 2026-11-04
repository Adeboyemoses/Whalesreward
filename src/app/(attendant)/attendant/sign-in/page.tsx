"use client";
import { useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button, TextField, Notice } from "@/ui";
import { Frame, useAttendant, message } from "../_components/runtime";
export default function SignInPage() {
  const { client, online, state, error: initialError } = useAttendant();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!client || !online || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await client.signIn(username, password);
      router.replace("/attendant/sale");
    } catch (e) {
      setError(message(e));
    } finally {
      setPassword("");
      setVisible(false);
      setBusy(false);
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
        Forgot your password? Ask a station admin to reset it.
      </p>
      <div className="wr-help wr-sign-in-footer">Whales Energy</div>
    </Frame>
  );
}
