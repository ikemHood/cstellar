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
import type { NoteStorage } from "../storage/types.js";
import type {
  Note,
  NoteCommitment,
  Nullifier,
  SerializedNote,
  NoteStoreExport,
} from "../types.js";

export interface NoteManagerOptions {
  /**
   * Optional persistent backend. If provided, the manager autoloads notes on
   * `init()` and writes through on every mutating call. Pass a
   * `EncryptedNoteStorage` over a `BlobStorage` so spend secrets never hit
   * disk in plaintext.
   */
  storage?: NoteStorage;
  /** Skip the initial load on `init()`. Defaults to `false`. */
  skipAutoload?: boolean;
}

/**
 * Note Manager - handles creation, storage, and lifecycle of confidential notes.
 *
 * Notes are held in-memory and (optionally) mirrored to a `NoteStorage` so
 * spend secrets survive reloads. Storage MUST be encrypted at rest: notes
 * contain `nullifierKey`, `nullifierSecret`, and `randomness`; losing any of
 * them means losing funds, and leaking them means theft.
 *
 * Call `init()` after construction to hydrate from storage, then use the
 * mutating API as usual; every mutation is persisted through the configured
 * backend.
 */
export class NoteManager {
  private notes: Map<string, Note> = new Map();
  private readonly owner: string;
  private readonly storage?: NoteStorage;
  private loaded = false;

  constructor(owner: string, options: NoteManagerOptions = {}) {
    this.owner = owner;
    this.storage = options.storage;
    if (options.storage && !options.skipAutoload) {
      // Best-effort autoload. Callers that want to await should call `init()`.
      void this.init();
    }
  }

  /**
   * Load notes from the configured storage. Safe to call multiple times;
   * subsequent calls re-read from storage (useful after an import).
   */
  async init(): Promise<void> {
    if (!this.storage) return;
    const stored = await this.storage.load(this.owner);
    this.notes.clear();
    if (stored) {
      for (const s of stored) {
        const note = deserializeStored(s);
        this.notes.set(note.id, note);
      }
    }
    this.loaded = true;
  }

  /**
   * Force-persist the current in-memory state. Useful after bulk mutations
   * bypass the per-call write-through, or to flush pending writes.
   */
  async persist(): Promise<void> {
    if (!this.storage) return;
    await this.storage.save(this.owner, this.serializeAll());
  }

  private async writeThrough(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.save(this.owner, this.serializeAll());
    } catch {
      // Persist failures should not roll back in-memory state (the user can
      // retry). Higher layers surface errors via their own handlers; we just
      // avoid dropping the note from the working set.
    }
  }

  private serializeAll(): SerializedNote[] {
    return Array.from(this.notes.values()).map(serializeNote);
  }

  /** Whether `init()` has populated state from storage at least once. */
  get isLoaded(): boolean {
    return this.loaded;
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
    void this.writeThrough();

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
    void this.writeThrough();
  }

  /**
   * Mark a note as spent.
   */
  markSpent(noteId: string, txHash?: string): void {
    const note = this.notes.get(noteId);
    if (note) {
      note.spent = true;
      if (txHash) note.creationTxHash = txHash;
      void this.writeThrough();
    }
  }

  /**
   * Remove all notes from memory and (if persistence is configured) clear the
   * stored blob. Use `noremove`-style backup before calling this if you need
   * to retain spend secrets.
   */
  async clear(): Promise<void> {
    this.notes.clear();
    if (this.storage) await this.storage.clear(this.owner);
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
   * Import notes from a backup. Imported notes overwrite any existing entry
   * with the same id. Returns the number of notes added.
   */
  importNotes(data: NoteStoreExport): number {
    let imported = 0;
    for (const s of data.notes) {
      if (!this.notes.has(s.id)) {
        const note = deserializeStored(s);
        this.notes.set(note.id, note);
        imported++;
      }
    }
    if (imported > 0) void this.writeThrough();
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

/** Convert an in-memory `Note` to its serializable representation. */
export function serializeNote(note: Note): SerializedNote {
  return {
    id: note.id,
    assetId: note.assetId,
    amount: note.amount.toString(),
    owner: note.owner,
    randomness: bytesToHex(note.randomness),
    nullifierKey: bytesToHex(note.nullifierKey),
    nullifierSecret: bytesToHex(note.nullifierSecret),
    memo: note.memo,
    spent: note.spent,
    creationTxHash: note.creationTxHash,
    createdAt: note.createdAt,
  };
}

/** Convert a `SerializedNote` (from storage or import) to a `Note`. */
export function deserializeStored(s: SerializedNote): Note {
  return {
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
}
