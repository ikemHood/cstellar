// Contract interaction helpers for the dApp.
// Thin adapters over @sct01/sdk so pages keep stable imports.

import { ContractClient, type Groth16Proof } from "@sct01/sdk";
import { config } from "@/lib/stellar";
import { sha256, randomBytes, bytesToHex, hexToBytes } from "@/lib/crypto";

export type { Groth16Proof };
export { sha256, randomBytes, bytesToHex, hexToBytes };

type SignTransaction = (xdr: string) => Promise<string>;

function requireContracts() {
  if (!config.wrapperContractId) throw new Error("Missing adapter contract ID");
  if (!config.verifierContractId) throw new Error("Missing verifier contract ID");
  if (!config.assetAddress) throw new Error("Missing asset contract ID");
}

function client(): ContractClient {
  requireContracts();
  return new ContractClient({
    rpcUrl: config.rpcUrl,
    horizonUrl: config.horizonUrl,
    networkPassphrase: config.networkPassphrase,
    wrapperContractId: config.wrapperContractId,
    verifierContractId: config.verifierContractId,
  });
}

export async function submitWrap(
  sourceAddress: string,
  amount: bigint,
  commitment: Uint8Array,
  encryptedNote: Uint8Array,
  signTransaction: SignTransaction
): Promise<string> {
  return client().deposit(
    sourceAddress,
    amount,
    commitment,
    encryptedNote,
    signTransaction
  );
}

export async function submitTransfer(
  sourceAddress: string,
  proof: Groth16Proof,
  merkleRoot: Uint8Array,
  assetId: string,
  nullifiers: Uint8Array[],
  outputCommitments: Uint8Array[],
  encryptedNotes: Uint8Array[],
  signTransaction: SignTransaction
): Promise<string> {
  return client().transfer(
    sourceAddress,
    proof,
    merkleRoot,
    assetId,
    nullifiers,
    outputCommitments,
    encryptedNotes,
    signTransaction
  );
}

export async function submitUnwrap(
  sourceAddress: string,
  proof: Groth16Proof,
  nullifier: Uint8Array,
  recipient: string,
  amount: bigint,
  merkleRoot: Uint8Array,
  assetId: string,
  signTransaction: SignTransaction
): Promise<string> {
  return client().withdraw(
    sourceAddress,
    proof,
    nullifier,
    recipient,
    amount,
    merkleRoot,
    assetId,
    signTransaction
  );
}

export async function getMerkleRoot(sourceAddress: string): Promise<Uint8Array> {
  return client().getRoot(sourceAddress);
}

export async function getNoteCount(sourceAddress: string): Promise<number> {
  return client().getNoteCount(sourceAddress);
}
