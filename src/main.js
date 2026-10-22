import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Chart from 'chart.js/auto';
import * as db from './db.js';

const CATEGORIES = ['Food', 'Travel', 'Bills', 'Rent', 'Shopping', 'Health', 'Fun', 'Other'];
const STATUS = { P: 'Present', A: 'Absent', H: 'Half-day', L: 'Leave', O: 'Holiday' };
const STATUS_COLOR = { P: '#4ade80', A: '#f87171', H: '#fbbf24', L: '#818cf8', O: 'rgba(255,255,255,0.35)' };
const PRI_COLOR = { high: '#f87171', med: '#fbbf24', low: '#818cf8' };

const PaymentCapture = registerPlugin('PaymentCapture');

const ICON = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  att: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  rep: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const TABS = [['home', 'Home'], ['money', 'Money'], ['att', 'Attendance'], ['todo', 'Tasks'], ['rep', 'Reports']];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dateStr(new Date());

let tab = 'home';
let ym = today().slice(0, 7);
let todoFilter = 'today';
let charts = [];
let capture = { notif: false, overlay: false };

Chart.defaults.color = 'rgba(255,255,255,0.5)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Space Grotesk', sans-serif";

const monthLabel = (s) => new Date(s + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shiftMonth = (s, d) => { const [y, m] = s.split('-').map(Number); return dateStr(new Date(y, m - 1 + d, 1)).slice(0, 7); };

// ---------- calculations ----------
function monthMoney(m) {
  const S = db.get();
  const tx = S.transactions.filter((t) => t.date.startsWith(m));
  const income = tx.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = tx.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const salary = Number(S.settings.salary) || 0;
  const byCat = {};
  tx.filter((t) => t.type === 'expense').forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  return { tx, income: income + salary, extraIncome: income, salary, expense, balance: income + salary - expense, byCat };
}

function monthAtt(m) {
  const c = { P: 0, A: 0, H: 0, L: 0, O: 0 };
  Object.entries(db.get().attendance).forEach(([d, v]) => { if (d.startsWith(m)) c[v.s]++; });
  return { ...c, worked: c.P + c.H * 0.5, marked: c.P + c.A + c.H + c.L };
}

// ---------- helpers ----------
function openModal(html) {
  const m = $('modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
}
const closeModal = () => { $('modal').hidden = true; };
const toast = (msg) => alert(msg);
const dot = (color) => `<span class="dot" style="color:${color}"></span>`;

async function commit() { await db.save(); render(); }

const monthPicker = () => `<div class="month">
  <button class="icon" data-act="prev">${svg('prev')}</button><b>${monthLabel(ym)}</b><button class="icon" data-act="next">${svg('next')}</button></div>`;

// ---------- payment capture ----------
function captureCard() {
  const S = db.get();
  const waiting = S.inbox.length;
  const review = waiting ? `<button class="btn sm" data-act="reviewInbox" style="margin-top:12px">Review ${waiting} payment${waiting > 1 ? 's' : ''}</button>` : '';
  if (!Capacitor.isNativePlatform()) {
    return `<div class="card"><h2>Auto-capture payments</h2><div class="sec">Works in the installed Android app: after a UPI payment, an Add expense sheet pops up over PhonePe, GPay or Paytm.</div>${review}</div>`;
  }
  const ready = capture.notif && capture.overlay;
  return `<div class="card"><div class="row between"><h2 style="margin:0">Auto-capture payments</h2><span class="${ready ? 'good' : 'warn'}">${dot(ready ? '#4ade80' : '#fbbf24')} ${ready ? 'On' : 'Setup needed'}</span></div>
    <div class="sec" style="margin-top:10px">${ready ? 'After a UPI payment an Add expense sheet appears over the payment app.' : 'Two permissions are needed: notification access (to see the payment) and display over other apps (to show the sheet).'}</div>
    ${ready ? '' : '<button class="btn sm" data-act="enableCapture" style="margin-top:12px">Set up</button>'}${review}</div>`;
}

async function refreshCapture() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    capture.notif = (await PaymentCapture.isEnabled()).enabled;
    capture.overlay = (await PaymentCapture.hasOverlay()).enabled;
  } catch (e) { /* plugin missing: leave as off */ }
}

// Pull payments seen by the native service; confirmed ones are stored, the rest wait in the inbox.
async function syncPayments() {
  if (!Capacitor.isNativePlatform()) return;
  await refreshCapture();
  try {
    const { items } = await PaymentCapture.takePending();
    const S = db.get();
    (items || []).forEach((p) => {
      if (p.status === 'saved') S.transactions.push({ id: db.uid(), type: 'expense', amount: p.amount, category: p.category || 'Other', note: p.note || '', date: p.date || today() });
      else S.inbox.push(p);
    });
    if (items && items.length) await db.save();
  } catch (e) { /* ignore */ }
  render();
  if (db.get().inbox.length && $('modal').hidden) showInboxItem();
}

function showInboxItem() {
  const p = db.get().inbox[0];
  if (!p) return;
  const more = db.get().inbox.length - 1;
  openModal(`<h2>Payment detected</h2>
    <div class="label">Amount ₹</div><input id="f-amt" type="number" inputmode="decimal" value="${p.amount}">
    <div class="label">Category</div><select id="f-cat">${CATEGORIES.map((c) => `<option ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <div class="label">Note</div><input id="f-note" value="${esc(p.note || p.payee || '')}" placeholder="Note (optional)">
    <div class="grid2"><button class="btn alt" data-act="skipInbox">Skip</button><button class="btn" data-act="saveInbox">Save expense</button></div>
    ${more ? `<div class="muted" style="margin-top:12px;text-align:center">${more} more waiting</div>` : ''}`);
}

// ---------- views ----------
const views = {
  home() {
    const S = db.get();
    const m = monthMoney(today().slice(0, 7));
    const a = monthAtt(today().slice(0, 7));
    const t = today();
    const pending = S.todos.filter((x) => x.date === t && !x.done).length;
    const att = S.attendance[t];
    return `
      <div class="hero"><div class="label">Balance this month</div>
        <div class="num">${inr(m.balance)}</div>
        <hr>
        <div class="grid2"><div><div class="label">Income</div><div class="val" style="color:#fff">${inr(m.income)}</div></div>
        <div><div class="label">Expenses</div><div class="val" style="color:#fff">${inr(m.expense)}</div></div></div></div>
      ${captureCard()}
      <div class="grid2">
        <div class="card"><div class="label">Today</div>
          <div class="val" style="margin:8px 0 12px;display:flex;align-items:center;gap:8px">${att ? dot(STATUS_COLOR[att.s]) + STATUS[att.s] : '<span class="sec">Not marked</span>'}</div>
          <button class="btn alt sm" data-act="markToday">Mark</button></div>
        <div class="card"><div class="label">Pending tasks</div>
          <div class="val" style="margin:8px 0 12px;display:flex;align-items:center;gap:8px">${dot('#fbbf24')}${pending}</div>
          <button class="btn alt sm" data-act="goto" data-tab="todo">View</button></div>
      </div>
      <div class="card"><h2>Office this month</h2>
        <div class="grid2 sec"><div>${dot('#4ade80')} Present <b>${a.P}</b></div><div>${dot('#f87171')} Absent <b>${a.A}</b></div>
        <div>${dot('#fbbf24')} Half-day <b>${a.H}</b></div><div>${dot('#818cf8')} Leave <b>${a.L}</b></div></div>
        <div class="muted" style="margin-top:10px">Working days: ${a.worked}</div></div>
      <div class="card"><h2>Backup</h2>
        <div class="grid2"><button class="btn" data-act="export">Export</button><button class="btn alt" data-act="import">Import</button></div>
        <div class="muted" style="margin-top:10px">Your data lives only on this phone. Export a backup regularly and send it to WhatsApp or Drive.</div></div>`;
  },

  money() {
    const S = db.get();
    const m = monthMoney(ym);
    const budgetRows = CATEGORIES.filter((c) => S.budgets[c] || m.byCat[c]).map((c) => {
      const spent = m.byCat[c] || 0, b = S.budgets[c] || 0;
      const pct = b ? Math.min(100, (spent / b) * 100) : 0;
      return `<div style="margin-bottom:14px"><div class="row between"><span>${c}</span>
        <span class="${b && spent > b ? 'bad' : 'muted'}">${inr(spent)}${b ? ' / ' + inr(b) : ''}${b && spent > b ? ' · over budget' : ''}</span></div>
        ${b ? `<div class="bar ${spent > b ? 'over' : ''}"><div style="width:${pct}%"></div></div>` : ''}</div>`;
    }).join('') || '<div class="muted">No expenses yet.</div>';
    const list = [...m.tx].sort((a, b) => b.date.localeCompare(a.date)).map((t) => `
      <div class="item">${dot(t.type === 'income' ? '#4ade80' : '#f87171')}
      <div class="grow"><div>${esc(t.category)}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="muted">${t.date}</div></div>
      <b class="${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${inr(t.amount)}</b>
      <button class="icon" data-act="delTx" data-id="${t.id}">${svg('trash')}</button></div>`).join('') || '<div class="muted">No entries this month.</div>';
    return `${monthPicker()}
      <div class="hero"><div class="row between"><div><div class="label">Monthly salary</div><div class="val" style="color:#fff">${inr(m.salary)}</div></div>
        <button class="icon" data-act="setSalary">${svg('edit')}</button></div>
        <hr>
        <div class="label">Balance</div><div class="num">${inr(m.balance)}</div>
        <div class="sub">Income ${inr(m.income)} · Expenses ${inr(m.expense)}</div></div>
      <button class="btn" data-act="addTx" style="margin-bottom:14px">+ Add entry</button>
      <div class="card"><div class="row between"><h2 style="margin:0">Category budgets</h2><button class="icon" data-act="setBudget">${svg('edit')}</button></div><div style="height:12px"></div>${budgetRows}</div>
      <div class="card"><h2>Entries</h2>${list}</div>`;
  },

  att() {
    const S = db.get();
    const [y, mo] = ym.split('-').map(Number);
    const first = new Date(y, mo - 1, 1).getDay();
    const days = new Date(y, mo, 0).getDate();
    const a = monthAtt(ym);
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="h">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const ds = `${ym}-${pad(d)}`, v = S.attendance[ds];
      cells += `<div class="d ${v ? 'st-' + v.s : ''} ${ds === today() ? 'today' : ''}" data-act="markDay" data-date="${ds}">${d}${v ? '<i></i>' : ''}</div>`;
    }
    const legend = Object.entries(STATUS).map(([k, l]) => `<span>${dot(STATUS_COLOR[k])}${l}</span>`).join('');
    return `${monthPicker()}
      <div class="card"><div class="cal">${cells}</div><div class="legend">${legend}</div></div>
      <div class="card"><h2>Summary</h2>
        <div class="grid2 sec"><div>Present <b class="good">${a.P}</b></div><div>Absent <b class="bad">${a.A}</b></div>
        <div>Half-day <b class="warn">${a.H}</b></div><div>Leave <b class="ind">${a.L}</b></div>
        <div>Holiday <b>${a.O}</b></div><div>Working days <b style="color:#fff">${a.worked}</b></div></div></div>`;
  },

  todo() {
    const S = db.get();
    const t = today();
    let list = S.todos.filter((x) => (todoFilter === 'today' ? x.date === t : todoFilter === 'pending' ? !x.done : true));
    const rank = { high: 0, med: 1, low: 2 };
    list = list.sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date) || rank[a.pri] - rank[b.pri]);
    const rows = list.map((x) => `
      <div class="item"><input type="checkbox" ${x.done ? 'checked' : ''} data-act="toggleTodo" data-id="${x.id}">
        <div class="grow"><div class="${x.done ? 'done' : ''}">${esc(x.title)}</div>
        <div class="muted" style="margin-top:3px">${x.date}${x.time ? ' · ' + x.time : ''} · <span style="color:${PRI_COLOR[x.pri]}">${dot(PRI_COLOR[x.pri])} ${x.pri}</span></div></div>
        <button class="icon" data-act="delTodo" data-id="${x.id}">${svg('trash')}</button></div>`).join('') || '<div class="muted">No tasks here.</div>';
    const chip = (k, l) => `<button class="${todoFilter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`;
    return `<button class="btn" data-act="addTodo" style="margin-bottom:14px">+ New task</button>
      <div class="chips">${chip('today', 'Today')}${chip('pending', 'Pending')}${chip('all', 'All')}</div>
      <div class="card">${rows}</div>`;
  },

  rep() {
    return `${monthPicker()}
      <div class="card"><h2>Spending by category</h2><canvas id="c1"></canvas></div>
      <div class="card"><h2>Income vs expenses · 6 months</h2><canvas id="c2"></canvas></div>
      <div class="card"><h2>Attendance</h2><canvas id="c3"></canvas></div>
      <div class="card"><h2>Task completion</h2><div id="todoRate" class="num"></div><div id="todoSub" class="muted" style="margin-top:6px"></div></div>`;
  },
};

function drawCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
  const m = monthMoney(ym), a = monthAtt(ym);
  const cats = Object.keys(m.byCat);
  const purples = ['#7c3aed', '#a78bfa', '#6d28d9', '#c4b5fd', '#8b5cf6', '#5b21b6', '#ddd6fe', '#4c1d95'];
  const legend = { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 } };
  charts.push(new Chart($('c1'), { type: 'doughnut', options: { plugins: { legend }, borderWidth: 0, cutout: '62%' }, data: { labels: cats.length ? cats : ['No data'], datasets: [{ data: cats.length ? cats.map((c) => m.byCat[c]) : [1], backgroundColor: cats.length ? purples : ['rgba(255,255,255,0.08)'], borderWidth: 0 }] } }));
  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(ym, d));
  const mm = months.map(monthMoney);
  charts.push(new Chart($('c2'), { type: 'bar', options: { plugins: { legend }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } }, data: { labels: months.map((x) => monthLabel(x).slice(0, 3)), datasets: [{ label: 'Income', data: mm.map((x) => x.income), backgroundColor: '#4ade80', borderRadius: 6 }, { label: 'Expenses', data: mm.map((x) => x.expense), backgroundColor: '#f87171', borderRadius: 6 }] } }));
  const hasAtt = a.P + a.A + a.H + a.L + a.O > 0;
  charts.push(new Chart($('c3'), { type: 'doughnut', options: { plugins: { legend }, cutout: '62%' }, data: { labels: hasAtt ? Object.values(STATUS) : ['No data'], datasets: [{ data: hasAtt ? [a.P, a.A, a.H, a.L, a.O] : [1], backgroundColor: hasAtt ? Object.values(STATUS_COLOR) : ['rgba(255,255,255,0.08)'], borderWidth: 0 }] } }));
  const todos = db.get().todos.filter((x) => x.date.startsWith(ym));
  const done = todos.filter((x) => x.done).length;
  $('todoRate').textContent = todos.length ? Math.round((done / todos.length) * 100) + '%' : '—';
  $('todoSub').textContent = `${done} of ${todos.length} tasks done`;
}

// ---------- forms ----------
const catOptions = () => CATEGORIES.map((c) => `<option>${c}</option>`).join('');

function addTxForm() {
  openModal(`<h2>New entry</h2>
    <select id="f-type"><option value="expense">Expense</option><option value="income">Extra income</option></select>
    <input id="f-amt" type="number" inputmode="decimal" placeholder="Amount ₹">
    <select id="f-cat">${catOptions()}</select>
    <input id="f-note" placeholder="Note (optional)">
    <input id="f-date" type="date" value="${today()}">
    <button class="btn" data-act="saveTx">Save</button>`);
}

function addTodoForm() {
  openModal(`<h2>New task</h2>
    <input id="f-title" placeholder="What needs to be done?">
    <span class="label">Date</span><input id="f-date" type="date" value="${today()}">
    <span class="label">Reminder time (optional)</span><input id="f-time" type="time">
    <span class="label">Priority</span><select id="f-pri"><option value="med">Medium</option><option value="high">High</option><option value="low">Low</option></select>
    <button class="btn" data-act="saveTodo">Save</button>`);
}

function markDayForm(date) {
  const v = db.get().attendance[date] || {};
  openModal(`<h2>${date}</h2>
    <div class="grid2">${Object.entries(STATUS).map(([k, l]) => `<button class="btn ${v.s === k ? 'on' : 'alt'}" data-act="setDay" data-date="${date}" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="muted" style="margin:12px 0">Tap a status to save.</div>
    ${v.s ? `<button class="btn danger" data-act="clearDay" data-date="${date}">Clear</button>` : ''}`);
}

function budgetForm() {
  const b = db.get().budgets;
  openModal(`<h2>Monthly budgets</h2>${CATEGORIES.map((c) => `<span class="label">${c}</span><input data-bud="${c}" type="number" inputmode="decimal" value="${b[c] || ''}" placeholder="0 = no limit">`).join('')}
    <button class="btn" data-act="saveBudget">Save</button>`);
}

// ---------- notifications ----------
const notifId = (id) => Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 2147483000;

async function scheduleReminder(todo) {
  if (!Capacitor.isNativePlatform() || !todo.time) return;
  const at = new Date(`${todo.date}T${todo.time}`);
  if (at <= new Date()) return;
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    await LocalNotifications.schedule({ notifications: [{ id: notifId(todo.id), title: 'Task reminder', body: todo.title, schedule: { at, allowWhileIdle: true } }] });
  } catch (e) { /* reminder is best-effort */ }
}
async function cancelReminder(id) {
  if (!Capacitor.isNativePlatform()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: notifId(id) }] }); } catch (e) { /* ignore */ }
}

// ---------- backup ----------
async function doExport() {
  const name = `personal-app-backup-${today()}.json`;
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
    if (!f || !confirm('This will replace all current data. Continue?')) return;
    try { await db.importJson(await f.text()); render(); toast('Data restored'); } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- actions ----------
const actions = {
  prev: () => { ym = shiftMonth(ym, -1); render(); },
  next: () => { ym = shiftMonth(ym, 1); render(); },
  goto: (el) => { tab = el.dataset.tab; render(); },
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
  setSalary: async () => {
    const v = prompt('Monthly salary (₹)', db.get().settings.salary || '');
    if (v === null) return;
    const n = Number(v);
    if (!isFinite(n) || n < 0) return toast('Enter a valid amount');
    db.get().settings.salary = n; await commit();
  },
  enableCapture: async () => {
    try {
      if (Capacitor.isNativePlatform()) await LocalNotifications.requestPermissions();
      if (!capture.notif) {
        alert('Step 1: turn ON "Personal App" in Notification access.\n\nIf it is greyed out: Settings > Apps > Personal App > three dots > Allow restricted settings.');
        await PaymentCapture.openSettings();
      } else if (!capture.overlay) {
        alert('Step 2: allow "Display over other apps" for Personal App.');
        await PaymentCapture.openOverlaySettings();
      }
    } catch (e) { toast('Could not open settings'); }
  },
  reviewInbox: showInboxItem,
  saveInbox: async () => {
    const S = db.get(), p = S.inbox[0];
    const amount = Number($('f-amt').value);
    if (!(amount > 0)) return toast('Enter an amount');
    S.transactions.push({ id: db.uid(), type: 'expense', amount, category: $('f-cat').value, note: $('f-note').value.trim(), date: p.date || today() });
    S.inbox.shift();
    closeModal(); await commit();
    if (S.inbox.length) showInboxItem();
  },
  skipInbox: async () => {
    const S = db.get(); S.inbox.shift();
    closeModal(); await commit();
    if (S.inbox.length) showInboxItem();
  },
  addTx: addTxForm,
  saveTx: async () => {
    const amount = Number($('f-amt').value);
    if (!(amount > 0)) return toast('Enter an amount');
    db.get().transactions.push({ id: db.uid(), type: $('f-type').value, amount, category: $('f-cat').value, note: $('f-note').value.trim(), date: $('f-date').value || today() });
    closeModal(); await commit();
  },
  delTx: async (el) => {
    if (!confirm('Delete this entry?')) return;
    const S = db.get(); S.transactions = S.transactions.filter((t) => t.id !== el.dataset.id); await commit();
  },
  setBudget: budgetForm,
  saveBudget: async () => {
    const b = {};
    document.querySelectorAll('[data-bud]').forEach((i) => { const n = Number(i.value); if (n > 0) b[i.dataset.bud] = n; });
    db.get().budgets = b; closeModal(); await commit();
  },
  addTodo: addTodoForm,
  saveTodo: async () => {
    const title = $('f-title').value.trim();
    if (!title) return toast('Enter a task');
    const todo = { id: db.uid(), title, date: $('f-date').value || today(), time: $('f-time').value, pri: $('f-pri').value, done: false };
    db.get().todos.push(todo);
    closeModal(); await commit(); scheduleReminder(todo);
  },
  toggleTodo: async (el) => {
    const t = db.get().todos.find((x) => x.id === el.dataset.id);
    t.done = el.checked;
    if (t.done) cancelReminder(t.id); else scheduleReminder(t);
    await commit();
  },
  delTodo: async (el) => {
    if (!confirm('Delete this task?')) return;
    const S = db.get(); S.todos = S.todos.filter((x) => x.id !== el.dataset.id); cancelReminder(el.dataset.id); await commit();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && el.dataset.act !== 'toggleTodo' && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset && e.target.dataset.act === 'toggleTodo') actions.toggleTodo(e.target);
});

// ---------- shell ----------
function render() {
  $('top').innerHTML = `<h1>${TABS.find((t) => t[0] === tab)[1]}</h1><span class="date">${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
  $('view').innerHTML = views[tab]();
  $('tabs').innerHTML = TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="goto" data-tab="${k}">${svg(k)}${l}</button>`).join('');
  if (tab === 'rep') drawCharts();
}

// Dev helper (desktop browser only): window.__simulatePayment(250, 'Zomato')
if (!Capacitor.isNativePlatform()) {
  window.__simulatePayment = async (amount, payee = '') => {
    db.get().inbox.push({ amount, payee, category: 'Other', note: payee, date: today(), status: 'review' });
    await db.save(); render(); showInboxItem();
  };
}
App.addListener('resume', syncPayments);

db.init().then(() => { render(); syncPayments(); }).catch((e) => { document.body.textContent = 'Database error: ' + e.message; });
