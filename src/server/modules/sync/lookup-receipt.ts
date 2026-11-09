import { createHmac, timingSafeEqual } from "node:crypto";
import {
  lookupReceiptClaimsSchema,
  type LookupReceiptClaims,
} from "../../../shared/contracts/lookup-receipt";
export type LookupReceiptKeys = {
  activeKid: string | null;
  keys: ReadonlyMap<string, Buffer>;
};
const kidPattern = /^[A-Za-z0-9_-]{1,32}$/;
function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}
/** Dedicated environment-specific keyring. Never log configuration or parsing errors. */
export function lookupReceiptConfig(
  env: Record<string, string | undefined> = process.env,
): LookupReceiptKeys {
  const disabled: LookupReceiptKeys = { activeKid: null, keys: new Map() };
  try {
    if (!env.WHR_LOOKUP_RECEIPT_KEYS) return disabled;
    const raw: unknown = JSON.parse(env.WHR_LOOKUP_RECEIPT_KEYS);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return disabled;
    const keys = new Map<string, Buffer>();
    for (const [kid, value] of Object.entries(raw)) {
      if (!kidPattern.test(kid) || typeof value !== "string") return disabled;
      const key = decode(value);
      if (!key || key.length < 32) return disabled;
      keys.set(kid, key);
    }
    const active = env.WHR_LOOKUP_RECEIPT_ACTIVE_KID;
    return { keys, activeKid: active && keys.has(active) ? active : null };
  } catch {
    return disabled;
  }
}
export function signLookupReceipt(
  claims: LookupReceiptClaims,
  ring: LookupReceiptKeys,
): string | null {
  const parsed = lookupReceiptClaimsSchema.safeParse(claims);
  const kid = ring.activeKid;
  const key = kid ? ring.keys.get(kid) : undefined;
  if (
    !parsed.success ||
    !kid ||
    !kidPattern.test(kid) ||
    !key ||
    key.length < 32
  )
    return null;
  const payload = Buffer.from(JSON.stringify(parsed.data), "utf8").toString(
    "base64url",
  );
  const signed = `lr1.${kid}.${payload}`;
  const result = `${signed}.${createHmac("sha256", key).update(signed, "ascii").digest("base64url")}`;
  return result.length <= 2048 ? result : null;
}
export function verifyLookupReceipt(
  input: unknown,
  ring: LookupReceiptKeys,
): LookupReceiptClaims | null {
  try {
    if (
      typeof input !== "string" ||
      input.length > 2048 ||
      !/^[\x00-\x7f]*$/.test(input)
    )
      return null;
    const parts = input.split(".");
    if (parts.length !== 4 || parts[0] !== "lr1" || !kidPattern.test(parts[1]!))
      return null;
    const key = ring.keys.get(parts[1]!);
    if (!key || key.length < 32) return null;
    const payload = decode(parts[2]!),
      mac = decode(parts[3]!);
    if (!payload || !mac || mac.length !== 32) return null;
    const expected = createHmac("sha256", key)
      .update(parts.slice(0, 3).join("."), "ascii")
      .digest();
    if (!timingSafeEqual(mac, expected)) return null;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const claims = lookupReceiptClaimsSchema.safeParse(JSON.parse(json));
    if (
      !claims.success ||
      !Buffer.from(JSON.stringify(claims.data), "utf8").equals(payload)
    )
      return null;
    return claims.data;
  } catch {
    return null;
  }
}
