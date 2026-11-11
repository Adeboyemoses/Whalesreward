import { z } from "zod";
export const duplicateWindowSchema = z.strictObject({
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  windowSeconds: z.number().int().min(1).max(86400),
});
export function duplicateWindow(
  env: Readonly<Record<string, string | undefined>> = process.env,
  stationId: string | undefined = env.DUPLICATE_WINDOW_STATION_ID,
) {
  try {
    if (
      !stationId ||
      stationId !== env.DUPLICATE_WINDOW_STATION_ID ||
      !z.uuid().safeParse(stationId).success
    )
      return null;
    return duplicateWindowSchema.parse(
      JSON.parse(env.DUPLICATE_WINDOW_POLICY ?? "null"),
    );
  } catch {
    return null;
  }
}
