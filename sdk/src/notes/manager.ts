// SCT-01 SDK - Note Manager
//
// Manages the lifecycle of confidential notes:
//   - Create new notes (for wrapping)
//   - Store notes locally (encrypted at rest)
//   - Select notes as inputs for transfers
//   - Track spent/unspent status
//   - Export/import for backup and recovery

import { randomBytes, bytesToHex, hexToBytes } from "../crypto/hash.js";
import { computeCommitment, deriveNullifier } from "../crypto/commitment.js";
import type {
  Note,
  NoteCommitment,
  Nullifier,
  SerializedNote,
  NoteStoreExport,
} from "../types.js";

/**
 * Note Manager - handles creation, storage, and lifecycle of confidential notes.
 *
 * Notes are stored in-memory and can be exported/imported for persistence.
 * In a production app, notes should be encrypted at rest using the user's
 * viewing key.
 */
export class NoteManager {
  private notes: Map<string, Note> = new Map();
  private owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  /**
   * Create a new note for wrapping (deposit).
   */
  createNote(
    assetId: string,
    amount: bigint,
    memo?: string
  ): { note: Note; commitment: NoteCommitment } {
    const note: Note = {
      id: generateNoteId(),
      assetId,
      amount,
      owner: this.owner,
      randomness: randomBytes(32),
      nullifierKey: randomBytes(32),
      nullifierSecret: randomBytes(32),
      memo,
      spent: false,
      createdAt: Date.now(),
    };

    const commitment = computeCommitment(note);

    this.notes.set(note.id, note);

    return { note, commitment };
  }

  /**
   * Create a change note (for transfer/unwrap change output).
   */
  createChangeNote(
    assetId: string,
    amount: bigint
  ): { note: Note; commitment: NoteCommitment } {
    return this.createNote(assetId, amount, "change");
  }

  /**
   * Create an output note for a recipient.
   */
  createOutputNote(
    assetId: string,
    amount: bigint,
    recipientAddress: string
  ): { note: Note; commitment: NoteCommitment } {
    const note: Note = {
      id: generateNoteId(),
      assetId,
      amount,
      owner: recipientAddress,
      randomness: randomBytes(32),
      nullifierKey: randomBytes(32),
      nullifierSecret: randomBytes(32),
      spent: false,
      createdAt: Date.now(),
    };

    const commitment = computeCommitment(note);

    // Don't store output notes locally (they belong to the recipient)
    return { note, commitment };
  }

  /**
   * Add a received note (decrypted from an encrypted payload).
   */
  addReceivedNote(note: Note): void {
    this.notes.set(note.id, note);
  }

  /**
   * Mark a note as spent.
   */
  markSpent(noteId: string, txHash?: string): void {
    const note = this.notes.get(noteId);
    if (note) {
      note.spent = true;
      if (txHash) note.creationTxHash = txHash;
    }
  }

  /**
   * Get all unspent notes for a specific asset.
   */
  getUnspentNotes(assetId: string): Note[] {
    return Array.from(this.notes.values()).filter(
      (n) => !n.spent && n.assetId === assetId
    );
  }

  /**
   * Get total unspent balance for a specific asset.
   */
  getBalance(assetId: string): bigint {
    return this.getUnspentNotes(assetId).reduce(
      (sum, n) => sum + n.amount,
      0n
    );
  }

  /**
   * Select notes to cover a target amount (simple greedy algorithm).
   * Returns selected notes and the total amount they cover.
   */
  selectNotes(
    assetId: string,
    targetAmount: bigint
  ): { notes: Note[]; total: bigint } {
    const unspent = this.getUnspentNotes(assetId).sort(
      (a, b) => Number(b.amount - a.amount) // Sort descending
    );

    const selected: Note[] = [];
    let total = 0n;

    for (const note of unspent) {
      if (total >= targetAmount) break;
      selected.push(note);
      total += note.amount;
    }

    if (total < targetAmount) {
      throw new Error(
        `Insufficient balance: have ${total}, need ${targetAmount}`
      );
    }

    return { notes: selected, total };
  }

  /**
   * Get all notes (for display/debugging).
   */
  getAllNotes(): Note[] {
    return Array.from(this.notes.values());
  }

  /**
   * Get a specific note by ID.
   */
  getNote(noteId: string): Note | undefined {
    return this.notes.get(noteId);
  }

  /**
   * Derive nullifiers for a set of notes.
   */
  deriveNullifiers(notes: Note[]): Nullifier[] {
    return notes.map((n) => deriveNullifier(n));
  }

  /**
   * Export all notes for backup.
   */
  exportNotes(): NoteStoreExport {
    const serialized: SerializedNote[] = Array.from(this.notes.values()).map(
      (n) => ({
        id: n.id,
        assetId: n.assetId,
        amount: n.amount.toString(),
        owner: n.owner,
        randomness: bytesToHex(n.randomness),
        nullifierKey: bytesToHex(n.nullifierKey),
        nullifierSecret: bytesToHex(n.nullifierSecret),
        memo: n.memo,
        spent: n.spent,
        creationTxHash: n.creationTxHash,
        createdAt: n.createdAt,
      })
    );

    return {
      version: 1,
      exportedAt: Date.now(),
      notes: serialized,
    };
  }

  /**
   * Import notes from a backup.
   */
  importNotes(data: NoteStoreExport): number {
    let imported = 0;
    for (const s of data.notes) {
      if (!this.notes.has(s.id)) {
        const note: Note = {
          id: s.id,
          assetId: s.assetId,
          amount: BigInt(s.amount),
          owner: s.owner,
          randomness: hexToBytes(s.randomness),
          nullifierKey: hexToBytes(s.nullifierKey),
          nullifierSecret: hexToBytes(s.nullifierSecret),
          memo: s.memo,
          spent: s.spent,
          creationTxHash: s.creationTxHash,
          createdAt: s.createdAt,
        };
        this.notes.set(note.id, note);
        imported++;
      }
    }
    return imported;
  }

  /**
   * Get the number of stored notes.
   */
  get count(): number {
    return this.notes.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let noteCounter = 0;

function generateNoteId(): string {
  noteCounter++;
  const rand = bytesToHex(randomBytes(8));
  return `note_${Date.now()}_${noteCounter}_${rand}`;
}
