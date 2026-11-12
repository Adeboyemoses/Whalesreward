/** Pure ng-mobile-v1 parsing; configured policy remains a server responsibility. */
export function normalizeMobilePhone(input: string): string | null {
  if (input.length > 32 || !input || /[^+0-9 ()-]/.test(input)) return null;
  const value = input.replace(/[ ()-]/g, "");
  if (/^0[789][01][0-9]{8}$/.test(value)) return `+234${value.slice(1)}`;
  return /^\+234[789][01][0-9]{8}$/.test(value) ? value : null;
}
