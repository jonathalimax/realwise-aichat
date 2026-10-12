import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// AES-256-GCM, key derived once from CALENDAR_TOKEN_ENCRYPTION_KEY (any length) via scrypt.
// Format: base64(salt[16] + iv[12] + authTag[16] + ciphertext) — self-contained, no separate IV column needed.
const ALGO = "aes-256-gcm";

function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY is not set — cannot store/read encrypted calendar credentials");
  }
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const salt = raw.subarray(0, 16);
  const iv = raw.subarray(16, 28);
  const authTag = raw.subarray(28, 44);
  const ciphertext = raw.subarray(44);
  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
