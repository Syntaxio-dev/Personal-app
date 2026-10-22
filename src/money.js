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
  return { tx, income: sum(inc, (t) => t.amount), expense: sum(exp, (t) => t.amount), byCat, byPerson, bySource, invested };
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
export const billActive = (c, m) => c.active !== false && m >= (c.startMonth || '0000-00') && (!c.endMonth || m <= c.endMonth);

export function billsFor(S, m, t = today()) {
  return S.commitments.filter((c) => billActive(c, m)).map((c) => {
    const due = dueDate(c, m);
    const paid = !!(c.paid || {})[m];
    return { c, due, paid, late: !paid && due < t ? daysBetween(due, t) : 0 };
  }).sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

// EMIs still to pay, counting this month only if it is unpaid
export function emisLeft(c, m, paid) {
  return c.endMonth ? Math.max(0, monthDiff(m, c.endMonth) + (paid ? 0 : 1)) : null;
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
  const bills = sum(due, (b) => Number(b.c.amount) || 0);
  const w = wallet(S);
  const days = target > t ? daysBetween(t, target) : 0;
  return { wallet: w, bills, safe: w - bills, target, days, perDay: days > 0 ? Math.max(0, w - bills) / days : null, salaryLate: !added && target <= t };
}
