/** Access audit deliberately excludes contact details and bearer-shaped values,
 * including when someone pastes them into an otherwise ordinary reason/name. */
export function auditText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[email removed]",
    )
    .replace(/\b[a-f0-9]{48,}\b/gi, "[secret removed]")
    .replace(/\b(?:password|token|secret)\s*[:=]\s*\S+/gi, "[secret removed]")
    .replace(/(?:\+234|0)[789][01][\d ()-]{8,}/g, "[phone removed]");
}
