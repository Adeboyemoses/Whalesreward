import { lookupSchema } from "../shared/contracts/sync";
type Detector = {
  detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};
export function cardQrValue(value: string): string | null {
  const parsed = lookupSchema.safeParse({ source: "qr", qr: value });
  return parsed.success && parsed.data.source === "qr" ? parsed.data.qr : null;
}
export function cardDetector(): Detector | null {
  const Constructor = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: new (options: { formats: string[] }) => Detector;
    }
  ).BarcodeDetector;
  if (!Constructor) return null;
  try {
    return new Constructor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}
