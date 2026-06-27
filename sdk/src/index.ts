// SCT-01 SDK - Main Exports

export * from "./types.js";
export { NoteManager } from "./notes/manager.js";
export { computeCommitment, deriveNullifier } from "./crypto/commitment.js";
export { encryptNote, decryptNote } from "./crypto/encryption.js";
export { sha256, poseidonHash, randomBytes } from "./crypto/hash.js";
export {
  ProofGenerator,
  bindingSignal,
  proofPackToGroth16Proof,
} from "./proof/generator.js";
export { ContractClient } from "./contract/client.js";
