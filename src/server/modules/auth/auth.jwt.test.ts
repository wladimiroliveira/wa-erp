import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/server/modules/auth/auth.jwt";

const OPTIONS = { secret: "a-secret-long-enough-to-be-taken-seriously", ttlMinutes: 15 };
const USER_ID = "0192b4d6-7a2e-7c3f-9a1b-2c3d4e5f6a7b";

describe("access token", () => {
  it("signs a token whose subject is the user and that expires after the lifetime", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(OPTIONS, USER_ID);

    const payload = await verifyAccessToken(OPTIONS, token);

    expect(payload?.sub).toBe(USER_ID);
    expect(payload!.exp - payload!.iat).toBe(15 * 60);
    expect(payload!.iat).toBeGreaterThanOrEqual(before);
  });

  it("carries nothing but the subject and the times", async () => {
    const token = await signAccessToken(OPTIONS, USER_ID);
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());

    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "sub"]);
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signAccessToken({ ...OPTIONS, secret: "another-secret-long-enough-to-be-serious" }, USER_ID);

    expect(await verifyAccessToken(OPTIONS, token)).toBeNull();
  });

  it("refuses a token that has expired", async () => {
    const token = await signAccessToken({ ...OPTIONS, ttlMinutes: -1 }, USER_ID);

    expect(await verifyAccessToken(OPTIONS, token)).toBeNull();
  });

  it("refuses a token that is not a token", async () => {
    expect(await verifyAccessToken(OPTIONS, "not-a-token")).toBeNull();
  });
});
