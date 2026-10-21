// Small key-value store on top of IndexedDB, exposed as window.storage so the app code
// (written for Claude artifacts) works unchanged. Everything stays on this device.
const DB_NAME = "doctor-arwa";
const STORE = "kv";
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB not available")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

window.storage = {
  async get(key) {
    const v = await run("readonly", (s) => s.get(key));
    if (v === undefined) throw new Error("Key not found");
    return { key, value: v, shared: false };
  },
  async set(key, value) { await run("readwrite", (s) => s.put(value, key)); return { key, value, shared: false }; },
  async delete(key) { await run("readwrite", (s) => s.delete(key)); return { key, deleted: true, shared: false }; },
  async list(prefix = "") {
    const keys = await run("readonly", (s) => s.getAllKeys());
    return { keys: keys.filter((k) => String(k).startsWith(prefix)), prefix, shared: false };
  },
};
