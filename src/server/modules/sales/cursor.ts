import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { AuthError } from "../auth/errors";
const position = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  id: authId,
  scope: z.string().max(1024),
});
export function encodeCursor(
  secret: string,
  scope: string,
  at: string,
  id: string,
) {
  const payload = Buffer.from(
    JSON.stringify(position.parse({ scope, at, id })),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function decodeCursor(secret: string, scope: string, value?: string) {
  if (!value) return null;
  try {
    const [payload, signature, ...extra] = value.split(".");
    if (!payload || !signature || extra.length) throw new Error();
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error();
    const parsed = position.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (parsed.scope !== scope) throw new Error();
    return parsed;
  } catch {
    throw new AuthError("invalid_request", 400);
  }
}
