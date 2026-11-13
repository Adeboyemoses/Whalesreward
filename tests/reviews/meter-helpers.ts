import type pg from "pg";
import { browserMeterPolicy } from "./meter-policy";
import { meterReleaseArtifact } from "../../src/server/modules/reviews/meter-release";
import { reviewEvidenceReleaseArtifact } from "../../src/server/modules/reviews/release";
import { profileContent } from "../../src/server/modules/reviews/meter-policy";
import { seedId } from "../station/helpers";
export async function installBrowserMeter(db: pg.Client) {
  const p = browserMeterPolicy;
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(932132)");
    for (const profile of p.profiles) {
      const content = profileContent(profile);
      await db.query(
        "INSERT INTO meter_verification(id,station_id,content,authorization_reference) VALUES($1,$2,$3,'Fictional browser measurement') ON CONFLICT DO NOTHING",
        [
          profile.verificationReference,
          profile.stationId,
          {
            profileContent: content,
            measuredMeterIdentity: "Fictional browser meter",
            measurementReference: seedId(9360 + profile.quantityPrecision),
            verificationNotes: "Test common-sale nearest display steps",
          },
        ],
      );
      await db.query(
        "INSERT INTO meter_profile_approval(id,station_id,profile_id,profile_version,digest,profile_content,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,'Fictional browser approval') ON CONFLICT DO NOTHING",
        [
          profile.approvalReference,
          profile.stationId,
          profile.id,
          profile.version,
          profile.digest,
          content,
        ],
      );
    }
    await db.query(
      "INSERT INTO meter_policy_approval(id,station_id,environment,revision,configuration,artifact,resolver_artifact,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,$7,'Fictional browser policy approval') ON CONFLICT DO NOTHING",
      [
        p.activation.approvalReference,
        p.scope.stationId,
        p.scope.environment,
        p.revision,
        p,
        meterReleaseArtifact,
        reviewEvidenceReleaseArtifact,
      ],
    );
    await db.query(
      "INSERT INTO meter_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,$3,$4,$5,'Fictional browser policy') ON CONFLICT DO NOTHING",
      [seedId(9351), p.scope.stationId, p.scope.environment, p.revision, p],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
