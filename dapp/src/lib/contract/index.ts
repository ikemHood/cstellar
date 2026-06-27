// Contract interaction helpers for the dApp
// Re-exports SDK functionality adapted for Next.js client components

import * as StellarSdk from "@stellar/stellar-sdk";
import { config, rpc } from "@/lib/stellar";
import { sha256, randomBytes, bytesToHex, hexToBytes } from "@/lib/crypto";

// Re-export crypto functions (inlined from SDK for dApp use)
export { sha256, randomBytes, bytesToHex, hexToBytes };

type SignTransaction = (xdr: string) => Promise<string>;

export interface Groth16Proof {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
}

function requireContracts() {
  if (!config.wrapperContractId) throw new Error("Missing wrapper contract ID");
  if (!config.verifierContractId) throw new Error("Missing verifier contract ID");
  if (!config.assetAddress) throw new Error("Missing asset contract ID");
}

function scBytesN(bytes: Uint8Array): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(bytes, { type: "bytes" });
}

function scBytes(bytes: Uint8Array): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(bytes, { type: "bytes" });
}

function scGroth16Proof(proof: Groth16Proof): StellarSdk.xdr.ScVal {
  return scMap([
    ["a", scBytesN(proof.a)],
    ["b", scBytesN(proof.b)],
    ["c", scBytesN(proof.c)],
  ]);
}

function scVec(values: StellarSdk.xdr.ScVal[]): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec(values);
}

function scMap(
  entries: Array<[string, StellarSdk.xdr.ScVal]>
): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap(
    entries.sort(([a], [b]) => a.localeCompare(b)).map(
      ([key, val]) =>
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol(key),
          val,
        })
    )
  );
}

async function submitOperation(
  sourceAddress: string,
  operation: StellarSdk.xdr.Operation,
  signTransaction: SignTransaction
): Promise<string> {
  const account = await rpc.getAccount(sourceAddress);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  const assembled = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
  const signedXdr = await signTransaction(assembled.toXDR());
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    config.networkPassphrase
  ) as StellarSdk.Transaction;

  const response = await rpc.sendTransaction(signedTx);
  if (response.status === "ERROR") {
    throw new Error(`Transaction failed: ${response.errorResult}`);
  }

  return pollTransaction(response.hash);
}

/**
 * Build and submit a wrap transaction.
 */
export async function submitWrap(
  sourceAddress: string,
  amount: bigint,
  commitment: Uint8Array,
  encryptedNote: Uint8Array,
  signTransaction: SignTransaction
): Promise<string> {
  requireContracts();
  const contract = new StellarSdk.Contract(config.wrapperContractId);

  return submitOperation(
    sourceAddress,
      contract.call(
        "wrap",
        StellarSdk.Address.fromString(sourceAddress).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" }),
        scBytesN(commitment),
        scBytes(encryptedNote)
      ),
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
  requireContracts();
  const contract = new StellarSdk.Contract(config.wrapperContractId);
  const encryptedNoteHashes = encryptedNotes.map((note) => sha256(note));
  const publicInputsVal = scMap([
    ["merkle_root", scBytesN(merkleRoot)],
    ["asset_id", StellarSdk.Address.fromString(assetId).toScVal()],
    ["output_commitments", scVec(outputCommitments.map(scBytesN))],
    ["encrypted_note_hashes", scVec(encryptedNoteHashes.map(scBytesN))],
  ]);

  return submitOperation(
    sourceAddress,
    contract.call(
      "confidential_transfer",
      scGroth16Proof(proof),
      publicInputsVal,
      scVec(nullifiers.map(scBytesN)),
      scVec(outputCommitments.map(scBytesN)),
      scVec(encryptedNotes.map(scBytes))
    ),
    signTransaction
  );
}

/**
 * Build and submit an unwrap transaction.
 */
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
  requireContracts();
  const contract = new StellarSdk.Contract(config.wrapperContractId);

  const publicInputsVal = scMap([
    ["merkle_root", scBytesN(merkleRoot)],
    ["asset_id", StellarSdk.Address.fromString(assetId).toScVal()],
    ["recipient", StellarSdk.Address.fromString(recipient).toScVal()],
    ["amount", StellarSdk.nativeToScVal(amount, { type: "i128" })],
  ]);

  return submitOperation(
    sourceAddress,
      contract.call(
        "unwrap",
        scGroth16Proof(proof),
        publicInputsVal,
        scBytesN(nullifier),
        StellarSdk.Address.fromString(recipient).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" })
      ),
    signTransaction
  );
}

/**
 * Query contract state: get Merkle tree root.
 */
export async function getMerkleRoot(sourceAddress: string): Promise<Uint8Array> {
  requireContracts();
  const account = await rpc.getAccount(sourceAddress);
  const contract = new StellarSdk.Contract(config.wrapperContractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("root"))
    .setTimeout(30)
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Root query failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error("Root query returned no result");
  }
  return StellarSdk.scValToNative(simulation.result.retval) as Uint8Array;
}

export async function getNoteCount(sourceAddress: string): Promise<number> {
  requireContracts();
  const account = await rpc.getAccount(sourceAddress);
  const contract = new StellarSdk.Contract(config.wrapperContractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("note_count"))
    .setTimeout(30)
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Note count query failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error("Note count query returned no result");
  }
  const native = StellarSdk.scValToNative(simulation.result.retval);
  return Number(native);
}

/**
 * Poll for transaction completion.
 */
async function pollTransaction(hash: string): Promise<string> {
  let response = await rpc.getTransaction(hash);
  let attempts = 0;
  while (response.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    response = await rpc.getTransaction(hash);
    attempts++;
  }
  if (response.status === "SUCCESS") return hash;
  throw new Error(`Transaction failed: ${response.status}`);
}
