// Note management hook

import { useCallback } from "react";
import { useNotesStore, type StoredNote } from "@/store/notes";
import {
  randomBytes,
  bytesToHex,
  hexToBytes,
  computeCommitment,
  deriveNullifier,
} from "@/lib/crypto";

export function useNotes() {
  const {
    notes,
    commitmentLeaves,
    addNote,
    addCommitmentLeaf,
    markSpent,
    clearNotes,
  } = useNotesStore();

  const createNote = useCallback(
    (
      assetId: string,
      amount: bigint,
      owner: string,
      memo?: string,
      leafIndex?: number,
      store = true
    ): { note: StoredNote; commitment: Uint8Array } => {
      const randomness = randomBytes(32);
      const nullifierKey = randomBytes(32);
      const nullifierSecret = randomBytes(32);

      const commitment = computeCommitment(
        assetId,
        amount,
        owner,
        randomness,
        nullifierKey
      );

      const note: StoredNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        assetId,
        amount: amount.toString(),
        owner,
        randomness: bytesToHex(randomness),
        nullifierKey: bytesToHex(nullifierKey),
        nullifierSecret: bytesToHex(nullifierSecret),
        commitment: bytesToHex(commitment),
        leafIndex,
        memo,
        spent: false,
        createdAt: Date.now(),
      };

      if (store) {
        addNote(note);
        addCommitmentLeaf(note.commitment, leafIndex);
      }
      return { note, commitment };
    },
    [addNote, addCommitmentLeaf]
  );

  const getUnspentNotes = useCallback(
    (assetId: string): StoredNote[] => {
      return notes.filter((n) => !n.spent && n.assetId === assetId);
    },
    [notes]
  );

  const getBalance = useCallback(
    (assetId: string): bigint => {
      return getUnspentNotes(assetId).reduce(
        (sum, n) => sum + BigInt(n.amount),
        0n
      );
    },
    [getUnspentNotes]
  );

  const selectNotes = useCallback(
    (
      assetId: string,
      targetAmount: bigint
    ): { notes: StoredNote[]; total: bigint } => {
      const unspent = getUnspentNotes(assetId).sort(
        (a, b) => Number(BigInt(b.amount) - BigInt(a.amount))
      );

      const selected: StoredNote[] = [];
      let total = 0n;

      for (const note of unspent) {
        if (total >= targetAmount) break;
        selected.push(note);
        total += BigInt(note.amount);
      }

      if (total < targetAmount) {
        throw new Error(
          `Insufficient confidential balance: have ${total}, need ${targetAmount}`
        );
      }

      return { notes: selected, total };
    },
    [getUnspentNotes]
  );

  const getNullifier = useCallback((note: StoredNote): Uint8Array => {
    return deriveNullifier(
      hexToBytes(note.nullifierKey),
      hexToBytes(note.nullifierSecret)
    );
  }, []);

  return {
    notes,
    commitmentLeaves,
    addNote,
    createNote,
    addCommitmentLeaf,
    getUnspentNotes,
    getBalance,
    selectNotes,
    getNullifier,
    markSpent,
    clearNotes,
  };
}
