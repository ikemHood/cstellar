"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useNotes } from "@/hooks/useNotes";
import { parseAmount, formatAmount, config } from "@/lib/stellar";
import { bytesToHex } from "@/lib/crypto";
import { getNoteCount, submitWrap } from "@/lib/contract";

export default function WrapPage() {
  const { address, connected, sign } = useWallet();
  const { addCommitmentLeaf, addNote, createNote } = useNotes();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    commitment: string;
    noteId: string;
  } | null>(null);

  const assetId = config.assetAddress || "mock-asset";

  const handleWrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    setLoading(true);
    setStatus("Creating confidential note...");

    try {
      const stroops = parseAmount(amount);
      if (stroops <= 0n) throw new Error("Invalid amount");

      if (!config.assetAddress) {
        throw new Error("Set NEXT_PUBLIC_ASSET_ADDRESS to the SAC contract ID");
      }

      const leafIndex = await getNoteCount(address);

      // Create note locally and submit its commitment on-chain.
      const { note, commitment } = createNote(
        assetId,
        stroops,
        address,
        "wrap deposit",
        leafIndex,
        false
      );

      setStatus("Note created. Preparing transaction...");

      const commitmentHex = bytesToHex(commitment);
      const encryptedNote = new TextEncoder().encode(
        JSON.stringify({
          id: note.id,
          assetId,
          amount: note.amount,
          owner: note.owner,
          randomness: note.randomness,
          nullifierKey: note.nullifierKey,
          nullifierSecret: note.nullifierSecret,
          commitment: commitmentHex,
          leafIndex,
        })
      );

      const txHash = await submitWrap(
        address,
        stroops,
        commitment,
        encryptedNote,
        (xdr) => sign(xdr, config.networkPassphrase)
      );
      addNote({ ...note, creationTxHash: txHash });
      addCommitmentLeaf(note.commitment, leafIndex);

      setResult({
        commitment: txHash,
        noteId: note.id,
      });
      setStatus(`Wrap successful. Transaction: ${txHash}`);
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
          Connect your wallet to wrap tokens.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Wrap Tokens</h1>
        <p className="text-stellar-blue mt-2">
          Deposit public tokens into the confidential wrapper. You will receive
          a private note representing your confidential balance.
        </p>
      </div>

      <form onSubmit={handleWrap} className="card space-y-6">
        <div>
          <label className="label">Asset</label>
          <div className="input bg-stellar-blue/20 cursor-not-allowed">
            cXLM (Confidential XLM)
          </div>
        </div>

        <div>
          <label className="label">Amount to Wrap</label>
          <input
            type="number"
            step="0.0000001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100.00"
            className="input"
            required
          />
        </div>

        <div className="bg-stellar-blue/10 rounded-lg p-4 text-sm">
          <div className="flex justify-between mb-2">
            <span className="text-stellar-blue">You deposit:</span>
            <span>{amount || "0"} XLM (public)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stellar-blue">You receive:</span>
            <span className="text-stellar-accent">
              {amount || "0"} cXLM (confidential)
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !amount}
          className="btn-primary w-full"
        >
          {loading ? "Wrapping..." : "Wrap Tokens"}
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
          <h3 className="font-semibold mb-2">Wrap Result</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-stellar-blue">Note ID: </span>
              <span className="font-mono">{result.noteId}</span>
            </div>
            <div>
              <span className="text-stellar-blue">Tx Hash: </span>
              <span className="font-mono break-all">
                {result.commitment.slice(0, 16)}...
              </span>
            </div>
          </div>
          <p className="text-xs text-yellow-400 mt-3">
            Your note is stored locally. Back up your notes to avoid losing
            access to your confidential balance.
          </p>
        </div>
      )}
    </div>
  );
}
