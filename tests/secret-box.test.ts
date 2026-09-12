import { describe, expect, test } from "bun:test";
import { SecretBox } from "../src/platform/security/secret-box.ts";

describe("SecretBox", () => {
  test("API Key 加密后可解密且不保留明文", async () => {
    const masterKey = Buffer.alloc(32, 7).toString("base64");
    const box = new SecretBox(masterKey);
    const ciphertext = await box.encrypt("test-secret");

    expect(ciphertext).not.toContain("test-secret");
    expect(await box.decrypt(ciphertext)).toBe("test-secret");
  });

  test("拒绝错误长度的主密钥", () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});
