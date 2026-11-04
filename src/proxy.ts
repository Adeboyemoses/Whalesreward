import { NextResponse } from "next/server";
import { isStaging } from "./server/lib/environment";

export function proxy() {
  const response = NextResponse.next();
  if (isStaging()) response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

// Include assets and missing routes as well as pages and API responses.
export const config = { matcher: "/:path*" };
