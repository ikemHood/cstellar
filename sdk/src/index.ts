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

// Note storage (encrypted-at-rest persistence for spend secrets).
export type {
  BlobStorage,
  NoteStorage,
} from "./storage/types.js";
export {
  BACKUP_MAGIC,
  BACKUP_VERSION,
} from "./storage/types.js";
export {
  MemoryBlobStorage,
  IndexedDbBlobStorage,
} from "./storage/backends.js";
export {
  EncryptedNoteStorage,
  EncryptedJsonStorage,
} from "./storage/encrypted.js";
export {
  ENCRYPTION_KEY_BYTES,
  SALT_BYTES,
  SCRYPT_PARAMS,
  deriveKeyFromPasscode,
  deriveKeyFromSecret,
  generateSalt,
} from "./storage/keys.js";
export {
  type NoteManagerOptions,
  serializeNote,
  deserializeStored,
} from "./notes/manager.js";
