// Calendar events (birthdays, festivals, exams, normal events) that live on the Attendance calendar.
// Pure rules only: no DOM, no database. State: S.events = [{ id, title, date, time, kind, yearly, remind, note }].
import { addDays, daysBetween } from './dates.js';

export const KINDS = [
  ['birthday', 'Birthday', '#f472b6'],
  ['festival', 'Festival', '#fbbf24'],
  ['exam', 'Exam', '#38bdf8'],
  ['event', 'Event', '#a78bfa'],
];
export const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
export const KIND_COLOR = Object.fromEntries(KINDS.map(([k, , c]) => [k, c]));
export const MAX_EVENTS = 500;

// Reminder clock times. The morning of the event is always 05:00; the event's own time is the one the user set.
// Birthdays and festivals have PRESET reminders (no setting, so there is nothing to fiddle with): a birthday gets the full
// set, a festival only "tomorrow" and the morning (quietly, there can be many of them). Only exams and events let the user
// switch reminders on or off.
export const REMIND = { early: '09:00', day: '05:00', daysBefore: [3, 1] };
// A weekly event needs no "3 days before" (it comes back all the time), a monthly one only "tomorrow".
export const daysBeforeFor = (ev) => (ev.repeat === 'week' ? [] : ev.repeat === 'month' ? [1] : ev.kind === 'festival' ? [1] : REMIND.daysBefore);

// how an event comes back: never, every week, every month or every year (same weekday / same date of the month / same date of the year)
export const REPEATS = [['none', 'Never'], ['week', 'Every week'], ['month', 'Every month'], ['year', 'Every year']];
export const REPEAT_LABEL = { week: 'every week', month: 'every month', year: 'every year' };
const REPEAT_KEYS = REPEATS.map(([k]) => k);
export const remindIsPreset = (kind) => kind === 'birthday' || kind === 'festival';
export const hasOwnTime = (kind) => kind === 'exam' || kind === 'event';
export const presetText = (kind) => (kind === 'festival'
  ? 'Reminders are automatic: 1 day before (9:00 AM) and 5:00 AM on the day, quietly.'
  : 'Reminders are automatic: 3 days before and 1 day before (9:00 AM) and 5:00 AM on the day.');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const str = (v) => (v === undefined || v === null ? '' : String(v));

// A birthday is always on the same day every year. Festivals, exams and events move around, so they happen once unless the
// user says the date repeats (every week, month or year). Birthdays can never be switched to one-time.
export const defaultRepeat = (kind) => (kind === 'birthday' ? 'year' : 'none');
export const repeatOf = (e, kind) => (kind === 'birthday' ? 'year' : REPEAT_KEYS.includes(e.repeat) ? e.repeat : e.yearly ? 'year' : 'none'); // old saves only have "yearly"

// Drops malformed records and forces every field to a safe value (used for old data and for imported backups).
export function cleanEvents(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((e) => {
    if (!e || typeof e !== 'object') return null;
    const date = DATE.test(str(e.date)) && !Number.isNaN(Date.parse(`${e.date}T00:00`)) ? str(e.date) : '';
    const title = str(e.title).trim().slice(0, 80);
    if (!date || !title) return null;
    const kind = KIND_LABEL[e.kind] ? e.kind : 'event';
    const repeat = repeatOf(e, kind);
    return {
      id: str(e.id).slice(0, 40) || `ev${Math.random().toString(36).slice(2, 9)}`,
      title, date, kind,
      time: hasOwnTime(kind) && TIME.test(str(e.time)) ? str(e.time) : '',
      repeat, yearly: repeat === 'year',
      remind: remindIsPreset(kind) ? true : e.remind !== false,
      note: str(e.note).trim().slice(0, 200),
    };
  }).filter((e) => e && !seen.has(e.id) && seen.add(e.id)).slice(0, MAX_EVENTS);
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// the date this event falls on in a given year (a 29 February birthday is kept on 28 February in other years)
function inYear(ev, year) {
  const [, m, d] = ev.date.split('-');
  const day = m === '02' && d === '29' && !isLeap(year) ? '28' : d;
  return `${year}-${m}-${day}`;
}

// the day of the month an event on the 29th to 31st falls on in a shorter month (the last day of that month)
const lastOf = (y, m) => new Date(y, m, 0).getDate();
function inMonth(ev, y, m) {
  const d = Math.min(Number(ev.date.slice(8)), lastOf(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function occursOn(ev, date) {
  if (ev.date === date) return true;
  if (!ev.repeat || ev.repeat === 'none' || date < ev.date) return false;
  if (ev.repeat === 'week') return daysBetween(ev.date, date) % 7 === 0;
  if (ev.repeat === 'month') return inMonth(ev, Number(date.slice(0, 4)), Number(date.slice(5, 7))) === date;
  return inYear(ev, Number(date.slice(0, 4))) === date;
}

// the first date on or after `from` that this event happens, or '' when it is over
export function nextDate(ev, from) {
  if (ev.date >= from) return ev.date;
  if (!ev.repeat || ev.repeat === 'none') return '';
  if (ev.repeat === 'week') return addDays(ev.date, Math.ceil(daysBetween(ev.date, from) / 7) * 7);
  const y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  if (ev.repeat === 'month') {
    const a = inMonth(ev, y, m);
    return a >= from ? a : inMonth(ev, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
  }
  const a = inYear(ev, y);
  return a >= from ? a : inYear(ev, y + 1);
}

export const eventsOn = (S, date) => (S.events || []).filter((e) => occursOn(e, date)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));

// { 'YYYY-MM-DD': [events] } for one month ('YYYY-MM')
export function monthMap(S, ym) {
  const out = {};
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    const list = eventsOn(S, ds);
    if (list.length) out[ds] = list;
  }
  return out;
}

// what is coming in the next `days` days, soonest first: [{ ev, date, left }]
export function upcoming(S, from, days = 60, limit = 8) {
  const out = [];
  (S.events || []).forEach((ev) => {
    const date = nextDate(ev, from);
    if (!date) return;
    const left = daysBetween(from, date);
    if (left >= 0 && left <= days) out.push({ ev, date, left });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.ev.time || '99').localeCompare(b.ev.time || '99')).slice(0, limit);
}

export const leftLabel = (left) => (left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : `In ${left} days`);
// an exam counts down: "5 days left"
export const examLeft = (left) => (left === 0 ? 'Today' : `${left} day${left === 1 ? '' : 's'} left`);
export const leftFor = (ev, left) => (ev.kind === 'exam' ? examLeft(left) : leftLabel(left));

// every event of one month as [{ ev, date }], by date (past ones included)
export function monthList(S, ym) {
  const out = [];
  Object.entries(monthMap(S, ym)).forEach(([date, list]) => list.forEach((ev) => out.push({ ev, date })));
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.ev.time || '99').localeCompare(b.ev.time || '99'));
}

// The lines for the dashboard: the next exam (counting down, within 60 days) and the next other event (within 14 days).
export function dashLines(S, from) {
  const list = upcoming(S, from, 60, 100);
  const exam = list.find((u) => u.ev.kind === 'exam');
  const other = list.find((u) => u.ev.kind !== 'exam' && u.left <= 14);
  return [exam, other].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Indian festivals from a public calendar file (iCalendar text) ----------
// Source: Google's public "Holidays in India" calendar. It marks each day as "Public holiday" or "Observance".
export const FESTIVAL_URL = 'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

export function parseIcs(text) {
  // unfold continued lines (a line starting with a space or tab continues the one before), then walk the events
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  // iCalendar escapes: backslash-n is a line break, backslash before a comma, semicolon or backslash is just that character
  const unesc = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = { date: '', title: '', observance: false };
    else if (line === 'END:VEVENT') { if (cur && cur.date && cur.title) out.push(cur); cur = null; }
    else if (cur) {
      if (line.startsWith('DTSTART')) { const m = line.match(/:(\d{4})(\d{2})(\d{2})\s*$/); if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`; }
      else if (line.startsWith('SUMMARY:')) cur.title = unesc(line.slice(8)).slice(0, 80);
      else if (line.startsWith('DESCRIPTION:')) cur.observance = /^Observance/i.test(line.slice(12));
    }
  }
  return out;
}

// festivals between `from` and `to` that are not already in the calendar, by date: [{ date, title, observance }]
export function festivalCandidates(parsed, S, from, to) {
  const key = (t, d) => `${t.trim().toLowerCase()}|${d}`;
  const have = new Set((S.events || []).map((e) => key(e.title, e.date)));
  const seen = new Set();
  return parsed.filter((p) => p.date >= from && p.date <= to && !have.has(key(p.title, p.date)) && !seen.has(key(p.title, p.date)) && seen.add(key(p.title, p.date)))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.observance) - Number(b.observance));
}

// The notifications for one event, as { key, date, hm, title, body }. Only moments still ahead of `now` are returned.
// Plan: 3 days before and 1 day before (09:00), 05:00 on the day, and at the event's own time when one is set.
// Yearly events plan this year's or the next year's date, whichever comes first, plus the one after it.
export function reminderPlan(ev, todayStr, now) {
  if (!ev.remind) return [];
  const label = KIND_LABEL[ev.kind] || 'Event';
  // plan the next occurrences: 1 for a one-off, 2 for a yearly one, 3 for a monthly one, 4 for a weekly one (every app start plans again)
  const dates = [];
  let at = nextDate(ev, todayStr); // today's occurrence still counts (its 05:00 or its own time may be ahead)
  const count = { none: 1, year: 2, month: 3, week: 4 }[ev.repeat || 'none'];
  while (at && dates.length < count) {
    dates.push(at);
    at = nextDate(ev, addDays(at, 1));
  }
  const out = [];
  dates.forEach((date) => {
    const when = (hm, offset = 0) => new Date(`${addDays(date, -offset)}T${hm}`);
    const add = (key, at, title, body) => { if (at > now) out.push({ key: `${ev.id}|${date}|${key}`, at, title, body }); };
    daysBeforeFor(ev).forEach((n) => add(`b${n}`, when(REMIND.early, n), `${label} in ${n} day${n === 1 ? '' : 's'}`, `${ev.title}${ev.time ? ` at ${hmLabel(ev.time)}` : ''}${n === 1 ? ', tomorrow.' : `, in ${n} days.`}`));
    add('d', when(REMIND.day), `${label} today`, `${ev.title}${ev.time ? ` at ${hmLabel(ev.time)}` : ''}.`);
    if (ev.time) add('t', when(ev.time), `${label} now`, `${ev.title} is starting.`);
    // the morning one is pointless when the event itself is earlier than 05:00
    if (ev.time && ev.time <= REMIND.day) { const i = out.findIndex((o) => o.key === `${ev.id}|${date}|d`); if (i >= 0) out.splice(i, 1); }
  });
  return out.map((o) => ({ ...o, date: o.key.split('|')[1], quiet: ev.kind === 'festival' }));
}

function hmLabel(hm) {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
