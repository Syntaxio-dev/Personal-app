import * as db from './db.js';
import { today, dayName, addDays } from './dates.js';
import * as M from './money.js';

const SOURCES = [['salary', 'Salary'], ['zomato', 'Zomato'], ['other', 'Other']];
// two kinds of bills: repeating every month (installments, family, fixed) and one-time debts with a fixed date
const BILL_KINDS = [['loan', 'EMI, same day every month'], ['plan', 'Installments on set dates'], ['owed', 'I owe someone'], ['family', 'Family'], ['fixed', 'Fixed bill']];
const KIND_LABEL = { ...Object.fromEntries(BILL_KINDS), owed: 'I owe', loan: 'Loan EMI', plan: 'Installment', sip: 'SIP' };
const KIND_COLOR = { loan: '#f87171', plan: '#f87171', owed: '#fb923c', family: '#a78bfa', fixed: '#fbbf24', sip: '#4ade80' };
const FIXED_CATS = ['Groceries', 'Bills', 'Rent', 'Other'];
const INV_TYPES = ['Digital gold', 'Mutual fund', 'FD / RD', 'Stocks', 'Other'];

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const ordinal = (n) => n + ['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10];

// The Money tab: Overview | Bills | Invest | Lent. Created once by main.js with the shared UI helpers.
export function createMoney(d) {
  const { ui, openModal, closeModal, commit, esc, inr, svg, dot, monthPicker, getYm, syncNotifications, showLayer, hideLayer, categories: getCats, balanceHidden, mask } = d;
  const S = () => db.get();
  const $ = (id) => document.getElementById(id);
  let tab = 'overview';
  let lentFilter = 'active';
  let md = {}; // draft of whichever form is open
  let billsMode = 'main'; // 'main' | 'all' (the full payment record)
  let allFilter = 'payments'; // 'payments' | 'emis'

  const refresh = async () => { await commit(); syncNotifications(); };
  const monthName = (m) => new Date(`${m}-01T00:00`).toLocaleDateString('en-IN', { month: 'long' });

  // replace the content of the open sheet in place (no slide-up replay), or open it
  const setSheet = (html) => {
    const sheet = document.querySelector('#modal .sheet');
    if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
  };

  const chipRow = (g, items, selected) => `<div class="chips wrap" id="g-${g}">${items.map(([v, l]) => `<button class="${v === selected ? 'on' : ''}" data-act="mChip" data-g="${g}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const peopleChips = (g, selected) => `<div class="chips wrap" id="g-${g}">${S().people.map((p) => `<button class="${p === selected ? 'on' : ''}" data-act="mChip" data-g="${g}" data-v="${esc(p)}" data-toggle="1">${esc(p)}</button>`).join('')}<button data-act="newPerson" data-g="${g}">+ New</button></div>`;
  const catChips = (selected) => `<div class="chips wrap" id="g-cat">${getCats().map((c) => `<button class="${c === selected ? 'on' : ''}" data-act="mChip" data-g="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}<button data-act="newCat">+ New</button></div>`;
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
    const unpaid = M.billsFor(s, today().slice(0, 7)).filter((b) => !b.paid).length + M.owedFor(s).filter((b) => !b.paid).length;
    const tabs = `<div class="chips subtabs scroll">${[['overview', 'Overview'], ['wealth', 'Wealth'], ['bills', 'Bills'], ['invest', 'Invest'], ['lent', 'Lent'], ['report', 'Report']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="mTab" data-v="${k}">${l}${k === 'bills' && unpaid ? `<i>${unpaid}</i>` : ''}</button>`).join('')}</div>`;
    const body = tab === 'wealth' ? wealthView() : tab === 'bills' ? billsView() : tab === 'invest' ? investView() : tab === 'lent' ? lentView() : tab === 'report' ? reportView() : overview();
    return tabs + body;
  }

  function overview() {
    const s = S(), ym = getYm();
    const hidden = balanceHidden();
    const amt = (n) => (hidden ? mask : inr(n));
    const m = M.monthStats(s, ym);
    const sp = M.safeToSpend(s);
    const short = new Date(`${ym}-01T00:00`).toLocaleDateString('en-IN', { month: 'short' });
    const note = sp.salaryLate ? 'Salary is not added yet. Add it to plan the month.'
      : sp.perDay !== null ? `${inr(sp.perDay)} a day for ${sp.days} day${sp.days === 1 ? '' : 's'} until salary`
        : 'Set your salary day in Settings to see a daily limit.';

    const budgetRows = [...new Set([...getCats(), ...Object.keys(m.byCat)])].filter((c) => s.budgets[c] || m.byCat[c]).map((c) => {
      const spent = m.byCat[c] || 0, b = s.budgets[c] || 0;
      return `<div style="margin-bottom:14px"><div class="row between"><span>${esc(c)}</span>
        <span class="${b && spent > b ? 'bad' : 'muted'}">${inr(spent)}${b ? ' / ' + inr(b) : ''}${b && spent > b ? ' · over budget' : ''}</span></div>
        ${b ? `<div class="bar ${spent > b ? 'over' : ''}"><div style="width:${Math.min(100, (spent / b) * 100)}%"></div></div>` : ''}</div>`;
    }).join('') || '<div class="muted">No expenses yet.</div>';

    const sources = Object.entries(m.bySource);
    const people = Object.entries(m.byPerson).sort((a, b) => b[1] - a[1]);
    const rows = [...m.tx].sort((a, b) => b.date.localeCompare(a.date)).map((t) => `
      <div class="item tap swipe" data-act="editTx" data-id="${t.id}">${dot(t.type === 'income' ? '#4ade80' : '#f87171')}
        <div class="grow"><div>${esc(t.category)}${t.person ? ` <span class="ptag">${esc(t.person)}</span>` : ''}${t.mode === 'cash' ? ' <span class="ptag">Cash</span>' : ''}${t.note ? ' · ' + esc(t.note) : ''}</div><div class="muted">${dayName(t.date)}</div></div>
        <b class="${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${inr(t.amount)}</b>
        <button class="icon" data-act="delTx" data-id="${t.id}" aria-label="Delete">${svg('trash')}</button></div>`).join('') || '<div class="muted">No entries this month.</div>';

    return `${monthPicker()}
      <div class="hero"><div class="label">Wallet balance</div><div class="num" ${hidden ? '' : `data-count="${sp.wallet}"`}>${amt(sp.wallet)}</div><hr>
        <div class="grid2"><div><div class="label">In · ${short}</div><div class="val" style="color:#fff">${amt(m.income)}</div></div>
        <div><div class="label">Out · ${short}</div><div class="val" style="color:#fff">${amt(m.expense)}</div></div></div></div>
      <div class="card safe"><div class="label">Safe to spend</div><div class="num ${sp.safe < 0 && !hidden ? 'bad' : ''}" style="margin:6px 0">${amt(sp.safe)}</div>
        <div class="sec">${note}</div><div class="muted" style="margin-top:6px">After ${inr(sp.bills)} of bills still to pay</div></div>
      <div class="grid2 top-actions"><button class="btn" data-act="addIncome">+ Income</button><button class="btn alt" data-act="addExpense">+ Expense</button></div>
      ${sources.length ? `<div class="card"><h2>Income this month</h2>${sources.map(([k, v]) => `<div class="row between" style="padding:6px 0"><span>${esc(k)}</span><b class="good">+${inr(v)}</b></div>`).join('')}</div>` : ''}
      <div class="card"><div class="row between"><h2 style="margin:0">Spending by category</h2><button class="icon" data-act="setBudget" aria-label="Edit budgets">${svg('edit')}</button></div><div style="height:12px"></div>${budgetRows}</div>
      ${people.length ? `<div class="card"><h2>Given to people</h2>${people.map(([p, v]) => `<div class="row between" style="padding:6px 0"><span>${esc(p)}</span><b class="bad">${inr(v)}</b></div>`).join('')}</div>` : ''}
      <div class="card"><h2>Entries</h2>${rows}</div>`;
  }

  // ---------- wealth: wallet + investments in one place ----------
  const WEALTH_COLORS = ['#a78bfa', '#4ade80', '#fbbf24', '#818cf8', '#38bdf8', '#f472b6'];

  function wealthView() {
    const s = S(), hidden = balanceHidden();
    const amt = (n) => (hidden ? mask : inr(n));
    const wallet = M.safeToSpend(s).wallet;
    const invs = s.investments;
    const invested = sum(invs, M.investedOf), value = sum(invs, M.currentValue), gain = value - invested;
    const total = wallet + value;
    const byType = {};
    invs.forEach((i) => { byType[i.type] = (byType[i.type] || 0) + M.currentValue(i); });
    const parts = [['Wallet', wallet], ...Object.entries(byType)].filter((p) => p[1] > 0).map((p, k) => [...p, WEALTH_COLORS[k % WEALTH_COLORS.length]]);
    const base = sum(parts, (p) => p[1]);
    const alloc = base > 0 ? `<div class="alloc">${parts.map((p) => `<i style="width:${(p[1] / base) * 100}%;background:${p[2]}"></i>`).join('')}</div>
      ${parts.map((p) => `<div class="row between" style="padding:7px 0"><span>${dot(p[2])}${esc(p[0])}</span><span><b>${amt(p[1])}</b> <span class="muted">${Math.round((p[1] / base) * 100)}%</span></span></div>`).join('')}`
      : '<div class="muted">Add money to your wallet or an investment to see how your wealth is split.</div>';
    const rows = invs.map((i) => {
      const v = M.currentValue(i), g = v - M.investedOf(i);
      return `<div class="mrow" style="--k:#4ade80"><div class="grow" data-act="openInvest" data-id="${i.id}"><div class="m-title">${esc(i.name)}</div><div class="m-sub">${esc(i.type)} · invested ${amt(M.investedOf(i))}</div></div>
        <div class="m-right"><b>${amt(v)}</b><span class="m-sub ${g >= 0 ? 'good' : 'bad'}">${hidden ? '' : `${g >= 0 ? '+' : '-'}${inr(Math.abs(g))}`}</span></div></div>`;
    }).join('');
    const toGet = sum(s.lent.filter((l) => M.lentLeft(l) > 0), M.lentLeft);
    const toPay = sum(M.datedFor(s).filter((b) => !b.paid), (b) => b.amount);
    const extra = toGet > 0 || toPay > 0
      ? `<div class="card"><h2>Not counted above</h2>
        ${toGet > 0 ? `<div class="row between" style="padding:6px 0"><span>Lent, to get back</span><b class="good">${amt(toGet)}</b></div>` : ''}
        ${toPay > 0 ? `<div class="row between" style="padding:6px 0"><span>Debts and dated installments to pay</span><b class="bad">${amt(toPay)}</b></div>` : ''}</div>` : '';
    return `<div class="hero"><div class="label">Total wealth</div><div class="num" ${hidden ? '' : `data-count="${total}"`}>${amt(total)}</div><hr>
        <div class="grid2"><div><div class="label">Wallet</div><div class="val" style="color:#fff">${amt(wallet)}</div></div>
        <div><div class="label">Investments</div><div class="val" style="color:#fff">${amt(value)}</div></div></div></div>
      <div class="card"><h2>Where it is</h2>${alloc}</div>
      <div class="card"><div class="row between"><h2 style="margin:0">Investments</h2><b class="${gain >= 0 ? 'good' : 'bad'}">${hidden ? mask : `${gain >= 0 ? '+' : '-'}${inr(Math.abs(gain))}`}</b></div>
        <div class="muted" style="margin:4px 0 10px">Invested ${amt(invested)} · now ${amt(value)}</div>
        ${rows || '<div class="muted">No investments yet. Add them in the Invest tab.</div>'}</div>
      ${extra}`;
  }

  // the charts themselves are drawn by main.js after render (it owns Chart.js)
  function reportView() {
    const ym = getYm();
    const m = M.monthStats(S(), ym);
    const saved = m.income - m.expense;
    return `${monthPicker()}
      <div class="card"><div class="grid2"><div><div class="label">Earned</div><div class="val good" style="margin-top:6px">${inr(m.income)}</div></div><div><div class="label">Spent</div><div class="val bad" style="margin-top:6px">${inr(m.expense)}</div></div></div>
        <div class="muted" style="margin-top:14px">${saved >= 0 ? 'Saved' : 'Overspent'} ${inr(Math.abs(saved))} in ${monthName(ym)}</div>
        <div class="muted" style="margin-top:6px">Online ${inr(m.online)} · Cash ${inr(m.cash)}</div></div>
      <div class="card chart-card"><h2>Spending by category</h2><div class="chart-box tall"><canvas id="c1"></canvas></div></div>
      <div class="card chart-card"><h2>Income vs expenses · 6 months</h2><div class="chart-box"><canvas id="c2"></canvas></div></div>`;
  }

  const emiLine = (c, m, paid) => {
    const e = M.emiStats(c);
    if (c.kind !== 'loan' || !e.total) {
      const left = M.emisLeft(c, m, paid);
      return left !== null ? ` · ${left} EMI${left === 1 ? '' : 's'} left` : '';
    }
    return ` · ${e.paid} of ${e.total} paid · ${e.left} left`;
  };

  function billsView() {
    if (billsMode === 'all') return allPaymentsView();
    const s = S(), t = today(), m = t.slice(0, 7);
    const list = M.billsFor(s, m, t);
    const total = sum(list, (b) => Number(b.c.amount) || 0);
    const paidAmt = sum(list.filter((b) => b.paid), (b) => Number(b.c.amount) || 0);
    const left = list.filter((b) => !b.paid).length;
    const rows = list.filter((b) => M.isRecent(b, t)).map((b) => {
      const c = b.c;
      const status = b.paid ? '<span class="good">Paid</span>' : b.late ? `<span class="bad">${b.late} day${b.late === 1 ? '' : 's'} late · was due ${dayName(b.due)}</span>` : `Due ${dayName(b.due)}`;
      return `<div class="mrow ${b.paid ? 'paid' : ''}" style="--k:${KIND_COLOR[c.kind]}">
        <div class="grow" data-act="editBill" data-id="${c.id}"><div class="m-title">${esc(c.name)}</div>
          <div class="m-sub">${KIND_LABEL[c.kind]}${c.person && c.person !== c.name ? ' · ' + esc(c.person) : ''}${emiLine(c, m, b.paid)}</div>
          <div class="m-sub">${status}</div></div>
        <div class="m-right"><b>${inr(c.amount)}</b>${b.paid ? `<button class="pill ghost" data-act="unpay" data-id="${c.id}">Undo</button>` : `<button class="pill" data-act="payBill" data-id="${c.id}">Pay</button>`}</div></div>`;
    }).join('');
    const dated = M.datedFor(s, t).filter((b) => !b.paid || M.isRecent(b, t));
    const owed = dated.filter((b) => !b.inst);
    const planned = dated.filter((b) => b.inst);
    const owedRows = owed.map((b) => {
      const c = b.c;
      const status = b.paid ? '<span class="good">Paid</span>' : b.late ? `<span class="bad">${b.late} day${b.late === 1 ? '' : 's'} late · was due ${dayName(b.due)}</span>` : `Pay on ${dayName(b.due)}`;
      return `<div class="mrow ${b.paid ? 'paid' : ''}" style="--k:${KIND_COLOR.owed}">
        <div class="grow" data-act="editBill" data-id="${c.id}"><div class="m-title">${esc(c.name)}</div>
          <div class="m-sub">${c.person ? 'Give ' + esc(c.person) : 'One-time payment'}</div><div class="m-sub">${status}</div></div>
        <div class="m-right"><b>${inr(c.amount)}</b>${b.paid ? `<button class="pill ghost" data-act="unpay" data-id="${c.id}">Undo</button>` : `<button class="pill" data-act="payBill" data-id="${c.id}">Paid</button>`}</div></div>`;
    }).join('');
    const plannedRows = planned.map((b) => {
      const status = b.paid ? '<span class="good">Paid</span>' : b.late ? `<span class="bad">${b.late} day${b.late === 1 ? '' : 's'} late · was due ${dayName(b.due)}</span>` : `Pay on ${dayName(b.due)}`;
      return `<div class="mrow ${b.paid ? 'paid' : ''}" style="--k:${KIND_COLOR.plan}">
        <div class="grow" data-act="editBill" data-id="${b.c.id}"><div class="m-title">${esc(b.c.name)}</div>
          <div class="m-sub">Installment ${b.n} of ${b.total}</div><div class="m-sub">${status}</div></div>
        <div class="m-right"><b>${inr(b.amount)}</b>${b.paid ? `<button class="pill ghost" data-act="unpay" data-id="${b.c.id}" data-inst="${b.key}">Undo</button>` : `<button class="pill" data-act="payBill" data-id="${b.c.id}" data-inst="${b.key}">Pay</button>`}</div></div>`;
    }).join('');
    // an installment plan that was finished in the last 7 days (and is no longer in this month's list)
    const finished = M.completedEmis(s).filter((x) => x.doneOn && x.doneOn >= addDays(t, -7) && !list.some((b) => b.c.id === x.c.id) && !planned.some((b) => b.c.id === x.c.id));
    const finishedRows = finished.map(({ c, stats }) => `<div class="mrow paid" style="--k:#4ade80"><div class="grow"><div class="m-title">${esc(c.name)}</div>
      <div class="m-sub">All ${stats.total} installments paid</div><div class="m-sub"><span class="good">Completed</span></div></div><div class="m-right"><b>${inr(M.emiTotal(c))}</b></div></div>`).join('');
    const upcoming = M.upcomingBills(s, m);
    const upcomingRows = upcoming.map(({ c, due }) => {
      const e = M.emiStats(c);
      const count = c.kind === 'loan' && e.total ? ` · ${e.total - e.paid} installment${e.total - e.paid === 1 ? '' : 's'}` : '';
      return `<div class="mrow" style="--k:${KIND_COLOR[c.kind]}">
        <div class="grow" data-act="editBill" data-id="${c.id}"><div class="m-title">${esc(c.name)}</div>
          <div class="m-sub">${KIND_LABEL[c.kind]}${c.person && c.person !== c.name ? ' · ' + esc(c.person) : ''}${count}</div>
          <div class="m-sub">Starts ${dayName(due)}</div></div>
        <div class="m-right"><b>${inr(c.amount)}</b></div></div>`;
    }).join('');
    const history = M.paymentHistory(s).length + M.completedEmis(s).length;
    return `<button class="btn" data-act="addBill">+ Add bill</button>
      <div class="card"><div class="row between"><h2 style="margin:0">${monthName(m)} bills</h2><b>${inr(paidAmt)} / ${inr(total)}</b></div>
        <div class="bar"><div style="width:${total ? (paidAmt / total) * 100 : 0}%"></div></div>
        <div class="muted" style="margin-top:8px">${list.length ? `${left} to pay · ${inr(total - paidAmt)} left this month` : 'Installments, groceries and money for family repeat every month. Add them here.'}</div></div>
      ${rows}
      ${upcomingRows ? `<div class="day-head"><div><b>Upcoming</b><span>Starts in a coming month</span></div><i>${upcoming.length}</i></div>${upcomingRows}` : ''}
      ${plannedRows ? `<div class="day-head"><div><b>Installments</b><span>On the dates you set</span></div><i>${planned.filter((b) => !b.paid).length}</i></div>${plannedRows}` : ''}
      ${owedRows ? `<div class="day-head"><div><b>Pay back</b><span>One time, on a fixed date</span></div><i>${owed.filter((b) => !b.paid).length}</i></div>${owedRows}` : ''}
      ${finishedRows ? `<div class="day-head"><div><b>Just completed</b><span>Moves to All payments after a week</span></div><i>${finished.length}</i></div>${finishedRows}` : ''}
      ${history ? `<button class="btn alt" data-act="billsAll">View all payments</button>` : ''}`;
  }

  // the permanent record: every payment ever made, and every finished installment plan
  function allPaymentsView() {
    const s = S();
    const hist = M.paymentHistory(s);
    const done = M.completedEmis(s);
    const chip = (k, l, n) => `<button class="${allFilter === k ? 'on' : ''}" data-act="allFilter" data-v="${k}">${l}<i>${n}</i></button>`;
    let body;
    if (allFilter === 'emis') {
      body = done.length ? done.map(({ c, stats, doneOn }) => `<div class="mrow" style="--k:#4ade80"><div class="grow"><div class="m-title">${esc(c.name)}</div>
        <div class="m-sub">${stats.total} installments${c.kind === 'plan' ? '' : ' of ' + inr(c.amount)}${c.paidBefore ? ` · ${c.paidBefore} paid before Prysm` : ''}</div>
        <div class="m-sub"><span class="good">Completed${doneOn ? ' ' + dayName(doneOn) : ''}</span></div></div><div class="m-right"><b>${inr(M.emiTotal(c))}</b></div></div>`).join('')
        : '<div class="empty"><b>No completed installment plans yet</b><span>When you pay the last installment of an EMI it is kept here.</span></div>';
    } else if (!hist.length) {
      body = '<div class="empty"><b>No payments yet</b><span>Every bill, debt and SIP you mark as paid is kept here for good.</span></div>';
    } else {
      const byMonth = {};
      hist.forEach((h) => { (byMonth[h.date.slice(0, 7)] = byMonth[h.date.slice(0, 7)] || []).push(h); });
      body = Object.keys(byMonth).sort().reverse().map((m) => `<section class="day"><div class="day-head"><div><b>${monthName(m)} ${m.slice(0, 4)}</b><span>${byMonth[m].length} payment${byMonth[m].length === 1 ? '' : 's'}</span></div><i>${inr(sum(byMonth[m], (h) => h.amount))}</i></div>
        ${byMonth[m].map((h) => `<div class="mrow" style="--k:${KIND_COLOR[h.kind] || '#a78bfa'}"><div class="grow"><div class="m-title">${esc(h.name)}</div>
          <div class="m-sub">${KIND_LABEL[h.kind] || 'Bill'}${h.person && h.person !== h.name ? ' · ' + esc(h.person) : ''} · ${dayName(h.date)}</div></div><div class="m-right"><b>${inr(h.amount)}</b></div></div>`).join('')}</section>`).join('');
    }
    return `<button class="link" style="text-align:left" data-act="billsBack">← Back to bills</button>
      <div class="card"><div class="label">All payments</div><div class="num" style="margin:8px 0">${inr(sum(hist, (h) => h.amount))}</div><div class="muted">${hist.length} payment${hist.length === 1 ? '' : 's'} · ${done.length} completed installment plan${done.length === 1 ? '' : 's'}</div></div>
      <div class="chips">${chip('payments', 'Payments', hist.length)}${chip('emis', 'Completed EMIs', done.length)}</div>${body}`;
  }

  const hasReturn = (i) => i.returnPct !== null && i.returnPct !== undefined && i.returnPct !== '';
  const returnText = (i) => (hasReturn(i) ? ` · <b>Return ${i.returnPct > 0 ? '+' : ''}${i.returnPct}%</b>` : '');
  const monthLabel = (m) => new Date(`${m}-01T00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const sipLine = (i) => (i.sip && i.sip.on !== false ? `<div class="muted" style="margin-top:6px">SIP ${inr(i.sip.amount)} on the ${ordinal(i.sip.day)} · since ${monthLabel(i.sip.start)}</div>` : i.sip ? '<div class="muted" style="margin-top:6px">SIP stopped</div>' : '');

  // the SIP fields shared by "Add investment" and "Set up SIP"
  function sipFields(inv) {
    const sip = inv && inv.sip;
    return `<span class="label">Monthly SIP</span>${chipRow('sipOn', [['no', 'No SIP'], ['yes', 'Monthly SIP']], md.sipOn)}
      <div id="sip-box" ${md.sipOn === 'yes' ? '' : 'hidden'}>
        <input id="s-amt" type="number" inputmode="decimal" placeholder="Amount per month ₹" value="${sip ? sip.amount : ''}">
        <span class="label">First installment date (the same day repeats every month)</span>
        <input id="s-date" type="date" value="${sip ? `${sip.start}-${String(sip.day).padStart(2, '0')}` : ''}">
        <span class="label">Months that already passed</span>${chipRow('sipBack', [['yes', 'Count them as invested'], ['no', 'Ignore them']], md.sipBack)}
        <div class="muted" style="margin:-2px 0 14px">On every SIP day Prysm asks "did you pay?" and only then adds it.</div>
      </div>`;
  }

  function readSip() {
    if (md.sipOn !== 'yes') return { sip: null };
    const amount = Number(($('s-amt') || {}).value), date = ($('s-date') || {}).value;
    if (!(amount > 0)) return { error: 'Enter the SIP amount per month' };
    if (!date) return { error: 'Pick the date of your first SIP installment' };
    return { sip: { amount, day: Number(date.slice(8)), start: date.slice(0, 7), on: true } };
  }

  // months before this one are settled right away, so only this month's SIP is ever asked about
  function settlePastSip(inv, back) {
    const cur = today().slice(0, 7);
    inv.sip.done = inv.sip.done || {};
    for (let m = inv.sip.start; m < cur; m = M.shiftMonth(m, 1)) {
      if (inv.sip.done[m]) continue;
      if (back === 'yes') {
        const id = db.uid();
        inv.entries.push({ id, date: M.sipDate(inv, m), amount: inv.sip.amount, w: false, note: 'SIP' });
        inv.sip.done[m] = id;
      } else inv.sip.done[m] = 'skipped';
    }
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
        <div class="${g >= 0 ? 'good' : 'bad'}" style="margin-top:8px;font-size:13px">${g >= 0 ? '+' : '-'}${inr(Math.abs(g))}${inv > 0 ? ` (${g >= 0 ? '+' : ''}${((g / inv) * 100).toFixed(1)}%)` : ''}${returnText(i)}</div>${sipLine(i)}</div>`;
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
    md = { cat: edit ? edit.category : 'Food', person: edit ? edit.person || '' : '', mode: edit && edit.mode === 'cash' ? 'cash' : 'online', id: edit ? edit.id : '' };
    openModal(`<h2>${edit ? 'Edit expense' : 'New expense'}</h2>
      <input id="m-amt" type="number" inputmode="decimal" placeholder="Amount ₹" value="${edit ? edit.amount : ''}">
      <span class="label">Category</span>${catChips(md.cat)}
      <span class="label">Paid via</span>${chipRow('mode', [['online', 'Online'], ['cash', 'Cash']], md.mode)}
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
  function emiHint(total, pre) {
    total = Number(total) || 0;
    pre = Number(pre) || 0;
    if (!total) return 'Leave empty if there is no fixed number of installments.';
    if (pre >= total) return 'Already paid cannot be as much as the total.';
    return `${pre} paid · ${total - pre} left to pay`;
  }

  // installments on set dates: a list of {date, amount} rows
  function instRows() {
    return md.insts.map((it, i) => `<div class="inst-row"><input type="date" data-i="${i}" data-f="date" value="${it.date || ''}" aria-label="Installment date"><input type="number" inputmode="decimal" placeholder="₹" data-i="${i}" data-f="amount" value="${it.amount || ''}" aria-label="Installment amount"><button class="icon" data-act="instDel" data-i="${i}" aria-label="Remove">${svg('trash')}</button></div>`).join('');
  }

  // an EMI picks its first installment date instead; debts and plans have their own dates
  const noDayRow = (k) => k === 'owed' || k === 'plan' || k === 'loan';

  function billExtra() {
    const s = S();
    if (md.kind === 'plan') {
      const done = (md.donePlan || []).map((i) => `<div class="muted" style="margin-bottom:6px">Paid · ${dayName(i.date)} · ${inr(i.amount)}</div>`).join('');
      return `${done}<span class="label">Installments still to pay</span><div id="inst-list">${instRows()}</div>
        <button class="btn alt sm" style="margin-bottom:14px" data-act="instAdd">+ Add installment</button>
        <span class="label">Already paid before (optional)</span><input id="b-pre" type="number" inputmode="numeric" placeholder="e.g. 1" value="${md.pre || ''}">`;
    }
    if (md.kind === 'loan') return `<span class="label">First installment date</span>
      <input id="b-first" type="date" value="${md.first || ''}">
      <div class="muted" style="margin:-2px 0 14px">The same day repeats every month. Pick a later date if the EMI starts in a coming month.</div>
      <span class="label">Installments (optional)</span>
      <div class="grid2"><input id="b-total" type="number" inputmode="numeric" placeholder="Total, e.g. 3" value="${md.total || ''}"><input id="b-pre" type="number" inputmode="numeric" placeholder="Already paid, e.g. 2" value="${md.pre || ''}"></div>
      <div class="muted" id="b-emihint" style="margin:-2px 0 14px">${emiHint(md.total, md.pre)}</div>`;
    if (md.kind === 'owed') return `<span class="label">Whom do you owe? (a person or an app)</span>${peopleChips('bperson', md.bperson)}<span class="label">Pay on</span><input id="b-date" type="date" value="${md.date || ''}">`;
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
      total: edit ? M.emiStats(edit).total || '' : '', pre: edit && M.emiStats(edit).total ? M.emiStats(edit).paid : '',
      date: edit && edit.dueDate ? edit.dueDate : '',
      first: edit && edit.kind === 'loan' ? M.dueDate(edit, edit.startMonth || m) : today(),
      insts: edit && edit.kind === 'plan' ? (edit.inst || []).filter((i) => !(edit.paid || {})[i.id]).map((i) => ({ ...i })) : [{ date: '', amount: '' }],
      donePlan: edit && edit.kind === 'plan' ? (edit.inst || []).filter((i) => (edit.paid || {})[i.id]) : [],
    };
    if (edit && edit.kind === 'plan') md.pre = edit.paidBefore || '';
    openModal(`<h2>${edit ? 'Edit bill' : 'Add bill'}</h2>
      <span class="label">Type</span>${chipRow('kind', BILL_KINDS, md.kind)}
      <input id="b-name" placeholder="Name, e.g. Bike EMI, Groceries, Sister's loan" value="${edit ? esc(edit.name) : ''}" autocomplete="off">
      <div id="b-amtrow" ${md.kind === 'plan' ? 'hidden' : ''}><input id="b-amt" type="number" inputmode="decimal" placeholder="Amount ₹ (per month for repeating bills)" value="${edit && edit.kind !== 'plan' ? edit.amount : ''}"></div>
      <div id="b-dayrow" ${noDayRow(md.kind) ? 'hidden' : ''}><span class="label">Due day</span><button class="capsule set" id="b-day" data-act="pickBillDay"><span>${ordinal(md.day)} of every month</span></button></div>
      <div id="bill-extra">${billExtra()}</div>
      <button class="btn" data-act="saveBill">Save</button>
      ${edit ? '<button class="btn danger" style="margin-top:10px" data-act="delBill">Delete bill</button>' : ''}`);
  }

  async function savePlan(name) {
    const rows = md.insts.filter((r) => r.date || r.amount);
    if (!rows.length) return ui.alert('Add at least one installment with its date and amount');
    if (rows.some((r) => !r.date || !(Number(r.amount) > 0))) return ui.alert('Every installment needs a date and an amount');
    const old = md.id ? S().commitments.find((c) => c.id === md.id) : null;
    const pre = Math.max(0, Math.floor(Number(($('b-pre') || {}).value) || 0));
    const kept = old ? (old.inst || []).filter((i) => (old.paid || {})[i.id]) : [];
    const fresh = rows.map((r) => ({ id: r.id || db.uid(), date: r.date, amount: Number(r.amount) }));
    const inst = [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
    const base = { kind: 'plan', name, amount: fresh[0].amount, dueDay: 1, person: '', dueDate: '', category: '', investmentId: '', endMonth: '', total: pre + inst.length, paidBefore: pre, inst };
    if (old) Object.assign(old, base);
    else S().commitments.push({ id: db.uid(), paid: {}, paidOn: {}, active: true, startMonth: today().slice(0, 7), ...base });
    closeModal();
    await refresh();
  }

  function payForm(c, instKey) {
    md = { id: c.id, ym: today().slice(0, 7), key: instKey || M.payKey(c, today().slice(0, 7)) };
    const planned = c.kind === 'plan' ? (c.inst || []).find((i) => i.id === instKey) : null;
    openModal(`<h2>Pay ${esc(c.name)}</h2>
      <div class="muted" style="margin:-8px 0 14px">${c.kind === 'sip' ? 'The amount goes into your investment.' : 'This is added to your expenses.'}</div>
      <span class="label">Amount ₹</span><input id="m-amt" type="number" inputmode="decimal" value="${planned ? planned.amount : c.amount}">
      <span class="label">Date</span><input id="m-date" type="date" value="${today()}">
      <button class="btn" data-act="confirmPay">Mark paid</button>`);
  }

  function unlinkPaid(id) {
    S().commitments.forEach((c) => { Object.keys(c.paid || {}).forEach((k) => { if (c.paid[k] === id) { delete c.paid[k]; if (c.paidOn) delete c.paidOn[k]; } }); });
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
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="invValue" data-id="${i.id}">Update value</button><button class="btn alt" data-act="invReturn" data-id="${i.id}">${hasReturn(i) ? 'Return ' + i.returnPct + '%' : 'Set return %'}</button></div>
      ${i.sip && i.sip.on !== false ? `<div class="card" style="margin:14px 0 0"><div class="label">Monthly SIP</div><div class="val" style="margin:6px 0">${inr(i.sip.amount)} on the ${ordinal(i.sip.day)}</div><div class="muted">Since ${monthLabel(i.sip.start)}</div><div class="grid2" style="margin-top:12px"><button class="btn alt" data-act="sipEdit" data-id="${i.id}">Edit SIP</button><button class="btn danger" data-act="sipStop" data-id="${i.id}">Stop SIP</button></div></div>` : `<button class="btn alt" style="margin-top:10px" data-act="sipEdit" data-id="${i.id}">${i.sip ? 'Restart SIP' : 'Set up monthly SIP'}</button>`}
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

  function settleBill(c, amount, date, key) {
    const id = db.uid();
    if (c.kind === 'sip') {
      const inv = S().investments.find((i) => i.id === c.investmentId);
      if (inv) inv.entries.push({ id, date, amount, w: true, note: 'SIP' });
    } else {
      const category = c.kind === 'loan' || c.kind === 'plan' ? 'Loan EMI' : c.kind === 'family' ? 'Family' : c.kind === 'owed' ? 'Repayment' : c.category || 'Bills';
      S().transactions.push({ id, type: 'expense', amount, category, person: c.person || '', mode: 'online', note: c.name, date, linkId: c.id });
    }
    c.paid = { ...(c.paid || {}), [key]: id };
    c.paidOn = { ...(c.paidOn || {}), [key]: date };
  }

  // ---------- SIP confirmation, in the app and from the popup over other apps ----------
  function payInstallment(inv, m, amount, date) {
    const id = db.uid();
    inv.entries.push({ id, date, amount, w: true, note: 'SIP' });
    inv.sip.done[m] = id;
  }

  // shows the oldest unconfirmed SIP; returns false when there is none or another sheet is open
  function askSips() {
    if (!$('modal').hidden) return false;
    const due = M.sipDue(S());
    if (!due.length) return false;
    const { inv, m, date } = due[0];
    md = { sipInv: inv.id, sipM: m };
    openModal(`<div class="rv-step">SIP reminder${due.length > 1 ? ` · ${due.length} waiting` : ''}</div><h2>Did you pay your SIP?</h2>
      <div class="rv-goal"><b>${esc(inv.name)}</b><span class="muted">${monthName(m)} installment · due ${dayName(date)}</span></div>
      <span class="label">Amount you paid ₹</span><input id="sip-amt" type="number" inputmode="decimal" value="${inv.sip.amount}">
      <button class="btn" data-act="sipYes">Yes, I paid</button>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="sipLater">Not yet</button><button class="btn alt" data-act="sipSkip">Skip this month</button></div>`);
    return true;
  }

  // popup items for the native side: the next SIP dates and the next due dates of bills (09:00 on the day)
  function confirmItems() {
    const s = S(), t = today(), m0 = t.slice(0, 7), m1 = M.shiftMonth(m0, 1), out = [];
    const at = (d) => new Date(`${d}T09:00`).getTime();
    const now = Date.now();
    const rs = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    s.investments.forEach((inv) => {
      if (!inv.sip || inv.sip.on === false) return;
      [m0, m1].forEach((m) => {
        if (m < inv.sip.start || (inv.sip.done || {})[m]) return;
        const d = M.sipDate(inv, m);
        if (at(d) > now) out.push({ key: `sip|${inv.id}|${m}`, title: 'SIP day', body: `Did you pay your ${rs(inv.sip.amount)} SIP for ${inv.name}?`, yes: 'Yes, paid', skip: true, at: at(d) });
      });
    });
    s.commitments.forEach((c) => {
      if (c.kind === 'owed') {
        if (!(c.paid || {}).once && c.dueDate && at(c.dueDate) > now) out.push({ key: `bill|${c.id}|once`, title: `${c.person ? 'Give ' + c.person : 'Payment due'} ${rs(c.amount)}`, body: `${c.name}. Did you pay it?`, yes: 'Yes, paid', skip: false, at: at(c.dueDate) });
        return;
      }
      if (c.kind === 'plan') {
        (c.inst || []).forEach((it) => {
          if (!(c.paid || {})[it.id] && at(it.date) > now) out.push({ key: `bill|${c.id}|${it.id}`, title: `${c.name}: installment due today`, body: `${rs(it.amount)}. Did you pay it?`, yes: 'Yes, paid', skip: false, at: at(it.date) });
        });
        return;
      }
      [m0, m1].forEach((m) => {
        if (!M.billActive(c, m) || (c.paid || {})[m]) return;
        const d = M.dueDate(c, m);
        if (at(d) > now) out.push({ key: `bill|${c.id}|${m}`, title: `${c.name} is due today`, body: `${rs(c.amount)}. Did you pay it?`, yes: 'Yes, paid', skip: false, at: at(d) });
      });
    });
    return out.sort((a, b) => a.at - b.at).slice(0, 40);
  }

  // an answer given in the popup while the app was closed; returns true when something changed
  function applyConfirm(key, answer) {
    const [kind, id, m] = String(key).split('|');
    const s = S();
    if (kind === 'sip') {
      const inv = s.investments.find((x) => x.id === id);
      if (!inv || !inv.sip || (inv.sip.done || {})[m]) return false;
      if (answer === 'yes') payInstallment(inv, m, inv.sip.amount, today());
      else if (answer === 'skip') inv.sip.done[m] = 'skipped';
      else return false;
      return true;
    }
    if (kind === 'bill' && answer === 'yes') {
      const c = s.commitments.find((x) => x.id === id);
      if (!c || (c.paid || {})[m]) return false;
      const planned = c.kind === 'plan' ? (c.inst || []).find((i) => i.id === m) : null;
      settleBill(c, planned ? planned.amount : c.amount, today(), m);
      return true;
    }
    return false;
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'b-first') md.first = e.target.value;
    if (e.target.dataset && e.target.dataset.f && md.insts && md.insts[e.target.dataset.i]) md.insts[e.target.dataset.i][e.target.dataset.f] = e.target.value;
    if ((e.target.id === 'b-total' || e.target.id === 'b-pre') && $('b-emihint')) $('b-emihint').textContent = emiHint(($('b-total') || {}).value, ($('b-pre') || {}).value);
  });

  // ---------- actions ----------
  const actions = {
    mTab: (el) => { tab = el.dataset.v; billsMode = 'main'; d.render('fade'); },
    lentFilter: (el) => { lentFilter = el.dataset.v; d.render(); },
    mChip: (el) => {
      const g = el.dataset.g, v = el.dataset.v;
      md[g] = el.dataset.toggle && md[g] === v ? '' : v;
      document.querySelectorAll(`[data-act="mChip"][data-g="${g}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === md[g]));
      if (g === 'source' && v === 'salary') {
        const a = $('m-amt');
        if (a && !a.value && S().settings.salaryAmount) a.value = S().settings.salaryAmount;
      }
      if (g === 'kind') { $('bill-extra').innerHTML = billExtra(); $('b-dayrow').hidden = noDayRow(v); $('b-amtrow').hidden = v === 'plan'; }
      if (g === 'sipOn') $('sip-box').hidden = v !== 'yes';
    },
    // categories you add here are kept in settings.customCats and offered in every expense form and budget list
    newCat: async () => {
      const raw = await ui.text('New category', '', 'e.g. Pets, Gym, Gifts');
      const name = (raw || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      if (!name) return;
      const known = getCats().find((c) => c.toLowerCase() === name.toLowerCase());
      if (!known) { S().settings.customCats.push(name); await db.save(); }
      md.cat = known || name;
      const g = $('g-cat');
      if (g) g.outerHTML = catChips(md.cat);
    },
    delCat: async (el) => {
      const name = el.dataset.c;
      if (!(await ui.confirm(`Remove "${name}" from the list? Expenses already saved under it stay as they are.`, { title: 'Remove category', ok: 'Remove', danger: true }))) return;
      const mine = S().settings.customCats;
      const i = mine.indexOf(name);
      if (i >= 0) mine.splice(i, 1);
      delete S().budgets[name];
      await commit();
      actions.setBudget();
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
      const data = { type: 'expense', amount, category: md.cat, person: md.person || '', mode: md.mode === 'cash' ? 'cash' : 'online', note: $('m-note').value.trim(), date: $('m-date').value || today() };
      if (md.id) Object.assign(S().transactions.find((x) => x.id === md.id), data); else S().transactions.push({ id: db.uid(), ...data });
      if (data.person) addPerson(data.person);
      closeModal();
      await refresh();
      await budgetAlert(data.category, data.date);
    },
    delTx: async (el) => {
      const id = el.dataset.id;
      const i = S().transactions.findIndex((t) => t.id === id);
      if (i < 0) return;
      // remember which bills this entry had paid, so Undo can mark them paid again
      const links = [];
      S().commitments.forEach((c) => Object.keys(c.paid || {}).forEach((k) => { if (c.paid[k] === id) links.push({ cid: c.id, k, on: c.paidOn ? c.paidOn[k] : undefined }); }));
      const [item] = S().transactions.splice(i, 1);
      unlinkPaid(id);
      ui.buzz('warn');
      await refresh();
      ui.undo('Entry deleted', async () => {
        const list = S().transactions;
        list.splice(Math.min(i, list.length), 0, item);
        links.forEach((l) => {
          const c = S().commitments.find((x) => x.id === l.cid);
          if (!c) return;
          c.paid = c.paid || {};
          c.paid[l.k] = id;
          if (l.on !== undefined) { c.paidOn = c.paidOn || {}; c.paidOn[l.k] = l.on; }
        });
        await refresh();
      });
    },
    setBudget: () => {
      const b = S().budgets;
      const mine = S().settings.customCats;
      openModal(`<h2>Monthly budgets</h2>${getCats().map((c) => `<span class="label">${esc(c)}${mine.includes(c) ? ` <button class="link" data-act="delCat" data-c="${esc(c)}">Remove</button>` : ''}</span><input data-bud="${esc(c)}" type="number" inputmode="decimal" value="${b[c] || ''}" placeholder="0 = no limit">`).join('')}
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
      if (!name && (md.kind === 'family' || md.kind === 'owed')) name = md.bperson;
      if (!name) return ui.alert('Give this bill a name');
      if (md.kind === 'plan') return savePlan(name);
      if (!(amount > 0)) return ui.alert('Enter the amount');
      const date = md.kind === 'owed' ? ($('b-date') || {}).value : '';
      if (md.kind === 'owed' && !date) return ui.alert('Pick the date you have to pay on');
      if (md.kind === 'sip' && !md.binv) return ui.alert('Choose the investment this SIP goes into');
      const cur = today().slice(0, 7);
      const old = md.id ? S().commitments.find((c) => c.id === md.id) : null;
      const total = md.kind === 'loan' ? Math.floor(Number(($('b-total') || {}).value) || 0) : 0;
      let pre = md.kind === 'loan' ? Math.floor(Number(($('b-pre') || {}).value) || 0) : 0;
      if (total && pre >= total) return ui.alert('Already paid must be less than the total installments.');
      // an EMI starts on the date picked here (this month or a coming one)
      const first = md.kind === 'loan' ? ($('b-first') || {}).value || '' : '';
      if (md.kind === 'loan') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return ui.alert('Pick the date of the first installment');
        if (first.slice(0, 7) < cur && !(old && old.startMonth === first.slice(0, 7))) return ui.alert('Pick a date from this month onward. Installments you already paid go in "Already paid".');
      }
      // installments paid inside Prysm are counted from the payments themselves, the rest were paid before
      const inApp = old ? M.emiStats({ ...old, paidBefore: 0 }).paid : 0;
      pre = Math.max(0, pre - inApp);
      const c = {
        ...(old || { id: db.uid(), paid: {}, active: true, startMonth: md.day < Number(today().slice(8)) ? M.shiftMonth(cur, 1) : cur }),
        kind: md.kind, name, amount, dueDay: first ? Number(first.slice(8)) : md.day,
        person: md.kind === 'family' || md.kind === 'owed' ? md.bperson : '',
        dueDate: date || '',
        category: md.kind === 'fixed' ? md.bcat : '',
        investmentId: md.kind === 'sip' ? md.binv : '',
        total,
        paidBefore: total ? pre : 0,
      };
      if (first) c.startMonth = first.slice(0, 7);
      c.endMonth = total ? M.shiftMonth(c.startMonth || cur, total - c.paidBefore - 1) : '';
      if (md.bperson) addPerson(md.bperson);
      if (old) Object.assign(old, c); else S().commitments.push(c);
      closeModal();
      await refresh();
    },
    delBill: async () => {
      const i = S().commitments.findIndex((c) => c.id === md.id);
      if (i < 0) return;
      const [item] = S().commitments.splice(i, 1);
      closeModal();
      ui.buzz('warn');
      await refresh();
      // past payments stay in your entries, and the bill comes back with its whole payment record
      ui.undo('Bill deleted', async () => {
        const list = S().commitments;
        list.splice(Math.min(i, list.length), 0, item);
        await refresh();
      });
    },
    payBill: (el) => payForm(S().commitments.find((c) => c.id === el.dataset.id), el.dataset.inst || ''),
    instAdd: () => {
      const last = md.insts[md.insts.length - 1];
      md.insts.push({ date: '', amount: last ? last.amount : '' });
      $('inst-list').innerHTML = instRows();
    },
    instDel: (el) => { md.insts.splice(Number(el.dataset.i), 1); $('inst-list').innerHTML = instRows(); },
    confirmPay: async () => {
      const c = S().commitments.find((x) => x.id === md.id);
      const amount = Number($('m-amt').value);
      if (!c || !(amount > 0)) return ui.alert('Enter an amount');
      const date = $('m-date').value || today();
      if (c.kind === 'sip' && !S().investments.find((i) => i.id === c.investmentId)) return ui.alert('The linked investment was deleted. Edit this bill and pick another.');
      settleBill(c, amount, date, md.key || md.ym);
      ui.buzz('ok');
      closeModal();
      await refresh();
    },
    billsAll: () => { billsMode = 'all'; window.scrollTo(0, 0); d.render('up'); },
    billsBack: () => { billsMode = 'main'; window.scrollTo(0, 0); d.render('up'); },
    allFilter: (el) => { allFilter = el.dataset.v; d.render(); },
    unpay: async (el) => {
      const c = S().commitments.find((x) => x.id === el.dataset.id);
      const key = el.dataset.inst || (c && M.payKey(c, today().slice(0, 7)));
      const id = c && (c.paid || {})[key];
      if (!id) return;
      S().transactions = S().transactions.filter((t) => t.id !== id);
      S().investments.forEach((i) => { i.entries = i.entries.filter((e) => e.id !== id); });
      delete c.paid[key];
      if (c.paidOn) delete c.paidOn[key];
      await refresh();
    },

    addInvest: () => {
      md = { itype: 'Digital gold', sipOn: 'no', sipBack: 'yes' };
      openModal(`<h2>Add investment</h2>
        <input id="i-name" placeholder="Name, e.g. Gold on PhonePe, Nifty 50 fund" autocomplete="off">
        <span class="label">Type</span>${chipRow('itype', INV_TYPES.map((t) => [t, t]), md.itype)}
        <input id="i-amt" type="number" inputmode="decimal" placeholder="Already invested ₹ (optional)">
        <input id="i-val" type="number" inputmode="decimal" placeholder="Value now ₹ (optional)">
        <input id="i-ret" type="number" inputmode="decimal" placeholder="Return so far % (optional)">
        <div class="muted" style="margin:-2px 0 14px">Money you already invested does not change your wallet. Use Add money later for new investments.</div>
        ${sipFields(null)}
        <button class="btn" data-act="saveInvest">Save</button>`);
    },
    saveInvest: async () => {
      const name = $('i-name').value.trim();
      if (!name) return ui.alert('Give it a name');
      const amt = Number($('i-amt').value), val = $('i-val').value, ret = $('i-ret').value;
      const parsed = readSip();
      if (parsed.error) return ui.alert(parsed.error);
      const inv = { id: db.uid(), name, type: md.itype, value: val === '' ? null : Number(val), returnPct: ret === '' ? null : Number(ret), sip: parsed.sip, entries: amt > 0 ? [{ id: db.uid(), date: today(), amount: amt, w: false, note: 'Opening' }] : [] };
      if (inv.sip) settlePastSip(inv, md.sipBack);
      S().investments.push(inv);
      closeModal();
      await refresh();
      setTimeout(askSips, 350); // the sheet that just closed is still fading out
    },
    openInvest: (el) => investSheet(el.dataset.id),
    invReturn: async (el) => {
      const i = S().investments.find((x) => x.id === el.dataset.id);
      const v = await ui.prompt('Return so far %', hasReturn(i) ? i.returnPct : '', 'e.g. 12.4 (or -3 for a loss)');
      if (v === null) return;
      i.returnPct = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
      await commit();
      investSheet(i.id);
    },
    sipEdit: (el) => {
      const i = S().investments.find((x) => x.id === el.dataset.id);
      md = { sipInv: i.id, sipOn: 'yes', sipBack: 'yes' };
      openModal(`<h2>${i.sip ? 'Edit SIP' : 'Monthly SIP'}</h2><div class="muted" style="margin:-8px 0 14px">${esc(i.name)}</div>${sipFields(i)}<button class="btn" data-act="saveSip">Save SIP</button>`);
    },
    saveSip: async () => {
      const i = S().investments.find((x) => x.id === md.sipInv);
      const parsed = readSip();
      if (parsed.error) return ui.alert(parsed.error);
      i.sip = { ...(i.sip || {}), ...parsed.sip, done: (i.sip && i.sip.done) || {} };
      settlePastSip(i, md.sipBack);
      closeModal();
      await refresh();
      setTimeout(askSips, 350); // the sheet that just closed is still fading out
    },
    sipStop: async (el) => {
      const i = S().investments.find((x) => x.id === el.dataset.id);
      if (!(await ui.confirm('Money already added stays. Prysm just stops asking.', { title: 'Stop this SIP?', ok: 'Stop SIP', danger: true }))) return;
      i.sip.on = false;
      await refresh();
      investSheet(i.id);
    },
    sipYes: async () => {
      const found = M.sipDue(S()).find((d) => d.inv.id === md.sipInv && d.m === md.sipM);
      const amount = Number($('sip-amt').value);
      if (!found || !(amount > 0)) return ui.alert('Enter the amount you paid');
      payInstallment(found.inv, found.m, amount, today());
      closeModal();
      await refresh();
      setTimeout(askSips, 450);
    },
    sipSkip: async () => {
      const found = M.sipDue(S()).find((d) => d.inv.id === md.sipInv && d.m === md.sipM);
      if (found) found.inv.sip.done[found.m] = 'skipped';
      closeModal();
      await refresh();
      setTimeout(askSips, 450);
    },
    sipLater: () => closeModal(),
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
      if (i.sip && i.sip.done) Object.keys(i.sip.done).forEach((k) => { if (i.sip.done[k] === el.dataset.eid) delete i.sip.done[k]; });
      unlinkPaid(el.dataset.eid);
      await commit(); investSheet(i.id);
    },
    invDelete: async (el) => {
      const i = S().investments.findIndex((x) => x.id === el.dataset.id);
      if (i < 0) return;
      const [item] = S().investments.splice(i, 1);
      closeModal();
      ui.buzz('warn');
      await commit();
      // the money goes back to the wallet (it is worked out from the records), and Undo takes it out again
      ui.undo('Investment deleted', async () => {
        const list = S().investments;
        list.splice(Math.min(i, list.length), 0, item);
        await commit();
      });
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
      const i = S().lent.findIndex((l) => l.id === el.dataset.id);
      if (i < 0) return;
      const [item] = S().lent.splice(i, 1);
      ui.buzz('warn');
      await refresh();
      ui.undo('Record deleted', async () => {
        const list = S().lent;
        list.splice(Math.min(i, list.length), 0, item);
        await refresh();
      });
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
    askSips,
    confirmItems,
    applyConfirm,
    openWeekly,
    setTab: (k) => { tab = k; },
    getTab: () => tab,
  };
}
