import { addDays, dateStr, today, daysBetween } from './dates.js';

// Attendance rules
//  - A day with no mark counts as ABSENT once the day is over (today stays open until midnight).
//  - Weekly-off days (Settings) without a mark are neutral, not absent.
//  - Days before the tracking start are ignored.
//  - Present = 1, Half-day = 0.5, Absent = 0. Leave, Holiday and off-days do not count either way.
// Day kinds: P present, H half-day, L leave, O holiday, A absent, W weekly off, T today (unmarked),
//            F future, N before tracking started.

// Habits-style smoothing for a daily habit: the score moves gradually instead of jumping
const SMOOTH = Math.pow(0.5, 1 / 13);
const COUNTED = { P: 1, H: 0.5, A: 0 };

export function trackStart(S) {
  const first = Object.keys(S.attendance).sort()[0];
  const start = S.settings.attStart || today();
  return first && first < start ? first : start;
}

export function attCtx(S) {
  return { S, t: today(), start: trackStart(S), off: new Set((S.settings.weekOff || []).map(Number)) };
}

export function dayKind(c, ds) {
  const e = c.S.attendance[ds];
  if (e) {
    if (e.s === 'A') return ds > c.t ? 'F' : 'A';
    if (e.s) return e.s;
  }
  if (ds > c.t) return 'F';
  if (ds < c.start) return 'N';
  if (ds === c.t) return 'T';
  return c.off.has(new Date(`${ds}T00:00`).getDay()) ? 'W' : 'A';
}

export function rangeStats(c, from, to) {
  const out = { P: 0, H: 0, L: 0, O: 0, A: 0 };
  const end = to > c.t ? c.t : to;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const k = dayKind(c, d);
    if (k in out) out[k]++;
  }
  const counted = out.P + out.H + out.A;
  const worked = out.P + out.H * 0.5;
  return { ...out, counted, worked, pct: counted ? Math.round((worked / counted) * 100) : null };
}

// one score per day from the tracking start until today
export function scoreSeries(c) {
  const scores = [];
  let sc = 0;
  for (let d = c.start; d <= c.t; d = addDays(d, 1)) {
    const k = dayKind(c, d);
    if (k in COUNTED) sc = sc * SMOOTH + COUNTED[k] * (1 - SMOOTH);
    scores.push(sc);
  }
  return scores;
}

export function scoreAt(c, scores, ds) {
  if (!scores.length) return null;
  const i = Math.min(daysBetween(c.start, ds), scores.length - 1);
  return i < 0 ? null : Math.round(scores[i] * 100);
}

// gran: 'day' (14 days) | 'week' (14 weeks, Monday start) | 'month' (12 months)
export function periods(gran, t) {
  const out = [];
  if (gran === 'day') {
    for (let i = 13; i >= 0; i--) { const d = addDays(t, -i); out.push({ from: d, to: d }); }
  } else if (gran === 'week') {
    const dow = new Date(`${t}T00:00`).getDay();
    const weekStart = addDays(t, -((dow + 6) % 7));
    for (let i = 13; i >= 0; i--) { const f = addDays(weekStart, -7 * i); out.push({ from: f, to: addDays(f, 6) }); }
  } else {
    const [y, m] = t.split('-').map(Number);
    for (let i = 11; i >= 0; i--) out.push({ from: dateStr(new Date(y, m - 1 - i, 1)), to: dateStr(new Date(y, m - i, 0)) });
  }
  return out;
}

// day number normally, month name where the month changes (with the year on the first one)
export function labels(gran, ps) {
  return ps.map((p, i) => {
    const d = new Date(`${p.from}T00:00`);
    const mon = d.toLocaleDateString('en-US', { month: 'short' });
    const year = String(d.getFullYear());
    if (gran === 'month') return i === 0 || d.getMonth() === 0 ? [mon, year] : mon;
    const changed = i === 0 || new Date(`${ps[i - 1].from}T00:00`).getMonth() !== d.getMonth();
    if (!changed) return String(d.getDate());
    return i === 0 ? [mon, year] : mon;
  });
}

export function streaks(c) {
  let cur = 0, best = 0;
  for (let d = c.start; d <= c.t; d = addDays(d, 1)) {
    const k = dayKind(c, d);
    if (k === 'P' || k === 'H') { cur++; if (cur > best) best = cur; } else if (k === 'A') cur = 0;
  }
  return { cur, best };
}
