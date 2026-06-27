// SCT-01 SDK - Main Exports

export * from "./types.js";
export { NoteManager } from "./notes/manager.js";
export {
  addressToField,
  computeCommitment,
  computeCommitmentBytes,
  concatBytes,
  deriveNullifier,
  deriveNullifierBytes,
  transferBindingHash,
  unwrapBindingHash,
} from "./crypto/commitment.js";
export { encryptNote, decryptNote } from "./crypto/encryption.js";
export {
  bigintToBytes,
  bytesToBigint,
  bytesToHex,
  fieldFromBytes,
  hexToBytes,
  poseidonHash,
  randomBytes,
  sha256,
  toField,
} from "./crypto/hash.js";
export {
  type Groth16Proof,
  ProofGenerator,
  bindingSignal,
  proofPackToGroth16Proof,
} from "./proof/generator.js";
export { ContractClient } from "./contract/client.js";
