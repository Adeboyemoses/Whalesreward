// Shared by native-Node operator writers and application serializers. These phone
// shapes mirror the correction privacy boundary, including punctuation and masks.
const separator = String.raw`[\s().\p{Pd}]*`;
const mobile = String.raw`[789*•xX]${separator}[01*•xX](?:${separator}[0-9*•xX]){8}`;
const prefix = String.raw`(?:\+${separator}2${separator}3${separator}4|0${separator}0${separator}2${separator}3${separator}4|2${separator}3${separator}4)`;
const nationalPhone = new RegExp(
  String.raw`(?<![0-9*•])(?:${prefix}${separator}(?:0${separator})?${mobile}|0${separator}${mobile})(?![0-9*•xX])`,
  "gu",
);
const internationalPhone = new RegExp(
  String.raw`\+${separator}[1-9](?:${separator}[0-9*•xX]){6,14}(?![0-9*•xX])`,
  "gu",
);
const maskedPhone =
  /(?<![\p{L}\p{N}])(?:\+?[0-9][0-9\s().\p{Pd}]*)?(?:(?:[*•xX][\s().\p{Pd}]*){2,}|\.{2,}|…)(?:[\s().\p{Pd}]*[0-9*•xX]){2,}(?![\p{L}\p{N}])/gu;
// Exact generated narratives contain no supplied credential value. No suffix,
// arbitrary sentence or user-controlled token is exempted from label detection.
const categorical =
  /^(?:First password changed|Verified-email password reset|Password changed|Password reset|Historical password changed|Historical password reset)$/i;
export function redactAuditText(value: string): string {
  let safe = value
    .replace(internationalPhone, "[phone removed]")
    .replace(nationalPhone, "[phone removed]")
    .replace(maskedPhone, "[phone removed]");
  safe = safe
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[email removed]",
    )
    .replace(/\b[a-f0-9]{32,}\b/gi, "[secret removed]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[secret removed]")
    .replace(/\b[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}\b/g, "[code removed]");
  if (!categorical.test(safe))
    safe = safe.replace(
      /\b(?:otp|password|token|secret)\s*(?:[:=]\s*|\s+)\S+/gi,
      "[secret removed]",
    );
  safe = safe.replace(
    /\b(?:verification code|one[- ]time code|code)\s*(?::|=|is)?\s*\d{4,8}\b/gi,
    "[secret removed]",
  );
  // Unlabelled six-to-eight digit codes and long numbers remain private. The
  // narrow numeric-unit grammar admits operational quantities/amounts; phone
  // recognition above still wins even when a phone is followed by a unit.
  safe = safe.replace(
    /\b\d{6,}\b/g,
    (candidate, offset: number, source: string) =>
      /^\s+(?:kobo|litres?|kilograms?|kg)\b/i.test(
        source.slice(offset + candidate.length),
      )
        ? candidate
        : "[number removed]",
  );
  return safe;
}
export function safeAuditText(value: string): boolean {
  return (
    !/[\u0000-\u001f\u007f@/\\]|\b(?:password|token|secret|otp|code)\s*[:=]/i.test(
      value,
    ) && redactAuditText(value) === value
  );
}
