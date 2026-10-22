import './style.css';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Chart from 'chart.js/auto';
import * as db from './db.js';

const CATEGORIES = ['Khana', 'Travel', 'Bill', 'Rent', 'Shopping', 'Health', 'Entertainment', 'Other'];
const STATUS = { P: 'Present', A: 'Absent', H: 'Half-day', L: 'Leave', O: 'Holiday' };
const TABS = [['home', '🏠', 'Home'], ['money', '💰', 'Money'], ['att', '🗓️', 'Attendance'], ['todo', '✅', 'To-dos'], ['rep', '📊', 'Reports']];

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

async function commit() { await db.save(); render(); }

function monthPicker() {
  return `<div class="row between" style="margin-bottom:10px">
    <button class="icon" data-act="prev">◀</button><b>${monthLabel(ym)}</b><button class="icon" data-act="next">▶</button></div>`;
}

// ---------- views ----------
const views = {
  home() {
    const S = db.get();
    const m = monthMoney(today().slice(0, 7));
    const a = monthAtt(today().slice(0, 7));
    const t = today();
    const todays = S.todos.filter((x) => x.date === t);
    const pending = todays.filter((x) => !x.done).length;
    const att = S.attendance[t];
    return `
      <div class="card"><div class="muted">Is mahine ka balance</div>
        <div class="big ${m.balance < 0 ? 'bad' : 'good'}">${inr(m.balance)}</div>
        <div class="muted">Income ${inr(m.income)} · Kharcha ${inr(m.expense)}</div></div>
      <div class="grid2">
        <div class="card"><div class="muted">Aaj ki attendance</div>
          <div class="big">${att ? STATUS[att.s] : '—'}</div>
          <button class="btn alt" data-act="markToday" style="margin-top:8px">Mark karo</button></div>
        <div class="card"><div class="muted">Aaj ke kaam</div>
          <div class="big">${pending}<span class="muted"> baaki</span></div>
          <button class="btn alt" data-act="goto" data-tab="todo" style="margin-top:8px">Dekho</button></div>
      </div>
      <div class="card"><h2>Is mahine office</h2><div class="muted">Present ${a.P} · Half ${a.H} · Absent ${a.A} · Leave ${a.L} · Working days ${a.worked}</div></div>
      <div class="card"><h2>Backup</h2>
        <div class="grid2"><button class="btn" data-act="export">Export</button><button class="btn alt" data-act="import">Import</button></div>
        <div class="muted" style="margin-top:8px">Phone kho jaye to data na jaye, isliye time-time par backup bhej do (WhatsApp / Drive).</div></div>`;
  },

  money() {
    const S = db.get();
    const m = monthMoney(ym);
    const budgetRows = CATEGORIES.filter((c) => S.budgets[c] || m.byCat[c]).map((c) => {
      const spent = m.byCat[c] || 0, b = S.budgets[c] || 0;
      const pct = b ? Math.min(100, (spent / b) * 100) : 0;
      return `<div style="margin-bottom:10px"><div class="row between"><span>${c}</span>
        <span class="${b && spent > b ? 'bad' : 'muted'}">${inr(spent)}${b ? ' / ' + inr(b) : ''}${b && spent > b ? ' ⚠️ budget paar' : ''}</span></div>
        ${b ? `<div class="bar ${spent > b ? 'over' : ''}"><div style="width:${pct}%"></div></div>` : ''}</div>`;
    }).join('') || '<div class="muted">Abhi koi kharcha nahi.</div>';
    const list = [...m.tx].sort((a, b) => b.date.localeCompare(a.date)).map((t) => `
      <div class="item"><div class="grow"><div>${esc(t.category)}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="muted">${t.date}</div></div>
      <b class="${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${inr(t.amount)}</b>
      <button class="icon" data-act="delTx" data-id="${t.id}">🗑️</button></div>`).join('') || '<div class="muted">Is mahine koi entry nahi.</div>';
    return `${monthPicker()}
      <div class="card"><div class="row between"><div><div class="muted">Salary (har mahine)</div><b>${inr(m.salary)}</b></div>
        <button class="btn alt" style="width:auto" data-act="setSalary">Badlo</button></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
        <div class="grid2"><div><div class="muted">Kul income</div><b class="good">${inr(m.income)}</b></div>
        <div><div class="muted">Kharcha</div><b class="bad">${inr(m.expense)}</b></div></div>
        <div style="margin-top:8px" class="muted">Bacha hua</div><div class="big ${m.balance < 0 ? 'bad' : 'good'}">${inr(m.balance)}</div></div>
      <button class="btn" data-act="addTx" style="margin-bottom:12px">+ Entry jodo</button>
      <div class="card"><div class="row between"><h2>Category budget</h2><button class="icon" data-act="setBudget">✏️</button></div>${budgetRows}</div>
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
      cells += `<div class="d ${v ? 'st-' + v.s : ''}" data-act="markDay" data-date="${ds}">${d}${v ? `<small>${v.s}</small>` : ''}</div>`;
    }
    return `${monthPicker()}
      <div class="card"><div class="cal">${cells}</div>
        <div class="muted" style="margin-top:8px">P Present · A Absent · H Half-day · L Leave · O Holiday. Din par tap karo.</div></div>
      <div class="card"><h2>Summary</h2>
        <div class="grid2"><div>Present: <b>${a.P}</b></div><div>Absent: <b>${a.A}</b></div>
        <div>Half-day: <b>${a.H}</b></div><div>Leave: <b>${a.L}</b></div>
        <div>Holiday: <b>${a.O}</b></div><div>Working days: <b>${a.worked}</b></div></div></div>`;
  },

  todo() {
    const S = db.get();
    const t = today();
    let list = S.todos.filter((x) => (todoFilter === 'today' ? x.date === t : todoFilter === 'pending' ? !x.done : true));
    const rank = { high: 0, med: 1, low: 2 };
    list = list.sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date) || rank[a.pri] - rank[b.pri]);
    const rows = list.map((x) => `
      <div class="item"><input type="checkbox" style="width:24px;margin:0" ${x.done ? 'checked' : ''} data-act="toggleTodo" data-id="${x.id}">
        <div class="grow"><div class="${x.done ? 'done' : ''}">${esc(x.title)}</div>
        <div class="muted">${x.date}${x.time ? ' ⏰ ' + x.time : ''} · <span class="pri-${x.pri}">${x.pri}</span></div></div>
        <button class="icon" data-act="delTodo" data-id="${x.id}">🗑️</button></div>`).join('') || '<div class="muted">Koi kaam nahi.</div>';
    const chip = (k, l) => `<button class="${todoFilter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`;
    return `<button class="btn" data-act="addTodo" style="margin-bottom:12px">+ Naya kaam</button>
      <div class="chips">${chip('today', 'Aaj')}${chip('pending', 'Baaki')}${chip('all', 'Sab')}</div>
      <div class="card">${rows}</div>`;
  },

  rep() {
    return `${monthPicker()}
      <div class="card"><h2>Kharcha category-wise</h2><canvas id="c1"></canvas></div>
      <div class="card"><h2>Income vs Kharcha (6 mahine)</h2><canvas id="c2"></canvas></div>
      <div class="card"><h2>Attendance</h2><canvas id="c3"></canvas></div>
      <div class="card"><h2>To-do completion</h2><div id="todoRate" class="big"></div><div id="todoSub" class="muted"></div></div>`;
  },
};

function drawCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
  const m = monthMoney(ym), a = monthAtt(ym);
  const cats = Object.keys(m.byCat);
  const colors = ['#1f6feb', '#1a9b5b', '#f79009', '#d92d20', '#7a5af8', '#0ba5ec', '#ee46bc', '#667085'];
  charts.push(new Chart($('c1'), { type: 'pie', data: { labels: cats.length ? cats : ['Koi data nahi'], datasets: [{ data: cats.length ? cats.map((c) => m.byCat[c]) : [1], backgroundColor: cats.length ? colors : ['#ccc'] }] } }));
  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(ym, d));
  const mm = months.map(monthMoney);
  charts.push(new Chart($('c2'), { type: 'bar', data: { labels: months.map((x) => monthLabel(x).slice(0, 3)), datasets: [{ label: 'Income', data: mm.map((x) => x.income), backgroundColor: '#1a9b5b' }, { label: 'Kharcha', data: mm.map((x) => x.expense), backgroundColor: '#d92d20' }] } }));
  const hasAtt = a.P + a.A + a.H + a.L + a.O > 0;
  charts.push(new Chart($('c3'), { type: 'doughnut', data: { labels: hasAtt ? Object.values(STATUS) : ['Koi data nahi'], datasets: [{ data: hasAtt ? [a.P, a.A, a.H, a.L, a.O] : [1], backgroundColor: hasAtt ? ['#1a9b5b', '#d92d20', '#f79009', '#1f6feb', '#98a2b3'] : ['#ccc'] }] } }));
  const todos = db.get().todos.filter((x) => x.date.startsWith(ym));
  const done = todos.filter((x) => x.done).length;
  $('todoRate').textContent = todos.length ? Math.round((done / todos.length) * 100) + '%' : '—';
  $('todoSub').textContent = `${done} / ${todos.length} kaam poore`;
}

// ---------- forms ----------
const catOptions = () => CATEGORIES.map((c) => `<option>${c}</option>`).join('');

function addTxForm() {
  openModal(`<h2>Nayi entry</h2>
    <select id="f-type"><option value="expense">Kharcha</option><option value="income">Income (extra)</option></select>
    <input id="f-amt" type="number" inputmode="decimal" placeholder="Amount ₹">
    <select id="f-cat">${catOptions()}</select>
    <input id="f-note" placeholder="Note (optional)">
    <input id="f-date" type="date" value="${today()}">
    <button class="btn" data-act="saveTx">Save</button>`);
}

function addTodoForm() {
  openModal(`<h2>Naya kaam</h2>
    <input id="f-title" placeholder="Kya karna hai?">
    <input id="f-date" type="date" value="${today()}">
    <input id="f-time" type="time"><div class="muted" style="margin:-4px 0 8px">Time dalo to reminder aayega</div>
    <select id="f-pri"><option value="med">Medium</option><option value="high">High</option><option value="low">Low</option></select>
    <button class="btn" data-act="saveTodo">Save</button>`);
}

function markDayForm(date) {
  const v = db.get().attendance[date] || {};
  openModal(`<h2>${date}</h2>
    <div class="grid2">${Object.entries(STATUS).map(([k, l]) => `<button class="btn ${v.s === k ? '' : 'alt'}" data-act="setDay" data-date="${date}" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="row" style="margin-top:10px"><input id="f-in" type="time" value="${v.in || ''}"><input id="f-out" type="time" value="${v.out || ''}"></div>
    <div class="muted">In / Out time (optional) — pehle status chuno.</div>
    ${v.s ? `<button class="btn danger" style="margin-top:8px" data-act="clearDay" data-date="${date}">Hatao</button>` : ''}`);
}

function budgetForm() {
  const b = db.get().budgets;
  openModal(`<h2>Mahine ka budget</h2>${CATEGORIES.map((c) => `<div class="muted">${c}</div><input data-bud="${c}" type="number" inputmode="decimal" value="${b[c] || ''}" placeholder="0 = no limit">`).join('')}
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
    await LocalNotifications.schedule({ notifications: [{ id: notifId(todo.id), title: 'Kaam yaad dilana', body: todo.title, schedule: { at, allowWhileIdle: true } }] });
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
    await Share.share({ title: name, url: r.uri, dialogTitle: 'Backup bhejo' });
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
    if (!f || !confirm('Abhi ka sara data replace ho jayega. Aage badhein?')) return;
    try { await db.importJson(await f.text()); render(); toast('Data wapas aa gaya ✅'); } catch (e) { toast(e.message); }
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
    db.get().attendance[date] = { s: el.dataset.s, in: $('f-in').value, out: $('f-out').value };
    closeModal(); await commit();
  },
  clearDay: async (el) => { delete db.get().attendance[el.dataset.date]; closeModal(); await commit(); },
  setSalary: async () => {
    const v = prompt('Monthly salary (₹)', db.get().settings.salary || '');
    if (v === null) return;
    const n = Number(v);
    if (!isFinite(n) || n < 0) return toast('Sahi amount dalo');
    db.get().settings.salary = n; await commit();
  },
  addTx: addTxForm,
  saveTx: async () => {
    const amount = Number($('f-amt').value);
    if (!(amount > 0)) return toast('Amount dalo');
    db.get().transactions.push({ id: db.uid(), type: $('f-type').value, amount, category: $('f-cat').value, note: $('f-note').value.trim(), date: $('f-date').value || today() });
    closeModal(); await commit();
  },
  delTx: async (el) => {
    if (!confirm('Entry hatayein?')) return;
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
    if (!title) return toast('Kaam likho');
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
    if (!confirm('Kaam hatayein?')) return;
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
  $('top').innerHTML = `<h1>${TABS.find((t) => t[0] === tab)[2]}</h1><span class="muted" style="color:#fff">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>`;
  $('view').innerHTML = views[tab]();
  $('tabs').innerHTML = TABS.map(([k, ic, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="goto" data-tab="${k}"><span>${ic}</span>${l}</button>`).join('');
  if (tab === 'rep') drawCharts();
}

db.init().then(render).catch((e) => { document.body.textContent = 'Database error: ' + e.message; });
