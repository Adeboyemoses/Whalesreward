import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
/** Public Compose credentials only; this fixture cannot address a remote service. */
export async function ensureLocalCardBucket() {
  const endpoint =
    process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
  const local = new URL(endpoint);
  if (
    local.protocol !== "http:" ||
    local.hostname !== "127.0.0.1" ||
    local.username ||
    local.password ||
    !["9000", "19000"].includes(local.port)
  )
    throw new Error("Fictional storage requires an approved loopback endpoint");
  const bucket = "whr-e2e-cards";
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId: "whr-local",
      secretAccessKey: "local-development-only",
    },
    forcePathStyle: true,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      !["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(
        (error as Error).name,
      )
    )
      throw error;
  } finally {
    client.destroy();
  }
}
