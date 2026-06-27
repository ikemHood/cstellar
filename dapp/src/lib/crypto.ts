// dApp-facing crypto exports from the SCT-01 SDK.

import {
  computeCommitmentBytes,
  deriveNullifierBytes,
} from "@sct01/sdk";

export {
  addressToField,
  bigintToBytes,
  bytesToBigint,
  bytesToHex,
  concatBytes,
  fieldFromBytes,
  hexToBytes,
  poseidonHash,
  randomBytes,
  sha256,
  toField,
  transferBindingHash,
  unwrapBindingHash,
} from "@sct01/sdk";

export function computeCommitment(
  assetId: string,
  amount: bigint,
  owner: string,
  randomness: Uint8Array,
  nullifierKey: Uint8Array
): Uint8Array {
  return computeCommitmentBytes(assetId, amount, owner, randomness, nullifierKey);
}

export function deriveNullifier(
  nullifierKey: Uint8Array,
  nullifierSecret: Uint8Array
): Uint8Array {
  return deriveNullifierBytes(nullifierKey, nullifierSecret);
}
