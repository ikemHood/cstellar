"use client";

import { useVault } from "@/hooks/useVault";
import { useWallet } from "@/hooks/useWallet";
import { VaultLockScreen } from "./VaultLockScreen";

/**
 * Gates app content behind the encrypted note vault. When a wallet is
 * connected but the vault is locked (or not yet created), the lock screen is
 * shown instead of children. Once unlocked, children render normally.
 *
 * Render this around page content in the root layout.
 */
export function VaultGate({ children }: { children: React.ReactNode }) {
  const { phase, ready } = useVault();
  const { connected } = useWallet();

  if (!connected) return <>{children}</>;
  // Avoid a flash of the lock screen while we probe for an existing vault.
  if (!ready && phase.kind === "checking") {
    return <VaultLockScreen />;
  }
  if (phase.kind === "unlocked") return <>{children}</>;
  return <VaultLockScreen />;
}