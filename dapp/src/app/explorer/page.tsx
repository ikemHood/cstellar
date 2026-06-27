"use client";

import { useState } from "react";
import { useNotes } from "@/hooks/useNotes";
import { config, formatAmount } from "@/lib/stellar";
import { bytesToHex } from "@/lib/crypto";

/**
 * Explorer comparison page - shows what the public chain sees vs
 * what Alice and Bob see for a confidential transfer.
 */
export default function ExplorerPage() {
  const { notes } = useNotes();
  const assetId = config.assetAddress || "mock-asset";

  // Demo scenario data
  const [scenario] = useState({
    alice: {
      sent: "17.5",
      change: "82.5",
      initialBalance: "100",
    },
    bob: {
      received: "17.5",
    },
    public: {
      nullifier: "0x7a3b...f291",
      commitment1: "0x4e8c...a1d3",
      commitment2: "0x9f21...b7e5",
      amount: "HIDDEN",
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Explorer</h1>
        <p className="text-stellar-blue mt-2">
          See the difference between what the public chain observes and what
          each participant sees in a confidential transfer.
        </p>
      </div>

      {/* Demo scenario */}
      <div className="card bg-stellar-blue/10">
        <h3 className="font-semibold mb-2">Demo Scenario</h3>
        <p className="text-sm text-stellar-blue">
          Alice has 100 cUSDC. She sends 17.5 cUSDC to Bob. Bob later unwraps
          5 cUSDC back to public USDC.
        </p>
      </div>

      {/* Comparison grid */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Public view */}
        <div className="card border-yellow-500/30">
          <h3 className="text-lg font-semibold mb-4 text-yellow-400">
            Public Chain View
          </h3>
          <p className="text-xs text-stellar-blue mb-4">
            What anyone can see on the blockchain explorer
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-stellar-blue text-xs">Event Type:</div>
              <div className="font-mono">conf_transfer</div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">Nullifier:</div>
              <div className="font-mono text-xs break-all">
                {scenario.public.nullifier}
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Output Commitment 1:
              </div>
              <div className="font-mono text-xs break-all">
                {scenario.public.commitment1}
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Output Commitment 2:
              </div>
              <div className="font-mono text-xs break-all">
                {scenario.public.commitment2}
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Transfer Amount:
              </div>
              <div className="text-red-400 font-bold">
                {scenario.public.amount}
              </div>
            </div>
            <div className="pt-3 border-t border-stellar-blue/20">
              <div className="text-stellar-blue text-xs">
                Encrypted Note Hash:
              </div>
              <div className="font-mono text-xs">0xb3c7...e4a2</div>
            </div>
          </div>
        </div>

        {/* Alice's view */}
        <div className="card border-blue-500/30">
          <h3 className="text-lg font-semibold mb-4 text-blue-400">
            Alice&apos;s View (Sender)
          </h3>
          <p className="text-xs text-stellar-blue mb-4">
            What Alice sees in her wallet
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-stellar-blue text-xs">Action:</div>
              <div>Sent confidential transfer</div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">Sent Amount:</div>
              <div className="text-xl font-bold text-blue-400">
                {scenario.alice.sent} cUSDC
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">Change:</div>
              <div className="text-lg font-semibold">
                {scenario.alice.change} cUSDC
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Previous Balance:
              </div>
              <div>{scenario.alice.initialBalance} cUSDC</div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                New Balance:
              </div>
              <div className="text-lg font-semibold text-stellar-accent">
                {scenario.alice.change} cUSDC
              </div>
            </div>
            <div className="pt-3 border-t border-stellar-blue/20">
              <div className="text-stellar-blue text-xs">Recipient:</div>
              <div className="font-mono text-xs">GBob...xyz</div>
            </div>
          </div>
        </div>

        {/* Bob's view */}
        <div className="card border-green-500/30">
          <h3 className="text-lg font-semibold mb-4 text-green-400">
            Bob&apos;s View (Recipient)
          </h3>
          <p className="text-xs text-stellar-blue mb-4">
            What Bob sees after decrypting his note
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-stellar-blue text-xs">Action:</div>
              <div>Received confidential transfer</div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Received Amount:
              </div>
              <div className="text-xl font-bold text-green-400">
                {scenario.bob.received} cUSDC
              </div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">Sender:</div>
              <div className="font-mono text-xs">GAlice...abc</div>
            </div>
            <div>
              <div className="text-stellar-blue text-xs">
                Note Decrypted:
              </div>
              <div className="text-green-400">Yes</div>
            </div>
            <div className="pt-3 border-t border-stellar-blue/20">
              <div className="text-stellar-blue text-xs">
                Bob can now:
              </div>
              <ul className="text-xs mt-1 space-y-1">
                <li>Transfer privately to someone else</li>
                <li>Unwrap to public USDC</li>
                <li>Export receipt for compliance</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Privacy summary */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">
          Privacy Analysis
        </h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-green-400 mb-2">
              Hidden from public
            </h4>
            <ul className="text-sm space-y-1 text-stellar-blue">
              <li>17.5 cUSDC was sent to Bob</li>
              <li>82.5 cUSDC is Alice&apos;s change</li>
              <li>Alice&apos;s remaining balance</li>
              <li>Bob&apos;s received amount</li>
              <li>The link between commitments and amounts</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-yellow-400 mb-2">
              Visible to public
            </h4>
            <ul className="text-sm space-y-1 text-stellar-blue">
              <li>A confidential transfer happened</li>
              <li>Nullifier values (prevent double-spend)</li>
              <li>New commitment hashes</li>
              <li>Encrypted note hashes</li>
              <li>Transaction submitter address</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Live notes (if any) */}
      {notes.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">
            Your Local Notes
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stellar-blue text-left">
                  <th className="pb-2">ID</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Commitment</th>
                </tr>
              </thead>
              <tbody>
                {notes.slice(0, 10).map((note) => (
                  <tr
                    key={note.id}
                    className="border-t border-stellar-blue/10"
                  >
                    <td className="py-2 font-mono text-xs">
                      {note.id.slice(0, 16)}...
                    </td>
                    <td className="py-2">
                      {formatAmount(BigInt(note.amount))}
                    </td>
                    <td className="py-2">
                      {note.spent ? (
                        <span className="badge-error">Spent</span>
                      ) : (
                        <span className="badge-success">Unspent</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {note.commitment.slice(0, 16)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
