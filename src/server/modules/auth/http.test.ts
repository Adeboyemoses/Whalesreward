import { describe, expect, it } from "vitest";
import { signInSchema } from "../../../shared/contracts/auth";
import { clientIp, enforceOrigin } from "./http";

describe("attendant auth boundary", () => {
  it("rejects unknown fields, invalid device IDs and control characters", () => {
    const body = {
      username: "grace.okon",
      password: " secret ",
      deviceId: "019a5000-0000-7000-8000-000000000001",
    };
    expect(signInSchema.parse(body).password).toBe(" secret ");
    expect(
      signInSchema.safeParse({ ...body, attendantId: body.deviceId }).success,
    ).toBe(false);
    expect(signInSchema.safeParse({ ...body, deviceId: "bad" }).success).toBe(
      false,
    );
    expect(signInSchema.safeParse({ ...body, username: "a\n" }).success).toBe(
      false,
    );
  });
  it("requires the configured origin and does not trust forwarded host", () => {
    expect(() =>
      enforceOrigin(
        new Request("https://evil.test", {
          headers: {
            Origin: "https://evil.test",
            "X-Forwarded-Host": "station.test",
          },
        }),
        "https://station.test",
      ),
    ).toThrow();
    expect(() =>
      enforceOrigin(
        new Request("https://station.test"),
        "https://station.test",
      ),
    ).toThrow();
  });
  it("ignores spoofable IP headers unless the trusted header is explicitly configured", () => {
    const request = new Request("https://station.test", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
    });
    expect(clientIp(request)).toBe("unattributed");
    expect(clientIp(request, "x-real-ip")).toBe("5.6.7.8");
    expect(clientIp(request, "x-forwarded-for")).toBe("1.2.3.4");
  });
});
