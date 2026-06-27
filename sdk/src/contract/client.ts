// SCT-01 SDK - Contract Client
//
// High-level client for interacting with the SCT-01 wrapper and verifier
// contracts via Stellar RPC. Handles transaction building, simulation,
// signing, and submission.

import * as StellarSdk from "@stellar/stellar-sdk";
import type {
  NetworkConfig,
  TransferPublicInputs,
  UnwrapPublicInputs,
  Proof,
  ConfidentialTokenMetadata,
} from "../types.js";
import { bytesToHex } from "../crypto/hash.js";

/**
 * Contract Client - wraps Stellar SDK interactions with SCT-01 contracts.
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
   * Wrap: deposit public tokens and create a confidential note.
   */
  async wrap(
    sourceKeypair: StellarSdk.Keypair,
    amount: bigint,
    commitment: Uint8Array,
    encryptedNote: Uint8Array
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    const tx = await this.buildContractTx(
      sourceKeypair.publicKey(),
      contract.call(
        "wrap",
        StellarSdk.Address.fromString(sourceKeypair.publicKey()).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" }),
        StellarSdk.nativeToScVal(commitment, { type: "bytesn" }),
        StellarSdk.nativeToScVal(encryptedNote, { type: "bytes" })
      )
    );

    return this.signAndSubmit(tx, sourceKeypair);
  }

  /**
   * Confidential transfer: spend notes, create new notes.
   */
  async confidentialTransfer(
    sourceKeypair: StellarSdk.Keypair,
    proof: Proof,
    publicInputs: TransferPublicInputs,
    nullifiers: Uint8Array[],
    outputCommitments: Uint8Array[],
    encryptedNotes: Uint8Array[]
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    // Build public inputs struct
    const publicInputsVal = StellarSdk.nativeToScVal(
      {
        merkle_root: publicInputs.merkleRoot,
        asset_id: StellarSdk.Address.fromString(publicInputs.assetId).toScVal(),
        output_commitments: publicInputs.outputCommitments,
        encrypted_note_hashes: publicInputs.encryptedNoteHashes,
      },
      {
        type: {
          merkle_root: ["symbol", null],
          asset_id: ["symbol", null],
          output_commitments: ["symbol", null],
          encrypted_note_hashes: ["symbol", null],
        },
      }
    );

    const tx = await this.buildContractTx(
      sourceKeypair.publicKey(),
      contract.call(
        "confidential_transfer",
        StellarSdk.nativeToScVal(proof.data, { type: "bytes" }),
        publicInputsVal,
        StellarSdk.nativeToScVal(nullifiers, { type: "bytesn" }),
        StellarSdk.nativeToScVal(outputCommitments, { type: "bytesn" }),
        StellarSdk.nativeToScVal(encryptedNotes, { type: "bytes" })
      )
    );

    return this.signAndSubmit(tx, sourceKeypair);
  }

  /**
   * Unwrap: spend a confidential note, receive public tokens.
   */
  async unwrap(
    sourceKeypair: StellarSdk.Keypair,
    proof: Proof,
    publicInputs: UnwrapPublicInputs,
    nullifier: Uint8Array,
    recipient: string,
    amount: bigint
  ): Promise<string> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    const publicInputsVal = StellarSdk.nativeToScVal(
      {
        merkle_root: publicInputs.merkleRoot,
        asset_id: StellarSdk.Address.fromString(publicInputs.assetId).toScVal(),
        recipient: StellarSdk.Address.fromString(recipient).toScVal(),
        amount: StellarSdk.nativeToScVal(amount, { type: "i128" }),
      },
      {
        type: {
          merkle_root: ["symbol", null],
          asset_id: ["symbol", null],
          recipient: ["symbol", null],
          amount: ["i128", null],
        },
      }
    );

    const tx = await this.buildContractTx(
      sourceKeypair.publicKey(),
      contract.call(
        "unwrap",
        StellarSdk.nativeToScVal(proof.data, { type: "bytes" }),
        publicInputsVal,
        StellarSdk.nativeToScVal(nullifier, { type: "bytesn" }),
        StellarSdk.Address.fromString(recipient).toScVal(),
        StellarSdk.nativeToScVal(amount, { type: "i128" })
      )
    );

    return this.signAndSubmit(tx, sourceKeypair);
  }

  /**
   * Query: check if a nullifier has been spent.
   */
  async isSpent(nullifier: Uint8Array): Promise<boolean> {
    try {
      const result = await this.invokeViewFunction("is_spent", [
        StellarSdk.nativeToScVal(nullifier, { type: "bytesn" }),
      ]);
      return StellarSdk.scValToNative(result) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Query: check if a commitment exists in the tree.
   */
  async commitmentExists(commitment: Uint8Array): Promise<boolean> {
    try {
      const result = await this.invokeViewFunction("commitment_exists", [
        StellarSdk.nativeToScVal(commitment, { type: "bytesn" }),
      ]);
      return StellarSdk.scValToNative(result) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Query: get the current Merkle tree root.
   */
  async getRoot(): Promise<Uint8Array> {
    const result = await this.invokeViewFunction("root", []);
    return StellarSdk.scValToNative(result) as Uint8Array;
  }

  /**
   * Query: get total note count.
   */
  async getNoteCount(): Promise<bigint> {
    const result = await this.invokeViewFunction("note_count", []);
    return BigInt(StellarSdk.scValToNative(result) as number);
  }

  /**
   * Query: get confidential token metadata.
   */
  async getMetadata(): Promise<ConfidentialTokenMetadata> {
    const result = await this.invokeViewFunction("metadata", []);
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

  /**
   * Get account balance for the underlying asset.
   */
  async getPublicBalance(address: string): Promise<string> {
    try {
      const account = await this.horizon.loadAccount(address);
      // Find the balance for the underlying asset
      // For now, return native XLM balance
      const native = account.balances.find(
        (b) => b.asset_type === "native"
      );
      return native?.balance || "0";
    } catch {
      return "0";
    }
  }

  /**
   * Fetch contract events (for scanning encrypted notes).
   */
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

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async buildContractTx(
    sourceAddress: string,
    operation: StellarSdk.xdr.Operation
  ): Promise<StellarSdk.Transaction> {
    const account = await this.rpc.getAccount(sourceAddress);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(180)
      .build();

    // Simulate to get resource estimates
    const simulation = await this.rpc.simulateTransaction(tx);

    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    return StellarSdk.rpc.assembleTransaction(tx, simulation).build();
  }

  private async signAndSubmit(
    tx: StellarSdk.Transaction,
    keypair: StellarSdk.Keypair
  ): Promise<string> {
    tx.sign(keypair);

    const response = await this.rpc.sendTransaction(tx);

    if (response.status === "ERROR") {
      throw new Error(`Transaction failed: ${response.errorResult}`);
    }

    // Poll for completion
    let getResponse = await this.rpc.getTransaction(response.hash);
    while (getResponse.status === "NOT_FOUND") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      getResponse = await this.rpc.getTransaction(response.hash);
    }

    if (getResponse.status === "SUCCESS") {
      return response.hash;
    }

    throw new Error(`Transaction failed: ${getResponse.status}`);
  }

  private async invokeViewFunction(
    method: string,
    args: StellarSdk.xdr.ScVal[]
  ): Promise<StellarSdk.xdr.ScVal> {
    const contract = new StellarSdk.Contract(this.config.wrapperContractId);

    // Use a dummy source for view calls
    const dummySource = StellarSdk.Keypair.random().publicKey();
    const account = await this.rpc.getAccount(dummySource);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);

    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      throw new Error(`View call failed: ${simulation.error}`);
    }

    if (!simulation.result) {
      throw new Error("View call returned no result");
    }

    return simulation.result.retval;
  }
}
