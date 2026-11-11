import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./service";
import {
  policyConfiguration,
  policyNames,
  type PolicyEvaluators,
} from "./policies";

const layout = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: 85.6,
  cardHeightMm: 54,
  marginMm: 10,
  gapMm: 2,
};
const configured = {
  WHR_ENV: "staging",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "fictional-secret-canary-".repeat(3),
  BETTER_AUTH_URL: "https://fictional-origin.example.test",
  EMAIL_PROVIDER: "zoho_cpaas",
  ZOHO_CPAAS_API_URL: "https://cpaas.zoho.com/v1.1/email",
  ZOHO_CPAAS_TOKEN: "fictional-token-canary",
  EMAIL_FROM: "sender-canary@example.com",
  EMAIL_ALLOWED_RECIPIENTS: "recipient-canary@example.com",
  WHR_PHONE_POLICY: "ng-mobile-v1",
  WHR_CARD_PRINT_LAYOUT: JSON.stringify(layout),
};
const implemented = [
  "auth",
  "delivery",
  "delegation",
  "phone",
  "cardPrint",
] as const;
const allEnabled = Object.fromEntries(
  policyNames.map((name) => [name, () => true]),
) as PolicyEvaluators;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("WHR-100 policy configuration", () => {
  it.each([
    { WHR_ENV: "prod", NODE_ENV: "production" },
    { WHR_ENV: "", NODE_ENV: "production" },
    { WHR_ENV: " staging", NODE_ENV: "production" },
    { WHR_ENV: "STAGING", NODE_ENV: "production" },
    { WHR_ENV: "unsupported", NODE_ENV: "test" },
    { WHR_ENV: "staging", NODE_ENV: "prod" },
    { WHR_ENV: "local", NODE_ENV: "" },
    { WHR_ENV: undefined, NODE_ENV: "development " },
  ])(
    "WHR-100 invalid environment %j cannot configure any policy or invoke evaluators",
    (environment) => {
      const env = { ...configured, EMAIL_PROVIDER: "mailpit", ...environment };
      const result = policyConfiguration(env);
      expect(result).toEqual({
        policies: Object.fromEntries(
          policyNames.map((name) => [name, "unconfigured"]),
        ),
        fullyConfigured: false,
      });
      const check = vi.fn(() => true);
      const checks = Object.fromEntries(
        policyNames.map((name) => [name, check]),
      ) as PolicyEvaluators;
      expect(policyConfiguration(env, checks)).toEqual(result);
      expect(check).not.toHaveBeenCalled();
    },
  );
  it.each([
    { WHR_ENV: "local", NODE_ENV: "production" },
    { WHR_ENV: "test", NODE_ENV: "test" },
    { WHR_ENV: undefined, NODE_ENV: "development" },
    { WHR_ENV: undefined, NODE_ENV: "test" },
    { WHR_ENV: undefined, NODE_ENV: undefined },
  ])(
    "WHR-100 permitted development environment %j retains explicit local proposals",
    (environment) => {
      expect(
        policyConfiguration({
          ...configured,
          EMAIL_PROVIDER: "mailpit",
          ...environment,
        }).policies,
      ).toMatchObject({
        auth: "configured",
        delivery: "configured",
        delegation: "configured",
        phone: "configured",
        cardPrint: "configured",
      });
    },
  );

  it("evaluates existing gates with staging proposals and keeps unavailable M3/M4 evaluators unconfigured", () => {
    const { policies, fullyConfigured } = policyConfiguration(configured);
    expect(Object.keys(policies)).toEqual(policyNames);
    for (const name of policyNames)
      expect(policies[name]).toBe(
        implemented.some((item) => item === name)
          ? "configured"
          : "unconfigured",
      );
    expect(fullyConfigured).toBe(false);
  });
  it("can report all ten configured only when every evaluator positively validates", () => {
    expect(policyConfiguration(configured, allEnabled)).toEqual({
      policies: Object.fromEntries(
        policyNames.map((name) => [name, "configured"]),
      ),
      fullyConfigured: true,
    });
  });
  it.each(policyNames)(
    "isolates absent, invalid and inactive %s without dropping other policy statuses",
    (name) => {
      for (const evaluate of [
        undefined,
        () => false,
        () => {
          throw new Error("private-diagnostic-canary");
        },
      ]) {
        const result = policyConfiguration(configured, {
          ...allEnabled,
          [name]: evaluate,
        });
        expect(result.policies[name]).toBe("unconfigured");
        for (const other of policyNames.filter((item) => item !== name))
          expect(result.policies[other]).toBe("configured");
        expect(result.fullyConfigured).toBe(
          Object.values(result.policies).every(
            (value) => value === "configured",
          ),
        );
        expect(JSON.stringify(result)).not.toContain("canary");
      }
    },
  );
  it.each([
    ["auth", "BETTER_AUTH_SECRET", undefined],
    ["auth", "BETTER_AUTH_URL", "private-invalid-origin-canary"],
    ["auth", "WHR_ADMIN_RECEIPT_KEYS", "private-invalid-receipt-canary"],
    ["delivery", "EMAIL_PROVIDER", "noop"],
    ["delivery", "EMAIL_PROVIDER", "unsupported"],
    ["delivery", "ZOHO_CPAAS_TOKEN", undefined],
    ["delivery", "EMAIL_ALLOWED_RECIPIENTS", "invalid"],
    ["phone", "WHR_PHONE_POLICY", "unsupported"],
    ["cardPrint", "WHR_CARD_PRINT_LAYOUT", undefined],
    ["cardPrint", "WHR_CARD_PRINT_LAYOUT", "private-invalid-layout-canary"],
    [
      "cardPrint",
      "WHR_CARD_PRINT_LAYOUT",
      JSON.stringify({ ...layout, pageWidthMm: 0 }),
    ],
  ] as const)(
    "%s shares domain validation for %s without contaminating other flags",
    (name, key, value) => {
      const result = policyConfiguration({ ...configured, [key]: value });
      expect(result.policies[name]).toBe("unconfigured");
      for (const other of implemented.filter((item) => item !== name))
        expect(result.policies[other]).toBe("configured");
      expect(JSON.stringify(result)).not.toContain("canary");
    },
  );
  it("production never activates staging auth/delegation/delivery proposals", () => {
    const result = policyConfiguration({
      ...configured,
      WHR_ENV: "production",
      WHR_PHONE_POLICY: undefined,
    });
    expect(result.policies).toMatchObject({
      auth: "unconfigured",
      delegation: "unconfigured",
      delivery: "unconfigured",
      phone: "unconfigured",
    });
    const implicitProduction = policyConfiguration({
      ...configured,
      WHR_ENV: undefined,
      NODE_ENV: "production",
    });
    expect(implicitProduction.policies.auth).toBe("unconfigured");
    expect(implicitProduction.policies.delegation).toBe("unconfigured");
  });
  it("local proposals count only with valid adapter configuration and evaluation makes no provider calls", () => {
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("provider offline"));
    expect(
      policyConfiguration({ WHR_ENV: "local", EMAIL_PROVIDER: "mailpit" })
        .policies,
    ).toMatchObject({ delivery: "configured", phone: "configured" });
    expect(
      policyConfiguration({
        WHR_ENV: "local",
        EMAIL_PROVIDER: "mailpit",
        MAILPIT_URL: "https://private-canary.example.com",
      }).policies.delivery,
    ).toBe("unconfigured");
    expect(policyConfiguration(configured).policies.delivery).toBe(
      "configured",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("ignores arbitrary evaluator names and never serializes evaluator objects or diagnostics", () => {
    const result = policyConfiguration(configured, {
      ...allEnabled,
      secret: () => configured,
    } as PolicyEvaluators);
    expect(Object.keys(result.policies)).toEqual(policyNames);
    expect(JSON.stringify(result)).not.toContain("canary");
  });
});

describe("WHR-100 deployment health projection", () => {
  it("reports only aggregate and probe fields publicly, preserving the deployed version", async () => {
    vi.stubEnv("APP_VERSION", "fictional-commit");
    expect(await getHealth(async () => {})).toEqual({
      ok: true,
      version: "fictional-commit",
      db: "ok",
      fullyConfigured: false,
    });
  });
  it.each([true, false])(
    "redacts policy values and database/auth errors with probe success=%s",
    async (success) => {
      for (const [key, value] of Object.entries(configured))
        vi.stubEnv(key, value);
      for (const authorized of [true, false]) {
        const result = await getHealth(
          async () => {
            if (!success)
              throw new Error(
                "postgresql://private-canary:password@private-host/db",
              );
          },
          async () => authorized,
        );
        expect(result).toMatchObject({
          ok: success,
          db: success ? "ok" : "unavailable",
          fullyConfigured: false,
        });
        expect("cardPrint" in result).toBe(false);
        if (authorized) expect(result.policies?.cardPrint).toBe("configured");
        else expect("policies" in result).toBe(false);
        const serialized = JSON.stringify(result);
        for (const forbidden of [
          "canary",
          "pageWidthMm",
          "BETTER_AUTH",
          "password",
          "private-host",
          "ng-mobile-v1",
          "zoho",
        ])
          expect(serialized).not.toContain(forbidden);
      }
      expect(
        await getHealth(
          async () => {},
          async () => {
            throw new Error("private-auth-canary");
          },
        ),
      ).not.toHaveProperty("policies");
    },
  );
  it("uses one frozen snapshot and authorizes only after the probe completes", async () => {
    vi.stubEnv("WHR_CARD_PRINT_LAYOUT", JSON.stringify(layout));
    vi.stubEnv("APP_VERSION", "before");
    const order: string[] = [];
    const result = await getHealth(
      async () => {
        order.push("probe");
        vi.stubEnv("WHR_CARD_PRINT_LAYOUT", "invalid");
        vi.stubEnv("APP_VERSION", "after");
      },
      async (env) => {
        order.push("authorize");
        expect(Object.isFrozen(env)).toBe(true);
        expect(env.APP_VERSION).toBe("before");
        return true;
      },
    );
    expect(order).toEqual(["probe", "authorize"]);
    expect(result).toMatchObject({
      version: "before",
      policies: { cardPrint: "configured" },
    });
  });
});
