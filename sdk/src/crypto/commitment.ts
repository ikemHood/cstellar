// SCT-01 SDK - Commitment & Nullifier Computation
//
// These functions mirror the circuit logic exactly:
//   commitment = Poseidon(asset_id, amount, owner, randomness, nullifier_key)
//   nullifier  = Poseidon(nullifier_key, nullifier_secret)
//
// The Poseidon hash is used for field-native commitments that work
// efficiently in the Circom ZK circuit.

import { poseidonHash, bigintToBytes, bytesToBigint, toField } from "./hash.js";
import { sha256 } from "./hash.js";
import type { Note, NoteCommitment, Nullifier } from "../types.js";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Compute a note commitment from a Note.
 *
 * commitment = Poseidon(asset_id, amount, owner, randomness, nullifier_key)
 *
 * This matches the `NoteCommitment` template in `circuits/circom/sct01.circom`.
 */
export function computeCommitment(note: Note): NoteCommitment {
  const assetField = addressToField(note.assetId);
  const ownerField = addressToField(note.owner);
  const randomnessField = bytesToField(note.randomness);
  const nullifierKeyField = bytesToField(note.nullifierKey);

  const hash = poseidonHash([
    assetField,
    note.amount,
    ownerField,
    randomnessField,
    nullifierKeyField,
  ]);

  return {
    hash: bigintToBytes(hash),
    noteId: note.id,
  };
}

/**
 * Compute a commitment from raw field inputs (for testing).
 */
export function computeCommitmentFromFields(
  assetId: bigint,
  amount: bigint,
  owner: bigint,
  randomness: bigint,
  nullifierKey: bigint
): Uint8Array {
  const hash = poseidonHash([assetId, amount, owner, randomness, nullifierKey]);
  return bigintToBytes(hash);
}

/**
 * Derive a nullifier from a Note.
 *
 * nullifier = Poseidon(nullifier_key, nullifier_secret)
 *
 * This matches the nullifier derivation in the Noir circuits.
 */
export function deriveNullifier(note: Note): Nullifier {
  const nullifierKeyField = bytesToField(note.nullifierKey);
  const nullifierSecretField = bytesToField(note.nullifierSecret);

  const hash = poseidonHash([nullifierKeyField, nullifierSecretField]);

  return {
    value: bigintToBytes(hash),
    noteId: note.id,
  };
}

/**
 * Derive a nullifier from raw field inputs (for testing).
 */
export function deriveNullifierFromFields(
  nullifierKey: bigint,
  nullifierSecret: bigint
): Uint8Array {
  const hash = poseidonHash([nullifierKey, nullifierSecret]);
  return bigintToBytes(hash);
}

/**
 * Compute one Poseidon Merkle parent, matching the wrapper contract.
 */
export function computeTreeRoot(
  oldRoot: Uint8Array,
  commitment: Uint8Array
): Uint8Array {
  return bigintToBytes(poseidonHash([bytesToField(oldRoot), bytesToField(commitment)]));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Stellar address string to a field element.
 * Valid `G...` and `C...` addresses use the same raw 32-byte payload as
 * Soroban `Address::to_payload()`. Non-address strings keep the legacy
 * SHA-256 fallback for tests and offline fixtures.
 */
function addressToField(address: string): bigint {
  if (StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    return bytesToField(StellarSdk.StrKey.decodeEd25519PublicKey(address));
  }
  if (StellarSdk.StrKey.isValidContract(address)) {
    return bytesToField(StellarSdk.StrKey.decodeContract(address));
  }
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(address));
  return toField(bytesToBigint(hash));
}

/**
 * Convert a byte array to a field element (big-endian, mod BN254).
 */
function bytesToField(bytes: Uint8Array): bigint {
  return toField(bytesToBigint(bytes));
}
