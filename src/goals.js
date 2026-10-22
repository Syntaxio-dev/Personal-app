import { addDays, today, daysBetween, pad } from './dates.js';
import { lastDay, shiftMonth } from './money.js';
import { labels as periodTicks } from './attendance.js';

// Goals rules
//  - A goal belongs to a period: week (Mon-Sun, like attendance), calendar month, calendar year, or a long-term deadline.
//  - kinds: 'yesno' (done or not), 'count' (add up to a target), 'value' (move from a start value to a target, e.g. weight).
//  - When the period is over (from 20:00 on its last day) the goal is DUE and must be answered: verdict, result and,
//    if it was not achieved, a reason and what happens next. Answered goals keep their review forever (the Journal).
//  - Bucket list items have a deadline date; once it passes the item must be marked done, moved (with a reason) or dropped.

export const HORIZONS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['long', 'Long term']];
export const TAGS = ['No time', 'Lost motivation', 'Unexpected event', 'Health', 'Money', 'Too ambitious', 'Forgot', 'Other'];
export const CATS = ['Travel', 'Experience', 'Learn', 'Health', 'Money', 'People', 'Other'];
export const REVIEW_HOUR = '20:00';

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const fmt = (s, o) => new Date(`${s}T00:00`).toLocaleDateString('en-IN', o);

// ---------- periods ----------
export function periodFor(horizon, t = today(), next = false) {
  if (horizon === 'week') {
    const dow = new Date(`${t}T00:00`).getDay();
    let start = addDays(t, -((dow + 6) % 7));
    if (next) start = addDays(start, 7);
    return { start, end: addDays(start, 6) };
  }
  if (horizon === 'month') {
    const m = next ? shiftMonth(t.slice(0, 7), 1) : t.slice(0, 7);
    return { start: `${m}-01`, end: `${m}-${pad(lastDay(m))}` };
  }
  if (horizon === 'year') {
    const y = Number(t.slice(0, 4)) + (next ? 1 : 0);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return null;
}

export function nextPeriod(g) {
  if (g.horizon === 'week') { const start = addDays(g.end, 1); return { start, end: addDays(start, 6) }; }
  if (g.horizon === 'month') { const m = shiftMonth(g.start.slice(0, 7), 1); return { start: `${m}-01`, end: `${m}-${pad(lastDay(m))}` }; }
  if (g.horizon === 'year') { const y = Number(g.start.slice(0, 4)) + 1; return { start: `${y}-01-01`, end: `${y}-12-31` }; }
  return null;
}

// first period after g that is not already over (a late review must not create a goal in the past)
export function upcomingPeriod(g, t = today()) {
  let p = nextPeriod(g);
  for (let i = 0; p && p.end < t && i < 600; i++) p = nextPeriod({ ...g, start: p.start, end: p.end });
  return p;
}

export function periodLabel(g) {
  if (g.horizon === 'week') return `${fmt(g.start, { day: 'numeric', month: 'short' })} to ${fmt(g.end, { day: 'numeric', month: 'short' })}`;
  if (g.horizon === 'month') return fmt(g.start, { month: 'long', year: 'numeric' });
  if (g.horizon === 'year') return g.start.slice(0, 4);
  return `by ${fmt(g.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function daysLeftLabel(g, t = today()) {
  if (t < g.start) { const n = daysBetween(t, g.start); return `Starts in ${n} day${n === 1 ? '' : 's'}`; }
  const n = daysBetween(t, g.end);
  if (n < 0) return 'Ended';
  if (n === 0) return 'Last day';
  return `${n} day${n === 1 ? '' : 's'} left`;
}

// ---------- progress ----------
export function progressOf(g) {
  const p = g.progress || [];
  if (g.kind === 'count') return sum(p, (e) => e.amount);
  if (g.kind === 'value') return p.length ? p[p.length - 1].amount : g.from;
  return p.length ? 1 : 0;
}

export function percentOf(g) {
  const v = progressOf(g);
  if (g.kind === 'yesno') return v ? 100 : 0;
  if (g.kind === 'count') return g.target > 0 ? Math.min(100, Math.round((v / g.target) * 100)) : 0;
  const span = g.target - g.from;
  return span ? Math.max(0, Math.min(100, Math.round(((v - g.from) / span) * 100))) : 100;
}

export function progressText(g) {
  const v = progressOf(g);
  const unit = g.unit ? ` ${g.unit}` : '';
  if (g.kind === 'yesno') return v ? 'Done' : 'Not done yet';
  if (g.kind === 'count') return `${v} / ${g.target}${unit}`;
  return `${v}${unit} · target ${g.target}${unit}`;
}

export const suggestVerdict = (g) => { const p = percentOf(g); return p >= 100 ? 'achieved' : p >= 50 ? 'partial' : 'missed'; };

// ---------- what needs attention ----------
export function isDue(g, now = new Date()) {
  return !g.review && now >= new Date(`${g.end}T${REVIEW_HOUR}`);
}
export const dueGoals = (S, now = new Date()) => S.goals.filter((g) => isDue(g, now)).sort((a, b) => a.end.localeCompare(b.end));
export const overdueDreams = (S, t = today()) => S.bucket.filter((b) => b.status === 'open' && b.deadline && b.deadline < t);

// year and long-term goals untouched for 30 days, dreams untouched for 90 days
export const staleGoals = (S, t = today()) => S.goals.filter((g) => !g.review && (g.horizon === 'year' || g.horizon === 'long') && g.start <= t && daysBetween(g.touched || g.created || g.start, t) >= 30);
export const staleDreams = (S, t = today()) => S.bucket.filter((b) => b.status === 'open' && !(b.deadline && b.deadline < t) && daysBetween(b.touched || b.created, t) >= 90);

export function dreamCountdown(b, t = today()) {
  if (!b.deadline) return { text: 'No deadline', tone: '' };
  const n = daysBetween(t, b.deadline);
  if (n < 0) return { text: `Overdue ${-n} day${n === -1 ? '' : 's'}`, tone: 'late' };
  if (n === 0) return { text: 'Today', tone: 'warn' };
  if (n <= 30) return { text: `${n} day${n === 1 ? '' : 's'} left`, tone: 'warn' };
  if (n < 365) return { text: `${n} days left`, tone: '' };
  const y = Math.floor(n / 365), d = n % 365;
  return { text: `${y} yr${y > 1 ? 's' : ''}${d >= 30 ? ` ${Math.round(d / 30)} mo` : ''} left`, tone: '' };
}

// ---------- journal ----------
const SCORE = { achieved: 1, partial: 0.5, missed: 0 };

// share of answered goals achieved, per week (last 8) or month (last 6); null where nothing was answered
export function hitSeries(S, mode, t = today()) {
  const answered = S.goals.filter((g) => g.review && !g.review.early);
  const buckets = [];
  if (mode === 'month') {
    const m0 = t.slice(0, 7);
    for (let i = 5; i >= 0; i--) {
      const m = shiftMonth(m0, -i);
      buckets.push({ label: fmt(`${m}-01`, { month: 'short' }), from: `${m}-01`, to: `${m}-${pad(lastDay(m))}` });
    }
  } else {
    const dow = new Date(`${t}T00:00`).getDay();
    const ws = addDays(t, -((dow + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const f = addDays(ws, -7 * i);
      buckets.push({ label: fmt(f, { day: 'numeric', month: 'short' }), from: f, to: addDays(f, 6) });
    }
  }
  return {
    labels: periodTicks(mode === 'month' ? 'month' : 'week', buckets),
    values: buckets.map((b) => {
      const gs = answered.filter((g) => g.end >= b.from && g.end <= b.to);
      return gs.length ? Math.round((sum(gs, (g) => SCORE[g.review.verdict] ?? 0) / gs.length) * 100) : null;
    }),
  };
}

// consecutive weeks (most recent first) in which every answered goal was achieved
export function streakWeeks(S, t = today()) {
  const answered = S.goals.filter((g) => g.review && !g.review.early);
  const dow = new Date(`${t}T00:00`).getDay();
  const ws = addDays(t, -((dow + 6) % 7));
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    const f = addDays(ws, -7 * i), to = addDays(f, 6);
    const gs = answered.filter((g) => g.end >= f && g.end <= to);
    if (!gs.length) continue;
    if (gs.every((g) => g.review.verdict === 'achieved')) streak++; else break;
  }
  return streak;
}

export function topReasons(S) {
  const counts = {};
  S.goals.filter((g) => g.review && !g.review.early && g.review.verdict !== 'achieved').forEach((g) => (g.review.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
