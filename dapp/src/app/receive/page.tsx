"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useNotes } from "@/hooks/useNotes";
import { config } from "@/lib/stellar";
import { bytesToHex } from "@/lib/crypto";

export default function ReceivePage() {
  const { address, connected } = useWallet();
  const { notes } = useNotes();

  const assetId = config.assetAddress || "mock-asset";
  const receivedNotes = notes.filter(
    (n) => n.assetId === assetId && n.owner !== address
  );

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Receive</h1>
        <p className="text-stellar-blue mt-2">
          Share your address to receive confidential tokens. The sender will
          create an encrypted note that only you can decrypt.
        </p>
      </div>

      {connected && address ? (
        <>
          {/* Receive address */}
          <div className="card text-center">
            <div className="text-sm text-stellar-blue mb-2">
              Your Confidential Receive Address
            </div>
            <div className="font-mono text-sm bg-stellar-blue/20 rounded-lg p-4 break-all">
              {address}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(address)}
              className="btn-secondary mt-4 text-sm"
            >
              Copy Address
            </button>
          </div>

          {/* How it works */}
          <div className="card">
            <h3 className="font-semibold mb-3">How Receiving Works</h3>
            <ol className="space-y-2 text-sm text-stellar-blue">
              <li>
                1. Share your Stellar address with the sender
              </li>
              <li>
                2. Sender creates an encrypted note for you
              </li>
              <li>
                3. The encrypted note is published on-chain (or via relay)
              </li>
              <li>
                4. Your wallet scans for notes encrypted to your key
              </li>
              <li>
                5. You decrypt the note to see the received amount
              </li>
            </ol>
          </div>

          {/* Received notes */}
          {receivedNotes.length > 0 && (
            <div>
              <h3 className="text-xl font-semibold mb-4">
                Received Notes
              </h3>
              <div className="space-y-3">
                {receivedNotes.map((note) => (
                  <div key={note.id} className="card">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">
                          {(
                            Number(BigInt(note.amount)) / 1e7
                          ).toLocaleString()}{" "}
                          cUSDC
                        </div>
                        <div className="text-xs text-stellar-blue font-mono">
                          {note.id.slice(0, 20)}...
                        </div>
                      </div>
                      <span
                        className={
                          note.spent ? "badge-error" : "badge-success"
                        }
                      >
                        {note.spent ? "Spent" : "Available"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16">
          <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
          <p className="text-stellar-blue">
            Connect your wallet to receive confidential tokens.
          </p>
        </div>
      )}
    </div>
  );
}
