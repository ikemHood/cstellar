"use client";

import { useWallet } from "@/hooks/useWallet";
import { useVault } from "@/hooks/useVault";

export function ConnectButton() {
  const { address, connected, loading, connect, disconnect } = useWallet();
  const { phase, ready, lock, exportBackup } = useVault();

  if (connected && address) {
    const unlocked = ready && phase.kind === "unlocked";
    return (
      <div className="flex items-center gap-2">
        {unlocked && (
          <>
            <button
              onClick={() => void exportBackup()}
              className="px-3 py-1.5 text-sm bg-stellar-blue/20 text-stellar-blue rounded-lg hover:bg-stellar-blue/30 transition-colors"
              title="Download an encrypted backup of your notes"
            >
              Backup
            </button>
            <button
              onClick={lock}
              className="px-3 py-1.5 text-sm bg-stellar-blue/20 text-stellar-blue rounded-lg hover:bg-stellar-blue/30 transition-colors"
              title="Lock the note vault"
            >
              Lock
            </button>
          </>
        )}
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