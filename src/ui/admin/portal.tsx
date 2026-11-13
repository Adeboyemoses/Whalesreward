"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAdminSession } from "./session";
import { StationPortal, stationSections } from "./station";
import { CustomerPortal } from "./customers";
import { CardsPortal } from "./cards";
import { AuditPortal } from "./audit";
import { SalesPortal } from "./sales";
import { SettingsPortal } from "./settings";
const customerSections = [
  { grant: "customers", label: "Customers", href: "/admin/customers" },
  { grant: "cards", label: "Loyalty cards", href: "/admin/cards" },
] as const;
const portalSections = [
  { grant: "audit", label: "Audit history", href: "/admin/audit" } as const,
  { grant: "sales", label: "Sales", href: "/admin/sales" } as const,
  ...stationSections,
  ...customerSections,
  { grant: "settings", label: "Settings", href: "/admin/settings" } as const,
];
import type { AdminSession as Session } from "@/client/admin-session";
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
  useLayoutEffect,
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
const link = (href: string, label: string) => (
  <Link href={"/admin/" + href}>{label}</Link>
);
export function AdminPortal({ path: initialPath }: { path: string[] }) {
  const pathname = usePathname();
  const path = pathname
    ? pathname
        .replace(/^\/admin\/?/, "")
        .split("/")
        .filter(Boolean)
    : initialPath;
  const route = path.join("/");
  const customerRoute = ["customers", "cards", "sales", "audit"].includes(
    path[0] ?? "",
  );
  const settingsRoute = path[0] === "settings";
  const stationRoute = ["pumps", "prices", "attendants"].includes(
    path[0] ?? "",
  );
  const router = useRouter();
  const { session, checked, error, epoch, transitionTo } = useAdminSession();
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
  // Public credentials and recipient flows must not wait for an admin session.
  const loading =
    !checked &&
    (management || route === "first-password" || route === "sign-out");
  useEffect(() => {
    if (transitionTo) {
      if (pathname !== transitionTo) router.replace(transitionTo);
      return;
    }
    if (session?.state === "password_change_required" && management)
      router.replace("/admin/first-password");
    else if (
      (management || route === "first-password" || route === "sign-out") &&
      checked &&
      !session
    )
      router.replace("/admin/sign-in");
    else if (
      !route &&
      session?.state === "ready" &&
      !session.permissions?.includes("users") &&
      !session.permissions?.includes("roles")
    ) {
      const target = portalSections.find((item) =>
        session.permissions?.includes(item.grant),
      );
      if (target) router.replace(target.href);
    }
  }, [
    session,
    management,
    route,
    checked,
    error,
    router,
    transitionTo,
    pathname,
  ]);
  if (transitionTo && pathname !== transitionTo)
    return <p role="status">Finishing account change…</p>;
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
    if (
      !route &&
      !grants.includes("users") &&
      !grants.includes("roles") &&
      !portalSections.some((item) => grants.includes(item.grant))
    ) {
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
        active={
          settingsRoute
            ? "Settings"
            : customerRoute
              ? path[0] === "audit"
                ? "Audit history"
                : path[0] === "sales"
                  ? "Sales"
                  : path[0] === "cards"
                    ? "Loyalty cards"
                    : "Customers"
              : stationRoute
                ? (stationSections.find(
                    (item) => item.href === "/admin/" + path[0],
                  )?.label ?? "Station pumps")
                : path[0] === "roles"
                  ? "Roles & permissions"
                  : "Admin users"
        }
        items={[
          ...portalSections
            .filter((item) =>
              item.grant === "pumps"
                ? grants.some((grant) =>
                    ["pumps", "attendants", "prices"].includes(grant),
                  )
                : grants.includes(item.grant),
            )
            .map(({ label, href }) => ({ label, href })),
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
        {!stationRoute && !customerRoute && !settingsRoute && (
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
        )}
        {error && (
          <p role="alert" className="wr-notice">
            {error}
          </p>
        )}
        {settingsRoute ? (
          <SettingsPortal key={epoch} path={path} session={session} />
        ) : customerRoute ? (
          path[0] === "audit" ? (
            <AuditPortal key={epoch} path={path} session={session} />
          ) : path[0] === "sales" ? (
            <SalesPortal key={epoch} path={path} session={session} />
          ) : path[0] === "cards" ? (
            <CardsPortal key={epoch} path={path} session={session} />
          ) : (
            <CustomerPortal key={epoch} path={path} session={session} />
          )
        ) : stationRoute ? (
          <StationPortal key={epoch} path={path} session={session} />
        ) : !route && !grants.includes("users") && !grants.includes("roles") ? (
          <p role="status">Opening your portal section…</p>
        ) : (
          <Management
            key={route.replace(/\/verification-sent$/, "") + ":" + epoch}
            path={path}
            session={session}
          />
        )}
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
        {error && (
          <p role="alert" className="wr-notice">
            {error}
          </p>
        )}
        <Entry
          key={route + ":" + epoch}
          route={route}
          session={session}
          loading={loading}
        />
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
  const { store } = useAdminSession();
  const router = useRouter();
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
  useEffect(
    () => () => {
      // Invalidate every entry request on unmount.
      tokenVersion.current++;
    },
    [],
  );
  useEffect(() => {
    if (!["verify-email", "reset-password"].includes(route)) return;
    const inspect = (source: URL) => {
      const version = ++tokenVersion.current;
      token.current =
        new URLSearchParams(source.hash.slice(1)).get("token") ??
        source.searchParams.get("token") ??
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
    // Fragment history navigation emits popstate before hashchange. Only the
    // hashchange handler inspects fragment tokens, using the event URL because
    // our immediate scrub changes location before another event can run.
    const hash = (event: HashChangeEvent) => inspect(new URL(event.newURL));
    const pop = () => {
      const source = new URL(location.href);
      if (!source.hash) inspect(source);
    };
    const start = window.setTimeout(() => inspect(new URL(location.href)), 0);
    window.addEventListener("hashchange", hash);
    window.addEventListener("popstate", pop);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("popstate", pop);
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
        if (submittedTokenVersion !== tokenVersion.current) return;
        form.reset();
        store.adopt(s);
        router.push(
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
        if (submittedTokenVersion !== tokenVersion.current) return;
        form.reset();
        // The route-keyed entry discards the private recovery address.
        router.push("/admin/forgot-password/sent");
      } else if (route === "sign-out") {
        await api("sign-out", {}, "POST", key.current);
        if (submittedTokenVersion !== tokenVersion.current) return;
        store.clear("", "/admin/signed-out");
        router.replace("/admin/signed-out");
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
        if (route === "reset-password") {
          store.clear("", "/admin/sign-in");
          router.replace("/admin/sign-in");
        } else setDone(true);
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
        <div className="wr-result-icon">
          <CircleCheck aria-hidden="true" />
        </div>
      )}
      {unavailable && (
        <div className="wr-result-icon wr-failed">
          <TriangleAlert aria-hidden="true" />
        </div>
      )}
      {route === "forgot-password/sent" && (
        <div className="wr-result-icon wr-held">
          <Mail aria-hidden="true" />
        </div>
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
                  {route === "first-password" ? session?.account.name : null}
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
                  Resetting signs you out everywhere, records an audit event and
                  sends a security notice to this email. You return to sign in;
                  the reset does not sign you in.
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
              <div className="wr-admin-entry-actions">
                <Button type="submit" loading={busy}>
                  Sign out
                </Button>
                {!error && (
                  <Link className="wr-btn wr-btn-secondary" href="/admin">
                    Stay signed in
                  </Link>
                )}
              </div>
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
                <Link
                  className="wr-btn wr-btn-primary"
                  href="/admin/forgot-password"
                >
                  Request a new link
                </Link>
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
      {route !== "sign-in" && route !== "sign-out" && (
        <Link
          className={
            "wr-btn " +
            (route === "signed-out" ||
            (route === "verify-email" && (done || unavailable))
              ? "wr-btn-primary"
              : "wr-btn-ghost")
          }
          href="/admin/sign-in"
        >
          {route === "signed-out"
            ? "Sign in again"
            : route === "first-password"
              ? "Back to sign in"
              : "Return to sign in"}
        </Link>
      )}
    </form>
  );
}
function Management({ path, session }: { path: string[]; session: Session }) {
  const { store } = useAdminSession();
  const api = store.request;
  const router = useRouter();
  const rolesMode = path[0] === "roles",
    kind = rolesMode ? "roles" : "users",
    id = path[1],
    isNew = id === "new",
    editing = !!id;
  const allowed = session.permissions?.includes(rolesMode ? "roles" : "users");
  type ListPage = {
    items: (AdminUser | RoleSummary)[];
    nextCursor: string | null;
  };
  const cached = store.lists.get(kind) as ListPage | undefined;
  const [items, setItems] = useState<(AdminUser | RoleSummary)[]>(
      cached?.items ?? [],
    ),
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
    [verificationQueued, setVerificationQueued] = useState(false),
    [historyWarning, setHistoryWarning] = useState(""),
    [pickerWarning, setPickerWarning] = useState(""),
    [cursor, setCursor] = useState<string | null>(cached?.nextCursor ?? null);
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
  const loadVersion = useRef(0);
  const lifetime = useRef(0);
  const viewVersion = useRef(0);
  const viewPath = path.join("/");
  useLayoutEffect(() => {
    // Same-record delivery/detail navigation preserves the editor, but ends
    // the previous view's request ownership before any late continuation runs.
    viewVersion.current++;
    // This is an explicit view transition, not background session revalidation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false);
  }, [viewPath]);
  const historyVersion = useRef(0);
  function mutationGuard() {
    const generation = lifetime.current,
      view = viewVersion.current,
      pathname = window.location.pathname,
      epoch = store.getSnapshot().epoch;
    return () =>
      generation === lifetime.current &&
      view === viewVersion.current &&
      pathname === window.location.pathname &&
      epoch === store.getSnapshot().epoch;
  }
  async function refreshHistory(active: () => boolean) {
    const version = ++historyVersion.current;
    const current = () => active() && version === historyVersion.current;
    try {
      const h = await api<{ items: typeof history }>(
        "access-history?targetType=" +
          (rolesMode ? "role" : "admin") +
          (!isNew && id && id !== "owner" ? "&targetId=" + id : ""),
      );
      if (current()) {
        setHistory(h.items);
        setHistoryWarning("");
      }
    } catch {
      if (current())
        setHistoryWarning("Access history could not be refreshed.");
    }
  }
  async function load(next?: string) {
    const version = ++loadVersion.current;
    const current = () => version === loadVersion.current;
    setLoading(true);
    setError("");
    setNotice("");
    setVerificationQueued(false);
    setReview(false);
    frozen.current = null;
    key.current = "";
    setPassword("");
    if (!allowed) {
      setLoading(false);
      return;
    }
    void refreshHistory(current);
    setPickerWarning("");
    try {
      if (editing) {
        if (rolesMode) {
          if (!isNew) {
            const r =
              id === "owner"
                ? (
                    await api<{ items: RoleSummary[] }>("roles?limit=100")
                  ).items.find((v) => v.isOwner)
                : await api<RoleSummary>("roles/" + id);
            if (!r) throw new Error("Owner role unavailable.");
            if (current()) {
              setRole(r);
              setName(r.name);
              setPermissions(r.permissions);
            }
          }
        } else {
          const picker = api<{ items: RoleSummary[] }>(
            "assignable-roles?limit=100",
          ).then((rs) => {
            if (current()) {
              setRoles(rs.items);
              if (isNew) setRoleId(rs.items[0]?.id ?? "");
            }
          });
          if (isNew) await picker;
          else {
            void picker.catch((error: unknown) => {
              if (current()) {
                setRoles([]);
                setPickerWarning(
                  error instanceof AdminError &&
                    error.code === "delegation_policy_unconfigured"
                    ? error.message
                    : "Role choices could not be refreshed. The current role is shown; reload before selecting another role.",
                );
              }
            });
            const u = await api<AdminUser>("users/" + id);
            if (current()) {
              setUser(u);
              setRoleId(u.role.id);
              setEnabled(u.enabled);
            }
          }
        }
      } else {
        const page = rolesMode
          ? await api<ListPage>(
              "roles" + (next ? "?cursor=" + encodeURIComponent(next) : ""),
            )
          : await api<ListPage>("users/search", next ? { cursor: next } : {});
        if (current()) {
          const combined = next ? [...items, ...page.items] : page.items;
          setItems(combined);
          setCursor(page.nextCursor);
          store.lists.set(kind, {
            items: combined,
            nextCursor: page.nextCursor,
          });
        }
      }
    } catch (e) {
      if (current()) {
        setError((e as Error).message);
        setUser(null);
        setRole(null);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      // A generation counter invalidates requests, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadVersion.current++;
      // Fence mutation continuations across record navigation/unmount too.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      lifetime.current++;
    };
    // The editor is keyed by route and authority epoch. Healthy refresh preserves drafts.
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
    const current = mutationGuard();
    setBusy(true);
    setError("");
    try {
      const result = await api<AdminUser | RoleSummary | { user: AdminUser }>(
        kind + (isNew ? "" : "/" + id + (rolesMode ? "" : "/access")),
        frozen.current,
        isNew ? "POST" : "PATCH",
      );
      if (!current()) return;
      setPassword("");
      frozen.current = null;
      key.current = "";
      setReview(false);
      setVerificationQueued(false);
      setReason("");
      const target = "user" in result ? result.user : result;
      // Keep the current record editor, but adopt the authoritative applied version.
      if ("role" in target) {
        setUser(target);
        setRoleId(target.role.id);
        setEnabled(target.enabled);
        setRoles((old) =>
          old.map((r) => (r.id === target.role.id ? target.role : r)),
        );
      } else {
        setRole(target);
        setName(target.name);
        setPermissions(target.permissions);
      }
      store.lists.delete(kind);
      if (isNew) router.push("/admin/" + kind + "/" + target.id);
      else {
        setNotice("Access change saved.");
        void refreshHistory(current);
      }
    } catch (e) {
      if (!current()) return;
      const err = e as AdminError;
      setError(err.message);
      if (err.status === 401) {
        setUser(null);
        setRole(null);
        setItems([]);
        setPassword("");
        router.replace("/admin/sign-in");
      } else if (err.status) {
        setReview(false);
        frozen.current = null;
        key.current = "";
        setPassword("");
        if (err.code === "version_conflict") {
          await load();
          if (current()) setError(err.message);
        }
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function verify() {
    if (!user) return;
    const current = mutationGuard();
    setBusy(true);
    setError("");
    try {
      await api("users/" + user.id + "/verification-requests", {
        operationId: adminOperationId(),
        expectedVersion: user.version,
      });
      if (!current()) return;
      setVerificationQueued(true);
      setNotice(
        "Verification link queued. Sending does not verify the address or prove delivery.",
      );
      const u = await api<AdminUser>("users/" + user.id);
      if (!current()) return;
      setUser(u);
      setBusy(false);
      window.history.replaceState(
        null,
        "",
        "/admin/users/" + u.id + "/verification-sent",
      );
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setBusy(false);
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
  const listPanel = (
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
                      <p>{item.emailVerified ? "Verified" : "Unverified"}</p>
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
      {loading && <p role="status">Refreshing {kind}…</p>}
      {!items.length && !loading && <p>No {kind} found.</p>}
      {cursor && <Button onClick={() => void load(cursor)}>Load more</Button>}
    </section>
  );
  if (!allowed)
    return <p role="alert">You do not have permission to view this section.</p>;
  if (loading && !items.length) return <p role="status">Loading…</p>;
  if (loading && editing)
    return (
      <>
        {listPanel}
        <p role="status" className="wr-notice">
          Loading details…
        </p>
      </>
    );
  if (!rolesMode && user && path[2] === "verification-sent")
    return (
      <>
        <div className="wr-pagehead">
          <div>
            <div className="wr-eyebrow">Admin users & roles / Manage user</div>
            <h2>
              {verificationQueued
                ? "Verification link queued"
                : "Verification delivery"}
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
        {verificationQueued && notice && (
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
      {historyWarning && (
        <p role="alert" className="wr-notice">
          {historyWarning}
        </p>
      )}
      {pickerWarning && (
        <p role="alert" className="wr-notice">
          {pickerWarning}
        </p>
      )}
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
      {!editing
        ? listPanel
        : (!error || user || role || isNew) && (
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
                                      (code) =>
                                        !role?.permissions.includes(code),
                                    )
                                    .map((code) => (
                                      <li key={code}>
                                        {permissionLabels[code]}
                                      </li>
                                    ))}
                                </ul>
                              </dd>
                              <dt>Removed permissions</dt>
                              <dd>
                                <ul>
                                  {(role?.permissions ?? [])
                                    .filter(
                                      (code) =>
                                        !reviewPermissions.includes(code),
                                    )
                                    .map((code) => (
                                      <li key={code}>
                                        {permissionLabels[code]}
                                      </li>
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
                            New roles start with none. Ticking an action
                            includes its view permission; unticking a view
                            clears its actions.
                          </span>
                        </div>
                        {immutable && (
                          <div className="wr-notice">
                            <div>
                              <b>Owner is protected</b> and has every
                              permission. It cannot be edited or removed, and
                              the last active Owner cannot be disabled.
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
                                {user?.emailVerified
                                  ? "Verified"
                                  : "Unverified"}
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
