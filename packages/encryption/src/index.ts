import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type MasterKey = {
  version: string;
  key: Buffer;
};

export type EncryptedValue = {
  version: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

export function parseMasterKeys(value: string): MasterKey[] {
  return value.split(",").map((entry) => {
    const [version, encoded] = entry.split(":");
    if (!version || !encoded) throw new Error("Invalid master key entry");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error(`Master key ${version} must be 32 bytes`);
    return { version, key };
  });
}

export function encryptJson(input: unknown, keys: MasterKey[], aad: string): EncryptedValue {
  const active = keys[0];
  if (!active) throw new Error("At least one master key is required");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", active.key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const plaintext = Buffer.from(JSON.stringify(input), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: active.version,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptJson<T>(value: EncryptedValue, keys: MasterKey[], aad: string): T {
  const key = keys.find((candidate) => candidate.version === value.version);
  if (!key) throw new Error(`Missing master key ${value.version}`);
  const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(value.nonce, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
