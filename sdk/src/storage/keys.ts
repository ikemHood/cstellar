// SCT-01 SDK - Key derivation for at-rest note encryption
//
// Derives a 32-byte symmetric key from either:
//   - a user passcode (via scrypt), or
//   - an app-held secret such as a Stellar seed / wallet signature
//     (via HKDF-SHA256).
//
// The derived key feeds `EncryptedNoteStorage`. Salt is stored alongside the
// ciphertext blob so the same key can be re-derived on unlock without the
// caller having to remember it.

import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes as nobleRandom } from "@noble/hashes/utils";
import { sha256 as sdkSha256, randomBytes } from "../crypto/hash.js";

/** Length of the symmetric encryption key (XChaCha20-Poly1305). */
export const ENCRYPTION_KEY_BYTES = 32;

/** Length of the random salt used by KDFs. */
export const SALT_BYTES = 16;

/**
 * scrypt parameters for passcode-based key derivation.
 *
 * N=16384, r=8, p=1 is a pragmatic demo setting (~50-150ms on a modern laptop).
 * Production wallets that handle real funds should bump N to 2^17+ or switch
 * to Argon2id with memory-hard settings.
 */
export const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
} as const;

/**
 * Derive a 32-byte key from a user passcode using scrypt.
 *
 * @param passcode User-chosen unlock passcode
 * @param salt 16-byte salt (random on first run; stored with the blob)
 * @returns 32-byte key
 */
export function deriveKeyFromPasscode(
  passcode: string,
  salt: Uint8Array
): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  const encoder = new TextEncoder();
  return scrypt(encoder.encode(passcode), salt, {
    ...SCRYPT_PARAMS,
    dkLen: ENCRYPTION_KEY_BYTES,
  }) as Uint8Array;
}

/**
 * Derive a 32-byte key from an app-held secret (e.g. a Stellar seed, a wallet
 * signature, or a value pulled from a secure enclave / OS keychain).
 *
 * Uses HKDF-style double-hashing with domain separation so callers do not have
 * to worry about pre-image or length-extension concerns.
 *
 * @param secret App-held secret material (will be SHA-256'd first)
 * @param salt 16-byte salt
 */
export function deriveKeyFromSecret(
  secret: Uint8Array,
  salt: Uint8Array
): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  }
  const inner = sdkSha256(concat(salt, sdkSha256(secret)));
  // Second round with domain separator for HKDF-style expansion.
  const info = new TextEncoder().encode("sct01/storage/v1");
  return sdkSha256(concat(inner, info)).slice(0, ENCRYPTION_KEY_BYTES);
}

/**
 * Generate a fresh random salt.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

// noble's scrypt returns Uint8Array; the cast above keeps types happy under
// the project's `strict` TypeScript settings without runtime cost.
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Re-export some hash helpers used by storage callers to avoid forcing them to
// reach into the crypto module directly.
export { nobleRandom, sha256 };