import { addDays, dateStr, today, daysBetween, pad } from './dates.js';

// Money rules
//  - Nothing is added automatically: balance only moves when the user logs something.
//  - Wallet = opening balance + income - expenses - money put into investments - money lent out
//             + money taken out of investments + money got back from lent.
//  - "Already invested" / "lent earlier" records (w === false) do not touch the wallet when created.
//  - Bills (loans, family, fixed, SIP) are monthly commitments; paying one creates an expense
//    (or an investment entry for SIP) so the wallet and reports stay consistent.

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

export const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
export const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); return dateStr(new Date(y, mo - 1 + d, 1)).slice(0, 7); };
export const monthDiff = (a, b) => { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

// ---------- investments and lent money ----------
export const investedOf = (inv) => sum(inv.entries, (e) => e.amount);
export const investCash = (inv) => sum(inv.entries, (e) => (e.w === false ? 0 : e.amount));
export const currentValue = (inv) => (inv.value === null || inv.value === undefined || inv.value === '' ? investedOf(inv) : Number(inv.value));
export const returnedOf = (l) => sum(l.returns, (r) => r.amount);
export const lentLeft = (l) => l.amount - returnedOf(l);
const lentCash = (l) => (l.w === false ? 0 : l.amount) - returnedOf(l);

export function wallet(S) {
  const income = sum(S.transactions.filter((t) => t.type === 'income'), (t) => t.amount);
  const expense = sum(S.transactions.filter((t) => t.type === 'expense'), (t) => t.amount);
  return (Number(S.settings.openingBalance) || 0) + income - expense - sum(S.investments, investCash) - sum(S.lent, lentCash);
}

// ---------- month and week numbers ----------
export function monthStats(S, m) {
  const tx = S.transactions.filter((t) => t.date.startsWith(m));
  const inc = tx.filter((t) => t.type === 'income');
  const exp = tx.filter((t) => t.type === 'expense');
  const byCat = {}, byPerson = {}, bySource = {};
  exp.forEach((t) => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    if (t.person) byPerson[t.person] = (byPerson[t.person] || 0) + t.amount;
  });
  inc.forEach((t) => { const k = t.category || 'Income'; bySource[k] = (bySource[k] || 0) + t.amount; });
  const invested = sum(S.investments, (i) => sum(i.entries.filter((e) => e.date.startsWith(m)), (e) => e.amount));
  const cash = sum(exp.filter((t) => t.mode === 'cash'), (t) => t.amount);
  return { tx, income: sum(inc, (t) => t.amount), expense: sum(exp, (t) => t.amount), cash, online: sum(exp, (t) => t.amount) - cash, byCat, byPerson, bySource, invested };
}

export function weekStats(S, t = today()) {
  const dow = new Date(`${t}T00:00`).getDay();
  const from = addDays(t, -((dow + 6) % 7));
  const prevFrom = addDays(from, -7);
  const spent = (a, b) => S.transactions.filter((x) => x.type === 'expense' && x.date >= a && x.date <= b);
  const cur = spent(from, t);
  const byCat = {};
  cur.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
  return {
    from,
    total: sum(cur, (x) => x.amount),
    prevTotal: sum(spent(prevFrom, addDays(from, -1)), (x) => x.amount),
    count: cur.length,
    top: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

// ---------- bills (monthly commitments) ----------
export const dueDate = (c, m) => `${m}-${pad(Math.min(c.dueDay, lastDay(m)))}`;
// one-time debts (kind 'owed') have a full dueDate and never appear in the monthly list
export const billActive = (c, m) => c.kind !== 'owed' && c.kind !== 'plan' && c.active !== false && m >= (c.startMonth || '0000-00') && (!c.endMonth || m <= c.endMonth);
// the key under which a payment is remembered in commitment.paid
export const payKey = (c, m) => (c.kind === 'owed' ? 'once' : m);

// ---------- installments (EMI) and the payment record ----------
// commitment.total = installments in all, commitment.paidBefore = installments paid before the bill was added
// commitment.paidOn = { key: 'YYYY-MM-DD' } remembers when each payment was made
const MONTH_KEY = /^\d{4}-\d{2}$/;

export function paidDateOf(S, c, key) {
  const on = (c.paidOn || {})[key];
  if (on) return on;
  const id = (c.paid || {})[key];
  if (!id || id === true) return '';
  const tx = S.transactions.find((t) => t.id === id);
  if (tx) return tx.date;
  for (const inv of S.investments) {
    const e = inv.entries.find((x) => x.id === id);
    if (e) return e.date;
  }
  return '';
}

// a settled bill stays in the main list for a week, then it only lives in "All payments"
// (a payment whose date is unknown stays visible rather than vanishing)
export const isRecent = (b, t = today()) => !b.paid || !b.paidAt || b.paidAt >= addDays(t, -7);

export function emiStats(c) {
  if (c.kind === 'plan') {
    const insts = c.inst || [];
    const paidIn = insts.filter((i) => (c.paid || {})[i.id]).length;
    const before = Number(c.paidBefore) || 0;
    return { paid: before + paidIn, total: before + insts.length, left: insts.length - paidIn, done: insts.length > 0 && paidIn === insts.length };
  }
  const inApp = Object.keys(c.paid || {}).filter((k) => MONTH_KEY.test(k)).length;
  const paid = (Number(c.paidBefore) || 0) + inApp;
  let total = Number(c.total) || 0;
  if (!total && c.endMonth && c.startMonth) total = monthDiff(c.startMonth, c.endMonth) + 1 + (Number(c.paidBefore) || 0);
  return { paid, total, left: total ? Math.max(0, total - paid) : null, done: !!total && paid >= total };
}

// what the whole plan costs: a plan has its own amount for every installment
export const emiTotal = (c) => (c.kind === 'plan' ? (c.inst || []).reduce((n, i) => n + (Number(i.amount) || 0), 0) : (Number(c.amount) || 0) * (emiStats(c).total || 0));

export function lastPaidDate(S, c) {
  return Object.keys(c.paid || {}).map((k) => paidDateOf(S, c, k)).filter(Boolean).sort().pop() || '';
}

export function completedEmis(S) {
  return S.commitments.filter((c) => (c.kind === 'loan' || c.kind === 'plan') && emiStats(c).done)
    .map((c) => ({ c, stats: emiStats(c), doneOn: lastPaidDate(S, c) }))
    .sort((a, b) => b.doneOn.localeCompare(a.doneOn));
}

// every bill, debt and SIP payment ever made, newest first (this is never trimmed)
export function paymentHistory(S) {
  const out = [];
  S.transactions.filter((t) => t.type === 'expense' && t.linkId).forEach((t) => {
    const c = S.commitments.find((x) => x.id === t.linkId);
    out.push({ id: t.id, date: t.date, name: c ? c.name : t.note || t.category, kind: c ? c.kind : 'fixed', person: t.person || '', amount: t.amount });
  });
  S.investments.forEach((inv) => inv.entries.filter((e) => e.note === 'SIP' && e.w !== false && e.amount > 0).forEach((e) => {
    out.push({ id: e.id, date: e.date, name: inv.name, kind: 'sip', person: '', amount: e.amount });
  }));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// Everything that has to be paid on one specific date: one-time debts and the installments of a plan with set dates.
// commitment.inst = [{ id, date, amount }]; a payment is remembered under commitment.paid[inst.id]
export function datedFor(S, t = today()) {
  const out = owedFor(S, t).map((b) => ({ ...b, key: 'once', amount: Number(b.c.amount) || 0 }));
  S.commitments.filter((c) => c.kind === 'plan').forEach((c) => {
    const insts = [...(c.inst || [])].sort((a, b) => a.date.localeCompare(b.date));
    const before = Number(c.paidBefore) || 0;
    insts.forEach((it, i) => {
      const paid = !!(c.paid || {})[it.id];
      out.push({ c, inst: it, key: it.id, due: it.date, amount: Number(it.amount) || 0, paid, paidAt: paid ? paidDateOf(S, c, it.id) : '', late: !paid && it.date < t ? daysBetween(it.date, t) : 0, n: before + i + 1, total: before + insts.length });
    });
  });
  return out.sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

// money borrowed from a person or an app that must be returned on one specific date, no installments
export function owedFor(S, t = today()) {
  return S.commitments.filter((c) => c.kind === 'owed' && c.dueDate).map((c) => {
    const paid = !!(c.paid || {}).once;
    return { c, due: c.dueDate, paid, paidAt: paid ? paidDateOf(S, c, 'once') : '', late: !paid && c.dueDate < t ? daysBetween(c.dueDate, t) : 0 };
  }).sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

export function billsFor(S, m, t = today()) {
  return S.commitments.filter((c) => billActive(c, m)).map((c) => {
    const due = dueDate(c, m);
    const paid = !!(c.paid || {})[m];
    return { c, due, paid, paidAt: paid ? paidDateOf(S, c, m) : '', late: !paid && due < t ? daysBetween(due, t) : 0 };
  }).sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

// monthly bills that begin in a later month (an EMI that starts next month, a bill added after its due day)
export function upcomingBills(S, m) {
  return S.commitments.filter((c) => c.kind !== 'owed' && c.kind !== 'plan' && c.active !== false && (c.startMonth || '0000-00') > m)
    .map((c) => ({ c, due: dueDate(c, c.startMonth) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

// EMIs still to pay, counting this month only if it is unpaid
export function emisLeft(c, m, paid) {
  return c.endMonth ? Math.max(0, monthDiff(m, c.endMonth) + (paid ? 0 : 1)) : null;
}

// ---------- SIP (a monthly investment that is confirmed by the user) ----------
// investment.sip = { amount, day, start: 'YYYY-MM', on, done: { 'YYYY-MM': entryId | 'skipped' } }
export const sipDate = (inv, m) => `${m}-${pad(Math.min(inv.sip.day, lastDay(m)))}`;

// installments whose date has come but that nobody confirmed yet (oldest first)
export function sipDue(S, t = today()) {
  const out = [];
  const cur = t.slice(0, 7);
  S.investments.forEach((inv) => {
    const sip = inv.sip;
    if (!sip || sip.on === false) return;
    let m = sip.start;
    for (let i = 0; m <= cur && i < 60; i++, m = shiftMonth(m, 1)) {
      if ((sip.done || {})[m]) continue;
      const date = sipDate(inv, m);
      if (date <= t) out.push({ inv, m, date });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- salary and safe-to-spend ----------
export const salaryDate = (S, m) => `${m}-${pad(Math.min(Number(S.settings.salaryDay) || 11, lastDay(m)))}`;
export const salaryAdded = (S, m) => S.transactions.some((t) => t.type === 'income' && t.source === 'salary' && t.date.startsWith(m));

// what is really free: wallet minus the bills still to pay before the next salary
export function safeToSpend(S, t = today()) {
  const m0 = t.slice(0, 7), m1 = shiftMonth(m0, 1);
  const added = salaryAdded(S, m0);
  const target = salaryDate(S, added ? m1 : m0);
  const due = [m0, m1].flatMap((m) => billsFor(S, m, t).filter((b) => !b.paid && (b.due <= target || b.due < t)));
  const dated = datedFor(S, t).filter((b) => !b.paid && (b.due <= target || b.due < t));
  const bills = sum(due, (b) => Number(b.c.amount) || 0) + sum(dated, (b) => b.amount);
  const w = wallet(S);
  const days = target > t ? daysBetween(t, target) : 0;
  return { wallet: w, bills, safe: w - bills, target, days, perDay: days > 0 ? Math.max(0, w - bills) / days : null, salaryLate: !added && target <= t };
}
