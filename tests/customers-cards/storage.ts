import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
/** Public Compose credentials only; this fixture cannot address a remote service. */
export async function ensureLocalCardBucket() {
  const endpoint = "http://127.0.0.1:9000";
  const bucket = process.env.WHR_CUSTOMERS_TEST_BUCKET ?? "whr-e2e-cards";
  if (!/^whr-(?:app6|e2e)-[a-z0-9-]+$/.test(bucket))
    throw new Error("Use an isolated local card fixture bucket");
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
