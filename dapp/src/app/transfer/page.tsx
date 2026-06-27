"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useNotes } from "@/hooks/useNotes";
import { parseAmount, formatAmount, config } from "@/lib/stellar";
import {
  bytesToHex,
  computeCommitment,
  hexToBytes,
  randomBytes,
  transferBindingHash,
  sha256,
} from "@/lib/crypto";
import { getMerkleRoot, getNoteCount, submitTransfer } from "@/lib/contract";
import { buildMerklePath, generateTransferProof } from "@/lib/proofs";

export default function TransferPage() {
  const { address, connected, sign } = useWallet();
  const {
    commitmentLeaves,
    addNote,
    addCommitmentLeaf,
    getBalance,
    selectNotes,
    createNote,
    getNullifier,
    markSpent,
  } = useNotes();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    nullifiers: string[];
    outputCommitment: string;
    changeCommitment: string;
    sentAmount: string;
    changeAmount: string;
  } | null>(null);

  const assetId = config.assetAddress || "mock-asset";
  const balance = getBalance(assetId);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    setLoading(true);
    setStatus("Preparing confidential transfer...");

    try {
      const sendAmount = parseAmount(amount);
      if (sendAmount <= 0n) throw new Error("Invalid amount");
      if (!config.assetAddress) {
        throw new Error("Set NEXT_PUBLIC_ASSET_ADDRESS to the SAC contract ID");
      }

      // Select input notes
      setStatus("Selecting input notes...");
      const { notes: inputNotes, total } = selectNotes(assetId, sendAmount);
      if (inputNotes.length !== 1) {
        throw new Error("Final demo circuit supports one input note. Transfer from one note at a time.");
      }
      const inputNote = inputNotes[0];
      if (inputNote.leafIndex === undefined) {
        throw new Error("Selected note has no Merkle leaf index. Re-wrap with current app version.");
      }
      const changeAmount = total - sendAmount;

      setStatus("Reading on-chain Merkle state...");
      const [merkleRoot, outputLeafIndex] = await Promise.all([
        getMerkleRoot(address),
        getNoteCount(address),
      ]);
      const merklePath = buildMerklePath(commitmentLeaves, inputNote.leafIndex);

      // Create output note for recipient
      setStatus("Creating output note for recipient...");
      const outputRandomness = randomBytes(32);
      const outputNullifierKey = randomBytes(32);
      const outputNullifierSecret = randomBytes(32);
      const outputCommitment = computeCommitment(
        assetId,
        sendAmount,
        recipient,
        outputRandomness,
        outputNullifierKey
      );
      const outputEncryptedNote = new TextEncoder().encode(
        JSON.stringify({
          assetId,
          amount: sendAmount.toString(),
          owner: recipient,
          randomness: bytesToHex(outputRandomness),
          nullifierKey: bytesToHex(outputNullifierKey),
          nullifierSecret: bytesToHex(outputNullifierSecret),
          commitment: bytesToHex(outputCommitment),
          leafIndex: outputLeafIndex,
        })
      );

      // Create change note for sender
      const changeLeafIndex = outputLeafIndex + 1;
      setStatus("Creating change note...");
      const { note: changeNote, commitment: changeCommitment } = createNote(
        assetId,
        changeAmount,
        address,
        "transfer change",
        changeLeafIndex,
        false
      );
      const outputCommitments: Uint8Array[] = [outputCommitment, changeCommitment];
      const encryptedNotes: Uint8Array[] = [outputEncryptedNote];
      encryptedNotes.push(
        new TextEncoder().encode(
          JSON.stringify({
            id: changeNote.id,
            assetId,
            amount: changeNote.amount,
            owner: changeNote.owner,
            randomness: changeNote.randomness,
            nullifierKey: changeNote.nullifierKey,
            nullifierSecret: changeNote.nullifierSecret,
            commitment: bytesToHex(changeCommitment),
            leafIndex: changeLeafIndex,
          })
        )
      );

      // Derive nullifiers for input notes
      setStatus("Deriving nullifiers...");
      const nullifiers = inputNotes.map((n) => getNullifier(n));

      setStatus("Generating Groth16 proof...");
      const encryptedNoteHashes = encryptedNotes.map((note) => sha256(note));
      const bindingHash = transferBindingHash(
        merkleRoot,
        assetId,
        nullifiers[0],
        outputCommitments,
        encryptedNoteHashes
      );
      const proof = await generateTransferProof({
        assetId,
        merkleRoot,
        note: inputNote,
        merklePath,
        nullifier: nullifiers[0],
        outAmount: sendAmount,
        outOwner: recipient,
        outRandomness: outputRandomness,
        outNullifierKey: outputNullifierKey,
        outputCommitment,
        changeAmount,
        changeOwner: address,
        changeRandomness: hexToBytes(changeNote.randomness),
        changeNullifierKey: hexToBytes(changeNote.nullifierKey),
        changeCommitment,
        encryptedNoteHashes,
        bindingHash,
      });

      setStatus("Submitting transaction...");
      const txHash = await submitTransfer(
        address,
        proof,
        merkleRoot,
        assetId,
        nullifiers,
        outputCommitments,
        encryptedNotes,
        (xdr) => sign(xdr, config.networkPassphrase)
      );

      // Mark input notes as spent
      inputNotes.forEach((n) => markSpent(n.id, txHash));
      addCommitmentLeaf(bytesToHex(outputCommitment), outputLeafIndex);
      addNote(changeNote);
      addCommitmentLeaf(bytesToHex(changeCommitment), changeLeafIndex);

      setResult({
        nullifiers: nullifiers.map((n) => bytesToHex(n)),
        outputCommitment: bytesToHex(outputCommitment),
        changeCommitment: bytesToHex(changeCommitment),
        sentAmount: formatAmount(sendAmount),
        changeAmount: formatAmount(changeAmount),
      });
      setStatus(
        `Transfer successful. Transaction: ${txHash}`
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
          Connect your wallet to send confidential transfers.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Confidential Transfer</h1>
        <p className="text-stellar-blue mt-2">
          Send confidential tokens. The transfer amount is hidden from the
          public chain.
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

      <form onSubmit={handleTransfer} className="card space-y-6">
        <div>
          <label className="label">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G..."
            className="input font-mono"
            required
          />
        </div>

        <div>
          <label className="label">Amount</label>
          <input
            type="number"
            step="0.0000001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="17.5"
            className="input"
            required
          />
        </div>

        <div className="bg-stellar-blue/10 rounded-lg p-4 text-sm">
          <p className="text-stellar-blue mb-2">
            What the public chain will see:
          </p>
          <ul className="space-y-1 text-xs">
            <li>A confidential transfer occurred</li>
            <li>Nullifiers were published (no amounts)</li>
            <li>New commitments were stored (no amounts)</li>
            <li className="text-green-400">
              Transfer amount: HIDDEN
            </li>
          </ul>
        </div>

        <button
          type="submit"
          disabled={loading || !recipient || !amount}
          className="btn-primary w-full"
        >
          {loading ? "Generating proof..." : "Send Confidential Transfer"}
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
          <h3 className="font-semibold mb-3">Transfer Receipt</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-stellar-blue">Sent:</span>
              <span>{result.sentAmount} cXLM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stellar-blue">Change:</span>
              <span>{result.changeAmount} cXLM</span>
            </div>
            <div className="mt-3 pt-3 border-t border-stellar-blue/20">
              <div className="text-stellar-blue text-xs mb-1">
                Nullifiers ({result.nullifiers.length}):
              </div>
              {result.nullifiers.map((nf, i) => (
                <div key={i} className="font-mono text-xs break-all">
                  {nf.slice(0, 24)}...
                </div>
              ))}
            </div>
            <div className="mt-2">
              <div className="text-stellar-blue text-xs mb-1">
                Output commitment:
              </div>
              <div className="font-mono text-xs break-all">
                {result.outputCommitment.slice(0, 24)}...
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
