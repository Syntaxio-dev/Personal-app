import * as db from './db.js';
import { today, addDays, dayName, pad, fmtTime } from './dates.js';
import * as F from './fitness.js';
import { MUSCLES, MUSCLE_SECTIONS, GROUPS, KINDS, EQUIPMENT, BUILTIN, BUILTIN_BY_ID, STARTERS } from './exercises.js';
import * as media from './media.js';

// Starter routines, one tap to add. Every entry is an exercise name from the built-in library: [name, sets, reps].
export { STARTERS };

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const fmtLong = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
const short = (kind, s) => (kind === 'wr' ? `${F.trim(s.kg)}×${F.trim(s.reps)}` : kind === 'bw' ? (s.kg > 0 ? `+${F.trim(s.kg)}×${F.trim(s.reps)}` : F.trim(s.reps)) : `${F.trim(s.reps)}${kind === 'sec' ? 's' : 'm'}`);
const kgText = (v) => (v ? F.trim(v) : '');
const fmtNum = (n) => Math.round(n).toLocaleString('en-IN');
const pl = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Fitness mode screens: Today | Workout | Calendar | Steps (+ its settings page). Rules live in fitness.js.
export function createFitness(d) {
  const { ui, openModal, closeModal, commit, render, esc, svg, syncNotifications, pickTime, buzz, plugin, isNative, openTab } = d;
  const S = () => db.get().fitness;
  const $ = (id) => document.getElementById(id);

  let sub = 'routines'; // Workout tab: routines | history | exercises
  let cm = today().slice(0, 7);
  let range = 7;
  let lib = { q: '', eq: 'all', mu: 'all', limit: 120 }; // the Exercises tab: search + the two filters
  let fm = { ex: '', sel: '', busy: -1 }; // the form video / photo sheet: which exercise, which file is shown, save progress (0..1, -1 = idle)
  let cxMuscle = 'chest'; // the muscle chosen in the Create exercise sheet
  let histLimit = 30;
  let pick = null; // the exercise picker: { target: 'active' | 'routine', q, eq, mu, limit, view: 'list' | 'muscle' | 'equip' }
  let rt = null; // the routine being edited
  let rtDirty = false;
  let rv = { id: '', metric: 'volume', months: 3 }; // the routine page: which routine, what the graph shows
  let achTimer = 0;
  let ticker = 0;
  let lastRest = 0;
  let info = { known: false, supported: true, granted: false };
  let saveTimer = 0;

  // typing in a set must not save on every key: one write shortly after the last key
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = 0; db.save(); }, 400); };
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; return db.save(); } return Promise.resolve(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  const setSheet = (html) => {
    const sheet = document.querySelector('#modal .sheet');
    if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
  };
  const emptyBox = (title, text, icon = 'fwork') => `<div class="empty"><div class="empty-ic">${svg(icon)}</div><b>${title}</b><span>${text}</span></div>`;
  const gdots = (groups) => `<span class="gdots">${groups.map((g) => `<i style="color:${F.GROUP_COLOR[g]}" title="${esc(F.groupLabel(g))}"></i>`).join('')}</span>`;
  const gnames = (groups) => groups.map((g) => F.groupLabel(g)).join(' · ');
  const exInfo = (id) => F.exOf(S(), id);

  // ---------- steps: the phone counts, this page shows ----------
  async function refreshStatus() {
    if (!isNative) return;
    try {
      const r = await plugin.stepsStatus();
      info = { known: true, supported: !!r.supported, granted: !!r.granted };
    } catch (e) { info = { known: true, supported: false, granted: false }; }
  }

  // true when something on screen changed
  async function sync() {
    if (!isNative) return false;
    const before = `${info.known}${info.supported}${info.granted}`;
    await refreshStatus();
    let changed = before !== `${info.known}${info.supported}${info.granted}`;
    if (info.supported && info.granted) {
      try {
        const r = await plugin.getSteps();
        const merged = F.mergeStepDays(S().steps.days, r && r.days);
        const days = S().steps.days;
        if (Object.keys(merged).some((k) => merged[k] !== days[k])) { S().steps.days = merged; changed = true; await db.save(); }
      } catch (e) { /* an older APK has no step counter */ }
    }
    return changed;
  }

  const stepsReady = () => !isNative || (info.known && info.supported && info.granted);

  function stepsPrompt() {
    if (!info.known) return '<div class="sub">Checking the step counter…</div>';
    if (!info.supported) return '<div class="num">—</div><div class="sub">This phone has no step counter.</div>';
    return '<div class="num">—</div><div class="sub" style="margin-bottom:14px">Prysm counts steps with the phone\'s own step counter. Nothing leaves this phone.</div><button class="btn sm light" data-act="fAskSteps">Allow step counting</button>';
  }

  function stepsHero() {
    const f = S(), st = f.settings, t = today();
    if (!stepsReady()) return `<div class="hero"><div class="label">Steps today</div>${stepsPrompt()}</div>`;
    const steps = F.stepsOn(f, t);
    const pct = Math.min(100, Math.round((steps / st.goal) * 100));
    return `<div class="hero"><div class="label">Steps today</div><div class="num">${fmtNum(steps)}</div>
      <div class="sub">of ${fmtNum(st.goal)} · ${pct}%</div><div class="bar"><div style="width:${pct}%"></div></div>
      <div class="sub" style="margin-top:12px">≈ ${F.distanceKm(steps, st.height).toFixed(1)} km · ${fmtNum(F.kcalOf(steps, st.height, st.weight))} kcal <span style="opacity:.7">(estimates)</span></div>
      ${isNative ? '' : '<div class="sub" style="opacity:.7;margin-top:4px">Steps are counted on the phone.</div>'}</div>`;
  }

  async function askSteps() {
    if (!isNative) { ui.alert('Steps are counted on the phone. Open Prysm on your phone.'); return; }
    const go = await ui.confirm('Prysm counts your steps with the phone\'s built-in step counter. Android will ask to let Prysm see your physical activity. Your steps never leave this phone.', { title: 'Count steps', ok: 'Continue' });
    if (!go) return;
    try { await plugin.requestSteps(); } catch (e) { /* older APK */ }
    // the system dialog answers later: look again for a while
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await refreshStatus();
      if (info.granted) break;
    }
    await sync();
    render();
    if (!info.granted) {
      const open = await ui.confirm('Step counting is still off. Allow "Physical activity" for Prysm in the phone\'s app settings.', { title: 'Permission needed', ok: 'Open settings' });
      if (open) { try { await plugin.openAppSettings(); } catch (e) { /* ignore */ } }
    }
  }

  // ---------- Today ----------
  function todayView() {
    const f = S(), st = f.settings, t = today();
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = db.get().settings.name;
    const a = f.active;
    let work;
    if (a) {
      work = `<div class="card feat"><div class="label">Workout in progress</div><div class="m-title" style="margin:8px 0 4px">${esc(a.name)}</div>
        <div class="muted"><span data-elapsed>${fmtLong(Math.floor((Date.now() - a.start) / 1000))}</span> · ${F.doneCount(a)} of ${pl(F.totalSets(a), 'set')} done</div>
        <button class="btn sm" style="margin-top:14px" data-act="goto" data-tab="fwork">Continue</button></div>`;
    } else {
      const rows = f.routines.slice(0, 4).map((r) => { const g = [...new Set(r.items.map((i) => F.groupOf(i.m)))]; return `<div class="mrow" style="--k:${F.GROUP_COLOR[g[0]] || 'var(--p2)'}" data-act="fStart" data-id="${esc(r.id)}"><div class="grow"><div class="m-title">${esc(r.name)}</div><div class="muted">${pl(r.items.length, 'exercise')}${g.length ? ' · ' + esc(gnames(g)) : ''}</div></div><span class="pill">Start</span></div>`; }).join('');
      work = `<div class="card"><h2>Workout</h2>${rows}<button class="btn ${rows ? 'alt' : ''} sm" data-act="fStart" data-id="">Empty workout</button>${rows ? '' : '<div class="muted" style="margin-top:12px">Make routines like Chest day or Back day in the Workout tab.</div>'}</div>`;
    }
    const wk = F.weekStrip(f, t);
    const goal = st.weekGoal;
    const sk = F.streak(f, t, st.maxRest);
    const strip = wk.days.map((x, i) => `<div class="wd ${x.today ? 'today' : ''}${x.future ? ' future' : ''}"><span>${DAY_LETTERS[i]}</span><div>${x.groups.length ? gdots(x.groups.slice(0, 4)) : '<em></em>'}</div></div>`).join('');
    const week = `<div class="card"><div class="row between"><h2 style="margin:0">This week</h2><span class="tag">${wk.done} of ${goal}</span></div>
      <div class="wk">${strip}</div><div class="bar"><div style="width:${Math.min(100, Math.round((wk.done / goal) * 100))}%"></div></div>
      <div class="muted" style="margin-top:10px">${sk.current ? `${sk.current} workout ${sk.current === 1 ? 'day' : 'days'} in a row. Rest days are fine.` : sk.last ? 'Your streak is over. One workout starts a new one.' : 'Your first workout starts a streak.'}</div></div>`;
    return `<div class="greet" style="margin-bottom:14px">${hello}${name ? ', ' + esc(name) : ''}</div>${stepsHero()}${work}${week}`;
  }

  // ---------- Workout ----------
  const lastFor = (it, start) => F.lastSets(S(), it.ex, start);
  const routineById = (id) => S().routines.find((r) => r.id === id);
  const itemNames = (r) => r.items.map((i) => F.itemInfo(S(), i).name).join(', ');
  const elapsedText = (a) => fmtLong(Math.max(0, Math.floor((Date.now() - a.start) / 1000)));

  function setRow(a, it, i, s, j, prev) {
    const kind = it.k, w = F.hasWeight(kind);
    const p = prev && prev.sets[j] ? short(kind, prev.sets[j]) : '–';
    const mark = F.SET_MARK[s.t];
    const unit = F.UNIT[kind];
    return `<div class="fx-set swipe ${w ? '' : 'nokg'} ${s.done ? 'done' : ''}" data-i="${i}" data-j="${j}">
      <button class="fx-n t-${s.t} ${s.pr ? 'pr' : ''}" data-act="fSetType" data-i="${i}" data-j="${j}" aria-label="${s.pr ? 'Better than last time' : 'Set type'}">${s.pr ? svg('medal') : mark || j + 1}</button>
      <span class="fx-was">${p}</span>
      ${w ? `<input class="fx-in" type="text" inputmode="decimal" data-f="kg" data-i="${i}" data-j="${j}" value="${kgText(s.kg)}" placeholder="0" aria-label="Kilograms">` : ''}
      <input class="fx-in" type="text" inputmode="decimal" data-f="reps" data-i="${i}" data-j="${j}" value="${kgText(s.reps)}" placeholder="${unit === 'reps' ? '0' : unit}" aria-label="${unit}">
      <button class="fx-ok ${s.done ? 'on' : ''}" data-act="fTick" data-i="${i}" data-j="${j}" aria-label="Done">${svg('check')}</button>
      <button hidden data-act="delFSet" data-i="${i}" data-j="${j}" tabindex="-1" aria-hidden="true"></button></div>`;
  }

  const unitHead = (kind) => (F.UNIT[kind] === 'reps' ? 'Reps' : F.UNIT[kind] === 'sec' ? 'Sec' : 'Min');

  function exerciseCard(a, it, i) {
    const f = S();
    const e = F.itemInfo(f, it);
    const prev = lastFor(it, a.start);
    const w = F.hasWeight(it.k);
    const head = `<div class="fx-cols ${w ? '' : 'nokg'}"><span>Set</span><span>Previous</span>${w ? '<span>Kg</span>' : ''}<span>${unitHead(it.k)}</span><span></span></div>`;
    return `<div class="card fx-ex"><div class="row between"><button class="fx-title" data-act="fExHist" data-id="${esc(it.ex)}"><b>${esc(e.name)}</b></button>
        <button class="icon" data-act="fExMenu" data-i="${i}" aria-label="More">${svg('more')}</button></div>
      <div class="fx-chips"><button class="fx-chip" data-act="fRestPick" data-where="active" data-i="${i}">${svg('clock')}Rest: ${F.restLabel(F.restFor(f, it))}</button><button class="fx-chip ${it.note ? 'on' : ''}" data-act="fNote" data-i="${i}">${svg('edit')}${it.note ? 'Note' : 'Add note'}</button><button class="fx-chip ${F.mediaOf(f, it.ex).length ? 'on' : ''}" data-act="fForm" data-ex="${esc(it.ex)}">${svg('play')}Form${F.mediaOf(f, it.ex).length ? ` (${F.mediaOf(f, it.ex).length})` : ''}</button></div>
      ${it.note ? `<div class="fx-note">${esc(it.note)}</div>` : ''}
      ${head}${it.sets.map((s, j) => setRow(a, it, i, s, j, prev)).join('')}
      <button class="btn alt fx-addset" data-act="fAddSet" data-i="${i}">+ Add set</button></div>`;
  }

  const restBar = (left) => `<div class="rest-bar"><span class="label">Rest</span><b id="fx-rest-t">${F.clock(left)}</b><div class="rest-btns"><button data-act="fRest" data-v="-15">−15</button><button data-act="fRest" data-v="15">+15</button><button data-act="fRest" data-v="0">Skip</button></div></div>`;

  function activeView(a) {
    const left = F.restLeft(a, Date.now());
    return `<div class="aw-sticky"><div class="aw-top"><div class="grow"><button class="aw-name" data-act="fRename">${esc(a.name)}</button><div class="muted">Tap the name to change it</div></div><button class="pill" data-act="fFinish">Finish</button></div>
      <div id="fx-rest-slot">${left ? restBar(left) : ''}</div></div>
      <div class="aw-stats"><div><span>Duration</span><b id="fx-elapsed" data-elapsed>${elapsedText(a)}</b></div><div><span>Volume</span><b id="fx-vol">${fmtNum(F.liveVolume(a))} kg</b></div><div><span>Sets</span><b id="fx-prog">${F.doneCount(a)} / ${F.totalSets(a)}</b></div></div>
      ${a.items.map((it, i) => exerciseCard(a, it, i)).join('') || emptyBox('Add your first exercise', 'Pick from the library or make your own.')}
      <button class="btn" data-act="fAddEx">+ Add exercise</button>
      <button class="btn alt" style="margin-top:10px" data-act="fDiscard">Discard workout</button>
      <div class="muted" style="margin-top:14px;line-height:1.5">The workout keeps running until you press Finish, even if you leave this page. Tick a set when it is done. A set that beats last time earns a medal. Tap the set number for warm-up (W), drop set (D) or failure (F). Swipe a set left to delete it.</div>`;
  }

  // a thin bar on the other Fitness tabs while a workout is running
  function miniBar() {
    const a = S().active;
    if (!a) return '';
    return `<button class="mini-run" data-act="fGo" data-tab="fwork"><i class="dot"></i><b>${esc(a.name)}</b><span data-elapsed>${elapsedText(a)}</span><em>Open</em></button>`;
  }

  function routineCard(r) {
    return `<div class="card rcard" data-act="fOpenRoutine" data-id="${esc(r.id)}"><div class="row between"><b class="m-title">${esc(r.name)}</b><button class="icon" data-act="fRMenu" data-id="${esc(r.id)}" aria-label="More">${svg('more')}</button></div>
      <div class="rnames">${esc(itemNames(r))}</div><button class="btn" data-act="fStart" data-id="${esc(r.id)}">Start Routine</button></div>`;
  }

  function sessionRow(s) {
    const g = F.sessionGroups(s);
    return `<div class="mrow" style="--k:${F.GROUP_COLOR[g[0]] || 'var(--p2)'}" data-act="fSession" data-id="${esc(s.id)}"><div class="grow"><div class="m-title">${esc(s.name)}</div>
      <div class="muted">${esc(dayName(s.date))} · ${pl(F.sessionSets(s), 'set')} · ${F.sessionMinutes(s)} min${F.sessionVolume(s) ? ' · ' + fmtNum(F.sessionVolume(s)) + ' kg' : ''}</div></div>${gdots(g)}</div>`;
  }

  function exerciseRow(e) {
    const last = F.lastText(S(), e);
    const n = F.mediaOf(S(), e.id).length;
    return `<div class="item tap" data-act="fExDetail" data-id="${esc(e.id)}"><div class="grow"><div>${esc(e.name)}${e.custom ? ' <span class="ptag">Custom</span>' : ''}</div><div class="muted">${esc(F.muscleLabel(e.muscle))} · ${esc(e.equip)}${last ? ' · ' + esc(last) : ''}</div></div>${n ? `<span class="fx-has">${svg('play')}</span>` : ''}</div>`;
  }

  const plural = (n) => `${fmtNum(n)} ${n === 1 ? 'result' : 'results'}`;
  function libraryList() {
    const list = F.filterExercises(S(), lib);
    const shown = list.slice(0, lib.limit);
    return (shown.map(exerciseRow).join('') || '<div class="muted" style="padding:12px 0">No exercise matches. Tap + New exercise and choose its muscle group.</div>')
      + (list.length > shown.length ? `<button class="btn alt" style="margin-top:12px" data-act="fLibMore">Show more (${fmtNum(list.length - shown.length)} left)</button>` : '');
  }

  // "All Equipment" / "All Muscles": two buttons that open a sheet, lit up while a filter is on
  const filterButtons = (ctx, st) => `<div class="fx-filters"><button class="${st.eq !== 'all' ? 'on' : ''}" data-act="fFilter" data-kind="equip" data-ctx="${ctx}">${st.eq === 'all' ? 'All Equipment' : esc(st.eq)}</button><button class="${st.mu !== 'all' ? 'on' : ''}" data-act="fFilter" data-kind="muscle" data-ctx="${ctx}">${st.mu === 'all' ? 'All Muscles' : esc(F.muscleLabel(st.mu))}</button></div>`;

  function workView() {
    const f = S();
    if (f.active) return activeView(f.active);
    const tabs = `<div class="chips subtabs scroll">${[['routines', 'Routines'], ['history', 'History'], ['exercises', 'Exercises']].map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-act="fSub" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (sub === 'history') {
      const list = F.sortedSessions(f).reverse();
      return tabs + (list.length ? `<div class="card" style="padding:12px 12px 2px">${list.slice(0, histLimit).map(sessionRow).join('')}</div>${list.length > histLimit ? '<button class="btn alt" data-act="fMoreHist">Show older</button>' : ''}` : emptyBox('No workouts yet', 'Finished workouts show up here.'));
    }
    if (sub === 'exercises') {
      return `${tabs}<input id="fx-lq" type="search" placeholder="Search exercise" value="${esc(lib.q)}" autocomplete="off">${filterButtons('lib', lib)}
        <div class="label" id="fx-lib-count" style="margin:0 2px 10px">${plural(F.filterExercises(f, lib).length)}</div><div class="card" id="fx-lib">${libraryList()}</div>
        <button class="btn alt" data-act="fCustomLib" data-id="">+ Create exercise</button>`;
    }
    const cards = f.routines.map(routineCard).join('');
    return `${tabs}<button class="btn alt start-empty" data-act="fStart" data-id="">+ Start empty workout</button>
      <div class="grid2" style="margin:14px 0 18px"><button class="btn alt" data-act="fEditRoutine" data-id="">+ New routine</button><button class="btn alt" data-act="fExplore">Explore</button></div>
      <div class="label" style="margin:0 2px 10px">My routines (${f.routines.length})</div>
      ${cards || emptyBox('No routines yet', 'A routine is a saved list of exercises with the sets, reps and weight you plan, like Chest + Triceps. Make your own, or tap Explore for ready ones.')}`;
  }

  // ---------- a routine: its progress and its plan ----------
  const SINCE = [[1, '1 month'], [3, '3 months'], [0, 'All']];
  const METRICS = [['volume', 'Volume'], ['reps', 'Reps'], ['duration', 'Duration']];
  const sinceDate = () => (rv.months ? addDays(today(), -30 * rv.months) : '0000-00-00');
  const metricText = (m, v) => (m === 'volume' ? `${fmtNum(v)} kg` : m === 'reps' ? `${fmtNum(v)} reps` : `${fmtNum(v)} min`);

  function routineView() {
    const f = S();
    const r = routineById(rv.id);
    if (!r) return emptyBox('Routine not found', 'It may have been deleted.');
    const all = F.routineSessions(f, r.id);
    const last = all[all.length - 1];
    const series = F.routineSeries(f, r.id, rv.metric, sinceDate());
    const lastVal = last ? (rv.metric === 'reps' ? F.sessionReps(last) : rv.metric === 'duration' ? F.sessionMinutes(last) : F.sessionVolume(last)) : 0;
    const progress = all.length
      ? `<div class="card"><div class="rp-head"><b>${metricText(rv.metric, lastVal)}</b><span>${esc(dayName(last.date))}</span></div>
          <div class="chips" style="margin:10px 0 4px">${SINCE.map(([m, l]) => `<button class="${rv.months === m ? 'on' : ''}" data-act="fRvRange" data-v="${m}">${l}</button>`).join('')}</div>
          ${series.length ? '<div class="fx-chart"><canvas id="fx-routine-chart"></canvas></div>' : '<div class="muted" style="padding:26px 0;text-align:center">No workouts of this routine in this period.</div>'}
          <div class="chips" style="margin:6px 0 0">${METRICS.map(([m, l]) => `<button class="${rv.metric === m ? 'on' : ''}" data-act="fRvMetric" data-v="${m}">${l}</button>`).join('')}</div>
          <div class="muted" style="margin-top:4px">${pl(all.length, 'workout')} of this routine so far.</div></div>`
      : '<div class="card"><div class="label">Progress</div><div class="muted" style="margin-top:8px;line-height:1.5">Finish this routine once and your volume, reps and time show up here as a graph.</div></div>';
    const exs = r.items.map((it) => {
      const e = F.itemInfo(f, it);
      const w = F.hasWeight(e.kind);
      const plan = F.planOf(it);
      const prev = F.lastSets(f, it.ex);
      const work = prev ? prev.sets.filter((x) => x.t !== 'w') : [];
      const rows = plan.map((p, j) => `<div class="rp-row ${w ? '' : 'nokg'}"><b>${j + 1}</b>${w ? `<span>${kgText(p.kg) || '–'}</span>` : ''}<span>${kgText(p.reps) || '–'}</span><span class="dim">${work[j] ? short(e.kind, work[j]) : '–'}</span></div>`).join('');
      return `<div class="card rp-ex"><button class="fx-title" data-act="fExDetail" data-id="${esc(it.ex)}"><b>${esc(e.name)}</b><span class="tag">${esc(F.muscleLabel(e.muscle))}</span></button>
        <div class="muted rp-rest">${svg('clock')} Rest timer: ${F.restLabel(F.restFor(f, it))}</div>
        <div class="rp-row head ${w ? '' : 'nokg'}"><span>Set</span>${w ? '<span>Kg</span>' : ''}<span>${unitHead(e.kind)}</span><span>Last time</span></div>${rows}</div>`;
    }).join('');
    return `<button class="btn" data-act="fStart" data-id="${esc(r.id)}">Start Routine</button><div style="height:14px"></div>
      ${progress}
      <div class="row between" style="margin:6px 2px 10px"><div class="label">Exercises (${r.items.length})</div><button class="link" data-act="fEditRoutine" data-id="${esc(r.id)}">Edit routine</button></div>${exs}`;
  }

  // ---------- the routine editor (a page, like making a routine in Heavy) ----------
  function editView() {
    if (!rt) return emptyBox('Nothing to edit', 'Go back and open a routine.');
    const f = S();
    const rows = rt.items.map((it, i) => {
      const e = F.itemInfo(f, it);
      const w = F.hasWeight(e.kind);
      const sets = it.sets.map((p, j) => `<div class="ed-set ${w ? '' : 'nokg'}"><b>${j + 1}</b>${w ? `<input type="text" inputmode="decimal" data-rt="kg" data-i="${i}" data-j="${j}" value="${kgText(p.kg)}" placeholder="0" aria-label="Kilograms">` : ''}<input type="text" inputmode="decimal" data-rt="reps" data-i="${i}" data-j="${j}" value="${kgText(p.reps)}" placeholder="0" aria-label="${unitHead(e.kind)}"><button class="icon" data-act="fRtDelSet" data-i="${i}" data-j="${j}" aria-label="Remove set">${svg('trash')}</button></div>`).join('');
      return `<div class="card fx-ex"><div class="row between"><div class="grow"><b class="m-title">${esc(e.name)}</b><div class="muted">${esc(F.muscleLabel(e.muscle))}</div></div>
          <button class="icon" data-act="fRtMove" data-i="${i}" data-d="-1" aria-label="Move up">${svg('up')}</button><button class="icon" data-act="fRtMove" data-i="${i}" data-d="1" aria-label="Move down">${svg('down')}</button><button class="icon" data-act="fRtDel" data-i="${i}" aria-label="Remove exercise">${svg('trash')}</button></div>
        <div class="fx-chips"><button class="fx-chip" data-act="fRestPick" data-where="rt" data-i="${i}">${svg('clock')}Rest: ${F.restLabel(F.restFor(f, it))}</button></div>
        <div class="ed-set head ${w ? '' : 'nokg'}"><span>Set</span>${w ? '<span>Kg</span>' : ''}<span>${unitHead(e.kind)}</span><span></span></div>${sets}
        <button class="btn alt fx-addset" data-act="fRtAddSet" data-i="${i}">+ Add set</button></div>`;
    }).join('');
    return `<div class="ed-bar"><button class="link" data-act="fRtCancel">Cancel</button><button class="pill" data-act="fRtSave">Save</button></div>
      <input id="rt-name" class="rt-name" type="text" maxlength="40" placeholder="Routine name" value="${esc(rt.name)}" autocomplete="off">
      ${rows || emptyBox('Get started by adding an exercise to your routine.', 'You will set the sets, reps and weight for each one.')}
      <button class="btn" data-act="fRtAdd">+ Add exercise</button>
      <div class="muted" style="margin:12px 2px 0;line-height:1.5">These numbers are the plan. When you start the routine they fill in, and after a workout Prysm offers to update the plan with what you actually lifted.</div>
      ${rt.id ? '<button class="btn danger" style="margin-top:14px" data-act="fRtRemove">Delete routine</button>' : ''}`;
  }

  function exploreSheet() {
    const f = S();
    const rows = STARTERS.map(([name, list], i) => {
      const have = f.routines.some((r) => r.name.toLowerCase() === name.toLowerCase());
      return `<div class="item"><div class="grow"><div><b>${esc(name)}</b></div><div class="muted">${esc(list.map((x) => x[0]).join(', '))}</div></div>${have ? '<span class="tag">Added</span>' : `<button class="pill" data-act="fAddStarter" data-i="${i}">Add</button>`}</div>`;
    }).join('');
    setSheet(`<h2>Explore routines</h2><div class="muted" style="margin:-8px 0 12px">Ready made plans. Add one, then change the sets and weights to fit you.</div>${rows}<button class="btn alt" style="margin-top:14px" data-act="fClose">Close</button>`);
  }

  function restSheet(where, i) {
    const f = S();
    const it = where === 'rt' ? rt && rt.items[i] : f.active && f.active.items[i];
    if (!it) return;
    const cur = F.restOf(it);
    const btn = (v, l) => `<button class="${cur === v ? 'on' : ''}" data-act="fRestSet" data-where="${where}" data-i="${i}" data-v="${v}">${l}</button>`;
    setSheet(`<h2>Rest timer</h2><div class="muted" style="margin:-8px 0 12px">Starts when you tick a set of ${esc(F.itemInfo(f, it).name)}.</div>
      <div class="chips wrap">${btn(-1, 'Default (' + F.restLabel(f.settings.restSec) + ')')}${F.REST_PICKS.map((v) => btn(v, F.restLabel(v))).join('')}</div>
      <button class="btn alt" data-act="fClose">Close</button>`);
  }

  function noteSheet(i) {
    const a = S().active, it = a && a.items[i];
    if (!it) return;
    setSheet(`<h2>Note</h2><div class="muted" style="margin:-8px 0 12px">${esc(F.itemInfo(S(), it).name)}. For example: seat on 4, felt heavy, left shoulder tight.</div>
      <textarea id="fx-itnote" rows="3" maxlength="200" placeholder="Write a note">${esc(it.note || '')}</textarea>
      <div class="grid2"><button class="btn alt" data-act="fClose">Cancel</button><button class="btn" data-act="fNoteSave" data-i="${i}">Save</button></div>`);
  }

  // the little capsule that drops from the top when a set beats last time
  function celebrate(title, text) {
    let el = $('ach');
    if (!el) { el = document.createElement('div'); el.id = 'ach'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span class="ach-ic">${svg('medal')}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
    el.classList.remove('out');
    el.classList.add('show');
    clearTimeout(achTimer);
    achTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { if (el.classList.contains('out')) el.classList.remove('show', 'out'); }, 360); }, 3800);
  }

  // ---------- Calendar ----------
  function calView() {
    const f = S(), st = f.settings, t = today();
    const by = F.sessionsByDay(f);
    const { lead, days } = F.monthCells(cm);
    let cells = DAY_LETTERS.map((l) => `<div class="h">${l}</div>`).join('') + '<div></div>'.repeat(lead);
    days.forEach((ds) => {
      const g = F.dayGroups(by[ds]);
      cells += `<div class="d ${ds === t ? 'today' : ''}${g.length ? ' has' : ''}" data-act="fDay" data-date="${ds}">${+ds.slice(8)}${g.length ? gdots(g.slice(0, 4)) : ''}</div>`;
    });
    const legend = GROUPS.map(([id, l]) => `<span><i class="sw" style="background:${F.GROUP_COLOR[id]}"></i>${l}</span>`).join('');
    const m = F.monthSummary(f, cm);
    const mins = m.minutes >= 60 ? `${Math.floor(m.minutes / 60)}h ${m.minutes % 60}m` : `${m.minutes}m`;
    const sk = F.streak(f, t, st.maxRest);
    const rec = F.recency(f, t).map((r) => `<div class="stat-row"><i class="sw" style="background:${F.GROUP_COLOR[r.id]}"></i><span>${r.label}</span><b class="${r.days === null ? '' : r.days >= 7 ? 'warn' : 'sec'}">${r.days === null ? 'Not yet' : r.days === 0 ? 'Today' : r.days === 1 ? 'Yesterday' : r.days + ' days ago'}</b></div>`).join('');
    const monthName = new Date(cm + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return `<div class="month"><button class="icon" data-act="fPrev" aria-label="Previous month">${svg('prev')}</button><b>${monthName}</b><button class="icon" data-act="fNext" aria-label="Next month">${svg('next')}</button></div>
      <div class="card"><div class="cal fx-cal">${cells}</div><div class="legend">${legend}</div><div class="muted" style="margin-top:12px">Coloured dots show which muscles you trained. Tap a day for the details.</div></div>
      <div class="card"><h2>${monthName.split(' ')[0]} so far</h2><div class="grid2 fx-stats"><div><b>${m.days}</b><span>Workout days</span></div><div><b>${m.sets}</b><span>Sets</span></div><div><b>${fmtNum(m.volume)}</b><span>Kg lifted</span></div><div><b>${mins}</b><span>Time</span></div></div></div>
      <div class="card"><div class="row between"><h2 style="margin:0">Streak</h2><button class="link" data-act="fGoSettings">Change</button></div>
        <div class="grid2 fx-stats" style="margin-top:12px"><div><b>${sk.current}</b><span>Current</span></div><div><b>${sk.best}</b><span>Best</span></div></div>
        <div class="muted" style="margin-top:10px">A streak only breaks after ${st.maxRest + 1} days in a row without a workout.</div></div>
      <div class="card"><h2>Last trained</h2>${rec}</div>`;
  }

  // ---------- Steps ----------
  function stepsView() {
    const f = S(), st = f.settings, t = today();
    const rows = F.lastDays(f, t, range);
    const week = F.lastDays(f, t, 7);
    const avg = Math.round(week.reduce((n, r) => n + r.steps, 0) / 7);
    const month = F.lastDays(f, t, 30);
    const best = month.reduce((b, r) => (r.steps > b.steps ? r : b), { steps: 0, date: '' });
    const hit = month.filter((r) => r.steps >= st.goal).length;
    const seg = (v) => `<button class="${range === v ? 'on' : ''}" data-act="fRange" data-v="${v}">${v} days</button>`;
    const note = isNative && info.known && info.supported && !info.granted ? '' : `<div class="muted" style="margin-top:12px;line-height:1.5">Distance and calories are estimates from your steps${st.height ? '' : '. Add your height and weight in Fitness settings to make them closer'}.</div>`;
    return `${stepsHero()}
      <div class="card"><div class="row between"><h2 style="margin:0">History</h2><div class="seg">${seg(7)}${seg(30)}</div></div><div class="fx-chart"><canvas id="fx-steps-chart"></canvas></div>
        <div class="muted" style="margin-top:6px">The dashed line is your goal of ${fmtNum(st.goal)} steps.</div></div>
      <div class="card"><h2>Numbers</h2><div class="grid2 fx-stats"><div><b>${fmtNum(avg)}</b><span>Average, 7 days</span></div><div><b>${fmtNum(best.steps)}</b><span>Best day, 30 days</span></div><div><b>${hit}</b><span>Goal days, 30 days</span></div><div><b>${F.goalStreak(f, t, st.goal)}</b><span>Goal streak</span></div></div>${note}</div>
      <button class="btn alt" data-act="fGoSettings">Fitness settings</button>`;
  }

  function drawRoutine(Chart, charts) {
    const cv = $('fx-routine-chart');
    const r = routineById(rv.id);
    if (!cv || !r) return;
    const pts = F.routineSeries(S(), r.id, rv.metric, sinceDate());
    const fmtD = (d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    charts.push(new Chart(cv, {
      type: 'line',
      data: { labels: pts.map((x) => fmtD(x.date)), datasets: [{ data: pts.map((x) => x.v), borderColor: '#3b82f6', borderWidth: 2.5, tension: 0.3, fill: true, backgroundColor: 'rgba(59,130,246,0.14)', pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#3b82f6', pointBorderColor: '#000', pointBorderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animations: { colors: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(20,20,20,0.95)', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, bodyColor: '#bfdbfe', displayColors: false, padding: 10, callbacks: { title: () => '', label: (it) => metricText(rv.metric, it.parsed.y) } } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5, color: 'rgba(255,255,255,0.5)' } },
          y: { beginAtZero: false, grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false }, ticks: { maxTicksLimit: 4, callback: (v) => (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : v), color: 'rgba(255,255,255,0.4)' } },
        },
      },
    }));
  }

  function draw(Chart, charts, h) {
    drawRoutine(Chart, charts);
    const cv = $('fx-steps-chart');
    if (!cv) return;
    const f = S(), goal = f.settings.goal;
    const rows = F.lastDays(f, today(), range);
    const labels = rows.map((r) => (range === 7 ? new Date(r.date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short' }) : String(+r.date.slice(8))));
    // the goal is a dashed line drawn after the bars (a line dataset next to bars made Chart.js's animation fail)
    const goalLine = {
      id: 'goalLine',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const y = scales.y.getPixelForValue(goal);
        if (!chartArea || y < chartArea.top || y > chartArea.bottom) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.restore();
      },
    };
    const top = Math.max(goal, ...rows.map((r) => r.steps));
    charts.push(new Chart(cv, {
      type: 'bar',
      plugins: [goalLine],
      data: { labels, datasets: [
        { data: rows.map((r) => r.steps), borderRadius: 5, borderSkipped: false, barPercentage: range === 7 ? 0.6 : 0.8, categoryPercentage: 1, backgroundColor: (x) => h.gradient(x, '#60a5fa', '#1d4ed8') },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        // Chart.js sometimes throws while it animates between two canvas gradients; the bars still grow, only their colour does not tween
        animations: { colors: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(20,20,20,0.95)', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, bodyColor: '#bfdbfe', displayColors: false, padding: 10, callbacks: { title: () => '', label: (it) => `${fmtNum(it.parsed.y)} steps` } } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: range === 7 ? 7 : 10, color: 'rgba(255,255,255,0.5)' } },
          y: { beginAtZero: true, suggestedMax: Math.round(top * 1.12), grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false }, ticks: { callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v), color: 'rgba(255,255,255,0.4)' } },
        },
      },
    }));
  }

  // ---------- Settings ----------
  function settingsView() {
    const st = S().settings;
    const allMedia = Object.values(S().media || {}).flat();
    const mediaCount = allMedia.length, mediaBytes = allMedia.reduce((n, m) => n + m.size, 0);
    const chips = (key, values, fmt = (v) => v) => `<div class="chips wrap" style="margin:10px 0 0">${values.map((v) => `<button class="${st[key] === v ? 'on' : ''}" data-act="fPick1" data-k="${key}" data-v="${v}">${fmt(v)}</button>`).join('')}</div>`;
    const row = (label, sub, value, act) => `<div class="set-row"><div class="grow"><b>${label}</b><span>${sub}</span></div><button class="capsule set" style="margin:0" data-act="${act}"><span>${value}</span></button></div>`;
    return `<div class="card"><h2>Steps</h2>
        ${row('Daily goal', 'The line your steps are measured against', fmtNum(st.goal), 'fGoal')}
        ${row('Height', 'Makes distance a bit more accurate', st.height ? st.height + ' cm' : 'Add', 'fHeight')}
        ${row('Weight', 'Used for the calories estimate', st.weight ? st.weight + ' kg' : 'Add', 'fWeight')}</div>
      <div class="card"><h2>Workouts</h2>
        <div class="set-row" style="display:block"><b>Rest timer</b><span>Starts when you tick a set</span>${chips('restSec', F.REST_CHOICES, (v) => (v < 120 ? v + 's' : v / 60 + ' min'))}</div>
        <div class="set-row" style="display:block"><b>Workouts per week</b><span>Your weekly target</span>${chips('weekGoal', [1, 2, 3, 4, 5, 6, 7])}</div>
        <div class="set-row" style="display:block"><b>Rest days allowed in a streak</b><span>Days in a row without training before the streak breaks</span>${chips('maxRest', [0, 1, 2, 3, 4], (v) => v)}</div></div>
      <div class="card"><h2>Reminder</h2>
        <div class="set-row"><div class="grow"><b>Workout reminder</b><span>Nudges you each day you have not trained yet</span></div><button class="switch ${st.remindOn ? 'on' : ''}" role="switch" aria-checked="${st.remindOn}" aria-label="Workout reminder" data-act="fRemindToggle"><i></i></button></div>
        ${st.remindOn ? row('Reminder time', 'Every day at', fmtTime(st.remindAt), 'fRemindTime') : ''}</div>
      <div class="card"><h2>Form videos and photos</h2><div class="muted" style="line-height:1.5">${mediaCount ? `${pl(mediaCount, 'file')} · ${media.fmtSize(mediaBytes)} on this phone.` : 'None yet. Add them from an exercise: Form video and photos.'} They are stored on this phone only and are <b>not</b> inside a backup file, so keep your own copy of the ones that matter.</div></div>
      <div class="muted" style="line-height:1.5">Workouts and steps are saved on this phone and are part of your backup (Life mode, Settings).</div>`;
  }

  // ---------- timers on screen ----------
  function tick() {
    const a = S().active;
    const els = document.querySelectorAll('[data-elapsed]');
    if (!a || !els.length) { clearInterval(ticker); ticker = 0; return; }
    const txt = elapsedText(a);
    els.forEach((el) => { el.textContent = txt; });
    const slot = $('fx-rest-slot');
    if (!slot) return;
    const left = F.restLeft(a, Date.now());
    if (left) {
      const t = $('fx-rest-t');
      if (t) t.textContent = F.clock(left); else slot.innerHTML = restBar(left);
    } else if (slot.firstChild) {
      slot.innerHTML = '';
      if (lastRest) buzz('ok');
    }
    lastRest = left;
  }

  function afterRender() {
    clearInterval(ticker);
    ticker = 0;
    if (S().active && document.querySelector('[data-elapsed]')) {
      lastRest = F.restLeft(S().active, Date.now());
      ticker = setInterval(tick, 1000);
    }
  }

  // ---------- exercise picker ----------
  function pickList() {
    const f = S();
    const have = new Set((pick.target === 'active' ? (f.active ? f.active.items : []) : rt ? rt.items : []).map((i) => i.ex));
    const row = (e) => `<div class="item tap" data-act="fPickEx" data-id="${esc(e.id)}"><div class="grow"><div>${esc(e.name)}</div><div class="muted">${esc(F.muscleLabel(e.muscle))} · ${esc(e.equip)}</div></div>${have.has(e.id) ? '<span class="tag">Added</span>' : '<span class="plus">+</span>'}</div>`;
    const filtering = pick.q.trim() || pick.eq !== 'all' || pick.mu !== 'all';
    const list = F.filterExercises(f, pick);
    const shown = list.slice(0, pick.limit);
    let html = '';
    if (!filtering) {
      const recent = F.recentExercises(f, 8);
      if (recent.length) html += `<div class="label" style="margin:4px 0 6px">Recent exercises</div>${recent.map(row).join('')}`;
      html += `<div class="label" style="margin:16px 0 6px">All exercises</div>`;
    } else {
      html += `<div class="label" style="margin:4px 0 6px">${plural(list.length)}</div>`;
    }
    html += shown.length ? shown.map(row).join('') : '<div class="muted" style="padding:12px 0;line-height:1.5">Nothing matches. Tap Create, choose the muscle group and add it yourself.</div>';
    if (list.length > shown.length) html += `<button class="btn alt" style="margin-top:12px" data-act="fPickMore">Show more (${fmtNum(list.length - shown.length)} left)</button>`;
    return html;
  }

  function pickerSheet() {
    if (pick.view !== 'list') { filterSheet(pick.view, 'pick'); return; }
    setSheet(`<div class="pk-bar"><button class="link" data-act="fPickDone">Done</button><b>Add exercise</b><button class="link" data-act="fCustom" data-id="">Create</button></div>
      <input id="fx-q" type="search" placeholder="Search exercise" value="${esc(pick.q)}" autocomplete="off">
      ${filterButtons('pick', pick)}<div class="fx-pick" id="fx-pick-list">${pickList()}</div>`);
  }

  function openPicker(target) { pick = { target, q: '', eq: 'all', mu: 'all', limit: 120, view: 'list' }; pickerSheet(); }

  // Muscle group (Upper Body / Lower Body / Other) and Equipment sheets. One tap picks, another tap clears, "Show N results" goes back.
  function filterSheet(kind, ctx) {
    const st = ctx === 'pick' ? pick : lib;
    const count = F.filterExercises(S(), st).length;
    const tile = (id, label, on, dotColor) => `<button class="mtile ${on ? 'on' : ''}" data-act="fFilterSet" data-kind="${kind}" data-ctx="${ctx}" data-v="${esc(id)}">${dotColor ? `<i style="background:${dotColor}"></i>` : ''}${esc(label)}</button>`;
    const body = kind === 'muscle'
      ? MUSCLE_SECTIONS.map(([title, ids]) => `<div class="label" style="margin:14px 0 8px">${title}</div><div class="mtiles">${ids.map((id) => tile(id, F.muscleLabel(id), st.mu === id, F.GROUP_COLOR[F.groupOf(id)])).join('')}</div>`).join('')
      : `<div class="mtiles" style="margin-top:12px">${EQUIPMENT.map((x) => tile(x, x, st.eq === x)).join('')}</div>`;
    setSheet(`<div class="pk-bar"><button class="link" data-act="fFilterBack" data-ctx="${ctx}">Back</button><b>${kind === 'muscle' ? 'Muscle group' : 'Equipment'}</b><span></span></div>
      <div class="fx-pick tall">${body}</div>
      <div class="grid2" style="margin-top:12px"><button class="btn alt" data-act="fFilterClear" data-kind="${kind}" data-ctx="${ctx}">Clear filter</button><button class="btn" data-act="fFilterBack" data-ctx="${ctx}">Show ${plural(count)}</button></div>`);
  }

  // Create exercise: a name and its muscle group are all it needs
  function customSheet(id) {
    const e = id ? S().exercises.find((x) => x.id === id) : null;
    cxMuscle = e ? e.muscle : pick && pick.mu !== 'all' ? pick.mu : lib.mu !== 'all' ? lib.mu : 'chest';
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const tiles = MUSCLE_SECTIONS.map(([title, ids]) => `<div class="label" style="margin:12px 0 6px">${title}</div><div class="mtiles">${ids.map((m) => `<button class="mtile ${m === cxMuscle ? 'on' : ''}" data-act="fCxMuscle" data-v="${m}"><i style="background:${F.GROUP_COLOR[F.groupOf(m)]}"></i>${esc(F.muscleLabel(m))}</button>`).join('')}</div>`).join('');
    setSheet(`<div class="pk-bar"><button class="link" data-act="fCustomBack">Cancel</button><b>${e ? 'Edit exercise' : 'Create exercise'}</b><button class="link" data-act="fCustomSave" data-id="${e ? esc(e.id) : ''}">Save</button></div>
      <input id="cx-name" type="text" maxlength="40" placeholder="Exercise name" value="${esc(e ? e.name : pick ? pick.q : lib.q)}" autocomplete="off">
      <div class="label" style="margin:2px 0 0">Muscle group</div><div id="cx-tiles">${tiles}</div>
      <div class="label" style="margin:12px 0 6px">Equipment</div><select id="cx-equip">${opt(EQUIPMENT.map((x) => [x, x]), e ? e.equip : 'Other')}</select>
      <div class="label" style="margin:2px 0 6px">What you log</div><select id="cx-kind">${opt(KINDS, e ? e.kind : 'wr')}</select>
      ${e ? `<button class="btn danger" style="margin-top:6px" data-act="fCustomDel" data-id="${esc(e.id)}">Delete exercise</button>` : ''}`);
  }

  // ---------- form videos and photos (stay on the phone) ----------
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/*,image/*';
  fileInput.hidden = true;
  fileInput.id = 'fx-file';
  document.body.appendChild(fileInput);

  function formSheet(exId) {
    fm.ex = exId;
    const f = S();
    const e = F.exOf(f, exId) || { name: 'Exercise' };
    const list = F.mediaOf(f, exId);
    if (!list.some((m) => m.id === fm.sel)) fm.sel = list.length ? list[0].id : '';
    const cur = list.find((m) => m.id === fm.sel);
    const busy = fm.busy >= 0;
    setSheet(`<h2>${esc(e.name)}</h2><div class="muted" style="margin:-8px 0 12px;line-height:1.5">Your own videos and photos of the correct form. They stay on this phone. Short clips work best: up to ${media.fmtSize(media.MAX_BYTES)} each.</div>
      <div class="fm-view" id="fm-view">${cur ? '<div class="fm-empty">Loading…</div>' : '<div class="fm-empty">Nothing added yet.<br>Add a video or a photo and it plays right here, in the middle of your workout.</div>'}</div>
      ${busy ? `<div class="bar" style="margin:10px 0"><div id="fm-bar" style="width:${Math.round(fm.busy * 100)}%"></div></div><div class="muted" style="margin-bottom:10px">Saving to your phone…</div>` : ''}
      ${list.length ? `<div class="fm-list">${list.map((m) => `<button class="fm-item ${m.id === fm.sel ? 'on' : ''}" data-act="fMediaOpen" data-id="${esc(m.id)}">${svg(m.k === 'video' ? 'play' : 'camera')}<span>${esc(m.n || (m.k === 'video' ? 'Video' : 'Photo'))}</span><em>${media.fmtSize(m.size)}</em></button>`).join('')}</div>` : ''}
      <button class="btn" data-act="fMediaAdd" ${busy || list.length >= F.MAX_MEDIA ? 'disabled' : ''}>+ Add video or photo</button>
      ${list.length >= F.MAX_MEDIA ? `<div class="muted" style="margin-top:8px">${F.MAX_MEDIA} is the most for one exercise. Delete one to add another.</div>` : ''}
      ${cur ? `<button class="btn danger" style="margin-top:10px" data-act="fMediaDel" data-id="${esc(cur.id)}">Delete this ${cur.k}</button>` : ''}
      <button class="btn alt" style="margin-top:10px" data-act="fClose">Close</button>`);
    if (cur) showMedia(cur);
  }

  async function showMedia(m) {
    const url = await media.mediaUrl(m);
    const box = $('fm-view');
    if (!box || fm.sel !== m.id) return;
    box.innerHTML = !url
      ? '<div class="fm-empty">This file is not on the phone any more (a restored backup does not carry videos and photos). Delete it and add it again.</div>'
      : m.k === 'video' ? `<video src="${esc(url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(url)}" alt="${esc(m.n)}">`;
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file || !fm.ex) return;
    const k = media.kindOf(file);
    if (!k) { ui.alert('Choose a video or a photo.'); return; }
    if (file.size > media.MAX_BYTES) { ui.alert(`That file is ${media.fmtSize(file.size)}. The most is ${media.fmtSize(media.MAX_BYTES)}. Trim the video or pick a shorter one.`, 'Too big'); return; }
    const f = S();
    const exId = fm.ex;
    if (F.mediaOf(f, exId).length >= F.MAX_MEDIA) return;
    const id = db.uid(), x = media.extOf(file);
    fm.busy = 0;
    formSheet(exId);
    try {
      await media.saveMedia(file, id, x, (p) => { fm.busy = p; const bar = $('fm-bar'); if (bar) bar.style.width = Math.round(p * 100) + '%'; });
    } catch (e) {
      fm.busy = -1;
      if ($('fm-view')) formSheet(exId);
      ui.alert('The file could not be saved on the phone. Check that there is free space and try again.', 'Not saved');
      return;
    }
    (f.media[exId] = f.media[exId] || []).push({ id, k, n: String(file.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60), x, size: file.size, t: Date.now() });
    fm.sel = id;
    fm.busy = -1;
    await db.save();
    if ($('fm-view')) formSheet(exId);
    render();
  });

  // ---------- details ----------
  function sessionSheet(s) {
    const f = S();
    const g = F.sessionGroups(s);
    const items = s.items.map((it) => {
      const e = F.itemInfo(f, it);
      return `<div class="fx-detail"><b>${esc(e.name)}</b><div class="muted">${it.sets.map((x) => `${F.SET_MARK[x.t] ? `<em>${F.SET_MARK[x.t]}</em> ` : ''}${esc(F.setText(it.k, x))}`).join('  ·  ')}</div></div>`;
    }).join('');
    const time = new Date(s.start).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    setSheet(`<h2>${esc(s.name)}</h2><div class="muted" style="margin:-8px 0 12px">${esc(dayName(s.date))} · ${time} · ${F.sessionMinutes(s)} min</div>
      <div class="muted" style="margin-bottom:12px">${gdots(g)} ${esc(gnames(g))}${F.sessionVolume(s) ? ` · ${fmtNum(F.sessionVolume(s))} kg lifted` : ''}</div>
      ${items}${s.note ? `<div class="why">${esc(s.note)}</div>` : ''}
      <button class="btn" style="margin-top:14px" data-act="fRepeat" data-id="${esc(s.id)}">Do this workout again</button>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="fClose">Close</button><button class="btn danger" data-act="fDelSession" data-id="${esc(s.id)}">Delete</button></div>`);
  }

  function daySheet(date) {
    const list = F.sessionsByDay(S())[date] || [];
    if (list.length === 1) { sessionSheet(list[0]); return; }
    const body = list.length ? list.map(sessionRow).join('') : '<div class="muted" style="padding:6px 0 14px">No workout on this day.</div>';
    setSheet(`<h2>${esc(dayName(date))}</h2>${body}<button class="btn alt" data-act="fClose">Close</button>`);
  }

  function exerciseSheet(e) {
    const f = S();
    const hist = F.sortedSessions(f).reverse().map((s) => ({ s, it: s.items.find((i) => i.ex === e.id) })).filter((x) => x.it);
    let best = '';
    if (hist.length) {
      const all = hist.flatMap((x) => x.it.sets.filter((y) => y.t !== 'w'));
      const top = all.length ? all.reduce((b, y) => (e.kind === 'wr' || e.kind === 'bw' ? (y.kg > b.kg || (y.kg === b.kg && y.reps > b.reps) ? y : b) : y.reps > b.reps ? y : b)) : null;
      if (top) best = `<div class="muted" style="margin:-8px 0 12px">${e.kind === 'wr' ? 'Heaviest' : 'Best'}: ${esc(F.setText(e.kind, top))}</div>`;
    }
    const rows = hist.slice(0, 8).map(({ s, it }) => `<div class="fx-detail"><b>${esc(dayName(s.date))}</b><div class="muted">${it.sets.map((x) => `${F.SET_MARK[x.t] ? `<em>${F.SET_MARK[x.t]}</em> ` : ''}${esc(F.setText(it.k, x))}`).join('  ·  ')}</div></div>`).join('');
    setSheet(`<h2>${esc(e.name)}</h2><div class="muted" style="margin:-8px 0 12px">${esc(F.muscleLabel(e.muscle))} · ${esc(e.equip)}</div>${best}
      ${rows || '<div class="muted" style="padding:6px 0 14px">You have not logged this exercise yet.</div>'}
      <button class="btn alt fm-open" data-act="fForm" data-ex="${esc(e.id)}">${svg('play')}Form video and photos${F.mediaOf(f, e.id).length ? ` (${F.mediaOf(f, e.id).length})` : ''}</button>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="fClose">Close</button>${e.custom ? `<button class="btn" data-act="fCustomLib" data-id="${esc(e.id)}">Edit</button>` : ''}</div>`);
  }

  function finishSheet() {
    const a = S().active;
    const done = F.doneCount(a), total = F.totalSets(a);
    const fin = F.finishActive(a, Date.now());
    const left = total - done;
    setSheet(`<h2>Finish workout</h2>
      <div class="aw-stats" style="margin:4px 0 14px"><div><span>Duration</span><b>${elapsedText(a)}</b></div><div><span>Volume</span><b>${fmtNum(fin ? F.sessionVolume(fin) : 0)} kg</b></div><div><span>Sets</span><b>${done}</b></div></div>
      <input id="fx-name" type="text" maxlength="40" value="${esc(a.name)}" placeholder="Workout name" autocomplete="off">
      <textarea id="fx-note" rows="2" maxlength="300" placeholder="Notes (optional)">${esc(a.note)}</textarea>
      ${left > 0 ? `<div class="muted" style="margin-bottom:12px">${left} set${left === 1 ? ' is' : 's are'} not ticked and will not be saved.</div>` : ''}
      <div class="grid2"><button class="btn alt" data-act="fClose">Keep going</button><button class="btn" data-act="fFinishSave">Save</button></div>`);
  }

  // ---------- helpers for actions ----------
  const activeItem = (el) => { const a = S().active; return a ? a.items[+el.dataset.i] : null; };
  const startWorkout = async (routine) => {
    const f = S();
    if (f.active) { openTab('fwork'); return; }
    f.active = F.startActive(f, routine, Date.now(), db.uid());
    await db.save();
    openTab('fwork');
    buzz('tick');
    if (!f.active.items.length) openPicker('active');
  };

  // ---------- actions ----------
  const actions = {
    fSub: (el) => { sub = el.dataset.v; histLimit = 30; render(); },
    fMoreHist: () => { histLimit += 30; render(); },
    fLibMore: () => { lib.limit += 120; render(); },
    fPickMore: () => { pick.limit += 120; const list = $('fx-pick-list'); if (list) { const y = list.scrollTop; list.innerHTML = pickList(); list.scrollTop = y; } },
    fFilter: (el) => { if (el.dataset.ctx === 'pick') pick.view = el.dataset.kind; filterSheet(el.dataset.kind, el.dataset.ctx); },
    fFilterSet: (el) => {
      const st = el.dataset.ctx === 'pick' ? pick : lib;
      const key = el.dataset.kind === 'muscle' ? 'mu' : 'eq';
      st[key] = st[key] === el.dataset.v ? 'all' : el.dataset.v;
      st.limit = 120;
      filterSheet(el.dataset.kind, el.dataset.ctx);
    },
    fFilterClear: (el) => {
      const st = el.dataset.ctx === 'pick' ? pick : lib;
      st[el.dataset.kind === 'muscle' ? 'mu' : 'eq'] = 'all';
      st.limit = 120;
      filterSheet(el.dataset.kind, el.dataset.ctx);
    },
    fFilterBack: (el) => {
      if (el.dataset.ctx === 'pick') { pick.view = 'list'; pickerSheet(); } else { closeModal(); render(); }
    },
    fCxMuscle: (el) => {
      cxMuscle = el.dataset.v;
      document.querySelectorAll('#cx-tiles .mtile').forEach((b) => b.classList.toggle('on', b.dataset.v === cxMuscle));
    },
    fForm: (el) => formSheet(el.dataset.ex),
    fMediaOpen: (el) => { fm.sel = el.dataset.id; formSheet(fm.ex); },
    fMediaAdd: () => { if (fm.ex && fm.busy < 0) fileInput.click(); },
    fMediaDel: async (el) => {
      const f = S();
      const list = f.media[fm.ex] || [];
      const m = list.find((x) => x.id === el.dataset.id);
      if (!m) return;
      if (!(await ui.confirm(`This ${m.k} is removed from the phone for good.`, { title: 'Delete it?', ok: 'Delete', danger: true }))) return;
      await media.deleteMedia(m);
      f.media[fm.ex] = list.filter((x) => x.id !== m.id);
      if (!f.media[fm.ex].length) delete f.media[fm.ex];
      fm.sel = '';
      await db.save();
      formSheet(fm.ex);
      render();
    },
    fPrev: () => { const [y, m] = cm.split('-').map(Number); const dt = new Date(y, m - 2, 1); cm = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; render('fade'); },
    fNext: () => { const [y, m] = cm.split('-').map(Number); const dt = new Date(y, m, 1); cm = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; render('fade'); },
    fRange: (el) => { range = Number(el.dataset.v) === 30 ? 30 : 7; render(); },
    fGoSettings: () => openTab('fset'),
    fClose: () => closeModal(),
    fAskSteps: () => askSteps(),
    fDay: (el) => daySheet(el.dataset.date),
    fSession: (el) => { const s = S().sessions.find((x) => x.id === el.dataset.id); if (s) sessionSheet(s); },
    fExDetail: (el) => { const e = exInfo(el.dataset.id); if (e) exerciseSheet(e); },

    // starting and finishing
    fStart: (el) => startWorkout(el.dataset.id ? S().routines.find((r) => r.id === el.dataset.id) : null),
    fRepeat: (el) => {
      const s = S().sessions.find((x) => x.id === el.dataset.id);
      if (!s) return;
      closeModal();
      startWorkout({ id: s.routineId, name: s.name, items: s.items.map((it) => { const w = it.sets.filter((x) => x.t !== 'w'); return { ex: it.ex, n: it.n, m: it.m, k: it.k, rest: -1, sets: (w.length ? w : it.sets).map((x) => ({ kg: x.kg, reps: x.reps })) }; }) });
    },
    fRename: async () => {
      const a = S().active;
      if (!a) return;
      const v = await ui.text('Workout name', a.name, 'e.g. Chest day');
      if (v && v.trim()) { a.name = v.trim().slice(0, 40); commit(); }
    },
    fFinish: () => { if (S().active) finishSheet(); },
    fFinishSave: async () => {
      const f = S(), a = f.active;
      if (!a) return;
      a.name = ($('fx-name').value || '').trim().slice(0, 40) || a.name;
      a.note = ($('fx-note').value || '').trim().slice(0, 300);
      const fin = F.finishActive(a, Date.now());
      if (!fin) {
        closeModal();
        if (await ui.confirm('No sets are ticked, so there is nothing to save. Discard this workout?', { title: 'Nothing done yet', ok: 'Discard', danger: true })) { f.active = null; await flush(); commit(); syncNotifications(); }
        return;
      }
      const updates = F.routineUpdates(f, a);
      const routineId = a.routineId;
      f.sessions.push(fin);
      f.active = null;
      closeModal();
      buzz('ok');
      await flush();
      commit();
      syncNotifications();
      const medals = fin.items.reduce((n, it) => n + it.sets.filter((x) => x.pr).length, 0);
      ui.note(`Workout saved · ${F.sessionMinutes(fin)} min · ${pl(F.sessionSets(fin), 'set')}${F.sessionVolume(fin) ? ' · ' + fmtNum(F.sessionVolume(fin)) + ' kg' : ''}${medals ? ` · ${pl(medals, 'medal')}` : ''}`);
      if (updates.length) {
        const yes = await ui.confirm(`${pl(updates.length, 'exercise')} ${updates.length === 1 ? 'is' : 'are'} different from the routine plan. Use today's sets and weights as the new plan?`, { title: 'Update routine?', ok: 'Update' });
        if (yes) { F.applyRoutineUpdates(f, routineId, updates); commit(); }
      }
    },
    fDiscard: async () => {
      if (!(await ui.confirm('This deletes the workout you are doing now.', { title: 'Discard workout?', ok: 'Discard', danger: true }))) return;
      S().active = null;
      await flush();
      commit();
      syncNotifications();
    },

    // sets
    fTick: (el) => {
      const f = S(), a = f.active, it = activeItem(el);
      const s = it && it.sets[+el.dataset.j];
      if (!s) return;
      if (!s.done) {
        if (!F.validSet(it.k, s)) { buzz('warn'); ui.note(F.hasWeight(it.k) ? 'Enter the reps (and weight) first' : 'Enter the number first'); return; }
        const better = F.betterThanLast(f, a, it, s);
        s.done = true;
        const rest = F.restFor(f, it);
        a.restUntil = rest > 0 ? Date.now() + rest * 1000 : 0;
        if (better) {
          s.pr = true;
          const name = F.itemInfo(f, it).name;
          const w = F.hasWeight(it.k);
          celebrate(name, better.kind === 'weight' ? `Heavier than last time · ${F.trim(s.kg)} kg × ${F.trim(s.reps)}` : w ? `More reps than last time · ${F.trim(s.reps)} reps at ${F.trim(s.kg)} kg` : `More than last time · ${F.trim(s.reps)} ${F.UNIT[it.k]}`);
          buzz('ok');
        } else {
          delete s.pr;
          buzz('tick');
        }
      } else {
        s.done = false;
        delete s.pr;
      }
      flush();
      commit();
      syncNotifications();
    },
    fSetType: (el) => {
      const it = activeItem(el);
      const s = it && it.sets[+el.dataset.j];
      if (!s) return;
      const order = F.SET_TYPES.map((x) => x[0]);
      s.t = order[(order.indexOf(s.t) + 1) % order.length];
      buzz('tick');
      commit();
    },
    fAddSet: (el) => {
      const it = activeItem(el);
      if (!it || it.sets.length >= 40) return;
      const last = it.sets[it.sets.length - 1];
      it.sets.push({ kg: last ? last.kg : 0, reps: last ? last.reps : 0, t: 'n', done: false });
      commit();
    },
    delFSet: (el) => {
      const it = activeItem(el);
      const j = +el.dataset.j;
      if (!it || !it.sets[j]) return;
      const removed = it.sets.splice(j, 1)[0];
      commit();
      ui.undo('Set removed', () => { it.sets.splice(j, 0, removed); commit(); });
    },
    fRest: (el) => {
      const a = S().active;
      if (!a) return;
      const v = Number(el.dataset.v);
      a.restUntil = v === 0 ? 0 : Math.max(Date.now() + 1000, a.restUntil + v * 1000);
      flush();
      render();
      syncNotifications();
    },

    // exercises inside the running workout
    fAddEx: () => openPicker('active'),
    fExMenu: (el) => {
      const a = S().active, i = +el.dataset.i, it = a && a.items[i];
      if (!it) return;
      const e = F.itemInfo(S(), it);
      setSheet(`<h2>${esc(e.name)}</h2>
        <button class="btn alt" data-act="fExHist" data-id="${esc(it.ex)}">See history</button>
        <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="fExMove" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>Move up</button><button class="btn alt" data-act="fExMove" data-i="${i}" data-d="1" ${i === a.items.length - 1 ? 'disabled' : ''}>Move down</button></div>
        <button class="btn danger" style="margin-top:10px" data-act="fExRemove" data-i="${i}">Remove from workout</button>
        <button class="btn alt" style="margin-top:10px" data-act="fClose">Close</button>`);
    },
    fExHist: (el) => { const e = exInfo(el.dataset.id); if (e) exerciseSheet(e); else closeModal(); },
    fExMove: (el) => {
      const a = S().active, i = +el.dataset.i, j = i + Number(el.dataset.d);
      if (!a || !a.items[i] || !a.items[j]) return;
      [a.items[i], a.items[j]] = [a.items[j], a.items[i]];
      closeModal();
      commit();
    },
    fExRemove: (el) => {
      const a = S().active, i = +el.dataset.i;
      if (!a || !a.items[i]) return;
      const removed = a.items.splice(i, 1)[0];
      closeModal();
      commit();
      ui.undo('Exercise removed', () => { a.items.splice(i, 0, removed); commit(); });
    },

    // picker and custom exercises
    fPickEx: (el) => {
      const e = exInfo(el.dataset.id);
      if (!e || !pick) return;
      const f = S();
      if (pick.target === 'active') {
        if (!f.active || !F.addExerciseTo(f, f.active, e)) return;
        flush();
        db.save();
        render();
      } else if (rt) {
        if (rt.items.some((i) => i.ex === e.id)) return;
        rt.items.push(F.newRoutineItem(f, e));
        rtDirty = true;
      }
      buzz('tick');
      const list = $('fx-pick-list');
      if (list) { const y = list.scrollTop; list.innerHTML = pickList(); list.scrollTop = y; }
    },
    fPickDone: () => { const t = pick && pick.target; pick = null; closeModal(); if (t === 'routine') render(); },
    fCustom: (el) => customSheet(el.dataset.id || ''),
    // from the library or an exercise page, so there is no picker to return to
    fCustomLib: (el) => { pick = null; customSheet(el.dataset.id || ''); },
    fCustomBack: () => { if (pick) pickerSheet(); else closeModal(); },
    fCustomSave: async (el) => {
      const f = S();
      const name = ($('cx-name').value || '').trim().slice(0, 40);
      if (name.length < 2) { ui.alert('Give the exercise a name of at least 2 letters.'); return; }
      const dup = F.allExercises(f).some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== el.dataset.id);
      if (dup) { ui.alert('An exercise with this name already exists.'); return; }
      const data = { name, muscle: cxMuscle, equip: $('cx-equip').value, kind: $('cx-kind').value };
      const old = el.dataset.id ? f.exercises.find((x) => x.id === el.dataset.id) : null;
      let saved;
      if (old) { Object.assign(old, data); saved = old; } else { saved = { id: 'c:' + db.uid(), ...data, custom: true }; f.exercises.push(saved); }
      await db.save();
      if (pick) { pick.q = ''; pickerSheet(); if (!old) actions.fPickEx({ dataset: { id: saved.id } }); } else { closeModal(); render(); }
    },
    fCustomDel: async (el) => {
      const f = S();
      const e = f.exercises.find((x) => x.id === el.dataset.id);
      if (!e) return;
      if (!(await ui.confirm('Your past workouts keep this exercise. It just leaves the library.', { title: 'Delete exercise?', ok: 'Delete', danger: true }))) return;
      const i = f.exercises.indexOf(e);
      f.exercises.splice(i, 1);
      closeModal();
      commit();
      ui.undo('Exercise deleted', () => { f.exercises.splice(i, 0, e); commit(); });
    },

    // routines
    fGo: async (el) => {
      if (rt && rtDirty && !(await ui.confirm('You changed this routine and have not saved it.', { title: 'Discard changes?', ok: 'Discard', danger: true }))) return;
      rt = null;
      rtDirty = false;
      openTab(el.dataset.tab);
    },
    fOpenRoutine: (el) => { rv.id = el.dataset.id; openTab('frout'); },
    fRvRange: (el) => { rv.months = Number(el.dataset.v); render(); },
    fRvMetric: (el) => { rv.metric = el.dataset.v; render(); },
    fExplore: () => exploreSheet(),
    fAddStarter: (el) => {
      const f = S();
      const [name, list] = STARTERS[+el.dataset.i] || [];
      if (!name || f.routines.some((r) => r.name.toLowerCase() === name.toLowerCase())) return;
      const items = list.map(([n, sets, reps]) => { const e = BUILTIN.find((x) => x.name === n); return e ? { ...F.snapshot(e), rest: -1, sets: Array.from({ length: sets }, () => ({ kg: 0, reps })) } : null; }).filter(Boolean);
      f.routines.push({ id: db.uid(), name, items });
      db.save();
      render();
      exploreSheet();
    },
    fRMenu: (el) => {
      const r = routineById(el.dataset.id);
      if (!r) return;
      setSheet(`<h2>${esc(r.name)}</h2>
        <button class="btn" data-act="fOpenRoutineClose" data-id="${esc(r.id)}">Open</button>
        <button class="btn alt" style="margin-top:10px" data-act="fEditRoutineClose" data-id="${esc(r.id)}">Edit routine</button>
        <button class="btn alt" style="margin-top:10px" data-act="fDupRoutine" data-id="${esc(r.id)}">Duplicate</button>
        <button class="btn danger" style="margin-top:10px" data-act="fDelRoutine" data-id="${esc(r.id)}">Delete</button>
        <button class="btn alt" style="margin-top:10px" data-act="fClose">Close</button>`);
    },
    fOpenRoutineClose: (el) => { closeModal(); actions.fOpenRoutine(el); },
    fEditRoutineClose: (el) => { closeModal(); actions.fEditRoutine(el); },
    fDupRoutine: (el) => {
      const f = S();
      const r = routineById(el.dataset.id);
      if (!r) return;
      f.routines.push({ id: db.uid(), name: (r.name + ' copy').slice(0, 40), items: r.items.map((i) => ({ ...i, sets: F.planOf(i).map((x) => ({ ...x })) })) });
      closeModal();
      commit();
    },
    fDelRoutine: (el) => {
      const f = S();
      const r = routineById(el.dataset.id);
      if (!r) return;
      const i = f.routines.indexOf(r);
      f.routines.splice(i, 1);
      closeModal();
      commit();
      ui.undo('Routine deleted', () => { f.routines.splice(i, 0, r); commit(); });
    },
    fEditRoutine: (el) => {
      const r = el.dataset.id ? routineById(el.dataset.id) : null;
      rt = r ? { id: r.id, name: r.name, items: r.items.map((i) => ({ ...i, sets: F.planOf(i).map((x) => ({ ...x })) })) } : { id: '', name: '', items: [] };
      rtDirty = false;
      openTab('fredit');
    },
    fRtAdd: () => openPicker('routine'),
    fRtAddSet: (el) => {
      const it = rt && rt.items[+el.dataset.i];
      if (!it || it.sets.length >= F.MAX_SETS) return;
      const last = it.sets[it.sets.length - 1];
      it.sets.push({ kg: last ? last.kg : 0, reps: last ? last.reps : 0 });
      rtDirty = true;
      render();
    },
    fRtDelSet: (el) => {
      const it = rt && rt.items[+el.dataset.i];
      if (!it || it.sets.length <= 1) { ui.note('A routine exercise needs at least one set'); return; }
      it.sets.splice(+el.dataset.j, 1);
      rtDirty = true;
      render();
    },
    fRtMove: (el) => {
      const i = +el.dataset.i, j = i + Number(el.dataset.d);
      if (!rt || !rt.items[i] || !rt.items[j]) return;
      [rt.items[i], rt.items[j]] = [rt.items[j], rt.items[i]];
      rtDirty = true;
      render();
    },
    fRtDel: (el) => { if (rt) { rt.items.splice(+el.dataset.i, 1); rtDirty = true; render(); } },
    fRtCancel: (el) => actions.fGo({ dataset: { tab: rt && rt.id ? 'frout' : 'fwork' } }),
    fRtSave: async () => {
      const f = S();
      const name = (rt.name || '').trim();
      if (name.length < 2) { ui.alert('Give the routine a name, like Chest + Triceps.'); return; }
      if (!rt.items.length) { ui.alert('Add at least one exercise.'); return; }
      const items = rt.items.map((i) => ({ ...i, sets: i.sets.slice(0, F.MAX_SETS).map((x) => ({ kg: Number(x.kg) || 0, reps: Number(x.reps) || 0 })) }));
      let id = rt.id;
      if (id) { const r = routineById(id); if (r) { r.name = name.slice(0, 40); r.items = items; } } else { id = db.uid(); f.routines.push({ id, name: name.slice(0, 40), items }); }
      const was = rt.id;
      rt = null;
      rtDirty = false;
      await db.save();
      if (was) { rv.id = id; openTab('frout'); } else { sub = 'routines'; openTab('fwork'); }
      queueMicrotask(() => ui.note('Routine saved'));
      syncNotifications();
    },
    fRtRemove: async () => {
      const f = S();
      const r = routineById(rt && rt.id);
      if (!r) return;
      const i = f.routines.indexOf(r);
      f.routines.splice(i, 1);
      rt = null;
      rtDirty = false;
      await db.save();
      openTab('fwork');
      ui.undo('Routine deleted', () => { f.routines.splice(i, 0, r); commit(); });
    },

    // rest timer per exercise, and a note
    fRestPick: (el) => restSheet(el.dataset.where, +el.dataset.i),
    fRestSet: (el) => {
      const where = el.dataset.where, i = +el.dataset.i, v = Number(el.dataset.v);
      const it = where === 'rt' ? rt && rt.items[i] : S().active && S().active.items[i];
      if (!it) return;
      it.rest = v;
      if (where === 'rt') rtDirty = true;
      closeModal();
      if (where === 'rt') render(); else commit();
    },
    fNote: (el) => noteSheet(+el.dataset.i),
    fNoteSave: (el) => {
      const a = S().active, it = a && a.items[+el.dataset.i];
      if (!it) return;
      it.note = ($('fx-itnote').value || '').trim().slice(0, 200);
      closeModal();
      commit();
    },

    // history
    fDelSession: (el) => {
      const f = S();
      const i = f.sessions.findIndex((x) => x.id === el.dataset.id);
      if (i < 0) return;
      const s = f.sessions.splice(i, 1)[0];
      closeModal();
      commit();
      syncNotifications();
      ui.undo('Workout deleted', () => { f.sessions.splice(Math.min(i, f.sessions.length), 0, s); commit(); syncNotifications(); });
    },

    // settings
    fPick1: (el) => { const k = el.dataset.k; if (k in S().settings) { S().settings[k] = Number(el.dataset.v); commit(); } },
    fGoal: async () => { const v = Number(await ui.prompt('Daily step goal', S().settings.goal, 'e.g. 8000')); if (v >= 500 && v <= 100000) { S().settings.goal = Math.round(v); commit(); } },
    fHeight: async () => { const v = Number(await ui.prompt('Your height (cm)', S().settings.height || '', 'e.g. 172')); if (v >= 100 && v <= 250) { S().settings.height = Math.round(v); commit(); } },
    fWeight: async () => { const v = Number(await ui.prompt('Your weight (kg)', S().settings.weight || '', 'e.g. 70')); if (v >= 20 && v <= 300) { S().settings.weight = Math.round(v * 10) / 10; commit(); } },
    fRemindToggle: () => { const st = S().settings; st.remindOn = !st.remindOn; commit(); syncNotifications(); },
    fRemindTime: async () => {
      const st = S().settings;
      const v = await pickTime({ value: st.remindAt, title: 'Workout reminder', allowNone: false, presets: [['06:00', '6 AM'], ['07:00', '7 AM'], ['17:00', '5 PM'], ['18:00', '6 PM'], ['19:00', '7 PM'], ['20:00', '8 PM']] });
      if (v) { st.remindAt = v; commit(); syncNotifications(); }
    },
  };

  // typing: set fields, routine fields, searches
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.f) {
      const a = S().active;
      const s = a && a.items[+t.dataset.i] && a.items[+t.dataset.i].sets[+t.dataset.j];
      if (!s) return;
      const v = parseFloat(String(t.value).replace(',', '.'));
      s[t.dataset.f] = Number.isFinite(v) && v > 0 ? Math.min(v, t.dataset.f === 'kg' ? 1000 : 9999) : 0;
      if (s.done) { if (F.betterThanLast(S(), a, a.items[+t.dataset.i], s)) s.pr = true; else delete s.pr; }
      saveSoon();
    } else if (t.dataset.rt && rt && rt.items[+t.dataset.i] && rt.items[+t.dataset.i].sets[+t.dataset.j]) {
      const v = parseFloat(String(t.value).replace(',', '.'));
      rt.items[+t.dataset.i].sets[+t.dataset.j][t.dataset.rt] = Number.isFinite(v) && v > 0 ? Math.min(v, t.dataset.rt === 'kg' ? 1000 : 9999) : 0;
      rtDirty = true;
    } else if (t.id === 'rt-name' && rt) {
      rt.name = t.value;
      rtDirty = true;
    } else if (t.id === 'fx-q' && pick) {
      pick.q = t.value;
      pick.limit = 120;
      const list = $('fx-pick-list');
      if (list) list.innerHTML = pickList();
    } else if (t.id === 'fx-lq') {
      lib.q = t.value;
      lib.limit = 120;
      const box = $('fx-lib');
      if (box) box.innerHTML = libraryList();
      const cnt = $('fx-lib-count');
      if (cnt) cnt.textContent = plural(F.filterExercises(S(), lib).length);
    }
  });
  // a tapped number field selects its text, so a prefilled weight is replaced by typing
  document.addEventListener('focusin', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('fx-in')) setTimeout(() => { try { t.select(); } catch (err) { /* ignore */ } }, 0); });

  return {
    actions,
    today: todayView,
    work: workView,
    cal: calView,
    steps: stepsView,
    settings: settingsView,
    routine: routineView,
    edit: editView,
    mini: miniBar,
    // header title and the page the back arrow returns to, for the pages that are not tabs
    title: (t) => (t === 'frout' ? (routineById(rv.id) || { name: 'Routine' }).name : t === 'fredit' ? (rt && rt.id ? 'Edit routine' : 'New routine') : 'Fitness settings'),
    backOf: (t) => (t === 'frout' ? 'fwork' : t === 'fredit' ? (rt && rt.id ? 'frout' : 'fwork') : 'fhome'),
    draw,
    afterRender,
    sync,
    flush,
    badge: () => !!S().active,
    getInfo: () => info,
    // used by tests and by the dashboard later
    _state: () => ({ sub, cm, range, pick, rt }),
  };
}
