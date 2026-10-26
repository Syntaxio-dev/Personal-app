// Form videos and photos you add to an exercise (Fitness mode). The files stay on the phone, in the app's own storage,
// and are shown from there; nothing is uploaded. The list of them (name, size) is part of the saved data
// (state.fitness.media), the files themselves are NOT in a backup file, so a restored backup shows them as missing.
//
// Phone: Capacitor Filesystem (Directory.Data/media/<id>.<ext>), written in pieces so a long video never sits in memory
// whole. Desktop browser (dev only): IndexedDB.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

export const MAX_BYTES = 15 * 1024 * 1024; // the owner wants short form clips: 15 MB at most per file
const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so every base64 piece stands on its own
const DIR = 'media';
const native = () => Capacitor.isNativePlatform();

export const kindOf = (file) => (file && /^video\//.test(file.type) ? 'video' : file && /^image\//.test(file.type) ? 'photo' : '');
export const extOf = (file) => {
  const fromName = (String(file.name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  const fromType = (String(file.type || '').split('/')[1] || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return (fromName || fromType || (kindOf(file) === 'video' ? 'mp4' : 'jpg')).toLowerCase();
};
export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error || new Error('Could not read the file'));
  r.readAsDataURL(blob);
});

// ---------- desktop fallback ----------
let dbp = null;
const idb = () => dbp || (dbp = new Promise((resolve, reject) => {
  const req = indexedDB.open('prysm-media', 1);
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

// Saves the file under the id. onProgress(0..1). Throws if it cannot be written (full storage, a revoked file, ...).
export async function saveMedia(file, id, x, onProgress = () => {}) {
  if (!native()) {
    await idbDo('readwrite', (st) => st.put(file, `${id}.${x}`));
    onProgress(1);
    return;
  }
  const path = `${DIR}/${id}.${x}`;
  try {
    for (let off = 0, first = true; off < file.size || first; off += CHUNK, first = false) {
      const data = await toBase64(file.slice(off, off + CHUNK));
      if (first) await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Data });
      onProgress(Math.min(1, (off + CHUNK) / Math.max(1, file.size)));
    }
  } catch (e) {
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch (err) { /* nothing was written */ }
    throw e;
  }
}

// an address the <video> / <img> can load, or '' when the file is not there (a restored backup, cleared storage)
export async function mediaUrl(item) {
  const name = `${item.id}.${item.x || 'bin'}`;
  try {
    if (!native()) {
      const blob = await idbDo('readonly', (st) => st.get(name));
      return blob ? URL.createObjectURL(blob) : '';
    }
    const path = `${DIR}/${name}`;
    await Filesystem.stat({ path, directory: Directory.Data });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  } catch (e) { return ''; }
}

export async function deleteMedia(item) {
  const name = `${item.id}.${item.x || 'bin'}`;
  try {
    if (!native()) await idbDo('readwrite', (st) => st.delete(name));
    else await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data });
  } catch (e) { /* already gone */ }
}
