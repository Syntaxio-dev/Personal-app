import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import * as db from './db.js';
import { addDays, today } from './dates.js';
import { billActive, dueDate, lentLeft, salaryAdded, salaryDate, shiftMonth } from './money.js';

const CHANNEL = 'prysm';

// On the phone the nightly planner is a native popup (see PlanScheduler.java); main.js turns this on and
// hands over a hook that sends the plan time and tomorrow's tasks to the native side on every sync.
let nativePlan = false;
let syncHook = null;
export const setNativePlan = (on) => { nativePlan = on; };
export const setSyncHook = (fn) => { syncHook = fn; };

// Overdue tasks (2+ days old) nag at these times, every day, until they are done.
export const NAG_SLOTS = ['09:00', '13:00', '17:00', '21:00'];
const NAG_TEXT = [
  (t) => `Still pending: "${t}". Get it done today.`,
  (t) => `"${t}" is overdue. Even 10 minutes counts, start now.`,
  (t) => `"${t}" has been waiting for days. Finish it.`,
  (t) => `Last call today: "${t}". Don't carry it into tomorrow.`,
];

const hash = (s) => (Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 2000000000) + 100;
const at = (date, hm) => new Date(`${date}T${hm}`);

// the next time (>= now) that falls on the same clock time as `start`, moving in whole days
function nextOccurrence(start, now) {
  if (start > now) return start;
  const days = Math.ceil((now - start) / 864e5);
  return new Date(start.getTime() + days * 864e5);
}

// planner reminder = sleep time minus the chosen lead
export function planTime(st) {
  const [h, m] = (st.sleep || '23:00').split(':').map(Number);
  const mins = (((h * 60 + m - (Number(st.planLead) || 30)) % 1440) + 1440) % 1440;
  return { hour: Math.floor(mins / 60), minute: mins % 60 };
}

export async function initNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.createChannel({ id: CHANNEL, name: 'Prysm reminders', description: 'Task reminders, night planning and overdue alerts', importance: 5, visibility: 1, vibration: true });
  } catch (e) { /* channel is best-effort */ }
}

export async function exactAlarmsAllowed() {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted';
  } catch (e) { return true; }
}

export async function openExactAlarmSettings() {
  try { await LocalNotifications.changeExactNotificationSetting(); } catch (e) { /* older Android: nothing to open */ }
}

// Rebuilds every scheduled notification from the saved data, so the schedule always matches the app.
export async function syncNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  if (syncHook) { try { await syncHook(); } catch (e) { /* native side unavailable */ } }
  try {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });

    const S = db.get();
    const st = S.settings;
    const now = new Date();
    const list = [];

    if (st.planOn && !nativePlan) {
      const { hour, minute } = planTime(st);
      list.push({
        id: 1, channelId: CHANNEL, title: 'Plan tomorrow',
        body: `${st.name ? st.name + ', what' : 'What'}'s on for tomorrow? Plan it now and wake up ready.`,
        schedule: { on: { hour, minute }, allowWhileIdle: true }, extra: { type: 'plan' },
      });
    }

    S.todos.filter((x) => !x.done).forEach((x) => {
      if (st.remindOn && x.time) {
        const when = at(x.date, x.time);
        if (when > now) list.push({ id: hash(x.id), channelId: CHANNEL, title: 'Task reminder', body: x.title, schedule: { at: when, allowWhileIdle: true }, extra: { type: 'task', id: x.id } });
      }
      if (st.nagOn) {
        NAG_SLOTS.forEach((slot, i) => {
          const first = nextOccurrence(at(addDays(x.date, 2), slot), now);
          list.push({ id: hash(x.id + 'n' + i), channelId: CHANNEL, title: 'Overdue task', body: NAG_TEXT[i](x.title), schedule: { at: first, repeats: true, every: 'day', allowWhileIdle: true }, extra: { type: 'nag', id: x.id } });
        });
      }
    });

    const todayStr = today();
    const m0 = todayStr.slice(0, 7);
    const m1 = shiftMonth(m0, 1);
    const rupees = (n) => '\u20B9' + Math.round(n).toLocaleString('en-IN');

    // salary: from the day after salary day, remind every morning until it is logged
    if (st.salaryOn && st.salaryDay) {
      const ref = salaryAdded(S, m0) ? m1 : m0;
      const first = nextOccurrence(at(addDays(salaryDate(S, ref), 1), '10:00'), now);
      list.push({ id: 2, channelId: CHANNEL, title: 'Salary not added yet', body: 'Salary day has passed. Log it in Prysm so your balance stays right.', schedule: { at: first, repeats: true, every: 'day', allowWhileIdle: true }, extra: { type: 'salary' } });
    }

    // bills: the day before and the morning of the due date; daily once overdue, until paid
    if (st.billOn) {
      S.commitments.forEach((c) => {
        [m0, m1].forEach((m) => {
          if (!billActive(c, m) || (c.paid || {})[m]) return;
          const due = dueDate(c, m);
          const before = at(addDays(due, -1), '09:00');
          const onDay = at(due, '09:00');
          if (before > now) list.push({ id: hash(c.id + m + 'b'), channelId: CHANNEL, title: 'Bill due tomorrow', body: `${c.name}: ${rupees(c.amount)} is due tomorrow.`, schedule: { at: before, allowWhileIdle: true }, extra: { type: 'bill' } });
          if (onDay > now) list.push({ id: hash(c.id + m + 'd'), channelId: CHANNEL, title: 'Bill due today', body: `${c.name}: ${rupees(c.amount)} is due today.`, schedule: { at: onDay, allowWhileIdle: true }, extra: { type: 'bill' } });
          if (m === m0 && due <= todayStr) {
            const first = nextOccurrence(at(addDays(due, 1), '10:00'), now);
            list.push({ id: hash(c.id + 'od'), channelId: CHANNEL, title: 'Bill overdue', body: `${c.name}: ${rupees(c.amount)} was due on ${due.slice(8)}/${due.slice(5, 7)}. Pay it and mark it paid.`, schedule: { at: first, repeats: true, every: 'day', allowWhileIdle: true }, extra: { type: 'bill' } });
          }
        });
      });
    }

    // money lent out: on the day it was promised back
    S.lent.forEach((l) => {
      if (!l.due || lentLeft(l) <= 0) return;
      const when = at(l.due, '10:00');
      if (when > now) list.push({ id: hash(l.id + 'l'), channelId: CHANNEL, title: 'Money to get back', body: `${l.person} promised to return ${rupees(lentLeft(l))} today.`, schedule: { at: when, allowWhileIdle: true }, extra: { type: 'lent' } });
    });

    // weekly nudges (Sunday = 1 ... Saturday = 7)
    if (st.weeklyOn) list.push({ id: 3, channelId: CHANNEL, title: 'Your week in money', body: 'Tap to see where your money went this week.', schedule: { on: { weekday: 1, hour: 19, minute: 0 }, allowWhileIdle: true }, extra: { type: 'weekly' } });
    if (st.backupOn) list.push({ id: 4, channelId: CHANNEL, title: 'Back up your data', body: 'Your data lives only on this phone. Export a backup and send it to yourself.', schedule: { on: { weekday: 7, hour: 20, minute: 0 }, allowWhileIdle: true }, extra: { type: 'backup' } });

    // goals: a review is due the evening a period ends (always on, it is mandatory), then every morning until answered
    const active = S.goals.filter((g) => !g.review);
    [...new Set(active.map((g) => g.end))].forEach((end) => {
      const dueAt = at(end, '20:00');
      if (dueAt > now) list.push({ id: hash('gr' + end), channelId: CHANNEL, title: 'Answer your goals', body: 'Time is up. Tell yourself honestly how it went.', schedule: { at: dueAt, allowWhileIdle: true }, extra: { type: 'goalReview' } });
      const nag = nextOccurrence(at(addDays(end, 1), '09:00'), now);
      list.push({ id: hash('gn' + end), channelId: CHANNEL, title: 'Your goals are waiting', body: 'You still have to answer them. It takes a minute.', schedule: { at: nag, repeats: true, every: 'day', allowWhileIdle: true }, extra: { type: 'goalReview' } });
    });
    if (st.goalCheckOn && active.length) {
      list.push({ id: 5, channelId: CHANNEL, title: 'A fresh week', body: 'Look at your goals and decide what moves today.', schedule: { on: { weekday: 2, hour: 9, minute: 0 }, allowWhileIdle: true }, extra: { type: 'goalCheck' } });
      list.push({ id: 6, channelId: CHANNEL, title: 'Halfway there', body: 'Update your goal progress while there is still time.', schedule: { on: { weekday: 5, hour: 19, minute: 0 }, allowWhileIdle: true }, extra: { type: 'goalCheck' } });
    }

    // bucket list: countdown reminders, the day after a deadline, and a monthly pick
    if (st.dreamOn) {
      S.bucket.filter((b) => b.status === 'open' && b.deadline).forEach((b) => {
        [90, 30, 7].forEach((off) => {
          const when = at(addDays(b.deadline, -off), '10:00');
          if (when > now) list.push({ id: hash(b.id + 'b' + off), channelId: CHANNEL, title: 'A dream is getting close', body: `${b.title}: ${off} days left.`, schedule: { at: when, allowWhileIdle: true }, extra: { type: 'bucket' } });
        });
        const after = at(addDays(b.deadline, 1), '09:00');
        if (after > now) list.push({ id: hash(b.id + 'x'), channelId: CHANNEL, title: 'Dream deadline passed', body: `${b.title}: did you do it, move it, or let it go?`, schedule: { at: after, allowWhileIdle: true }, extra: { type: 'goalReview' } });
      });
      if (S.bucket.some((b) => b.status === 'open')) {
        list.push({ id: 7, channelId: CHANNEL, title: 'Your dream of the month', body: 'Pick one dream to move forward this month.', schedule: { on: { day: 1, hour: 10, minute: 0 }, allowWhileIdle: true }, extra: { type: 'bucket' } });
      }
    }

    if (list.length) await LocalNotifications.schedule({ notifications: list });
  } catch (e) { /* scheduling is best-effort; the next sync retries */ }
}
