import { expect, it } from "vitest";
import { getHealth } from "../../src/server/modules/health/service";

it("health probes the real PostgreSQL service", async () => {
  expect(await getHealth()).toMatchObject({ ok: true, db: "ok" });
});
