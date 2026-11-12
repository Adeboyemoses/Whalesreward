import { randomBytes } from "node:crypto";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { meterDatabase,meterFixture,meterSucceeded } from "../helpers/meter-fixture";
let db:Awaited<ReturnType<typeof meterDatabase>>;
describe("P-26 real PostgreSQL exact reconciliation",()=>{
 beforeAll(async()=>{vi.stubEnv("WHR_ENV","test");vi.stubEnv("NEXT_PHASE","phase-production-build");vi.stubEnv("BETTER_AUTH_SECRET",randomBytes(32).toString("hex"));db=await meterDatabase();},30000);
 afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
 it("MR-T1-01 uniformly stale rate preserves captured original and exact display strings",async()=>{const x=await meterFixture(db);const {result,provenance}=await meterSucceeded(x);expect(result.creditedAfter).toBe(true);expect(result.after).toMatchObject({amountKobo:"1100000",quantity:"10",rateKobo:"100000",calculation:"meter_evidence"});expect(provenance.transcription.submitted.quantity).toBe("10.000");});
});
