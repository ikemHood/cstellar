"use client";

import { useState } from "react";
import { useVault } from "@/hooks/useVault";
import { useWallet } from "@/hooks/useWallet";

/**
 * Lock screen + first-run passcode setup. Rendered by `<VaultGate>` whenever
 * the connected wallet doesn't have an unlocked vault yet. Until the vault is
 * unlocked the surrounding page content is hidden so spend secrets from a
 * prior session can't leak into UI that hasn't been re-hydrated.
 */
export function VaultLockScreen() {
  const { phase, unlock, create, unlockError } = useVault();
  const { address } = useWallet();
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (phase.kind === "checking") {
    return (
      <Shell title="Unlocking vault…">
        <p className="text-stellar-blue">Reading your encrypted note store…</p>
      </Shell>
    );
  }

  if (phase.kind === "new") {
    const mismatch = confirm.length > 0 && confirm !== passcode;
    const tooShort = passcode.length > 0 && passcode.length < 4;
    return (
      <Shell title="Set a note vault passcode">
        <p className="text-stellar-blue text-sm mb-4">
          Your confidential notes contain spend secrets. They will be encrypted
          at rest with XChaCha20-Poly1305 keyed from this passcode. There is no
          recovery if you lose it - back it up somewhere safe.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (mismatch || tooShort || busy) return;
            setBusy(true);
            await create(passcode);
            setBusy(false);
          }}
          className="space-y-4"
        >
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="New passcode"
            className="input"
            autoFocus
            required
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passcode"
            className="input"
            required
          />
          {mismatch && (
            <p className="text-red-400 text-sm">Passcodes don't match.</p>
          )}
          {tooShort && (
            <p className="text-red-400 text-sm">
              Passcode must be at least 4 characters.
            </p>
          )}
          {unlockError && (
            <p className="text-red-400 text-sm">{unlockError}</p>
          )}
          <button
            type="submit"
            disabled={busy || mismatch || tooShort || !passcode}
            className="btn-primary w-full"
          >
            {busy ? "Creating…" : "Create vault"}
          </button>
        </form>
      </Shell>
    );
  }

  // phase.kind === "locked"
  return (
    <Shell title="Unlock your note vault">
      <p className="text-stellar-blue text-sm mb-4">
        Connected as{" "}
        <span className="font-mono">{address?.slice(0, 4)}…{address?.slice(-4)}</span>
        . Enter your passcode to decrypt your notes.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          await unlock(passcode);
          setBusy(false);
          setPasscode("");
        }}
        className="space-y-4"
      >
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="input"
          autoFocus
          required
        />
        {unlockError && (
          <p className="text-red-400 text-sm">{unlockError}</p>
        )}
        <button
          type="submit"
          disabled={busy || !passcode}
          className="btn-primary w-full"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto py-16">
      <div className="card space-y-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}