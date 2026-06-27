"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useNotes } from "@/hooks/useNotes";
import { parseAmount, formatAmount, config } from "@/lib/stellar";
import {
  bytesToHex,
  unwrapBindingHash,
} from "@/lib/crypto";
import { getMerkleRoot, submitUnwrap } from "@/lib/contract";
import { buildMerklePath, generateUnwrapProof } from "@/lib/proofs";

export default function UnwrapPage() {
  const { address, connected, sign } = useWallet();
  const { commitmentLeaves, getBalance, selectNotes, getNullifier, markSpent } =
    useNotes();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    txHash: string;
    amount: string;
    recipient: string;
  } | null>(null);

  const assetId = config.assetAddress || "mock-asset";
  const balance = getBalance(assetId);

  const handleUnwrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    setLoading(true);
    setStatus("Preparing withdrawal...");

    try {
      const unwrapAmount = parseAmount(amount);
      if (unwrapAmount <= 0n) throw new Error("Invalid amount");
      if (!config.assetAddress) {
        throw new Error("Set NEXT_PUBLIC_ASSET_ADDRESS to the SAC contract ID");
      }

      const unwrapRecipient = recipient || address;

      // Select notes to cover withdraw amount
      setStatus("Selecting notes...");
      const { notes: inputNotes, total } = selectNotes(
        assetId,
        unwrapAmount
      );
      if (inputNotes.length !== 1 || total !== unwrapAmount) {
        throw new Error(
          "MVP withdrawal requires one note whose amount exactly matches the withdrawal amount"
        );
      }
      const inputNote = inputNotes[0];
      if (inputNote.leafIndex === undefined) {
        throw new Error("Selected note has no Merkle leaf index. Deposit again with current app version.");
      }

      // Derive nullifiers
      setStatus("Deriving nullifiers...");
      const nullifiers = inputNotes.map((n) => getNullifier(n));

      setStatus("Reading on-chain Merkle root...");
      const merkleRoot = await getMerkleRoot(address);
      const merklePath = buildMerklePath(commitmentLeaves, inputNote.leafIndex);

      setStatus("Generating Groth16 withdrawal proof...");
      const bindingHash = unwrapBindingHash(
        merkleRoot,
        assetId,
        unwrapRecipient,
        nullifiers[0],
        unwrapAmount
      );
      const proof = await generateUnwrapProof({
        assetId,
        merkleRoot,
        note: inputNote,
        merklePath,
        nullifier: nullifiers[0],
        recipient: unwrapRecipient,
        amount: unwrapAmount,
        bindingHash,
      });

      setStatus("Submitting withdrawal transaction...");
      const txHash = await submitUnwrap(
        address,
        proof,
        nullifiers[0],
        unwrapRecipient,
        unwrapAmount,
        merkleRoot,
        assetId,
        (xdr) => sign(xdr, config.networkPassphrase)
      );

      // Mark notes as spent
      inputNotes.forEach((n) => markSpent(n.id, txHash));

      setResult({
        txHash,
        amount: formatAmount(unwrapAmount),
        recipient: unwrapRecipient,
      });
      setStatus(
        "Withdrawal successful. Public tokens have been sent to the recipient."
      );
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
        <p className="text-stellar-blue">
          Connect your wallet to withdraw confidential tokens.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Withdraw from SCT-01</h1>
        <p className="text-stellar-blue mt-2">
          Convert confidential tokens back to the original public asset.
          The withdrawal amount will be visible on-chain.
        </p>
      </div>

      <div className="card">
        <div className="text-sm text-stellar-blue">
          Confidential Balance
        </div>
        <div className="text-2xl font-bold text-stellar-accent">
          {formatAmount(balance)} cXLM
        </div>
      </div>

      <form onSubmit={handleUnwrap} className="card space-y-6">
        <div>
          <label className="label">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={address || "G..."}
            className="input font-mono"
          />
          <p className="text-xs text-stellar-blue mt-1">
            Leave empty to withdraw to your own wallet.
          </p>
        </div>

        <div>
          <label className="label">Amount to Withdraw</label>
          <input
            type="number"
            step="0.0000001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50.00"
            className="input"
            required
          />
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm">
          <p className="text-yellow-400">
            The withdrawal amount will be visible on the public chain. Internal
            confidential transfer history remains private.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || !amount}
          className="btn-primary w-full"
        >
          {loading ? "Withdrawing..." : "Withdraw"}
        </button>
      </form>

      {status && (
        <div
          className={`card ${
            status.startsWith("Error")
              ? "border-red-500/50"
              : "border-green-500/50"
          }`}
        >
          <p className="text-sm">{status}</p>
        </div>
      )}

      {result && (
        <div className="card">
          <h3 className="font-semibold mb-3">Withdrawal Result</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-stellar-blue">Amount:</span>
              <span>{result.amount} XLM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stellar-blue">Recipient:</span>
              <span className="font-mono text-xs">
                {result.recipient.slice(0, 8)}...
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stellar-blue">Tx Hash:</span>
              <span className="font-mono text-xs">
                {result.txHash.slice(0, 16)}...
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
