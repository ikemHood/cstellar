// SCT-01 SDK - Note Storage Interfaces
//
// Pluggable persistence for confidential notes. The SDK stays runtime-agnostic:
// wallets and dApps inject a `NoteStorage` implementation that matches their
// platform (IndexedDB on web, SQLite/Keystore on mobile, a cloud sync adapter
// for cross-device backup).
//
// Notes contain spend secrets (`nullifierKey`, `nullifierSecret`,
// `randomness`). Losing them means losing funds, and leaking them means theft.
// Storage therefore MUST be encrypted at rest. Use `EncryptedNoteStorage`
// over a `BlobStorage` backend; never persist plaintext to disk.

import type { SerializedNote } from "../types.js";

/**
 * Opaque bytes storage (one blob per key). Backends implement this; the SDK
 * provides an encrypted wrapper on top.
 *
 * Keys are arbitrary strings (e.g. an owner Stellar address). Implementations
 * must isolate entries by key.
 */
export interface BlobStorage {
  load(key: string): Promise<Uint8Array | null>;
  save(key: string, data: Uint8Array): Promise<void>;
  clear(key: string): Promise<void>;
}

/**
 * High-level note storage. Operates on plaintext `SerializedNote[]` at the
 * SDK layer; implementations are responsible for encrypting before hitting the
 * underlying blob store.
 */
export interface NoteStorage {
  load(owner: string): Promise<SerializedNote[] | null>;
  save(owner: string, notes: SerializedNote[]): Promise<void>;
  clear(owner: string): Promise<void>;
}

/**
 * Constants for the encrypted backup blob format.
 */
export const BACKUP_MAGIC = new Uint8Array([
  0x53, 0x43, 0x54, 0x30, 0x31, 0x42, 0x4b, 0x31, // "SCT01BK1"
]);

/** Current backup blob version. */
export const BACKUP_VERSION = 1;