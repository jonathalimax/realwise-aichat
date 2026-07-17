import { describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, hashToken, verifyPassword } from "./index";

describe("auth primitives", () => {
  it("hashes and verifies passwords", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("creates hashable session tokens", () => {
    const session = createSessionToken();
    expect(hashToken(session.rawToken)).toBe(session.tokenHash);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
