import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, parseMasterKeys } from "./index";

const keys = parseMasterKeys(`v1:${Buffer.alloc(32, 7).toString("base64")}`);

describe("tenant-bound encryption", () => {
  it("round trips JSON with matching authenticated metadata", () => {
    const encrypted = encryptJson({ token: "secret" }, keys, "tenant:t1:meta");
    expect(decryptJson(encrypted, keys, "tenant:t1:meta")).toEqual({ token: "secret" });
  });

  it("rejects different tenant metadata", () => {
    const encrypted = encryptJson({ token: "secret" }, keys, "tenant:t1:meta");
    expect(() => decryptJson(encrypted, keys, "tenant:t2:meta")).toThrow();
  });
});
