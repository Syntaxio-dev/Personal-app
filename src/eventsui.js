// Calendar events UI (Attendance page): the Events card, the markers on the calendar, the day-sheet list, the add/edit sheet,
// the dashboard lines and the Indian festivals import.
import * as db from './db.js';
import { today, dayName, addDays, daysBetween } from './dates.js';
import * as EV from './events.js';

const PLACEHOLDER = {
  birthday: 'Whose birthday?',
  festival: 'Festival name',
  exam: 'Exam name, e.g. Maths',
  event: 'Event name',
};

export function createEvents(d) {
  const { ui, closeModal, setSheet, commit, esc, dot, svg, pickTime, fmtTime, syncNotifications, buzz, httpGet, getYm } = d;
  const S = () => db.get();
  let draft = null;
  let view = 'month'; // the Events card shows 'month' (the month on the calendar) or 'soon' (the next 3 months)
  let imp = null;     // the festival import sheet: { items: [{ date, title, observance, on }], obs }

  const monthTitle = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

  // ---------- pieces shown on the Attendance page ----------
  // tiny coloured dots in the corner of a calendar day (at most 3)
  const markers = (list) => (list && list.length
    ? `<u class="evd" aria-hidden="true">${list.slice(0, 3).map((e) => `<s style="background:${EV.KIND_COLOR[e.kind]}"></s>`).join('')}</u>` : '');

  const legend = () => `<div class="legend" style="margin-top:8px">${EV.KINDS.map(([, l, c]) => `<span>${dot(c)}${l}</span>`).join('')}</div>`;

  const meta = (ev, date) => `${EV.KIND_LABEL[ev.kind]} · ${esc(dayName(date))}${ev.time ? ` · ${esc(fmtTime(ev.time))}` : ''}${ev.repeat && ev.repeat !== 'none' && ev.kind !== 'birthday' ? ` · ${EV.REPEAT_LABEL[ev.repeat]}` : ''}`;

  // one event as a row: tap = edit, trash = delete (with Undo). The note (for an exam: practical, topics...) shows under it.
  const row = (ev, date, right, from = '') => `<div class="item tap" data-act="evEdit" data-id="${esc(ev.id)}" data-from="${from}">${dot(EV.KIND_COLOR[ev.kind])}
    <div class="grow"><div>${esc(ev.title)}</div><div class="muted">${meta(ev, date)}</div>${ev.note ? `<div class="muted" style="color:var(--t2)">${esc(ev.note)}</div>` : ''}</div>
    ${right ? `<span class="muted" style="white-space:nowrap">${esc(right)}</span>` : ''}
    <button class="icon" data-act="evEdit" data-id="${esc(ev.id)}" data-from="${from}" aria-label="Edit">${svg('edit')}</button>
    <button class="icon" data-act="evDel" data-id="${esc(ev.id)}" data-from="${from}" aria-label="Delete">${svg('trash')}</button></div>`;

  function card() {
    const t = today(), ym = getYm();
    const seg = (k, l) => `<button class="${view === k ? 'on' : ''}" data-act="evView" data-v="${k}">${l}</button>`;
    let rows;
    if (view === 'month') {
      rows = EV.monthList(S(), ym).map(({ ev, date }) => { const left = daysBetween(t, date); return row(ev, date, left >= 0 ? EV.leftFor(ev, left) : ''); }).join('')
        || `<div class="muted" style="line-height:1.5;margin-top:6px">No events in ${esc(monthTitle(ym))}.</div>`;
    } else {
      rows = EV.upcoming(S(), t, 90, 12).map(({ ev, date, left }) => row(ev, date, EV.leftFor(ev, left))).join('')
        || '<div class="muted" style="line-height:1.5;margin-top:6px">Nothing coming up in the next 3 months. Add a birthday, a festival or an exam and Prysm will remind you.</div>';
    }
    return `<div class="card"><div class="row between"><h2 style="margin:0">Events</h2><button class="btn sm" data-act="evAdd">+ Add event</button></div>
      <div class="seg" style="margin:12px 0 4px">${seg('month', esc(monthTitle(ym)))}${seg('soon', 'Coming up')}</div>
      ${rows}
      <div class="muted" style="margin-top:10px;line-height:1.5">Dates changed? Tap an event to edit it, or the bin to delete it.</div>
      <button class="btn alt" style="margin-top:12px" data-act="evImport">Import Indian festivals</button></div>`;
  }

  // the block inside the day sheet
  function dayBlock(date) {
    const list = EV.eventsOn(S(), date);
    return `<span class="label" style="margin-top:18px">Events</span>${list.map((ev) => row(ev, date, ev.time ? fmtTime(ev.time) : '', 'day')).join('') || '<div class="muted" style="margin-bottom:8px">No events on this day.</div>'}
      <button class="btn alt" style="margin-top:8px" data-act="evAdd" data-date="${date}" data-from="day">+ Add event</button>`;
  }

  // On a festival the office may be closed, or not. Prysm only reminds, it never marks the day by itself.
  function festivalHint(date) {
    const fest = EV.eventsOn(S(), date).filter((e) => e.kind === 'festival');
    if (!fest.length) return '';
    return `<div class="banner">${dot(EV.KIND_COLOR.festival)}<div><b>${esc(fest.map((e) => e.title).join(', '))}</b><span>It is a festival today. If your office is closed, mark it as Holiday. If you work or take a half-day, mark it as usual.</span></div></div>`;
  }

  // two short lines for the dashboard: the next exam (counting down) and the next other event
  function dashLines() {
    return EV.dashLines(S(), today()).map(({ ev, date, left }) => `<div class="drow"><div class="grow"><div class="t-title">${dot(EV.KIND_COLOR[ev.kind])} ${esc(ev.title)}</div><div class="t-meta">${esc(ev.note || EV.KIND_LABEL[ev.kind])} · ${esc(dayName(date))}</div></div><span class="ptag">${esc(EV.leftFor(ev, left))}</span></div>`).join('');
  }

  // ---------- the add / edit sheet ----------
  const switchBtn = (id, on, label, act) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}"><i></i></button>`;

  const reminderText = () => {
    if (!draft.remind) return 'No reminders for this event.';
    const t = draft.time, tail = t ? `, and again at ${fmtTime(t)}` : '';
    const day = `at ${fmtTime(EV.REMIND.day)} on the day${tail}`;
    if (draft.repeat === 'week') return `You get a reminder ${day}, every week.`;
    if (draft.repeat === 'month') return `You get a reminder 1 day before at ${fmtTime(EV.REMIND.early)}, ${day}.`;
    return `You get a reminder 3 days before and 1 day before at ${fmtTime(EV.REMIND.early)}, ${day}.`;
  };

  function paint() {
    const kind = draft.kind;
    const own = EV.hasOwnTime(kind), preset = EV.remindIsPreset(kind);
    document.querySelectorAll('#ev-kinds [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === kind));
    const cap = document.getElementById('ev-time');
    if (cap) { cap.classList.toggle('set', !!draft.time); cap.querySelector('span').textContent = draft.time ? fmtTime(draft.time) : 'No fixed time'; }
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
    show('ev-trow', own);                       // a fixed time only makes sense for an exam or an event
    show('ev-yinfo', kind === 'birthday');      // a birthday repeats by itself
    show('ev-yrow', kind !== 'birthday');
    show('ev-rrow', !preset);                   // reminders are a setting for exams and events only
    show('ev-rinfo', preset);
    const ri = document.getElementById('ev-rinfo');
    if (ri) ri.textContent = EV.presetText(kind);
    document.querySelectorAll('#ev-repeat [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.repeat));
    [['ev-remind', draft.remind]].forEach(([id, on]) => {
      const b = document.getElementById(id);
      if (b) { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    });
    const r = document.getElementById('ev-rtext');
    if (r) r.textContent = reminderText();
    const title = document.getElementById('ev-title');
    if (title) title.placeholder = PLACEHOLDER[kind] || 'Event name';
    const nl = document.getElementById('ev-nlabel');
    if (nl) nl.textContent = kind === 'exam' ? 'Exam details' : 'Note (optional)';
    const note = document.getElementById('ev-note');
    if (note) note.placeholder = kind === 'exam' ? 'e.g. Practical, Chapters 1 to 4, Room 12' : 'Anything to remember';
    const dl = document.getElementById('ev-dlabel');
    if (dl) dl.textContent = kind === 'birthday' ? 'Birthday date' : 'Date';
  }

  function form({ id = '', date = today(), from = '' } = {}) {
    const old = id ? S().events.find((e) => e.id === id) : null;
    draft = old ? { ...old, from } : { id: '', title: '', kind: 'event', date, time: '', repeat: 'none', remind: true, note: '', from };
    setSheet(`<h2>${old ? 'Edit event' : 'New event'}</h2>
      <span class="label">Type</span>
      <div class="chips wrap" id="ev-kinds">${EV.KINDS.map(([k, l, c]) => `<button data-act="evKind" data-v="${k}">${dot(c)}${l}</button>`).join('')}</div>
      <input id="ev-title" maxlength="80" value="${esc(draft.title)}" autocomplete="off">
      <span class="label" id="ev-dlabel">Date</span><input id="ev-date" type="date" value="${esc(draft.date)}">
      <div id="ev-trow"><span class="label">Time (optional)</span><button class="capsule" id="ev-time" data-act="evTime">${svg('clock')}<span>No fixed time</span></button></div>
      <span class="label" id="ev-nlabel">Note (optional)</span><input id="ev-note" maxlength="200" value="${esc(draft.note)}" autocomplete="off">
      <div class="set-row" id="ev-yinfo" hidden><div class="grow"><b>Repeats every year</b><span>A birthday comes on the same day each year, so there is nothing to set</span></div></div>
      <div id="ev-yrow"><span class="label">Repeat</span><div class="chips wrap" id="ev-repeat">${EV.REPEATS.map(([k, l]) => `<button data-act="evRepeat" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="muted" style="margin:-4px 0 12px;line-height:1.5">Every week keeps the same weekday, every month the same date, every year the same day. Leave it on Never for a one-off or a date that moves.</div></div>
      <div class="set-row" id="ev-rrow"><div class="grow"><b>Remind me</b><span id="ev-rtext"></span></div>${switchBtn('ev-remind', draft.remind, 'Remind me', 'evRemind')}</div>
      <div class="muted" id="ev-rinfo" style="margin:10px 0;line-height:1.5" hidden></div>
      <div class="grid2" style="margin-top:14px">${old ? '<button class="btn danger" data-act="evDelete">Delete</button>' : '<button class="btn alt" data-act="evCancel">Cancel</button>'}<button class="btn" data-act="evSave">Save</button></div>`);
    paint();
    if (!old) setTimeout(() => { const t = document.getElementById('ev-title'); if (t) t.focus(); }, 80);
  }

  const readFields = () => {
    const v = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
    draft.title = v('ev-title').trim();
    draft.date = v('ev-date');
    draft.note = v('ev-note').trim();
  };

  // delete one event and offer Undo; `from` = 'day' keeps the day sheet open and refreshed
  async function remove(id, from, date) {
    const list = S().events;
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) { if (from !== 'day') closeModal(); return; }
    const [item] = list.splice(i, 1);
    buzz('warn');
    if (from !== 'day') closeModal();
    await commit();
    syncNotifications();
    if (from === 'day') d.backToDay(date || item.date);
    ui.undo('Event deleted', async () => {
      const l = S().events;
      l.splice(Math.min(i, l.length), 0, item);
      await commit();
      syncNotifications();
      // the day sheet is still open: show the restored event in it too
      const m = document.getElementById('modal');
      if (from === 'day' && m && !m.hidden) d.backToDay(date || item.date);
    });
  }

  // ---------- Indian festivals (one public calendar file, fetched when the user taps the button) ----------
  function impSheet() {
    const shown = imp.items.map((it, i) => ({ it, i })).filter(({ it }) => !it.observance || imp.obs);
    const hidden = imp.items.filter((it) => it.observance).length;
    const n = imp.items.filter((it) => it.on && (!it.observance || imp.obs)).length;
    setSheet(`<h2>Indian festivals</h2>
      <div class="muted" style="margin:-8px 0 12px;line-height:1.5">The next 12 months, from Google's public "Holidays in India" calendar. Prysm downloads that one file and nothing about you is sent. Untick what you do not want. What you already added is skipped.</div>
      <div class="app-list" id="ev-implist">${shown.map(({ it, i }) => `<button class="app-pick ${it.on ? 'on' : ''}" data-act="evImpTick" data-i="${i}"><span class="grow" style="flex:1;min-width:0;text-align:left">${esc(it.title)}<small>${esc(dayName(it.date))}${it.observance ? ' · observance' : ''}</small></span><i class="tick"></i></button>`).join('') || '<div class="muted" style="padding:14px 0">Nothing new to add.</div>'}</div>
      ${hidden ? `<button class="link" style="margin-top:8px" data-act="evImpObs">${imp.obs ? 'Hide observances' : `Show ${hidden} more observances (Navratri days, jayantis, small festivals)`}</button>` : ''}
      <div class="grid2" style="margin-top:14px"><button class="btn alt" data-act="closeModal">Cancel</button><button class="btn" id="ev-impadd" data-act="evImpAdd" ${n ? '' : 'disabled'}>Add ${n} festival${n === 1 ? '' : 's'}</button></div>`);
  }

  async function importOpen() {
    setSheet('<h2>Indian festivals</h2><div class="muted" style="line-height:1.5">Getting the list…</div>');
    let text = '';
    try { text = await httpGet(EV.FESTIVAL_URL); } catch (e) { text = ''; }
    const m = document.getElementById('modal');
    if (!m || m.hidden) return; // the sheet was closed while waiting
    if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) {
      setSheet('<h2>Indian festivals</h2><div class="muted" style="line-height:1.5;margin-bottom:14px">Could not get the list. Check your internet and try again.</div><button class="btn" data-act="evImport">Try again</button><button class="btn alt" style="margin-top:10px" data-act="closeModal">Close</button>');
      return;
    }
    const t = today();
    const cand = EV.festivalCandidates(EV.parseIcs(text), S(), t, addDays(t, 365));
    // public holidays are ticked, small observances are left unticked and hidden so the calendar stays calm
    imp = { items: cand.map((c) => ({ ...c, on: !c.observance })), obs: false };
    impSheet();
  }

  const actions = {
    evAdd: (el) => form({ date: el.dataset.date || today(), from: el.dataset.from || '' }),
    evEdit: (el) => form({ id: el.dataset.id, from: el.dataset.from || '' }),
    evDel: (el) => remove(el.dataset.id, el.dataset.from || '', ''),
    evView: (el) => { view = el.dataset.v === 'soon' ? 'soon' : 'month'; d.render(); },
    evKind: (el) => {
      readFields();
      const prev = draft.kind;
      draft.kind = el.dataset.v;
      if (draft.kind === 'birthday') draft.repeat = 'year';
      else if (prev === 'birthday') draft.repeat = 'none'; // leaving "birthday": it no longer repeats by itself
      if (EV.remindIsPreset(draft.kind)) draft.remind = true;
      if (!EV.hasOwnTime(draft.kind)) draft.time = '';
      paint();
    },
    evTime: async () => {
      readFields();
      const v = await pickTime({ value: draft.time, title: 'Event time' });
      if (v === null) return;
      draft.time = v;
      paint();
    },
    evRepeat: (el) => { draft.repeat = el.dataset.v; paint(); },
    evRemind: () => { draft.remind = !draft.remind; paint(); },
    evCancel: () => { if (draft && draft.from === 'day') d.backToDay(draft.date); else closeModal(); },
    evSave: async () => {
      readFields();
      if (!draft.title) return ui.alert('Give the event a name.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return ui.alert('Pick a date for the event.');
      const list = S().events;
      const kind = draft.kind;
      const rec = {
        id: draft.id || db.uid(), title: draft.title.slice(0, 80), date: draft.date, kind,
        time: EV.hasOwnTime(kind) ? draft.time : '', repeat: kind === 'birthday' ? 'year' : draft.repeat, yearly: (kind === 'birthday' ? 'year' : draft.repeat) === 'year',
        remind: EV.remindIsPreset(kind) ? true : draft.remind, note: draft.note.slice(0, 200),
      };
      const i = list.findIndex((e) => e.id === rec.id);
      if (i >= 0) list[i] = rec;
      else if (list.length >= EV.MAX_EVENTS) return ui.alert('That is a lot of events. Delete some old ones first.');
      else list.push(rec);
      buzz('ok');
      const back = draft.from === 'day';
      if (!back) closeModal();
      await commit();
      syncNotifications();
      if (back) d.backToDay(rec.date); // the sheet is swapped in place, not closed and reopened
    },
    evDelete: () => remove(draft.id, draft.from, draft.date),

    evImport: () => importOpen(),
    evImpTick: (el) => {
      const it = imp && imp.items[Number(el.dataset.i)];
      if (!it) return;
      it.on = !it.on;
      el.classList.toggle('on', it.on); // in place, so the list keeps its scroll position
      const n = imp.items.filter((x) => x.on && (!x.observance || imp.obs)).length;
      const b = document.getElementById('ev-impadd');
      if (b) { b.textContent = `Add ${n} festival${n === 1 ? '' : 's'}`; b.disabled = !n; }
    },
    evImpObs: () => { imp.obs = !imp.obs; impSheet(); },
    evImpAdd: async () => {
      if (!imp) return;
      const list = S().events;
      const room = Math.max(0, EV.MAX_EVENTS - list.length);
      const picked = imp.items.filter((x) => x.on && (!x.observance || imp.obs)).slice(0, room);
      picked.forEach((x) => list.push({ id: db.uid(), title: x.title, date: x.date, kind: 'festival', time: '', repeat: 'none', yearly: false, remind: true, note: x.observance ? 'Observance' : '' }));
      imp = null;
      closeModal();
      await commit();
      syncNotifications();
      ui.note(`${picked.length} festival${picked.length === 1 ? '' : 's'} added`);
    },
  };

  return { card, dayBlock, festivalHint, dashLines, markers, legend, actions, monthMap: (ym) => EV.monthMap(S(), ym) };
}
