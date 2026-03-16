import { describe, it, expect, afterEach } from "vitest";
import { encrypt, decrypt, deriveKey, clearKeyCache } from "./encryption.js";

describe("encryption", () => {
  afterEach(() => {
    clearKeyCache();
  });

  it("encrypt returns an object with ciphertext (Buffer) and iv (hex string)", () => {
    const result = encrypt("hello world");

    expect(Buffer.isBuffer(result.ciphertext)).toBe(true);
    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(typeof result.iv).toBe("string");
    // IV should be 12 bytes = 24 hex chars
    expect(result.iv).toMatch(/^[0-9a-f]{24}$/);
  });

  it("decrypt reverses encrypt (round-trip)", () => {
    const plaintext = "hello world";
    const { ciphertext, iv } = encrypt(plaintext);
    const decrypted = decrypt(ciphertext, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("different plaintexts produce different ciphertexts", () => {
    const a = encrypt("plaintext-a");
    const b = encrypt("plaintext-b");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("same plaintext encrypted twice produces different IVs and ciphertexts", () => {
    const a = encrypt("same text");
    const b = encrypt("same text");
    expect(a.iv).not.toBe(b.iv);
    // Due to random IV, ciphertexts will differ
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("round-trips with special characters", () => {
    const special = "Hello! @#%^*() \n\t 日本語 emoji: 🎉 <script>alert('xss')</script>";
    const { ciphertext, iv } = encrypt(special);
    expect(decrypt(ciphertext, iv)).toBe(special);
  });

  it("round-trips with an empty string", () => {
    const { ciphertext, iv } = encrypt("");
    expect(decrypt(ciphertext, iv)).toBe("");
  });

  it("round-trips with a long string", () => {
    const long = "a".repeat(100_000);
    const { ciphertext, iv } = encrypt(long);
    expect(decrypt(ciphertext, iv)).toBe(long);
  });

  it("deriveKey returns a 32-byte Buffer", () => {
    const key = deriveKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("deriveKey returns the same key on repeated calls (caching)", () => {
    const key1 = deriveKey();
    const key2 = deriveKey();
    expect(key1).toBe(key2); // Same reference due to cache
  });

  it("clearKeyCache forces a new key derivation", () => {
    const key1 = deriveKey();
    clearKeyCache();
    const key2 = deriveKey();
    // Should be equal in value (same machine identity) but different references
    expect(key1).not.toBe(key2);
    expect(key1.equals(key2)).toBe(true);
  });

  it("decrypt fails with tampered ciphertext", () => {
    const { ciphertext, iv } = encrypt("sensitive data");
    // Tamper with a byte in the encrypted portion (after auth tag)
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decrypt(tampered, iv)).toThrow();
  });

  it("decrypt fails with wrong IV", () => {
    const { ciphertext } = encrypt("sensitive data");
    const wrongIv = "0".repeat(24); // Valid hex, wrong value

    expect(() => decrypt(ciphertext, wrongIv)).toThrow();
  });
});
