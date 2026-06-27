// SCT-01 SDK - Encrypted storage
//
// Wraps a `BlobStorage` backend with XChaCha20-Poly1305 AEAD so secrets are
// never persisted in plaintext. The on-disk format is:
//
//   [ "SCT01ENC1" (9 bytes) ][ version (1 byte) ][ salt (16 bytes) ]
//   [ nonce (24 bytes)      ][ ciphertext+tag    ]
//
// The salt is stored with the ciphertext so the unlock key can be re-derived
// from a passcode or app-held secret without the caller remembering the salt.
// The 24-byte nonce is safe to fill with the CSPRNG (XChaCha extended nonce).

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes, bytesToHex, hexToBytes } from "../crypto/hash.js";
import {
  ENCRYPTION_KEY_BYTES,
  SALT_BYTES,
  deriveKeyFromPasscode,
  deriveKeyFromSecret,
  generateSalt,
} from "./keys.js";
import {
  BACKUP_MAGIC,
  BACKUP_VERSION,
  type BlobStorage,
  type NoteStorage,
} from "./types.js";
import type { NoteStoreExport, SerializedNote } from "../types.js";

/** Magic prefix for the encrypted blob envelope. */
const ENC_MAGIC = new Uint8Array([
  0x53, 0x43, 0x54, 0x30, 0x31, 0x45, 0x4e, 0x43, 0x31, // "SCT01ENC1"
]);

const ENC_VERSION = 1;
const NONCE_BYTES = 24;

/**
 * Pre-derived 32-byte key OR the material to derive one lazily. Pick exactly
 * one option; the lazy derivation path reads the salt from the stored envelope.
 */
export interface EncryptionKeyOptions {
  /** Raw 32-byte symmetric key. Takes precedence. */
  key?: Uint8Array;
  /** User passcode; key derived via scrypt using the stored envelope salt. */
  passcode?: string;
  /** App-held secret; key derived via HKDF-style hash with the stored salt. */
  secret?: Uint8Array;
}

/**
 * Generic encrypted JSON storage over a `BlobStorage` backend. Serializes any
 * JSON-able value with `JSON.stringify`, encrypts the UTF-8 bytes, and stores
 * the envelope under a caller-chosen string key.
 *
 * Use this for app-specific state that isn't the SDK's `NoteManager` shape
 * (e.g. a wallet's combined notes + Merkle leaves). For the canonical
 * `SerializedNote[]` shape, prefer `EncryptedNoteStorage`.
 */
export class EncryptedJsonStorage<T> {
  private readonly backend: BlobStorage;
  private readonly opts: EncryptionKeyOptions;

  constructor(backend: BlobStorage, opts: EncryptionKeyOptions) {
    validateKeyOpts(opts);
    this.backend = backend;
    this.opts = opts;
  }

  async load(key: string): Promise<T | null> {
    const blob = await this.backend.load(key);
    if (!blob) return null;
    const env = parseEnvelope(blob);
    const k = await this.deriveKey(env.salt);
    const plaintext = decryptBytes(k, env.nonce, env.ciphertext);
    if (!plaintext) return null;
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }

  async save(key: string, value: T): Promise<void> {
    const salt = generateSalt();
    const k = await this.deriveKey(salt);
    const nonce = randomBytes(NONCE_BYTES);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = encryptBytes(k, nonce, plaintext);
    await this.backend.save(key, buildEnvelope(salt, nonce, ciphertext));
  }

  async clear(key: string): Promise<void> {
    await this.backend.clear(key);
  }

  /**
   * Return the raw stored envelope wrapped in the backup file format. Safe to
   * hand to a file picker or cloud sync. Recovery requires the same key/passcode.
   */
  async exportBlob(key: string): Promise<Uint8Array | null> {
    const inner = await this.backend.load(key);
    if (!inner) return null;
    return wrapBackup(inner);
  }

  /**
   * Restore an exported backup blob under `key`. The unlock key must match the
   * one used at export time; this method writes the inner envelope verbatim.
   */
  async importBlob(key: string, backup: Uint8Array): Promise<void> {
    const inner = unwrapBackup(backup);
    await this.backend.save(key, inner);
  }

  private deriveKey(salt: Uint8Array): Promise<Uint8Array> {
    if (this.opts.key) return Promise.resolve(this.opts.key);
    if (this.opts.passcode !== undefined) {
      return Promise.resolve(deriveKeyFromPasscode(this.opts.passcode, salt));
    }
    if (this.opts.secret) {
      return Promise.resolve(deriveKeyFromSecret(this.opts.secret, salt));
    }
    return Promise.reject(new Error("no key material available"));
  }
}

/**
 * Note storage specialized for `SerializedNote[]`. Persists the canonical
 * `NoteStoreExport` envelope on disk (with `exportedAt` metadata) so future
 * schema migrations have a version field to branch on, while still accepting
 * legacy bare-array payloads on load.
 */
export class EncryptedNoteStorage implements NoteStorage {
  private readonly backend: BlobStorage;
  private readonly opts: EncryptionKeyOptions;

  constructor(backend: BlobStorage, opts: EncryptionKeyOptions) {
    validateKeyOpts(opts);
    this.backend = backend;
    this.opts = opts;
  }

  async load(owner: string): Promise<SerializedNote[] | null> {
    const blob = await this.backend.load(ownerKey(owner));
    if (!blob) return null;
    const env = parseEnvelope(blob);
    const k = await this.deriveKey(env.salt);
    const plaintext = decryptBytes(k, env.nonce, env.ciphertext);
    if (!plaintext) return null;
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as
      | NoteStoreExport
      | SerializedNote[];
    if (Array.isArray(parsed)) return parsed; // legacy bare-array format
    if (!Array.isArray(parsed.notes)) throw new Error("invalid notes payload");
    return parsed.notes;
  }

  async save(owner: string, notes: SerializedNote[]): Promise<void> {
    const salt = generateSalt();
    const k = await this.deriveKey(salt);
    const nonce = randomBytes(NONCE_BYTES);
    const payload: NoteStoreExport = {
      version: 1,
      exportedAt: Date.now(),
      notes,
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = encryptBytes(k, nonce, plaintext);
    await this.backend.save(ownerKey(owner), buildEnvelope(salt, nonce, ciphertext));
  }

  async clear(owner: string): Promise<void> {
    await this.backend.clear(ownerKey(owner));
  }

  /**
   * Export an owner's encrypted blob without re-encrypting it. The returned
   * bytes are safe to hand to a file picker, cloud backup, or another device.
   * Recovery requires the same passcode/secret used to encrypt it.
   */
  async exportBlob(owner: string): Promise<Uint8Array | null> {
    const inner = await this.backend.load(ownerKey(owner));
    if (!inner) return null;
    return wrapBackup(inner);
  }

  /**
   * Import an encrypted backup blob for an owner. Verifies the magic header
   * and writes the inner encrypted envelope to the backend. The unlock key
   * must match whatever was used when the backup was created.
   */
  async importBlob(owner: string, backup: Uint8Array): Promise<void> {
    const inner = unwrapBackup(backup);
    await this.backend.save(ownerKey(owner), inner);
  }

  private deriveKey(salt: Uint8Array): Promise<Uint8Array> {
    if (this.opts.key) return Promise.resolve(this.opts.key);
    if (this.opts.passcode !== undefined) {
      return Promise.resolve(deriveKeyFromPasscode(this.opts.passcode, salt));
    }
    if (this.opts.secret) {
      return Promise.resolve(deriveKeyFromSecret(this.opts.secret, salt));
    }
    return Promise.reject(new Error("no key material available"));
  }
}

// ---------------------------------------------------------------------------
// Envelope helpers (shared by both storage flavors and exported for callers
// building their own backends / migration tooling).
// ---------------------------------------------------------------------------

export function buildEnvelope(
  salt: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new Error(`salt must be ${SALT_BYTES} bytes`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes`);
  }
  const out = new Uint8Array(
    ENC_MAGIC.length + 1 + salt.length + nonce.length + ciphertext.length
  );
  let off = 0;
  out.set(ENC_MAGIC, off); off += ENC_MAGIC.length;
  out[off++] = ENC_VERSION;
  out.set(salt, off); off += salt.length;
  out.set(nonce, off); off += nonce.length;
  out.set(ciphertext, off);
  return out;
}

export interface Envelope {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export function parseEnvelope(blob: Uint8Array): Envelope {
  if (blob.length < ENC_MAGIC.length + 1 + SALT_BYTES + NONCE_BYTES) {
    throw new Error("encrypted blob too short");
  }
  for (let i = 0; i < ENC_MAGIC.length; i++) {
    if (blob[i] !== ENC_MAGIC[i]) {
      throw new Error("invalid encrypted blob magic");
    }
  }
  let off = ENC_MAGIC.length;
  const version = blob[off++];
  if (version !== ENC_VERSION) {
    throw new Error(`unsupported encrypted blob version ${version}`);
  }
  const salt = blob.slice(off, off + SALT_BYTES); off += SALT_BYTES;
  const nonce = blob.slice(off, off + NONCE_BYTES); off += NONCE_BYTES;
  const ciphertext = blob.slice(off);
  return { salt, nonce, ciphertext };
}

export function encryptBytes(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array
): Uint8Array {
  return xchacha20poly1305(key, nonce).encrypt(data);
}

export function decryptBytes(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array | null {
  try {
    return xchacha20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    return null;
  }
}

export function wrapBackup(inner: Uint8Array): Uint8Array {
  const out = new Uint8Array(BACKUP_MAGIC.length + 1 + inner.length);
  let off = 0;
  out.set(BACKUP_MAGIC, off); off += BACKUP_MAGIC.length;
  out[off++] = BACKUP_VERSION;
  out.set(inner, off);
  return out;
}

export function unwrapBackup(backup: Uint8Array): Uint8Array {
  if (backup.length < BACKUP_MAGIC.length + 1) {
    throw new Error("backup too short");
  }
  for (let i = 0; i < BACKUP_MAGIC.length; i++) {
    if (backup[i] !== BACKUP_MAGIC[i]) {
      throw new Error("invalid backup magic");
    }
  }
  let off = BACKUP_MAGIC.length;
  const version = backup[off++];
  if (version !== BACKUP_VERSION) {
    throw new Error(`unsupported backup version ${version}`);
  }
  return backup.slice(off);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateKeyOpts(opts: EncryptionKeyOptions): void {
  if (!opts.key && opts.passcode === undefined && opts.secret === undefined) {
    throw new Error(
      "encrypted storage requires a key, passcode, or secret"
    );
  }
  if (opts.key && opts.key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(
      `encryption key must be ${ENCRYPTION_KEY_BYTES} bytes, got ${opts.key.length}`
    );
  }
}

/**
 * Namespace blob keys so multi-tenant backends (e.g. shared IndexedDB across
 * wallet accounts) don't collide.
 */
export function ownerKey(owner: string): string {
  return `sct01:notes:${owner}`;
}

// Re-export hex helpers for callers building their own backends/tests.
export { bytesToHex, hexToBytes };