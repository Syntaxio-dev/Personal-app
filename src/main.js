import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Chart from 'chart.js/auto';
import * as db from './db.js';
import pkg from '../package.json';
import logoUrl from './assets/logo.png';
import * as att from './attendance.js';
import * as money from './money.js';
import { createMoney } from './moneyui.js';
import * as G from './goals.js';
import { createGoals } from './goalsui.js';
import { pad, dateStr, today, addDays, daysBetween, dayName, dayLabel, fmtTime } from './dates.js';
import { syncNotifications, initNotifications, planTime, exactAlarmsAllowed, openExactAlarmSettings, NAG_SLOTS, setNativePlan, setSyncHook } from './notify.js';

const CATEGORIES = ['Food', 'Groceries', 'Petrol', 'Vehicle', 'Travel', 'Bills', 'Rent', 'Shopping', 'Health', 'Fun', 'Family', 'Friends', 'Loan EMI', 'Repayment', 'Other'];
const STATUS = { P: 'Present', A: 'Absent', H: 'Half-day', L: 'Leave', O: 'Holiday' };
// Absent is grey on purpose: grey reads as inactivity, red as an alarm
const STATUS_COLOR = { P: '#4ade80', A: '#8b8b95', H: '#fbbf24', L: '#818cf8', O: '#a78bfa' };
const GRAN = { day: 'Day', week: 'Week', month: 'Month' };
const PRI_COLOR = { high: '#f87171', med: '#fbbf24', low: '#818cf8' };
const PRI_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
const TIME_PRESETS = [['06:00', '6 AM'], ['08:00', '8 AM'], ['10:00', '10 AM'], ['13:00', '1 PM'], ['17:00', '5 PM'], ['20:00', '8 PM'], ['21:00', '9 PM'], ['22:00', '10 PM']];
const SLEEP_PRESETS = [['21:00', '9 PM'], ['22:00', '10 PM'], ['22:30', '10:30 PM'], ['23:00', '11 PM'], ['23:30', '11:30 PM'], ['00:00', '12 AM'], ['01:00', '1 AM'], ['02:00', '2 AM']];

const PaymentCapture = registerPlugin('PaymentCapture');

const ICON = {
  home: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  expense: '<path d="M7 17L17 7M9 7h8v8"/>',
  income: '<path d="M17 7L7 17M15 17H7V9"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  att: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  rep: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const APP_VERSION = pkg.version.split('.').slice(0, 2).join('.');
const TAB_ORDER = ['home', 'money', 'att', 'todo', 'goals'];
const TABS = [['home', 'Dashboard'], ['money', 'Money'], ['att', 'Attendance'], ['todo', 'Tasks'], ['goals', 'Goals']];
const DASH_WIDGETS = {
  wallet: { name: 'Wallet', desc: 'Balance and safe to spend' },
  quick: { name: 'Shortcuts', desc: 'Add an expense, income or task' },
  tasks: { name: 'Tasks for today', desc: 'What is left for today, tick them here' },
  goals: { name: 'Goals', desc: 'Your goals for this period, update them here' },
  attendance: { name: 'Attendance', desc: 'Mark today and see the month' },
  bills: { name: 'Bills due', desc: 'Appears only when something is due soon' },
  bucket: { name: 'Bucket list', desc: 'Your dream of the month and how many are done' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

let tab = 'home';
let ym = today().slice(0, 7);
let todoFilter = 'pending';
let draft = { date: '', time: '', pri: 'med', goalId: '' };
let charts = [];
let attScope = 'month';
const attGran = { score: 'week', hist: 'week' };
let capture = { notif: false, overlay: false, battery: false, notifs: false, known: false };

Chart.defaults.color = 'rgba(255,255,255,0.5)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.animation = { duration: 900, easing: 'easeOutQuart' };

const monthLabel = (s) => new Date(s + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shiftMonth = (s, d) => { const [y, m] = s.split('-').map(Number); return dateStr(new Date(y, m - 1 + d, 1)).slice(0, 7); };

// ---------- calculations ----------
function monthMoney(m) {
  const st = money.monthStats(db.get(), m);
  return { ...st, balance: money.wallet(db.get()) };
}

const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };

function monthAtt(m) {
  return att.rangeStats(att.attCtx(db.get()), `${m}-01`, `${m}-${pad(lastDay(m))}`);
}

// ---------- helpers ----------
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showLayer(el) { el.classList.remove('closing'); el.hidden = false; }
function hideLayer(el) {
  if (el.hidden) return;
  if (reduceMotion()) { el.hidden = true; return; }
  el.classList.add('closing');
  setTimeout(() => { if (el.classList.contains('closing')) { el.hidden = true; el.classList.remove('closing'); } }, 210);
}

let modalLocked = false;

// opts.locked: the sheet cannot be dismissed and nothing else may replace it (the mandatory goal review)
function openModal(html, opts = {}) {
  if (modalLocked && !opts.locked) return;
  const m = $('modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  showLayer(m);
  modalLocked = !!opts.locked;
  m.onclick = opts.locked ? null : (e) => { if (e.target === m) closeModal(); };
}
const closeModal = (force) => {
  if (modalLocked && force !== true) return;
  modalLocked = false;
  hideLayer($('modal'));
};

// Themed replacement for alert/confirm/prompt. Lives in its own layer so it never wipes an open form.
function dialog({ title, message = '', input = null, ok = 'OK', cancel = null, danger = false }) {
  return new Promise((resolve) => {
    const el = $('dialog');
    const body = message ? `<p class="sec">${esc(message).replace(/\n/g, '<br>')}</p>` : '';
    const field = input ? `<input id="d-in" type="${input.type}" inputmode="${input.type === 'number' ? 'decimal' : 'text'}" value="${esc(input.value)}" placeholder="${esc(input.placeholder || '')}">` : '';
    const btns = `${cancel ? `<button class="btn alt" data-d="0">${esc(cancel)}</button>` : ''}<button class="btn ${danger ? 'danger' : ''}" data-d="1">${esc(ok)}</button>`;
    el.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2>${body}${field}<div class="${cancel ? 'grid2' : ''}">${btns}</div></div>`;
    showLayer(el);
    const finish = (yes) => {
      const value = input ? (yes ? $('d-in').value : null) : yes;
      el.onclick = null;
      hideLayer(el);
      resolve(value);
    };
    el.onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (b) finish(b.dataset.d === '1');
      else if (e.target === el && cancel) finish(false);
    };
    if (input) setTimeout(() => $('d-in') && $('d-in').focus(), 60);
  });
}
const ui = {
  alert: (message, title = 'Heads up') => dialog({ title, message }),
  confirm: (message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) => dialog({ title, message, ok, cancel: 'Cancel', danger }),
  prompt: (title, value = '', placeholder = '') => dialog({ title, input: { type: 'number', value, placeholder }, ok: 'Save', cancel: 'Cancel' }),
  text: (title, value = '', placeholder = '') => dialog({ title, input: { type: 'text', value, placeholder }, ok: 'Add', cancel: 'Cancel' }),
};
const toast = (msg) => ui.alert(msg);

async function ensureExactAlarms() {
  if (await exactAlarmsAllowed()) return;
  const go = await ui.confirm('Android needs one more switch so reminders fire exactly on time. Turn on "Alarms & reminders" for Prysm.', { title: 'Exact reminders', ok: 'Open settings' });
  if (go) await openExactAlarmSettings();
}

// Themed explainer first, then the system prompt. Asks about exact alarms once.
async function ensureNotifPermission(reason) {
  if (!Capacitor.isNativePlatform()) return false;
  let ok = (await LocalNotifications.checkPermissions()).display === 'granted';
  if (!ok) {
    if (!(await ui.confirm(reason, { title: 'Allow notifications', ok: 'Continue' }))) return false;
    ok = (await LocalNotifications.requestPermissions()).display === 'granted';
  }
  const st = db.get().settings;
  if (ok && !st.askedExact) {
    st.askedExact = true;
    await db.save();
    await ensureExactAlarms();
  }
  return ok;
}
const APP_NAMES = { 'com.phonepe.app': 'PhonePe', 'com.google.android.apps.nbu.paisa.user': 'Google Pay', 'net.one97.paytm': 'Paytm', 'in.org.npci.upiapp': 'BHIM', 'com.dreamplug.androidapp': 'CRED', prysm: 'Prysm' };
const appName = (pkg) => APP_NAMES[pkg] || (/mms|messag/i.test(pkg) ? 'SMS' : String(pkg).split('.').pop());
const dot = (color) => `<span class="dot" style="color:${color}"></span>`;

// the widgets on the home screen are redrawn shortly after every change
let widgetTimer = 0;
function queueWidgets() {
  if (!Capacitor.isNativePlatform()) return;
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(() => { PaymentCapture.setWidgetData({ json: JSON.stringify(widgetData()) }).catch(() => {}); }, 500);
}

async function commit() { await db.save(); render(); queueWidgets(); }

const monthPicker = () => `<div class="month">
  <button class="icon" data-act="prev">${svg('prev')}</button><b>${monthLabel(ym)}</b><button class="icon" data-act="next">${svg('next')}</button></div>`;

// ---------- payment capture ----------
// Setup progress for payment capture. Hidden on the web, before the first check, and once all four are on.
function dueBanner() {
  const s = db.get();
  const n = G.dueGoals(s).length + G.overdueDreams(s).length;
  return n ? `<div class="card dcard attn"><div class="dhead"><h2>Waiting for your answer</h2><span class="bad">${n}</span></div><div class="muted" style="margin-bottom:14px">Your goals need an honest answer before you move on.</div><button class="btn sm" data-act="rvOpen">Answer now</button></div>` : '';
}

function captureBanner() {
  const S = db.get();
  const waiting = S.inbox.length;
  const review = waiting ? `<div class="card dcard"><div class="dhead"><h2>Payments to review</h2><span class="warn">${waiting}</span></div><button class="btn sm" data-act="reviewInbox">Review ${waiting} payment${waiting > 1 ? 's' : ''}</button></div>` : '';
  let setup = '';
  if (Capacitor.isNativePlatform() && capture.known) {
    const steps = [capture.notif, capture.overlay, capture.notifs, capture.battery];
    const n = steps.filter(Boolean).length;
    if (n < steps.length) {
      setup = `<div class="card dcard"><div class="dhead"><h2>Payment capture</h2><span class="warn">${n} of ${steps.length} on</span></div>
        <div class="steps">${steps.map((ok) => `<i class="${ok ? 'on' : ''}"></i>`).join('')}</div>
        <div class="muted" style="margin:12px 0 16px">Turn on the remaining permissions so payment popups never miss.</div>
        <button class="btn alt sm" data-act="enableCapture">Finish setup</button></div>`;
    }
  }
  return setup + review;
}

async function refreshCapture() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    capture.notif = (await PaymentCapture.isEnabled()).enabled;
    capture.overlay = (await PaymentCapture.hasOverlay()).enabled;
    capture.battery = (await PaymentCapture.isIgnoringBattery()).enabled;
    capture.notifs = (await LocalNotifications.checkPermissions()).display === 'granted';
  } catch (e) { /* plugin missing: leave as off */ }
  capture.known = true;
}

// Pull payments seen by the native service; confirmed ones are stored, the rest wait in the inbox.
async function syncPayments() {
  if (!Capacitor.isNativePlatform()) return;
  await refreshCapture();
  try {
    const { items } = await PaymentCapture.takePending();
    const S = db.get();
    (items || []).forEach((p) => {
      if (p.status === 'saved') S.transactions.push({ id: db.uid(), type: 'expense', amount: p.amount, category: p.category || 'Other', note: p.note || '', mode: p.mode === 'cash' ? 'cash' : 'online', date: p.date || today() });
      else S.inbox.push(p);
    });
    if (items && items.length) await db.save();
  } catch (e) { /* ignore */ }
  try {
    const { items } = await PaymentCapture.takeConfirms();
    let changed = false;
    (items || []).forEach((a) => { if (moneyUi.applyConfirm(a.key, a.answer)) changed = true; });
    if (changed) { await db.save(); syncNotifications(); }
  } catch (e) { /* older native build */ }
  let openPlan = false;
  let launch = '';
  try {
    const planned = await PaymentCapture.takePlanned();
    const S = db.get();
    (planned.items || []).forEach((p) => {
      if (!p.title) return;
      S.todos.push({ id: db.uid(), title: String(p.title).slice(0, 200), date: p.date || addDays(today(), 1), time: '', pri: ['high', 'med', 'low'].includes(p.pri) ? p.pri : 'med', done: false, doneAt: 0, goalId: '' });
    });
    if (planned.items && planned.items.length) { await db.save(); syncNotifications(); }
    openPlan = !!planned.openPlan;
    launch = planned.launch || '';
  } catch (e) { /* older native build */ }
  render();
  if (launch && launch !== 'plan' && $('modal').hidden) runLaunch(launch);
  else if (openPlan && $('modal').hidden) showPlan();
  else if (db.get().inbox.length && $('modal').hidden) showInboxItem();
  else moneyUi.askSips();
}

// a home screen widget button or notification asked Prysm to open straight into something
function runLaunch(what) {
  if (what === 'expense') { go('money'); moneyUi.setTab('overview'); moneyUi.actions.addExpense(); } else if (what === 'income') { go('money'); moneyUi.setTab('overview'); moneyUi.actions.addIncome(); } else if (what === 'task') { go('todo'); addTodoForm(); } else if (what === 'attendance') { go('att'); markDayForm(today()); } else if (what.startsWith('tab:')) go(what.slice(4));
}

// the native plan popup needs the time, the name and what is already planned for tomorrow
async function pushPlan() {
  const S = db.get(), st = S.settings;
  const { hour, minute } = planTime(st);
  const date = addDays(today(), 1);
  const titles = S.todos.filter((x) => x.date === date && !x.done).map((x) => x.title).slice(0, 30);
  await PaymentCapture.setPlan({ on: !!st.planOn, hour, minute, name: st.name || '', date, titles });
  await PaymentCapture.setConfirms({ items: moneyUi.confirmItems() });
  await PaymentCapture.setWidgetData({ json: JSON.stringify(widgetData()) });
}

// the numbers the home screen widgets show (they cannot run the app, so a snapshot is saved on every change)
function widgetData() {
  const S = db.get(), t = today();
  const c = att.attCtx(S);
  const month = att.rangeStats(c, `${t.slice(0, 7)}-01`, t);
  const streak = att.streaks(c).cur;
  const marked = S.attendance[t] && S.attendance[t].s !== 'A';
  const left = S.todos.filter((x) => !x.done && x.date <= t);
  const days = Array.from({ length: 14 }, (_, i) => att.dayKind(c, addDays(t, i - 13)));
  const sp = money.safeToSpend(S);
  return {
    wallet: inr(sp.wallet),
    att: { pct: month.pct === null ? '—' : month.pct + '%', sub: `This month${streak ? ' · ' + streak + '-day streak' : ''}`, today: marked ? STATUS[S.attendance[t].s] : 'not marked', days },
    tasks: { left: left.length, items: left.slice(0, 3).map((x) => x.title) },
  };
}

function showInboxItem() {
  const p = db.get().inbox[0];
  if (!p) return;
  const more = db.get().inbox.length - 1;
  openModal(`<h2>Payment detected</h2>
    <div class="label">Amount ₹</div><input id="f-amt" type="number" inputmode="decimal" value="${p.amount}">
    <div class="label">Category</div><select id="f-cat">${CATEGORIES.map((c) => `<option ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <div class="label">Note</div><input id="f-note" value="${esc(p.note || p.payee || '')}" placeholder="Note (optional)">
    <div class="label">Also paid in cash ₹ (optional)</div><input id="f-cash" type="number" inputmode="decimal" placeholder="0">
    <div class="grid2"><button class="btn alt" data-act="skipInbox">Skip</button><button class="btn" data-act="saveInbox">Save expense</button></div>
    ${more ? `<div class="muted" style="margin-top:12px;text-align:center">${more} more waiting</div>` : ''}`);
}

function dashWidget(id) {
  const S = db.get(), t = today();
  if (id === 'wallet') {
    const sp = money.safeToSpend(S);
    return `<div class="hero" data-act="goto" data-tab="money"><div class="label">Wallet balance</div><div class="num" data-count="${sp.wallet}">${inr(sp.wallet)}</div><div class="sub">Safe to spend ${inr(sp.safe)}</div></div>`;
  }
  if (id === 'quick') {
    return `<div class="quick"><button data-act="addExpense">${svg('expense')}<span>Expense</span></button><button data-act="addIncome">${svg('income')}<span>Income</span></button><button data-act="addTodo">${svg('plus')}<span>Task</span></button></div>`;
  }
  if (id === 'tasks') {
    const rank = { high: 0, med: 1, low: 2 };
    const pending = S.todos.filter((x) => !x.done && x.date <= t).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || rank[a.pri] - rank[b.pri]);
    const doneToday = S.todos.filter((x) => x.done && x.doneAt && dateStr(new Date(x.doneAt)) === t).length;
    const overdue = pending.filter((x) => x.date < t).length;
    const rows = pending.slice(0, 4).map((x) => `<div class="drow"><button class="check" data-act="toggleTodo" data-id="${x.id}" aria-label="Complete task">${svg('check')}</button>
      <div class="grow"><div class="t-title">${esc(x.title)}</div><div class="t-meta">${x.time ? `<span class="capsule mini set">${svg('clock')}${fmtTime(x.time)}</span>` : ''}${x.date < t ? '<span class="ptag late">Overdue</span>' : `<span class="ptag">${dot(PRI_COLOR[x.pri])}${PRI_LABEL[x.pri]}</span>`}</div></div></div>`).join('');
    const empty = `<div class="dempty">${doneToday ? 'All done for today. Nice work.' : 'Nothing planned for today.'}</div>`;
    return `<div class="card dcard"><div class="dhead"><h2>Today</h2><button class="link" data-act="goto" data-tab="todo">See all</button></div>
      ${pending.length ? rows : empty}${pending.length > 4 ? `<div class="muted dmore">+${pending.length - 4} more</div>` : ''}
      <div class="dfoot muted">${doneToday} done today${overdue ? ` · ${overdue} overdue` : ''}</div></div>`;
  }
  if (id === 'attendance') {
    const c = att.attCtx(S);
    const e = S.attendance[t];
    const marked = e && e.s !== 'A';
    const st = att.rangeStats(c, `${t.slice(0, 7)}-01`, t);
    const sk = att.streaks(c);
    return `<div class="card dcard"><div class="dhead"><h2>Attendance</h2><button class="link" data-act="goto" data-tab="att">Open</button></div>
      <div class="drow2"><div class="dstate">${marked ? dot(STATUS_COLOR[e.s]) + STATUS[e.s] : '<span class="muted">Not marked yet</span>'}</div><button class="btn alt sm" data-act="markToday">${marked ? 'Change' : 'Mark today'}</button></div>
      <div class="dfoot muted">${st.pct === null ? 'No data this month yet' : `${st.pct}% this month`}${sk.cur ? ` · ${sk.cur}-day streak` : ''}</div></div>`;
  }
  if (id === 'bills') {
    const soon = [...money.billsFor(S, t.slice(0, 7), t), ...money.owedFor(S, t)].filter((b) => !b.paid && (b.late > 0 || b.due <= addDays(t, 7))).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
    if (!soon.length) return '';
    return `<div class="card dcard"><div class="dhead"><h2>Bills due</h2><button class="link" data-act="goBills">All bills</button></div>
      ${soon.map((b) => `<div class="drow"><div class="grow"><div class="t-title">${esc(b.c.name)}</div><div class="t-meta">${b.late ? `<span class="ptag late">${b.late} day${b.late === 1 ? '' : 's'} late</span>` : `Due ${dayName(b.due)}`}</div></div><b>${inr(b.c.amount)}</b><button class="pill" data-act="payBill" data-id="${b.c.id}">Pay</button></div>`).join('')}</div>`;
  }
  if (id === 'goals' || id === 'bucket') return goalsUi.widget(id);
  return '';
}

// update the open sheet in place (no slide-up replay), or open it
function fillSheet(html) {
  const sheet = document.querySelector('#modal .sheet');
  if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
}

function dashSheet() {
  const st = db.get().settings;
  const last = st.dashOrder.length - 1;
  const rows = st.dashOrder.map((id, i) => `<div class="set-row"><div class="mv"><button class="icon" data-act="dashMove" data-id="${id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${svg('up')}</button><button class="icon" data-act="dashMove" data-id="${id}" data-d="1" ${i === last ? 'disabled' : ''} aria-label="Move down">${svg('down')}</button></div>
    <div class="grow"><b>${DASH_WIDGETS[id].name}</b><span>${DASH_WIDGETS[id].desc}</span></div>
    <button class="switch ${st.dashHidden.includes(id) ? '' : 'on'}" role="switch" aria-checked="${!st.dashHidden.includes(id)}" aria-label="${DASH_WIDGETS[id].name}" data-act="dashToggle" data-id="${id}"><i></i></button></div>`).join('');
  fillSheet(`<h2>Customize dashboard</h2><div class="muted" style="margin:-8px 0 14px">Choose what shows here and in which order.</div>${rows}<button class="btn" style="margin-top:18px" data-act="closeModal">Done</button>`);
}

const ord = (n) => n + ['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10];

const moneyUi = createMoney({
  ui, openModal, closeModal, commit, render: (a) => render(a), esc, inr, svg, dot, monthPicker, getYm: () => ym,
  syncNotifications: () => syncNotifications(), showLayer, hideLayer, categories: CATEGORIES,
});

const goalsUi = createGoals({
  ui, openModal, closeModal, commit, render: (a) => render(a), esc, svg, dot,
  syncNotifications: () => syncNotifications(), openTaskForm: (o) => addTodoForm(o),
});

// ---------- views ----------
const views = {
  home() {
    const st = db.get().settings;
    const widgets = st.dashOrder.filter((id) => !st.dashHidden.includes(id)).map(dashWidget).join('');
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `<div class="greet">${hello}${st.name ? ', ' + esc(st.name) : ''}</div>${dueBanner()}${captureBanner()}${widgets || '<div class="empty"><b>Your dashboard is empty</b><span>Tap Customize below to choose what you want to see here.</span></div>'}<button class="link center" data-act="dashEdit">Customize dashboard</button>`;
  },

  money() { return moneyUi.view(); },

  goals() { return goalsUi.view(); },

  att() {
    const S = db.get();
    const c = att.attCtx(S);
    const [y, mo] = ym.split('-').map(Number);
    const first = new Date(y, mo - 1, 1).getDay();
    const days = lastDay(ym);
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="h">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const ds = `${ym}-${pad(d)}`;
      const k = att.dayKind(c, ds);
      cells += `<div class="d st-${k} ${ds === c.t ? 'today' : ''}" data-act="markDay" data-date="${ds}">${d}${'PHLOA'.includes(k) ? '<i></i>' : ''}</div>`;
    }
    const legend = Object.entries(STATUS).map(([k, l]) => `<span>${dot(STATUS_COLOR[k])}${l}</span>`).join('');

    const month = attScope === 'month';
    const st = month ? att.rangeStats(c, `${ym}-01`, `${ym}-${pad(days)}`) : att.rangeStats(c, c.start, c.t);
    const sub = month ? monthLabel(ym) : `Since ${dayName(c.start)}`;
    const sk = att.streaks(c);
    const seg = (k, l) => `<button class="${attScope === k ? 'on' : ''}" data-act="attScope" data-v="${k}">${l}</button>`;
    const stat = (k, n) => `<div>${dot(STATUS_COLOR[k])} ${STATUS[k]} <b>${n}</b></div>`;
    const score = att.scoreSeries(c);
    const now = score.length ? Math.round(score[score.length - 1] * 100) : null;
    const dd = (k) => `<div class="dd"><button class="dd-btn" data-act="ddOpen">${GRAN[attGran[k]]}${svg('down')}</button>
      <div class="menu" hidden>${Object.entries(GRAN).map(([v, l]) => `<button class="${attGran[k] === v ? 'on' : ''}" data-act="ddPick" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div></div>`;

    return `${monthPicker()}
      <div class="card"><div class="cal">${cells}</div><div class="legend">${legend}</div>
        <div class="muted" style="margin-top:12px">Unmarked days count as absent. Tap a day to mark it.</div></div>
      <div class="card"><div class="row between"><h2 style="margin:0">Summary</h2><div class="seg">${seg('month', 'Month')}${seg('overall', 'Overall')}</div></div>
        <div class="att-hero"><div class="num">${st.pct === null ? '—' : st.pct + '%'}</div><div class="muted">attendance · ${esc(sub)}</div></div>
        <div class="bar"><div style="width:${st.pct || 0}%"></div></div>
        <div class="grid2 sec att-grid">${stat('P', st.P)}${stat('A', st.A)}${stat('H', st.H)}${stat('L', st.L)}${stat('O', st.O)}<div>Worked <b style="color:#fff">${st.worked} / ${st.counted}</b></div></div>
        <div class="streak-row"><div><span class="label">Current streak</span><b>${sk.cur} day${sk.cur === 1 ? '' : 's'}</b></div><div><span class="label">Best streak</span><b>${sk.best} day${sk.best === 1 ? '' : 's'}</b></div></div></div>
      <div class="card chart-card"><div class="row between"><div><h2 style="margin:0">Score</h2><div class="muted" style="margin-top:4px">${now === null ? 'No data yet' : now + '% right now'}</div></div>${dd('score')}</div><div class="chart-box"><canvas id="a-score"></canvas></div></div>
      <div class="card chart-card"><div class="row between"><div><h2 style="margin:0">History</h2><div class="muted" style="margin-top:4px">Days worked per ${GRAN[attGran.hist].toLowerCase()}</div></div>${dd('hist')}</div><div class="chart-box"><canvas id="a-hist"></canvas></div></div>`;
  },

  todo() {
    const S = db.get();
    const t = today();
    const pending = S.todos.filter((x) => !x.done);
    const upToToday = pending.filter((x) => x.date <= t);
    const overdue = pending.filter((x) => x.date < t);
    const urgent = pending.filter((x) => daysBetween(x.date, t) >= 2).length;
    const chip = (k, l, n) => `<button class="${todoFilter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}${n ? `<i>${n}</i>` : ''}</button>`;
    const top = `<div class="grid2 top-actions"><button class="btn" data-act="addTodo">+ New task</button><button class="btn alt" data-act="planTomorrow">Plan tomorrow</button></div>`;
    const banner = overdue.length && todoFilter !== 'done'
      ? `<div class="banner ${urgent ? 'urgent' : ''}">${dot(urgent ? '#f87171' : '#fbbf24')}<div><b>${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}</b><span>${urgent ? `${urgent} urgent: you get ${NAG_SLOTS.length} alerts a day until they are done.` : 'One miss is a mistake. Clear it today.'}</span></div></div>`
      : '';
    const chips = `<div class="chips subtabs scroll">${chip('pending', 'Pending', pending.length)}${chip('today', 'Today', upToToday.length)}${chip('done', 'Completed')}${chip('report', 'Report')}</div>`;
    if (todoFilter === 'report') return chips + taskReport(S);
    const body = todoFilter === 'done' ? doneList(S) : pendingList(todoFilter === 'today' ? upToToday : pending, t);
    return top + banner + chips + body;
  },

  settings() {
    const st = db.get().settings;
    const pt = planTime(st);
    const row = (label, sub, key) => `<div class="set-row"><div class="grow"><b>${label}</b><span>${sub}</span></div><button class="switch ${st[key] ? 'on' : ''}" role="switch" aria-checked="${!!st[key]}" aria-label="${label}" data-act="toggleSet" data-k="${key}"><i></i></button></div>`;
    const stat = (ok, label) => `<div class="stat-row">${dot(ok ? '#4ade80' : '#f87171')}<span>${label}</span><b class="${ok ? 'good' : 'bad'}">${ok ? 'On' : 'Off'}</b></div>`;
    const native = Capacitor.isNativePlatform();
    const capture_ = native
      ? `<div class="card"><h2>Payment capture</h2>
          ${stat(capture.notif, 'Notification access')}${stat(capture.overlay, 'Display over other apps')}${stat(capture.notifs, 'Notifications allowed')}${stat(capture.battery, 'Battery unrestricted')}
          <div style="margin-top:8px">${row('Keep Prysm running', 'Needed on iQOO, Vivo, Xiaomi and Oppo, or popups stop working', 'keepAlive')}</div>
          <button class="btn" style="margin-top:14px" data-act="enableCapture">Fix / set up</button>
          <span class="label" style="margin-top:18px">Test the popups</span>
          <div class="grid2"><button class="btn alt" data-act="capTestNow">Expense now</button><button class="btn alt" data-act="capTest">Over another app</button></div>
          <button class="btn alt" style="margin-top:10px" data-act="capPlanTest">Plan tomorrow popup</button>
          <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="capAppSettings">App settings</button><button class="btn alt" data-act="capLog">Capture log</button></div>
          <div class="muted" style="margin-top:12px;line-height:1.5">If "Expense now" works but the other tests do not, your phone is freezing Prysm in the background. On iQOO / Vivo open App settings and allow <b>Display pop-up windows</b>, <b>Display pop-up windows while running in the background</b> and <b>Autostart</b>, and set Battery to <b>No restrictions</b>.</div></div>`
      : `<div class="card"><h2>Payment capture</h2><div class="sec">Available in the installed Android app.</div></div>`;
    return `
      <div class="card"><h2>Profile</h2><span class="label">Your name</span><input id="s-name" value="${esc(st.name)}" placeholder="What should Prysm call you?" maxlength="30" autocomplete="off" style="margin-bottom:0"></div>
      <div class="card"><h2>Dashboard</h2>
        <div class="set-row"><div class="grow"><b>Customize</b><span>Choose what shows on your dashboard and in which order</span></div><button class="capsule set" style="margin:0" data-act="dashEdit"><span>Edit</span></button></div></div>
      ${Capacitor.isNativePlatform() ? `<div class="card"><h2>Home screen widgets</h2><div class="sec" style="line-height:1.6">Long-press an empty spot on your home screen, tap <b>Widgets</b>, then pick <b>Prysm</b>:<br>• <b>Quick add</b>: expense, income, task, attendance<br>• <b>Today</b>: tasks left and your wallet<br>• <b>Attendance</b>: percentage and a 14-day graph</div></div>` : ''}
      <div class="card"><h2>Night planner</h2>
        ${row('Plan tomorrow', 'A nightly reminder to line up the next day', 'planOn')}
        <span class="label" style="margin-top:16px">I usually sleep at</span>
        <button class="capsule set" data-act="setSleep">${svg('clock')}<span>${fmtTime(st.sleep)}</span></button>
        <span class="label" style="margin-top:16px">Remind me before sleep</span>
        <div class="chips">${[15, 30, 60].map((n) => `<button class="${Number(st.planLead) === n ? 'on' : ''}" data-act="setLead" data-v="${n}">${n} min</button>`).join('')}</div>
        <div class="muted">${st.planOn ? `${Capacitor.isNativePlatform() ? 'A popup opens over any app' : 'Reminder'} at ${fmtTime(`${pad(pt.hour)}:${pad(pt.minute)}`)} every night.` : 'Planner reminder is off.'}</div></div>
      <div class="card"><h2>Notifications</h2>
        ${row('Task reminders', 'Alert at the time you set on a task', 'remindOn')}
        ${row('Overdue alerts', `Tasks pending 2+ days get ${NAG_SLOTS.length} alerts a day`, 'nagOn')}
        ${row('Salary reminder', 'Daily alert if salary is not added after salary day', 'salaryOn')}
        ${row('Bill reminders', 'Day before, on the day, and daily when overdue', 'billOn')}
        ${row('Weekly summary', 'Sunday evening: where your money went', 'weeklyOn')}
        ${row('Backup reminder', 'Saturday evening: export your data', 'backupOn')}
        ${row('Goal check-ins', 'Monday kickoff and a Thursday halfway nudge', 'goalCheckOn')}
        ${row('Dream reminders', 'Deadline countdowns and a monthly dream pick', 'dreamOn')}
        <div class="muted" style="margin-top:12px">Goal reviews cannot be switched off. They are the point.</div></div>
      <div class="card"><h2>Money</h2>
        <div class="set-row"><div class="grow"><b>Salary day</b><span>You are reminded the day after if it is not added</span></div><button class="capsule set" style="margin:0" data-act="setSalaryDay"><span>${ord(Number(st.salaryDay) || 11)}</span></button></div>
        <div class="set-row"><div class="grow"><b>Expected salary</b><span>Pre-fills the Add salary form</span></div><button class="capsule ${st.salaryAmount ? 'set' : ''}" style="margin:0" data-act="setSalaryAmt"><span>${st.salaryAmount ? inr(st.salaryAmount) : 'Not set'}</span></button></div>
        <div class="set-row"><div class="grow"><b>Opening balance</b><span>Money you already have today</span></div><button class="capsule ${st.openingBalance ? 'set' : ''}" style="margin:0" data-act="setOpening"><span>${st.openingBalance ? inr(st.openingBalance) : 'Not set'}</span></button></div></div>
      <div class="card"><h2>Attendance</h2>
        <span class="label">Weekly off</span>
        <div class="chips week">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => `<button class="${(st.weekOff || []).includes(i) ? 'on' : ''}" data-act="toggleOff" data-v="${i}">${l}</button>`).join('')}</div>
        <div class="muted" style="margin:-4px 0 16px">Unmarked weekly-off days are not counted as absent.</div>
        <span class="label">Tracking since</span>
        <input id="s-attstart" type="date" value="${att.trackStart(db.get())}" max="${today()}">
        <div class="muted" style="margin-top:-2px">Days before this date are ignored. Unmarked days after it count as absent.</div></div>
      ${capture_}
      <div class="card"><h2>Backup</h2>
        <div class="grid2"><button class="btn" data-act="export">Export</button><button class="btn alt" data-act="import">Import</button></div>
        <div class="muted" style="margin-top:10px">Your data lives only on this phone. Export a backup now and then.</div></div>
      <div class="card about"><h2>About</h2><div class="about-head"><img class="about-logo" src="${logoUrl}" alt="Prysm logo" width="52" height="52"><div><div class="about-name">Prysm <span>v${APP_VERSION}</span></div><div class="sec">App developed by <b>Ayush</b></div></div></div><div class="muted" style="margin-top:14px">Everything stays on your phone. No account, no server.</div></div>`;
  },

};

const gradient = (x, c1, c2) => {
  const { ctx, chartArea } = x.chart;
  if (!chartArea) return c1;
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  return g;
};

// draws the number above every bar
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v === null || v === undefined) return;
      ctx.save();
      ctx.fillStyle = '#c4b5fd';
      ctx.font = "600 12px 'DM Sans'";
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(v * 10) / 10), bar.x, bar.y - 6);
      ctx.restore();
    });
  },
};

function drawAttCharts() {
  const c = att.attCtx(db.get());
  const scores = att.scoreSeries(c);
  const grid = 'rgba(255,255,255,0.06)';
  const tip = (fmt) => ({ backgroundColor: 'rgba(20,20,20,0.95)', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, bodyColor: '#c4b5fd', displayColors: false, padding: 10, callbacks: { title: () => '', label: (it) => fmt(it.parsed.y) } });
  const xAxis = { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: false, color: 'rgba(255,255,255,0.5)' } };

  const sp = att.periods(attGran.score, c.t);
  charts.push(new Chart($('a-score'), {
    type: 'line',
    data: {
      labels: att.labels(attGran.score, sp),
      datasets: [{
        data: sp.map((p) => (p.to < c.start ? null : att.scoreAt(c, scores, p.to > c.t ? c.t : p.to))),
        borderColor: '#a78bfa', borderWidth: 3, tension: 0.35, fill: true,
        pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#a78bfa', pointBorderColor: '#000', pointBorderWidth: 2,
        backgroundColor: (x) => gradient(x, 'rgba(124,58,237,0.35)', 'rgba(124,58,237,0)'),
      }],
    },
    options: {
      maintainAspectRatio: false,
      animations: { colors: false },
      layout: { padding: { top: 8, right: 8 } },
      plugins: { legend: { display: false }, tooltip: tip((v) => `${v}%`) },
      scales: { y: { min: 0, max: 100, ticks: { stepSize: 20, callback: (v) => v + '%' }, grid: { color: grid }, border: { display: false } }, x: xAxis },
    },
  }));

  const hp = att.periods(attGran.hist, c.t);
  charts.push(new Chart($('a-hist'), {
    type: 'bar',
    data: {
      labels: att.labels(attGran.hist, hp),
      datasets: [{
        data: hp.map((p) => (p.to < c.start || p.from > c.t ? null : att.rangeStats(c, p.from, p.to).worked)),
        borderRadius: 6, borderSkipped: false, barPercentage: 0.55, categoryPercentage: 1,
        backgroundColor: (x) => gradient(x, '#a78bfa', '#6d28d9'),
      }],
    },
    options: {
      maintainAspectRatio: false,
      animations: { colors: false },
      layout: { padding: { top: 22, right: 8 } },
      plugins: { legend: { display: false }, tooltip: tip((v) => `${Math.round(v * 10) / 10} days worked`) },
      scales: { y: { beginAtZero: true, ticks: { display: false }, grid: { color: grid }, border: { display: false } }, x: xAxis },
    },
    plugins: [valueLabels],
  }));
}

function drawMoneyReport() {
  const m = monthMoney(ym);
  const cats = Object.keys(m.byCat);
  const purples = ['#7c3aed', '#a78bfa', '#6d28d9', '#c4b5fd', '#8b5cf6', '#5b21b6', '#ddd6fe', '#4c1d95', '#818cf8', '#c084fc', '#e879f9', '#6366f1', '#a5b4fc', '#d8b4fe'];
  const legend = { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } };
  charts.push(new Chart($('c1'), {
    type: 'doughnut',
    options: { maintainAspectRatio: false, plugins: { legend }, cutout: '62%' },
    data: { labels: cats.length ? cats : ['No data'], datasets: [{ data: cats.length ? cats.map((c) => m.byCat[c]) : [1], backgroundColor: cats.length ? purples : ['rgba(255,255,255,0.08)'], borderWidth: 0 }] },
  }));
  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(ym, d));
  const mm = months.map(monthMoney);
  charts.push(new Chart($('c2'), {
    type: 'bar',
    options: { maintainAspectRatio: false, plugins: { legend }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } } },
    data: { labels: months.map((x) => monthLabel(x).slice(0, 3)), datasets: [{ label: 'Income', data: mm.map((x) => x.income), backgroundColor: '#4ade80', borderRadius: 6 }, { label: 'Expenses', data: mm.map((x) => x.expense), backgroundColor: '#f87171', borderRadius: 6 }] },
  }));
}

function drawJournalChart() {
  const { labels, values } = G.hitSeries(db.get(), goalsUi.getJMode());
  charts.push(new Chart($('j-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, borderRadius: 6, borderSkipped: false, barPercentage: 0.55, categoryPercentage: 1, backgroundColor: (x) => gradient(x, '#a78bfa', '#6d28d9') }] },
    options: {
      maintainAspectRatio: false,
      animations: { colors: false },
      layout: { padding: { top: 22, right: 8 } },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { title: () => '', label: (it) => `${it.parsed.y}% achieved` } } },
      scales: { y: { min: 0, max: 100, ticks: { stepSize: 25, callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', maxRotation: 0, autoSkip: false } } },
    },
    plugins: [valueLabels],
  }));
}

function drawTaskReport() {
  const S = db.get();
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const counts = days.map((d) => S.todos.filter((x) => x.done && x.doneAt && dateStr(new Date(x.doneAt)) === d).length);
  charts.push(new Chart($('t-week'), {
    type: 'bar',
    data: {
      labels: days.map((d) => new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short' })),
      datasets: [{ data: counts, borderRadius: 6, borderSkipped: false, barPercentage: 0.55, categoryPercentage: 1, backgroundColor: (x) => gradient(x, '#a78bfa', '#6d28d9') }],
    },
    options: {
      maintainAspectRatio: false,
      animations: { colors: false },
      layout: { padding: { top: 22, right: 8 } },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { title: () => '', label: (it) => `${it.parsed.y} completed` } } },
      scales: { y: { beginAtZero: true, ticks: { display: false }, grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false } }, x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } } },
    },
    plugins: [valueLabels],
  }));
}

// ---------- forms ----------
// ---------- tasks ----------
const emptyState = (title, text) => `<div class="empty"><div class="empty-ic">${svg('todo')}</div><b>${title}</b><span>${text}</span></div>`;

function goalTag(x) {
  const g = x.goalId && db.get().goals.find((y) => y.id === x.goalId);
  return g ? `<span class="ptag goalref">${svg('goals')}${esc(g.title)}</span>` : '';
}

function taskCard(x, t) {
  const age = daysBetween(x.date, t);
  const tags = [
    x.time ? `<span class="capsule mini set">${svg('clock')}${fmtTime(x.time)}</span>` : '',
    `<span class="ptag">${dot(PRI_COLOR[x.pri])}${PRI_LABEL[x.pri]}</span>`,
    goalTag(x),
    age >= 2 ? `<span class="ptag late">Overdue ${age} days</span>` : age === 1 ? '<span class="ptag warn">Missed yesterday</span>' : '',
  ].join('');
  return `<div class="task ${age >= 2 ? 'urgent' : age === 1 ? 'missed' : ''}" data-id="${x.id}">
    <button class="check" data-act="toggleTodo" data-id="${x.id}" aria-label="Complete task">${svg('check')}</button>
    <div class="grow"><div class="t-title">${esc(x.title)}</div><div class="t-meta">${tags}</div></div>
    <button class="icon" data-act="delTodo" data-id="${x.id}" aria-label="Delete task">${svg('trash')}</button></div>`;
}

function pendingList(list, t) {
  if (!list.length) return emptyState('All clear', 'Nothing pending. Add a task or plan tomorrow.');
  const rank = { high: 0, med: 1, low: 2 };
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || rank[a.pri] - rank[b.pri]);
  const groups = {};
  sorted.forEach((x) => { (groups[x.date] = groups[x.date] || []).push(x); });
  return Object.keys(groups).sort().map((date) => {
    const diff = daysBetween(t, date);
    const tone = diff <= -2 ? 'urgent' : diff === -1 ? 'missed' : '';
    const sub = diff <= -2 ? `${dayName(date)} · ${-diff} days late` : diff === -1 ? `${dayName(date)} · 1 day late` : dayName(date);
    return `<section class="day ${tone}"><div class="day-head"><div><b>${dayLabel(date)}</b><span>${sub}</span></div><i>${groups[date].length}</i></div>${groups[date].map((x) => taskCard(x, t)).join('')}</section>`;
  }).join('');
}

function doneList(S) {
  const list = S.todos.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt);
  if (!list.length) return emptyState('Nothing completed yet', 'Tick a task and it shows up here for 7 days.');
  const groups = {};
  list.forEach((x) => { const d = dateStr(new Date(x.doneAt || Date.now())); (groups[d] = groups[d] || []).push(x); });
  const card = (x) => `<div class="task finished">
    <button class="check on" data-act="toggleTodo" data-id="${x.id}" aria-label="Mark as not done">${svg('check')}</button>
    <div class="grow"><div class="t-title">${esc(x.title)}</div><div class="t-meta"><span class="muted">Done at ${new Date(x.doneAt || Date.now()).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></div></div></div>`;
  return '<div class="muted note">Completed tasks are removed automatically after 7 days.</div>'
    + Object.keys(groups).sort().reverse().map((d) => `<section class="day done"><div class="day-head"><div><b>${dayLabel(d)}</b><span>${dayName(d)}</span></div><i>${groups[d].length}</i></div>${groups[d].map(card).join('')}</section>`).join('');
}

// completed tasks older than 7 days are removed; they are kept as a count so Reports stays correct
function taskReport(S) {
  const t = today();
  const m = t.slice(0, 7);
  const monthTodos = S.todos.filter((x) => x.date.startsWith(m));
  const hist = S.taskHistory[m] || { done: 0, total: 0 };
  const total = monthTodos.length + hist.total;
  const done = monthTodos.filter((x) => x.done).length + hist.done;
  const pct = total ? Math.round((done / total) * 100) : null;
  const overdue = S.todos.filter((x) => !x.done && x.date < t).length;
  return `<div class="card"><div class="label">Completion · ${monthLabel(m)}</div><div class="num" style="margin:8px 0 14px">${pct === null ? '—' : pct + '%'}</div>
      <div class="bar"><div style="width:${pct || 0}%"></div></div>
      <div class="muted" style="margin-top:12px">${done} of ${total} tasks done${overdue ? ` · ${overdue} overdue` : ''}</div></div>
    <div class="card chart-card"><h2>Completed · last 7 days</h2><div class="chart-box"><canvas id="t-week"></canvas></div></div>`;
}

function purgeDone() {
  const S = db.get();
  const cutoff = Date.now() - 7 * 864e5;
  let changed = false;
  S.todos = S.todos.filter((x) => {
    if (!x.done) return true;
    if (!x.doneAt) { x.doneAt = Date.now(); changed = true; return true; }
    if (x.doneAt >= cutoff) return true;
    const k = x.date.slice(0, 7);
    const h = S.taskHistory[k] || (S.taskHistory[k] = { done: 0, total: 0 });
    h.done++; h.total++;
    changed = true;
    return false;
  });
  return changed;
}

function paintDraft() {
  const t = today(), tm = addDays(t, 1);
  document.querySelectorAll('#g-date [data-v]').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'today' ? t : tm) === draft.date));
  const bd = $('b-date');
  if (bd) {
    const custom = draft.date !== t && draft.date !== tm;
    bd.classList.toggle('on', custom);
    bd.textContent = custom ? dayName(draft.date) : 'Pick date';
  }
  const cap = $('cap-time');
  if (cap) {
    cap.classList.toggle('set', !!draft.time);
    cap.querySelector('span').textContent = draft.time ? fmtTime(draft.time) : 'No reminder';
  }
  document.querySelectorAll('#g-pri [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.pri));
  document.querySelectorAll('#g-planGoal [data-id]').forEach((b) => b.classList.toggle('on', b.dataset.id === draft.goalId));
}

const timeCapsule = () => `<button class="capsule" id="cap-time" data-act="pickTime">${svg('clock')}<span>No reminder</span></button>`;
const priChips = () => `<div class="chips" id="g-pri">${['high', 'med', 'low'].map((k) => `<button data-act="setPri" data-v="${k}">${dot(PRI_COLOR[k])}${PRI_LABEL[k]}</button>`).join('')}</div>`;

function addTodoForm(opts = {}) {
  draft = { date: today(), time: '', pri: 'med', goalId: opts.goalId || '' };
  openModal(`<h2>${opts.label ? 'New step' : 'New task'}</h2>
    ${opts.label ? `<div class="muted" style="margin:-8px 0 14px">Step toward: ${esc(opts.label)}</div>` : ''}
    <input id="f-title" placeholder="What needs to be done?" value="${esc(opts.title || '')}" autocomplete="off">
    <span class="label">When</span>
    <div class="chips" id="g-date"><button data-act="setDate" data-v="today">Today</button><button data-act="setDate" data-v="tomorrow">Tomorrow</button><button data-act="pickDate" id="b-date">Pick date</button></div>
    <input id="t-date" type="date" hidden>
    <span class="label">Reminder</span>${timeCapsule()}
    <span class="label" style="margin-top:14px">Priority</span>${priChips()}
    <button class="btn" data-act="saveTodo">Add task</button>`);
  paintDraft();
}

// Tap a quick time, or fine-tune with the steppers. Resolves 'HH:MM', '' (no reminder) or null (dismissed).
function pickTime({ value = '', title = 'Reminder time', presets = TIME_PRESETS, allowNone = true } = {}) {
  return new Promise((resolve) => {
    const el = $('dialog');
    const [h0, m0] = (value || '09:00').split(':').map(Number);
    let h12 = h0 % 12 || 12;
    let m = (Math.round(m0 / 5) * 5) % 60;
    let pm = h0 >= 12;
    const hm = () => `${pad((h12 % 12) + (pm ? 12 : 0))}:${pad(m)}`;
    el.innerHTML = `<div class="dlg tp"><h2>${esc(title)}</h2>
      <div class="tp-quick">${presets.map(([v, l]) => `<button data-d="p:${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="label" style="margin:16px 0 8px">Or fine-tune</div>
      <div class="tp-wheel">
        <div class="tp-col"><button data-d="h+" aria-label="Hour up">${svg('up')}</button><b id="tp-h"></b><button data-d="h-" aria-label="Hour down">${svg('down')}</button></div>
        <span class="tp-colon">:</span>
        <div class="tp-col"><button data-d="m+" aria-label="Minute up">${svg('up')}</button><b id="tp-m"></b><button data-d="m-" aria-label="Minute down">${svg('down')}</button></div>
        <div class="tp-ampm"><button data-d="am" id="tp-am">AM</button><button data-d="pm" id="tp-pm">PM</button></div>
      </div>
      <div class="grid2" style="margin-top:18px"><button class="btn alt" data-d="none">${allowNone ? 'No reminder' : 'Cancel'}</button><button class="btn" data-d="set">Set <span id="tp-show"></span></button></div></div>`;
    const paint = () => {
      $('tp-h').textContent = pad(h12);
      $('tp-m').textContent = pad(m);
      $('tp-show').textContent = fmtTime(hm());
      $('tp-am').classList.toggle('on', !pm);
      $('tp-pm').classList.toggle('on', pm);
    };
    paint();
    showLayer(el);
    const finish = (v) => { el.onclick = null; hideLayer(el); resolve(v); };
    el.onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) { if (e.target === el) finish(null); return; }
      const d = b.dataset.d;
      if (d.startsWith('p:')) return finish(d.slice(2));
      if (d === 'set') return finish(hm());
      if (d === 'none') return finish(allowNone ? '' : null);
      if (d === 'h+') h12 = (h12 % 12) + 1;
      else if (d === 'h-') h12 = ((h12 + 10) % 12) + 1;
      else if (d === 'm+') m = (m + 5) % 60;
      else if (d === 'm-') m = (m + 55) % 60;
      else if (d === 'am') pm = false;
      else if (d === 'pm') pm = true;
      paint();
    };
  });
}

// ---------- plan tomorrow ----------
function planListHtml() {
  const tm = addDays(today(), 1);
  const list = db.get().todos.filter((x) => x.date === tm && !x.done).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  if (!list.length) return '<div class="muted" style="padding:6px 0 14px">Nothing planned yet. Add your first task below.</div>';
  return list.map((x) => `<div class="plan-item">${dot(PRI_COLOR[x.pri])}<div class="grow">${esc(x.title)}${x.time ? `<span class="capsule mini set">${fmtTime(x.time)}</span>` : ''}</div><button class="icon" data-act="planDel" data-id="${x.id}" aria-label="Remove">${svg('trash')}</button></div>`).join('');
}

// active goals as chips in the plan-tomorrow sheet: "add a step for ..."
function planGoalChips() {
  const gl = db.get().goals.filter((g) => !g.review && g.horizon !== 'long');
  if (!gl.length) return '';
  return `<span class="label" style="margin-top:14px">Step for a goal (optional)</span><div class="chips scroll" id="g-planGoal">${gl.map((g) => `<button data-act="planGoal" data-id="${g.id}">${esc(g.title)}</button>`).join('')}</div>`;
}

// ticking a step logs +1 on a count goal (and un-ticking takes it back)
function logGoalStep(t, on) {
  if (!t.goalId) return;
  const g = db.get().goals.find((x) => x.id === t.goalId && !x.review);
  if (!g) return;
  g.progress = g.progress.filter((e) => e.taskId !== t.id);
  if (on && g.kind === 'count') g.progress.push({ id: db.uid(), date: today(), amount: 1, note: t.title, taskId: t.id });
  g.touched = today();
}

function showPlan() {
  const tm = addDays(today(), 1);
  const name = db.get().settings.name;
  draft = { date: tm, time: '', pri: 'med', goalId: '' };
  openModal(`<h2>Plan tomorrow</h2>
    <div class="muted" style="margin:-8px 0 14px">${esc(dayName(tm))}${name ? ` · ${esc(name)}, what is on?` : ''}</div>
    <div id="plan-list" class="plan-list">${planListHtml()}</div>
    <input id="f-title" placeholder="e.g. Wash shoes, car service, study 2 hrs" autocomplete="off">
    <div class="row" style="margin-bottom:12px">${timeCapsule()}</div>
    ${priChips()}
    ${planGoalChips()}
    <button class="btn" data-act="planAdd">Add to tomorrow</button>
    <button class="btn alt" data-act="closeModal" style="margin-top:10px">Done</button>`);
  paintDraft();
}

function markDayForm(date) {
  const v = db.get().attendance[date];
  const cur = v && v.s !== 'A' ? v.s : '';
  const t = today();
  const hint = date > t ? 'You can plan leave or a holiday in advance.' : date === t ? 'If you leave today unmarked it becomes absent at midnight.' : 'Unmarked days count as absent.';
  openModal(`<h2>${esc(dayName(date))}</h2>
    <div class="muted" style="margin:-8px 0 14px">${hint}</div>
    <div class="grid2">${['P', 'H', 'L', 'O'].map((k) => `<button class="btn ${cur === k ? 'on' : 'alt'}" data-act="setDay" data-date="${date}" data-s="${k}">${dot(STATUS_COLOR[k])}${STATUS[k]}</button>`).join('')}</div>
    ${cur ? `<button class="btn danger" style="margin-top:10px" data-act="clearDay" data-date="${date}">Clear mark</button>` : ''}`);
}

// ---------- backup ----------
async function doExport() {
  const name = `prysm-backup-${today()}.json`;
  const text = db.exportJson();
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: r.uri, dialogTitle: 'Send backup' });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
  }
}
function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f || !(await ui.confirm('This will replace all current data with the backup.', { title: 'Restore backup', ok: 'Replace', danger: true }))) return;
    try { await db.importJson(await f.text()); await ensureAttStart(); render(); toast('Data restored'); } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- actions ----------
const actions = {
  prev: () => { ym = shiftMonth(ym, -1); render('fade'); },
  next: () => { ym = shiftMonth(ym, 1); render('fade'); },
  goto: (el) => go(el.dataset.tab),
  filter: (el) => { todoFilter = el.dataset.k; render(); },
  export: doExport,
  import: doImport,
  markToday: () => markDayForm(today()),
  markDay: (el) => markDayForm(el.dataset.date),
  setDay: async (el) => {
    const date = el.dataset.date;
    db.get().attendance[date] = { s: el.dataset.s };
    closeModal(); await commit();
  },
  clearDay: async (el) => { delete db.get().attendance[el.dataset.date]; closeModal(); await commit(); },
  enableCapture: async () => {
    try {
      await refreshCapture();
      if (!capture.notifs) { await ensureNotifPermission('Prysm needs notification permission so it can alert you when a payment is detected.'); await refreshCapture(); }
      if (!capture.notif) {
        const go = await ui.confirm('Turn ON "Prysm" in Notification access so it can see UPI payment alerts.\n\nIf it is greyed out: Settings > Apps > Prysm > menu (three dots) > Allow restricted settings.', { title: 'Step 1 of 3', ok: 'Open settings' });
        if (go) await PaymentCapture.openSettings();
      } else if (!capture.overlay) {
        const go = await ui.confirm('Allow "Display over other apps" for Prysm so the Add expense sheet can appear over PhonePe or GPay.', { title: 'Step 2 of 3', ok: 'Open settings' });
        if (go) await PaymentCapture.openOverlaySettings();
      } else if (!capture.battery) {
        const go = await ui.confirm('Let Prysm run without battery limits so popups are never missed.\n\nOn iQOO / Vivo also open App settings and allow Display pop-up windows, Display pop-up windows while running in the background, and Autostart. On Xiaomi, Oppo, Realme and OnePlus allow Auto-start and Background activity.', { title: 'Step 3 of 3', ok: 'Open settings' });
        if (go) await PaymentCapture.requestIgnoreBattery();
      } else {
        await ui.alert('Everything is switched on. Use Test popup in Settings to try it.', 'All set');
      }
    } catch (e) { toast('Could not open settings'); }
  },
  reviewInbox: showInboxItem,
  saveInbox: async () => {
    const S = db.get(), p = S.inbox[0];
    const amount = Number($('f-amt').value), cash = Number($('f-cash').value);
    if (!(amount > 0) && !(cash > 0)) return toast('Enter an amount');
    const base = { type: 'expense', category: $('f-cat').value, note: $('f-note').value.trim(), date: p.date || today() };
    if (amount > 0) S.transactions.push({ id: db.uid(), amount, mode: 'online', ...base });
    if (cash > 0) S.transactions.push({ id: db.uid(), amount: cash, mode: 'cash', ...base });
    S.inbox.shift();
    closeModal(); await commit();
    if (S.inbox.length) showInboxItem();
  },
  skipInbox: async () => {
    const S = db.get(); S.inbox.shift();
    closeModal(); await commit();
    if (S.inbox.length) showInboxItem();
  },
  attScope: (el) => { attScope = el.dataset.v; render(); },
  ddOpen: (el) => {
    const menu = el.parentElement.querySelector('.menu');
    const open = menu.hidden;
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
    menu.hidden = !open;
  },
  ddPick: (el) => { attGran[el.dataset.k] = el.dataset.v; render(); },
  toggleOff: async (el) => {
    const st = db.get().settings;
    const n = Number(el.dataset.v);
    const set = new Set(st.weekOff || []);
    if (set.has(n)) set.delete(n); else set.add(n);
    st.weekOff = [...set].sort();
    await commit();
  },
  addTodo: () => addTodoForm(),
  setDate: (el) => {
    draft.date = el.dataset.v === 'today' ? today() : addDays(today(), 1);
    const f = $('t-date');
    if (f) f.hidden = true;
    paintDraft();
  },
  pickDate: () => {
    const f = $('t-date');
    f.hidden = false;
    f.value = draft.date;
    try { f.showPicker(); } catch (e) { f.focus(); }
  },
  pickTime: async () => {
    const v = await pickTime({ value: draft.time });
    if (v !== null) { draft.time = v; paintDraft(); }
  },
  setPri: (el) => { draft.pri = el.dataset.v; paintDraft(); },
  saveTodo: async () => {
    const title = $('f-title').value.trim();
    if (!title) return toast('Enter a task');
    db.get().todos.push({ id: db.uid(), title, date: draft.date, time: draft.time, pri: draft.pri, done: false, doneAt: 0, goalId: draft.goalId || '' });
    closeModal();
    if (draft.time) await ensureNotifPermission('Prysm needs permission to remind you about tasks at the time you pick.');
    await commit(); syncNotifications();
  },
  toggleTodo: async (el) => {
    if (el.dataset.busy) return;
    const t = db.get().todos.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (!t.done) {
      el.dataset.busy = '1';
      const card = el.closest('.task, .drow');
      if (card && !reduceMotion()) { card.classList.add('leaving'); await new Promise((r) => setTimeout(r, 360)); }
      t.done = true; t.doneAt = Date.now();
      logGoalStep(t, true);
    } else { t.done = false; t.doneAt = 0; logGoalStep(t, false); }
    await commit(); syncNotifications();
  },
  delTodo: async (el) => {
    if (!(await ui.confirm('This task will be removed.', { title: 'Delete task', ok: 'Delete', danger: true }))) return;
    const S = db.get(); S.todos = S.todos.filter((x) => x.id !== el.dataset.id); await commit(); syncNotifications();
  },
  planTomorrow: showPlan,
  planGoal: (el) => { draft.goalId = draft.goalId === el.dataset.id ? '' : el.dataset.id; paintDraft(); },
  dashEdit: dashSheet,
  dashToggle: async (el) => {
    const st = db.get().settings, id = el.dataset.id;
    st.dashHidden = st.dashHidden.includes(id) ? st.dashHidden.filter((x) => x !== id) : [...st.dashHidden, id];
    await commit(); dashSheet();
  },
  dashMove: async (el) => {
    const st = db.get().settings, i = st.dashOrder.indexOf(el.dataset.id), j = i + Number(el.dataset.d);
    if (j < 0 || j >= st.dashOrder.length) return;
    [st.dashOrder[i], st.dashOrder[j]] = [st.dashOrder[j], st.dashOrder[i]];
    await commit(); dashSheet();
  },
  goBills: () => { moneyUi.setTab('bills'); go('money'); },
  goGoals: () => { goalsUi.setTab('goals'); go('goals'); },
  goDreams: () => { goalsUi.setTab('bucket'); go('goals'); },
  rvOpen: () => goalsUi.checkDue({ force: true }),
  planAdd: async () => {
    const input = $('f-title');
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    db.get().todos.push({ id: db.uid(), title, date: draft.date, time: draft.time, pri: draft.pri, done: false, doneAt: 0, goalId: draft.goalId || '' });
    if (draft.time) await ensureNotifPermission('Prysm needs permission to remind you about tasks at the time you pick.');
    draft.time = '';
    draft.goalId = '';
    input.value = '';
    $('plan-list').innerHTML = planListHtml();
    paintDraft();
    input.focus();
    await commit(); syncNotifications();
  },
  planDel: async (el) => {
    const S = db.get(); S.todos = S.todos.filter((x) => x.id !== el.dataset.id);
    $('plan-list').innerHTML = planListHtml();
    await commit(); syncNotifications();
  },
  closeModal: () => closeModal(),
  openSettings: () => { tab = 'settings'; window.scrollTo(0, 0); render('next'); },
  toggleSet: async (el) => {
    const st = db.get().settings, k = el.dataset.k;
    st[k] = !st[k];
    if (k === 'keepAlive' && Capacitor.isNativePlatform()) { try { await PaymentCapture.setKeepAlive({ on: st[k] }); } catch (e) { /* older build */ } }
    if (st[k]) await ensureNotifPermission('Prysm needs notification permission to send these reminders.');
    await commit(); syncNotifications();
  },
  setSleep: async () => {
    const st = db.get().settings;
    const v = await pickTime({ value: st.sleep, title: 'Sleep time', presets: SLEEP_PRESETS, allowNone: false });
    if (!v) return;
    st.sleep = v;
    await commit(); syncNotifications();
  },
  setLead: async (el) => { db.get().settings.planLead = Number(el.dataset.v); await commit(); syncNotifications(); },
  capTestNow: async () => {
    try { await PaymentCapture.testOverlay({ delayMs: 0 }); } catch (e) { toast(e.message || 'Could not show the popup'); }
  },
  capPlanTest: async () => {
    try {
      await PaymentCapture.testPlanOverlay({ delayMs: 2000 });
      await ui.alert('The Plan tomorrow popup appears in 2 seconds. Go to your home screen or any app to see it on top. Tasks you add there show up in Tasks.', 'Test started');
    } catch (e) { toast(e.message || 'Could not start the test'); }
  },
  capAppSettings: async () => { try { await PaymentCapture.openAppSettings(); } catch (e) { toast('Could not open app settings'); } },
  capTest: async () => {
    try {
      await PaymentCapture.testOverlay({ delayMs: 2000 });
      await ui.alert('The test popup appears in 2 seconds. Switch to PhonePe or your home screen to see it show over that app.', 'Test started');
    } catch (e) { toast(e.message || 'Could not start the test'); }
  },
  capLog: async () => {
    let items = [];
    try { items = (await PaymentCapture.getLog()).items || []; } catch (e) { /* plugin missing */ }
    const rows = items.slice().reverse().map((it) => `<div class="log-row"><div class="log-top"><b>${esc(appName(it.app))}</b><span>${new Date(it.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>${it.text ? `<div class="log-text">${esc(it.text)}</div>` : ''}<div class="log-res ${it.result === 'captured' ? 'good' : ''}">${esc(it.result)}</div></div>`).join('')
      || '<div class="muted">Nothing seen yet. Make a payment and check again.</div>';
    openModal(`<h2>Capture log</h2><div class="muted" style="margin:-8px 0 12px">What Prysm saw from your payment apps, and what it did with it.</div><div class="log-list">${rows}</div><button class="btn alt" data-act="capClear" style="margin-top:12px">Clear log</button>`);
  },
  capClear: async () => { try { await PaymentCapture.clearLog(); } catch (e) { /* ignore */ } closeModal(); },
};
Object.assign(actions, moneyUi.actions);
Object.assign(actions, goalsUi.actions);

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dd')) document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 't-date') { draft.date = e.target.value || today(); paintDraft(); }
  if (e.target.id === 's-attstart') { db.get().settings.attStart = e.target.value || today(); db.save(); }
  if (e.target.id === 's-name') { db.get().settings.name = e.target.value.trim(); db.save(); syncNotifications(); }
});

// ---------- navigation: buttons and swipe ----------
function go(next) {
  if (next === tab || !TAB_ORDER.includes(next)) return;
  const from = TAB_ORDER.indexOf(tab);
  const dir = from === -1 || TAB_ORDER.indexOf(next) < from ? 'prev' : 'next';
  tab = next;
  window.scrollTo(0, 0);
  render(dir);
}

function countUp() {
  if (reduceMotion()) return;
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 900);
      el.textContent = inr(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step); else el.textContent = inr(target);
    };
    requestAnimationFrame(step);
  });
}

// Swipe left = next tab, swipe right = previous tab. Ignored over inputs and charts, while a popup is open,
// and near the screen edges (those belong to the system back gesture).
let touch = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  const edge = 28;
  const blocked = !$('modal').hidden || !$('dialog').hidden || (e.target.closest && e.target.closest('input, select, textarea, canvas, .scroll'));
  touch = blocked || t.clientX < edge || t.clientX > window.innerWidth - edge || e.touches.length > 1 ? null : { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch || !TAB_ORDER.includes(tab)) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y, dt = Date.now() - touch.t;
  touch = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return;
  go(TAB_ORDER[TAB_ORDER.indexOf(tab) + (dx < 0 ? 1 : -1)]);
}, { passive: true });

// ---------- shell ----------
// anim: 'up' | 'next' | 'prev' | 'fade' | undefined (no animation, e.g. after ticking a task)
function render(anim) {
  const title = tab === 'settings' ? 'Settings' : TABS.find((t) => t[0] === tab)[1];
  $('top').innerHTML = `<div class="row">${tab === 'settings' ? `<button class="icon back" data-act="goto" data-tab="home" aria-label="Back">${svg('prev')}</button>` : ''}<h1>${title}</h1></div>
    <div class="row"><span class="date">${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>${tab === 'settings' ? '' : `<button class="icon gear" data-act="openSettings" aria-label="Settings">${svg('gear')}</button>`}</div>`;
  const view = $('view');
  view.className = '';
  view.dataset.tab = tab;
  view.innerHTML = views[tab]();
  if (anim && !reduceMotion()) {
    [...view.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 7)));
    view.className = 'fx-' + anim;
  }
  $('tabs').innerHTML = TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="goto" data-tab="${k}">${svg(k)}${l}</button>`).join('');
  charts.forEach((ch) => ch.destroy());
  charts = [];
  if (tab === 'money' && moneyUi.getTab() === 'report') drawMoneyReport();
  if (tab === 'todo' && todoFilter === 'report') drawTaskReport();
  if (tab === 'att') drawAttCharts();
  if (tab === 'goals' && goalsUi.getTab() === 'journal' && $('j-chart')) drawJournalChart();
  if (anim) countUp();
}

// Dev helper (desktop browser only): window.__simulatePayment(250, 'Zomato')
if (!Capacitor.isNativePlatform()) {
  window.__simulatePayment = async (amount, payee = '') => {
    db.get().inbox.push({ amount, payee, category: 'Other', note: payee, date: today(), status: 'review' });
    await db.save(); render(); showInboxItem();
  };
}
function openFromNotification(extra) {
  if (extra.type === 'plan') { tab = 'todo'; render(); showPlan(); }
  else if (extra.type === 'task' || extra.type === 'nag') { tab = 'todo'; todoFilter = 'today'; render('up'); }
  else if (extra.type === 'salary') { tab = 'money'; moneyUi.setTab('overview'); render('up'); moneyUi.openIncome('salary'); }
  else if (extra.type === 'bill') { tab = 'money'; moneyUi.setTab('bills'); render('up'); }
  else if (extra.type === 'lent') { tab = 'money'; moneyUi.setTab('lent'); render('up'); }
  else if (extra.type === 'weekly') { tab = 'money'; moneyUi.setTab('overview'); render('up'); moneyUi.openWeekly(); }
  else if (extra.type === 'backup') { tab = 'settings'; render('up'); }
  else if (extra.type === 'goalReview') { tab = 'goals'; goalsUi.setTab('goals'); render('up'); goalsUi.checkDue({ force: true }); }
  else if (extra.type === 'goalCheck') { tab = 'goals'; goalsUi.setTab('goals'); render('up'); }
  else if (extra.type === 'bucket') { tab = 'goals'; goalsUi.setTab('bucket'); render('up'); }
}

function listenForNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  LocalNotifications.addListener('localNotificationActionPerformed', (e) => openFromNotification((e.notification && e.notification.extra) || {}));
  // plan time reached while Prysm is open: show the sheet right away
  LocalNotifications.addListener('localNotificationReceived', (n) => { if (n.extra && n.extra.type === 'plan' && $('modal').hidden) openFromNotification(n.extra); });
}

// First launch: explain and ask for notification permission once, so the night planner can work.
async function firstRun() {
  const st = db.get().settings;
  if (!Capacitor.isNativePlatform() || st.askedNotif) return;
  st.askedNotif = true;
  await db.save();
  await ensureNotifPermission('Prysm reminds you to plan tomorrow every night and alerts you about pending tasks. Allow notifications to turn this on.');
  syncNotifications();
}

async function ensureAttStart() {
  const st = db.get().settings;
  if (st.attStart) return;
  const first = Object.keys(db.get().attendance).sort()[0];
  st.attStart = first && first < today() ? first : today();
  await db.save();
}

async function onResume() {
  if (purgeDone()) await db.save();
  await syncPayments();
  syncNotifications();
  goalsUi.checkDue({ force: true });
}
App.addListener('resume', onResume);

db.init().then(async () => {
  if (purgeDone()) await db.save();
  if (Capacitor.isNativePlatform()) {
    setNativePlan(true);
    setSyncHook(pushPlan);
    PaymentCapture.setKeepAlive({ on: db.get().settings.keepAlive !== false }).catch(() => {});
  }
  await ensureAttStart();
  await initNotifications();
  render('up');
  listenForNotifications();
  // on the phone syncPayments asks too; this makes the SIP question work everywhere
  setTimeout(() => moneyUi.askSips(), 700);
  syncPayments();
  syncNotifications();
  goalsUi.checkDue({ force: true });
  // a goal's period can end while the app is open; check once a minute, but never interrupt a form
  setInterval(() => { if (!document.hidden) goalsUi.checkDue(); }, 60000);
  setTimeout(firstRun, 1200);
}).catch((e) => { document.body.textContent = 'Database error: ' + e.message; });
