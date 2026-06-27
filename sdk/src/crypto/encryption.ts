// SCT-01 SDK - Note Encryption / Decryption
//
// Encrypts notes for confidential sharing between sender and recipient.
// Uses X25519 ECDH + ChaCha20-Poly1305 for authenticated encryption.
//
// Flow:
//   1. Sender generates ephemeral X25519 keypair
//   2. Sender derives shared secret via ECDH with recipient's public key
//   3. Sender encrypts note plaintext with ChaCha20-Poly1305
//   4. Recipient decrypts using their private key + ephemeral public key

import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes, sha256, bytesToHex, hexToBytes } from "./hash.js";
import type { Note, EncryptedNote } from "../types.js";

/**
 * Encrypt a note for a recipient.
 *
 * @param note - The note to encrypt
 * @param recipientPubKey - Recipient's X25519 public key (32 bytes)
 * @returns Encrypted note payload
 */
export function encryptNote(
  note: Note,
  recipientPubKey: Uint8Array
): EncryptedNote {
  // Generate ephemeral keypair
  const ephemeralPrivKey = randomBytes(32);
  const ephemeralPubKey = x25519.getPublicKey(ephemeralPrivKey);

  // Derive shared secret via ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivKey, recipientPubKey);

  // Derive encryption key from shared secret
  const encKey = sha256(sharedSecret).slice(0, 32);

  // Generate nonce
  const nonce = randomBytes(12);

  // Serialize note to plaintext
  const plaintext = serializeNote(note);

  // Encrypt with ChaCha20-Poly1305
  const cipher = chacha20poly1305(encKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Compute commitment for the encrypted note
  const commitment = sha256(plaintext);

  return {
    ciphertext,
    ephemeralPubKey,
    nonce,
    commitment,
  };
}

/**
 * Decrypt an encrypted note using the recipient's private key.
 *
 * @param encrypted - The encrypted note payload
 * @param recipientPrivKey - Recipient's X25519 private key (32 bytes)
 * @returns Decrypted note, or null if decryption fails
 */
export function decryptNote(
  encrypted: EncryptedNote,
  recipientPrivKey: Uint8Array
): Note | null {
  try {
    // Derive shared secret via ECDH
    const sharedSecret = x25519.getSharedSecret(
      recipientPrivKey,
      encrypted.ephemeralPubKey
    );

    // Derive encryption key
    const encKey = sha256(sharedSecret).slice(0, 32);

    // Decrypt with ChaCha20-Poly1305
    const cipher = chacha20poly1305(encKey, encrypted.nonce);
    const plaintext = cipher.decrypt(encrypted.ciphertext);

    // Deserialize note
    return deserializeNote(plaintext);
  } catch {
    // Decryption failed (wrong key, corrupted data, etc.)
    return null;
  }
}

/**
 * Generate an X25519 keypair for note encryption.
 */
export function generateKeypair(): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Derive an X25519 keypair from a Stellar secret key.
 * This allows users to receive encrypted notes using their existing wallet key.
 */
export function deriveKeypairFromStellarSecret(
  stellarSecret: string
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  // Hash the Stellar secret to derive X25519 private key
  const encoder = new TextEncoder();
  const seed = sha256(encoder.encode(stellarSecret));
  const privateKey = sha256(seed); // Double hash for domain separation
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeNote(note: Note): Uint8Array {
  const json = JSON.stringify({
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
  });
  return new TextEncoder().encode(json);
}

function deserializeNote(data: Uint8Array): Note {
  const json = new TextDecoder().decode(data);
  const obj = JSON.parse(json);
  return {
    id: obj.id,
    assetId: obj.assetId,
    amount: BigInt(obj.amount),
    owner: obj.owner,
    randomness: hexToBytes(obj.randomness),
    nullifierKey: hexToBytes(obj.nullifierKey),
    nullifierSecret: hexToBytes(obj.nullifierSecret),
    memo: obj.memo,
    spent: obj.spent,
    creationTxHash: obj.creationTxHash,
    createdAt: obj.createdAt,
  };
}
