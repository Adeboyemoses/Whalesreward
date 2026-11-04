import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const spec = readFileSync(
  new URL("../../.do/app.staging.yaml", import.meta.url),
  "utf8",
);
const runbook = readFileSync(
  new URL("../../docs/ops/staging.md", import.meta.url),
  "utf8",
);

it("keeps the escaped staging database and bucket configuration aligned with the console", () => {
  expect(spec).toContain("value: ${pg.DATABASE_URL}");
  expect(spec).toContain("value: ${pg.CA_CERT}");
  expect(spec).not.toContain("${db.");
  expect(spec).toMatch(
    /databases:\n  - name: pg\n    engine: PG\n    version: "16"\n    production: true\n    cluster_name: whr-staging-db/,
  );
  expect(spec).toContain("value: whr-staging-evidences\n");
});

it("leaves header trust disabled pending ingress assurance and seed passwords uncommitted", () => {
  expect(spec).toMatch(
    /key: WHR_TRUSTED_IP_HEADER\n    scope: RUN_TIME\n    value: ""/,
  );
  expect(spec).toMatch(
    /key: WHR_SEED_ATTENDANT_PASSWORD\n    scope: RUN_TIME\n    type: SECRET\n    value: ""/,
  );
  expect(runbook).toContain("do-connecting-ip");
  expect(runbook).toContain("does **not explicitly guarantee overwrite");
});

it("removes the unusable CORS ETag step and warns against replacing live secrets", () => {
  expect(runbook).not.toContain("ETag");
  expect(runbook).toContain(
    "**Never run `doctl apps update --spec .do/app.staging.yaml` against a live app.**",
  );
  expect(runbook).toContain("about $32/month baseline");
});
