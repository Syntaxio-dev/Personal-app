import * as db from './db.js';
import { today, addDays } from './dates.js';
import * as SC from './screen.js';

const RANGES = [['today', 'Today'], ['week', '7 days'], ['month', '30 days']];
const LIMIT_CHIPS = [15, 30, 45, 60, 90, 120, 180];
const NIGHT_PRESETS = [['21:00', '9 PM'], ['22:00', '10 PM'], ['23:00', '11 PM'], ['00:00', '12 AM'], ['05:00', '5 AM'], ['06:00', '6 AM'], ['07:00', '7 AM'], ['08:00', '8 AM']];
const BED_PRESETS = [['21:00', '9 PM'], ['22:00', '10 PM'], ['22:30', '10:30 PM'], ['23:00', '11 PM'], ['23:30', '11:30 PM'], ['00:00', '12 AM'], ['01:00', '1 AM'], ['02:00', '2 AM']];
const WAKE_PRESETS = [['04:00', '4 AM'], ['05:00', '5 AM'], ['05:30', '5:30 AM'], ['06:00', '6 AM'], ['06:30', '6:30 AM'], ['07:00', '7 AM'], ['08:00', '8 AM'], ['09:00', '9 AM']];
const CAT_FILTER = [['all', 'All'], ['social', 'Social'], ['video', 'Video'], ['game', 'Games'], ['music', 'Music']];
const TONE = { good: '#4ade80', warn: '#fbbf24', info: '#a78bfa' };
const FOCUS_CHIPS = [25, 45, 60, 90];
const TAPER_CHIPS = [5, 10, 15];

// The Screen time page: today / 7 days / 30 days, apps, focus, limits, the sleep lock, sleep estimate, insights.
// Android reports the numbers. The PHONE holds the limits, the sleep lock and the focus session (they are promises: locked
// for a number of days or minutes, only ever stricter), so this file asks for changes and shows what the phone kept.
export function createScreen(d) {
  const { ui, openModal, closeModal, render, esc, svg, plugin, isNative, pickTime, fmtTime, toast, attKind, syncNotifications } = d;
  const S = () => db.get();
  const $ = (id) => document.getElementById(id);
  let range = 'today';
  let status = { usage: false, accessibility: false, admin: false, battery: false, known: false };
  let lastSync = 0;
  let syncing = null;
  const icons = {};
  let ld = null; // the limit being edited
  let sd = null; // the sleep lock being edited
  let fd = null; // the focus session being set up
  let focusTimer = null;
  let appList = null;
  let appListAt = 0;
  let pickTarget = 'limit';
  let pickCat = 'all';
  let pickerRows = null;

  const setSheet = (html) => {
    const sheet = document.querySelector('#modal .sheet');
    if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
  };
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  // ---------- locks ----------
  // the phone says whether an item is locked; without a phone (desktop) the same rule is worked out here
  const isLocked = (it) => !!it && (typeof it.locked === 'boolean' ? it.locked : SC.isLocked(it));
  const lockLine = (it) => {
    const now = Date.now();
    if (isLocked(it)) { const n = SC.daysLeft(it, now); return `Locked until ${fmtDate(it.lockUntil)} · ${n} day${n === 1 ? '' : 's'} left`; }
    if ((it.lockUntil || 0) > now) return `Just made. You can still change or delete it for ${Math.max(1, Math.ceil((SC.GRACE - (now - (it.created || 0))) / 60000))} min.`;
    return 'The lock has ended. You can change or remove this now.';
  };
  const focusOn = () => SC.focusRunning(S().focus.active);
  const lockedAny = () => S().limits.some(isLocked) || isLocked(S().sleepLock) || focusOn();
  // "4:45 PM" from a time in milliseconds
  const clockOf = (ms) => { const t = new Date(ms); return SC.fmtClock(t.getHours() * 60 + t.getMinutes()); };
  // 1:23:45 or 23:45 from a number of milliseconds
  const clockLeft = (ms) => {
    const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}` : `${p(Math.floor(t / 60))}:${p(t % 60)}`;
  };
  const groupNames = (f) => [...f.cats.map((c) => (SC.MEDIA.find(([k]) => k === c) || [c, c])[1]), ...(f.extra.length ? [`${f.extra.length} app${f.extra.length === 1 ? '' : 's'}`] : [])].join(', ');

  // ---------- talking to the phone ----------
  async function refreshStatus() {
    if (!isNative) return;
    try {
      const r = await plugin.screenStatus();
      status = { usage: !!r.usage, accessibility: !!r.accessibility, admin: !!r.admin, battery: !!r.battery, listener: r.listener !== false, locked: !!r.locked, known: true };
    } catch (e) { status = { usage: false, accessibility: false, admin: false, battery: false, listener: false, known: true, missing: true }; }
  }

  // what the phone kept becomes what we show
  function adopt(cfg) {
    const s = S();
    s.limits = (cfg.limits || []).map((l) => ({ id: l.id, name: l.name || '', pkgs: l.pkgs || [], min: l.min || 0, night: l.night || null, taper: l.taper && l.taper.step > 0 ? { step: l.taper.step, floor: l.taper.floor, from: l.taper.from || 0 } : null, on: l.on !== false, created: l.created || 0, lockUntil: l.lockUntil || 0, ...(typeof l.locked === 'boolean' ? { locked: l.locked } : {}), ...(typeof l.used === 'number' ? { used: l.used } : {}) }));
    const sl = cfg.sleep;
    s.sleepLock = sl ? { on: sl.on !== false, from: sl.from, to: sl.to, cats: sl.cats || [], extra: sl.extra || [], message: sl.message || SC.DEFAULT_MESSAGE, created: sl.created || 0, lockUntil: sl.lockUntil || 0, ...(typeof sl.locked === 'boolean' ? { locked: sl.locked } : {}) } : null;
    // the focus session and its log are written by the phone only; an older APK sends neither, and the desktop sends no log
    if ('focus' in cfg) s.focus.active = cfg.focus && cfg.focus.until ? { start: cfg.focus.start || 0, until: cfg.focus.until, label: cfg.focus.label || '', cats: cfg.focus.cats || [], extra: cfg.focus.extra || [] } : null;
    if (Array.isArray(cfg.focusLog)) s.focus.log = cfg.focusLog.map((e) => ({ s: Number(e.s) || 0, e: Number(e.e) || 0, m: Math.round(Number(e.m) || 0), l: String(e.l || '') })).filter((e) => e.s > 0 && e.m > 0).slice(-300);
  }

  async function pull() {
    if (!isNative) return false;
    try { adopt(await plugin.getScreenConfig()); await db.save(); return true; } catch (e) { return false; }
  }

  const motto = () => { const g = S().goals.find((x) => !x.review && x.why); return g ? `${g.title}: ${g.why}`.slice(0, 140) : ''; };

  // ask for a change. The phone (or, on the desktop, the same rules in JS) decides what is kept.
  async function push(incoming) {
    incoming.motto = motto();
    let kept;
    if (isNative) {
      try { kept = await plugin.setScreenConfig({ json: JSON.stringify(incoming) }); } catch (e) { return { ok: false, error: e }; }
    } else {
      kept = SC.mergeConfig({ limits: S().limits, sleep: S().sleepLock, focus: S().focus.active }, incoming, Date.now());
    }
    adopt(kept);
    await db.save();
    return { ok: true, refused: kept.refused || 0 };
  }

  const toIncoming = (l) => ({ id: l.id, name: l.name, pkgs: l.pkgs, min: l.min, night: l.night, taper: l.taper ? { step: l.taper.step, floor: l.taper.floor } : null, on: l.on });
  const toIncomingSleep = (x) => ({ on: x.on, from: x.from, to: x.to, cats: x.cats, extra: x.extra, message: x.message });

  // fresh from the phone, change it, send it back
  async function change(mutate) {
    await pull();
    const s = S();
    const incoming = { limits: s.limits.map(toIncoming), sleep: s.sleepLock ? toIncomingSleep(s.sleepLock) : null };
    mutate(incoming);
    const r = await push(incoming);
    if (!r.ok) await ui.alert('Prysm could not reach the lock on your phone. Install the newest Prysm APK over this one and try again.', 'Update needed');
    else if (r.refused) await ui.alert('Part of that change was refused because it is locked. Locked limits can only be made stricter.', 'Locked');
    return r;
  }

  // a focus session goes to the phone on its own: the limits and the sleep lock stay exactly as they are
  async function changeFocus(req) {
    await pull();
    const r = await push({ focus: req });
    if (!r.ok) await ui.alert('Prysm could not reach the lock on your phone. Install the newest Prysm APK over this one and try again.', 'Update needed');
    else if (r.refused) await ui.alert('A focus session cannot be ended early. That is what makes it work.', 'Locked');
    return r;
  }

  // only the motto: the phone keeps everything else, and our copy is refreshed from it
  async function pushConfig() {
    if (!isNative) return;
    await push({ motto: motto() });
  }

  // A streak of days inside a limit is good news: a short note at 7, 14, 30, 60 and 100 days, once per milestone.
  // A broken streak forgets its milestone, so the next run is celebrated again.
  function checkStreaks() {
    const s = S(), seen = s.settings.streakSeen;
    let changed = false;
    const quiet = $('modal').hidden && $('dialog').hidden;
    s.limits.forEach((l) => {
      const mark = SC.streakMilestone(SC.limitStreak(s, l)), was = seen[l.id] || 0;
      if (mark > was) {
        if (!quiet) return;
        seen[l.id] = mark;
        changed = true;
        ui.note(`${SC.limitName(s, l)}: ${mark} days in a row inside your limit. Keep going.`);
      } else if (mark < was) {
        if (mark) seen[l.id] = mark; else delete seen[l.id];
        changed = true;
      }
    });
    Object.keys(seen).forEach((id) => { if (!s.limits.some((l) => l.id === id)) { delete seen[id]; changed = true; } });
    if (changed) db.save();
  }

  // Pull the last days from Android and keep them. Resolves true when what the page shows changed.
  async function sync(force) {
    checkStreaks();
    if (!isNative) return false;
    if (syncing) return syncing;
    if (!force && Date.now() - lastSync < 45000) return false;
    syncing = (async () => {
      lastSync = Date.now();
      const t = today();
      // what the page shows: today's numbers, the limits, the sleep lock, the focus session and which permissions are on
      const snap = () => JSON.stringify([S().screen.days[t] || null, S().limits.map((l) => [l.id, l.used, l.locked, l.taper]), S().sleepLock, S().focus, status]);
      const before = snap();
      await refreshStatus();
      await pull();
      if (status.usage) {
        try {
          const starts = Array.from({ length: 10 }, (_, i) => new Date(`${addDays(t, i - 9)}T00:00`).getTime());
          const r = await plugin.getUsage({ starts });
          SC.merge(S(), r.days, r.names);
          await db.save();
        } catch (e) { /* keep what we have */ }
      }
      return before !== snap();
    })();
    const changed = await syncing;
    syncing = null;
    return changed;
  }

  async function loadIcons(pkgs) {
    const need = [...new Set(pkgs)].filter((p) => !icons[p]);
    if (!isNative || !need.length) return;
    for (let i = 0; i < need.length; i += 40) {
      try {
        const r = await plugin.getIcons({ pkgs: need.slice(i, i + 40) });
        Object.assign(icons, r.icons || {});
      } catch (e) { return; }
    }
    document.querySelectorAll('[data-ic]').forEach((el) => { if (icons[el.dataset.ic]) el.innerHTML = `<img src="${esc(icons[el.dataset.ic])}" alt="">`; });
  }

  const icon = (pkg, name) => `<span class="app-ic" data-ic="${esc(pkg)}">${icons[pkg] ? `<img src="${esc(icons[pkg])}" alt="">` : esc((name || '?').charAt(0).toUpperCase())}</span>`;

  async function getApps() {
    if (appList && Date.now() - appListAt < 300000) return appList;
    let list = [];
    if (isNative) {
      try { list = (await plugin.getApps()).apps || []; } catch (e) { list = []; }
    } else if (Array.isArray(window.__devApps)) list = window.__devApps;
    appList = list;
    appListAt = Date.now();
    list.forEach((a) => { S().screen.names[a.pkg] = S().screen.names[a.pkg] || a.name; });
    return list;
  }

  // apps that belong with the one you picked (Instagram and Instagram Lite)
  const familyOf = (pkg) => {
    const a = (appList || []).find((x) => x.pkg === pkg);
    return a && a.fam ? (appList || []).filter((x) => x.fam === a.fam).map((x) => x.pkg) : [pkg];
  };

  // ---------- views ----------
  const periodDates = () => (range === 'today' ? [today()] : SC.lastDates(range === 'week' ? 7 : 30));

  function setupCards() {
    if (!isNative || !status.known) return '';
    if (status.missing) return '<div class="card"><h2>Update needed</h2><div class="sec">This feature needs the newest Prysm APK. Install the latest version over this one.</div></div>';
    if (!status.usage) {
      return `<div class="card dcard attn"><div class="dhead"><h2>Allow usage access</h2></div>
        <div class="sec" style="line-height:1.55;margin-bottom:14px">Prysm needs Android's <b>Usage access</b> to see how long each app is open. Only the app name and the minutes are read. Nothing leaves your phone.</div>
        <button class="btn" data-act="scAllowUsage">Open settings</button></div>`;
    }
    if (lockedAny() && (!status.accessibility || !status.admin)) {
      return `<div class="card dcard attn"><div class="dhead"><h2>Your promise has a hole</h2><span class="bad">Fix it</span></div>
        <div class="sec" style="line-height:1.55;margin-bottom:14px">${!status.accessibility ? 'The accessibility service is off, so nothing is being blocked.' : 'Uninstall protection is off, so Prysm could be removed.'} Turn it back on.</div>
        <button class="btn" data-act="${!status.accessibility ? 'scAllowBlock' : 'scAllowAdmin'}">${!status.accessibility ? 'Turn on blocking' : 'Turn on protection'}</button></div>`;
    }
    return '';
  }

  function heroCard() {
    const s = S(), t = today();
    if (range === 'today') {
      const day = SC.dayData(s, t), y = SC.totalOn(s, addDays(t, -1)), now = day ? day.t : 0;
      let sub = 'Nothing recorded yet today.';
      if (now > 0) sub = y > 0 ? `${SC.fmt(Math.abs(now - y))} ${now >= y ? 'more' : 'less'} than yesterday (${SC.fmt(y)})` : 'Yesterday has no data to compare';
      return `<div class="hero"><div class="label">Screen time today</div><div class="num">${SC.fmt(now)}</div><div class="sub">${sub}</div>${day ? `<hr><div class="sub">${day.p} pickups · ${SC.fmt(SC.hourly(s, [t]).slice(0, 5).reduce((a, b) => a + b, 0))} after midnight</div>` : ''}</div>`;
    }
    const n = range === 'week' ? 7 : 30, dates = SC.lastDates(n, t);
    const avg = SC.average(s, dates), prev = SC.average(s, SC.lastDates(n, addDays(t, -n)));
    const have = dates.filter((x) => SC.totalOn(s, x) > 0);
    let sub = have.length ? `${SC.fmt(have.reduce((a, x) => a + SC.totalOn(s, x), 0))} in ${have.length} day${have.length === 1 ? '' : 's'}` : 'Not enough days yet.';
    if (avg > 0 && prev > 0) sub = `${SC.fmt(Math.abs(avg - prev))} ${avg >= prev ? 'more' : 'less'} a day than the ${n} days before`;
    return `<div class="hero"><div class="label">Daily average · ${n} days</div><div class="num">${SC.fmt(avg)}</div><div class="sub">${sub}</div><hr><div class="sub">${SC.pickupsAvg(s, dates)} pickups a day</div></div>`;
  }

  function appsCard() {
    const s = S(), apps = SC.topApps(s, periodDates(), 8);
    if (!apps.length) return '';
    const max = apps[0].min || 1;
    const rows = apps.map((a) => {
      const lim = SC.limitFor(s, a.pkg);
      return `<div class="sc-row" data-act="scApp" data-pkg="${esc(a.pkg)}">${icon(a.pkg, a.name)}
        <div class="grow"><div class="sc-name">${esc(a.name)}${lim ? `<span class="ptag">${lim.min > 0 ? SC.fmt(SC.minOn(lim)) : 'Night'} limit</span>` : ''}</div><div class="bar"><div style="width:${Math.max(3, Math.round((a.min / max) * 100))}%"></div></div></div>
        <b>${SC.fmt(a.min)}</b></div>`;
    }).join('');
    return `<div class="card"><div class="row between"><h2 style="margin:0">Most used</h2><span class="muted">Tap an app to limit it</span></div><div style="margin-top:12px">${rows}</div></div>`;
  }

  function limitsCard() {
    const s = S();
    const rows = s.limits.map((l) => {
      const st = SC.limitState(s, l);
      const names = l.pkgs.map((p) => SC.appName(s, p));
      const end = l.taper ? SC.taperEnd(l) : null;
      const sub = [l.min > 0 ? `${SC.fmt(st.min)} a day` : '', end ? `${SC.fmt(l.taper.floor)} by ${fmtDate(end)}` : '', l.night ? `Night ${fmtTime(l.night.from)} to ${fmtTime(l.night.to)}` : ''].filter(Boolean).join(' · ');
      const locked = isLocked(l);
      const streak = SC.limitStreak(s, l);
      return `<div class="lim-row"><div class="lim-top" data-act="scEdit" data-id="${l.id}">${icon(l.pkgs[0], names[0])}
        <div class="grow"><div class="sc-name">${esc(SC.limitName(s, l))}</div><div class="muted">${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` +${names.length - 3}` : ''} · ${esc(sub)}</div></div>
        ${locked ? `<span class="lock-badge" aria-label="Locked">${svg('lock')}</span>` : `<button class="switch ${l.on ? 'on' : ''}" role="switch" aria-checked="${l.on}" aria-label="Limit on" data-act="scToggle" data-id="${l.id}"><i></i></button>`}</div>
        ${l.min > 0 ? `<div class="bar ${st.over ? 'over' : ''}"><div style="width:${st.pct}%"></div></div><div class="muted lim-use">${st.over ? 'Limit reached. Opens again at midnight.' : `${SC.fmt(st.used)} used · ${SC.fmt(st.left)} left today`}</div>` : ''}
        ${streak > 0 ? `<div class="lim-streak"><i></i><span><b>${streak}</b> day${streak === 1 ? '' : 's'} in a row inside this limit</span></div>` : ''}
        <div class="muted lim-lock">${esc(lockLine(l))}</div></div>`;
    }).join('');
    const off = isNative && status.known && status.usage && !status.accessibility && s.limits.length ? '<div class="muted" style="margin-top:12px">Blocking is off until you turn the accessibility service on.</div>' : '';
    return `<div class="card"><div class="row between"><h2 style="margin:0">Limits</h2><button class="pill" data-act="scNew">+ New limit</button></div>
      ${rows || '<div class="muted" style="margin-top:12px;line-height:1.5">Pick the apps that eat your day, like Instagram or YouTube, and give them a daily limit. A limit is a promise: once made it is locked for the days you choose, you cannot raise it, remove it or switch it off, and when the time is up the app does not open until midnight. No extra minutes, ever.</div>'}${off}</div>`;
  }

  function sleepCard() {
    const sl = S().sleepLock;
    if (!sl) {
      return `<div class="card"><div class="row between"><h2 style="margin:0">Sleep lock</h2><button class="pill" data-act="scSleep">Set up</button></div>
        <div class="muted" style="margin-top:12px;line-height:1.5">At night every social, video and game app is locked, and so are their websites. No more scrolling in bed.</div></div>`;
    }
    const groups = sl.cats.map((c) => (SC.MEDIA.find(([k]) => k === c) || [c, c])[1]).join(', ');
    return `<div class="card"><div class="row between"><h2 style="margin:0">Sleep lock</h2>${isLocked(sl) ? `<span class="lock-badge" aria-label="Locked">${svg('lock')}</span>` : `<button class="pill ghost" data-act="scSleep">Edit</button>`}</div>
      <div class="sl-time" data-act="scSleep">${fmtTime(sl.from)} to ${fmtTime(sl.to)}</div>
      <div class="muted" style="line-height:1.5">${esc(groups || 'Chosen apps')}${sl.extra.length ? ` and ${sl.extra.length} more app${sl.extra.length === 1 ? '' : 's'}` : ''}, and their websites</div>
      <div class="sl-msg">${esc(sl.message)}</div>
      <div class="muted lim-lock">${esc(lockLine(sl))}</div></div>`;
  }

  // ---------- focus ----------
  function focusCard() {
    const s = S(), f = focusOn() ? s.focus.active : null, st = SC.focusStats(s);
    const stats = st.week > 0
      ? `<div class="fc-stats"><div><b>${SC.fmt(st.today)}</b><span>Today</span></div><div><b>${SC.fmt(st.week)}</b><span>7 days</span></div><div><b>${st.sessions}</b><span>Session${st.sessions === 1 ? '' : 's'}</span></div></div><div class="chart-box sc-chart fc-chart"><canvas id="sc-focus"></canvas></div>`
      : '';
    if (!f) {
      return `<div class="card"><div class="row between"><h2 style="margin:0">Focus</h2><button class="pill" data-act="scFocus">Start</button></div>
        <div class="muted" style="margin-top:12px;line-height:1.5">Lock the apps that pull you away for a set time. Once it starts nothing ends it early: no extra minutes, no way out.</div>${stats}</div>`;
    }
    const oops = Date.now() - f.start <= SC.FOCUS_OOPS;
    return `<div class="card fc-run"><div class="row between"><h2 style="margin:0">Focus session</h2><span class="lock-badge" aria-label="Locked">${svg('lock')}</span></div>
      <div class="fc-time" id="sc-focus-left">${clockLeft(f.until - Date.now())}</div>
      <div class="muted">${f.label ? `${esc(f.label)} · ` : ''}until ${clockOf(f.until)}</div>
      <div class="muted" style="margin-top:6px;line-height:1.5">Locked: ${esc(groupNames(f))}, and their websites.</div>
      <div class="${oops ? 'grid2' : ''}" id="sc-focus-btns" style="margin-top:16px"><button class="btn alt" data-act="scFocusMore">+ 15 min</button>${oops ? '<button class="btn alt" id="sc-focus-oops" data-act="scFocusOops">Undo start</button>' : ''}</div>${stats}</div>`;
  }

  // the countdown ticks while the card is on screen; when it reaches zero the phone is asked how the session ended
  function stopFocusTimer() { if (focusTimer) { clearInterval(focusTimer); focusTimer = null; } }

  const quietRender = () => {
    const t = $('view') && $('view').dataset.tab;
    if ((t === 'screen' || t === 'home') && $('modal').hidden && $('dialog').hidden) render();
  };

  async function settleNow(tries = 0) {
    const before = S().focus.log.length;
    if (isNative) await pull(); else SC.settleFocus(S());
    await db.save();
    const f = S().focus.active;
    // the phone's clock can be a few seconds behind ours: ask again shortly
    if (f && !SC.focusRunning(f) && tries < 5) { setTimeout(() => settleNow(tries + 1), 2000); return; }
    const log = S().focus.log;
    if (log.length > before) { ui.buzz('ok'); ui.note(`Focus done: ${log[log.length - 1].m} min. Well done.`); }
    quietRender();
  }

  function tickFocus() {
    const el = $('sc-focus-left'), f = S().focus.active;
    if (!el || !f) { stopFocusTimer(); return; }
    const left = f.until - Date.now();
    if (left <= 0) { stopFocusTimer(); settleNow(); return; }
    el.textContent = clockLeft(left);
    const oops = $('sc-focus-oops');
    if (oops && Date.now() - f.start > SC.FOCUS_OOPS) {
      const box = $('sc-focus-btns');
      oops.remove();
      if (box) box.classList.remove('grid2');
    }
  }

  const freshFocus = () => ({ minutes: 45, cats: ['social', 'video', 'game'], extra: [], label: '' });
  const keepLabel = () => { const f = $('fc-label'); if (f && fd) fd.label = f.value.trim(); };

  function focusSheet() {
    const s = S();
    const extraNames = fd.extra.map((p) => SC.appName(s, p));
    setSheet(`<h2>Start a focus session</h2><div class="muted" style="margin:-8px 0 14px;line-height:1.5">The groups you pick are locked, apps and websites, until the time is over. You cannot end it early and nothing gets you in.</div>
      <span class="label">How long</span>
      <div class="chips wrap">${FOCUS_CHIPS.map((m) => `<button class="${fd.minutes === m ? 'on' : ''}" data-act="scFcChip" data-v="${m}">${SC.fmt(m)}</button>`).join('')}</div>
      <div class="row between lim-step"><button class="icon" data-act="scFcStep" data-v="-1" aria-label="Less" ${fd.minutes <= SC.FOCUS_MIN ? 'disabled' : ''}>${svg('down')}</button><b>${SC.fmt(fd.minutes)}</b><button class="icon" data-act="scFcStep" data-v="1" aria-label="More" ${fd.minutes >= SC.FOCUS_MAX ? 'disabled' : ''}>${svg('up')}</button></div>
      <span class="label">Lock these groups</span>
      <div class="chips wrap">${SC.MEDIA.map(([k, l]) => `<button class="${fd.cats.includes(k) ? 'on' : ''}" data-act="scFcCat" data-v="${k}">${l}</button>`).join('')}</div>
      <span class="label">And these apps</span><button class="capsule ${fd.extra.length ? 'set' : ''}" data-act="scFcExtra"><span>${fd.extra.length ? esc(`${extraNames.slice(0, 2).join(', ')}${extraNames.length > 2 ? ` +${extraNames.length - 2}` : ''}`) : 'Choose apps (optional)'}</span></button>
      <span class="label">What are you focusing on? (optional)</span><input id="fc-label" value="${esc(fd.label)}" placeholder="e.g. Study, deep work" maxlength="40" autocomplete="off">
      <div class="grid2" style="margin-top:14px"><button class="btn alt" data-act="closeModal">Cancel</button><button class="btn" data-act="scFcStart">Start focus</button></div>`);
  }

  async function startFocus() {
    keepLabel();
    if (!fd.cats.length && !fd.extra.length) return toast('Choose at least one group or app to lock');
    if (!(await ensureReady())) return;
    const ok = await ui.confirm(`For the next ${SC.fmt(fd.minutes)} (until ${clockOf(Date.now() + fd.minutes * 60000)}) these stay shut, apps and websites: ${groupNames(fd)}.\n\nYou cannot end it early. There is no extra time and no way out.`, { title: 'Start focus?', ok: 'Start' });
    if (!ok) return;
    const r = await changeFocus({ minutes: fd.minutes, label: fd.label, cats: fd.cats, extra: fd.extra });
    if (r.ok) { ui.buzz('ok'); closeModal(); }
    render();
  }

  // ---------- sleep (an estimate) ----------
  function sleepStatsCard() {
    const s = S(), n = range === 'month' ? 30 : 7, dates = SC.lastDates(n);
    const st = SC.sleepStats(s, dates);
    if (!st.nights.length) return '';
    const steady = st.spread <= 30 ? 'Your bedtime is steady.' : st.spread <= 60 ? 'Your bedtime is fairly regular.' : `Your bedtime moves around by about ${SC.fmt(st.spread)}.`;
    return `<div class="card chart-card"><div class="row between"><h2 style="margin:0">Sleep</h2><span class="muted">estimate · ${n} nights</span></div>
      <div class="fc-stats"><div><b>${SC.fmt(st.avgMin)}</b><span>Average</span></div><div><b>${SC.fmtClock(st.avgBed)}</b><span>Bedtime</span></div><div><b>${SC.fmtClock(st.avgWake)}</b><span>Wake-up</span></div></div>
      <div class="muted" style="margin-top:12px">${steady}</div>
      <div class="chart-box sc-chart"><canvas id="sc-sleep"></canvas></div>
      <div class="muted" style="line-height:1.5">Worked out from the longest time your screen stayed off overnight, at least 3 hours. A phone left on a table counts as sleep, so treat it as a guide.</div></div>`;
  }

  function insightsCard() {
    const list = SC.insights(S(), attKind);
    if (!list.length) return `<div class="card"><h2>Insights</h2><div class="muted" style="line-height:1.5">Insights appear after a few days of data. Keep using your phone as usual.</div></div>`;
    return `<div class="card"><h2>Insights</h2>${list.map((i) => `<div class="ins-row"><i style="background:${TONE[i.tone]};box-shadow:0 0 8px ${TONE[i.tone]}80"></i><div><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div></div>`).join('')}</div>`;
  }

  const statRow = (ok, label) => `<div class="stat-row"><span class="dot" style="color:${ok ? '#4ade80' : '#f87171'}"></span><span>${label}</span><b class="${ok ? 'good' : 'bad'}">${ok ? 'On' : 'Off'}</b></div>`;

  function blockingCard() {
    if (!isNative) return `<div class="card"><h2>Blocking</h2><div class="sec">Blocking works in the installed Android app.</div></div>`;
    return `<div class="card"><h2>Blocking</h2>
      ${statRow(status.usage, 'Usage access')}${statRow(status.accessibility, 'Accessibility service')}${statRow(status.admin, 'Uninstall protection')}${statRow(status.battery, 'Battery unrestricted')}${statRow(status.listener, 'Notification access')}
      <div class="grid2" style="margin-top:14px"><button class="btn alt" data-act="scAllowBlock">${status.accessibility ? 'Accessibility' : 'Turn on blocking'}</button><button class="btn alt" data-act="scAllowAdmin">${status.admin ? 'Device admin' : 'Turn on protection'}</button></div>
      <span class="label" style="margin-top:18px">See the block screen</span>
      <div class="grid2"><button class="btn alt" data-act="scPreview">Time is up</button><button class="btn alt" data-act="scPreviewSleep">Sleep time</button></div>
      <button class="btn alt" style="margin-top:10px" data-act="scPreviewFocus">Focus session</button>
      <div class="muted" style="margin-top:12px;line-height:1.5">While a limit is locked, Prysm keeps shut the Settings screens that could undo it: Accessibility, Device admin, Usage access, Date and time, Developer options, Language, and the app info, force stop, clear data and uninstall of Prysm. Android 13+: if the accessibility switch is greyed out, open App settings, tap the three dots and choose <b>Allow restricted settings</b>. Prysm only learns which app is in front, reads browser address bars and those few Settings screens. Nothing leaves your phone.</div>
      <button class="btn alt" style="margin-top:12px" data-act="capAppSettings">App settings</button></div>`;
  }

  function view() {
    const s = S();
    // without a phone nothing else ends a finished focus session
    if (!isNative && SC.settleFocus(s)) db.save();
    const chips = `<div class="chips subtabs">${RANGES.map(([k, l]) => `<button class="${range === k ? 'on' : ''}" data-act="scRange" data-v="${k}">${l}</button>`).join('')}</div>`;
    const has = SC.hasData(s);
    let body;
    if (!has) {
      body = isNative
        ? (status.usage ? '<div class="empty"><div class="empty-ic">' + svg('clock') + '</div><b>Collecting your first numbers</b><span>Use your phone as usual. Prysm will show today\'s screen time here within a minute of opening it.</span></div>' : '')
        : '<div class="empty"><div class="empty-ic">' + svg('clock') + '</div><b>Screen time lives on your phone</b><span>Install the Android app to see how long you use each app.</span></div>';
    } else {
      const title = range === 'today' ? 'By hour' : 'Per day';
      body = `${heroCard()}<div class="card chart-card"><h2 style="margin:0">${title}</h2><div class="chart-box sc-chart"><canvas id="sc-chart"></canvas></div></div>${appsCard()}`;
    }
    return `${setupCards()}${has || isNative ? chips : ''}${body}${focusCard()}${limitsCard()}${sleepCard()}${has ? sleepStatsCard() : ''}${has ? insightsCard() : ''}${blockingCard()}`;
  }

  // dashboard widget
  function widget() {
    const s = S(), t = today();
    if (!SC.hasData(s)) {
      if (isNative && status.known && !status.usage) return '<div class="card dcard"><div class="dhead"><h2>Screen time</h2></div><div class="muted" style="margin-bottom:14px">See how long you use your phone and set limits for the apps that waste your day.</div><button class="btn alt sm" data-act="goScreen">Set up</button></div>';
      return isNative ? '<div class="card dcard"><div class="dhead"><h2>Screen time</h2><button class="link" data-act="goScreen">Open</button></div><div class="muted">Collecting your first numbers.</div></div>' : '';
    }
    const day = SC.dayData(s, t), now = day ? day.t : 0, y = SC.totalOn(s, addDays(t, -1));
    const top = SC.topApps(s, [t], 3);
    const near = s.limits.filter((l) => l.on && l.min > 0).map((l) => ({ l, st: SC.limitState(s, l) })).sort((a, b) => b.st.pct - a.st.pct).slice(0, 2);
    const sl = s.sleepLock && s.sleepLock.on ? `<div class="sw-lim"><div class="row between"><span>Sleep lock ${fmtTime(s.sleepLock.from)} to ${fmtTime(s.sleepLock.to)}</span><span class="muted">${isLocked(s.sleepLock) ? `${SC.daysLeft(s.sleepLock)} days left` : ''}</span></div></div>` : '';
    const f = focusOn() ? s.focus.active : null;
    const fc = f ? `<div class="sw-lim"><div class="row between"><span>Focus session${f.label ? `: ${esc(f.label)}` : ''}</span><span class="good">until ${clockOf(f.until)}</span></div></div>` : '';
    const best = s.limits.map((l) => ({ l, n: SC.limitStreak(s, l) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)[0];
    const sk = best ? `<div class="sw-lim"><div class="row between"><span>${esc(SC.limitName(s, best.l))}</span><span class="good">${best.n} days inside the limit</span></div></div>` : '';
    return `<div class="card dcard"><div class="dhead"><h2>Screen time</h2><button class="link" data-act="goScreen">Open</button></div>
      <div class="sw-num">${SC.fmt(now)}</div><div class="muted">${y > 0 && now > 0 ? `${SC.fmt(Math.abs(now - y))} ${now >= y ? 'more' : 'less'} than yesterday` : 'today so far'}${day ? ` · ${day.p} pickups` : ''}</div>
      ${top.length ? `<div class="sw-apps">${top.map((a) => `<span>${esc(a.name)} <b>${SC.fmt(a.min)}</b></span>`).join('')}</div>` : ''}
      ${fc}${near.map(({ l, st }) => `<div class="sw-lim"><div class="row between"><span>${esc(SC.limitName(s, l))}</span><span class="${st.over ? 'bad' : 'muted'}">${st.over ? 'Limit reached' : `${SC.fmt(st.left)} left`}</span></div><div class="bar ${st.over ? 'over' : ''}"><div style="width:${st.pct}%"></div></div></div>`).join('')}${sl}${sk}</div>`;
  }

  // charts, drawn after render
  function draw(Chart, charts, h) {
    const el = $('sc-chart');
    const s = S(), t = today();
    if (el) {
      let labels, data, titles;
      if (range === 'today') {
        const day = SC.dayData(s, t);
        labels = Array.from({ length: 24 }, (_, i) => (i % 6 === 0 ? SC.hourLabel(i).replace(' ', '') : ''));
        data = day ? day.h : Array(24).fill(0);
        titles = Array.from({ length: 24 }, (_, i) => `${SC.hourLabel(i)} to ${SC.hourLabel((i + 1) % 24)}`);
      } else {
        const n = range === 'week' ? 7 : 30, ds = SC.lastDates(n, t);
        labels = ds.map((x) => (n === 7 ? new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'short' }) : (Number(x.slice(8)) % 5 === 0 ? String(Number(x.slice(8))) : '')));
        data = ds.map((x) => SC.totalOn(s, x));
        titles = ds.map((x) => new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }));
      }
      bars(Chart, charts, h, el, { labels, data, titles, values: range === 'week', wide: range === 'month' });
    }

    // focus minutes of the last 7 days
    const fel = $('sc-focus');
    if (fel) {
      const ds = SC.lastDates(7, t);
      bars(Chart, charts, h, fel, { labels: ds.map((x) => new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'short' })), data: SC.focusByDay(s, ds), titles: ds.map((x) => new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })), values: true });
    }

    // sleep estimate: minutes slept on each night (a day with no estimate is an empty bar)
    const sel = $('sc-sleep');
    if (sel) {
      const n = range === 'month' ? 30 : 7, ds = SC.lastDates(n, t);
      bars(Chart, charts, h, sel, {
        labels: ds.map((x) => (n === 7 ? new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'short' }) : (Number(x.slice(8)) % 5 === 0 ? String(Number(x.slice(8))) : ''))),
        data: ds.map((x) => (s.screen.days[x] && s.screen.days[x].sl ? s.screen.days[x].sl[2] : 0)),
        titles: ds.map((x) => `${new Date(`${x}T00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}${s.screen.days[x] && s.screen.days[x].sl ? `: ${SC.fmtClock(s.screen.days[x].sl[0])} to ${SC.fmtClock(s.screen.days[x].sl[1])}` : ''}`),
        values: n === 7,
        wide: n === 30,
      });
    }
  }

  // one bar chart in the page's style: purple gradient bars, minutes on the axis, optional value above each bar
  function bars(Chart, charts, h, el, o) {
    const tick = (v) => (v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${v}m`);
    const valueLabels = {
      id: 'scLabels',
      afterDatasetsDraw(chart) {
        if (!o.values) return;
        const { ctx } = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          if (!(v > 0)) return;
          ctx.save();
          ctx.fillStyle = '#c4b5fd';
          ctx.font = "600 11px 'DM Sans'";
          ctx.textAlign = 'center';
          ctx.fillText(SC.fmt(v), bar.x, bar.y - 6);
          ctx.restore();
        });
      },
    };
    charts.push(new Chart(el, {
      type: 'bar',
      data: { labels: o.labels, datasets: [{ data: o.data, borderRadius: 5, borderSkipped: false, barPercentage: o.wide ? 0.8 : 0.7, categoryPercentage: 1, backgroundColor: (x) => h.gradient(x, '#a78bfa', '#6d28d9') }] },
      options: {
        maintainAspectRatio: false,
        animations: { colors: false },
        layout: { padding: { top: 20, right: 4 } },
        plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { title: (items) => o.titles[items[0].dataIndex], label: (it) => SC.fmt(it.parsed.y) } } },
        scales: {
          y: { beginAtZero: true, ticks: { maxTicksLimit: 4, callback: tick }, grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false } },
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, maxRotation: 0, color: 'rgba(255,255,255,0.5)' } },
        },
      },
      plugins: [valueLabels],
    }));
  }

  // after a render: fetch the icons the page shows
  function afterRender() {
    const pkgs = [];
    document.querySelectorAll('[data-ic]').forEach((el) => pkgs.push(el.dataset.ic));
    loadIcons(pkgs);
    if ($('sc-focus-left')) { if (!focusTimer) focusTimer = setInterval(tickFocus, 1000); } else stopFocusTimer();
  }

  // ---------- setup gate: a locked limit only works when all of this is on ----------
  function missing() {
    const out = [];
    if (!status.usage) out.push(['Usage access', 'Lets Prysm see how long each app is open.', 'scAllowUsage', 'Open settings']);
    if (!status.accessibility) out.push(['Accessibility service', 'Lets Prysm notice the app in front and put the block screen over it.', 'scAllowBlock', 'Turn on']);
    if (!status.admin) out.push(['Uninstall protection', 'Android then refuses to uninstall Prysm while a limit is locked.', 'scAllowAdmin', 'Turn on']);
    if (!status.battery) out.push(['Battery unrestricted', 'Otherwise your phone may stop Prysm in the background and nothing is blocked.', 'scAllowBattery', 'Allow']);
    if (!status.listener) out.push(['Notification access', 'Lets Prysm hide the notifications of an app that is blocked, so you cannot reply to them. Payment capture uses it too.', 'scAllowListener', 'Open settings']);
    return out;
  }

  async function ensureReady() {
    if (!isNative) return true;
    await refreshStatus();
    if (status.missing) { await ui.alert('This needs the newest Prysm APK. Install the latest version over this one.', 'Update needed'); return false; }
    if (!missing().length) return true;
    readySheet();
    return false;
  }

  function readySheet() {
    const rows = missing().map(([name, why, act, btn]) => `<div class="set-row"><div class="grow"><b>${name}</b><span>${why}</span></div><button class="capsule set" style="margin:0" data-act="${act}"><span>${btn}</span></button></div>`).join('');
    setSheet(`<h2>Finish setup first</h2><div class="muted" style="margin:-8px 0 14px;line-height:1.5">A locked limit is only as strong as these. Turn them on, then check again.</div>${rows}
      <div class="grid2" style="margin-top:18px"><button class="btn alt" data-act="scReadyBack">Back</button><button class="btn" data-act="scReadyCheck">Check again</button></div>`);
  }

  // ---------- the limit sheet ----------
  const fresh = (pkgs = []) => ({ id: '', name: '', pkgs, min: 60, night: false, from: '23:00', to: '06:00', lockDays: 30, taperStep: 0, taperFloor: 0, orig: null });
  // a taper starts by aiming for about half of today's limit, in steps of 5
  const defaultFloor = (min) => Math.max(5, Math.floor(min / 2 / 5) * 5);
  const lockedLimit = () => !!ld && !!ld.orig && isLocked(ld.orig);
  const keepName = () => { const f = $('sc-name'); if (f && ld) ld.name = f.value.trim(); };

  const lockChips = (selected, act, withKeep) => `<div class="chips wrap">${withKeep ? `<button class="${!selected ? 'on' : ''}" data-act="${act}" data-v="0">Keep</button>` : ''}${SC.LOCK_CHOICES.map(([n, l]) => `<button class="${selected === n ? 'on' : ''}" data-act="${act}" data-v="${n}">${l}</button>`).join('')}</div>`;

  function limitSheet() {
    const s = S();
    const names = ld.pkgs.map((p) => SC.appName(s, p));
    const summary = ld.pkgs.length ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` : 'Choose apps';
    const locked = lockedLimit();
    const o = ld.orig;
    const maxMin = locked && o.min > 0 ? o.min : 720;
    const noteHtml = !o ? '' : locked
      ? `<div class="banner">${svg('lock')}<div><b>Locked</b><span>${esc(lockLine(o))}. You can only make this stricter: fewer minutes, more apps, a longer night, a faster taper.</span></div></div>`
      : `<div class="banner">${svg('clock')}<div><b>Not locked</b><span>${esc(lockLine(o))}</span></div></div>`;
    // the weekly taper: a locked one can only get stricter (a bigger step, a lower floor), and it needs minutes to take away
    const ot = o && o.taper ? o.taper : null;
    const taperOn = ld.min > 5;
    if (!taperOn) ld.taperStep = 0;
    if (ld.taperStep > 0) ld.taperFloor = Math.max(5, Math.min(ld.taperFloor || defaultFloor(ld.min), ld.min - 5));
    const weeks = ld.taperStep > 0 ? Math.ceil((ld.min - ld.taperFloor) / ld.taperStep) : 0;
    const taperHtml = !taperOn ? '' : `<span class="label" style="margin-top:10px">Tighten every week</span>
      <div class="chips wrap"><button class="${ld.taperStep === 0 ? 'on' : ''}" data-act="scTaper" data-v="0" ${ot ? 'disabled' : ''}>None</button>${TAPER_CHIPS.map((m) => `<button class="${ld.taperStep === m ? 'on' : ''}" data-act="scTaper" data-v="${m}" ${ot && m < ot.step ? 'disabled' : ''}>${m} min</button>`).join('')}</div>
      ${ld.taperStep > 0 ? `<div class="row between lim-step"><button class="icon" data-act="scTFloor" data-v="-5" aria-label="Lower floor" ${ld.taperFloor <= 5 ? 'disabled' : ''}>${svg('down')}</button><b>down to ${SC.fmt(ld.taperFloor)}</b><button class="icon" data-act="scTFloor" data-v="5" aria-label="Higher floor" ${ld.taperFloor >= ld.min - 5 || (ot && ld.taperFloor >= ot.floor) ? 'disabled' : ''}>${svg('up')}</button></div>
        <div class="muted" id="sc-taper-note" style="margin-bottom:6px;line-height:1.5">Every week ${ld.taperStep} min less, from ${SC.fmt(ld.min)} down to ${SC.fmt(ld.taperFloor)} in ${weeks} week${weeks === 1 ? '' : 's'}.${ot ? ' A locked taper can only get faster or go lower.' : ''}</div>` : ''}`;
    setSheet(`<h2>${o ? 'Edit limit' : 'New limit'}</h2>${noteHtml}
      <span class="label">Name (optional)</span><input id="sc-name" value="${esc(ld.name)}" placeholder="e.g. Social media" maxlength="40" autocomplete="off">
      <span class="label">Apps</span><button class="capsule ${ld.pkgs.length ? 'set' : ''}" data-act="scPickApps"><span>${esc(summary)}</span></button>
      <span class="label">Daily limit</span>
      <div class="chips wrap"><button class="${ld.min === 0 ? 'on' : ''}" data-act="scChip" data-v="0" ${locked && o.min > 0 ? 'disabled' : ''}>None</button>${LIMIT_CHIPS.map((m) => `<button class="${ld.min === m ? 'on' : ''}" data-act="scChip" data-v="${m}" ${m > maxMin ? 'disabled' : ''}>${SC.fmt(m)}</button>`).join('')}</div>
      <div class="row between lim-step"><button class="icon" data-act="scStep" data-v="-5" aria-label="Less">${svg('down')}</button><b>${ld.min > 0 ? SC.fmt(ld.min) : 'No daily limit'}</b><button class="icon" data-act="scStep" data-v="5" aria-label="More" ${ld.min >= maxMin ? 'disabled' : ''}>${svg('up')}</button></div>
      ${taperHtml}
      <div class="set-row" style="margin-top:10px"><div class="grow"><b>Block at night</b><span>The apps will not open between the two times</span></div><button class="switch ${ld.night ? 'on' : ''}" role="switch" aria-checked="${ld.night}" aria-label="Block at night" data-act="scNight" ${locked && o.night ? 'disabled' : ''}><i></i></button></div>
      ${ld.night ? `<div class="grid2" style="margin-top:12px"><div><span class="label">From</span><button class="capsule set" data-act="scFrom">${svg('clock')}<span>${fmtTime(ld.from)}</span></button></div><div><span class="label">Until</span><button class="capsule set" data-act="scTo">${svg('clock')}<span>${fmtTime(ld.to)}</span></button></div></div>` : ''}
      <span class="label" style="margin-top:10px">${!o ? 'Lock it for' : locked ? 'Extend the lock' : 'Lock it again'}</span>${lockChips(ld.lockDays, 'scLock', !!o)}
      <div class="grid2" style="margin-top:14px">${o && !locked ? '<button class="btn alt" data-act="scDel">Delete</button>' : '<button class="btn alt" data-act="closeModal">Cancel</button>'}<button class="btn" data-act="scSave">Save limit</button></div>`);
  }

  const lockWords = (days) => `for ${days} days, until ${fmtDate(Date.now() + days * SC.DAY)}`;

  async function saveLimit() {
    keepName();
    if (!ld.pkgs.length) return toast('Choose at least one app');
    if (!(ld.min > 0) && !ld.night) return toast('Set a daily limit, a night window, or both');
    if (ld.night && ld.from === ld.to) return toast('The night window needs two different times');
    const days = ld.lockDays;
    if (!ld.orig || days > 0) {
      if (!(await ensureReady())) return;
      const ok = await ui.confirm(`This limit will be locked ${lockWords(days)}.\n\nUntil then you cannot raise it, remove it, switch it off or take apps out of it. When the time is up the app stays shut until midnight, and there is no way to get extra minutes.\n\nPrysm will also keep shut the Settings screens that could undo it. You can still make it stricter.`, { title: 'Lock this limit?', ok: 'Lock it' });
      if (!ok) return;
    }
    const next = { id: ld.id || db.uid(), name: ld.name, pkgs: ld.pkgs, min: ld.min > 0 ? ld.min : 0, night: ld.night ? { from: ld.from, to: ld.to } : null, taper: ld.taperStep > 0 && ld.min > 5 ? { step: ld.taperStep, floor: ld.taperFloor } : null, on: true, ...(days > 0 ? { lockDays: days } : {}) };
    const r = await change((inc) => {
      const i = inc.limits.findIndex((x) => x.id === next.id);
      if (i >= 0) inc.limits[i] = next; else inc.limits.push(next);
    });
    if (r.ok) { ui.buzz('ok'); closeModal(); }
    render();
  }

  // ---------- the app picker (limit apps, or the extra apps of the sleep lock) ----------
  const pickedList = () => (pickTarget === 'sleep' ? sd.extra : pickTarget === 'focus' ? fd.extra : ld.pkgs);
  const setPicked = (l) => { if (pickTarget === 'sleep') sd.extra = l; else if (pickTarget === 'focus') fd.extra = l; else ld.pkgs = l; };
  const lockedPkgs = () => {
    if (pickTarget === 'sleep') return sd.orig && isLocked(sd.orig) ? sd.orig.extra : [];
    if (pickTarget === 'focus') return [];
    return lockedLimit() ? ld.orig.pkgs : [];
  };

  async function pickerSheet() {
    if (pickTarget === 'limit') keepName();
    const list = await getApps();
    pickCat = 'all';
    const body = (q) => list.filter((a) => (!q || a.name.toLowerCase().includes(q)) && (pickCat === 'all' || a.cat === pickCat)).map((a) => {
      const on = pickedList().includes(a.pkg), held = lockedPkgs().includes(a.pkg);
      return `<button class="app-pick ${on ? 'on' : ''} ${held ? 'held' : ''}" data-act="scAppTick" data-pkg="${esc(a.pkg)}">${icon(a.pkg, a.name)}<span class="grow">${esc(a.name)}${a.cat ? `<small>${esc((SC.MEDIA.find(([k]) => k === a.cat) || ['', ''])[1])}</small>` : ''}</span><i class="tick"></i></button>`;
    }).join('') || '<div class="muted" style="padding:14px 0">No apps found.</div>';
    pickerRows = body;
    setSheet(`<h2>Choose apps</h2><input id="sc-q" placeholder="Search apps" autocomplete="off">
      <div class="chips scroll" id="sc-cats">${CAT_FILTER.map(([k, l]) => `<button class="${pickCat === k ? 'on' : ''}" data-act="scPickCat" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="app-list" id="sc-applist">${body('')}</div><button class="btn" style="margin-top:14px" data-act="scAppsDone">Done${pickedList().length ? ` (${pickedList().length})` : ''}</button>`);
    loadIcons(list.map((a) => a.pkg));
  }

  function refreshPicker() {
    const q = ($('sc-q') && $('sc-q').value.trim().toLowerCase()) || '';
    if (!pickerRows || !$('sc-applist')) return;
    $('sc-applist').innerHTML = pickerRows(q);
    const done = document.querySelector('[data-act="scAppsDone"]');
    if (done) done.textContent = `Done${pickedList().length ? ` (${pickedList().length})` : ''}`;
    loadIcons([...document.querySelectorAll('#sc-applist [data-ic]')].map((el) => el.dataset.ic));
  }

  document.addEventListener('input', (e) => { if (e.target.id === 'sc-q' && pickerRows) refreshPicker(); });

  // ---------- the sleep lock sheet ----------
  const lockedSleep = () => !!sd && !!sd.orig && isLocked(sd.orig);
  const keepMsg = () => { const f = $('sl-msg'); if (f && sd) sd.message = f.value.trim(); };

  function sleepSheet() {
    const s = S();
    const locked = lockedSleep(), o = sd.orig;
    const extraNames = sd.extra.map((p) => SC.appName(s, p));
    const noteHtml = !o ? '' : locked
      ? `<div class="banner">${svg('lock')}<div><b>Locked</b><span>${esc(lockLine(o))}. You can only make it stricter: a longer night, more groups, more apps.</span></div></div>`
      : `<div class="banner">${svg('clock')}<div><b>Not locked</b><span>${esc(lockLine(o))}</span></div></div>`;
    setSheet(`<h2>Sleep lock</h2><div class="muted" style="margin:-8px 0 14px;line-height:1.5">Between bedtime and wake-up the groups you pick are locked, apps and websites. Nothing gets you in, and there is no extra time.</div>${noteHtml}
      <div class="grid2"><div><span class="label">Bedtime</span><button class="capsule set" data-act="scSlFrom">${svg('clock')}<span>${fmtTime(sd.from)}</span></button></div><div><span class="label">Wake up</span><button class="capsule set" data-act="scSlTo">${svg('clock')}<span>${fmtTime(sd.to)}</span></button></div></div>
      <span class="label">Lock these groups</span>
      <div class="chips wrap">${SC.MEDIA.map(([k, l]) => `<button class="${sd.cats.includes(k) ? 'on' : ''}" data-act="scSlCat" data-v="${k}" ${locked && o.cats.includes(k) ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <span class="label">And these apps</span><button class="capsule ${sd.extra.length ? 'set' : ''}" data-act="scSlExtra"><span>${sd.extra.length ? esc(`${extraNames.slice(0, 2).join(', ')}${extraNames.length > 2 ? ` +${extraNames.length - 2}` : ''}`) : 'Choose apps (optional)'}</span></button>
      <span class="label">Message on the lock screen</span><input id="sl-msg" value="${esc(sd.message)}" maxlength="120" autocomplete="off">
      <span class="label">${!o ? 'Lock it for' : locked ? 'Extend the lock' : 'Lock it again'}</span>${lockChips(sd.lockDays, 'scSlLock', !!o)}
      <div class="grid2" style="margin-top:14px">${o && !locked ? '<button class="btn alt" data-act="scSlDel">Delete</button>' : '<button class="btn alt" data-act="closeModal">Cancel</button>'}<button class="btn" data-act="scSlSave">Save sleep lock</button></div>`);
  }

  async function saveSleep() {
    keepMsg();
    if (!sd.cats.length && !sd.extra.length) return toast('Choose at least one group or app to lock');
    if (sd.from === sd.to) return toast('Bedtime and wake-up need two different times');
    const days = sd.lockDays;
    if (!sd.orig || days > 0) {
      if (!(await ensureReady())) return;
      const ok = await ui.confirm(`The sleep lock will be locked ${lockWords(days)}.\n\nEvery night from ${fmtTime(sd.from)} to ${fmtTime(sd.to)} the chosen apps and their websites are shut, and the screen says: "${sd.message || SC.DEFAULT_MESSAGE}"\n\nUntil the lock ends you cannot shorten the night, remove groups, or switch it off.`, { title: 'Lock your sleep?', ok: 'Lock it' });
      if (!ok) return;
    }
    const next = { on: true, from: sd.from, to: sd.to, cats: sd.cats, extra: sd.extra, message: sd.message || SC.DEFAULT_MESSAGE, ...(days > 0 ? { lockDays: days } : {}) };
    const r = await change((inc) => { inc.sleep = next; });
    if (r.ok) { closeModal(); syncNotifications(); } // the wind-down notice follows the sleep lock
    render();
  }

  // the limit or sleep lock being edited (never both)
  const backToDraft = () => { if (ld) limitSheet(); else if (sd) sleepSheet(); else if (fd) focusSheet(); else closeModal(); };

  // ---------- actions ----------
  const actions = {
    scRange: (el) => { range = el.dataset.v; render(); },
    scAllowUsage: async () => {
      const go = await ui.confirm('Android will open the Usage access list. Find Prysm and switch it on. Prysm reads only the app name and the minutes, and nothing leaves your phone.', { title: 'Usage access', ok: 'Open settings' });
      if (go) { try { await plugin.openUsageSettings(); } catch (e) { toast('Could not open settings'); } }
    },
    scAllowBlock: async () => {
      const go = await ui.confirm('Android needs an accessibility service to know which app is in front, so Prysm can stop it when your time is up.\n\nOn Android 13+ first open App settings, tap the three dots and choose "Allow restricted settings". Then open Accessibility, pick "Prysm screen time limits" under downloaded apps and switch it on.\n\nPrysm only sees the app name, browser address bars and a few Settings screens. It never reads other apps or what you type.', { title: 'Turn on blocking', ok: 'Open Accessibility' });
      if (go) { try { await plugin.openAccessibilitySettings(); } catch (e) { toast('Could not open settings'); } }
    },
    scAllowAdmin: async () => {
      const go = await ui.confirm('Prysm asks Android to make it a device admin. The only effect: while it is on, Android refuses to uninstall Prysm, so a locked limit cannot be removed by deleting the app. Prysm gets no other power: it cannot lock, wipe or watch your phone.', { title: 'Uninstall protection', ok: 'Continue' });
      if (go) { try { await plugin.requestAdmin(); } catch (e) { toast('Could not open the device admin screen'); } }
    },
    scAllowBattery: async () => { try { await plugin.requestIgnoreBattery(); } catch (e) { toast('Could not open settings'); } },
    scAllowListener: async () => { try { await plugin.openSettings(); } catch (e) { toast('Could not open settings'); } },
    scReadyCheck: async () => {
      await refreshStatus();
      if (missing().length) readySheet(); else backToDraft();
    },
    scReadyBack: () => backToDraft(),
    scPreview: async () => { try { await plugin.previewBlock({ kind: 'limit' }); } catch (e) { toast('Turn on the Prysm accessibility service first.'); } },
    scPreviewSleep: async () => { try { await plugin.previewBlock({ kind: 'sleep' }); } catch (e) { toast('Turn on the Prysm accessibility service first.'); } },
    scPreviewFocus: async () => { try { await plugin.previewBlock({ kind: 'focus' }); } catch (e) { toast('Turn on the Prysm accessibility service first.'); } },

    // focus sessions
    scFocus: () => { ld = null; sd = null; fd = freshFocus(); focusSheet(); },
    scFcChip: (el) => { keepLabel(); fd.minutes = Number(el.dataset.v); focusSheet(); },
    // 5 minutes at a time up to an hour and a half, then 15 (so 4 hours is not forty taps)
    scFcStep: (el) => {
      keepLabel();
      const dir = Number(el.dataset.v) < 0 ? -1 : 1;
      const step = (dir > 0 ? fd.minutes >= 90 : fd.minutes > 90) ? 15 : 5;
      fd.minutes = Math.min(SC.FOCUS_MAX, Math.max(SC.FOCUS_MIN, fd.minutes + dir * step));
      focusSheet();
    },
    scFcCat: (el) => {
      keepLabel();
      const k = el.dataset.v;
      fd.cats = fd.cats.includes(k) ? fd.cats.filter((x) => x !== k) : [...fd.cats, k];
      focusSheet();
    },
    scFcExtra: () => { keepLabel(); pickTarget = 'focus'; pickerSheet(); },
    scFcStart: () => startFocus(),
    scFocusMore: async () => {
      await pull();
      const f = S().focus.active;
      if (!SC.focusRunning(f)) { render(); return; }
      const minutes = Math.min(SC.FOCUS_MAX, Math.ceil((f.until - Date.now()) / 60000) + 15);
      if (Date.now() + minutes * 60000 <= f.until + 1000) { await ui.alert('A session can run for 4 hours from now at most.', 'Longest session'); return; }
      const r = await changeFocus({ minutes, label: f.label, cats: f.cats, extra: f.extra });
      if (r.ok) ui.buzz('ok');
      render();
    },
    // the one way out: a wrong tap can be undone in the first minute
    scFocusOops: async () => { await changeFocus(null); render(); },

    // limits
    scNew: () => { sd = null; fd = null; ld = fresh(); limitSheet(); },
    scApp: async (el) => {
      const s = S(), pkg = el.dataset.pkg, lim = SC.limitFor(s, pkg);
      if (lim) { actions.scEdit({ dataset: { id: lim.id } }); return; }
      await getApps();
      sd = null;
      fd = null;
      ld = fresh(familyOf(pkg));
      limitSheet();
    },
    scEdit: async (el) => {
      await pull();
      const l = S().limits.find((x) => x.id === el.dataset.id);
      if (!l) return;
      sd = null;
      fd = null;
      ld = { id: l.id, name: l.name, pkgs: [...l.pkgs], min: l.min, night: !!l.night, from: l.night ? l.night.from : '23:00', to: l.night ? l.night.to : '06:00', lockDays: 0, taperStep: l.taper ? l.taper.step : 0, taperFloor: l.taper ? l.taper.floor : 0, orig: JSON.parse(JSON.stringify(l)) };
      limitSheet();
    },
    scTaper: (el) => {
      keepName();
      ld.taperStep = Number(el.dataset.v);
      if (ld.taperStep > 0 && !ld.taperFloor) ld.taperFloor = defaultFloor(ld.min);
      limitSheet();
    },
    scTFloor: (el) => { keepName(); ld.taperFloor += Number(el.dataset.v); limitSheet(); },
    scToggle: async (el) => {
      const id = el.dataset.id;
      await change((inc) => { const l = inc.limits.find((x) => x.id === id); if (l) l.on = !l.on; });
      render();
    },
    scChip: (el) => { keepName(); ld.min = Number(el.dataset.v); limitSheet(); },
    scStep: (el) => {
      keepName();
      const maxMin = lockedLimit() && ld.orig.min > 0 ? ld.orig.min : 720;
      const delta = Number(el.dataset.v);
      ld.min = delta < 0 && !ld.min ? 0 : Math.min(maxMin, Math.max(5, (ld.min || 0) + delta));
      limitSheet();
    },
    scNight: () => { keepName(); ld.night = !ld.night; limitSheet(); },
    scFrom: async () => {
      keepName();
      const v = await pickTime({ value: ld.from, title: 'Block from', presets: NIGHT_PRESETS, allowNone: false });
      if (v) {
        if (lockedLimit() && ld.orig.night && !SC.coversTimes({ from: v, to: ld.to }, ld.orig.night)) await ui.alert('This night window is locked. You can only make it longer, not shorter.', 'Locked');
        else ld.from = v;
      }
      limitSheet();
    },
    scTo: async () => {
      keepName();
      const v = await pickTime({ value: ld.to, title: 'Open again at', presets: NIGHT_PRESETS, allowNone: false });
      if (v) {
        if (lockedLimit() && ld.orig.night && !SC.coversTimes({ from: ld.from, to: v }, ld.orig.night)) await ui.alert('This night window is locked. You can only make it longer, not shorter.', 'Locked');
        else ld.to = v;
      }
      limitSheet();
    },
    scLock: (el) => { keepName(); ld.lockDays = Number(el.dataset.v); limitSheet(); },
    scPickApps: () => { pickTarget = 'limit'; pickerSheet(); },
    scAppTick: (el) => {
      const p = el.dataset.pkg;
      const held = lockedPkgs();
      const on = !pickedList().includes(p);
      const group = familyOf(p);
      if (!on && group.some((x) => held.includes(x))) { ui.alert('This app is part of a locked promise. You can add apps, not take them out.', 'Locked'); return; }
      setPicked(on ? [...new Set([...pickedList(), ...group])] : pickedList().filter((x) => !group.includes(x)));
      refreshPicker();
    },
    scPickCat: (el) => {
      pickCat = el.dataset.v;
      document.querySelectorAll('#sc-cats button').forEach((b) => b.classList.toggle('on', b.dataset.v === pickCat));
      refreshPicker();
    },
    scAppsDone: () => { pickerRows = null; if (pickTarget === 'sleep') sleepSheet(); else if (pickTarget === 'focus') focusSheet(); else limitSheet(); },
    scSave: () => saveLimit(),
    scDel: async () => {
      if (!ld || !ld.orig) return;
      if (!(await ui.confirm('This limit will be removed. The apps will open freely again.', { title: 'Delete limit', ok: 'Delete', danger: true }))) return;
      const id = ld.id;
      const r = await change((inc) => { inc.limits = inc.limits.filter((x) => x.id !== id); });
      if (r.ok) closeModal();
      render();
    },

    // sleep lock
    scSleep: async () => {
      await pull();
      ld = null;
      fd = null;
      const o = S().sleepLock;
      sd = o
        ? { from: o.from, to: o.to, cats: [...o.cats], extra: [...o.extra], message: o.message, lockDays: 0, orig: JSON.parse(JSON.stringify(o)) }
        : { from: S().settings.sleep || '23:00', to: '06:00', cats: ['social', 'video', 'game'], extra: [], message: SC.DEFAULT_MESSAGE, lockDays: 30, orig: null };
      sleepSheet();
    },
    scSlFrom: async () => {
      keepMsg();
      const v = await pickTime({ value: sd.from, title: 'Bedtime', presets: BED_PRESETS, allowNone: false });
      if (v) {
        if (lockedSleep() && !SC.coversTimes({ from: v, to: sd.to }, sd.orig)) await ui.alert('The sleep window is locked. You can only make the night longer, not shorter.', 'Locked');
        else sd.from = v;
      }
      sleepSheet();
    },
    scSlTo: async () => {
      keepMsg();
      const v = await pickTime({ value: sd.to, title: 'Wake up', presets: WAKE_PRESETS, allowNone: false });
      if (v) {
        if (lockedSleep() && !SC.coversTimes({ from: sd.from, to: v }, sd.orig)) await ui.alert('The sleep window is locked. You can only make the night longer, not shorter.', 'Locked');
        else sd.to = v;
      }
      sleepSheet();
    },
    scSlCat: (el) => {
      keepMsg();
      const k = el.dataset.v;
      if (sd.cats.includes(k)) sd.cats = sd.cats.filter((x) => x !== k); else sd.cats = [...sd.cats, k];
      sleepSheet();
    },
    scSlExtra: () => { keepMsg(); pickTarget = 'sleep'; pickerSheet(); },
    scSlLock: (el) => { keepMsg(); sd.lockDays = Number(el.dataset.v); sleepSheet(); },
    scSlSave: () => saveSleep(),
    scSlDel: async () => {
      if (!sd || !sd.orig) return;
      if (!(await ui.confirm('The sleep lock will be removed.', { title: 'Delete sleep lock', ok: 'Delete', danger: true }))) return;
      const r = await change((inc) => { inc.sleep = null; });
      if (r.ok) { closeModal(); syncNotifications(); }
      render();
    },
  };

  return {
    view, widget, draw, afterRender, sync, pull, refreshStatus, pushConfig, actions, checkStreaks,
    locked: lockedAny,
    getRange: () => range,
    getStatus: () => status,
  };
}
