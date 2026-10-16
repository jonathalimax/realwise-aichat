import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "path";

export function storageRoot(): string {
  return resolve(process.env.LOCAL_STORAGE_DIR ?? "./storage");
}

/** Resolves a storage key under LOCAL_STORAGE_DIR and refuses anything that escapes it. */
export function resolveStoragePath(key: string): string {
  if (!key || isAbsolute(key) || key.includes("\0")) throw new Error("invalid storage key");
  const root = storageRoot();
  const full = resolve(root, normalize(key));
  if (full !== root && !full.startsWith(root + sep)) throw new Error("storage key escapes the storage root");
  return full;
}

export async function putFile(key: string, data: Buffer): Promise<void> {
  const path = resolveStoragePath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(resolveStoragePath(key));
}

export async function deleteFile(key: string): Promise<boolean> {
  try {
    await unlink(resolveStoragePath(key));
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") return true;
    return false;
  }
}

export type SniffedType = { mime: string; ext: string };

/** Detects the real file type from magic bytes (the client-sent mimetype is never trusted). */
export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** SVG has no magic bytes: accept only text that starts like an SVG document (logos only; served with nosniff + CSP). */
export function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) && !buf.toString("utf8").toLowerCase().includes("<script");
}
