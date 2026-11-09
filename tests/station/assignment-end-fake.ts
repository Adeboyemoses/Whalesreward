import { expect, type Page, type Route } from "@playwright/test";
import { v7 } from "uuid";
import type { Attendant } from "./helpers";

/** Test transport only, until WHR-80 merges. It proves client contract handling,
 * never the real endpoint's transaction, revocation or queue preservation. */
export async function installAssignmentEndFake(
  page: Page,
  initial: Attendant,
  actor: { id: string; code: string; name: string },
  options: { loseFirstResponse?: boolean; conflictFirst?: boolean } = {},
) {
  if (!initial.assignment) throw new Error("Fake needs a current assignment");
  const originalAssignment = structuredClone(initial.assignment);
  let current = structuredClone(initial);
  const calls: Array<Record<string, unknown>> = [];
  const receipts = new Map<string, { input: string; receipt: unknown }>();
  let effectCount = 0;
  let endedAt: string | null = null;
  let allow = true;
  let projected = false;
  const success = (route: Route, data: unknown) =>
    route.fulfill({
      status: 200,
      headers: { "cache-control": "no-store" },
      json: { data, serverTime: new Date().toISOString(), requestId: v7() },
    });
  const failure = (route: Route, code: string, status: number) =>
    route.fulfill({
      status,
      headers: { "cache-control": "no-store" },
      json: {
        error: {
          code,
          message: "The request could not be completed.",
          retryable: false,
        },
        serverTime: new Date().toISOString(),
        requestId: v7(),
      },
    });
  await page.route(`**/api/admin/attendants/${initial.id}`, async (route) => {
    if (route.request().method() !== "GET" || !projected)
      return route.continue();
    return success(route, current);
  });
  await page.route(
    `**/api/admin/attendants/${initial.id}/assignments*`,
    async (route) => {
      if (!endedAt) return route.continue();
      const response = await route.fetch();
      const json = await response.json();
      json.data.items = json.data.items.map(
        (event: { id: string; effectiveUntil: string | null }) =>
          event.id === originalAssignment.id
            ? { ...event, effectiveUntil: endedAt }
            : event,
      );
      return route.fulfill({ response, json });
    },
  );
  await page.route(
    `**/api/admin/attendants/${initial.id}/assignment/end`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual([
        "expectedAssignmentId",
        "expectedVersion",
        "operationId",
        "reason",
      ]);
      expect(body.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(typeof body.reason).toBe("string");
      expect(body.reason.trim().length).toBeGreaterThan(0);
      calls.push(structuredClone(body));
      if (!allow) return failure(route, "permission_denied", 403);
      const receipt = receipts.get(body.operationId);
      if (receipt) {
        if (receipt.input !== JSON.stringify(body))
          return failure(route, "operation_conflict", 409);
        return success(route, receipt.receipt);
      }
      if (options.conflictFirst && calls.length === 1) {
        current = { ...current, version: current.version + 1 };
        projected = true;
        return failure(route, "version_conflict", 409);
      }
      if (
        body.expectedVersion !== current.version ||
        body.expectedAssignmentId !== current.assignment?.id
      )
        return failure(route, "version_conflict", 409);
      if (!current.assignment) return failure(route, "no_change", 409);
      endedAt = new Date(
        Math.max(Date.now(), Date.parse(originalAssignment.effectiveFrom) + 1),
      ).toISOString();
      effectCount++;
      projected = true;
      current = {
        ...current,
        version: current.version + 1,
        assignment: null,
        handover: "unassigned",
      };
      const result = {
        operationId: body.operationId,
        attendant: structuredClone(current),
        ended: {
          assignmentId: originalAssignment.id,
          assignmentVersion: originalAssignment.version,
          pumpId: originalAssignment.pump.id,
          effectiveUntil: endedAt,
          actor,
          reason: body.reason.trim(),
        },
      };
      receipts.set(body.operationId, {
        input: JSON.stringify(body),
        receipt: result,
      });
      if (options.loseFirstResponse && effectCount === 1 && calls.length === 1)
        return route.abort("failed");
      return success(route, result);
    },
  );
  return {
    calls,
    get effectCount() {
      return effectCount;
    },
    get current() {
      return structuredClone(current);
    },
    deny() {
      allow = false;
    },
    reassign() {
      current = {
        ...current,
        version: current.version + 1,
        assignment: {
          ...originalAssignment,
          id: v7(),
          version: originalAssignment.version + 1,
        },
        handover: "fresh_sign_in_required",
      };
    },
  };
}
