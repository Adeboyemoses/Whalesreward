import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
const require = createRequire(import.meta.url);

for (const allowlist of ["", "ada@example.com"]) {
  test(`compiled production server exits for ${allowlist ? "populated" : "empty"} staging allowlist`, async () => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          WHR_ENV: "production",
          EMAIL_PROVIDER: "noop",
          EMAIL_ALLOWED_RECIPIENTS: allowlist,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
        timer = setTimeout(
          () =>
            reject(
              new Error("Invalid email configuration left server running"),
            ),
          10000,
        );
      });
      expect(exitCode).toBe(1);
      expect(output).toContain("Email configuration is invalid");
      expect(output).not.toContain("ada@example.com");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
}
