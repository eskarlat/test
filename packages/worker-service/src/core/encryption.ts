import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { hostname, userInfo } from "node:os";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha256";
const SALT_SEPARATOR = "::renre-kit::";

let cachedKey: Buffer | null = null;

function getMachineIdentity(): string {
  // Combine hostname + username as machine identity
  // Falls back gracefully if any part fails
  const parts: string[] = [];
  try { parts.push(hostname()); } catch { parts.push("unknown-host"); }
  try { parts.push(userInfo().username); } catch { parts.push("unknown-user"); }
  return parts.join(SALT_SEPARATOR);
}

export function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const identity = getMachineIdentity();
  const salt = Buffer.from(identity, "utf8");

  cachedKey = pbkdf2Sync(
    identity,     // password = machine identity
    salt,         // salt = same identity (deterministic)
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST,
  );

  return cachedKey;
}

export interface EncryptedData {
  ciphertext: Buffer;
  iv: string; // hex-encoded IV
}

export function encrypt(plaintext: string): EncryptedData {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Prepend auth tag to ciphertext for storage
  const ciphertext = Buffer.concat([authTag, encrypted]);

  return {
    ciphertext,
    iv: iv.toString("hex"),
  };
}

export function decrypt(ciphertext: Buffer, ivHex: string): string {
  const key = deriveKey();
  const iv = Buffer.from(ivHex, "hex");

  // First AUTH_TAG_LENGTH bytes are the auth tag
  const authTag = ciphertext.subarray(0, AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// Clear cached key (for testing)
export function clearKeyCache(): void {
  cachedKey = null;
}
