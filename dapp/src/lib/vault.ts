// Encrypted notes vault for the dApp.
//
// Replaces the old localStorage-backed Zustand persist with an
// `EncryptedJsonStorage` over IndexedDB. The full notes state (notes array +
// commitment leaves) is encrypted at rest with XChaCha20-Poly1305 keyed from a
// user passcode via scrypt. Plaintext spend secrets never hit disk, and the
// 5MB localStorage ceiling is gone (IndexedDB is sized in MB/GB per origin).
//
// The vault is namespaced per wallet so multiple Freighter accounts on the
// same machine don't collide. Call `unlockVault(addr, passcode)` before
// reading/writing notes; mutations on the Zustand store automatically write
// through while unlocked.

import {
  EncryptedJsonStorage,
  type BlobStorage,
  IndexedDbBlobStorage,
  MemoryBlobStorage,
} from "@sct01/sdk";

/**
 * Shape persisted on disk. Mirrors the dApp's Zustand notes store so restored
 * state is identical to what was last saved.
 */
export interface NotesStateBlob {
  notes: import("@/store/notes").StoredNote[];
  commitmentLeaves: string[];
}

type VaultState =
  | { status: "locked" }
  | { status: "unlocking" }
  | {
      status: "unlocked";
      owner: string;
      passcode: string;
      storage: EncryptedJsonStorage<NotesStateBlob>;
    };

let vault: VaultState = { status: "locked" };

/**
 * Returns a non-throwing blob backend suitable for the current runtime. Falls
 * back to an in-memory store (e.g. SSR or browsers with IndexedDB disabled) so
 * the dApp keeps working without silently losing data on reloads that DO have
 * IndexedDB. Callers can check `backendKind` to warn the user if persistence
 * is unavailable.
 */
export function getBlobBackend(): {
  backend: BlobStorage;
  persistent: boolean;
} {
  if (typeof window !== "undefined" && "indexedDB" in window) {
    try {
      return {
        backend: new IndexedDbBlobStorage({
          dbName: "sct01-vault",
          storeName: "notes",
        }),
        persistent: true,
      };
    } catch {
      // fall through
    }
  }
  // Singleton memory backend so callers at least share state within a session.
  if (!memBackend) memBackend = new MemoryBlobStorage();
  return { backend: memBackend, persistent: false };
}

let memBackend: MemoryBlobStorage | null = null;

const STATE_KEY_PREFIX = "sct01:notes-state";

function stateKey(owner: string): string {
  return `${STATE_KEY_PREFIX}:${owner}`;
}

/**
 * Whether the dApp has a passcode set yet. We probe the backend for a stored
 * blob; absence means the user hasn't created a vault for this owner.
 */
export async function hasVault(owner: string): Promise<boolean> {
  const { backend } = getBlobBackend();
  // We don't need the plaintext presence test; just check the raw blob.
  const existing = await backend.load(stateKey(owner));
  return existing !== null;
}

export async function unlockVault(
  owner: string,
  passcode: string
): Promise<NotesStateBlob | null> {
  const { backend } = getBlobBackend();
  const storage = new EncryptedJsonStorage<NotesStateBlob>(backend, {
    passcode,
  });
  const existing = await storage.load(stateKey(owner));
  vault = { status: "unlocked", owner, passcode, storage };
  return existing;
}

/**
 * Create or overwrite the vault for `owner`. Used the first time a user sets a
 * passcode (or when rotating it: callers should re-key an existing unlocked
 * vault before locking, see `changePasscode`).
 */
export async function createVault(
  owner: string,
  passcode: string,
  initial: NotesStateBlob
): Promise<void> {
  const { backend } = getBlobBackend();
  const storage = new EncryptedJsonStorage<NotesStateBlob>(backend, {
    passcode,
  });
  await storage.save(stateKey(owner), initial);
  vault = { status: "unlocked", owner, passcode, storage };
}

/**
 * Reset everything in memory and remove the on-disk blob for the active
 * owner. Dangerous: spend secrets WILL be unrecoverable.
 */
export async function clearVault(owner: string): Promise<void> {
  const { backend } = getBlobBackend();
  await backend.clear(stateKey(owner));
  if (vault.status === "unlocked" && vault.owner === owner) {
    vault = { status: "locked" };
  }
}

export function lockVault(): void {
  vault = { status: "locked" };
}

export function isUnlocked(): boolean {
  return vault.status === "unlocked";
}

export function unlockedOwner(): string | null {
  return vault.status === "unlocked" ? vault.owner : null;
}

/**
 * Persist a snapshot of the notes state. No-op if the vault is locked
 * (e.g. before the user has unlocked on a fresh session). Subsequent unlocks
 * will read the last-written blob.
 */
export async function persistNotesState(state: NotesStateBlob): Promise<void> {
  if (vault.status !== "unlocked") return;
  await vault.storage.save(stateKey(vault.owner), state);
}

/**
 * Export the encrypted vault blob for the active owner as a downloadable
 * `.sct` backup file. The bytes are already ciphertext; safe to copy to
 * Google Drive or iCloud. Recovery on another device requires the same
 * passcode.
 */
export async function exportVaultBlob(
  owner: string
): Promise<Uint8Array | null> {
  if (vault.status !== "unlocked" || vault.owner !== owner) return null;
  return vault.storage.exportBlob(stateKey(owner));
}

/**
 * Import an encrypted backup blob into the active vault, overwriting the
 * current on-disk blob. The passcode used at import time must match the one
 * used to create the backup.
 */
export async function importVaultBlob(
  owner: string,
  blob: Uint8Array
): Promise<void> {
  if (vault.status !== "unlocked" || vault.owner !== owner) {
    throw new Error("unlock the vault before importing a backup");
  }
  await vault.storage.importBlob(stateKey(owner), blob);
}