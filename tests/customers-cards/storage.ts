import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
/** Public Compose credentials only; this fixture cannot address a remote service. */
export async function ensureLocalCardBucket() {
  const endpoint =
    process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
  if (!["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname))
    throw new Error("Storage fixtures require loopback");
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
