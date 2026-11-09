"use client";
import type { AdminSession } from "@/client/admin-session";
import { Notice } from "@/ui";
import { Pumps, PumpDetails, CreatePump } from "./station-pumps";
import {
  Attendants,
  AttendantProfile,
  CreateAttendant,
  AssignmentEditor,
} from "./station-attendants";
import { Prices, PriceEditor } from "./station-prices";
import "@/styles/station.css";
export const stationSections = [
  { grant: "attendants", label: "Attendants", href: "/admin/attendants" },
  { grant: "pumps", label: "Station pumps", href: "/admin/pumps" },
  { grant: "prices", label: "Product prices", href: "/admin/prices" },
] as const;
export function StationPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  const [section, id, action, subject, view] = path;
  const grants = session.permissions ?? [];
  const assignments = grants.includes("attendants") || grants.includes("pumps");
  const allowed =
    section === "prices"
      ? grants.includes("prices")
      : section === "pumps"
        ? assignments || grants.includes("prices")
        : section === "attendants"
          ? action === "assign" || action === "end"
            ? assignments
            : grants.includes("attendants")
          : false;
  if (!allowed)
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow this section.
      </Notice>
    );
  let screen;
  if (section === "prices")
    screen = id ? (
      <PriceEditor key={id} code={id} confirm={action === "confirm"} />
    ) : (
      <Prices />
    );
  else if (section === "pumps")
    screen =
      id === "new" ? (
        grants.includes("pumps") ? (
          <CreatePump />
        ) : (
          <Notice role="alert">Pump management access is required.</Notice>
        )
      ) : id ? (
        action === "assign" && assignments ? (
          <AssignmentEditor
            key={id + ":assign"}
            pumpId={id}
            confirm={subject === "confirm"}
          />
        ) : action === "end" && subject && assignments ? (
          <AssignmentEditor
            key={id + ":end:" + subject}
            id={subject}
            contextPumpId={id}
            end
            confirm={view === "confirm"}
          />
        ) : (
          <PumpDetails key={id} id={id} />
        )
      ) : (
        <Pumps />
      );
  else
    screen =
      id === "new" ? (
        <CreateAttendant />
      ) : id ? (
        action === "assign" || action === "end" ? (
          <AssignmentEditor
            key={id + ":" + action}
            id={id}
            end={action === "end"}
            confirm={subject === "confirm"}
          />
        ) : (
          <AttendantProfile key={id} id={id} />
        )
      ) : (
        <Attendants />
      );
  return <div className="wr-station">{screen}</div>;
}
