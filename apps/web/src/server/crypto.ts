import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * Authenticated encryption (AES-256-GCM) for small secrets at rest, e.g. bank
 * details. Format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url parts).
 * Key rotation: new writes use ENCRYPTION_KEY; reads also try ENCRYPTION_KEYS_OLD.
 */

interface Key {
  id: string;
  bytes: Buffer;
}

function keyFrom(b64: string): Key {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length !== 32) throw new Error("Encryption keys must be 32 bytes");
  return { id: createHash("sha256").update(bytes).digest("base64url").slice(0, 8), bytes };
}

const current = keyFrom(env.ENCRYPTION_KEY);
const keyring = new Map<string, Key>([[current.id, current]]);
for (const old of (env.ENCRYPTION_KEYS_OLD ?? "").split(",").filter(Boolean)) {
  const k = keyFrom(old.trim());
  keyring.set(k.id, k);
}

export function encrypt(plaintext: string, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.bytes, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    current.id,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decrypt(payload: string, aad = ""): string {
  const [v, keyId, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !keyId || !iv || !tag || ct === undefined)
    throw new Error("Malformed ciphertext");
  const key = keyring.get(keyId);
  if (!key) throw new Error("Unknown encryption key");
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

export function encryptJson(value: unknown, aad = ""): string {
  return encrypt(JSON.stringify(value), aad);
}

export function decryptJson<T>(payload: string, aad = ""): T {
  return JSON.parse(decrypt(payload, aad)) as T;
}

/** URL-safe random token with `bytes` of entropy (default 128 bits). */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
