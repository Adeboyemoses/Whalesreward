import { createHash, createHmac } from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const hmac = (secret: string, purpose: string, value: string) =>
  createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex");
export const sessionSecret = (secret: string, id: string) =>
  hmac(secret, "session-v1", id);
