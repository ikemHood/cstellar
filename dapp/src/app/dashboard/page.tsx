"use client";

import { useWallet } from "@/hooks/useWallet";
import { useNotes } from "@/hooks/useNotes";
import { formatAmount, config } from "@/lib/stellar";
import { NoteList } from "@/components/NoteList";
import Link from "next/link";

export default function DashboardPage() {
  const { address, connected } = useWallet();
  const { getBalance, notes } = useNotes();

  if (!connected) {
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
        <p className="text-stellar-blue">
          Connect your Freighter wallet to view your confidential balance.
        </p>
      </div>
    );
  }

  const assetId = config.assetAddress || "mock-asset";
  const confBalance = getBalance(assetId);
  const unspentCount = notes.filter(
    (n) => !n.spent && n.assetId === assetId
  ).length;
  const spentCount = notes.filter(
    (n) => n.spent && n.assetId === assetId
  ).length;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Balance cards */}
      <div className="grid md:grid-cols-3 gap-6">
        <div className="card">
          <div className="text-sm text-stellar-blue mb-1">
            Confidential Balance
          </div>
          <div className="text-3xl font-bold text-stellar-accent">
            {formatAmount(confBalance)} cXLM
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-stellar-blue mb-1">Unspent Notes</div>
          <div className="text-3xl font-bold">{unspentCount}</div>
        </div>
        <div className="card">
          <div className="text-sm text-stellar-blue mb-1">Spent Notes</div>
          <div className="text-3xl font-bold text-stellar-blue">
            {spentCount}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-4">
        <Link href="/wrap" className="btn-primary">
          Wrap Tokens
        </Link>
        <Link href="/transfer" className="btn-secondary">
          Send Confidential
        </Link>
        <Link href="/unwrap" className="btn-secondary">
          Unwrap
        </Link>
      </div>

      {/* Notes list */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Your Notes</h2>
        <NoteList assetId={assetId} showSpent />
      </div>

      {/* Wallet info */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-2">Wallet</h3>
        <div className="font-mono text-sm text-stellar-blue break-all">
          {address}
        </div>
      </div>
    </div>
  );
}
