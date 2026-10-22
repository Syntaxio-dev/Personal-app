import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const LS_KEY = 'personal-app-state';
let conn = null;
let state = null;

const empty = () => ({
  settings: { salary: 0 },
  transactions: [],
  budgets: {},
  attendance: {},
  todos: [],
  inbox: [],
});

const normalize = (s) => ({ ...empty(), ...(s || {}) });

// On the phone data lives in a SQLite file; in a desktop browser (dev only) it falls back to localStorage.
export async function init() {
  if (Capacitor.isNativePlatform()) {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    conn = await sqlite.createConnection('personalapp', false, 'no-encryption', 1, false);
    await conn.open();
    await conn.execute('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    const r = await conn.query('SELECT v FROM kv WHERE k = ?', ['state']);
    state = normalize(r.values && r.values.length ? JSON.parse(r.values[0].v) : null);
  } else {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* ignore */ }
    state = normalize(saved);
  }
}

export const get = () => state;

export async function save() {
  const json = JSON.stringify(state);
  if (conn) await conn.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', ['state', json]);
  else localStorage.setItem(LS_KEY, json);
}

export const exportJson = () => JSON.stringify({ app: 'personal-app', version: 1, data: state }, null, 2);

export async function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.app !== 'personal-app' || !parsed.data) throw new Error('Yeh backup file sahi nahi hai');
  state = normalize(parsed.data);
  await save();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
