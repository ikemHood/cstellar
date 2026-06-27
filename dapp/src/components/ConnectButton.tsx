"use client";

import { useWallet } from "@/hooks/useWallet";

export function ConnectButton() {
  const { address, connected, loading, connect, disconnect } = useWallet();

  if (connected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-stellar-blue font-mono">
          {address.slice(0, 4)}...{address.slice(-4)}
        </span>
        <button
          onClick={disconnect}
          className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="btn-primary text-sm px-4 py-2"
    >
      {loading ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
