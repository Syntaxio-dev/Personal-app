// Vault: rules and encryption (no DOM, no Capacitor). Important documents (Aadhaar, PAN ...), passwords, bank details and
// secure notes. Everything is encrypted with a key that only exists while the Vault is unlocked.
//
// Keys: a random data key (DEK) encrypts the item list and every file. The DEK is itself locked ("wrapped") with a key made
// from the Vault PIN (PBKDF2-SHA256). So changing the PIN only re-wraps one small value, and the files never change.
// What is stored (state.vault) is only ciphertext: { v, salt, iter, wrap, blob, fails, until }. Without the PIN nothing in it,
// not even the titles, can be read. There is no way to recover a forgotten PIN; that is the point.
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

export const ITER = 250000;
export const MIN_PIN = 6;
export const MAX_FILE = 15 * 1024 * 1024;   // pictures and PDFs
export const MAX_VIDEO = 40 * 1024 * 1024;  // videos are bigger, they get more room
export const MAX_FILES = 8; // per item

export const available = () => !!subtle();

// ---------- bytes <-> base64 ----------
export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---------- crypto ----------
async function pinKey(pin, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const dataKey = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

// iv (12 bytes) + ciphertext
export async function seal(key, bytes) {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}
export async function open(key, bytes) {
  if (!bytes || bytes.length < 29) throw new Error('bad data');
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}
export const sealJson = async (key, value) => b64(await seal(key, enc.encode(JSON.stringify(value))));
export const openJson = async (key, text) => JSON.parse(dec.decode(await open(key, unb64(text))));

// Creates a brand-new vault locked with the PIN. Returns { vault (what to store), key (the open data key) }.
export async function create(pin) {
  const salt = rand(16);
  const raw = rand(32);
  const kek = await pinKey(pin, salt, ITER);
  const key = await dataKey(raw);
  const vault = { v: 1, salt: b64(salt), iter: ITER, wrap: b64(await seal(kek, raw)), blob: await sealJson(key, []), fails: 0, until: 0 };
  return { vault, key };
}

// The raw 32 bytes of the data key, opened with the PIN. Throws when the PIN is wrong (the AES-GCM check fails).
// Only used to hand the key to the phone's fingerprint lock (src/vaultui.js); callers wipe it right after.
export async function unlockRaw(vault, pin) {
  const kek = await pinKey(pin, unb64(vault.salt), vault.iter);
  return open(kek, unb64(vault.wrap));
}
export const keyFromRaw = (raw) => dataKey(raw);

// Opens the data key with the PIN. Throws when the PIN is wrong.
export async function unlock(vault, pin) {
  return dataKey(await unlockRaw(vault, pin));
}

// Re-wraps the same data key with a new PIN. The old PIN must be right. Returns the new { salt, iter, wrap }.
export async function rewrap(vault, oldPin, newPin) {
  const kek = await pinKey(oldPin, unb64(vault.salt), vault.iter);
  const raw = await open(kek, unb64(vault.wrap));
  const salt = rand(16);
  const next = await pinKey(newPin, salt, ITER);
  return { salt: b64(salt), iter: ITER, wrap: b64(await seal(next, raw)) };
}

// ---------- PIN rules ----------
export const pinProblem = (pin) => {
  const p = String(pin || '');
  if (p.length < MIN_PIN) return `Use at least ${MIN_PIN} characters. Numbers are fine.`;
  if (/^(.)\1+$/.test(p)) return 'Do not repeat one character. Pick something harder to guess.';
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return 'A run of numbers is easy to guess. Pick another PIN.';
  return '';
};
// wrong tries: the first 4 are free, then the wait grows 30 s, 1 min, 2 min ... up to 1 hour (a deterrent for someone holding the phone)
export const waitAfter = (fails) => (fails < 5 ? 0 : Math.min(3600, 30 * 2 ** (fails - 5))) * 1000;

// ---------- what a stored vault must look like (the backup file is untrusted) ----------
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export function cleanVault(v) {
  if (!v || typeof v !== 'object') return null;
  const s = (x, max) => (typeof x === 'string' && x.length > 0 && x.length <= max && B64.test(x) ? x : '');
  const salt = s(v.salt, 64), wrap = s(v.wrap, 400), blob = s(v.blob, 4000000);
  const iter = Math.round(Number(v.iter));
  if (!salt || !wrap || !blob || !(iter >= 100000 && iter <= 5000000)) return null;
  return { v: 1, salt, iter, wrap, blob, fails: Math.min(99, Math.max(0, Math.round(Number(v.fails)) || 0)), until: Math.min(Date.now() + 3600000, Math.max(0, Number(v.until) || 0)) };
}

// ---------- items ----------
// type -> what is asked. f: { k key, l label, secret (masked until revealed), multi, kind: text|date, copy }
export const TYPES = [
  { id: 'doc', label: 'Document', hint: 'Aadhaar, PAN, licence, certificates', fields: [
    { k: 'num', l: 'Document number', copy: true },
    { k: 'name', l: 'Name on the document' },
    { k: 'valid', l: 'Valid till (optional)', kind: 'date' },
    { k: 'note', l: 'Note', multi: true },
  ] },
  { id: 'login', label: 'Password', hint: 'Website, app or email logins', fields: [
    { k: 'user', l: 'Username or email', copy: true },
    { k: 'pass', l: 'Password', secret: true, copy: true, gen: true },
    { k: 'url', l: 'Website or app' },
    { k: 'note', l: 'Note', multi: true },
  ] },
  { id: 'bank', label: 'Bank or card', hint: 'Account, card, UPI, PINs', fields: [
    { k: 'bank', l: 'Bank name' },
    { k: 'acc', l: 'Account number', copy: true },
    { k: 'ifsc', l: 'IFSC', copy: true },
    { k: 'branch', l: 'Branch' },
    { k: 'crn', l: 'CRN / customer ID', copy: true },
    { k: 'card', l: 'Card number', secret: true, copy: true },
    { k: 'exp', l: 'Card expiry (MM/YY)' },
    { k: 'cvv', l: 'CVV', secret: true, copy: true },
    { k: 'pin', l: 'PIN', secret: true, copy: true },
    { k: 'upi', l: 'UPI ID', copy: true },
    { k: 'note', l: 'Note', multi: true },
  ] },
  { id: 'note', label: 'Secure note', hint: 'Wi-Fi, lockers, anything private', fields: [
    { k: 'body', l: 'Note', multi: true, copy: true },
  ] },
];
export const TYPE = Object.fromEntries(TYPES.map((t) => [t.id, t]));
// quick ideas for the "Add field" button, per type (the user can always type any label)
export const SUGGEST = {
  doc: ["Father's name", 'Date of birth', 'Address', 'Issue date', 'Issued by'],
  login: ['Recovery email', 'Security question', 'Backup code', 'Registered mobile'],
  bank: ['MICR', 'Nominee', 'Net banking ID', 'Registered mobile', 'Customer care', 'Debit card PIN'],
  note: [],
};
export const MAX_EXTRA = 30;
export const DOC_PRESETS = ['Aadhaar card', 'PAN card', 'Driving licence', 'Passport', 'Voter ID', 'Vehicle RC', 'Insurance', 'Marksheet', 'Degree certificate', 'Resume'];

const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
const ID = /^[a-z0-9]{4,24}$/;

// the decrypted list is also checked: a vault file restored from outside may hold anything
export function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((x) => x && typeof x === 'object' && TYPE[x.type] && ID.test(String(x.id)) && !seen.has(x.id) && seen.add(x.id)).slice(0, 2000).map((x) => {
    const fields = {};
    TYPE[x.type].fields.forEach((f) => { const v = str(x.fields && x.fields[f.k], f.multi ? 4000 : 300); if (v) fields[f.k] = v; });
    const files = (Array.isArray(x.files) ? x.files : []).filter((f) => f && ID.test(String(f.id)) && /^[a-z0-9]{1,5}$/.test(String(f.x))).slice(0, MAX_FILES)
      .map((f) => ({ id: String(f.id), x: String(f.x), n: str(f.n, 80), size: Math.max(0, Math.round(Number(f.size)) || 0), t: Number(f.t) || 0 }));
    const extra = (Array.isArray(x.extra) ? x.extra : []).filter((e) => e && typeof e === 'object').slice(0, MAX_EXTRA)
      .map((e) => ({ l: str(e.l, 40).trim(), v: str(e.v, 1000).trim(), s: !!e.s })).filter((e) => e.l || e.v).map((e) => ({ ...e, l: e.l || 'Field' }));
    return { id: String(x.id), type: x.type, title: str(x.title, 80).trim() || TYPE[x.type].label, fields, extra, files, fav: !!x.fav, t: Number(x.t) || 0, u: Number(x.u) || 0 };
  });
}

// what is shown under the title in the list (never a secret)
export function subtitle(it) {
  const f = it.fields || {};
  if (it.type === 'doc') return f.num || f.name || (it.files.length ? '' : 'No details yet');
  if (it.type === 'login') return f.user || f.url || '';
  if (it.type === 'bank') return f.bank || (f.acc ? `A/c ${f.acc.slice(-4).padStart(f.acc.length, '•')}` : f.upi || '');
  return (f.body || '').split('\n')[0].slice(0, 60);
}

export function matches(it, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // secret fields are never searched, so a half-typed password does not light up rows
  const secret = new Set(TYPE[it.type].fields.filter((f) => f.secret).map((f) => f.k));
  const hay = [it.title, TYPE[it.type].label, ...Object.entries(it.fields).filter(([k]) => !secret.has(k)).map(([, v]) => v), ...(it.extra || []).filter((e) => !e.s).flatMap((e) => [e.l, e.v]), ...it.files.map((f) => f.n)].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// Every filled field of an item, the built-in ones first and then the ones the user added:
// [{ key, l, v, secret, copy, multi }]. Built-in keys are the field key, added ones are "x0", "x1", ...
export function listFields(it) {
  const out = [];
  TYPE[it.type].fields.forEach((f) => { const v = it.fields[f.k]; if (v) out.push({ key: f.k, l: f.l.replace(/ \(optional\)$/, ''), v, secret: !!f.secret, copy: !!f.copy || it.type === 'note', multi: !!f.multi }); });
  (it.extra || []).forEach((e, i) => { if (e.v) out.push({ key: `x${i}`, l: e.l, v: e.v, secret: !!e.s, copy: true, multi: e.v.includes('\n') }); });
  return out;
}

// The text that goes to WhatsApp and the like: a title line, then "Label: value" lines. Only the ticked keys are used.
export function shareText(it, keys) {
  const lines = listFields(it).filter((f) => keys.has(f.key)).map((f) => (f.multi ? `${f.l}:\n${f.v}` : `${f.l}: ${f.v}`));
  return lines.length ? `${it.title}\n${lines.join('\n')}` : '';
}

export const sortItems = (list) => [...list].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));

// ---------- password generator (uniform choice, no modulo bias) ----------
const SETS = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*?-_+='];
function pick(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}
export function genPassword(len = 16) {
  const all = SETS.join('');
  const out = SETS.map((s) => s[pick(s.length)]); // at least one of each kind
  while (out.length < len) out.push(all[pick(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = pick(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska' };
export const mimeOf = (x) => MIME[String(x).toLowerCase()] || 'application/octet-stream';
export const isVideo = (x) => /^(mp4|m4v|mov|webm|3gp|mkv)$/i.test(String(x));
export const isImage = (x) => /^(jpe?g|png|webp|gif)$/i.test(String(x));
export const extOf = (file) => {
  const fromName = (String(file.name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  const fromType = (String(file.type || '').split('/')[1] || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return (fromName || fromType || 'bin').toLowerCase();
};
// only pictures, videos and PDFs go into the Vault
export const fileOk = (file) => /^(image|video)\//.test(file.type) || file.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|heif|mp4|m4v|mov|webm|3gp|mkv)$/i.test(file.name || '');
export const isVideoFile = (file) => /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|3gp|mkv)$/i.test(file.name || '');
export const limitFor = (file) => (isVideoFile(file) ? MAX_VIDEO : MAX_FILE);
