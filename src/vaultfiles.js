// Vault files on the phone. Only ENCRYPTED bytes are stored (src/vault.js seals them first), in the app's own storage:
// Directory.Data/vault/<id>.<ext> through Capacitor Filesystem. A desktop browser (dev only) uses IndexedDB 'prysm-vault'.
// A decrypted copy only exists for a moment when the user opens or shares a file: it goes to Directory.Cache/vault-tmp and
// is removed again by clearTemp() (on lock, on unlock and on app start).
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { b64, unb64 } from './vault.js';

const DIR = 'vault';
const TMP = 'vault-tmp';
const CHUNK = 3 * 1024 * 1024; // a multiple of 3: every base64 piece stands on its own
const native = () => Capacitor.isNativePlatform();
const nameOf = (id, x) => `${id}.${x}`;

// ---------- desktop fallback ----------
let dbp = null;
const idb = () => dbp || (dbp = new Promise((resolve, reject) => {
  const req = indexedDB.open('prysm-vault', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('files');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));
const idbDo = async (mode, fn) => {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const out = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
};

// writes the encrypted bytes; throws when they cannot be written (storage full)
export async function putBytes(id, x, bytes) {
  if (!native()) { await idbDo('readwrite', (st) => st.put(bytes, nameOf(id, x))); return; }
  const path = `${DIR}/${nameOf(id, x)}`;
  try {
    for (let off = 0, first = true; off < bytes.length || first; off += CHUNK, first = false) {
      const data = b64(bytes.subarray(off, off + CHUNK));
      if (first) await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Data });
    }
  } catch (e) {
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch (err) { /* nothing was written */ }
    throw e;
  }
}

// the encrypted bytes, or null when the file is not on the phone (a restored backup, cleared storage)
export async function getBytes(id, x) {
  try {
    if (!native()) { const v = await idbDo('readonly', (st) => st.get(nameOf(id, x))); return v ? new Uint8Array(v) : null; }
    const r = await Filesystem.readFile({ path: `${DIR}/${nameOf(id, x)}`, directory: Directory.Data });
    return unb64(typeof r.data === 'string' ? r.data : '');
  } catch (e) { return null; }
}

export async function delBytes(id, x) {
  try {
    if (!native()) await idbDo('readwrite', (st) => st.delete(nameOf(id, x)));
    else await Filesystem.deleteFile({ path: `${DIR}/${nameOf(id, x)}`, directory: Directory.Data });
  } catch (e) { /* already gone */ }
}

// every stored file name ("<id>.<ext>"), to find files no item points to any more
export async function listNames() {
  try {
    if (!native()) return (await idbDo('readonly', (st) => st.getAllKeys())) || [];
    return (await Filesystem.readdir({ path: DIR, directory: Directory.Data })).files.map((f) => f.name);
  } catch (e) { return []; }
}

export async function wipeAll() {
  try {
    if (!native()) await idbDo('readwrite', (st) => st.clear());
    else await Filesystem.rmdir({ path: DIR, directory: Directory.Data, recursive: true });
  } catch (e) { /* nothing there */ }
  await clearTemp();
}

// ---------- the short-lived readable copy (open in another app / share) ----------
// Returns { uri, path } on the phone (path is relative to the cache folder). On desktop nothing is written.
export async function putTemp(id, x, bytes) {
  if (!native()) return null;
  const path = `${TMP}/${nameOf(id, x)}`;
  for (let off = 0, first = true; off < bytes.length || first; off += CHUNK, first = false) {
    const data = b64(bytes.subarray(off, off + CHUNK));
    if (first) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return { uri, path };
}

export async function clearTemp() {
  if (!native()) return;
  try { await Filesystem.rmdir({ path: TMP, directory: Directory.Cache, recursive: true }); } catch (e) { /* nothing there */ }
}
