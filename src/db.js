import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const LS_KEY = 'personal-app-state';
let conn = null;
let state = null;

export const DASH_IDS = ['wallet', 'quick', 'tasks', 'goals', 'attendance', 'bills', 'bucket'];

const empty = () => ({
  settings: {
    salary: 0, name: '', sleep: '23:00', planLead: 30, planOn: true, remindOn: true, nagOn: true, askedNotif: false, askedExact: false, weekOff: [0], attStart: '',
    salaryDay: 11, salaryAmount: 0, openingBalance: 0, salaryOn: true, billOn: true, weeklyOn: true, backupOn: true,
    dashOrder: ['wallet', 'quick', 'tasks', 'goals', 'attendance', 'bills', 'bucket'], dashHidden: [],
    goalCheckOn: true, dreamOn: true, dreamPick: null,
  },
  transactions: [],
  budgets: {},
  attendance: {},
  todos: [],
  inbox: [],
  taskHistory: {},
  commitments: [],
  investments: [],
  lent: [],
  people: ['Mummy', 'Papa', 'Sister'],
  goals: [],
  bucket: [],
});

// New fields get defaults here, so data saved by older versions of the app still loads.
const normalize = (s) => {
  const base = empty();
  const x = s || {};
  const out = { ...base, ...x, settings: { ...base.settings, ...(x.settings || {}) } };
  // the old fixed monthly salary becomes the expected amount that pre-fills the Add salary form
  if (!out.settings.salaryAmount && Number(out.settings.salary) > 0) out.settings.salaryAmount = Number(out.settings.salary);
  // keep the saved dashboard order, and add any widget introduced by a newer version
  out.settings.dashOrder = [...new Set([...(out.settings.dashOrder || []).filter((i) => DASH_IDS.includes(i)), ...DASH_IDS])];
  out.settings.dashHidden = (out.settings.dashHidden || []).filter((i) => DASH_IDS.includes(i));
  return out;
};

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

export const exportJson = () => JSON.stringify({ app: 'prysm', version: 1, data: state }, null, 2);

export async function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !['prysm', 'personal-app'].includes(parsed.app) || !parsed.data) throw new Error('Yeh backup file sahi nahi hai');
  state = normalize(parsed.data);
  await save();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
