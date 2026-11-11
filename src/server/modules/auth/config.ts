export const AUTH_POLICY = Object.freeze({
  version: 1,
  offlineMs: 86400000,
  sessionMs: 7 * 86400000,
  replayMs: 300000,
  tombstoneMs: 86400000,
});
export function authConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const secret = env.BETTER_AUTH_SECRET;
  const raw = env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !raw)
    throw new Error("Authentication configuration is unavailable");
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("Authentication origin is invalid");
  return {
    secret,
    origin: url.origin,
    trustedIpHeader: env.WHR_TRUSTED_IP_HEADER,
  };
}
