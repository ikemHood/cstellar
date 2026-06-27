import { describe, expect, it } from "vitest";
import { randomBytes } from "../src/crypto/hash.js";
import type { SerializedNote } from "../src/types.js";
import {
  MemoryBlobStorage,
  IndexedDbBlobStorage,
} from "../src/storage/backends.js";
import { EncryptedNoteStorage } from "../src/storage/encrypted.js";
import {
  deriveKeyFromPasscode,
  deriveKeyFromSecret,
  generateSalt,
  ENCRYPTION_KEY_BYTES,
  SALT_BYTES,
} from "../src/storage/keys.js";
import { BACKUP_MAGIC } from "../src/storage/types.js";
import { NoteManager } from "../src/notes/manager.js";

function fakeNote(id: string): SerializedNote {
  return {
    id,
    assetId: "native",
    amount: "1000",
    owner: "GDUMMY",
    randomness: "ab".repeat(32),
    nullifierKey: "cd".repeat(32),
    nullifierSecret: "ef".repeat(32),
    spent: false,
    createdAt: 1700000000000,
  };
}

describe("Key derivation", () => {
  it("deriveKeyFromPasscode returns 32 bytes and is deterministic", () => {
    const salt = generateSalt();
    const a = deriveKeyFromPasscode("hunter2", salt);
    const b = deriveKeyFromPasscode("hunter2", salt);
    expect(a.length).toBe(ENCRYPTION_KEY_BYTES);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("different passcodes produce different keys", () => {
    const salt = generateSalt();
    const a = deriveKeyFromPasscode("alpha", salt);
    const b = deriveKeyFromPasscode("omega", salt);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("deriveKeyFromSecret is deterministic with same input", () => {
    const salt = generateSalt();
    const secret = randomBytes(32);
    const a = deriveKeyFromSecret(secret, salt);
    const b = deriveKeyFromSecret(secret, salt);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("rejects bad salt length", () => {
    expect(() => deriveKeyFromPasscode("x", new Uint8Array(8))).toThrow();
    expect(() =>
      deriveKeyFromSecret(new Uint8Array(4), new Uint8Array(8))
    ).toThrow();
  });
});

describe("EncryptedNoteStorage", () => {
  it("round-trips notes through memory backend with passcode", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "secret" });

    await storage.save("owner-1", [fakeNote("n1"), fakeNote("n2")]);
    const loaded = await storage.load("owner-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(2);
    expect(loaded![0].id).toBe("n1");
  });

  it("returns null when nothing is stored for an owner", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "secret" });
    const loaded = await storage.load("nobody");
    expect(loaded).toBeNull();
  });

  it("fails to decrypt with the wrong passcode", async () => {
    const backend = new MemoryBlobStorage();
    const write = new EncryptedNoteStorage(backend, { passcode: "right" });
    await write.save("owner", [fakeNote("n1")]);

    const read = new EncryptedNoteStorage(backend, { passcode: "wrong" });
    const loaded = await read.load("owner");
    // Wrong key => AEAD decrypt throws => load returns null.
    expect(loaded).toBeNull();
  });

  it("isolates owners in the backend store", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "x" });
    await storage.save("alice", [fakeNote("a1")]);
    await storage.save("bob", [fakeNote("b1")]);
    const alice = await storage.load("alice");
    const bob = await storage.load("bob");
    expect(alice?.[0].id).toBe("a1");
    expect(bob?.[0].id).toBe("b1");
  });

  it("export/import backup round-trips an encrypted blob", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "pass" });
    await storage.save("owner", [fakeNote("n1"), fakeNote("n2")]);

    const blob = await storage.exportBlob("owner");
    expect(blob).not.toBeNull();
    // Backup file begins with the documented magic.
    expect(Array.from(blob!.slice(0, BACKUP_MAGIC.length))).toEqual(
      Array.from(BACKUP_MAGIC)
    );

    // Restore into a fresh backend and verify the notes are recoverable.
    const freshBackend = new MemoryBlobStorage();
    const restored = new EncryptedNoteStorage(freshBackend, {
      passcode: "pass",
    });
    await restored.importBlob("owner", blob!);
    const notes = await restored.load("owner");
    expect(notes?.length).toBe(2);
    expect(notes?.[0].id).toBe("n1");
  });

  it("export returns null when nothing is stored", async () => {
    const storage = new EncryptedNoteStorage(new MemoryBlobStorage(), {
      passcode: "x",
    });
    expect(await storage.exportBlob("nobody")).toBeNull();
  });

  it("rejects a tampered backup blob", async () => {
    const storage = new EncryptedNoteStorage(new MemoryBlobStorage(), {
      passcode: "x",
    });
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await expect(storage.importBlob("owner", bad)).rejects.toThrow("magic");
  });

  it("rejects construction without key material", () => {
    expect(() =>
      new EncryptedNoteStorage(new MemoryBlobStorage(), {})
    ).toThrow();
  });
});

describe("NoteManager storage integration", () => {
  it("persists through encrypted memory backend and reloads", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "demo" });

    const owner = "GOWNER";
    const a = new NoteManager(owner, { storage, skipAutoload: true });
    await a.init();
    a.createNote("native", 500n);
    a.createNote("native", 250n);
    // Give fire-and-forget persists a chance to complete.
    await a.persist();
    expect(a.count).toBe(2);

    const b = new NoteManager(owner, { storage, skipAutoload: true });
    await b.init();
    const reloaded = b.getAllNotes();
    expect(reloaded.length).toBe(2);
    expect(reloaded.some((n) => n.amount === 500n)).toBe(true);
    expect(reloaded.some((n) => n.amount === 250n)).toBe(true);
  });

  it("importNotes triggers write-through", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "demo" });
    const mgr = new NoteManager("G", { storage, skipAutoload: true });
    await mgr.init();
    mgr.importNotes({
      version: 1,
      exportedAt: 1,
      notes: [fakeNote("x1")],
    });
    await mgr.persist();

    const reloaded = new NoteManager("G", { storage, skipAutoload: true });
    await reloaded.init();
    expect(reloaded.count).toBe(1);
  });

  it("clear wipes both memory and storage", async () => {
    const backend = new MemoryBlobStorage();
    const storage = new EncryptedNoteStorage(backend, { passcode: "demo" });
    const mgr = new NoteManager("G", { storage, skipAutoload: true });
    await mgr.init();
    mgr.createNote("native", 100n);
    await mgr.persist();
    await mgr.clear();
    expect(mgr.count).toBe(0);
    expect(await storage.load("G")).toBeNull();
  });
});

describe("IndexedDbBlobStorage (when IndexedDB is available)", () => {
  // IndexedDB is unavailable in plain Node; the constructor must surface that
  // so callers can fall back to a different backend rather than corrupt state
  // silently.
  it("throws synchronously when IndexedDB is missing", () => {
    const original = (globalThis as any).indexedDB;
    try {
      delete (globalThis as any).indexedDB;
      expect(() => new IndexedDbBlobStorage()).toThrow(/IndexedDB/);
    } finally {
      if (original !== undefined) (globalThis as any).indexedDB = original;
    }
  });
});