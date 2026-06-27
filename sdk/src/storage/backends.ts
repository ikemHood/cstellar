// SCT-01 SDK - Blob storage backends
//
// Concrete `BlobStorage` implementations for common runtimes.
//   - `MemoryBlobStorage`: in-memory, for tests and ephemeral sessions.
//   - `IndexedDbBlobStorage`: browser IndexedDB, the recommended default on
//     web. Survives reloads and (mostly) cache evictions, sized in MB/GB
//     rather than the 5MB localStorage cap, and isolated per origin.

/**
 * In-memory blob storage. Not persistent across reloads. Useful for tests,
// ephemeral sessions, and as a no-op fallback when no platform backend is
 * wired up.
 */
export class MemoryBlobStorage {
  private store = new Map<string, Uint8Array>();

  async load(key: string): Promise<Uint8Array | null> {
    const v = this.store.get(key);
    return v ? v.slice() : null;
  }

  async save(key: string, data: Uint8Array): Promise<void> {
    this.store.set(key, data.slice());
  }

  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test helper: number of entries currently held. */
  get size(): number {
    return this.store.size;
  }
}

/**
 * IndexedDB-backed blob storage.
 *
 * Stores one opaque record per key in a single object store. This is a
 * deliberately small surface: we only need get/set/delete. The encrypted
 * wrapper (`EncryptedNoteStorage`) handles the cryptographic envelope.
 *
 * Falls back gracefully when IndexedDB is unavailable (private mode, SSR,
 * non-browser runtimes): the constructor throws synchronously so callers can
 * detect the condition and pick a different backend (e.g. memory).
 */
export class IndexedDbBlobStorage {
  private readonly dbName: string;
  private readonly storeName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(opts?: { dbName?: string; storeName?: string }) {
    if (typeof indexedDB === "undefined") {
      throw new Error(
        "IndexedDbBlobStorage requires IndexedDB (not available in this runtime)"
      );
    }
    this.dbName = opts?.dbName ?? "sct01-storage";
    this.storeName = opts?.storeName ?? "blobs";
  }

  async load(key: string): Promise<Uint8Array | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => {
        const v = req.result;
        if (v === undefined) return resolve(null);
        // IndexedDB may return ArrayBuffer or Uint8Array depending on engine.
        if (v instanceof Uint8Array) resolve(v);
        else if (v instanceof ArrayBuffer) resolve(new Uint8Array(v));
        else if (ArrayBuffer.isView(v)) {
          resolve(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        } else {
          reject(new Error("unexpected stored value type"));
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async save(key: string, data: Uint8Array): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async clear(key: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
}