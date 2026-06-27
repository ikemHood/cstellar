// Vault unlock hook.
//
// Wires the encrypted notes vault to the dApp lifecycle:
//   - When the wallet connects, probe for an existing vault.
//   - If a vault exists, show the unlock screen; otherwise show the
//     create-passcode screen on first use.
//   - On unlock / create, hydrate the notes store from the decrypted blob.
//   - Exposes `lock()` so the user can re-lock without disconnecting the wallet.
//
// The hook intentionally keeps every passcode in memory only for the lifetime
// of the unlocked session; nothing sensitive is persisted unencrypted.

import { useCallback, useEffect, useState } from "react";
import { useWalletStore } from "@/store/wallet";
import { useNotesStore } from "@/store/notes";
import {
  hasVault,
  unlockVault,
  createVault,
  lockVault,
  isUnlocked,
  unlockedOwner,
  exportVaultBlob,
} from "@/lib/vault";

export type VaultPhase =
  | { kind: "idle" } // no wallet connected yet
  | { kind: "checking" } // probing for an existing vault
  | { kind: "new" } // first time, ask the user to create a passcode
  | { kind: "locked" } // existing vault, ask for passcode
  | { kind: "unlocked" }; // vault open; notes loaded

interface UseVaultResult {
  phase: VaultPhase;
  unlockError: string | null;
  unlock: (passcode: string) => Promise<boolean>;
  create: (passcode: string) => Promise<boolean>;
  lock: () => void;
  /** Whether the encrypted vault probe has finished at least once. */
  ready: boolean;
  /** Download an encrypted `.sct` backup of the active vault. */
  exportBackup: () => Promise<void>;
}

export function useVault(): UseVaultResult {
  const address = useWalletStore((s) => s.address);
  const hydrate = useNotesStore((s) => s.hydrateFromVault);
  const clearNotes = useNotesStore((s) => s.clearNotes);

  const [phase, setPhase] = useState<VaultPhase>({ kind: "idle" });
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Probe for an existing vault whenever the connected wallet changes.
  useEffect(() => {
    setReady(false);
    setUnlockError(null);
    if (!address) {
      setPhase({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setPhase({ kind: "checking" });
    hasVault(address)
      .then((exists) => {
        if (cancelled) return;
        if (isUnlocked() && unlockedOwner() === address) {
          // Already unlocked (e.g. hot reload) - skip the prompt.
          setPhase({ kind: "unlocked" });
        } else if (exists) {
          setPhase({ kind: "locked" });
        } else {
          setPhase({ kind: "new" });
        }
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "new" });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const unlock = useCallback(
    async (passcode: string): Promise<boolean> => {
      if (!address) return false;
      setUnlockError(null);
      try {
        const existing = await unlockVault(address, passcode);
        if (existing) {
          hydrate({
            notes: existing.notes ?? [],
            commitmentLeaves: existing.commitmentLeaves ?? [],
          });
        } else {
          // Existing vault on disk but decryption returned null - wrong passcode.
          lockVault();
          setUnlockError("Wrong passcode. Try again.");
          setPhase({ kind: "locked" });
          return false;
        }
        setPhase({ kind: "unlocked" });
        return true;
      } catch (err: any) {
        setUnlockError(err?.message ?? "failed to unlock");
        return false;
      }
    },
    [address, hydrate]
  );

  const create = useCallback(
    async (passcode: string): Promise<boolean> => {
      if (!address) return false;
      if (passcode.length < 4) {
        setUnlockError("Passcode must be at least 4 characters.");
        return false;
      }
      setUnlockError(null);
      try {
        await createVault(address, passcode, {
          notes: [],
          commitmentLeaves: [],
        });
        clearNotes();
        setPhase({ kind: "unlocked" });
        return true;
      } catch (err: any) {
        setUnlockError(err?.message ?? "failed to create vault");
        return false;
      }
    },
    [address, clearNotes]
  );

  const lock = useCallback(() => {
    lockVault();
    clearNotes();
    if (address) {
      setPhase({ kind: "locked" });
    } else {
      setPhase({ kind: "idle" });
    }
  }, [address, clearNotes]);

  const exportBackup = useCallback(async (): Promise<void> => {
    if (!address) return;
    const blob = await exportVaultBlob(address);
    if (!blob) return;
    // Trigger a browser download. Safe to drop into Drive/iCloud afterwards.
    const file = new Blob([new Uint8Array(blob)], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sct01-notes-${address.slice(0, 8)}.sct`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [address]);

  return {
    phase,
    unlockError,
    unlock,
    create,
    lock,
    ready,
    exportBackup,
  };
}