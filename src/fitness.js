// Fitness mode rules: no DOM and no storage in here, so every rule can be tested on its own.
// State lives in db.get().fitness (see emptyFitness), the screens are in fitnessui.js.
import { BUILTIN, BUILTIN_BY_ID, GROUPS, MUSCLES, KINDS, EQUIPMENT } from './exercises.js';
import { addDays, daysBetween, dateStr, pad } from './dates.js';

export const SET_TYPES = [['n', 'Normal'], ['w', 'Warm-up'], ['d', 'Drop set'], ['f', 'Failure']];
export const SET_MARK = { n: '', w: 'W', d: 'D', f: 'F' };
// blue-friendly dots, kept apart from the green / red / yellow that mean done / missed / warning elsewhere
export const GROUP_COLOR = { chest: '#3b82f6', back: '#22d3ee', shoulders: '#818cf8', arms: '#7dd3fc', legs: '#2dd4bf', core: '#94a3b8', cardio: '#e2e8f0', full: '#a5b4fc' };
export const REST_CHOICES = [45, 60, 90, 120, 180, 240];
export const MAX_SETS = 12;

export const emptyFitness = () => ({
  exercises: [],
  routines: [],
  sessions: [],
  active: null,
  steps: { days: {} },
  media: {}, // form videos and photos per exercise id: { [exId]: [{ id, k: 'video' | 'photo', n, x (file extension), size, t }] }, the files live on the phone (media.js)
  settings: { goal: 8000, height: 0, weight: 0, restSec: 90, weekGoal: 4, maxRest: 2, remindOn: false, remindAt: '18:00' },
});

// ---------- exercises ----------
export const allExercises = (F) => [...BUILTIN, ...F.exercises];
export const exOf = (F, id) => BUILTIN_BY_ID[id] || F.exercises.find((e) => e.id === id) || null;
export const groupOf = (muscle) => (GROUPS.find((g) => g[2].includes(muscle)) || GROUPS[0])[0];
export const groupLabel = (id) => (GROUPS.find((g) => g[0] === id) || [id, id])[1];
export const muscleLabel = (id) => (MUSCLES.find((m) => m[0] === id) || [id, id])[1];

// the picker and the library: every word typed must be in the name (or the muscle), narrowed by equipment and muscle
export function filterExercises(F, { q = '', eq = 'all', mu = 'all' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return allExercises(F).filter((e) => {
    if (eq !== 'all' && e.equip !== eq) return false;
    if (mu !== 'all' && e.muscle !== mu && !(mu === 'lats' && e.muscle === 'back')) return false;
    if (!words.length) return true;
    const hay = (e.name + ' ' + muscleLabel(e.muscle) + ' ' + e.equip).toLowerCase();
    return words.every((w) => hay.includes(w));
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// the exercises you did most recently, newest first, each once
export function recentExercises(F, limit = 8) {
  const ids = [];
  sortedSessions(F).reverse().forEach((s) => s.items.forEach((i) => { if (ids.length < limit && !ids.includes(i.ex) && exOf(F, i.ex)) ids.push(i.ex); }));
  return ids.map((id) => exOf(F, id));
}

export const mediaOf = (F, exId) => (F.media && F.media[exId]) || [];
export const MAX_MEDIA = 8;

// a saved workout keeps the name, muscle and type it was done with, so deleting an exercise never breaks history
export function itemInfo(F, item) {
  const e = exOf(F, item.ex);
  return { name: e ? e.name : item.n || 'Exercise', muscle: e ? e.muscle : item.m || 'chest', kind: e ? e.kind : item.k || 'wr' };
}

export const snapshot = (e) => ({ ex: e.id, n: e.name, m: e.muscle, k: e.kind });

// ---------- sets ----------
export const trim = (n) => String(Math.round(Number(n) * 100) / 100);
export const UNIT = { wr: 'reps', bw: 'reps', sec: 'sec', min: 'min' };
export const hasWeight = (kind) => kind === 'wr' || kind === 'bw';

// "40 kg x 15", "12 reps", "45 sec"
export function setText(kind, s) {
  if (kind === 'wr') return `${trim(s.kg)} kg × ${trim(s.reps)}`;
  if (kind === 'bw') return s.kg > 0 ? `+${trim(s.kg)} kg × ${trim(s.reps)}` : `${trim(s.reps)} reps`;
  return `${trim(s.reps)} ${UNIT[kind]}`;
}

export const validSet = (kind, s) => Number(s.reps) > 0 && (kind !== 'wr' || Number(s.kg) >= 0);

// the newest finished workout that contains this exercise (sets as they were done)
export function lastSets(F, exId, beforeStart = Infinity) {
  let best = null;
  F.sessions.forEach((s) => {
    if (s.start >= beforeStart) return;
    const it = s.items.find((i) => i.ex === exId && i.sets.length);
    if (it && (!best || s.start > best.start)) best = { start: s.start, date: s.date, sets: it.sets };
  });
  return best;
}

export const lastText = (F, ex) => {
  const l = lastSets(F, ex.id);
  if (!l) return '';
  // the top set is the clearest single line: heaviest weight, then most reps
  const top = l.sets.filter((s) => s.t !== 'w').sort((a, b) => b.kg - a.kg || b.reps - a.reps)[0] || l.sets[0];
  return `${setText(ex.kind, top)} · ${l.sets.length} ${l.sets.length === 1 ? 'set' : 'sets'}`;
};

// A routine item keeps its plan per set: sets = [{ kg, reps }]. Older saves kept a count plus one reps/kg pair; both read the same way.
export function planOf(it) {
  if (Array.isArray(it.sets)) return it.sets.map((s) => ({ kg: Number(s.kg) || 0, reps: Number(s.reps) || 0 }));
  const n = Math.min(MAX_SETS, Math.max(1, Math.round(Number(it.sets)) || 3));
  return Array.from({ length: n }, () => ({ kg: Number(it.kg) || 0, reps: Number(it.reps) || 0 }));
}
// rest after a set of this exercise in seconds; -1 = use the default from the settings, 0 = no timer
export const restOf = (it) => (it.rest !== null && it.rest !== undefined && it.rest !== '' && Number.isFinite(Number(it.rest)) && Number(it.rest) >= 0 ? Math.min(600, Math.round(Number(it.rest))) : -1);
export const restFor = (F, it) => { const r = restOf(it); return r >= 0 ? r : F.settings.restSec; };
export const restLabel = (sec) => (sec <= 0 ? 'Off' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}min ${sec % 60}s`);
export const REST_PICKS = [0, 30, 45, 60, 90, 120, 180, 240];

// Sets for an exercise added without a plan: what you did last time (same position, or the last set), else empty.
export function prefillSets(F, ex, plan = {}) {
  const n = Math.min(MAX_SETS, Math.max(1, Math.round(Number(plan.sets)) || 3));
  const prev = lastSets(F, ex.id);
  const work = prev ? prev.sets.filter((s) => s.t !== 'w') : [];
  return Array.from({ length: n }, (_, i) => {
    const p = work.length ? work[Math.min(i, work.length - 1)] : null;
    return { kg: p ? p.kg : Number(plan.kg) || 0, reps: p ? p.reps : Number(plan.reps) || 0, t: 'n', done: false };
  });
}

// the running workout: the routine's plan (a set the routine left empty falls back to last time)
export function startActive(F, routine, now, id) {
  const items = [];
  if (routine) {
    routine.items.forEach((it) => {
      const e = exOf(F, it.ex) || { id: it.ex, name: it.n, muscle: it.m, kind: it.k || 'wr' };
      const fallback = prefillSets(F, e, {});
      const sets = planOf(it).map((p, i) => (p.kg || p.reps ? { kg: p.kg, reps: p.reps, t: 'n', done: false } : { ...fallback[Math.min(i, fallback.length - 1)] }));
      items.push({ ...snapshot(e), rest: restOf(it), note: '', sets });
    });
  }
  return { id, start: now, name: routine ? routine.name : 'Workout', routineId: routine ? routine.id : '', items, restUntil: 0, note: '' };
}

export function addExerciseTo(F, active, e) {
  if (active.items.some((i) => i.ex === e.id)) return false;
  active.items.push({ ...snapshot(e), rest: -1, note: '', sets: prefillSets(F, e, {}) });
  return true;
}

// a new routine item for an exercise: its plan starts from the last time you did it
export const newRoutineItem = (F, e) => ({ ...snapshot(e), rest: -1, sets: prefillSets(F, e, { sets: 3, reps: e.kind === 'min' ? 20 : e.kind === 'sec' ? 45 : 10 }).map((s) => ({ kg: s.kg, reps: s.reps })) });

// turns the running workout into a saved one: only the sets that were ticked, and only if something was done
export function finishActive(active, now) {
  const items = active.items.map((it) => ({
    ex: it.ex, n: it.n, m: it.m, k: it.k, note: it.note || '',
    sets: it.sets.filter((s) => s.done && validSet(it.k, s)).map((s) => (s.pr ? { kg: Number(s.kg) || 0, reps: Number(s.reps) || 0, t: s.t, pr: true } : { kg: Number(s.kg) || 0, reps: Number(s.reps) || 0, t: s.t })),
  })).filter((it) => it.sets.length);
  if (!items.length) return null;
  return { id: active.id, date: dateStr(new Date(active.start)), start: active.start, end: now, name: active.name, routineId: active.routineId || '', items, note: active.note || '' };
}

// Did this ticked set beat last time? Judged against the same exercise in the previous workout plus the sets already done today.
// null = no (or nothing to compare with), else { kind: 'weight' | 'reps' }.
export function betterThanLast(F, active, it, s) {
  if (s.t === 'w') return null;
  const prev = lastSets(F, it.ex, active.start);
  if (!prev) return null;
  const pool = prev.sets.filter((x) => x.t !== 'w').concat(it.sets.filter((x) => x !== s && x.done && x.t !== 'w'));
  if (!pool.length) return null;
  const reps = Number(s.reps) || 0, kg = Number(s.kg) || 0;
  if (!(reps > 0)) return null;
  if (hasWeight(it.k)) {
    if (kg > Math.max(...pool.map((x) => x.kg)) + 1e-9) return { kind: 'weight' };
    const same = pool.filter((x) => Math.abs(x.kg - kg) < 1e-9);
    if (same.length && reps > Math.max(...same.map((x) => x.reps))) return { kind: 'reps' };
    return null;
  }
  return reps > Math.max(...pool.map((x) => x.reps)) ? { kind: 'reps' } : null;
}

// what a routine would become if it followed today's workout: only exercises that were done and differ from the plan
export function routineUpdates(F, active) {
  const r = active.routineId && F.routines.find((x) => x.id === active.routineId);
  if (!r) return [];
  const out = [];
  r.items.forEach((item) => {
    const it = active.items.find((x) => x.ex === item.ex);
    if (!it) return;
    const done = it.sets.filter((x) => x.done && x.t !== 'w' && validSet(it.k, x)).map((x) => ({ kg: Number(x.kg) || 0, reps: Number(x.reps) || 0 }));
    if (!done.length) return;
    const plan = planOf(item);
    if (done.length !== plan.length || done.some((d, i) => d.kg !== plan[i].kg || d.reps !== plan[i].reps)) out.push({ ex: item.ex, sets: done });
  });
  return out;
}
export function applyRoutineUpdates(F, routineId, updates) {
  const r = F.routines.find((x) => x.id === routineId);
  if (!r) return;
  updates.forEach((u) => { const item = r.items.find((x) => x.ex === u.ex); if (item) item.sets = u.sets.slice(0, MAX_SETS); });
}

// the routine's progress: one point per finished workout of this routine
export const routineSessions = (F, routineId) => sortedSessions(F).filter((s) => s.routineId === routineId);
export const sessionReps = (s) => s.items.reduce((n, i) => n + i.sets.filter((x) => x.t !== 'w').reduce((a, x) => a + x.reps, 0), 0);
export function routineSeries(F, routineId, metric, fromDate) {
  return routineSessions(F, routineId).filter((s) => s.date >= fromDate).map((s) => ({ date: s.date, v: metric === 'reps' ? sessionReps(s) : metric === 'duration' ? sessionMinutes(s) : sessionVolume(s) }));
}

export const doneCount = (active) => active.items.reduce((n, it) => n + it.sets.filter((s) => s.done).length, 0);
// kg lifted so far in the running workout (ticked sets, no warm-ups, no time based exercises)
export const liveVolume = (active) => Math.round(active.items.reduce((v, it) => v + (hasWeight(it.k) ? it.sets.filter((s) => s.done && s.t !== 'w').reduce((a, s) => a + (Number(s.kg) || 0) * (Number(s.reps) || 0), 0) : 0), 0));
export const totalSets = (active) => active.items.reduce((n, it) => n + it.sets.length, 0);

export const sessionGroups = (s) => [...new Set(s.items.map((i) => groupOf(i.m)))];
export const sessionSets = (s) => s.items.reduce((n, i) => n + i.sets.length, 0);
export const sessionMinutes = (s) => Math.max(1, Math.round((s.end - s.start) / 60000));
// weight lifted; warm-ups and time based exercises do not count
export const sessionVolume = (s) => Math.round(s.items.reduce((v, i) => v + (hasWeight(i.k) ? i.sets.filter((x) => x.t !== 'w').reduce((a, x) => a + x.kg * x.reps, 0) : 0), 0));

export const sortedSessions = (F) => F.sessions.slice().sort((a, b) => a.start - b.start);

// ---------- calendar and consistency ----------
export function sessionsByDay(F) {
  const map = {};
  sortedSessions(F).forEach((s) => { (map[s.date] = map[s.date] || []).push(s); });
  return map;
}

export const dayGroups = (list) => [...new Set((list || []).flatMap(sessionGroups))];

// days since each group was last trained (null = never)
export function recency(F, todayStr) {
  const last = {};
  F.sessions.forEach((s) => sessionGroups(s).forEach((g) => { if (!last[g] || s.date > last[g]) last[g] = s.date; }));
  return GROUPS.map(([id, label]) => ({ id, label, days: last[id] ? Math.max(0, daysBetween(last[id], todayStr)) : null }));
}

export function monthSummary(F, ym) {
  const list = F.sessions.filter((s) => s.date.startsWith(ym));
  return { days: new Set(list.map((s) => s.date)).size, sessions: list.length, sets: list.reduce((n, s) => n + sessionSets(s), 0), volume: list.reduce((n, s) => n + sessionVolume(s), 0), minutes: list.reduce((n, s) => n + sessionMinutes(s), 0) };
}

// Consecutive workout days. Rest days do not break it: it only breaks after more than `maxRest` days in a row without one.
export function streak(F, todayStr, maxRest) {
  const days = [...new Set(F.sessions.map((s) => s.date))].sort();
  if (!days.length) return { current: 0, best: 0, alive: false, last: null };
  let best = 0, run = 0, prev = null;
  days.forEach((d) => {
    if (prev && daysBetween(prev, d) - 1 > maxRest) run = 0;
    run += 1;
    best = Math.max(best, run);
    prev = d;
  });
  const last = days[days.length - 1];
  const alive = Math.max(0, daysBetween(last, todayStr) - 1) <= maxRest;
  return { current: alive ? run : 0, best, alive, last };
}

// Monday of the week that holds `dateStr`
export function weekStart(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return addDays(s, -((dow + 6) % 7));
}

export function weekStrip(F, todayStr) {
  const start = weekStart(todayStr);
  const by = sessionsByDay(F);
  const days = Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return { date, groups: dayGroups(by[date]), today: date === todayStr, future: date > todayStr }; });
  return { days, done: days.filter((d) => d.groups.length).length };
}

// Monday-first month grid: leading blanks, then the days
export function monthCells(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  return { lead: first, days: Array.from({ length: count }, (_, i) => `${ym}-${pad(i + 1)}`) };
}

// ---------- steps ----------
export const stepsOn = (F, date) => Number(F.steps.days[date]) || 0;

// the phone counts, the app mirrors: a day only ever goes up (clearing the app data must not erase a day already saved)
export function mergeStepDays(local, native) {
  const out = { ...local };
  Object.entries(native || {}).forEach(([d, n]) => {
    const v = Math.round(Number(n));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && v >= 0 && v > (out[d] || 0)) out[d] = Math.min(v, 200000);
  });
  return out;
}

export function lastDays(F, todayStr, n) {
  return Array.from({ length: n }, (_, i) => { const date = addDays(todayStr, i - (n - 1)); return { date, steps: stepsOn(F, date) }; });
}

// Estimates only: stride is about 41.5% of height, walking burns about 0.57 kcal per kg per km
export const distanceKm = (steps, heightCm) => (steps * (heightCm > 0 ? heightCm : 170) * 0.415) / 100000;
export const kcalOf = (steps, heightCm, weightKg) => Math.round(distanceKm(steps, heightCm) * (weightKg > 0 ? weightKg : 70) * 0.57);

// days in a row (up to yesterday, plus today if it already counts) on which the step goal was reached
export function goalStreak(F, todayStr, goal) {
  if (!(goal > 0)) return 0;
  let n = 0;
  let d = stepsOn(F, todayStr) >= goal ? todayStr : addDays(todayStr, -1);
  while (stepsOn(F, d) >= goal) { n += 1; d = addDays(d, -1); if (n > 3650) break; }
  return n;
}

// ---------- rest timer and reminders ----------
export const restLeft = (active, now) => (active && active.restUntil > now ? Math.ceil((active.restUntil - now) / 1000) : 0);
export const clock = (sec) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;

// the days (today first) the workout reminder should fire: none once you trained that day, and not today if the time has passed
export function reminderDates(F, todayStr, now) {
  const st = F.settings;
  if (!st.remindOn || !/^\d{2}:\d{2}$/.test(st.remindAt)) return [];
  const done = new Set(F.sessions.map((s) => s.date));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(todayStr, i);
    if (done.has(date)) continue;
    if (new Date(`${date}T${st.remindAt}`).getTime() <= now) continue;
    out.push(date);
  }
  return out;
}

// ---------- cleaning (backups are untrusted input) ----------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (v === undefined || v === null ? '' : String(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const muscleIds = new Set(MUSCLES.map((m) => m[0]));
const kindIds = new Set(KINDS.map((k) => k[0]));
const round2 = (v) => Math.round(v * 100) / 100;

const cleanSet = (s) => { const o = { kg: round2(clamp(s.kg, 0, 1000)), reps: round2(clamp(s.reps, 0, 9999)), t: ['n', 'w', 'd', 'f'].includes(s.t) ? s.t : 'n' }; if (s.pr) o.pr = true; return o; };
const cleanItem = (it, withDone) => {
  const kind = kindIds.has(it.k) ? it.k : 'wr';
  return {
    ex: str(it.ex).slice(0, 60), n: str(it.n).slice(0, 60), m: muscleIds.has(it.m) ? it.m : 'chest', k: kind, rest: restOf(it), note: str(it.note).slice(0, 200),
    sets: list(it.sets).slice(0, 60).map((s) => (withDone ? { ...cleanSet(s), done: !!s.done } : cleanSet(s))),
  };
};

export function cleanFitness(raw, now = Date.now()) {
  const base = emptyFitness();
  const f = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const uniq = (id) => { if (!id || seen.has(id)) return false; seen.add(id); return true; };

  const exercises = list(f.exercises).slice(0, 300).map((e) => ({
    id: str(e.id).slice(0, 40), name: str(e.name).trim().slice(0, 40), muscle: muscleIds.has(e.muscle) ? e.muscle : 'chest',
    equip: EQUIPMENT.includes(e.equip) ? e.equip : 'Other', kind: kindIds.has(e.kind) ? e.kind : 'wr', custom: true,
  })).filter((e) => e.name && !BUILTIN_BY_ID[e.id] && uniq(e.id));

  const routines = list(f.routines).slice(0, 100).map((r) => ({
    id: str(r.id).slice(0, 40), name: str(r.name).trim().slice(0, 40),
    items: list(r.items).slice(0, 40).map((it) => ({ ex: str(it.ex).slice(0, 60), n: str(it.n).slice(0, 60), m: muscleIds.has(it.m) ? it.m : 'chest', k: kindIds.has(it.k) ? it.k : 'wr', rest: restOf(it), sets: planOf(it).slice(0, MAX_SETS).map((x) => ({ kg: round2(clamp(x.kg, 0, 1000)), reps: round2(clamp(x.reps, 0, 9999)) })) })).filter((it) => it.ex && it.sets.length),
  })).filter((r) => r.name && uniq(r.id));

  const sessions = list(f.sessions).slice(-6000).map((s) => ({
    id: str(s.id).slice(0, 40), date: day(s.date), start: num(s.start), end: num(s.end), name: str(s.name).slice(0, 40), routineId: str(s.routineId).slice(0, 40), note: str(s.note).slice(0, 300),
    items: list(s.items).slice(0, 40).map((it) => cleanItem(it, false)).filter((it) => it.ex && it.sets.length),
  })).filter((s) => s.date && s.start > 0 && s.items.length && uniq('s' + s.id)).map((s) => ({ ...s, end: s.end >= s.start ? s.end : s.start }));

  const a = f.active && typeof f.active === 'object' ? f.active : null;
  const active = a && num(a.start) > 0 && num(a.start) <= now + 60000 ? {
    id: str(a.id).slice(0, 40) || 'active', start: num(a.start), name: str(a.name).slice(0, 40) || 'Workout', routineId: str(a.routineId).slice(0, 40),
    items: list(a.items).slice(0, 40).map((it) => cleanItem(it, true)).filter((it) => it.ex),
    restUntil: clamp(a.restUntil, 0, now + 15 * 60000), note: str(a.note).slice(0, 300),
  } : null;

  const days = {};
  Object.entries(f.steps && f.steps.days && typeof f.steps.days === 'object' ? f.steps.days : {}).forEach(([d, n]) => { if (day(d) && num(n) > 0) days[d] = Math.round(clamp(n, 0, 200000)); });
  const keys = Object.keys(days).sort();
  keys.slice(0, Math.max(0, keys.length - 1500)).forEach((k) => delete days[k]);

  // form videos and photos: only well-formed records for at most 400 exercises (a backup carries the list, not the files)
  const media = {};
  Object.entries(f.media && typeof f.media === 'object' ? f.media : {}).slice(0, 400).forEach(([exId, arr]) => {
    if (!/^[\w:.-]{1,60}$/.test(exId) || !Array.isArray(arr)) return;
    const seenId = new Set();
    const clean = arr.filter((m) => m && typeof m === 'object' && /^[a-z0-9]{6,24}$/.test(str(m.id)) && ['video', 'photo'].includes(m.k) && !seenId.has(m.id) && seenId.add(m.id))
      .slice(0, MAX_MEDIA).map((m) => ({ id: m.id, k: m.k, n: str(m.n).slice(0, 60), x: /^[a-z0-9]{2,5}$/.test(str(m.x)) ? m.x : '', size: Math.max(0, Math.round(num(m.size))), t: Math.max(0, num(m.t)) }));
    if (clean.length) media[exId] = clean;
  });

  const st = f.settings && typeof f.settings === 'object' ? f.settings : {};
  const settings = {
    goal: Math.round(clamp(st.goal === undefined ? base.settings.goal : st.goal, 500, 100000)),
    height: Math.round(clamp(st.height, 0, 260)), weight: round2(clamp(st.weight, 0, 400)),
    restSec: Math.round(clamp(st.restSec === undefined ? 90 : st.restSec, 10, 600)),
    weekGoal: Math.round(clamp(st.weekGoal === undefined ? 4 : st.weekGoal, 1, 7)),
    maxRest: Math.round(clamp(st.maxRest === undefined ? 2 : st.maxRest, 0, 6)),
    remindOn: !!st.remindOn, remindAt: /^\d{2}:\d{2}$/.test(str(st.remindAt)) ? st.remindAt : '18:00',
  };
  return { exercises, routines, sessions, active, steps: { days }, media, settings };
}
