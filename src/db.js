import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { cleanSl, FOCUS_MAX } from './screen.js';

const LS_KEY = 'personal-app-state';
let conn = null;
let state = null;

export const DASH_IDS = ['wallet', 'quick', 'tasks', 'goals', 'attendance', 'bills', 'bucket', 'screen'];

const empty = () => ({
  settings: {
    salary: 0, name: '', sleep: '23:00', planLead: 30, planOn: true, remindOn: true, nagOn: true, askedNotif: false, askedExact: false, weekOff: [0], attStart: '',
    salaryDay: 11, salaryAmount: 0, openingBalance: 0, salaryOn: true, billOn: true, weeklyOn: true, backupOn: true,
    dashOrder: ['wallet', 'quick', 'tasks', 'goals', 'attendance', 'bills', 'bucket', 'screen'], dashHidden: [],
    goalCheckOn: true, dreamOn: true, dreamPick: null, keepAlive: true, haptics: true, hideBalance: false, lastBackup: 0, streakSeen: {}, windDownOn: true,
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
  screen: { days: {}, names: {} },
  limits: [],
  sleepLock: null,
  focus: { active: null, log: [] },
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
  out.screen = { days: {}, names: {}, ...(out.screen && typeof out.screen === 'object' ? out.screen : {}) };
  if (!Array.isArray(out.limits)) out.limits = [];
  if (!out.sleepLock || typeof out.sleepLock !== 'object') out.sleepLock = null;
  out.focus = { active: null, log: [], ...(out.focus && typeof out.focus === 'object' ? out.focus : {}) };
  if (!Array.isArray(out.focus.log)) out.focus.log = [];
  if (!out.settings.streakSeen || typeof out.settings.streakSeen !== 'object') out.settings.streakSeen = {};
  delete out.settings.screenStrict;
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

async function writeOnce() {
  const json = JSON.stringify(state);
  // one statement is already atomic; asking for a transaction too made overlapping saves fail on the phone
  if (conn) await conn.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', ['state', json], false);
  else localStorage.setItem(LS_KEY, json);
}

let queue = Promise.resolve();
let onSaveError = null;
export const setSaveErrorHandler = (fn) => { onSaveError = fn; };

// Saves run strictly one after another and always write the latest state. A failed write is retried
// before the user hears about it. This never rejects, so a screen always redraws after a change.
export function save() {
  queue = queue.then(async () => {
    let error;
    for (let i = 0; i < 4; i++) {
      try { await writeOnce(); return; } catch (e) { error = e; await new Promise((r) => setTimeout(r, 120 * (i + 1))); }
    }
    if (onSaveError) onSaveError(error);
  });
  return queue;
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
  s.commitments = list(s.commitments).map((c) => ({ ...c, id: str(c.id), name: str(c.name), amount: num(c.amount), inst: list(c.inst).filter((i) => day(i.date)).map((i) => ({ id: str(i.id), date: day(i.date), amount: num(i.amount) })), total: num(c.total), paidBefore: num(c.paidBefore), paidOn: c.paidOn && typeof c.paidOn === 'object' ? c.paidOn : {}, dueDay: Math.min(31, Math.max(1, num(c.dueDay) || 1)), paid: c.paid && typeof c.paid === 'object' ? c.paid : {} }));
  const sipOf = (x) => (x && typeof x === 'object' && /^\d{4}-\d{2}$/.test(str(x.start)) ? { amount: num(x.amount), day: Math.min(31, Math.max(1, num(x.day) || 1)), start: x.start, on: x.on !== false, done: x.done && typeof x.done === 'object' ? x.done : {} } : null);
  s.investments = list(s.investments).map((i) => ({ ...i, id: str(i.id), name: str(i.name), type: str(i.type), returnPct: i.returnPct === null || i.returnPct === undefined || i.returnPct === '' ? null : num(i.returnPct), sip: sipOf(i.sip), value: i.value === null || i.value === undefined || i.value === '' ? null : num(i.value), entries: list(i.entries).map((e) => ({ ...e, amount: num(e.amount), date: day(e.date) || '1970-01-01' })) }));
  s.lent = list(s.lent).map((l) => ({ ...l, id: str(l.id), person: str(l.person), amount: num(l.amount), note: str(l.note), date: day(l.date) || '1970-01-01', due: day(l.due), returns: list(l.returns).map((r) => ({ ...r, amount: num(r.amount) })) }));
  s.goals = list(s.goals).filter((g) => day(g.start) && day(g.end)).map((g) => ({ ...g, id: str(g.id), title: str(g.title), why: str(g.why), unit: str(g.unit), target: num(g.target), from: num(g.from), progress: list(g.progress).map((e) => ({ ...e, amount: num(e.amount) })) }));
  s.bucket = list(s.bucket).map((b) => ({ ...b, id: str(b.id), title: str(b.title), cat: str(b.cat), note: str(b.note), cost: num(b.cost), deadline: day(b.deadline), moves: list(b.moves) }));
  s.inbox = list(s.inbox).map((p) => ({ ...p, amount: num(p.amount), payee: str(p.payee), note: str(p.note), category: str(p.category) }));
  s.people = Array.isArray(s.people) ? s.people.map(str).filter(Boolean) : [];
  // screen time: only well-formed days, numbers forced to numbers, limits with real package names and times
  const hhmm = (v) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : '');
  const days = {};
  Object.entries(s.screen && s.screen.days && typeof s.screen.days === 'object' ? s.screen.days : {}).forEach(([k, v]) => {
    if (!day(k) || !v || typeof v !== 'object') return;
    const apps = {};
    Object.entries(v.a && typeof v.a === 'object' ? v.a : {}).forEach(([p, m]) => { if (/^[\w.]{1,160}$/.test(p) && num(m) > 0) apps[p] = num(m); });
    days[k] = { t: num(v.t), p: num(v.p), h: Array.from({ length: 24 }, (_, i) => num(Array.isArray(v.h) ? v.h[i] : 0)), a: apps };
    const sl = cleanSl(v.sl);
    if (sl) days[k].sl = sl;
  });
  const names = {};
  Object.entries(s.screen && s.screen.names && typeof s.screen.names === 'object' ? s.screen.names : {}).forEach(([p, n]) => { if (/^[\w.]{1,160}$/.test(p)) names[p] = str(n).slice(0, 60); });
  s.screen = { days, names };
  const pkgOk = (p) => /^[\w.]{1,160}$/.test(p);
  const taperOf = (t, min) => (t && typeof t === 'object' && num(t.step) >= 1 && num(t.step) <= 120 && num(t.floor) >= 5 && num(t.floor) < min && num(t.from) > 0 ? { step: Math.round(num(t.step)), floor: Math.round(num(t.floor)), from: num(t.from) } : null);
  const limitOf = (l) => {
    const min = Math.max(0, Math.round(num(l.min)));
    return { id: str(l.id), name: str(l.name).slice(0, 40), pkgs: (Array.isArray(l.pkgs) ? l.pkgs : []).map(str).filter(pkgOk), min, night: l.night && hhmm(l.night.from) && hhmm(l.night.to) ? { from: l.night.from, to: l.night.to } : null, taper: taperOf(l.taper, min), on: l.on !== false, created: num(l.created), lockUntil: num(l.lockUntil) };
  };
  s.limits = list(s.limits).map(limitOf).filter((l) => l.id && l.pkgs.length);
  // the phone keeps the real promises; this copy is only what the screen shows until the phone answers
  const sl = s.sleepLock;
  s.sleepLock = sl && typeof sl === 'object' && hhmm(sl.from) && hhmm(sl.to) ? { on: sl.on !== false, from: sl.from, to: sl.to, cats: (Array.isArray(sl.cats) ? sl.cats : []).map(str).filter((c) => ['social', 'video', 'game', 'music'].includes(c)), extra: (Array.isArray(sl.extra) ? sl.extra : []).map(str).filter(pkgOk), message: str(sl.message).slice(0, 120), created: num(sl.created), lockUntil: num(sl.lockUntil) } : null;
  // focus: the running session (never longer than the 4 hour cap from now) and the log of finished ones
  const fo = s.focus && typeof s.focus === 'object' ? s.focus : {};
  const fa = fo.active && typeof fo.active === 'object' ? fo.active : null;
  const mediaOk = (c) => ['social', 'video', 'game', 'music'].includes(c);
  s.focus = {
    active: fa && num(fa.start) > 0 && num(fa.until) > num(fa.start) && num(fa.until) <= Date.now() + (FOCUS_MAX + 1) * 60000
      ? { start: num(fa.start), until: num(fa.until), label: str(fa.label).slice(0, 40), cats: (Array.isArray(fa.cats) ? fa.cats : []).map(str).filter(mediaOk), extra: (Array.isArray(fa.extra) ? fa.extra : []).map(str).filter(pkgOk) }
      : null,
    log: list(fo.log).filter((e) => num(e.s) > 0 && num(e.m) > 0).map((e) => ({ s: num(e.s), e: num(e.e), m: Math.round(num(e.m)), l: str(e.l).slice(0, 40) })).slice(-300),
  };
  const seen = {};
  Object.entries(s.settings.streakSeen && typeof s.settings.streakSeen === 'object' ? s.settings.streakSeen : {}).forEach(([k, v]) => { if (/^[\w-]{1,64}$/.test(k) && num(v) > 0) seen[k] = Math.round(num(v)); });
  s.settings.streakSeen = seen;
  const att = {};
  Object.entries(s.attendance && typeof s.attendance === 'object' ? s.attendance : {}).forEach(([k, v]) => { if (day(k) && v && ['P', 'H', 'L', 'O', 'A'].includes(v.s)) att[k] = { s: v.s }; });
  s.attendance = att;
  const budgets = {};
  Object.entries(s.budgets && typeof s.budgets === 'object' ? s.budgets : {}).forEach(([k, v]) => { if (num(v) > 0) budgets[str(k)] = num(v); });
  s.budgets = budgets;
  ['salary', 'salaryDay', 'salaryAmount', 'openingBalance', 'planLead', 'lastBackup'].forEach((k) => { s.settings[k] = num(s.settings[k]); });
  s.settings.haptics = s.settings.haptics !== false;
  s.settings.hideBalance = !!s.settings.hideBalance;
  if (!s.settings.salaryDay) s.settings.salaryDay = 11;
  if (!s.settings.planLead) s.settings.planLead = 30;
  s.settings.name = str(s.settings.name).slice(0, 30);
  return s;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
