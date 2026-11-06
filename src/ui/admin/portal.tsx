"use client";
import Link from "next/link";
import { adminTime, adminAction } from "@/client/admin-display";
import {
  Eye,
  EyeOff,
  ShieldCheck,
  CircleCheck,
  TriangleAlert,
  Mail,
} from "lucide-react";
import {
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ComponentProps,
} from "react";
import { Button, TextField, AdminShell, Brand } from "@/ui";
import {
  adminRequest as api,
  AdminError,
  adminOperationId,
} from "@/client/admin-api";
import {
  type AdminUser,
  type RoleSummary,
  type PermissionCode,
  permissionCodes,
  permissionLabels,
  dependencies,
  sensitiveDefaults,
} from "@/shared/contracts/admin";
type Session = {
  state: string;
  account: { id: string; name: string; username: string };
  permissions?: PermissionCode[];
  role?: RoleSummary;
  station?: { name: string };
};
const link = (href: string, label: string) => (
  <a href={"/admin/" + href}>{label}</a>
);
export function AdminPortal({ path }: { path: string[] }) {
  const route = path.join("/");
  const management = ![
    "sign-in",
    "first-password",
    "sign-out",
    "signed-out",
    "forgot-password",
    "forgot-password/sent",
    "reset-password",
    "verify-email",
  ].includes(route);
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(
      management || route === "first-password" || route === "sign-out",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (!management && route !== "first-password" && route !== "sign-out")
      return;
    let live = true;
    const load = async () => {
      setLoading(true);
      try {
        const s = await api<Session>("session");
        if (!live) return;
        if (
          s.state === "password_change_required" &&
          route !== "first-password" &&
          route !== "sign-out"
        ) {
          location.replace("/admin/first-password");
          return;
        }
        setSession(s);
      } catch (e) {
        if (!live) return;
        setSession(null);
        if (e instanceof AdminError && e.status === 401)
          location.replace("/admin/sign-in");
        setError(e instanceof Error ? e.message : "Unable to load account.");
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    const focus = () => {
      setSession(null);
      void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      window.removeEventListener("focus", focus);
    };
  }, [management, route]);
  if (management) {
    if (loading) return <p role="status">Loading account…</p>;
    if (!session)
      return (
        <div className="wr-root wr-admin">
          <p role="alert">{error}</p>
          {link("sign-in", "Sign in")}
        </div>
      );
    const grants = session.permissions ?? [];
    if (!route && grants.includes("roles") && !grants.includes("users")) {
      return (
        <div className="wr-root wr-admin">
          {link("roles", "Roles & permissions")}
          {link("sign-out", "Sign out")}
        </div>
      );
    }
    if (!route && !grants.includes("users") && !grants.includes("roles")) {
      return (
        <div className="wr-root wr-admin wr-admin-access-card">
          <h1 className="wr-page-title">
            {grants.length ? "Your portal access" : "No portal access"}
          </h1>
          <p>{session.account.name}</p>
          <p>
            {grants.length
              ? "Your current role permits the sections below. These sections will become available when their screens are delivered."
              : "Your account has no granted permissions. Contact the portal owner."}
          </p>
          <ul>
            {grants.map((p) => (
              <li key={p}>{permissionLabels[p]}</li>
            ))}
          </ul>
          {link("sign-out", "Sign out")}
        </div>
      );
    }
    return (
      <AdminShell
        station={session.station?.name ?? ""}
        active={path[0] === "roles" ? "Roles & permissions" : "Admin users"}
        items={[
          ...(grants.includes("users")
            ? [{ label: "Admin users", href: "/admin/users" }]
            : []),
          ...(grants.includes("roles")
            ? [{ label: "Roles & permissions", href: "/admin/roles" }]
            : []),
        ]}
        footer={
          <>
            {session.account.name}
            {link("sign-out", "Sign out")}
          </>
        }
      >
        <div className="wr-pagehead">
          <div>
            <div className="wr-eyebrow">Access management</div>
            <h1 className="wr-page-title">Admin users & roles</h1>
            <p className="wr-secondary">
              Named portal accounts and permissions
            </p>
          </div>
          <span className="wr-secondary">
            {session.account.name} · {session.role?.name}
          </span>
        </div>
        <Management key={route} path={path} session={session} />
      </AdminShell>
    );
  }
  return (
    <div className="wr-root wr-auth">
      <section className="wr-auth-hero">
        <Brand surface="Whales Energy" />
        <div>
          <h2>Admin portal</h2>
          <p>
            Review sales, manage customers and cards, and finalise the giveaway
            for Station 01.
          </p>
          <div className="wr-row">
            <span className="wr-pill wr-sm wr-offline">Whales Energy</span>
            <span className="wr-pill wr-sm wr-offline">Station 01</span>
          </div>
        </div>
        <small>
          Whales Rewards is operated by Whales Energy, a Whales Empire brand.
        </small>
      </section>
      <section className="wr-auth-form">
        <Entry route={route} session={session} loading={loading} />
      </section>
    </div>
  );
}
function Entry({
  route,
  session,
  loading,
}: {
  route: string;
  session: Session | null;
  loading: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [done, setDone] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [inspecting, setInspecting] = useState(
      ["verify-email", "reset-password"].includes(route),
    );
  const token = useRef(""),
    key = useRef("");
  const tokenVersion = useRef(0);
  useEffect(() => {
    if (!["verify-email", "reset-password"].includes(route)) return;
    const inspect = () => {
      const version = ++tokenVersion.current;
      token.current =
        new URLSearchParams(location.hash.slice(1)).get("token") ??
        new URL(location.href).searchParams.get("token") ??
        "";
      window.history.replaceState(null, "", location.pathname);
      setDone(false);
      setUnavailable(false);
      setEmail("");
      setError("");
      setBusy(false);
      setInspecting(true);
      if (!token.current) {
        setUnavailable(true);
        setInspecting(false);
        return;
      }
      void api<{ email: string }>(
        route === "verify-email"
          ? "email-verification/inspect"
          : "password-reset/inspect",
        { token: token.current },
      )
        .then((v) => {
          if (version === tokenVersion.current) setEmail(v.email);
        })
        .catch((e) => {
          if (version !== tokenVersion.current) return;
          if (e instanceof AdminError && e.code === "link_unavailable")
            setUnavailable(true);
          else setError(e.message);
        })
        .finally(() => {
          if (version === tokenVersion.current) setInspecting(false);
        });
    };
    const start = window.setTimeout(inspect, 0);
    window.addEventListener("hashchange", inspect);
    window.addEventListener("popstate", inspect);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("hashchange", inspect);
      window.removeEventListener("popstate", inspect);
      // This ref is a request-generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tokenVersion.current++;
      token.current = "";
    };
  }, [route]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const submittedTokenVersion = tokenVersion.current;
    setBusy(true);
    setError("");
    if (!key.current) key.current = adminOperationId();
    try {
      if (route === "sign-in" || route === "first-password") {
        const s = await api<Session>(
          route,
          route === "sign-in"
            ? { username: f.get("username"), password: f.get("password") }
            : {
                operationId: key.current,
                newPassword: f.get("newPassword"),
                confirmPassword: f.get("confirmPassword"),
              },
          "POST",
          route === "sign-in" ? key.current : undefined,
        );
        form.reset();
        // A full navigation discards all credential and account drafts.
        location.assign(
          s.state === "password_change_required"
            ? "/admin/first-password"
            : "/admin",
        );
      } else if (route === "forgot-password") {
        await api(
          "password-reset-requests",
          { email: f.get("email") },
          "POST",
          key.current,
        );
        form.reset();
        // Full navigation discards the private recovery address.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        location.assign("/admin/forgot-password/sent");
      } else if (route === "sign-out") {
        await api("sign-out", {}, "POST", key.current);
        location.replace("/admin/signed-out");
      } else {
        await api(
          route === "verify-email"
            ? "email-verification/confirm"
            : "password-reset/confirm",
          route === "verify-email"
            ? { token: token.current }
            : {
                token: token.current,
                newPassword: f.get("newPassword"),
                confirmPassword: f.get("confirmPassword"),
              },
        );
        if (submittedTokenVersion !== tokenVersion.current) return;
        token.current = "";
        form.reset();
        if (route === "reset-password") location.replace("/admin/sign-in");
        else setDone(true);
      }
    } catch (e) {
      if (submittedTokenVersion !== tokenVersion.current) return;
      const err = e as AdminError;
      setError(err.message);
      if (err.status) {
        key.current = "";
        if (err.code === "link_unavailable") setUnavailable(true);
      }
      form
        .querySelectorAll<HTMLInputElement>("input[type=password]")
        .forEach((v) => {
          v.value = "";
        });
    } finally {
      setBusy(false);
    }
  }
  const title =
    route === "signed-out"
      ? "You are signed out"
      : route === "forgot-password/sent"
        ? "Check your email"
        : unavailable
          ? route === "verify-email"
            ? "This verification link is unavailable"
            : "This link is unavailable"
          : done
            ? route === "verify-email"
              ? "Email verified"
              : "Password reset"
            : route === "sign-in"
              ? "Sign in"
              : route === "first-password"
                ? "Set your password"
                : route === "sign-out"
                  ? "Sign out?"
                  : route === "forgot-password"
                    ? "Reset your password"
                    : route === "verify-email"
                      ? "Verify your email"
                      : "Choose a new password";
  return (
    <form
      onSubmit={submit}
      onChange={() => {
        key.current = "";
      }}
    >
      {(done || route === "signed-out") && (
        <CircleCheck size={48} aria-hidden="true" />
      )}
      {unavailable && <TriangleAlert size={48} aria-hidden="true" />}
      {route === "forgot-password/sent" && (
        <Mail size={48} aria-hidden="true" />
      )}
      <h1 className="wr-page-title">{title}</h1>
      {route === "signed-out" && (
        <>
          <p>This session has ended on this device.</p>
          <div className="wr-notice">
            Any unsaved drafts were cleared. Sign in again to continue.
          </div>
        </>
      )}
      {error && (
        <p className="wr-notice" role="alert">
          {error}
        </p>
      )}
      {loading || inspecting ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          {route === "sign-in" && (
            <>
              <p>Use your named admin account.</p>
              <TextField
                label="Username"
                name="username"
                autoComplete="username"
                required
              />
              <PasswordField
                label="Password"
                name="password"

                autoComplete="current-password"
                required
              />
              <Button type="submit" loading={busy}>
                Sign in
              </Button>
              <div className="wr-admin-recovery-row">
                {link("forgot-password", "Forgot password?")}
                <span className="wr-muted">
                  Recovery needs a verified email.
                </span>
              </div>
              <div className="wr-notice">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  Sign in with your username. Password recovery uses the
                  verified email on your account and never reveals whether an
                  account exists.
                </div>
              </div>
            </>
          )}
          {route === "forgot-password" && (
            <>
              <p>
                Enter the verified email address on your administrative account.
              </p>
              <TextField
                label="Email address"
                name="email"
                type="email"
                maxLength={254}
                required
              />
              <Button type="submit" loading={busy}>
                Send reset link
              </Button>
              <p>
                Every valid address gets the same response. Only an active
                account with a verified email receives a link.
              </p>
            </>
          )}
          {route === "forgot-password/sent" && (
            <>
              <p>
                If this address belongs to an active account with a verified
                email, you’ll receive a password-reset link.
              </p>
              <div className="wr-card wr-quiet">
                <b>What happens next</b>
                <p>
                  Open the latest link within its validity window. Older links
                  stop working as soon as a new one is sent.
                </p>
              </div>
              <Link
                href="/admin/forgot-password"
                className="wr-btn wr-btn-secondary"
              >
                Request a new link
              </Link>
              <small>
                This response never confirms whether an account exists.
              </small>
            </>
          )}
          {!unavailable &&
            !done &&
            (route === "first-password" || route === "reset-password") && (
              <>
                {route === "reset-password" && (
                  <>
                    <p>
                      Use a password different from the current password for
                      this account.
                    </p>
                    <div className="wr-card wr-quiet">
                      Resetting the account for <b>{email}</b>
                    </div>
                  </>
                )}
                <p>
                  {session?.account.name ?? email}
                  {route === "first-password" && (
                    <> · {session?.account.username}</>
                  )}
                </p>
                {route === "first-password" && (
                  <div className="wr-notice">
                    <ShieldCheck size={20} />
                    <div>
                      Set a new password before entering the portal for the
                      first time. Until then this sign-in can do nothing else.
                    </div>
                  </div>
                )}
                <PasswordField
                  label="New password"
                  helper="At least 12 characters and different from the current password."
                  name="newPassword"

                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                  required
                />
                <PasswordField
                  label="Confirm new password"
                  name="confirmPassword"

                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                  required
                />
                <Button type="submit" loading={busy}>
                  {route === "first-password"
                    ? "Save and continue"
                    : "Reset password"}
                </Button>
                <p>
                  Choose a different password. Resetting ends existing sessions.
                </p>
              </>
            )}
          {route === "verify-email" && !unavailable && !done && (
            <>
              <p>Confirm this email address for your administrative account.</p>
              <div className="wr-card wr-quiet">
                <span>Address to confirm</span>
                <b>{email}</b>
              </div>
              <p>
                Once verified, you can use this address to recover your
                password.
              </p>
              <p>Opening this page alone verifies nothing.</p>
              <Button type="submit" loading={busy} disabled={!email}>
                Verify email address
              </Button>
            </>
          )}
          {route === "sign-out" && (
            <>
              <p>You’ll return to the sign-in screen.</p>
              <div className="wr-card wr-quiet">
                <b>{session?.account.name}</b>
                <span>
                  {session?.role?.name} · {session?.account.username}
                </span>
              </div>
              <p>
                Signing out ends this session on this device and clears any
                unsaved drafts.
              </p>
              <Button type="submit" loading={busy}>
                Sign out
              </Button>
              {!error && link("", "Stay signed in")}
            </>
          )}
          {unavailable && (
            <>
              <div className="wr-notice">
                {route === "reset-password"
                  ? "It may have expired or already been used. Request a new reset link to continue."
                  : "The link may have expired, been used or been replaced."}
              </div>
              {route === "reset-password" ? (
                link("forgot-password", "Request a new link")
              ) : (
                <p>Ask the portal owner to resend verification.</p>
              )}
            </>
          )}
          {done && (
            <p>
              Your email address is confirmed. You can now use it for password
              recovery.
            </p>
          )}
          {done && (
            <div className="wr-notice">
              {route === "verify-email"
                ? "Verification does not sign you in or change your password."
                : "Sign in with your new password."}
            </div>
          )}
        </>
      )}
      {route !== "sign-in" &&
        link(
          "sign-in",
          route === "signed-out" ? "Sign in again" : "Return to sign in",
        )}
    </form>
  );
}
function Management({ path, session }: { path: string[]; session: Session }) {
  const rolesMode = path[0] === "roles",
    kind = rolesMode ? "roles" : "users",
    id = path[1],
    isNew = id === "new",
    editing = !!id;
  const allowed = session.permissions?.includes(rolesMode ? "roles" : "users");
  const [items, setItems] = useState<(AdminUser | RoleSummary)[]>([]),
    [roles, setRoles] = useState<RoleSummary[]>([]),
    [user, setUser] = useState<AdminUser | null>(null),
    [role, setRole] = useState<RoleSummary | null>(null),
    [history, setHistory] = useState<
      { id: string; action: string; reason: string; occurredAt: string }[]
    >([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [notice, setNotice] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [reason, setReason] = useState(""),
    [roleId, setRoleId] = useState(""),
    [enabled, setEnabled] = useState(true),
    [permissions, setPermissions] = useState<PermissionCode[]>([]);
  const [reviewPermissions, setReviewPermissions] = useState<PermissionCode[]>(
    [],
  );
  const key = useRef("");
  const frozen = useRef<Record<string, unknown> | null>(null);
  async function load(next?: string) {
    setLoading(true);
    setError("");
    setReview(false);
    frozen.current = null;
    key.current = "";
    setPassword("");
    try {
      if (!allowed) return;
      if (editing) {
        if (rolesMode) {
          let r: RoleSummary;
          if (id === "owner") {
            const page = await api<{ items: RoleSummary[] }>("roles?limit=100");
            const found = page.items.find((v) => v.isOwner);
            if (!found) throw new Error("Owner role unavailable.");
            r = found;
          } else if (isNew) {
            r = null as unknown as RoleSummary;
          } else r = await api<RoleSummary>("roles/" + id);
          if (r) {
            setRole(r);
            setName(r.name);
            setPermissions(r.permissions);
          }
        } else {
          const rs = await api<{ items: RoleSummary[] }>(
            "assignable-roles?limit=100",
          );
          setRoles(rs.items);
          if (!isNew) {
            const u = await api<AdminUser>("users/" + id);
            setUser(u);
            setRoleId(u.role.id);
            setEnabled(u.enabled);
          } else setRoleId(rs.items[0]?.id ?? "");
        }
      } else {
        const p = rolesMode
          ? await api<{ items: RoleSummary[]; nextCursor: string | null }>(
              "roles" + (next ? "?cursor=" + encodeURIComponent(next) : ""),
            )
          : await api<{ items: AdminUser[]; nextCursor: string | null }>(
              "users/search",
              next ? { cursor: next } : {},
            );
        setItems((old) => (next ? [...old, ...p.items] : p.items));
        setCursor(p.nextCursor);
      }
      const h = await api<{ items: typeof history }>(
        "access-history?targetType=" +
          (rolesMode ? "role" : "admin") +
          (!isNew && id && id !== "owner" ? "&targetId=" + id : ""),
      );
      setHistory(h.items);
    } catch (e) {
      setError((e as Error).message);
      setUser(null);
      setRole(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = roles.find((v) => v.id === roleId) ?? user?.role;
  const immutable = rolesMode && role?.isOwner;
  function prepare(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!rolesMode && !selected) {
      setError("Select a current role.");
      return;
    }
    key.current = adminOperationId();
    frozen.current = rolesMode
      ? {
          operationId: key.current,
          name,
          permissions,
          reason,
          ...(!isNew ? { expectedVersion: role?.version } : {}),
        }
      : isNew
        ? {
            operationId: key.current,
            name,
            username,
            email,
            temporaryPassword: password,
            roleId,
            expectedRoleVersion: selected!.version,
            reason,
          }
        : {
            operationId: key.current,
            expectedVersion: user?.version,
            roleId,
            expectedRoleVersion: selected!.version,
            enabled,
            reason,
          };
    setReviewPermissions([...permissions]);
    setReview(true);
  }
  async function confirm() {
    if (!frozen.current) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<AdminUser | RoleSummary | { user: AdminUser }>(
        kind + (isNew ? "" : "/" + id + (rolesMode ? "" : "/access")),
        frozen.current,
        isNew ? "POST" : "PATCH",
      );
      setPassword("");
      frozen.current = null;
      const target = "user" in result ? result.user : result;
      // Full navigation discards credential drafts and the previous account snapshot.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/admin/" + kind + "/" + target.id);
    } catch (e) {
      const err = e as AdminError;
      setError(err.message);
      if (err.status === 401) {
        setUser(null);
        setRole(null);
        setItems([]);
        setPassword("");
        location.replace("/admin/sign-in");
      } else if (err.status) {
        setReview(false);
        frozen.current = null;
        key.current = "";
        setPassword("");
        if (err.code === "version_conflict") {
          await load();
          setError(err.message);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await api("users/" + user.id + "/verification-requests", {
        operationId: adminOperationId(),
        expectedVersion: user.version,
      });
      setNotice(
        "Verification link queued. Sending does not verify the address or prove delivery.",
      );
      const u = await api<AdminUser>("users/" + user.id);
      setUser(u);
      window.history.replaceState(
        null,
        "",
        "/admin/users/" + u.id + "/verification-sent",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function toggle(code: PermissionCode) {
    setPermissions((old) => {
      const s = new Set(old);
      if (s.has(code)) {
        s.delete(code);
        for (const p of permissionCodes)
          if (dependencies[p] === code) s.delete(p);
      } else {
        s.add(code);
        const parent = dependencies[code];
        if (parent) s.add(parent);
      }
      return [...s];
    });
  }
  const details = (
    <aside className="wr-card wr-quiet wr-admin-access-summary">
      <h3>Selected role access · {rolesMode ? name : selected?.name}</h3>
      <p>
        {(rolesMode ? permissions : (selected?.permissions ?? [])).length}{" "}
        actions
      </p>
      <ul>
        {(rolesMode ? permissions : (selected?.permissions ?? [])).map((p) => (
          <li key={p}>{permissionLabels[p]}</li>
        ))}
      </ul>
      <p>
        Disabled users cannot sign in. Their previous actions remain in the
        audit trail.
      </p>
    </aside>
  );
  if (!allowed)
    return <p role="alert">You do not have permission to view this section.</p>;
  if (loading) return <p role="status">Loading…</p>;
  if (!rolesMode && user && (notice || path[2] === "verification-sent"))
    return (
      <>
        <div className="wr-pagehead">
          <div>
            <div className="wr-eyebrow">Admin users & roles / Manage user</div>
            <h2>
              {notice ? "Verification link queued" : "Verification delivery"}
            </h2>
            <p>
              {user.name} · {user.username}
            </p>
          </div>
          <Link
            className="wr-btn wr-btn-secondary wr-btn-sm"
            href={"/admin/users/" + user.id}
          >
            Back to user
          </Link>
        </div>
        {notice && (
          <div className="wr-notice" role="status">
            {notice} The account holder must open the link and confirm the
            address. Password recovery stays unavailable until then.
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="wr-two-col">
          <section className="wr-sheet">
            <h2>Account · {user.emailVerified ? "Verified" : "Unverified"}</h2>
            <dl className="wr-kv">
              <dt>Name</dt>
              <dd>{user.name}</dd>
              <dt>Username</dt>
              <dd>{user.username}</dd>
              <dt>Email</dt>
              <dd>{user.email ?? "No email recorded"}</dd>
              <dt>Role</dt>
              <dd>{user.role.name}</dd>
              <dt>Status</dt>
              <dd>{user.enabled ? "Active" : "Disabled"}</dd>
            </dl>
          </section>
          <section className="wr-sheet">
            <h2>What this does and does not do</h2>
            <p>
              <b>Does</b> Sends a single-use link bound to this user and this
              exact address. Resending invalidates older links.
            </p>
            <p>
              <b>Does not</b> Verify the address, sign the recipient in, or let
              an admin mark someone else’s email verified.
            </p>
            <p>
              <b>Recorded</b> An audit event with the actor and time; no token
              is stored in logs.
            </p>
            {user.enabled && !user.emailVerified && user.email && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void verify()}
              >
                Resend link
              </Button>
            )}
            {link("users", "All admin users")}
          </section>
        </div>
      </>
    );
  return (
    <>
      <nav className="wr-segments wr-admin-access-tabs">
        {session.permissions?.includes("users") && (
          <Link
            href="/admin/users"
            className={"wr-segment" + (!rolesMode ? " wr-on" : "")}
          >
            Admin users
          </Link>
        )}
        {session.permissions?.includes("roles") && (
          <Link
            href="/admin/roles"
            className={"wr-segment" + (rolesMode ? " wr-on" : "")}
          >
            Roles & permissions
          </Link>
        )}
      </nav>
      {error && (
        <div role="alert" className="wr-notice">
          {error}{" "}
          <Button variant="secondary" onClick={() => void load()}>
            Reload latest data
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="wr-notice">
          {notice}
        </p>
      )}
      {!editing ? (
        <section className="wr-sheet wr-admin-access-card">
          <h2>{rolesMode ? "Roles & permissions" : "Portal users"}</h2>
          {link(kind + "/new", rolesMode ? "Create role" : "Create user")}
          <div className="wr-admin-access-table">
            <table className="wr-table">
              <thead>
                <tr>
                  <th>{rolesMode ? "Role" : "Name / username"}</th>
                  <th>{rolesMode ? "Access" : "Role"}</th>
                  <th>{rolesMode ? "Assigned users" : "Email"}</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {"username" in item && (
                        <p>
                          {item.username} · {item.adminCode}
                        </p>
                      )}
                    </td>
                    <td>
                      {"role" in item
                        ? item.role.name
                        : item.permissions.length + " permitted actions"}
                    </td>
                    <td>
                      {"email" in item ? (
                        <>
                          {item.email ?? "No email recorded"}
                          <p>
                            {item.emailVerified ? "Verified" : "Unverified"}
                          </p>
                        </>
                      ) : (
                        item.userCount
                      )}
                    </td>
                    <td>
                      {"enabled" in item
                        ? item.enabled
                          ? "Active"
                          : "Disabled"
                        : item.isOwner
                          ? "Protected Owner"
                          : "Active"}
                    </td>
                    <td>
                      {link(
                        kind + "/" + item.id,
                        rolesMode ? "View permissions" : "Manage",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && <p>No {kind} found.</p>}
          {cursor && (
            <Button onClick={() => void load(cursor)}>Load more</Button>
          )}
        </section>
      ) : (
        (!error || user || role || isNew) && (
          <div
            className={
              rolesMode
                ? "wr-admin-role-layout"
                : "wr-two-col wr-admin-access-columns"
            }
          >
            <section className="wr-sheet wr-admin-access-card">
              <h2>
                {review
                  ? "Review access change"
                  : rolesMode
                    ? isNew
                      ? "Create role"
                      : role?.name
                    : isNew
                      ? "Create admin user"
                      : "Manage admin user"}
                <Link
                  className="wr-btn wr-btn-secondary wr-btn-sm"
                  href={"/admin/" + kind}
                >
                  {"Back to " + kind}
                </Link>
              </h2>
              {review ? (
                <>
                  <p>Not saved yet</p>
                  <dl>
                    <dt>Change</dt>
                    <dd>
                      {isNew ? "Create" : "Update"}{" "}
                      {rolesMode ? "role" : "admin user"}
                    </dd>
                    <dt>Name</dt>
                    <dd>{name || user?.name}</dd>
                    {!rolesMode && (
                      <>
                        <dt>Username</dt>
                        <dd>{username || user?.username}</dd>
                        <dt>Email</dt>
                        <dd>{email || user?.email || "No email recorded"}</dd>
                        <dt>Role</dt>
                        <dd>{selected?.name}</dd>
                        <dt>Status</dt>
                        <dd>{enabled ? "Active" : "Disabled"}</dd>
                        {isNew && (
                          <>
                            <dt>Temporary password</dt>
                            <dd>Set · must be changed on first sign-in</dd>
                          </>
                        )}
                      </>
                    )}
                    {rolesMode && (
                      <>
                        <dt>Permitted actions</dt>
                        <dd>
                          <ul>
                            {reviewPermissions.map((code) => (
                              <li key={code}>{permissionLabels[code]}</li>
                            ))}
                          </ul>
                        </dd>
                        {!isNew && (
                          <>
                            <dt>Affected users</dt>
                            <dd>{role?.userCount ?? "0"}</dd>
                            <dt>Added permissions</dt>
                            <dd>
                              <ul>
                                {reviewPermissions
                                  .filter(
                                    (code) => !role?.permissions.includes(code),
                                  )
                                  .map((code) => (
                                    <li key={code}>{permissionLabels[code]}</li>
                                  ))}
                              </ul>
                            </dd>
                            <dt>Removed permissions</dt>
                            <dd>
                              <ul>
                                {(role?.permissions ?? [])
                                  .filter(
                                    (code) => !reviewPermissions.includes(code),
                                  )
                                  .map((code) => (
                                    <li key={code}>{permissionLabels[code]}</li>
                                  ))}
                              </ul>
                            </dd>
                          </>
                        )}
                      </>
                    )}
                    <dt>Reason</dt>
                    <dd>{reason}</dd>
                    <dt>Recorded by</dt>
                    <dd>{session.account.name}</dd>
                  </dl>
                  <div className="wr-admin-confirm-actions">
                    <Button onClick={() => void confirm()} loading={busy}>
                      Confirm change
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={
                        busy || error.startsWith("Connection interrupted")
                      }
                      onClick={() => {
                        setReview(false);
                        frozen.current = null;
                      }}
                    >
                      Keep editing
                    </Button>
                    {link(kind, "Cancel")}
                  </div>
                </>
              ) : (
                <form onSubmit={prepare}>
                  {rolesMode ? (
                    <>
                      <TextField
                        label="Role name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={120}
                        disabled={immutable}
                      />
                      <div className="wr-label">
                        Permitted actions{" "}
                        <span className="wr-hint">
                          New roles start with none. Ticking an action includes
                          its view permission; unticking a view clears its
                          actions.
                        </span>
                      </div>
                      {immutable && (
                        <div className="wr-notice">
                          <div>
                            <b>Owner is protected</b> and has every permission.
                            It cannot be edited or removed, and the last active
                            Owner cannot be disabled.
                          </div>
                        </div>
                      )}
                      <div className="wr-admin-permission-grid">
                        {permissionCodes
                          .filter((p) => !dependencies[p])
                          .map((parent) => (
                            <fieldset key={parent} disabled={immutable}>
                              <legend>{permissionLabels[parent]}</legend>
                              {[
                                parent,
                                ...permissionCodes.filter(
                                  (p) => dependencies[p] === parent,
                                ),
                              ].map((code) => (
                                <label
                                  className="wr-admin-permission"
                                  key={code}
                                >
                                  <input
                                    type="checkbox"
                                    checked={permissions.includes(code)}
                                    onChange={() => toggle(code)}
                                  />
                                  {permissionLabels[code]}{" "}
                                  {sensitiveDefaults.includes(code) && (
                                    <small className="wr-pill wr-sm wr-pending wr-plain">
                                      Owner by default
                                    </small>
                                  )}
                                </label>
                              ))}
                            </fieldset>
                          ))}
                      </div>
                    </>
                  ) : (
                    <>
                      {isNew ? (
                        <>
                          <TextField
                            label="Full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            maxLength={120}
                          />
                          <TextField
                            label="Username"
                            helper="Unique, case-insensitive."
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            pattern="[a-z0-9._-]{3,40}"
                            required
                          />
                          <TextField
                            label="Email address"
                            helper="Verify this address before it can be used for password recovery. The recipient must open the verification link; admins cannot mark it verified manually."
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            required
                            maxLength={254}
                          />
                          <PasswordField
                            label="Temporary password"
                            helper="At least 12 characters. The user must change it on first sign-in. It is never shown again or stored in records."
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}

                            autoComplete="new-password"
                            minLength={12}
                            maxLength={1024}
                            required
                          />
                        </>
                      ) : (
                        <>
                          <dl>
                            <dt>Name</dt>
                            <dd>{user?.name}</dd>
                            <dt>Username</dt>
                            <dd>{user?.username}</dd>
                            <dt>Permanent ID</dt>
                            <dd>{user?.adminCode}</dd>
                            <dt>Email</dt>
                            <dd>{user?.email ?? "No email recorded"}</dd>
                            <dt>Email verification</dt>
                            <dd>
                              {user?.emailVerified ? "Verified" : "Unverified"}
                            </dd>
                          </dl>
                          {user?.email &&
                            !user.emailVerified &&
                            user.enabled && (
                              <Button
                                onClick={() => void verify()}
                                loading={busy}
                              >
                                Send verification link
                              </Button>
                            )}
                        </>
                      )}
                      <label className="wr-field">
                        Role
                        <select
                          aria-label="Role"
                          className="wr-input"
                          value={roleId}
                          onChange={(e) => setRoleId(e.target.value)}
                          required
                        >
                          {!roles.some((r) => r.id === user?.role.id) &&
                            user && (
                              <option value={user.role.id}>
                                {user.role.name}
                              </option>
                            )}
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!isNew && (
                        <label className="wr-field">
                          Account status
                          <select
                            aria-label="Account status"
                            className="wr-input"
                            value={String(enabled)}
                            onChange={(e) =>
                              setEnabled(e.target.value === "true")
                            }
                          >
                            <option value="true">Active</option>
                            <option value="false">Disabled</option>
                          </select>
                        </label>
                      )}
                    </>
                  )}
                  {!immutable && (
                    <>
                      <label className="wr-field">
                        Reason
                        <textarea
                          aria-label="Reason"
                          className="wr-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          required
                          maxLength={1000}
                          aria-describedby="access-reason-help"
                        />
                        <small id="access-reason-help" className="wr-help">
                          Required. Recorded in the access history with your
                          name and the time.
                        </small>
                      </label>
                    </>
                  )}
                  <div className="wr-row">
                    {!immutable && (
                      <Button type="submit">
                        {rolesMode ? "Review role" : "Review user"}
                      </Button>
                    )}
                    <Link
                      className="wr-btn wr-btn-ghost"
                      href={"/admin/" + kind}
                    >
                      Cancel
                    </Link>
                  </div>
                </form>
              )}
            </section>
            {!rolesMode && details}
          </div>
        )
      )}
      <section className="wr-sheet wr-admin-access-card">
        <h2>Access history</h2>
        {history.length ? (
          history.map((h) => (
            <p key={h.id}>
              {adminTime(h.occurredAt)} · {adminAction(h.action)} · {h.reason}
            </p>
          ))
        ) : (
          <p>No access changes recorded.</p>
        )}
      </section>
    </>
  );
}

function PasswordField(props: ComponentProps<typeof TextField>) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      action={
        <Button
          variant="secondary"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={20} /> : <Eye size={20} />}
        </Button>
      }
    />
  );
}
