/**
 * Attachment content digests (W012 domain layer): the default `digestOf`
 * behind the continuity service. SHA-256 through the platform's WebCrypto
 * (`globalThis.crypto.subtle` — available in Node 22, Electron and browsers,
 * no node: import in the domain layer) with an HONEST pure fallback
 * (FNV-1a 64) when no subtle implementation exists. The algorithm is
 * LABELED on every digest record — a fallback digest never masquerades as
 * SHA-256.
 */
import type { AttachmentDigest } from "./records.js";

/** Pure FNV-1a over 64 bits (BigInt math; deterministic, no dependencies). */
export function fnv1a64Of(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = "";
  for (const byte of view) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** The minimal structural shape of WebCrypto's subtle.digest (no DOM lib). */
interface SubtleDigest {
  digest(algorithm: "SHA-256", data: ArrayBufferView): Promise<ArrayBuffer>;
}

/**
 * The default digest: SHA-256 via WebCrypto when available, otherwise the
 * labeled FNV-1a-64 fallback. Pure computation — no IO, no globals beyond
 * the standard crypto primitive.
 */
export async function attachmentDigestOf(bytes: Uint8Array): Promise<AttachmentDigest> {
  const crypto = (globalThis as { crypto?: { subtle?: SubtleDigest } }).crypto;
  const subtle = crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest("SHA-256", bytes);
    return { algorithm: "sha256", value: toHex(digest) };
  }
  return { algorithm: "fnv1a-64", value: fnv1a64Of(bytes) };
}
