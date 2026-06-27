// SCT-01 SDK - Hash Utilities
//
// Provides SHA-256 (for Soroban-compatible hashing) and Poseidon
// (for field-native commitments used in Noir circuits).

import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
import { randomBytes as nobleRandom } from "@noble/hashes/utils";
import { poseidon5, poseidon3, poseidon2 } from "poseidon-lite";

/**
 * Compute SHA-256 hash (compatible with Soroban's env.crypto().sha256()).
 */
export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/**
 * Generate cryptographically secure random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  return nobleRandom(length);
}

/**
 * Poseidon hash over field elements (BN254 scalar field).
 * Used for commitments and nullifiers in the ZK circuits.
 *
 * Supports 2, 3, or 5 inputs. For other counts, pad with zeros.
 */
export function poseidonHash(inputs: bigint[]): bigint {
  switch (inputs.length) {
    case 2:
      return poseidon2(inputs);
    case 3:
      return poseidon3(inputs);
    case 5:
      return poseidon5(inputs);
    default: {
      // Pad to 5 inputs with zeros
      const padded = [...inputs];
      while (padded.length < 5) padded.push(0n);
      if (padded.length > 5) {
        throw new Error(
          `Poseidon hash supports max 5 inputs, got ${inputs.length}`
        );
      }
      return poseidon5(padded);
    }
  }
}

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array.
 */
export function bigintToBytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert a Uint8Array (big-endian) to bigint.
 */
export function bytesToBigint(bytes: Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

/**
 * Convert a hex string to Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert a Uint8Array to hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * BN254 scalar field modulus.
 */
export const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Reduce a bigint modulo the BN254 field.
 */
export function toField(n: bigint): bigint {
  return ((n % BN254_MODULUS) + BN254_MODULUS) % BN254_MODULUS;
}
