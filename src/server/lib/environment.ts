type Environment = Record<string, string | undefined>;

export function isStaging(env: Environment = process.env): boolean {
  return env.WHR_ENV === "staging";
}

export function galleryEnabled(env: Environment = process.env): boolean {
  return (
    env.NODE_ENV === "development" ||
    (isStaging(env) && env.WHR_ENABLE_DEV_GALLERY === "true")
  );
}
