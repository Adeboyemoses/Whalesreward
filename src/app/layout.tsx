import "@/styles/app.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isStaging } from "@/server/lib/environment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Whales Rewards" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {isStaging() && (
          <div
            role="status"
            style={{
              padding: "8px 16px",
              background: "#fff3c4",
              color: "#332600",
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            Staging · fictional data
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
