// Notes state store (Zustand).
//
// In-memory state for the dApp's note UI. Persistence is handled by the
// encrypted vault (`@/lib/vault`): mutations write through to an
// `EncryptedJsonStorage` over IndexedDB keyed by the user's passcode. The old
// localStorage `persist` middleware is gone - spend secrets are no longer
// stored in plaintext in the browser.

import { create } from "zustand";
import { config } from "@/lib/stellar";
import { persistNotesState } from "@/lib/vault";

export interface StoredNote {
  id: string;
  assetId: string;
  amount: string; // bigint as string
  owner: string;
  randomness: string; // hex
  nullifierKey: string; // hex
  nullifierSecret: string; // hex
  commitment: string; // hex
  leafIndex?: number;
  memo?: string;
  spent: boolean;
  creationTxHash?: string;
  createdAt: number;
}

interface NotesState {
  notes: StoredNote[];
  commitmentLeaves: string[];
  addNote: (note: StoredNote) => void;
  addCommitmentLeaf: (commitment: string, leafIndex?: number) => number;
  markSpent: (noteId: string, txHash?: string) => void;
  clearNotes: () => void;
  /**
   * Replace the entire state (used by the vault layer after unlock or import).
   * Mutations via the action setters are preferred; this setter exists so
   * unlock/restore can hydrate state in one shot.
   */
  hydrateFromVault: (state: {
    notes: StoredNote[];
    commitmentLeaves: string[];
  }) => void;
}

/**
 * Write a snapshot of the current state to the encrypted vault (no-op while
 * locked). Centralizing this here keeps setter implementations tiny.
 */
function writeThrough(get: () => NotesState): void {
  const { notes, commitmentLeaves } = get();
  void persistNotesState({ notes, commitmentLeaves });
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  commitmentLeaves: [],
  addNote: (note) => {
    set((state) => ({ notes: [...state.notes, note] }));
    writeThrough(get);
  },
  addCommitmentLeaf: (commitment, leafIndex) => {
    let insertedIndex = 0;
    set((state) => {
      const leaves = [...state.commitmentLeaves];
      insertedIndex = leafIndex ?? leaves.length;
      if (leaves[insertedIndex] && leaves[insertedIndex] !== commitment) {
        throw new Error(`commitment leaf index ${insertedIndex} already occupied`);
      }
      leaves[insertedIndex] = commitment;
      return { commitmentLeaves: leaves };
    });
    writeThrough(get);
    return insertedIndex;
  },
  markSpent: (noteId, txHash) => {
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === noteId ? { ...n, spent: true, creationTxHash: txHash } : n
      ),
    }));
    writeThrough(get);
  },
  clearNotes: () => {
    set({ notes: [], commitmentLeaves: [] });
    writeThrough(get);
  },
  hydrateFromVault: (state) => {
    set({ notes: state.notes, commitmentLeaves: state.commitmentLeaves });
    // No write-through: this state came FROM the vault.
  },
}));

/**
 * Forward the localStorage key reference for any future migration tooling that
 * wants to detect-and-import the legacy localStorage blob. The dApp no longer
 * reads from localStorage directly.
 */
export const LEGACY_LOCALSTORAGE_KEY = `sct01-notes-${
  config.wrapperContractId || "local"
}`;