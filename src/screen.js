import { addDays, dateStr, today } from './dates.js';

// Screen time rules (pure, no DOM)
//  - state.screen.days[YYYY-MM-DD] = { t: minutes, p: pickups, h: [24 minutes], a: { packageName: minutes } }
//  - state.screen.names[packageName] = app label
//    A day may also carry sl: [bedtime, wake-up, minutes] (minutes of the day), the night that ended on it (an estimate).
//  - state.limits = [{ id, name, pkgs[], min (0 = none), night: null | { from, to }, taper: null | { step, floor, from }, on, created, lockUntil }]
//  - state.sleepLock = null | { on, from, to, cats[], extra[], message, created, lockUntil }
//  - state.focus = { active: null | { start, until, label, cats[], extra[] }, log: [{ s, e, m, l }] }
//  The phone owns the limits, the sleep lock and the focus session (see ScreenRules.java): a limit is a promise, locked for
//  a number of days, and it can only be made stricter; a focus session can only be extended, never ended early. mergeConfig()
//  below is the same rule in JS, used to preview a change and, in a desktop browser where there is no phone, to apply it.
//  state.limits, state.sleepLock and state.focus only mirror what the phone kept.
//  Android only remembers a few days of usage, so every day seen is copied here and kept for KEEP_DAYS.

export const KEEP_DAYS = 120;

// "2h 15m", "45m", "<1m"
export function fmt(min) {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return Number(min) > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export const dayData = (S, d) => S.screen.days[d] || null;
export const hasData = (S) => Object.keys(S.screen.days).length > 0;
export const appName = (S, pkg) => S.screen.names[pkg] || pkg.split('.').pop();

export const lastDates = (n, end = today()) => Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
export const totalOn = (S, d) => (S.screen.days[d] ? S.screen.days[d].t : 0);

function withData(S, dates) {
  return dates.filter((d) => S.screen.days[d] && S.screen.days[d].t > 0);
}

export const average = (S, dates) => {
  const have = withData(S, dates);
  return have.length ? have.reduce((a, d) => a + S.screen.days[d].t, 0) / have.length : 0;
};

// apps sorted by time over the given days
export function topApps(S, dates, limit = 8) {
  const sum = {};
  dates.forEach((d) => {
    const day = S.screen.days[d];
    if (day) Object.entries(day.a).forEach(([p, m]) => { sum[p] = (sum[p] || 0) + m; });
  });
  return Object.entries(sum).map(([pkg, min]) => ({ pkg, name: appName(S, pkg), min })).sort((a, b) => b.min - a.min).slice(0, limit);
}

// average minutes in each hour of the day
export function hourly(S, dates) {
  const have = withData(S, dates);
  const out = Array(24).fill(0);
  have.forEach((d) => S.screen.days[d].h.forEach((m, i) => { out[i] += m; }));
  return have.length ? out.map((m) => Math.round((m / have.length) * 10) / 10) : out;
}

export const pickupsAvg = (S, dates) => {
  const have = withData(S, dates);
  return have.length ? Math.round(have.reduce((a, d) => a + S.screen.days[d].p, 0) / have.length) : 0;
};

// ---------- limits ----------
export const usedFor = (S, limit, d) => {
  const day = S.screen.days[d];
  return day ? limit.pkgs.reduce((a, p) => a + (day.a[p] || 0), 0) : 0;
};

// the minutes a limit allows on day d: its minutes, less the weekly taper (see effectiveMin); today uses the clock right now
export const minOn = (limit, d = today()) => effectiveMin(limit, d === today() ? Date.now() : new Date(`${d}T23:59:59`).getTime());

// today's used time comes from the phone (it also counts what Android's numbers miss); other days from the stored days
export function limitState(S, limit, d = today()) {
  const used = d === today() && typeof limit.used === 'number' ? Math.max(limit.used, usedFor(S, limit, d)) : usedFor(S, limit, d);
  const min = minOn(limit, d);
  const pct = min > 0 ? Math.min(100, Math.round((used / min) * 100)) : 0;
  return { used, min, pct, over: min > 0 && used >= min, left: Math.max(0, min - used) };
}

export const limitFor = (S, pkg) => S.limits.find((l) => l.pkgs.includes(pkg));

export const limitName = (S, l) => l.name || (l.pkgs.length === 1 ? appName(S, l.pkgs[0]) : `${l.pkgs.length} apps`);

// ---------- the promise (the same rules as ScreenRules.java) ----------
export const DAY = 86400000;
export const GRACE = 10 * 60000;
export const LOCK_CHOICES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
export const MEDIA = [['social', 'Social'], ['video', 'Video and streaming'], ['game', 'Games'], ['music', 'Music and podcasts']];
export const DEFAULT_MESSAGE = 'Soo ja bhen ke land.';
const PKG = /^[A-Za-z0-9_.]{1,160}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const minutesOf = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); if (!m) return -1; const h = Number(m[1]), mi = Number(m[2]); return h > 23 || mi > 59 ? -1 : h * 60 + mi; };
export const inWindow = (now, from, to) => { if (from < 0 || to < 0 || from === to) return false; return from < to ? now >= from && now < to : now >= from || now < to; };
// does the window nf..nt hold every minute of of..ot?
export const covers = (nf, nt, of, ot) => { for (let m = 0; m < 1440; m++) if (inWindow(m, of, ot) && !inWindow(m, nf, nt)) return false; return true; };
export const coversTimes = (n, o) => covers(minutesOf(n.from), minutesOf(n.to), minutesOf(o.from), minutesOf(o.to));
export const clampDays = (d) => { const n = Math.floor(Number(d) || 0); return n <= 0 ? 30 : Math.max(7, Math.min(365, n)); };
// locked = the promise is still running and the first 10 minutes (to fix a mistake) are over
export const isLocked = (it, now = Date.now()) => !!it && (it.lockUntil || 0) > now && now - (it.created || 0) > GRACE;
export const daysLeft = (it, now = Date.now()) => Math.max(0, Math.ceil(((it.lockUntil || 0) - now) / DAY));
export const focusRunning = (f, now = Date.now()) => !!f && (f.until || 0) > now;
export const anyLocked = (S, now = Date.now()) => S.limits.some((l) => isLocked(l, now)) || isLocked(S.sleepLock, now) || focusRunning(S.focus && S.focus.active, now);

const cleanNight = (n) => (n && minutesOf(n.from) >= 0 && minutesOf(n.to) >= 0 && n.from !== n.to ? { from: n.from, to: n.to } : null);
const uniq = (a, ok) => [...new Set((Array.isArray(a) ? a : []).map(String).filter(ok))];

// ---------- the weekly taper of a limit ----------
export const WEEK = 7 * DAY;

// step = minutes less each week (1 to 120), floor = where it stops (5 up to just under the limit)
function cleanTaper(t, min) {
  if (!t || typeof t !== 'object' || min <= 5) return null;
  const step = Math.floor(Number(t.step) || 0), floor = Math.floor(Number(t.floor) || 0);
  if (step < 1 || step > 120 || floor < 5 || floor >= min) return null;
  return { step, floor };
}
const taperAt = (t, from) => (t ? { step: t.step, floor: t.floor, from } : null);

// the daily minutes that count at `now`: the limit's minutes, less the taper's step for every full week since it began, never below the floor
export function effectiveMin(limit, now = Date.now()) {
  const min = limit.min || 0, t = limit.taper;
  if (min <= 0 || !t) return min;
  const step = t.step || 0, floor = t.floor || 0, from = t.from || 0;
  if (step <= 0 || floor <= 0 || from <= 0) return min;
  const weeks = Math.max(0, Math.floor((now - from) / WEEK));
  return Math.min(min, Math.max(floor, min - weeks * step));
}

// when the limit reaches its floor (a date), or null when there is no taper or it is already there
export function taperEnd(limit, now = Date.now()) {
  const t = limit.taper;
  if (!t || !(limit.min > 0) || !(t.from > 0)) return null;
  const weeks = Math.ceil((limit.min - t.floor) / t.step);
  const at = t.from + weeks * WEEK;
  return at > now ? at : null;
}

function cleanLimit(x) {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '');
  if (!ID.test(id)) return null;
  const pkgs = uniq(x.pkgs, (p) => PKG.test(p));
  const min = Math.max(0, Math.min(1440, Math.round(Number(x.min) || 0)));
  const night = cleanNight(x.night);
  if (!pkgs.length || (!min && !night)) return null;
  return { id, name: String(x.name || '').trim().slice(0, 40), pkgs, min, night, taper: cleanTaper(x.taper, min), on: x.on !== false, lockDays: Math.max(0, Math.floor(Number(x.lockDays) || 0)) };
}

// ---------- focus sessions ----------
export const FOCUS_MIN = 10;
export const FOCUS_MAX = 240;
export const FOCUS_OOPS = 60000; // a wrong tap can be undone for one minute, nothing else ends a session early

function cleanFocus(x) {
  if (!x || typeof x !== 'object') return null;
  const minutes = Math.floor(Number(x.minutes) || 0);
  if (minutes <= 0) return null;
  const cats = uniq(x.cats, (c) => MEDIA.some(([k]) => k === c));
  const extra = uniq(x.extra, (p) => PKG.test(p));
  if (!cats.length && !extra.length) return null;
  return { minutes: Math.max(FOCUS_MIN, Math.min(FOCUS_MAX, minutes)), label: String(x.label || '').trim().slice(0, 40), cats, extra };
}

function mergeFocus(old, inc, now) {
  const ms = inc.minutes * 60000;
  if (!old) return { start: now, until: now + ms, label: inc.label, cats: inc.cats, extra: inc.extra };
  return {
    start: old.start || now,
    until: Math.min(Math.max(old.until || 0, now + ms), now + FOCUS_MAX * 60000),
    label: inc.label || old.label || '',
    cats: union(old.cats || [], inc.cats),
    extra: union(old.extra || [], inc.extra),
  };
}

// a session that has run out: moves it from `active` to the log (the phone does the same natively); returns it, or null
export function settleFocus(S, now = Date.now()) {
  const f = S.focus && S.focus.active;
  if (!f || f.until > now) return null;
  const e = { s: f.start, e: f.until, m: Math.round((f.until - f.start) / 60000), l: f.label || '' };
  S.focus.log = [...S.focus.log, e].slice(-300);
  S.focus.active = null;
  return e;
}

function cleanSleep(x) {
  if (!x || typeof x !== 'object') return null;
  const from = x.from === undefined ? '23:00' : String(x.from), to = x.to === undefined ? '06:00' : String(x.to);
  if (minutesOf(from) < 0 || minutesOf(to) < 0 || from === to) return null;
  const cats = uniq(x.cats, (c) => MEDIA.some(([k]) => k === c));
  const extra = uniq(x.extra, (p) => PKG.test(p));
  if (!cats.length && !extra.length) return null;
  const message = String(x.message || '').trim().slice(0, 120);
  return { on: x.on !== false, from, to, cats, extra, message: message || DEFAULT_MESSAGE, lockDays: Math.max(0, Math.floor(Number(x.lockDays) || 0)) };
}

const union = (a, b) => [...new Set([...a, ...b])];
const lockUntilOf = (old, inc, now) => Math.max(inc.lockDays > 0 ? now + clampDays(inc.lockDays) * DAY : 0, old ? old.lockUntil || 0 : 0);

function mergeLimit(old, inc, now, refused) {
  if (!old) return { id: inc.id, name: inc.name, pkgs: inc.pkgs, min: inc.min, night: inc.night, taper: taperAt(inc.taper, now), on: true, created: now, lockUntil: now + clampDays(inc.lockDays) * DAY };
  const out = { id: inc.id, created: old.created || now };
  if (!isLocked(old, now)) {
    // not locked (a minute-old mistake, or the promise has run out): anything goes
    const relock = inc.lockDays > 0;
    const same = inc.taper && old.taper && inc.taper.step === old.taper.step && inc.taper.floor === old.taper.floor;
    return { ...out, name: inc.name, pkgs: inc.pkgs, min: inc.min, night: inc.night, taper: taperAt(inc.taper, same ? old.taper.from || now : now), on: relock || inc.on, lockUntil: relock ? now + clampDays(inc.lockDays) * DAY : old.lockUntil || 0 };
  }
  // locked: only stricter changes get through
  let min = old.min;
  if (old.min === 0) min = inc.min; else if (inc.min > 0 && inc.min < old.min) min = inc.min;
  if (inc.min !== min) refused.n++;
  if (!old.pkgs.every((p) => inc.pkgs.includes(p))) refused.n++;
  let night = old.night;
  if (!old.night) night = inc.night; else if (inc.night && coversTimes(inc.night, old.night)) night = inc.night;
  if (old.night && night !== inc.night) refused.n++;
  if (old.on && !inc.on) refused.n++;
  // a weekly taper can be added or made stricter (bigger step, lower floor), never removed or relaxed
  let taper = taperAt(old.taper, old.taper ? old.taper.from || now : now);
  if (!old.taper) { if (inc.taper) taper = taperAt(inc.taper, now); }
  else if (!inc.taper) refused.n++;
  else if (inc.taper.step >= old.taper.step && inc.taper.floor <= old.taper.floor) taper = taperAt(inc.taper, old.taper.from || now);
  else refused.n++;
  return { ...out, name: inc.name, pkgs: union(old.pkgs, inc.pkgs), min, night, taper, on: old.on || inc.on, lockUntil: lockUntilOf(old, inc, now) };
}

function mergeSleep(old, inc, now, refused) {
  if (!old) return { on: true, from: inc.from, to: inc.to, cats: inc.cats, extra: inc.extra, message: inc.message, created: now, lockUntil: now + clampDays(inc.lockDays) * DAY };
  const out = { created: old.created || now };
  if (!isLocked(old, now)) {
    const relock = inc.lockDays > 0;
    return { ...out, on: relock || inc.on, from: inc.from, to: inc.to, cats: inc.cats, extra: inc.extra, message: inc.message, lockUntil: relock ? now + clampDays(inc.lockDays) * DAY : old.lockUntil || 0 };
  }
  const wider = covers(minutesOf(inc.from), minutesOf(inc.to), minutesOf(old.from), minutesOf(old.to));
  if (!wider) refused.n++;
  if (!old.cats.every((c) => inc.cats.includes(c))) refused.n++;
  if (!old.extra.every((p) => inc.extra.includes(p))) refused.n++;
  if (old.on && !inc.on) refused.n++;
  return { ...out, on: old.on || inc.on, from: wider ? inc.from : old.from, to: wider ? inc.to : old.to, cats: union(old.cats, inc.cats), extra: union(old.extra, inc.extra), message: inc.message, lockUntil: lockUntilOf(old, inc, now) };
}

// committed: { limits, sleep, focus } as the phone holds it; incoming: the change asked for. Returns { limits, sleep, focus, motto, refused }.
export function mergeConfig(committed, incoming, now = Date.now()) {
  const cur = committed || {}, req = incoming || {};
  const refused = { n: 0 };
  const oldLimits = Array.isArray(cur.limits) ? cur.limits : [];
  let result = [];
  const seen = new Set();
  if (!Array.isArray(req.limits)) {
    result = oldLimits.slice();
    oldLimits.forEach((o) => seen.add(o.id));
  } else {
    req.limits.forEach((raw) => {
      const inc = cleanLimit(raw);
      if (!inc || seen.has(inc.id)) return;
      seen.add(inc.id);
      result.push(mergeLimit(oldLimits.find((o) => o.id === inc.id) || null, inc, now, refused));
    });
  }
  // limits the request left out stay while they are locked
  oldLimits.forEach((o) => { if (!seen.has(o.id) && isLocked(o, now)) { result.push(o); refused.n++; } });

  const oldSleep = cur.sleep || null;
  let sleep;
  if (!('sleep' in req)) sleep = oldSleep;
  else {
    const inc = cleanSleep(req.sleep);
    if (!inc) {
      if (oldSleep && isLocked(oldSleep, now)) { sleep = oldSleep; refused.n++; } else sleep = null;
    } else sleep = mergeSleep(oldSleep, inc, now, refused);
  }

  // a focus session: it can be started, extended and given more groups, but never ended early
  // (one 60 second window is left to undo a wrong tap)
  const oldFocus = focusRunning(cur.focus, now) ? cur.focus : null;
  let focus = oldFocus;
  if (req.focus !== undefined) {
    if (req.focus === null) {
      if (oldFocus) { if (now - (oldFocus.start || 0) <= FOCUS_OOPS) focus = null; else refused.n++; }
    } else {
      const inc = cleanFocus(req.focus);
      if (inc) focus = mergeFocus(oldFocus, inc, now);
    }
  }
  return { limits: result, sleep, focus, motto: String(req.motto !== undefined ? req.motto : cur.motto || '').trim().slice(0, 140), refused: refused.n };
}

// ---------- storing what Android reports ----------
// [bedtime, wake-up, minutes slept] as minutes of the day; null when it is not a believable night (3 to 16 hours)
export function cleanSl(x) {
  if (!Array.isArray(x) || x.length < 3) return null;
  const [bed, wake, m] = x.map((v) => Math.round(Number(v)));
  if (![bed, wake, m].every(Number.isFinite) || bed < 0 || bed > 1439 || wake < 0 || wake > 1439 || m < 180 || m > 960) return null;
  return [bed, wake, m];
}

// native: [{ start, total, pickups, hours[24], apps{pkg: minutes}, sleep: [bed, wake, minutes] }], names: {pkg: label}
export function merge(S, native, names) {
  const t = today();
  Object.entries(names || {}).forEach(([p, n]) => { if (n) S.screen.names[p] = String(n); });
  (native || []).forEach((nd) => {
    const d = dateStr(new Date(nd.start));
    // a past day that Android no longer remembers comes back empty: keep what we already have
    if (!(nd.total > 0) && d !== t) return;
    const r1 = (v) => Math.round(Number(v) * 10) / 10;
    const apps = {};
    Object.entries(nd.apps || {}).forEach(([p, m]) => { if (m >= 0.5) apps[p] = r1(m); });
    const day = { t: r1(nd.total), p: Number(nd.pickups) || 0, h: Array.from({ length: 24 }, (_, i) => r1((nd.hours || [])[i] || 0)), a: apps };
    const sl = cleanSl(nd.sleep);
    // a night worked out earlier stays when a later read has no estimate (Android forgets old events)
    if (sl) day.sl = sl; else if (S.screen.days[d] && S.screen.days[d].sl) day.sl = S.screen.days[d].sl;
    S.screen.days[d] = day;
  });
  const cutoff = addDays(t, -KEEP_DAYS);
  Object.keys(S.screen.days).forEach((d) => { if (d < cutoff) delete S.screen.days[d]; });
}

// ---------- focus log ----------
const focusDate = (e) => dateStr(new Date(e.s));

// minutes of finished focus sessions on each of the given dates
export const focusByDay = (S, dates) => dates.map((d) => S.focus.log.reduce((a, e) => a + (focusDate(e) === d ? e.m : 0), 0));

// today and the last 7 days (today included): minutes and number of sessions
export function focusStats(S, now = Date.now()) {
  const t = today(), week = lastDates(7, t);
  const mins = focusByDay(S, week);
  const running = S.focus.active && focusRunning(S.focus.active, now) ? S.focus.active : null;
  const sessions = S.focus.log.filter((e) => week.includes(focusDate(e))).length;
  return { today: mins[mins.length - 1], week: mins.reduce((a, b) => a + b, 0), sessions, running };
}

// ---------- streaks ----------
// full days in a row, up to yesterday, with the limit kept (used within what it allowed that day).
// A day with no usage data stops the count: nobody can say how it went. Days before the limit existed do not count.
export function limitStreak(S, limit, upTo = today()) {
  if (!limit || !(limit.min > 0) || limit.on === false) return 0;
  const first = limit.created ? dateStr(new Date(limit.created)) : '';
  let n = 0;
  for (let d = addDays(upTo, -1); d >= first; d = addDays(d, -1)) {
    const day = S.screen.days[d];
    if (!day || !(day.t > 0) || usedFor(S, limit, d) > minOn(limit, d)) break;
    n++;
    if (n >= 3650) break;
  }
  return n;
}

export const STREAK_MARKS = [100, 60, 30, 14, 7];
// the biggest milestone a streak has reached (0 when none yet)
export const streakMilestone = (n) => STREAK_MARKS.find((m) => n >= m) || 0;

// ---------- sleep (an estimate from the longest quiet stretch of the night) ----------
// "11:30 PM" from minutes of the day
export function fmtClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// bedtimes after noon count as the evening before and the small hours as the same night, so 23:30 and 00:30 are an hour apart
const nightOf = (bed) => (bed < 720 ? bed + 1440 : bed);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// nights: { date, bed, wake, min }[] in date order; avg* are null without nights; steady = bedtime spread in minutes
export function sleepStats(S, dates) {
  const nights = dates.filter((d) => S.screen.days[d] && S.screen.days[d].sl).map((d) => {
    const [bed, wake, min] = S.screen.days[d].sl;
    return { date: d, bed, wake, min };
  });
  if (!nights.length) return { nights, avgMin: 0, avgBed: null, avgWake: null, spread: 0 };
  const beds = nights.map((n) => nightOf(n.bed)), wakes = nights.map((n) => n.wake);
  const mb = mean(beds);
  const spread = Math.round(Math.sqrt(mean(beds.map((b) => (b - mb) ** 2))));
  return { nights, avgMin: Math.round(mean(nights.map((n) => n.min))), avgBed: Math.round(mb) % 1440, avgWake: Math.round(mean(wakes)), spread };
}

// ---------- insights ----------
// kind: optional (date) => attendance kind, to compare office days with days off
export function insights(S, kind) {
  const t = today();
  const out = [];
  const push = (tone, title, text) => out.push({ tone, title, text });
  const week = lastDates(7, t);
  const prev = lastDates(7, addDays(t, -7));
  const before = lastDates(7, addDays(t, -1));
  const haveWeek = withData(S, week);

  const avgBefore = average(S, before);
  const today_ = totalOn(S, t);
  if (withData(S, before).length >= 3 && today_ > 0) {
    if (today_ > avgBefore * 1.15) push('warn', 'Above your usual', `${fmt(today_)} so far today, and your daily average is ${fmt(avgBefore)}.`);
    else if (new Date().getHours() >= 18 && today_ < avgBefore * 0.7) push('good', 'A lighter day', `${fmt(today_)} so far, well under your usual ${fmt(avgBefore)}.`);
  }

  if (withData(S, week).length >= 4 && withData(S, prev).length >= 4) {
    const a = average(S, week), b = average(S, prev);
    const pct = b ? Math.round(((a - b) / b) * 100) : 0;
    if (Math.abs(pct) >= 8) push(pct > 0 ? 'warn' : 'good', pct > 0 ? `Up ${pct}% on last week` : `Down ${-pct}% on last week`, `${fmt(a)} a day this week against ${fmt(b)} the week before.`);
    else push('info', 'About the same as last week', `${fmt(a)} a day this week, ${fmt(b)} last week.`);
  }

  if (haveWeek.length >= 3) {
    const apps = topApps(S, week, 1), total = haveWeek.reduce((s, d) => s + S.screen.days[d].t, 0);
    if (apps.length && total > 0) {
      const share = Math.round((apps[0].min / total) * 100);
      if (share >= 25) push('info', `${apps[0].name} takes ${share}%`, `It is ${fmt(apps[0].min / haveWeek.length)} a day, more than any other app this week.`);
    }
    const hrs = hourly(S, week);
    const peak = hrs.indexOf(Math.max(...hrs));
    if (hrs[peak] > 0) push('info', 'Your busiest hour', `Most of your phone time lands between ${hourLabel(peak)} and ${hourLabel((peak + 1) % 24)}.`);
    const late = haveWeek.reduce((s, d) => s + S.screen.days[d].h.slice(0, 5).reduce((a, b) => a + b, 0), 0) / haveWeek.length;
    if (late >= 20) push('warn', 'Awake past midnight', `About ${fmt(late)} a night between 12 and 5 AM. Sleep is the first thing to suffer.`);
    const pk = pickupsAvg(S, week);
    if (pk) push(pk >= 100 ? 'warn' : 'info', `${pk} pickups a day`, pk >= 100 ? 'You reach for your phone more than 100 times a day. Most of those are habit, not need.' : 'How often you unlock your phone on an average day.');
  }

  // office days against days off
  if (kind) {
    const dates = lastDates(30, t).filter((d) => d < t && S.screen.days[d] && S.screen.days[d].t > 0);
    const work = dates.filter((d) => ['P', 'H'].includes(kind(d)));
    const off = dates.filter((d) => ['O', 'L', 'W'].includes(kind(d)));
    if (work.length >= 3 && off.length >= 3) {
      const w = average(S, work), o = average(S, off), diff = Math.round(o - w);
      if (Math.abs(diff) >= 20) push('info', diff > 0 ? 'Days off cost more' : 'Workdays cost more', `${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} on days off (${fmt(o)}) than on work days (${fmt(w)}).`);
    }
  }

  // the heaviest day of the week
  const by = Array.from({ length: 7 }, () => []);
  lastDates(28, t).forEach((d) => { if (d < t && S.screen.days[d] && S.screen.days[d].t > 0) by[new Date(`${d}T00:00`).getDay()].push(S.screen.days[d].t); });
  const avgs = by.map((a) => (a.length >= 2 ? a.reduce((x, y) => x + y, 0) / a.length : 0));
  const all = withData(S, lastDates(28, t)).length ? average(S, lastDates(28, t)) : 0;
  const top = avgs.indexOf(Math.max(...avgs));
  if (all && avgs[top] >= all * 1.25) push('info', `${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][top]} are heaviest`, `${fmt(avgs[top])} on an average one, against ${fmt(all)} across all days.`);

  // how the limits are doing
  S.limits.filter((l) => l.on && l.min > 0).forEach((l) => {
    const days = lastDates(7, addDays(t, -1)).filter((d) => S.screen.days[d] && S.screen.days[d].t > 0);
    if (days.length < 3) return;
    const ok = days.filter((d) => usedFor(S, l, d) <= minOn(l, d)).length;
    push(ok === days.length ? 'good' : ok >= days.length / 2 ? 'info' : 'warn', `${limitName(S, l)}: ${ok} of ${days.length} days within the limit`, ok === days.length ? 'You kept to it every day. That is the habit forming.' : `Over ${fmt(minOn(l))} on ${days.length - ok} day${days.length - ok === 1 ? '' : 's'}. A smaller limit or a night window can help.`);
  });

  // sleep: short nights, and what a late night does to the next day
  const sl = sleepStats(S, lastDates(14, t));
  if (sl.nights.length >= 4) {
    if (sl.avgMin < 360) push('warn', `About ${fmt(sl.avgMin)} of sleep`, 'That is a short night on average (an estimate from when your screen stayed off). Most adults need 7 to 9 hours.');
    const late = sl.nights.filter((n) => nightOf(n.bed) >= 1470), early = sl.nights.filter((n) => nightOf(n.bed) < 1470);
    const next = (list) => list.filter((n) => totalOn(S, n.date) > 0).map((n) => totalOn(S, n.date));
    const lt = next(late), et = next(early);
    if (lt.length >= 2 && et.length >= 2) {
      const diff = Math.round(mean(lt) - mean(et));
      if (diff >= 20) push('warn', 'Late nights cost you', `${fmt(diff)} more screen time the day after a night past 12:30 AM (${fmt(mean(lt))} against ${fmt(mean(et))}).`);
    }
  }

  return out.slice(0, 8);
}
