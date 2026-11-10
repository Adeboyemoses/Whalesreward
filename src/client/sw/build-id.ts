/** Compiled into the shell; server headers use the same Next build identifier. */
export const APP_BUILD = process.env.NEXT_PUBLIC_WHR_BUILD ?? "development";
export const UPDATE_MESSAGE = "A newer version is ready. Reload to continue.";
export function observeServerBuild(value: string | null): boolean {
  const changed = !!value && value !== APP_BUILD;
  if (changed && typeof window !== "undefined")
    window.dispatchEvent(new Event("whr-build-changed"));
  return changed;
}
