import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  meterDatabase,
  meterFixture,
  meterSucceeded,
  meterDenied,
  meterDecide,
  meterService,
  addMeterPrice,
  profileVariant,
  installMeterPolicy,
} from "../helpers/meter-fixture";
import {
  seedHistorical,
  sourceAudit,
  S,
  U,
} from "../helpers/review-evidence-fixture";
import { fixtureId } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";
import type { MeterFixture } from "../helpers/meter-fixture";
let db: Awaited<ReturnType<typeof meterDatabase>>;
describe("P-26 real PostgreSQL exact reconciliation", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await meterDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  it("MR-T1-01 uniformly stale rate preserves captured original and exact display strings", async () => {
    const x = await meterFixture(db);
    await addMeterPrice(x, "2026-11-10T14:00:00Z", "120000", 3, 3);
    const { result, provenance } = await meterSucceeded(x);
    expect(result.creditedAfter).toBe(true);
    expect(result.after).toMatchObject({
      amountKobo: "1100000",
      quantity: "10",
      rateKobo: "100000",
      calculation: "meter_evidence",
    });
    expect(provenance.transcription.submitted.quantity).toBe("10.000");
  });

  it.each([
    ["inside", "2026-11-10T12:30:00Z", false],
    ["at L", S, true],
    ["at U", U, false],
  ])(
    "MR-T1-02 activation %s uses closed boundaries",
    async (_name, at, passes) => {
      const x = await meterFixture(db, { priceAt: at });
      if (passes) await meterSucceeded(x);
      else await meterDenied(x, () => meterDecide(x));
    },
  );
  it("MR-T1-02 strictly later current rate and same-rate precision versions cannot reprice the sale", async () => {
    const x = await meterFixture(db);
    await addMeterPrice(x, "2026-11-10T12:30:00Z", "110000", 2, 3);
    await addMeterPrice(x, "2026-11-10T13:00:00.000001Z", "130000", 3, 4);
    const { result } = await meterSucceeded(x);
    expect(result.after.quantityPrecision).toBe(3);
  });
  it.each(["missing", "gapped", "contradictory"])(
    "MR-T1-02 incomplete %s history fails without any mutation",
    async (kind) => {
      const x = await meterFixture(db);
      const latest = (
        await x.pool.query(
          "SELECT id FROM product_price_version WHERE station_id=$1 AND version=2",
          [x.f.stationId],
        )
      ).rows[0].id;
      if (kind === "missing")
        await seedHistorical(
          x.pool,
          "audit_event",
          "DELETE FROM audit_event WHERE action='price_activated' AND after->>'priceVersionId'=$1",
          [latest],
        );
      if (kind === "gapped")
        await seedHistorical(
          x.pool,
          "product_price_version",
          "UPDATE product_price_version SET version=3 WHERE id=$1",
          [latest],
        );
      if (kind === "contradictory")
        await sourceAudit(
          x.pool,
          "price_activated",
          "product",
          fixtureId(9),
          {
            priceVersionId: latest,
            version: 2,
            rateKobo: "110000",
            quantityPrecision: 3,
          },
          "2026-11-10T11:00:00Z",
        );
      await meterDenied(x, () => meterDecide(x));
    },
  );
  it("MR-T1-03 numerically fitting both rates never locates capture", async () => {
    const x = await meterFixture(db, {
      rate: "100001",
      priceAt: "2026-11-10T12:30:00Z",
      amountKobo: "100000",
      quantity: "1.000",
    });
    await meterDenied(x, () => meterDecide(x));
  });
  it.each([
    [
      "04 liquids",
      "110000",
      "11.223",
      "1234567",
      "litre",
      true,
      "37000000",
      "111000000",
    ],
    [
      "05 upper inside",
      "110000",
      "11.223",
      "1234585",
      "litre",
      true,
      "55000000",
      "111000000",
    ],
    [
      "05 lower inside",
      "110000",
      "11.223",
      "1234475",
      "litre",
      true,
      "55000000",
      "111000000",
    ],
    [
      "05 upper outside",
      "110000",
      "11.223",
      "1234586",
      "litre",
      false,
      "56000000",
      "111000000",
    ],
    [
      "05 lower outside",
      "110000",
      "11.223",
      "1234474",
      "litre",
      false,
      "56000000",
      "111000000",
    ],
    [
      "06 gas",
      "150000",
      "12.347",
      "1852000",
      "kilogram",
      true,
      "50000000",
      "151000000",
    ],
    [
      "07 upper inside",
      "150000",
      "12.347",
      "1852125",
      "kilogram",
      true,
      "75000000",
      "151000000",
    ],
    [
      "07 lower inside",
      "150000",
      "12.347",
      "1851975",
      "kilogram",
      true,
      "75000000",
      "151000000",
    ],
    [
      "07 upper outside",
      "150000",
      "12.347",
      "1852126",
      "kilogram",
      false,
      "76000000",
      "151000000",
    ],
    [
      "07 lower outside",
      "150000",
      "12.347",
      "1851974",
      "kilogram",
      false,
      "76000000",
      "151000000",
    ],
    [
      "08 upper equality",
      "101000",
      "1.001",
      "101152",
      "litre",
      true,
      "51000000",
      "102000000",
    ],
    [
      "08 lower equality",
      "101000",
      "1.001",
      "101050",
      "litre",
      true,
      "51000000",
      "102000000",
    ],
    [
      "08 upper outside",
      "101000",
      "1.001",
      "101153",
      "litre",
      false,
      "52000000",
      "102000000",
    ],
    [
      "08 lower outside",
      "101000",
      "1.001",
      "101049",
      "litre",
      false,
      "52000000",
      "102000000",
    ],
    [
      "09 liquid tolerance",
      "110000",
      "10.000",
      "1100800",
      "litre",
      false,
      "800000000",
      "111000000",
    ],
    [
      "09 gas tolerance",
      "150000",
      "2.000",
      "300200",
      "kilogram",
      false,
      "200000000",
      "151000000",
    ],
    [
      "10 board is not authority",
      "110000",
      "11.200",
      "1234567",
      "litre",
      false,
      "2567000000",
      "111000000",
    ],
    [
      "11 meter preserves exact pair",
      "100",
      "0.005",
      "1",
      "litre",
      true,
      "500000",
      "1100000",
    ],
  ] as const)(
    "MR-T1-%s exact rational residual and unchanged threshold",
    async (
      _name,
      rate,
      quantity,
      amountKobo,
      unit,
      passes,
      residual,
      allowance,
    ) => {
      const x = await meterFixture(db, { rate, quantity, amountKobo, unit });
      if (!passes) return meterDenied(x, () => meterDecide(x));
      const { result, provenance } = await meterSucceeded(x);
      expect(result.after.amountKobo).toBe(amountKobo);
      expect(provenance.transcription.submitted).toEqual({
        amountKobo,
        quantity,
      });
      expect(provenance.reconciliation.residual).toEqual({
        numerator: residual,
        denominator: "1000000",
      });
      expect(provenance.reconciliation.allowance).toEqual({
        numerator: allowance,
        denominator: "2000000",
      });
    },
  );
  it.each([
    ["1.005", "101", "102"],
    ["0.005", "100", "1"],
  ])(
    "MR-T1-11 ordinary %s at %s persists one half-up rounding",
    async (quantity, rate, amount) => {
      const x = await meterFixture(db);
      const f = await x.h.context(await x.h.image());
      await seedHistorical(
        x.pool,
        "product_price_version",
        "UPDATE product_price_version SET rate_kobo=$2,quantity_precision=3 WHERE id=$1",
        [f.priceId, rate],
      );
      const sale = await x.h.settle(f, await x.h.image(), {
        entry: {
          basis: "quantity",
          enteredQuantity: quantity,
          amountKobo: amount,
          quantity,
        },
        rateKobo: rate,
        quantityPrecision: 3,
      });
      const row = (
        await x.pool.query(
          "SELECT amount_kobo::text,quantity::text FROM purchase WHERE id=$1",
          [sale.purchaseId],
        )
      ).rows[0];
      expect(row.amount_kobo).toBe(amount);
    },
  );
  it.each([
    { amountKobo: "0" },
    { amountKobo: "-1" },
    { amountKobo: "9223372036854775808" },
    { amountKobo: 1.5 },
    { amountKobo: "1e3" },
    { quantity: "0" },
    { quantity: "-1" },
    { quantity: "100000000000000" },
    { quantity: 1.1 },
    { quantity: "1e0" },
    { quantity: "1.0000001" },
    { rateKobo: "110000" },
    { tolerance: "10" },
    { profile: newId() },
    { policy: "approved" },
    { captureTime: S },
  ])(
    "MR-T1-12 strict invalid scalar or override %j rolls back",
    async (patch) => {
      const x = await meterFixture(db);
      await meterDenied(
        x,
        () =>
          meterDecide(x, {
            ...x.body,
            decision: { ...x.body.decision, ...patch },
          }),
        "invalid_request",
        400,
      );
    },
  );
  it.each([
    [{ precision: 2, quantity: "1.001", amountKobo: "110110" }],
    [{ quantityStep: "0.010", quantity: "1.001", amountKobo: "110110" }],
    [{ amountStepKobo: "5", quantity: "0.001", amountKobo: "101" }],
  ])(
    "MR-T1-12 exact captured precision and step multiples %j",
    async (options) => {
      const x = await meterFixture(db, options);
      await meterDenied(x, () => meterDecide(x), "calculation_invalid", 422);
    },
  );
  it("MR-T1-12 no_change compares latest staged meter candidate", async () => {
    const x = await meterFixture(db);
    await x.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','test',clock_timestamp(),1)",
      [newId(), x.sale.purchaseId],
    );
    const first = await meterDecide(x);
    expect(first.creditedAfter).toBe(false);
    const hold = newId();
    await x.pool.query(
      "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'price','open',$3,'price_uncertain',1)",
      [hold, x.sale.purchaseId, x.original],
    );
    const body = { ...x.body, ...(await x.h.guard(x.sale.purchaseId)) };
    await meterDenied(
      x,
      () => meterService(x).decidePrice(x.token, x.sale.purchaseId, hold, body),
      "no_change",
      409,
    );
  });
  async function policy(x: MeterFixture, profiles: (typeof x.profile)[]) {
    x.meterPolicy = await installMeterPolicy(x, profiles, 2);
    x.env.WHR_METER_POLICY = JSON.stringify(x.meterPolicy);
  }
  it.each([
    ["starts at L", S, "2026-11-10T13:00:00.000001Z", true],
    ["ends at U", "2026-11-01T00:00:00Z", U, false],
    ["starts after L", "2026-11-10T12:00:00.000001Z", null, false],
    [
      "equivalent offsets",
      "2026-11-10T13:00:00+01:00",
      "2026-11-10T14:00:00.000001+01:00",
      true,
    ],
  ] as const)(
    "MR-T1-13 profile %s preserves exact microsecond endpoints",
    async (_name, validFrom, validUntil, pass) => {
      const x = await meterFixture(db);
      await policy(x, [profileVariant(x.profile, { validFrom, validUntil })]);
      if (pass) await meterSucceeded(x);
      else
        await meterDenied(
          x,
          () => meterDecide(x),
          "meter_policy_unconfigured",
          409,
        );
    },
  );
  it("MR-T1-13 adjacent profiles cannot be stitched over I", async () => {
    const x = await meterFixture(db);
    await policy(x, [
      profileVariant(x.profile, { validUntil: "2026-11-10T12:30:00Z" }),
      profileVariant(x.profile, { validFrom: "2026-11-10T12:30:00Z" }),
    ]);
    await meterDenied(
      x,
      () => meterDecide(x),
      "meter_policy_unconfigured",
      409,
    );
  });
  it.each([
    "missing",
    "inactive",
    "unknown release",
    "future activation",
    "digest",
    "unknown approval",
    "unknown verification",
    "unapproved profile",
    "scope",
    "pump",
    "product",
    "unit",
    "precision",
    "zero amount step",
    "zero quantity step",
    "truncating model",
    "overlap",
    "resolver digest",
  ])("MR-T1-13 %s configuration fails closed", async (name) => {
    const x = await meterFixture(db),
      p = structuredClone(x.meterPolicy);
    if (name === "missing") {
      delete (x.env as Record<string, string | undefined>).WHR_METER_POLICY;
      return meterDenied(
        x,
        () => meterDecide(x),
        "meter_policy_unconfigured",
        409,
      );
    }
    const profile = p.profiles[0]!;
    switch (name) {
      case "inactive":
        p.activation = {
          state: "inactive",
          approvalReference: null,
          activatedAt: null,
        };
        break;
      case "unknown release":
        Object.assign(p, { release: "unknown" });
        break;
      case "future activation":
        if (p.activation.state === "active")
          p.activation.activatedAt = "2099-01-01T00:00:00Z";
        break;
      case "digest":
        profile.digest = "0".repeat(64);
        break;
      case "unknown approval":
        profile.approvalReference = newId();
        break;
      case "unknown verification":
        profile.verificationReference = newId();
        break;
      case "unapproved profile":
        await seedHistorical(
          x.pool,
          "meter_profile_approval",
          "DELETE FROM meter_profile_approval WHERE id=$1",
          [profile.approvalReference],
        );
        break;
      case "scope":
        p.scope.stationId = newId();
        break;
      case "pump":
        profile.pumpId = newId();
        break;
      case "product":
        profile.productId = newId();
        break;
      case "unit":
        profile.unit = "kilogram";
        break;
      case "precision":
        profile.quantityPrecision = 2;
        profile.quantityStep = "0.01";
        break;
      case "zero amount step":
        profile.amountStepKobo = "0";
        break;
      case "zero quantity step":
        profile.quantityStep = "0";
        break;
      case "truncating model":
        Object.assign(profile, { displayModel: "truncating" });
        break;
      case "overlap":
        p.profiles.push(profileVariant(profile));
        break;
      case "resolver digest":
        p.resolver.digest = "0".repeat(64);
        break;
    }
    // These are intentionally malformed/unapproved deployment snapshots, never accepted configuration.
    x.env.WHR_METER_POLICY = JSON.stringify(p);
    await meterDenied(
      x,
      () => meterDecide(x),
      "meter_policy_unconfigured",
      409,
    );
  });
  it("MR-T1-13 approved profile with mismatched recorded measurement fails closed", async () => {
    const x = await meterFixture(db);
    await seedHistorical(
      x.pool,
      "meter_verification",
      `UPDATE meter_verification SET content=jsonb_set(content,'{profileContent,amountStepKobo}','"5"') WHERE id=$1`,
      [x.profile.verificationReference],
    );
    await meterDenied(
      x,
      () => meterDecide(x),
      "meter_policy_unconfigured",
      409,
    );
  });
  it.each(["precision", "wrong pump", "wrong product", "wrong unit"])(
    "MR-T1-13 approved but incompatible %s cannot cover the sale",
    async (name) => {
      const x = await meterFixture(db);
      const changes =
        name === "precision"
          ? { quantityPrecision: 2, quantityStep: "0.01" }
          : name === "wrong pump"
            ? { pumpId: newId() }
            : name === "wrong product"
              ? { productId: fixtureId(10) }
              : { unit: "kilogram" as const };
      await policy(x, [profileVariant(x.profile, changes)]);
      await meterDenied(
        x,
        () => meterDecide(x),
        "meter_policy_unconfigured",
        409,
      );
    },
  );
  it.each(["verification", "policy approval"])(
    "MR-T1-13 unknown stored %s fails even with matching configured IDs",
    async (kind) => {
      const x = await meterFixture(db);
      if (kind === "verification")
        await seedHistorical(
          x.pool,
          "meter_verification",
          "DELETE FROM meter_verification WHERE id=$1",
          [x.profile.verificationReference],
        );
      else
        await seedHistorical(
          x.pool,
          "meter_policy_approval",
          "DELETE FROM meter_policy_approval WHERE id=$1",
          [x.meterPolicy.activation.approvalReference],
        );
      await meterDenied(
        x,
        () => meterDecide(x),
        "meter_policy_unconfigured",
        409,
      );
    },
  );
  it("MR-T1-13 stored approved future activation remains unconfigured", async () => {
    const x = await meterFixture(db),
      p = structuredClone(x.meterPolicy);
    if (p.activation.state !== "active") throw new Error();
    p.activation.activatedAt = "2099-01-01T00:00:00Z";
    for (const table of ["meter_configuration", "meter_policy_approval"])
      await seedHistorical(
        x.pool,
        table,
        `UPDATE ${table} SET configuration=$2 WHERE station_id=$1`,
        [x.f.stationId, p],
      );
    x.env.WHR_METER_POLICY = JSON.stringify(p);
    await meterDenied(
      x,
      () => meterDecide(x),
      "meter_policy_unconfigured",
      409,
    );
  });
});
