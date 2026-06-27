// Crypto utilities for the dApp (inlined from SDK for client-side use)

import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
import { randomBytes as nobleRandom } from "@noble/hashes/utils";
import { poseidon5, poseidon2 } from "poseidon-lite";
import * as StellarSdk from "@stellar/stellar-sdk";

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function randomBytes(length: number): Uint8Array {
  return nobleRandom(length);
}

export function poseidonHash(inputs: bigint[]): bigint {
  if (inputs.length === 2) return poseidon2(inputs);
  if (inputs.length === 5) return poseidon5(inputs);
  const padded = [...inputs];
  while (padded.length < 5) padded.push(0n);
  return poseidon5(padded.slice(0, 5));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bigintToBytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

const BN254_MOD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function toField(n: bigint): bigint {
  return ((n % BN254_MOD) + BN254_MOD) % BN254_MOD;
}

export function fieldFromBytes(bytes: Uint8Array): bigint {
  return toField(bytesToBigint(bytes));
}

export function addressToField(address: string): bigint {
  let raw: Buffer | Uint8Array;
  if (StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    raw = StellarSdk.StrKey.decodeEd25519PublicKey(address);
  } else if (StellarSdk.StrKey.isValidContract(address)) {
    raw = StellarSdk.StrKey.decodeContract(address);
  } else {
    throw new Error(`invalid Stellar address: ${address}`);
  }
  return fieldFromBytes(new Uint8Array(raw));
}

/** Compute note commitment: Poseidon(asset, amount, owner, rand, nk) */
export function computeCommitment(
  assetId: string,
  amount: bigint,
  owner: string,
  randomness: Uint8Array,
  nullifierKey: Uint8Array
): Uint8Array {
  const assetField = addressToField(assetId);
  const ownerField = addressToField(owner);
  const randField = toField(bytesToBigint(randomness));
  const nkField = toField(bytesToBigint(nullifierKey));

  const hash = poseidonHash([assetField, amount, ownerField, randField, nkField]);
  return bigintToBytes(hash);
}

/** Derive nullifier: Poseidon(nullifier_key, nullifier_secret) */
export function deriveNullifier(
  nullifierKey: Uint8Array,
  nullifierSecret: Uint8Array
): Uint8Array {
  const nkField = toField(bytesToBigint(nullifierKey));
  const nsField = toField(bytesToBigint(nullifierSecret));
  const hash = poseidonHash([nkField, nsField]);
  return bigintToBytes(hash);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function i128ToBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("negative i128 not supported");
  const bytes = new Uint8Array(16);
  let n = value;
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) throw new Error("amount exceeds i128");
  return bytes;
}

export function transferBindingHash(
  root: Uint8Array,
  assetId: string,
  nullifier: Uint8Array,
  outputCommitments: Uint8Array[],
  encryptedNoteHashes: Uint8Array[]
): Uint8Array {
  if (outputCommitments.length !== 2 || encryptedNoteHashes.length !== 2) {
    throw new Error("transfer proof requires exactly two output notes");
  }
  let acc = poseidonHash([2n, fieldFromBytes(root)]);
  acc = poseidonHash([acc, addressToField(assetId)]);
  acc = poseidonHash([acc, fieldFromBytes(nullifier)]);
  acc = poseidonHash([acc, fieldFromBytes(outputCommitments[0])]);
  acc = poseidonHash([acc, fieldFromBytes(outputCommitments[1])]);
  acc = poseidonHash([acc, fieldFromBytes(encryptedNoteHashes[0])]);
  acc = poseidonHash([acc, fieldFromBytes(encryptedNoteHashes[1])]);
  return bigintToBytes(acc);
}

export function unwrapBindingHash(
  root: Uint8Array,
  assetId: string,
  recipient: string,
  nullifier: Uint8Array,
  amount: bigint
): Uint8Array {
  i128ToBytes(amount);
  let acc = poseidonHash([3n, fieldFromBytes(root)]);
  acc = poseidonHash([acc, addressToField(assetId)]);
  acc = poseidonHash([acc, addressToField(recipient)]);
  acc = poseidonHash([acc, fieldFromBytes(nullifier)]);
  acc = poseidonHash([acc, toField(amount)]);
  return bigintToBytes(acc);
}
