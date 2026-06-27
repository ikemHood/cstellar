// Notes state store (Zustand)

import { create } from "zustand";
import { persist } from "zustand/middleware";

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
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: [],
      commitmentLeaves: [],
      addNote: (note) =>
        set((state) => ({ notes: [...state.notes, note] })),
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
        return insertedIndex;
      },
      markSpent: (noteId, txHash) =>
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === noteId
              ? { ...n, spent: true, creationTxHash: txHash }
              : n
          ),
        })),
      clearNotes: () => set({ notes: [], commitmentLeaves: [] }),
    }),
    { name: "sct01-notes" }
  )
);
