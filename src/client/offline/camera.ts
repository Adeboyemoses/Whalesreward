import { ClientError, type CapturedPhoto } from "../types";
export const PHOTO_SETTINGS = {
  longestEdge: 1600,
  jpegQuality: 0.8,
  maxBytes: 8 * 1024 * 1024,
} as const;
export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new ClientError(
      "camera_unavailable",
      "Camera access needs a secure connection. Reopen the app using its secure address.",
    );
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  } catch {
    throw new ClientError(
      "camera_denied",
      "Allow camera access in your browser settings, then try again.",
    );
  }
}
export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}
export async function capturePhoto(
  video: HTMLVideoElement,
): Promise<CapturedPhoto> {
  if (
    !video.srcObject ||
    video.readyState < 2 ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  )
    throw new ClientError(
      "camera_not_ready",
      "Wait for the camera preview, then take the photo.",
    );
  const scale = Math.min(
    1,
    PHOTO_SETTINGS.longestEdge / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context)
    throw new ClientError(
      "camera_unavailable",
      "Camera capture is unavailable. Try again.",
    );
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              new ClientError(
                "camera_failed",
                "Could not capture the photo. Try again.",
              ),
            ),
      "image/jpeg",
      PHOTO_SETTINGS.jpegQuality,
    ),
  );
  if (
    blob.type !== "image/jpeg" ||
    blob.size > PHOTO_SETTINGS.maxBytes ||
    blob.size === 0
  )
    throw new ClientError(
      "photo_invalid",
      "The photo could not be saved. Retake it.",
    );
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return { blob, sha256, bytes: blob.size, mediaType: "image/jpeg" };
}
type Detector = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};
export async function scanQr(video: HTMLVideoElement): Promise<string | null> {
  const Constructor = (
    globalThis as typeof globalThis & {
      BarcodeDetector?: new (options: { formats: string[] }) => Detector;
    }
  ).BarcodeDetector;
  if (!Constructor)
    throw new ClientError(
      "qr_unavailable",
      "QR scanning is unavailable in this browser. Enter the printed code.",
    );
  const results = await new Constructor({ formats: ["qr_code"] }).detect(video);
  return results[0]?.rawValue ?? null;
}
