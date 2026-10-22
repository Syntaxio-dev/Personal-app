import * as db from './db.js';
import { today, addDays, dayName } from './dates.js';
import * as G from './goals.js';

const VERDICTS = [['achieved', 'Achieved'], ['partial', 'Partly'], ['missed', 'Missed']];
const VERDICT_LABEL = { achieved: 'Achieved', partial: 'Partly', missed: 'Missed' };
const VERDICT_COLOR = { achieved: '#4ade80', partial: '#fbbf24', missed: '#f87171' };
const DREAM_DEADLINES = [['year', 'This year'], ['1y', 'In 1 year'], ['3y', 'In 3 years'], ['5y', 'In 5 years'], ['custom', 'Pick date']];
const MIN_REASON = 10;

// The Goals tab: Goals | Bucket list | Journal, plus the mandatory review that blocks the app when a period ends.
export function createGoals(d) {
  const { ui, openModal, closeModal, commit, esc, svg, dot, syncNotifications, openTaskForm } = d;
  const S = () => db.get();
  const $ = (id) => document.getElementById(id);
  let tab = 'goals';
  let horizon = 'week';
  let catFilter = 'all';
  let jMode = 'week';
  let md = {};
  let rv = null; // the review being answered: { q: [...], i, cur, dr }

  const refresh = async () => { await commit(); syncNotifications(); };
  const goal = (id) => S().goals.find((g) => g.id === id);
  const dream = (id) => S().bucket.find((b) => b.id === id);

  const chipRow = (g, items, selected, act = 'gChip') => `<div class="chips wrap" id="g-${g}">${items.map(([v, l]) => `<button class="${v === selected ? 'on' : ''}" data-act="${act}" data-g="${g}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const setSheet = (html) => {
    const sheet = document.querySelector('#modal .sheet');
    if (sheet && !$('modal').hidden) sheet.innerHTML = html; else openModal(html);
  };
  const emptyBox = (title, text) => `<div class="empty"><div class="empty-ic">${svg('goals')}</div><b>${title}</b><span>${text}</span></div>`;

  // ---------- views ----------
  function view() {
    const tabs = `<div class="chips subtabs scroll">${[['goals', 'Goals'], ['bucket', 'Bucket list'], ['journal', 'Journal']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="gTab" data-v="${k}">${l}</button>`).join('')}</div>`;
    return tabs + (tab === 'bucket' ? bucketView() : tab === 'journal' ? journalView() : goalsView());
  }

  function quickButtons(g) {
    if (g.kind === 'yesno') return G.progressOf(g) ? `<button class="pill ghost" data-act="gUndo" data-id="${g.id}">Undo</button>` : `<button class="pill" data-act="gDone" data-id="${g.id}">Mark done</button>`;
    if (g.kind === 'count') return `<button class="pill" data-act="gPlus" data-id="${g.id}">+1</button><button class="pill ghost" data-act="gLog" data-id="${g.id}">Log</button>`;
    return `<button class="pill" data-act="gLog" data-id="${g.id}">Update</button>`;
  }

  function goalCard(g) {
    const pct = G.percentOf(g);
    return `<div class="card goal" data-act="openGoal" data-id="${g.id}">
      <div class="row between"><b class="m-title">${esc(g.title)}</b><span class="tag">${esc(G.periodLabel(g))}</span></div>
      ${g.why ? `<div class="why">${esc(g.why)}</div>` : ''}
      <div class="bar" style="margin-top:14px"><div style="width:${pct}%"></div></div>
      <div class="row between" style="margin-top:8px"><span class="sec">${esc(G.progressText(g))}</span><span class="muted">${G.daysLeftLabel(g)}</span></div>
      <div class="row" style="margin-top:14px;gap:8px">${quickButtons(g)}<button class="link" style="margin-left:auto" data-act="gStep" data-id="${g.id}">Add step</button></div></div>`;
  }

  function goalsView() {
    const s = S(), t = today();
    const stale = G.staleGoals(s, t).map((g) => `<div class="card attn"><div class="label">Still relevant?</div><div class="m-title" style="margin:8px 0 4px">${esc(g.title)}</div><div class="muted">No progress for 30+ days.</div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="pill" data-act="gKeep" data-id="${g.id}">Keep</button><button class="pill ghost" data-act="gEdit" data-id="${g.id}">Make smaller</button><button class="pill ghost" data-act="gDrop" data-id="${g.id}">Drop</button></div></div>`).join('');
    const chips = `<div class="chips subtabs scroll">${G.HORIZONS.map(([k, l]) => { const n = s.goals.filter((g) => !g.review && g.horizon === k).length; return `<button class="${horizon === k ? 'on' : ''}" data-act="gHorizon" data-v="${k}">${l}${n ? `<i>${n}</i>` : ''}</button>`; }).join('')}</div>`;
    const list = s.goals.filter((g) => !g.review && g.horizon === horizon).sort((a, b) => a.end.localeCompare(b.end));
    const body = list.length ? list.map(goalCard).join('') : emptyBox('Nothing here yet', 'Set a goal for this time frame. You will be asked how it went when time is up.');
    return `<button class="btn" data-act="addGoal">+ New goal</button>${stale}${chips}${body}`;
  }

  function goalSheet(id) {
    const g = goal(id);
    if (!g) return;
    const entries = [...g.progress].sort((a, b) => b.date.localeCompare(a.date)).map((e) => `<div class="log-row"><div class="log-top"><b>${g.kind === 'yesno' ? 'Marked done' : g.kind === 'count' ? '+' + e.amount : e.amount}${g.kind !== 'yesno' && g.unit ? ' ' + esc(g.unit) : ''}</b><span>${dayName(e.date)}</span></div>${e.note ? `<div class="log-res">${esc(e.note)}</div>` : ''}
      <button class="icon" style="float:right;margin-top:-30px" data-act="gDelEntry" data-id="${g.id}" data-eid="${e.id}" aria-label="Delete entry">${svg('trash')}</button></div>`).join('') || '<div class="muted">No progress logged yet.</div>';
    setSheet(`<div data-sheet="goal" data-id="${g.id}"><h2>${esc(g.title)}</h2><div class="muted" style="margin:-8px 0 12px">${esc(G.periodLabel(g))} · ${G.daysLeftLabel(g)}</div>
      ${g.why ? `<div class="why" style="margin-bottom:14px">${esc(g.why)}</div>` : ''}
      <div class="bar"><div style="width:${G.percentOf(g)}%"></div></div>
      <div class="sec" style="margin:10px 0 16px">${esc(G.progressText(g))}</div>
      <div class="row" style="gap:8px;margin-bottom:12px">${quickButtons(g)}</div>
      <div class="grid2"><button class="btn alt" data-act="gStep" data-id="${g.id}">Add step</button><button class="btn alt" data-act="gEdit" data-id="${g.id}">Edit</button></div>
      <div class="label" style="margin:18px 0 6px">Progress log</div><div class="log-list">${entries}</div>
      <button class="btn danger" style="margin-top:14px" data-act="gDelete" data-id="${g.id}">Delete goal</button></div>`);
  }

  // ---------- bucket list ----------
  function featured() {
    const s = S(), m = today().slice(0, 7);
    const open = s.bucket.filter((b) => b.status === 'open');
    if (!open.length) return null;
    const cur = s.settings.dreamPick;
    if (cur && cur.month === m) { const it = open.find((b) => b.id === cur.id); if (it) return it; }
    const pick = [...open].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.touched.localeCompare(b.touched))[0];
    s.settings.dreamPick = { month: m, id: pick.id };
    return pick;
  }

  const pill = (b) => { const c = G.dreamCountdown(b); return `<span class="cd ${c.tone}">${esc(c.text)}</span>`; };

  function dreamRow(b) {
    return `<div class="mrow" style="--k:${b.status === 'done' ? '#4ade80' : '#a78bfa'}" data-act="openDream" data-id="${b.id}"><div class="grow"><div class="m-title">${esc(b.title)}</div>
      <div class="m-sub">${esc(b.cat)}${b.deadline ? ' · by ' + dayName(b.deadline) : ''}${b.cost ? ' · ~₹' + Math.round(b.cost).toLocaleString('en-IN') : ''}</div></div>
      <div class="m-right">${b.status === 'open' ? pill(b) : `<span class="good m-sub">${b.status === 'done' ? 'Done' : 'Dropped'}</span>`}</div></div>`;
  }

  function bucketView() {
    const s = S(), t = today();
    const open = s.bucket.filter((b) => b.status === 'open');
    const done = s.bucket.filter((b) => b.status === 'done');
    const dropped = s.bucket.filter((b) => b.status === 'dropped');
    const feat = featured();
    const stale = G.staleDreams(s, t).slice(0, 2).map((b) => `<div class="card attn"><div class="label">Still want this?</div><div class="m-title" style="margin:8px 0 4px">${esc(b.title)}</div><div class="muted">Untouched for 90+ days.</div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="pill" data-act="dKeep" data-id="${b.id}">Keep</button><button class="pill ghost" data-act="dEdit" data-id="${b.id}">Edit</button><button class="pill ghost" data-act="dreamDrop" data-id="${b.id}">Drop</button></div></div>`).join('');
    const cats = ['all', ...new Set(open.map((b) => b.cat))];
    const chips = cats.length > 2 ? `<div class="chips scroll">${cats.map((c) => `<button class="${catFilter === c ? 'on' : ''}" data-act="dCat" data-v="${esc(c)}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>` : '';
    const list = open.filter((b) => catFilter === 'all' || b.cat === catFilter).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const featCard = feat ? `<div class="card feat"><div class="label">Dream of the month</div><div class="m-title feat-t" style="margin:8px 0 6px" data-act="openDream" data-id="${feat.id}">${esc(feat.title)}</div><div class="row" style="gap:10px">${pill(feat)}<span class="muted">${esc(feat.cat)}</span></div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="pill" data-act="dreamStep" data-id="${feat.id}">Take a step</button><button class="pill ghost" data-act="dShuffle">Pick another</button></div></div>` : '';
    return `<button class="btn" data-act="addDream">+ Add a dream</button>${featCard}${stale}
      <div class="card"><div class="row between"><h2 style="margin:0">Progress</h2><b>${done.length} of ${open.length + done.length} done</b></div><div class="bar"><div style="width:${open.length + done.length ? (done.length / (open.length + done.length)) * 100 : 0}%"></div></div></div>
      ${chips}${list.length ? list.map(dreamRow).join('') : emptyBox('Your list is empty', 'Write down what you want to do before time runs out, and give each dream a date.')}
      ${done.length ? `<div class="day-head"><div><b>Done</b></div><i>${done.length}</i></div>${done.map(dreamRow).join('')}` : ''}
      ${dropped.length ? `<div class="day-head"><div><b>Dropped</b></div><i>${dropped.length}</i></div>${dropped.map(dreamRow).join('')}` : ''}`;
  }

  function dreamSheet(id) {
    const b = dream(id);
    if (!b) return;
    const moves = (b.moves || []).map((m) => `<div class="log-row"><div class="log-top"><b>Moved to ${dayName(m.to)}</b><span>${dayName(m.date)}</span></div><div class="log-res">${esc(m.reason)}</div></div>`).join('');
    setSheet(`<h2>${esc(b.title)}</h2><div class="muted" style="margin:-8px 0 14px">${esc(b.cat)}${b.deadline ? ' · by ' + dayName(b.deadline) : ''}${b.cost ? ' · about ₹' + Math.round(b.cost).toLocaleString('en-IN') : ''}</div>
      ${b.status === 'open' ? `<div style="margin-bottom:14px">${pill(b)}</div>` : ''}${b.note ? `<div class="why" style="margin-bottom:14px">${esc(b.note)}</div>` : ''}
      ${b.doneNote ? `<div class="why" style="margin-bottom:14px">Done: ${esc(b.doneNote)}</div>` : ''}${b.dropReason ? `<div class="why" style="margin-bottom:14px">Dropped: ${esc(b.dropReason)}</div>` : ''}
      ${b.status === 'open' ? `<div class="grid2"><button class="btn" data-act="dreamDone" data-id="${b.id}">Mark done</button><button class="btn alt" data-act="dreamMove" data-id="${b.id}">Move date</button></div>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="dreamStep" data-id="${b.id}">Take a step</button><button class="btn alt" data-act="dreamGoal" data-id="${b.id}">Make it a goal</button></div>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="dEdit" data-id="${b.id}">Edit</button><button class="btn danger" data-act="dreamDrop" data-id="${b.id}">Drop</button></div>` : ''}
      ${moves ? `<div class="label" style="margin:18px 0 6px">Date changes</div>${moves}` : ''}`);
  }

  // ---------- journal ----------
  function journalView() {
    const s = S(), t = today();
    const answered = s.goals.filter((g) => g.review).sort((a, b) => b.review.date.localeCompare(a.review.date));
    const counted = answered.filter((g) => !g.review.early);
    if (!answered.length) return emptyBox('No answers yet', 'When a goal\'s time ends you answer it here. Over time this shows what works for you and what keeps getting in the way.');
    const ach = counted.filter((g) => g.review.verdict === 'achieved').length;
    const pct = counted.length ? Math.round((ach / counted.length) * 100) : null;
    const streak = G.streakWeeks(s, t);
    const reasons = G.topReasons(s);
    const max = reasons.length ? reasons[0][1] : 1;
    const seg = (k, l) => `<button class="${jMode === k ? 'on' : ''}" data-act="jMode" data-v="${k}">${l}</button>`;
    const history = answered.map((g) => {
      const r = g.review;
      const label = r.early ? 'Dropped early' : VERDICT_LABEL[r.verdict];
      return `<div class="mrow" style="--k:${r.early ? '#8b8b95' : VERDICT_COLOR[r.verdict]}"><div class="grow"><div class="m-title">${esc(g.title)}</div>
        <div class="m-sub">${esc(G.periodLabel(g))} · ${label}${r.result !== null && r.result !== undefined ? ' · result ' + r.result + (g.unit ? ' ' + esc(g.unit) : '') : ''}</div>
        ${r.reason ? `<div class="why">“${esc(r.reason)}”</div>` : ''}${r.change ? `<div class="m-sub">Next time: ${esc(r.change)}</div>` : ''}</div></div>`;
    }).join('');
    return `<div class="card"><div class="label">Goals achieved</div><div class="num" style="margin:8px 0 10px">${pct === null ? '—' : pct + '%'}</div><div class="bar"><div style="width:${pct || 0}%"></div></div>
        <div class="muted" style="margin-top:12px">${ach} of ${counted.length} answered goals${streak ? ` · ${streak}-week streak with every goal hit` : ''}</div></div>
      <div class="card chart-card"><div class="row between"><h2 style="margin:0">Hit rate</h2><div class="seg">${seg('week', 'Weeks')}${seg('month', 'Months')}</div></div><div class="chart-box"><canvas id="j-chart"></canvas></div></div>
      ${reasons.length ? `<div class="card"><h2>What gets in the way</h2>${reasons.map(([k, n]) => `<div class="row between" style="margin-top:12px"><span>${esc(k)}</span><b>${n}</b></div><div class="bar"><div style="width:${(n / max) * 100}%"></div></div>`).join('')}</div>` : ''}
      <div class="day-head"><div><b>Your answers</b></div><i>${answered.length}</i></div>${history}`;
  }

  // ---------- goal form ----------
  const horizonName = { week: 'week', month: 'month', year: 'year' };
  function whenHtml() {
    if (md.horizon === 'long') return `<span class="label">Deadline</span><input id="g-end" type="date" min="${addDays(today(), 1)}">`;
    const n = horizonName[md.horizon];
    const p = G.periodFor(md.horizon, today(), md.when === 'next');
    return `${chipRow('when', [['this', `This ${n}`], ['next', `Next ${n}`]], md.when)}<div class="muted" style="margin:-4px 0 14px">${esc(G.periodLabel({ horizon: md.horizon, ...p }))}</div>`;
  }
  function kindHtml(g = null) {
    const unit = `<input id="g-unit" placeholder="Unit, e.g. kg, books, km (optional)" value="${g ? esc(g.unit || '') : ''}" autocomplete="off">`;
    if (md.kind === 'count') return `<input id="g-target" type="number" inputmode="decimal" placeholder="Target, e.g. 3" value="${g ? g.target : ''}">${unit}`;
    if (md.kind === 'value') return `<div class="grid2"><input id="g-from" type="number" inputmode="decimal" placeholder="Starting value" value="${g ? g.from : ''}"><input id="g-target" type="number" inputmode="decimal" placeholder="Target value" value="${g ? g.target : ''}"></div>${unit}`;
    return '';
  }
  const repeatHtml = () => (md.horizon === 'long' ? '' : `<span class="label">Repeat</span>${chipRow('repeat', [['no', 'Once'], ['yes', `Every ${horizonName[md.horizon]}`]], md.repeat)}`);

  function goalForm(edit = null) {
    md = edit ? { id: edit.id, horizon: edit.horizon, kind: edit.kind } : { id: '', horizon: 'week', when: 'this', kind: 'yesno', repeat: 'no' };
    openModal(`<h2>${edit ? 'Edit goal' : 'New goal'}</h2>
      <input id="g-title" placeholder="e.g. Lose 2 kg, read 3 books" value="${edit ? esc(edit.title) : ''}" autocomplete="off">
      ${edit ? '' : `<span class="label">Time frame</span>${chipRow('horizon', G.HORIZONS, md.horizon)}<div id="gz-when">${whenHtml()}</div>
      <span class="label">How will you measure it?</span>${chipRow('kind', [['yesno', 'Yes / No'], ['count', 'Count'], ['value', 'Number']], md.kind)}`}
      <div id="gz-kind">${kindHtml(edit)}</div>
      <input id="g-why" placeholder="Why does this matter to you? (optional)" value="${edit ? esc(edit.why || '') : ''}" autocomplete="off">
      ${edit ? '' : `<div id="gz-repeat">${repeatHtml()}</div>`}
      <button class="btn" data-act="saveGoal">Save goal</button>`);
  }

  // ---------- dream form ----------
  function dreamForm(edit = null) {
    md = { id: edit ? edit.id : '', cat: edit ? edit.cat : 'Experience', dl: 'year' };
    openModal(`<h2>${edit ? 'Edit dream' : 'New dream'}</h2>
      <input id="d-title" placeholder="e.g. See the northern lights" value="${edit ? esc(edit.title) : ''}" autocomplete="off">
      <span class="label">Category</span>${chipRow('cat', G.CATS.map((c) => [c, c]), md.cat)}
      ${edit ? '' : `<span class="label">Do it before</span>${chipRow('dl', DREAM_DEADLINES, md.dl)}<input id="d-date" type="date" min="${addDays(today(), 1)}" hidden>`}
      <input id="d-cost" type="number" inputmode="decimal" placeholder="About how much will it cost? ₹ (optional)" value="${edit && edit.cost ? edit.cost : ''}">
      <input id="d-note" placeholder="Why do you want this? (optional)" value="${edit ? esc(edit.note || '') : ''}" autocomplete="off">
      <button class="btn" data-act="saveDream">Save dream</button>`);
  }
  function deadlineFor(key) {
    const t = today();
    if (key === 'year') return `${t.slice(0, 4)}-12-31`;
    if (key === 'custom') return ($('d-date') || {}).value || '';
    return addDays(t, { '1y': 365, '3y': 365 * 3, '5y': 365 * 5 }[key]);
  }

  // ---------- the mandatory review ----------
  function reviewQueue() {
    const s = S();
    return [...G.dueGoals(s).map((g) => ({ type: 'goal', id: g.id })), ...G.overdueDreams(s).map((b) => ({ type: 'dream', id: b.id }))];
  }

  function nextExtra() {
    const g = rv.cur.type === 'goal' ? goal(rv.cur.id) : null;
    if (!g || !rv.dr) return '';
    if (rv.dr.next === 'adjust') return `<input id="rv-newtarget" type="number" inputmode="decimal" placeholder="New target${g.unit ? ' (' + esc(g.unit) + ')' : ''}">`;
    if (rv.dr.next === 'retry' && g.horizon === 'long') return '<span class="label">New deadline</span><input id="rv-newend" type="date">';
    return '';
  }

  function goalStep(item) {
    const g = goal(item.id);
    const n = rv.q.length;
    rv.dr = { verdict: G.suggestVerdict(g), tags: [], next: '' };
    const nextOpts = [['retry', g.horizon === 'long' ? 'Move deadline' : 'Retry next time'], ...(g.kind === 'yesno' ? [] : [['adjust', 'Adjust target']]), ['drop', 'Drop it']];
    return `<div class="rv-step">${rv.i + 1} of ${n}</div><h2>Answer your goal</h2>
      <div class="rv-goal"><b>${esc(g.title)}</b><span class="muted">${esc(G.periodLabel(g))}</span>${g.why ? `<div class="why">${esc(g.why)}</div>` : ''}</div>
      <div class="rv-stat"><span class="sec">${esc(G.progressText(g))}</span><b>${G.percentOf(g)}%</b></div>
      <span class="label">How did it go?</span>
      <div class="big3" id="g-verdict">${VERDICTS.map(([v, l]) => `<button class="${rv.dr.verdict === v ? 'on' : ''}" style="--k:${VERDICT_COLOR[v]}" data-act="rvVerdict" data-v="${v}">${l}</button>`).join('')}</div>
      ${g.kind === 'yesno' ? '' : `<span class="label">Final result${g.unit ? ' (' + esc(g.unit) + ')' : ''}</span><input id="rv-result" type="number" inputmode="decimal" value="${G.progressOf(g)}">`}
      <div id="rv-miss" ${rv.dr.verdict === 'achieved' ? 'hidden' : ''}>
        <span class="label">Why not? (required)</span>
        <div class="chips wrap" id="g-tags">${G.TAGS.map((t) => `<button data-act="rvTag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <textarea id="rv-reason" rows="3" placeholder="Be honest with yourself: what got in the way?"></textarea>
        <div class="muted" id="rv-count" style="margin:-4px 0 12px">At least ${MIN_REASON} characters</div>
        <input id="rv-change" placeholder="What will you change next time? (optional)" autocomplete="off">
        <span class="label">What now? (required)</span>${chipRow('next', nextOpts, '', 'rvNext')}
        <div id="rv-extra"></div>
      </div>
      <button class="btn" id="rv-save" data-act="rvSave" disabled>Save my answer</button>`;
  }

  function dreamStep(item) {
    const b = dream(item.id);
    const n = rv.q.length;
    rv.dr = { decision: '' };
    return `<div class="rv-step">${rv.i + 1} of ${n}</div><h2>Dream deadline passed</h2>
      <div class="rv-goal"><b>${esc(b.title)}</b><span class="muted">was due ${dayName(b.deadline)}</span>${b.note ? `<div class="why">${esc(b.note)}</div>` : ''}</div>
      <span class="label">What happened?</span>
      <div class="big3" id="g-decision">${[['done', 'I did it'], ['move', 'Move date'], ['drop', 'Drop it']].map(([v, l]) => `<button style="--k:#a78bfa" data-act="rvDecision" data-v="${v}">${l}</button>`).join('')}</div>
      <div id="rv-d-done" hidden><input id="rv-dnote" placeholder="How did it feel? (optional)" autocomplete="off"></div>
      <div id="rv-d-move" hidden><span class="label">New date (required)</span><input id="rv-ddate" type="date" min="${addDays(today(), 1)}"></div>
      <div id="rv-d-why" hidden><span class="label">Why? (required)</span><textarea id="rv-dreason" rows="3" placeholder="What stopped you?"></textarea><div class="muted" style="margin:-4px 0 12px">At least ${MIN_REASON} characters</div></div>
      <button class="btn" id="rv-save" data-act="rvSave" disabled>Save my answer</button>`;
  }

  function renderStep() {
    rv.cur = rv.q[rv.i];
    const html = rv.cur.type === 'goal' ? goalStep(rv.cur) : dreamStep(rv.cur);
    if (rv.first) { rv.first = false; openModal(html, { locked: true }); } else {
      const sheet = document.querySelector('#modal .sheet');
      if (sheet) sheet.innerHTML = html; else openModal(html, { locked: true });
    }
    validate();
  }

  function valid() {
    const dr = rv.dr, val = (id) => ($(id) ? $(id).value : '');
    if (rv.cur.type === 'goal') {
      const g = goal(rv.cur.id);
      if (!dr.verdict) return false;
      if (dr.verdict === 'achieved') return true;
      if (val('rv-reason').trim().length < MIN_REASON || !dr.next) return false;
      if (dr.next === 'adjust') {
        const v = val('rv-newtarget');
        return v !== '' && Number.isFinite(Number(v)) && (g.kind === 'value' ? Number(v) !== g.from : Number(v) > 0);
      }
      if (dr.next === 'retry' && g.horizon === 'long') return val('rv-newend') > today();
      return true;
    }
    if (dr.decision === 'done') return true;
    if (dr.decision === 'move') return val('rv-ddate') > today() && val('rv-dreason').trim().length >= MIN_REASON;
    if (dr.decision === 'drop') return val('rv-dreason').trim().length >= MIN_REASON;
    return false;
  }
  function validate() {
    if (!rv) return;
    const reason = $('rv-reason');
    if (reason && $('rv-count')) {
      const n = reason.value.trim().length;
      $('rv-count').textContent = n >= MIN_REASON ? 'Thank you for being honest.' : `At least ${MIN_REASON} characters (${n} so far)`;
    }
    const btn = $('rv-save');
    if (btn) btn.disabled = !valid();
  }
  document.addEventListener('input', (e) => { if (rv && e.target.id && e.target.id.startsWith('rv-')) validate(); });

  function checkDue(opts = {}) {
    if (rv) return false;
    if (!opts.force && !$('modal').hidden) return false; // never interrupt a form someone is filling in
    const q = reviewQueue();
    if (!q.length) return false;
    rv = { q, i: 0, first: true, cur: null, dr: null };
    renderStep();
    return true;
  }

  function makeNext(g, next) {
    const p = g.horizon === 'long' ? { start: today(), end: ($('rv-newend') || {}).value } : G.upcomingPeriod(g);
    if (!p || !p.end) return;
    const last = g.progress.length ? g.progress[g.progress.length - 1].amount : g.from;
    const n = { ...g, id: db.uid(), start: p.start, end: p.end, progress: [], review: null, created: today(), touched: today(), from: g.kind === 'value' ? last : g.from };
    if (next === 'adjust') n.target = Number($('rv-newtarget').value);
    S().goals.push(n);
  }

  async function saveReview() {
    const val = (id) => ($(id) ? $(id).value : '');
    if (rv.cur.type === 'goal') {
      const g = goal(rv.cur.id), dr = rv.dr;
      if (g) {
        const ok = dr.verdict === 'achieved';
        const next = ok ? (g.repeat && g.horizon !== 'long' ? 'repeat' : 'done') : dr.next;
        const result = $('rv-result') && val('rv-result') !== '' ? Number(val('rv-result')) : null;
        g.review = { date: today(), verdict: dr.verdict, result, tags: ok ? [] : dr.tags, reason: ok ? '' : val('rv-reason').trim(), change: ok ? '' : val('rv-change').trim(), next };
        if (next === 'retry' || next === 'adjust' || next === 'repeat') makeNext(g, next);
      }
    } else {
      const b = dream(rv.cur.id), dr = rv.dr;
      if (b) {
        if (dr.decision === 'done') { b.status = 'done'; b.doneAt = Date.now(); b.doneNote = val('rv-dnote').trim(); } else if (dr.decision === 'move') {
          b.moves = [...(b.moves || []), { from: b.deadline, to: val('rv-ddate'), reason: val('rv-dreason').trim(), date: today() }];
          b.deadline = val('rv-ddate');
        } else { b.status = 'dropped'; b.dropReason = val('rv-dreason').trim(); }
        b.touched = today();
      }
    }
    rv.i++;
    if (rv.i < rv.q.length) { await commit(); renderStep(); return; }
    rv = null;
    closeModal(true);
    await refresh();
  }

  // ---------- dashboard widgets ----------
  function widget(id) {
    const s = S(), t = today();
    if (id === 'goals') {
      const active = s.goals.filter((g) => !g.review && g.start <= t).sort((a, b) => a.end.localeCompare(b.end));
      if (!active.length) {
        return `<div class="card dcard"><div class="dhead"><h2>Goals</h2><button class="link" data-act="goGoals">Open</button></div><div class="dempty">No goals yet. What do you want to achieve this week?</div><button class="btn alt sm" style="margin-top:12px" data-act="addGoal">Set a goal</button></div>`;
      }
      const due = G.dueGoals(s).length;
      const rows = active.slice(0, 3).map((g) => `<div class="drow"><div class="grow"><div class="t-title">${esc(g.title)}</div>
        <div class="bar thin"><div style="width:${G.percentOf(g)}%"></div></div><div class="t-meta">${esc(G.progressText(g))} · ${G.daysLeftLabel(g)}</div></div>
        ${g.kind === 'yesno' ? (G.progressOf(g) ? `<span class="good m-sub">Done</span>` : `<button class="pill" data-act="gDone" data-id="${g.id}">Done</button>`) : g.kind === 'count' ? `<button class="pill" data-act="gPlus" data-id="${g.id}">+1</button>` : `<button class="pill" data-act="gLog" data-id="${g.id}">Update</button>`}</div>`).join('');
      return `<div class="card dcard"><div class="dhead"><h2>Goals</h2><button class="link" data-act="goGoals">All goals</button></div>${rows}${active.length > 3 ? `<div class="muted dmore">+${active.length - 3} more</div>` : ''}${due ? `<div class="dfoot bad">${due} goal${due === 1 ? '' : 's'} waiting for your answer</div>` : ''}</div>`;
    }
    // bucket
    if (!s.bucket.length) {
      return `<div class="card dcard"><div class="dhead"><h2>Bucket list</h2><button class="link" data-act="goDreams">Open</button></div><div class="dempty">Write down what you want to do before time runs out.</div><button class="btn alt sm" style="margin-top:12px" data-act="addDream">Add a dream</button></div>`;
    }
    const feat = featured();
    const done = s.bucket.filter((b) => b.status === 'done').length, total = s.bucket.filter((b) => b.status !== 'dropped').length;
    if (!feat) return `<div class="card dcard"><div class="dhead"><h2>Bucket list</h2><button class="link" data-act="goDreams">Open</button></div><div class="dempty">${done ? 'Every dream on your list is done. Dream bigger.' : 'Nothing open right now.'}</div></div>`;
    return `<div class="card dcard"><div class="dhead"><h2>Dream of the month</h2><button class="link" data-act="goDreams">Bucket list</button></div>
      <div class="t-title" data-act="openDream" data-id="${feat.id}">${esc(feat.title)}</div><div class="t-meta" style="margin-top:8px">${pill(feat)}</div>
      <div class="dfoot muted">${done} of ${total} done</div></div>`;
  }

  // ---------- actions ----------
  const addProgress = async (id, amount, note = '') => {
    const g = goal(id);
    if (!g) return;
    g.progress.push({ id: db.uid(), date: today(), amount, note });
    g.touched = today();
    await commit();
    if (document.querySelector(`#modal [data-sheet="goal"][data-id="${id}"]`)) goalSheet(id);
  };

  const repaint = (g, v) => document.querySelectorAll(`[data-g="${g}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));

  const actions = {
    gTab: (el) => { tab = el.dataset.v; d.render('fade'); },
    gHorizon: (el) => { horizon = el.dataset.v; d.render(); },
    dCat: (el) => { catFilter = el.dataset.v; d.render(); },
    jMode: (el) => { jMode = el.dataset.v; d.render(); },
    gChip: (el) => {
      const g = el.dataset.g, v = el.dataset.v;
      md[g] = v;
      repaint(g, v);
      if (g === 'horizon') { md.when = 'this'; $('gz-when').innerHTML = whenHtml(); $('gz-repeat').innerHTML = repeatHtml(); }
      if (g === 'when') $('gz-when').innerHTML = whenHtml();
      if (g === 'kind') $('gz-kind').innerHTML = kindHtml();
      if (g === 'dl' && $('d-date')) $('d-date').hidden = v !== 'custom';
    },

    addGoal: () => goalForm(),
    gEdit: (el) => goalForm(goal(el.dataset.id)),
    openGoal: (el) => goalSheet(el.dataset.id),
    saveGoal: async () => {
      const title = $('g-title').value.trim();
      if (!title) return ui.alert('Give your goal a name');
      const num = (id) => ($(id) && $(id).value !== '' ? Number($(id).value) : NaN);
      const old = md.id ? goal(md.id) : null;
      const kind = old ? old.kind : md.kind;
      const target = num('g-target'), from = num('g-from');
      if (kind === 'count' && !(target > 0)) return ui.alert('Enter a target above zero');
      if (kind === 'value' && (!Number.isFinite(target) || !Number.isFinite(from) || target === from)) return ui.alert('Enter a starting value and a different target');
      const data = { title, why: $('g-why').value.trim(), unit: $('g-unit') ? $('g-unit').value.trim() : '', target: kind === 'yesno' ? 1 : target, from: kind === 'value' ? from : 0 };
      if (old) Object.assign(old, data, { touched: today() });
      else {
        let p;
        if (md.horizon === 'long') {
          const end = ($('g-end') || {}).value;
          if (!end || end <= today()) return ui.alert('Pick a deadline in the future');
          p = { start: today(), end };
        } else p = G.periodFor(md.horizon, today(), md.when === 'next');
        S().goals.push({ id: db.uid(), horizon: md.horizon, kind, ...data, start: p.start, end: p.end, repeat: md.repeat === 'yes', progress: [], review: null, created: today(), touched: today() });
        horizon = md.horizon;
      }
      closeModal();
      await refresh();
    },
    gDelete: async (el) => {
      if (!(await ui.confirm('Its progress log goes with it.', { title: 'Delete this goal?', ok: 'Delete', danger: true }))) return;
      S().goals = S().goals.filter((g) => g.id !== el.dataset.id);
      closeModal();
      await refresh();
    },
    gDone: (el) => { const g = goal(el.dataset.id); return g && !G.progressOf(g) ? addProgress(g.id, 1) : null; },
    gUndo: async (el) => { const g = goal(el.dataset.id); if (g) { g.progress = []; await commit(); if (document.querySelector('#modal [data-sheet="goal"]')) goalSheet(g.id); } },
    gPlus: (el) => addProgress(el.dataset.id, 1),
    gLog: async (el) => {
      const g = goal(el.dataset.id);
      const v = await ui.prompt(g.kind === 'count' ? 'Add progress' : 'Current value', g.kind === 'value' ? G.progressOf(g) : '', g.unit || 'Number');
      if (v === null || v === '' || !Number.isFinite(Number(v))) return;
      if (g.kind === 'count' && Number(v) <= 0) return;
      await addProgress(g.id, Number(v));
    },
    gDelEntry: async (el) => {
      const g = goal(el.dataset.id);
      g.progress = g.progress.filter((e) => e.id !== el.dataset.eid);
      await commit();
      goalSheet(g.id);
    },
    gStep: (el) => { const g = goal(el.dataset.id); closeModal(); openTaskForm({ goalId: g.id, label: g.title }); },
    gKeep: async (el) => { goal(el.dataset.id).touched = today(); await commit(); },
    gDrop: async (el) => {
      const g = goal(el.dataset.id);
      const r = await ui.text('Why drop this goal?', '', 'One honest line (required)');
      if (r === null) return;
      if (r.trim().length < 5) return ui.alert('Write at least a few words so you remember why.');
      g.review = { date: today(), verdict: 'missed', result: null, tags: [], reason: r.trim(), change: '', next: 'drop', early: true };
      await refresh();
    },

    addDream: () => dreamForm(),
    dEdit: (el) => dreamForm(dream(el.dataset.id)),
    openDream: (el) => dreamSheet(el.dataset.id),
    saveDream: async () => {
      const title = $('d-title').value.trim();
      if (!title) return ui.alert('Give your dream a name');
      const cost = $('d-cost').value === '' ? 0 : Number($('d-cost').value);
      const old = md.id ? dream(md.id) : null;
      if (old) Object.assign(old, { title, cat: md.cat, cost, note: $('d-note').value.trim(), touched: today() });
      else {
        const deadline = deadlineFor(md.dl);
        if (!deadline || deadline <= today()) return ui.alert('Pick a date in the future. A dream with a date gets done.');
        S().bucket.push({ id: db.uid(), title, cat: md.cat, deadline, cost, note: $('d-note').value.trim(), status: 'open', doneAt: 0, doneNote: '', moves: [], created: today(), touched: today() });
      }
      closeModal();
      await refresh();
    },
    dKeep: async (el) => { dream(el.dataset.id).touched = today(); await commit(); },
    dShuffle: async () => {
      const s = S(), m = today().slice(0, 7);
      const open = s.bucket.filter((b) => b.status === 'open');
      const cur = s.settings.dreamPick;
      const others = open.filter((b) => !cur || b.id !== cur.id);
      if (others.length) s.settings.dreamPick = { month: m, id: others[Math.floor(Math.random() * others.length)].id };
      await commit();
    },
    dreamDone: async (el) => {
      const b = dream(el.dataset.id);
      const note = await ui.text('You did it!', '', 'How did it feel? (optional)');
      if (note === null) return;
      Object.assign(b, { status: 'done', doneAt: Date.now(), doneNote: note.trim(), touched: today() });
      closeModal();
      await refresh();
    },
    dreamMove: (el) => {
      const b = dream(el.dataset.id);
      md = { id: b.id };
      setSheet(`<h2>Move the date</h2><div class="muted" style="margin:-8px 0 14px">${esc(b.title)} was due ${dayName(b.deadline)}</div>
        <span class="label">New date</span><input id="m-newdate" type="date" min="${addDays(today(), 1)}">
        <span class="label">Why is it moving? (required)</span><textarea id="m-reason" rows="3" placeholder="Be honest about what changed"></textarea>
        <button class="btn" data-act="dreamMoveSave">Save</button>`);
    },
    dreamMoveSave: async () => {
      const b = dream(md.id), date = $('m-newdate').value, reason = $('m-reason').value.trim();
      if (!date || date <= today()) return ui.alert('Pick a new date in the future');
      if (reason.length < MIN_REASON) return ui.alert(`Write at least ${MIN_REASON} characters about why it is moving.`);
      b.moves = [...(b.moves || []), { from: b.deadline, to: date, reason, date: today() }];
      b.deadline = date;
      b.touched = today();
      closeModal();
      await refresh();
    },
    dreamGoal: async (el) => {
      const b = dream(el.dataset.id);
      if (!b.deadline || b.deadline <= today()) return ui.alert('Move the date first, then make it a goal.');
      S().goals.push({ id: db.uid(), title: b.title, why: b.note || '', horizon: 'long', kind: 'yesno', unit: '', target: 1, from: 0, start: today(), end: b.deadline, repeat: false, progress: [], review: null, created: today(), touched: today(), dreamId: b.id });
      b.touched = today();
      closeModal();
      horizon = 'long';
      tab = 'goals';
      await refresh();
      await ui.alert('It is now a long-term goal with the same deadline. You will be asked about it when time is up.', 'Goal created');
    },
    dreamStep: (el) => { const b = dream(el.dataset.id); b.touched = today(); closeModal(); openTaskForm({ label: b.title, title: '' }); },
    dreamDrop: async (el) => {
      const b = dream(el.dataset.id);
      const r = await ui.text('Why drop this dream?', '', 'One honest line (required)');
      if (r === null) return;
      if (r.trim().length < 5) return ui.alert('Write at least a few words so you remember why.');
      Object.assign(b, { status: 'dropped', dropReason: r.trim(), touched: today() });
      closeModal();
      await refresh();
    },

    rvVerdict: (el) => {
      rv.dr.verdict = el.dataset.v;
      repaint('verdict', el.dataset.v);
      document.querySelectorAll('#g-verdict button').forEach((b) => b.classList.toggle('on', b.dataset.v === el.dataset.v));
      $('rv-miss').hidden = el.dataset.v === 'achieved';
      validate();
    },
    rvTag: (el) => {
      const t = el.dataset.v, tags = rv.dr.tags;
      rv.dr.tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
      el.classList.toggle('on', rv.dr.tags.includes(t));
    },
    rvNext: (el) => { rv.dr.next = el.dataset.v; repaint('next', el.dataset.v); $('rv-extra').innerHTML = nextExtra(); validate(); },
    rvDecision: (el) => {
      rv.dr.decision = el.dataset.v;
      document.querySelectorAll('#g-decision button').forEach((b) => b.classList.toggle('on', b.dataset.v === el.dataset.v));
      $('rv-d-done').hidden = el.dataset.v !== 'done';
      $('rv-d-move').hidden = el.dataset.v !== 'move';
      $('rv-d-why').hidden = el.dataset.v === 'done';
      validate();
    },
    rvSave: () => (valid() ? saveReview() : null),
  };

  return {
    view,
    actions,
    widget,
    checkDue,
    getTab: () => tab,
    setTab: (k) => { tab = k; },
    setHorizon: (k) => { horizon = k; },
    getJMode: () => jMode,
    openGoalForm: () => goalForm(),
    openDreamForm: () => dreamForm(),
  };
}
