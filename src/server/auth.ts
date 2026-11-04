import { betterAuth } from "better-auth/minimal";
import { createAdapterFactory } from "better-auth/adapters";
import { username } from "better-auth/plugins/username";
import type pg from "pg";
import { newId } from "./lib/ids";

/** Deliberately restricted adapter: only the server-only username endpoint is used.
 * No Better Auth handler is mounted; unsupported operations fail closed. The caller
 * owns a PostgreSQL transaction, live-user locks, capture context and replay. */
export function attendantAuth(
  db: pg.PoolClient,
  config: { secret: string; origin: string },
  createSession: (userId: string) => Promise<Record<string, unknown>>,
) {
  const unsupported = async (): Promise<never> => {
    throw new Error("Unsupported attendant auth adapter operation");
  };
  const adapter = createAdapterFactory({
    config: {
      adapterId: "whr-attendant",
      adapterName: "Whales attendant transaction adapter",
      supportsDates: true,
      supportsBooleans: true,
    },
    adapter: () => ({
      create: async ({ model, data }) => {
        if (model !== "session" || typeof data.userId !== "string")
          return unsupported();
        return (await createSession(data.userId)) as typeof data;
      },
      findOne: async ({ model, where }) => {
        if (
          model === "user" &&
          where.length === 1 &&
          where[0]?.field === "username" &&
          typeof where[0].value === "string"
        ) {
          const result = await db.query(
            `SELECT id, display_name AS name, username_normalized AS username, username AS "displayUsername", created_at AS "createdAt", updated_at AS "updatedAt"
            FROM auth_user WHERE username_normalized=$1 AND kind='attendant' AND enabled=true AND EXISTS(SELECT 1 FROM auth_credential c WHERE c.user_id=auth_user.id AND c.provider='credential' AND c.provider_account_id=auth_user.id::text AND c.password_hash IS NOT NULL) FOR SHARE`,
            [where[0].value],
          );
          const user = result.rows[0];
          return user
            ? {
                ...user,
                email: `${user.id}@example.invalid`,
                emailVerified: false,
                image: null,
              }
            : null;
        }
        if (model === "account") {
          const user = where.find((w) => w.field === "userId");
          if (
            !user ||
            typeof user.value !== "string" ||
            where.some(
              (w) => !["userId", "providerId", "accountId"].includes(w.field),
            )
          )
            return unsupported();
          const result = await db.query(
            `SELECT id, user_id AS "userId", provider AS "providerId", provider_account_id AS "accountId", password_hash AS password, created_at AS "createdAt", updated_at AS "updatedAt" FROM auth_credential WHERE user_id=$1 AND provider='credential' AND provider_account_id=$1::text FOR SHARE`,
            [user.value],
          );
          return result.rows[0] ?? null;
        }
        return unsupported();
      },
      findMany: unsupported,
      update: unsupported,
      updateMany: unsupported,
      delete: unsupported,
      deleteMany: unsupported,
      count: unsupported,
    }),
  });
  return betterAuth({
    database: adapter,
    baseURL: config.origin,
    secret: config.secret,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      maxPasswordLength: 1024,
    },
    plugins: [
      username({
        minUsernameLength: 1,
        maxUsernameLength: 64,
        usernameValidator: () => true,
        usernameNormalization: (value) => value.trim().toLowerCase(),
      }),
    ],
    session: {
      expiresIn: 7 * 86400,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: true,
    },
    rateLimit: { enabled: false }, // durable wrapper buckets include credential failures
    logger: { disabled: true },
  });
}
