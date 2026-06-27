import { describe, expect, it } from "vitest";
import {
  decryptNote,
  encryptNote,
  generateKeypair,
} from "../src/crypto/encryption.js";
import { randomBytes } from "../src/crypto/hash.js";
import type { Note } from "../src/types.js";

function testNote(): Note {
  return {
    id: "test-1",
    assetId: "asset",
    amount: 1000n,
    owner: "owner",
    randomness: randomBytes(32),
    nullifierKey: randomBytes(32),
    nullifierSecret: randomBytes(32),
    spent: false,
    createdAt: Date.now(),
  };
}

describe("Note encryption", () => {
  it("encrypts and decrypts a note", () => {
    const keypair = generateKeypair();
    const note = testNote();

    const encrypted = encryptNote(note, keypair.publicKey);
    const decrypted = decryptNote(encrypted, keypair.privateKey);

    expect(decrypted).not.toBeNull();
    expect(decrypted!.amount).toBe(note.amount);
    expect(decrypted!.owner).toBe(note.owner);
  });

  it("fails to decrypt with wrong key", () => {
    const keypair1 = generateKeypair();
    const keypair2 = generateKeypair();
    const note = testNote();

    const encrypted = encryptNote(note, keypair1.publicKey);
    const decrypted = decryptNote(encrypted, keypair2.privateKey);

    expect(decrypted).toBeNull();
  });
});
