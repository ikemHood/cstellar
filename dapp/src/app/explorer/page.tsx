"use client";

import { useEffect, useState } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useNotes } from "@/hooks/useNotes";
import { config, formatAmount, rpc } from "@/lib/stellar";

type ChainEvent = {
  id: string;
  type: string;
  ledger: number;
  closedAt: string;
  txHash: string;
  topics: string[];
  value: string;
};

function shorten(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function nativeToDisplay(value: unknown): string {
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(nativeToDisplay).join(", ")}]`;
  }
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    return JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? inner.toString() : inner
    );
  }
  return String(value ?? "");
}

async function loadWrapperEvents(): Promise<ChainEvent[]> {
  if (!config.wrapperContractId) return [];

  const latest = await rpc.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 50_000);
  const response = await rpc.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [config.wrapperContractId],
      },
    ],
    limit: 25,
  });

  return response.events
    .map((event) => {
      const topics = event.topic.map((topic) =>
        nativeToDisplay(StellarSdk.scValToNative(topic))
      );
      return {
        id: event.id,
        type: topics[0] || "contract",
        ledger: event.ledger,
        closedAt: event.ledgerClosedAt,
        txHash: event.txHash,
        topics,
        value: nativeToDisplay(StellarSdk.scValToNative(event.value)),
      };
    })
    .reverse();
}

export default function ExplorerPage() {
  const { notes } = useNotes();
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadWrapperEvents()
      .then((loadedEvents) => {
        if (!cancelled) setEvents(loadedEvents);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || "Failed to load events");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Explorer</h1>
        <p className="text-stellar-blue mt-2">
          Live wrapper events from testnet, paired with notes stored in this
          browser.
        </p>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Public Chain View</h3>
        <p className="text-sm text-stellar-blue mb-4">
          Contract events expose commitments, nullifiers, encrypted note hashes,
          and entry/exit amounts. Confidential transfer amounts remain hidden.
        </p>

        {loading && <p className="text-sm text-stellar-blue">Loading events...</p>}
        {error && <p className="text-sm text-red-400">Error: {error}</p>}

        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-stellar-blue">
            No wrapper events found in the recent testnet retention window.
            Wrap or unwrap once, then return here.
          </p>
        )}

        {events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stellar-blue text-left">
                  <th className="pb-2">Event</th>
                  <th className="pb-2">Ledger</th>
                  <th className="pb-2">Tx</th>
                  <th className="pb-2">Public Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-stellar-blue/10">
                    <td className="py-3 font-mono">{event.type}</td>
                    <td className="py-3">{event.ledger}</td>
                    <td className="py-3">
                      <a
                        className="font-mono text-stellar-accent hover:underline"
                        href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shorten(event.txHash)}
                      </a>
                    </td>
                    <td className="py-3 font-mono text-xs break-all">
                      {event.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card border-green-500/30">
          <h3 className="text-lg font-semibold mb-4 text-green-400">
            Hidden from public
          </h3>
          <ul className="text-sm space-y-2 text-stellar-blue">
            <li>Confidential transfer amount</li>
            <li>Sender change amount</li>
            <li>Participant balances</li>
            <li>Commitment-to-note ownership mapping</li>
          </ul>
        </div>
        <div className="card border-yellow-500/30">
          <h3 className="text-lg font-semibold mb-4 text-yellow-400">
            Visible to public
          </h3>
          <ul className="text-sm space-y-2 text-stellar-blue">
            <li>Wrap and unwrap amounts at public entry/exit</li>
            <li>Nullifier values for double-spend prevention</li>
            <li>New commitment hashes</li>
            <li>Encrypted note hashes</li>
            <li>Transaction submitter address</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Your Local Notes</h3>
        {notes.length === 0 ? (
          <p className="text-sm text-stellar-blue">
            No local notes in this browser for the active wrapper.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stellar-blue text-left">
                  <th className="pb-2">ID</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Leaf</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Commitment</th>
                </tr>
              </thead>
              <tbody>
                {notes.slice(0, 10).map((note) => (
                  <tr key={note.id} className="border-t border-stellar-blue/10">
                    <td className="py-2 font-mono text-xs">
                      {shorten(note.id, 14, 4)}
                    </td>
                    <td className="py-2">{formatAmount(BigInt(note.amount))} cXLM</td>
                    <td className="py-2">{note.leafIndex ?? "-"}</td>
                    <td className="py-2">
                      {note.spent ? (
                        <span className="badge-error">Spent</span>
                      ) : (
                        <span className="badge-success">Unspent</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {shorten(note.commitment, 12, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
