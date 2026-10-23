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
    goalCheckOn: true, dreamOn: true, dreamPick: null, keepAlive: true,
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
  state = sanitize(normalize(parsed.data));
  await save();
}

// Backups are files from outside the app: keep only well-formed records and force numbers to be numbers.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (v === undefined || v === null ? '' : String(v));
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
function sanitize(s) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  s.transactions = list(s.transactions).filter((t) => day(t.date)).map((t) => ({ ...t, id: str(t.id), type: t.type === 'income' ? 'income' : 'expense', amount: num(t.amount), category: str(t.category), note: str(t.note), person: str(t.person), mode: t.mode === 'cash' ? 'cash' : 'online' }));
  s.todos = list(s.todos).filter((t) => day(t.date)).map((t) => ({ ...t, id: str(t.id), title: str(t.title), time: /^\d{2}:\d{2}$/.test(str(t.time)) ? t.time : '', pri: ['high', 'med', 'low'].includes(t.pri) ? t.pri : 'med', doneAt: num(t.doneAt), done: !!t.done }));
  s.commitments = list(s.commitments).map((c) => ({ ...c, id: str(c.id), name: str(c.name), amount: num(c.amount), total: num(c.total), paidBefore: num(c.paidBefore), paidOn: c.paidOn && typeof c.paidOn === 'object' ? c.paidOn : {}, dueDay: Math.min(31, Math.max(1, num(c.dueDay) || 1)), paid: c.paid && typeof c.paid === 'object' ? c.paid : {} }));
  const sipOf = (x) => (x && typeof x === 'object' && /^\d{4}-\d{2}$/.test(str(x.start)) ? { amount: num(x.amount), day: Math.min(31, Math.max(1, num(x.day) || 1)), start: x.start, on: x.on !== false, done: x.done && typeof x.done === 'object' ? x.done : {} } : null);
  s.investments = list(s.investments).map((i) => ({ ...i, id: str(i.id), name: str(i.name), type: str(i.type), returnPct: i.returnPct === null || i.returnPct === undefined || i.returnPct === '' ? null : num(i.returnPct), sip: sipOf(i.sip), value: i.value === null || i.value === undefined || i.value === '' ? null : num(i.value), entries: list(i.entries).map((e) => ({ ...e, amount: num(e.amount), date: day(e.date) || '1970-01-01' })) }));
  s.lent = list(s.lent).map((l) => ({ ...l, id: str(l.id), person: str(l.person), amount: num(l.amount), note: str(l.note), date: day(l.date) || '1970-01-01', due: day(l.due), returns: list(l.returns).map((r) => ({ ...r, amount: num(r.amount) })) }));
  s.goals = list(s.goals).filter((g) => day(g.start) && day(g.end)).map((g) => ({ ...g, id: str(g.id), title: str(g.title), why: str(g.why), unit: str(g.unit), target: num(g.target), from: num(g.from), progress: list(g.progress).map((e) => ({ ...e, amount: num(e.amount) })) }));
  s.bucket = list(s.bucket).map((b) => ({ ...b, id: str(b.id), title: str(b.title), cat: str(b.cat), note: str(b.note), cost: num(b.cost), deadline: day(b.deadline), moves: list(b.moves) }));
  s.inbox = list(s.inbox).map((p) => ({ ...p, amount: num(p.amount), payee: str(p.payee), note: str(p.note), category: str(p.category) }));
  s.people = Array.isArray(s.people) ? s.people.map(str).filter(Boolean) : [];
  const att = {};
  Object.entries(s.attendance && typeof s.attendance === 'object' ? s.attendance : {}).forEach(([k, v]) => { if (day(k) && v && ['P', 'H', 'L', 'O', 'A'].includes(v.s)) att[k] = { s: v.s }; });
  s.attendance = att;
  const budgets = {};
  Object.entries(s.budgets && typeof s.budgets === 'object' ? s.budgets : {}).forEach(([k, v]) => { if (num(v) > 0) budgets[str(k)] = num(v); });
  s.budgets = budgets;
  ['salary', 'salaryDay', 'salaryAmount', 'openingBalance', 'planLead'].forEach((k) => { s.settings[k] = num(s.settings[k]); });
  if (!s.settings.salaryDay) s.settings.salaryDay = 11;
  if (!s.settings.planLead) s.settings.planLead = 30;
  s.settings.name = str(s.settings.name).slice(0, 30);
  return s;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
