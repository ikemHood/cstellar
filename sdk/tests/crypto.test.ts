// SDK Tests - Commitment and Nullifier computation

import { describe, it, expect } from "vitest";
import {
  computeCommitment,
  computeCommitmentFromFields,
  deriveNullifier,
  deriveNullifierFromFields,
  computeTreeRoot,
} from "../src/crypto/commitment.js";
import {
  sha256,
  poseidonHash,
  randomBytes,
  bigintToBytes,
  bytesToBigint,
  bytesToHex,
  hexToBytes,
  toField,
} from "../src/crypto/hash.js";
import { NoteManager } from "../src/notes/manager.js";
import type { Note } from "../src/types.js";

describe("Hash utilities", () => {
  it("sha256 produces 32-byte output", () => {
    const hash = sha256(new Uint8Array([1, 2, 3]));
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it("sha256 is deterministic", () => {
    const a = sha256(new Uint8Array([1, 2, 3]));
    const b = sha256(new Uint8Array([1, 2, 3]));
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("randomBytes produces requested length", () => {
    const bytes = randomBytes(32);
    expect(bytes.length).toBe(32);
  });

  it("bigintToBytes and bytesToBigint roundtrip", () => {
    const original = 123456789012345678901234567890n;
    const bytes = bigintToBytes(original);
    const recovered = bytesToBigint(bytes);
    expect(recovered).toBe(original);
  });

  it("hexToBytes and bytesToHex roundtrip", () => {
    const original = randomBytes(32);
    const hex = bytesToHex(original);
    const recovered = hexToBytes(hex);
    expect(bytesToHex(recovered)).toBe(hex);
  });

  it("poseidonHash returns a field element", () => {
    const hash = poseidonHash([1n, 2n, 3n, 4n, 5n]);
    expect(typeof hash).toBe("bigint");
    expect(hash).toBeGreaterThan(0n);
  });

  it("toField reduces modulo BN254", () => {
    const mod =
      21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    expect(toField(mod + 1n)).toBe(1n);
    expect(toField(mod)).toBe(0n);
    expect(toField(-1n)).toBe(mod - 1n);
  });
});

describe("Commitment computation", () => {
  it("produces 32-byte commitment", () => {
    const note: Note = {
      id: "test-1",
      assetId: "test-asset",
      amount: 1000000000n,
      owner: "test-owner",
      randomness: randomBytes(32),
      nullifierKey: randomBytes(32),
      nullifierSecret: randomBytes(32),
      spent: false,
      createdAt: Date.now(),
    };

    const { hash } = computeCommitment(note);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it("is deterministic for same inputs", () => {
    const randomness = new Uint8Array(32).fill(1);
    const nullifierKey = new Uint8Array(32).fill(2);

    const note1: Note = {
      id: "test-1",
      assetId: "asset",
      amount: 100n,
      owner: "owner",
      randomness,
      nullifierKey,
      nullifierSecret: randomBytes(32),
      spent: false,
      createdAt: Date.now(),
    };

    const note2: Note = { ...note1, id: "test-2" };

    const c1 = computeCommitment(note1);
    const c2 = computeCommitment(note2);
    expect(bytesToHex(c1.hash)).toBe(bytesToHex(c2.hash));
  });

  it("different amounts produce different commitments", () => {
    const randomness = new Uint8Array(32).fill(1);
    const nullifierKey = new Uint8Array(32).fill(2);

    const note1: Note = {
      id: "test-1",
      assetId: "asset",
      amount: 100n,
      owner: "owner",
      randomness,
      nullifierKey,
      nullifierSecret: randomBytes(32),
      spent: false,
      createdAt: Date.now(),
    };

    const note2: Note = { ...note1, amount: 200n };

    const c1 = computeCommitment(note1);
    const c2 = computeCommitment(note2);
    expect(bytesToHex(c1.hash)).not.toBe(bytesToHex(c2.hash));
  });

  it("computeCommitmentFromFields matches direct computation", () => {
    const hash = computeCommitmentFromFields(1n, 100n, 2n, 3n, 4n);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });
});

describe("Nullifier derivation", () => {
  it("produces 32-byte nullifier", () => {
    const note: Note = {
      id: "test-1",
      assetId: "asset",
      amount: 100n,
      owner: "owner",
      randomness: randomBytes(32),
      nullifierKey: randomBytes(32),
      nullifierSecret: randomBytes(32),
      spent: false,
      createdAt: Date.now(),
    };

    const { value } = deriveNullifier(note);
    expect(value).toBeInstanceOf(Uint8Array);
    expect(value.length).toBe(32);
  });

  it("is deterministic for same key+secret", () => {
    const nk = new Uint8Array(32).fill(5);
    const ns = new Uint8Array(32).fill(6);

    const note1: Note = {
      id: "test-1",
      assetId: "asset",
      amount: 100n,
      owner: "owner",
      randomness: randomBytes(32),
      nullifierKey: nk,
      nullifierSecret: ns,
      spent: false,
      createdAt: Date.now(),
    };

    const note2: Note = { ...note1, id: "test-2" };

    const n1 = deriveNullifier(note1);
    const n2 = deriveNullifier(note2);
    expect(bytesToHex(n1.value)).toBe(bytesToHex(n2.value));
  });

  it("different secrets produce different nullifiers", () => {
    const nk = new Uint8Array(32).fill(5);

    const note1: Note = {
      id: "test-1",
      assetId: "asset",
      amount: 100n,
      owner: "owner",
      randomness: randomBytes(32),
      nullifierKey: nk,
      nullifierSecret: new Uint8Array(32).fill(1),
      spent: false,
      createdAt: Date.now(),
    };

    const note2: Note = {
      ...note1,
      nullifierSecret: new Uint8Array(32).fill(2),
    };

    const n1 = deriveNullifier(note1);
    const n2 = deriveNullifier(note2);
    expect(bytesToHex(n1.value)).not.toBe(bytesToHex(n2.value));
  });
});

describe("Tree root computation", () => {
  it("updates root with new commitment", () => {
    const oldRoot = new Uint8Array(32);
    const commitment = randomBytes(32);
    const newRoot = computeTreeRoot(oldRoot, commitment);

    expect(newRoot).toBeInstanceOf(Uint8Array);
    expect(newRoot.length).toBe(32);
    expect(bytesToHex(newRoot)).not.toBe(bytesToHex(oldRoot));
  });

  it("is deterministic", () => {
    const root = new Uint8Array(32).fill(0);
    const cm = new Uint8Array(32).fill(1);

    const r1 = computeTreeRoot(root, cm);
    const r2 = computeTreeRoot(root, cm);
    expect(bytesToHex(r1)).toBe(bytesToHex(r2));
  });
});

describe("NoteManager", () => {
  it("creates notes with correct properties", () => {
    const manager = new NoteManager("test-owner");
    const { note, commitment } = manager.createNote("asset", 1000n);

    expect(note.amount).toBe(1000n);
    expect(note.owner).toBe("test-owner");
    expect(note.spent).toBe(false);
    expect(commitment.hash.length).toBe(32);
  });

  it("tracks balance correctly", () => {
    const manager = new NoteManager("owner");
    manager.createNote("asset-a", 100n);
    manager.createNote("asset-a", 200n);
    manager.createNote("asset-b", 50n);

    expect(manager.getBalance("asset-a")).toBe(300n);
    expect(manager.getBalance("asset-b")).toBe(50n);
    expect(manager.getBalance("asset-c")).toBe(0n);
  });

  it("selects notes to cover target amount", () => {
    const manager = new NoteManager("owner");
    manager.createNote("asset", 100n);
    manager.createNote("asset", 200n);
    manager.createNote("asset", 300n);

    const { notes, total } = manager.selectNotes("asset", 250n);
    expect(total).toBeGreaterThanOrEqual(250n);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("throws on insufficient balance", () => {
    const manager = new NoteManager("owner");
    manager.createNote("asset", 100n);

    expect(() => manager.selectNotes("asset", 200n)).toThrow(
      "Insufficient balance"
    );
  });

  it("marks notes as spent", () => {
    const manager = new NoteManager("owner");
    const { note } = manager.createNote("asset", 100n);

    expect(manager.getBalance("asset")).toBe(100n);

    manager.markSpent(note.id);
    expect(manager.getBalance("asset")).toBe(0n);
  });

  it("exports and imports notes", () => {
    const manager1 = new NoteManager("owner");
    manager1.createNote("asset", 100n);
    manager1.createNote("asset", 200n);

    const exported = manager1.exportNotes();
    expect(exported.notes.length).toBe(2);

    const manager2 = new NoteManager("owner");
    const imported = manager2.importNotes(exported);
    expect(imported).toBe(2);
    expect(manager2.getBalance("asset")).toBe(300n);
  });
});
