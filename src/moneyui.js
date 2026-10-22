import * as db from './db.js';
import { today, dayName } from './dates.js';
import * as M from './money.js';

const SOURCES = [['salary', 'Salary'], ['zomato', 'Zomato'], ['other', 'Other']];
const BILL_KINDS = [['loan', 'Loan EMI'], ['family', 'Family'], ['fixed', 'Fixed bill'], ['sip', 'SIP']];
const KIND_LABEL = Object.fromEntries(BILL_KINDS);
const KIND_COLOR = { loan: '#f87171', family: '#a78bfa', fixed: '#fbbf24', sip: '#4ade80' };
const FIXED_CATS = ['Groceries', 'Bills', 'Rent', 'Other'];
const INV_TYPES = ['Digital gold', 'Mutual fund', 'FD / RD', 'Stocks', 'Other'];

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const ordinal = (n) => n + ['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10];

// The Money tab: Overview | Bills | Invest | Lent. Created once by main.js with the shared UI helpers.
export function createMoney(d) {
  const { ui, openModal, closeModal, commit, esc, inr, svg, dot, monthPicker, getYm, syncNotifications, showLayer, hideLayer, categories } = d;
  const S = () => db.get();
  const $ = (id) => document.getElementById(id);
  let tab = 'overview';
  let lentFilter = 'active';
  let md = {}; // draft of whichever form is open

  const refresh = async () => { await commit(); syncNotifications(); };
  const monthName = (m) => new Date(`${m}-01T00:00`).toLocaleDateString('en-IN', { month: 'long' });

  // replace the content of the open sheet in place (no slide-up replay), or open it
  const setSheet = (html) => {
    const sheet = document.querySelector('#modal .sheet');
    if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
  };

  const chipRow = (g, items, selected) => `<div class="chips wrap" id="g-${g}">${items.map(([v, l]) => `<button class="${v === selected ? 'on' : ''}" data-act="mChip" data-g="${g}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const peopleChips = (g, selected) => `<div class="chips wrap" id="g-${g}">${S().people.map((p) => `<button class="${p === selected ? 'on' : ''}" data-act="mChip" data-g="${g}" data-v="${esc(p)}" data-toggle="1">${esc(p)}</button>`).join('')}<button data-act="newPerson" data-g="${g}">+ New</button></div>`;
  const addPerson = (name) => { if (name && !S().people.includes(name)) S().people.push(name); };

  // ---------- popups: due-day grid ----------
  function pickDay(value, title = 'Due day of the month') {
    return new Promise((resolve) => {
      const el = $('dialog');
      el.innerHTML = `<div class="dlg tp"><h2>${esc(title)}</h2><div class="day-grid">${Array.from({ length: 31 }, (_, i) => `<button data-d="${i + 1}" class="${i + 1 === value ? 'on' : ''}">${i + 1}</button>`).join('')}</div><div class="muted" style="margin-top:12px">Months with fewer days use their last day.</div></div>`;
      showLayer(el);
      const finish = (v) => { el.onclick = null; hideLayer(el); resolve(v); };
      el.onclick = (e) => {
        const b = e.target.closest('[data-d]');
        if (b) finish(Number(b.dataset.d)); else if (e.target === el) finish(null);
      };
    });
  }

  // ---------- views ----------
  function view() {
    const s = S();
    const unpaid = M.billsFor(s, today().slice(0, 7)).filter((b) => !b.paid).length;
    const tabs = `<div class="chips subtabs scroll">${[['overview', 'Overview'], ['bills', 'Bills'], ['invest', 'Invest'], ['lent', 'Lent'], ['report', 'Report']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="mTab" data-v="${k}">${l}${k === 'bills' && unpaid ? `<i>${unpaid}</i>` : ''}</button>`).join('')}</div>`;
    const body = tab === 'bills' ? billsView() : tab === 'invest' ? investView() : tab === 'lent' ? lentView() : tab === 'report' ? reportView() : overview();
    return tabs + body;
  }

  function overview() {
    const s = S(), ym = getYm();
    const m = M.monthStats(s, ym);
    const sp = M.safeToSpend(s);
    const short = new Date(`${ym}-01T00:00`).toLocaleDateString('en-IN', { month: 'short' });
    const note = sp.salaryLate ? 'Salary is not added yet. Add it to plan the month.'
      : sp.perDay !== null ? `${inr(sp.perDay)} a day for ${sp.days} day${sp.days === 1 ? '' : 's'} until salary`
        : 'Set your salary day in Settings to see a daily limit.';

    const budgetRows = categories.filter((c) => s.budgets[c] || m.byCat[c]).map((c) => {
      const spent = m.byCat[c] || 0, b = s.budgets[c] || 0;
      return `<div style="margin-bottom:14px"><div class="row between"><span>${c}</span>
        <span class="${b && spent > b ? 'bad' : 'muted'}">${inr(spent)}${b ? ' / ' + inr(b) : ''}${b && spent > b ? ' · over budget' : ''}</span></div>
        ${b ? `<div class="bar ${spent > b ? 'over' : ''}"><div style="width:${Math.min(100, (spent / b) * 100)}%"></div></div>` : ''}</div>`;
    }).join('') || '<div class="muted">No expenses yet.</div>';

    const sources = Object.entries(m.bySource);
    const people = Object.entries(m.byPerson).sort((a, b) => b[1] - a[1]);
    const rows = [...m.tx].sort((a, b) => b.date.localeCompare(a.date)).map((t) => `
      <div class="item tap" data-act="editTx" data-id="${t.id}">${dot(t.type === 'income' ? '#4ade80' : '#f87171')}
        <div class="grow"><div>${esc(t.category)}${t.person ? ` <span class="ptag">${esc(t.person)}</span>` : ''}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="muted">${dayName(t.date)}</div></div>
        <b class="${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${inr(t.amount)}</b>
        <button class="icon" data-act="delTx" data-id="${t.id}" aria-label="Delete">${svg('trash')}</button></div>`).join('') || '<div class="muted">No entries this month.</div>';

    return `${monthPicker()}
      <div class="hero"><div class="label">Wallet balance</div><div class="num" data-count="${sp.wallet}">${inr(sp.wallet)}</div><hr>
        <div class="grid2"><div><div class="label">In · ${short}</div><div class="val" style="color:#fff">${inr(m.income)}</div></div>
        <div><div class="label">Out · ${short}</div><div class="val" style="color:#fff">${inr(m.expense)}</div></div></div></div>
      <div class="card safe"><div class="label">Safe to spend</div><div class="num ${sp.safe < 0 ? 'bad' : ''}" style="margin:6px 0">${inr(sp.safe)}</div>
        <div class="sec">${note}</div><div class="muted" style="margin-top:6px">After ${inr(sp.bills)} of bills still to pay</div></div>
      <div class="grid2 top-actions"><button class="btn" data-act="addIncome">+ Income</button><button class="btn alt" data-act="addExpense">+ Expense</button></div>
      ${sources.length ? `<div class="card"><h2>Income this month</h2>${sources.map(([k, v]) => `<div class="row between" style="padding:6px 0"><span>${esc(k)}</span><b class="good">+${inr(v)}</b></div>`).join('')}</div>` : ''}
      <div class="card"><div class="row between"><h2 style="margin:0">Spending by category</h2><button class="icon" data-act="setBudget" aria-label="Edit budgets">${svg('edit')}</button></div><div style="height:12px"></div>${budgetRows}</div>
      ${people.length ? `<div class="card"><h2>Given to people</h2>${people.map(([p, v]) => `<div class="row between" style="padding:6px 0"><span>${esc(p)}</span><b class="bad">${inr(v)}</b></div>`).join('')}</div>` : ''}
      <div class="card"><h2>Entries</h2>${rows}</div>`;
  }

  // the charts themselves are drawn by main.js after render (it owns Chart.js)
  function reportView() {
    const ym = getYm();
    const m = M.monthStats(S(), ym);
    const saved = m.income - m.expense;
    return `${monthPicker()}
      <div class="card"><div class="grid2"><div><div class="label">Earned</div><div class="val good" style="margin-top:6px">${inr(m.income)}</div></div><div><div class="label">Spent</div><div class="val bad" style="margin-top:6px">${inr(m.expense)}</div></div></div>
        <div class="muted" style="margin-top:14px">${saved >= 0 ? 'Saved' : 'Overspent'} ${inr(Math.abs(saved))} in ${monthName(ym)}</div></div>
      <div class="card chart-card"><h2>Spending by category</h2><div class="chart-box tall"><canvas id="c1"></canvas></div></div>
      <div class="card chart-card"><h2>Income vs expenses · 6 months</h2><div class="chart-box"><canvas id="c2"></canvas></div></div>`;
  }

  function billsView() {
    const s = S(), t = today(), m = t.slice(0, 7);
    const list = M.billsFor(s, m, t);
    const total = sum(list, (b) => Number(b.c.amount) || 0);
    const paidAmt = sum(list.filter((b) => b.paid), (b) => Number(b.c.amount) || 0);
    const left = list.filter((b) => !b.paid).length;
    const rows = list.map((b) => {
      const c = b.c;
      const emis = M.emisLeft(c, m, b.paid);
      const status = b.paid ? '<span class="good">Paid</span>' : b.late ? `<span class="bad">${b.late} day${b.late === 1 ? '' : 's'} late · was due ${dayName(b.due)}</span>` : `Due ${dayName(b.due)}`;
      return `<div class="mrow ${b.paid ? 'paid' : ''}" style="--k:${KIND_COLOR[c.kind]}">
        <div class="grow" data-act="editBill" data-id="${c.id}"><div class="m-title">${esc(c.name)}</div>
          <div class="m-sub">${KIND_LABEL[c.kind]}${c.person ? ' · ' + esc(c.person) : ''}${emis !== null ? ` · ${emis} EMI${emis === 1 ? '' : 's'} left` : ''}</div>
          <div class="m-sub">${status}</div></div>
        <div class="m-right"><b>${inr(c.amount)}</b>${b.paid ? `<button class="pill ghost" data-act="unpay" data-id="${c.id}">Undo</button>` : `<button class="pill" data-act="payBill" data-id="${c.id}">Pay</button>`}</div></div>`;
    }).join('');
    return `<button class="btn" data-act="addBill">+ Add bill</button>
      <div class="card"><div class="row between"><h2 style="margin:0">${monthName(m)} bills</h2><b>${inr(paidAmt)} / ${inr(total)}</b></div>
        <div class="bar"><div style="width:${total ? (paidAmt / total) * 100 : 0}%"></div></div>
        <div class="muted" style="margin-top:8px">${list.length ? `${left} to pay · ${inr(total - paidAmt)} left this month` : 'Loans, groceries, money for family, SIPs: add anything that repeats every month.'}</div></div>
      ${rows}`;
  }

  function investView() {
    const invs = S().investments;
    const invested = sum(invs, M.investedOf);
    const value = sum(invs, M.currentValue);
    const gain = value - invested;
    const cards = invs.map((i) => {
      const inv = M.investedOf(i), val = M.currentValue(i), g = val - inv;
      return `<div class="card inv" data-act="openInvest" data-id="${i.id}"><div class="row between"><b class="m-title">${esc(i.name)}</b><span class="tag">${esc(i.type)}</span></div>
        <div class="grid2" style="margin-top:12px"><div><div class="label">Invested</div><div class="val">${inr(inv)}</div></div><div><div class="label">Value now</div><div class="val">${inr(val)}</div></div></div>
        <div class="${g >= 0 ? 'good' : 'bad'}" style="margin-top:8px;font-size:13px">${g >= 0 ? '+' : '-'}${inr(Math.abs(g))}${inv > 0 ? ` (${g >= 0 ? '+' : ''}${((g / inv) * 100).toFixed(1)}%)` : ''}</div></div>`;
    }).join('');
    return `<button class="btn" data-act="addInvest">+ Add investment</button>
      <div class="hero"><div class="label">Total invested</div><div class="num">${inr(invested)}</div><hr>
        <div class="grid2"><div><div class="label">Value now</div><div class="val" style="color:#fff">${inr(value)}</div></div>
        <div><div class="label">Gain / loss</div><div class="val" style="color:#fff">${gain >= 0 ? '+' : '-'}${inr(Math.abs(gain))}</div></div></div></div>
      ${cards || '<div class="empty"><b>No investments yet</b><span>Add digital gold, mutual funds or an FD to see them next to your wallet.</span></div>'}`;
  }

  const lentRow = (l) => {
    const left = M.lentLeft(l), back = M.returnedOf(l);
    return `<div class="mrow" style="--k:#818cf8"><div class="grow"><div class="m-title">${inr(left)} <span class="m-sub">of ${inr(l.amount)}</span></div>
      <div class="m-sub">${dayName(l.date)}${l.note ? ' · ' + esc(l.note) : ''}${l.due && left > 0 ? ` · back by ${dayName(l.due)}` : ''}</div>
      ${back > 0 ? `<div class="bar"><div style="width:${Math.min(100, (back / l.amount) * 100)}%"></div></div>` : ''}</div>
      <div class="m-right">${left > 0 ? `<button class="pill" data-act="gotBack" data-id="${l.id}">Got back</button>` : '<span class="good m-sub">Settled</span>'}<button class="icon" data-act="delLend" data-id="${l.id}" aria-label="Delete">${svg('trash')}</button></div></div>`;
  };

  function lentView() {
    const all = S().lent;
    const active = all.filter((l) => M.lentLeft(l) > 0);
    const total = sum(active, M.lentLeft);
    const chip = (k, l) => `<button class="${lentFilter === k ? 'on' : ''}" data-act="lentFilter" data-v="${k}">${l}</button>`;
    let body;
    if (lentFilter === 'settled') {
      const done = all.filter((l) => M.lentLeft(l) <= 0);
      body = done.length ? done.map(lentRow).join('') : '<div class="empty"><b>Nothing settled yet</b></div>';
    } else if (!active.length) {
      body = '<div class="empty"><b>No money lent out</b><span>Lend money to a friend or family and track it until it comes back.</span></div>';
    } else {
      const by = {};
      active.forEach((l) => { (by[l.person] = by[l.person] || []).push(l); });
      body = Object.entries(by).map(([p, items]) => `<section class="day"><div class="day-head"><div><b>${esc(p)}</b><span>${items.length} record${items.length === 1 ? '' : 's'}</span></div><i>${inr(sum(items, M.lentLeft))}</i></div>${items.map(lentRow).join('')}</section>`).join('');
    }
    return `<button class="btn" data-act="addLend">+ Lend money</button>
      <div class="card"><div class="label">To get back</div><div class="num" style="margin-top:6px">${inr(total)}</div><div class="muted" style="margin-top:6px">${active.length} open record${active.length === 1 ? '' : 's'}</div></div>
      <div class="chips">${chip('active', 'Active')}${chip('settled', 'Settled')}</div>${body}`;
  }

  // ---------- income and expense forms ----------
  function incomeForm(source = 'salary', edit = null) {
    md = { source: edit ? edit.source || 'other' : source, id: edit ? edit.id : '' };
    const amount = edit ? edit.amount : md.source === 'salary' && S().settings.salaryAmount ? S().settings.salaryAmount : '';
    openModal(`<h2>${edit ? 'Edit income' : 'Add income'}</h2>
      <span class="label">Source</span>${chipRow('source', SOURCES, md.source)}
      <input id="m-amt" type="number" inputmode="decimal" placeholder="Amount ₹" value="${amount}">
      <input id="m-note" placeholder="Note (optional)" value="${edit ? esc(edit.note || '') : ''}" autocomplete="off">
      <input id="m-date" type="date" value="${edit ? edit.date : today()}">
      <button class="btn" data-act="saveIncome">Save</button>`);
  }

  function expenseForm(edit = null) {
    md = { cat: edit ? edit.category : 'Food', person: edit ? edit.person || '' : '', id: edit ? edit.id : '' };
    openModal(`<h2>${edit ? 'Edit expense' : 'New expense'}</h2>
      <input id="m-amt" type="number" inputmode="decimal" placeholder="Amount ₹" value="${edit ? edit.amount : ''}">
      <span class="label">Category</span>${chipRow('cat', categories.map((c) => [c, c]), md.cat)}
      <span class="label">Paid to (optional)</span>${peopleChips('person', md.person)}
      <input id="m-note" placeholder="Note (optional)" value="${edit ? esc(edit.note || '') : ''}" autocomplete="off">
      <input id="m-date" type="date" value="${edit ? edit.date : today()}">
      <button class="btn" data-act="saveExpense">Save</button>`);
  }

  async function budgetAlert(cat, date) {
    const b = S().budgets[cat];
    if (!b) return;
    const spent = M.monthStats(S(), date.slice(0, 7)).byCat[cat] || 0;
    if (spent > b) await ui.alert(`${cat} is over budget: ${inr(spent)} spent of ${inr(b)}.`, 'Budget alert');
    else if (spent >= b * 0.8) await ui.alert(`${cat}: ${Math.round((spent / b) * 100)}% of the budget is used.`, 'Budget alert');
  }

  // ---------- bills ----------
  function billExtra() {
    const s = S();
    if (md.kind === 'loan') return `<span class="label">EMIs left (optional)</span><input id="b-left" type="number" inputmode="numeric" placeholder="e.g. 12" value="${md.left || ''}">`;
    if (md.kind === 'family') return `<span class="label">Who gets it</span>${peopleChips('bperson', md.bperson)}`;
    if (md.kind === 'fixed') return `<span class="label">Category</span>${chipRow('bcat', FIXED_CATS.map((c) => [c, c]), md.bcat)}`;
    if (!s.investments.length) return '<div class="muted" style="margin-bottom:12px">Add an investment first (Invest tab), then link the SIP to it.</div>';
    return `<span class="label">Goes into</span>${chipRow('binv', s.investments.map((i) => [i.id, i.name]), md.binv)}`;
  }

  function billForm(edit = null) {
    const m = today().slice(0, 7);
    md = {
      id: edit ? edit.id : '', kind: edit ? edit.kind : 'loan', day: edit ? edit.dueDay : Number(today().slice(8)),
      bperson: edit ? edit.person || '' : '', bcat: edit ? edit.category || 'Bills' : 'Groceries', binv: edit ? edit.investmentId || '' : '',
      left: edit && edit.endMonth ? M.emisLeft(edit, m, !!(edit.paid || {})[m]) : '',
    };
    openModal(`<h2>${edit ? 'Edit bill' : 'Add bill'}</h2>
      <span class="label">Type</span>${chipRow('kind', BILL_KINDS, md.kind)}
      <input id="b-name" placeholder="Name, e.g. Bike EMI, Groceries, Mummy" value="${edit ? esc(edit.name) : ''}" autocomplete="off">
      <input id="b-amt" type="number" inputmode="decimal" placeholder="Amount per month ₹" value="${edit ? edit.amount : ''}">
      <span class="label">Due day</span><button class="capsule set" id="b-day" data-act="pickBillDay"><span>${ordinal(md.day)} of every month</span></button>
      <div id="bill-extra">${billExtra()}</div>
      <button class="btn" data-act="saveBill">Save</button>
      ${edit ? '<button class="btn danger" style="margin-top:10px" data-act="delBill">Delete bill</button>' : ''}`);
  }

  function payForm(c) {
    md = { id: c.id, ym: today().slice(0, 7) };
    openModal(`<h2>Pay ${esc(c.name)}</h2>
      <div class="muted" style="margin:-8px 0 14px">${c.kind === 'sip' ? 'The amount goes into your investment.' : 'This is added to your expenses.'}</div>
      <span class="label">Amount ₹</span><input id="m-amt" type="number" inputmode="decimal" value="${c.amount}">
      <span class="label">Date</span><input id="m-date" type="date" value="${today()}">
      <button class="btn" data-act="confirmPay">Mark paid</button>`);
  }

  function unlinkPaid(id) {
    S().commitments.forEach((c) => { Object.keys(c.paid || {}).forEach((k) => { if (c.paid[k] === id) delete c.paid[k]; }); });
  }

  // ---------- investments ----------
  function investSheet(id) {
    const i = S().investments.find((x) => x.id === id);
    if (!i) return;
    const inv = M.investedOf(i), val = M.currentValue(i), g = val - inv;
    const entries = [...i.entries].sort((a, b) => b.date.localeCompare(a.date)).map((e) => `<div class="log-row"><div class="log-top"><b class="${e.amount < 0 ? 'bad' : 'good'}">${e.amount < 0 ? '-' : '+'}${inr(Math.abs(e.amount))}</b><span>${dayName(e.date)}</span></div>
      <div class="log-res">${e.w === false ? 'Already invested before' : e.note || (e.amount < 0 ? 'Withdrawn to wallet' : 'From wallet')}</div>
      <button class="icon" style="float:right;margin-top:-34px" data-act="invDelEntry" data-id="${i.id}" data-eid="${e.id}" aria-label="Delete entry">${svg('trash')}</button></div>`).join('') || '<div class="muted">No entries.</div>';
    setSheet(`<h2>${esc(i.name)}</h2><div class="muted" style="margin:-8px 0 14px">${esc(i.type)}</div>
      <div class="grid2"><div><div class="label">Invested</div><div class="val">${inr(inv)}</div></div><div><div class="label">Value now</div><div class="val">${inr(val)}</div></div></div>
      <div class="${g >= 0 ? 'good' : 'bad'}" style="margin:8px 0 16px;font-size:13px">${g >= 0 ? '+' : '-'}${inr(Math.abs(g))}${inv > 0 ? ` (${((g / inv) * 100).toFixed(1)}%)` : ''}</div>
      <div class="grid2"><button class="btn" data-act="invAdd" data-id="${i.id}">+ Add money</button><button class="btn alt" data-act="invWithdraw" data-id="${i.id}">Withdraw</button></div>
      <button class="btn alt" style="margin-top:10px" data-act="invValue" data-id="${i.id}">Update value now</button>
      <div class="label" style="margin:18px 0 6px">History</div><div class="log-list">${entries}</div>
      <button class="btn danger" style="margin-top:12px" data-act="invDelete" data-id="${i.id}">Delete investment</button>`);
  }

  function lendForm() {
    md = { lperson: '', w: 'yes' };
    openModal(`<h2>Lend money</h2>
      <span class="label">To whom</span>${peopleChips('lperson', '')}
      <input id="m-amt" type="number" inputmode="decimal" placeholder="Amount ₹">
      <input id="m-note" placeholder="Note (optional)" autocomplete="off">
      <span class="label">Date given</span><input id="m-date" type="date" value="${today()}">
      <span class="label">Expected back by (optional)</span><input id="m-due" type="date">
      <span class="label">Wallet</span>${chipRow('w', [['yes', 'Deduct from wallet'], ['no', 'Given earlier']], 'yes')}
      <button class="btn" data-act="saveLend">Save</button>`);
  }

  function openWeekly() {
    const w = M.weekStats(S());
    const diff = w.prevTotal ? Math.round(((w.total - w.prevTotal) / w.prevTotal) * 100) : null;
    openModal(`<h2>Your week in money</h2><div class="muted" style="margin:-8px 0 14px">Since ${dayName(w.from)}</div>
      <div class="label">Spent this week</div><div class="num" style="margin:6px 0">${inr(w.total)}</div>
      <div class="sec" style="margin-bottom:16px">${diff === null ? 'No spending last week to compare.' : `${Math.abs(diff)}% ${diff > 0 ? 'more' : 'less'} than last week (${inr(w.prevTotal)})`} · ${w.count} entr${w.count === 1 ? 'y' : 'ies'}</div>
      ${w.top.length ? `<div class="label" style="margin-bottom:6px">Top categories</div>${w.top.map(([c, v]) => `<div class="row between" style="padding:6px 0"><span>${esc(c)}</span><b>${inr(v)}</b></div>`).join('')}` : ''}
      <div class="muted" style="margin:12px 0">Wallet now: ${inr(M.wallet(S()))}</div>
      <button class="btn" data-act="closeModal">Done</button>`);
  }

  // ---------- actions ----------
  const actions = {
    mTab: (el) => { tab = el.dataset.v; d.render('fade'); },
    lentFilter: (el) => { lentFilter = el.dataset.v; d.render(); },
    mChip: (el) => {
      const g = el.dataset.g, v = el.dataset.v;
      md[g] = el.dataset.toggle && md[g] === v ? '' : v;
      document.querySelectorAll(`[data-act="mChip"][data-g="${g}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === md[g]));
      if (g === 'source' && v === 'salary') {
        const a = $('m-amt');
        if (a && !a.value && S().settings.salaryAmount) a.value = S().settings.salaryAmount;
      }
      if (g === 'kind') $('bill-extra').innerHTML = billExtra();
    },
    newPerson: async (el) => {
      const g = el.dataset.g;
      const name = await ui.text('New person', '', 'e.g. Rahul');
      if (!name) return;
      addPerson(name);
      md[g] = name;
      await db.save();
      $(`g-${g}`).outerHTML = peopleChips(g, name);
    },

    addIncome: () => incomeForm('salary'),
    addExpense: () => expenseForm(),
    editTx: (el) => {
      const t = S().transactions.find((x) => x.id === el.dataset.id);
      if (!t) return;
      if (t.type === 'income') incomeForm(t.source || 'other', t); else expenseForm(t);
    },
    saveIncome: async () => {
      const amount = Number($('m-amt').value);
      if (!(amount > 0)) return ui.alert('Enter an amount');
      const label = SOURCES.find(([k]) => k === md.source)[1];
      const data = { type: 'income', source: md.source, category: label, amount, note: $('m-note').value.trim(), date: $('m-date').value || today() };
      if (md.id) Object.assign(S().transactions.find((x) => x.id === md.id), data); else S().transactions.push({ id: db.uid(), ...data });
      closeModal();
      await refresh();
    },
    saveExpense: async () => {
      const amount = Number($('m-amt').value);
      if (!(amount > 0)) return ui.alert('Enter an amount');
      const data = { type: 'expense', amount, category: md.cat, person: md.person || '', note: $('m-note').value.trim(), date: $('m-date').value || today() };
      if (md.id) Object.assign(S().transactions.find((x) => x.id === md.id), data); else S().transactions.push({ id: db.uid(), ...data });
      if (data.person) addPerson(data.person);
      closeModal();
      await refresh();
      await budgetAlert(data.category, data.date);
    },
    delTx: async (el) => {
      if (!(await ui.confirm('This entry will be removed.', { title: 'Delete entry', ok: 'Delete', danger: true }))) return;
      S().transactions = S().transactions.filter((t) => t.id !== el.dataset.id);
      unlinkPaid(el.dataset.id);
      await refresh();
    },
    setBudget: () => {
      const b = S().budgets;
      openModal(`<h2>Monthly budgets</h2>${categories.map((c) => `<span class="label">${c}</span><input data-bud="${c}" type="number" inputmode="decimal" value="${b[c] || ''}" placeholder="0 = no limit">`).join('')}
        <button class="btn" data-act="saveBudget">Save</button>`);
    },
    saveBudget: async () => {
      const b = {};
      document.querySelectorAll('[data-bud]').forEach((i) => { const n = Number(i.value); if (n > 0) b[i.dataset.bud] = n; });
      S().budgets = b;
      closeModal();
      await commit();
    },

    addBill: () => billForm(),
    editBill: (el) => billForm(S().commitments.find((c) => c.id === el.dataset.id)),
    pickBillDay: async () => {
      const v = await pickDay(md.day);
      if (v) { md.day = v; $('b-day').innerHTML = `<span>${ordinal(v)} of every month</span>`; }
    },
    saveBill: async () => {
      const amount = Number($('b-amt').value);
      let name = $('b-name').value.trim();
      if (!name && md.kind === 'family') name = md.bperson;
      if (!name) return ui.alert('Give this bill a name');
      if (!(amount > 0)) return ui.alert('Enter the monthly amount');
      if (md.kind === 'sip' && !md.binv) return ui.alert('Choose the investment this SIP goes into');
      const cur = today().slice(0, 7);
      const old = md.id ? S().commitments.find((c) => c.id === md.id) : null;
      const left = md.kind === 'loan' ? Number(($('b-left') || {}).value) : 0;
      const c = {
        ...(old || { id: db.uid(), paid: {}, active: true, startMonth: cur }),
        kind: md.kind, name, amount, dueDay: md.day,
        person: md.kind === 'family' ? md.bperson : '',
        category: md.kind === 'fixed' ? md.bcat : '',
        investmentId: md.kind === 'sip' ? md.binv : '',
        endMonth: left > 0 ? M.shiftMonth(cur, left - 1 + (old && (old.paid || {})[cur] ? 1 : 0)) : '',
      };
      if (md.bperson) addPerson(md.bperson);
      if (old) Object.assign(old, c); else S().commitments.push(c);
      closeModal();
      await refresh();
    },
    delBill: async () => {
      if (!(await ui.confirm('Past payments stay in your entries.', { title: 'Delete this bill?', ok: 'Delete', danger: true }))) return;
      S().commitments = S().commitments.filter((c) => c.id !== md.id);
      closeModal();
      await refresh();
    },
    payBill: (el) => payForm(S().commitments.find((c) => c.id === el.dataset.id)),
    confirmPay: async () => {
      const c = S().commitments.find((x) => x.id === md.id);
      const amount = Number($('m-amt').value);
      if (!c || !(amount > 0)) return ui.alert('Enter an amount');
      const date = $('m-date').value || today();
      const id = db.uid();
      if (c.kind === 'sip') {
        const inv = S().investments.find((i) => i.id === c.investmentId);
        if (!inv) return ui.alert('The linked investment was deleted. Edit this bill and pick another.');
        inv.entries.push({ id, date, amount, w: true, note: 'SIP' });
      } else {
        const category = c.kind === 'loan' ? 'Loan EMI' : c.kind === 'family' ? 'Family' : c.category || 'Bills';
        S().transactions.push({ id, type: 'expense', amount, category, person: c.person || '', note: c.name, date, linkId: c.id });
      }
      c.paid = { ...(c.paid || {}), [md.ym]: id };
      closeModal();
      await refresh();
    },
    unpay: async (el) => {
      const c = S().commitments.find((x) => x.id === el.dataset.id);
      const m = today().slice(0, 7);
      const id = c && (c.paid || {})[m];
      if (!id) return;
      S().transactions = S().transactions.filter((t) => t.id !== id);
      S().investments.forEach((i) => { i.entries = i.entries.filter((e) => e.id !== id); });
      delete c.paid[m];
      await refresh();
    },

    addInvest: () => {
      md = { itype: 'Digital gold' };
      openModal(`<h2>Add investment</h2>
        <input id="i-name" placeholder="Name, e.g. Gold on PhonePe, Nifty 50 fund" autocomplete="off">
        <span class="label">Type</span>${chipRow('itype', INV_TYPES.map((t) => [t, t]), md.itype)}
        <input id="i-amt" type="number" inputmode="decimal" placeholder="Already invested ₹ (optional)">
        <input id="i-val" type="number" inputmode="decimal" placeholder="Value now ₹ (optional)">
        <div class="muted" style="margin:-2px 0 14px">Money you already invested does not change your wallet. Use Add money later for new investments.</div>
        <button class="btn" data-act="saveInvest">Save</button>`);
    },
    saveInvest: async () => {
      const name = $('i-name').value.trim();
      if (!name) return ui.alert('Give it a name');
      const amt = Number($('i-amt').value), val = $('i-val').value;
      S().investments.push({ id: db.uid(), name, type: md.itype, value: val === '' ? null : Number(val), entries: amt > 0 ? [{ id: db.uid(), date: today(), amount: amt, w: false, note: 'Opening' }] : [] });
      closeModal();
      await commit();
    },
    openInvest: (el) => investSheet(el.dataset.id),
    invAdd: async (el) => {
      const v = await ui.prompt('Add money', '', 'Amount ₹ (taken from wallet)');
      const n = Number(v);
      if (v === null || !(n > 0)) return;
      S().investments.find((i) => i.id === el.dataset.id).entries.push({ id: db.uid(), date: today(), amount: n, w: true });
      await commit(); investSheet(el.dataset.id);
    },
    invWithdraw: async (el) => {
      const v = await ui.prompt('Withdraw to wallet', '', 'Amount ₹');
      const n = Number(v);
      if (v === null || !(n > 0)) return;
      S().investments.find((i) => i.id === el.dataset.id).entries.push({ id: db.uid(), date: today(), amount: -n, w: true });
      await commit(); investSheet(el.dataset.id);
    },
    invValue: async (el) => {
      const i = S().investments.find((x) => x.id === el.dataset.id);
      const v = await ui.prompt('Value now', i.value === null ? '' : i.value, 'Current value ₹');
      if (v === null) return;
      i.value = v === '' ? null : Number(v);
      await commit(); investSheet(i.id);
    },
    invDelEntry: async (el) => {
      const i = S().investments.find((x) => x.id === el.dataset.id);
      i.entries = i.entries.filter((e) => e.id !== el.dataset.eid);
      unlinkPaid(el.dataset.eid);
      await commit(); investSheet(i.id);
    },
    invDelete: async (el) => {
      if (!(await ui.confirm('The money goes back to your wallet.', { title: 'Delete investment?', ok: 'Delete', danger: true }))) return;
      S().investments = S().investments.filter((i) => i.id !== el.dataset.id);
      closeModal();
      await commit();
    },

    addLend: lendForm,
    saveLend: async () => {
      const amount = Number($('m-amt').value);
      if (!md.lperson) return ui.alert('Choose who you lent to');
      if (!(amount > 0)) return ui.alert('Enter an amount');
      S().lent.push({ id: db.uid(), person: md.lperson, amount, note: $('m-note').value.trim(), date: $('m-date').value || today(), due: $('m-due').value || '', w: md.w !== 'no', returns: [] });
      closeModal();
      await refresh();
    },
    gotBack: async (el) => {
      const l = S().lent.find((x) => x.id === el.dataset.id);
      const left = M.lentLeft(l);
      const v = await ui.prompt(`${l.person} returned`, left, 'Amount ₹');
      const n = Number(v);
      if (v === null || !(n > 0)) return;
      l.returns.push({ id: db.uid(), date: today(), amount: Math.min(n, left) });
      await refresh();
    },
    delLend: async (el) => {
      if (!(await ui.confirm('This record will be removed and your wallet is adjusted.', { title: 'Delete record?', ok: 'Delete', danger: true }))) return;
      S().lent = S().lent.filter((l) => l.id !== el.dataset.id);
      await refresh();
    },

    openWeekly,
    setSalaryDay: async () => {
      const v = await pickDay(Number(S().settings.salaryDay) || 11, 'Salary day');
      if (!v) return;
      S().settings.salaryDay = v;
      await refresh();
    },
    setSalaryAmt: async () => {
      const v = await ui.prompt('Expected salary', S().settings.salaryAmount || '', 'e.g. 20000');
      if (v === null) return;
      S().settings.salaryAmount = Math.max(0, Number(v) || 0);
      await commit();
    },
    setOpening: async () => {
      const v = await ui.prompt('Opening balance', S().settings.openingBalance || '', 'Money you already have ₹');
      if (v === null) return;
      S().settings.openingBalance = Math.max(0, Number(v) || 0);
      await commit();
    },
  };

  return {
    view,
    actions,
    openIncome: (source) => incomeForm(source),
    openWeekly,
    setTab: (k) => { tab = k; },
    getTab: () => tab,
  };
}
