// SCT-01 SDK - Contract Client
//
// Client for the SCT-01 Confidential Transfer Adapter and verifier contracts.
// Matches the live dApp transaction shape used on testnet.

import * as StellarSdk from "@stellar/stellar-sdk";
import type { NetworkConfig, ConfidentialTokenMetadata } from "../types.js";
import type { Groth16Proof } from "../proof/generator.js";
import { sha256 } from "../crypto/hash.js";

export type SignTransaction = (xdr: string) => Promise<string>;

function scBytes(bytes: Uint8Array): StellarSdk.xdr.ScVal {
  return StellarSdk.nativeToScVal(bytes, { type: "bytes" });
}

function scVec(values: StellarSdk.xdr.ScVal[]): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec(values);
}

function scMap(
  entries: Array<[string, StellarSdk.xdr.ScVal]>
): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap(
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, val]) =>
          new StellarSdk.xdr.ScMapEntry({
            key: StellarSdk.xdr.ScVal.scvSymbol(key),
            val,
          })
      )
  );
}

function scGroth16Proof(proof: Groth16Proof): StellarSdk.xdr.ScVal {
  return scMap([
    ["a", scBytes(proof.a)],
    ["b", scBytes(proof.b)],
    ["c", scBytes(proof.c)],
  ]);
}

/**
 * Contract client for SCT-01 adapter calls.
 */
export class ContractClient {
  private rpc: StellarSdk.rpc.Server;
  private horizon: StellarSdk.Horizon.Server;
  private config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.rpc = new StellarSdk.rpc.Server(config.rpcUrl);
    this.horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
  }

  /**
   * Deposit: lock public tokens and create a confidential note.
   */
  async deposit(
    sourceAddress: string,
    amount: bigint,
    commitment: Uint8Array,
    encryptedNote: Uint8Array,
    signTransaction: SignTransaction
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    return this.submitOperation(
      sourceAddress,
      contract.call(
        "wrap",
        StellarSdk.Address.fromString(sourceAddress).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" }),
        scBytes(commitment),
        scBytes(encryptedNote)
      ),
      signTransaction
    );
  }

  /**
   * Confidential transfer: spend one note, create recipient and change notes.
   */
  async transfer(
    sourceAddress: string,
    proof: Groth16Proof,
    merkleRoot: Uint8Array,
    assetId: string,
    nullifiers: Uint8Array[],
    outputCommitments: Uint8Array[],
    encryptedNotes: Uint8Array[],
    signTransaction: SignTransaction
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);
    const encryptedNoteHashes = encryptedNotes.map((note) => sha256(note));

    const publicInputs = scMap([
      ["merkle_root", scBytes(merkleRoot)],
      ["asset_id", StellarSdk.Address.fromString(assetId).toScVal()],
      ["output_commitments", scVec(outputCommitments.map(scBytes))],
      ["encrypted_note_hashes", scVec(encryptedNoteHashes.map(scBytes))],
    ]);

    return this.submitOperation(
      sourceAddress,
      contract.call(
        "confidential_transfer",
        scGroth16Proof(proof),
        publicInputs,
        scVec(nullifiers.map(scBytes)),
        scVec(outputCommitments.map(scBytes)),
        scVec(encryptedNotes.map(scBytes))
      ),
      signTransaction
    );
  }

  /**
   * Withdraw: spend a confidential note and release public tokens.
   */
  async withdraw(
    sourceAddress: string,
    proof: Groth16Proof,
    nullifier: Uint8Array,
    recipient: string,
    amount: bigint,
    merkleRoot: Uint8Array,
    assetId: string,
    signTransaction: SignTransaction
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    const publicInputs = scMap([
      ["merkle_root", scBytes(merkleRoot)],
      ["asset_id", StellarSdk.Address.fromString(assetId).toScVal()],
      ["recipient", StellarSdk.Address.fromString(recipient).toScVal()],
      ["amount", StellarSdk.nativeToScVal(amount, { type: "i128" })],
    ]);

    return this.submitOperation(
      sourceAddress,
      contract.call(
        "unwrap",
        scGroth16Proof(proof),
        publicInputs,
        scBytes(nullifier),
        StellarSdk.Address.fromString(recipient).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" })
      ),
      signTransaction
    );
  }

  /**
   * Keypair convenience wrapper for Node scripts.
   */
  async wrap(
    sourceKeypair: StellarSdk.Keypair,
    amount: bigint,
    commitment: Uint8Array,
    encryptedNote: Uint8Array
  ): Promise<string> {
    return this.deposit(
      sourceKeypair.publicKey(),
      amount,
      commitment,
      encryptedNote,
      async (xdr) => this.signXdr(xdr, sourceKeypair)
    );
  }

  /**
   * Keypair convenience wrapper for Node scripts.
   */
  async confidentialTransfer(
    sourceKeypair: StellarSdk.Keypair,
    proof: Groth16Proof,
    merkleRoot: Uint8Array,
    assetId: string,
    nullifiers: Uint8Array[],
    outputCommitments: Uint8Array[],
    encryptedNotes: Uint8Array[]
  ): Promise<string> {
    return this.transfer(
      sourceKeypair.publicKey(),
      proof,
      merkleRoot,
      assetId,
      nullifiers,
      outputCommitments,
      encryptedNotes,
      async (xdr) => this.signXdr(xdr, sourceKeypair)
    );
  }

  /**
   * Keypair convenience wrapper for Node scripts.
   */
  async unwrap(
    sourceKeypair: StellarSdk.Keypair,
    proof: Groth16Proof,
    nullifier: Uint8Array,
    recipient: string,
    amount: bigint,
    merkleRoot: Uint8Array,
    assetId: string
  ): Promise<string> {
    return this.withdraw(
      sourceKeypair.publicKey(),
      proof,
      nullifier,
      recipient,
      amount,
      merkleRoot,
      assetId,
      async (xdr) => this.signXdr(xdr, sourceKeypair)
    );
  }

  async isSpent(sourceAddress: string, nullifier: Uint8Array): Promise<boolean> {
    try {
      const result = await this.invokeViewFunction(sourceAddress, "is_spent", [
        scBytes(nullifier),
      ]);
      return StellarSdk.scValToNative(result) as boolean;
    } catch {
      return false;
    }
  }

  async commitmentExists(
    sourceAddress: string,
    commitment: Uint8Array
  ): Promise<boolean> {
    try {
      const result = await this.invokeViewFunction(
        sourceAddress,
        "commitment_exists",
        [scBytes(commitment)]
      );
      return StellarSdk.scValToNative(result) as boolean;
    } catch {
      return false;
    }
  }

  async getRoot(sourceAddress: string): Promise<Uint8Array> {
    const result = await this.invokeViewFunction(sourceAddress, "root", []);
    return StellarSdk.scValToNative(result) as Uint8Array;
  }

  async getNoteCount(sourceAddress: string): Promise<number> {
    const result = await this.invokeViewFunction(sourceAddress, "note_count", []);
    return Number(StellarSdk.scValToNative(result));
  }

  async getMetadata(sourceAddress: string): Promise<ConfidentialTokenMetadata> {
    const result = await this.invokeViewFunction(sourceAddress, "metadata", []);
    const native = StellarSdk.scValToNative(result);
    return {
      name: native.name,
      symbol: native.symbol,
      decimals: native.decimals,
      underlyingAsset: native.underlying_asset,
      version: native.version,
      circuitVersion: native.circuit_version,
      verifier: native.verifier,
      privacyModel: native.privacy_model,
    };
  }

  async getPublicBalance(address: string): Promise<string> {
    try {
      const account = await this.horizon.loadAccount(address);
      const native = account.balances.find((b) => b.asset_type === "native");
      return native?.balance || "0";
    } catch {
      return "0";
    }
  }

  async getEvents(
    startLedger: number,
    eventTypes: string[] = ["wrap", "conf_transfer", "unwrap"]
  ): Promise<StellarSdk.rpc.Api.GetEventsResponse> {
    const filters = eventTypes.map((type) => ({
      type: "contract" as const,
      contractIds: [this.config.wrapperContractId],
      topics: [[StellarSdk.xdr.ScVal.scvSymbol(type).toXDR("base64")]],
    }));

    return this.rpc.getEvents({
      startLedger,
      filters,
    });
  }

  private async submitOperation(
    sourceAddress: string,
    operation: StellarSdk.xdr.Operation,
    signTransaction: SignTransaction
  ): Promise<string> {
    const account = await this.rpc.getAccount(sourceAddress);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(180)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    const assembled = StellarSdk.rpc.assembleTransaction(tx, simulation).build();
    const signedXdr = await signTransaction(assembled.toXDR());
    const signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      this.config.networkPassphrase
    ) as StellarSdk.Transaction;

    const response = await this.rpc.sendTransaction(signedTx);
    if (response.status === "ERROR") {
      throw new Error(`Transaction failed: ${response.errorResult}`);
    }

    return this.pollTransaction(response.hash);
  }

  private signXdr(xdr: string, keypair: StellarSdk.Keypair): string {
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      this.config.networkPassphrase
    ) as StellarSdk.Transaction;
    tx.sign(keypair);
    return tx.toXDR();
  }

  private async pollTransaction(hash: string): Promise<string> {
    let response = await this.rpc.getTransaction(hash);
    let attempts = 0;
    while (response.status === "NOT_FOUND" && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await this.rpc.getTransaction(hash);
      attempts++;
    }

    if (response.status === "SUCCESS") return hash;
    throw new Error(`Transaction failed: ${response.status}`);
  }

  private async invokeViewFunction(
    sourceAddress: string,
    method: string,
    args: StellarSdk.xdr.ScVal[]
  ): Promise<StellarSdk.xdr.ScVal> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);
    const account = await this.rpc.getAccount(sourceAddress);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      throw new Error(`${method} query failed: ${simulation.error}`);
    }
    if (!simulation.result) {
      throw new Error(`${method} query returned no result`);
    }

    return simulation.result.retval;
  }
}
