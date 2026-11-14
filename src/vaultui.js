// Vault UI: a pseudo-tab ('vault', like Screen time) opened from the dashboard widget or Settings.
// Locked screen (create / unlock), the list, the detail sheet, the add/edit sheet, file viewing, PIN change and the
// encrypted vault backup. Rules and encryption live in vault.js, file storage in vaultfiles.js.
//
// Safety rules kept here: the open data key and the decrypted items only live in this closure (never in db state), the Vault
// locks when you leave its page, when the app has been in the background for 45 seconds and after 3 minutes without a touch,
// screenshots are blocked while it is open (phone side, setSecure), and a decrypted copy of a file only exists for a moment.
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import * as db from './db.js';
import * as V from './vault.js';
import * as F from './vaultfiles.js';

const AWAY_LOCK = 45000;   // in the background this long = locked
const IDLE_LOCK = 180000;  // no touch for this long = locked
const TYPE_ICON = { doc: 'doc', login: 'key', bank: 'money', note: 'note' };
const TYPE_COLOR = { doc: '#a78bfa', login: '#4ade80', bank: '#fbbf24', note: '#818cf8' };

export function createVault(d) {
  const { ui, openModal, closeModal, setSheet, render, esc, svg, dot, plugin, isNative, getTab, buzz } = d;
  const S = () => db.get();
  let key = null;          // the open data key (null = locked)
  let items = [];
  let filter = 'all';
  let query = '';
  let draft = null;        // the item being added or edited
  let editing = false;
  let shown = new Set();   // "<itemId>:<fieldKey>" of secrets that are visible right now
  let lastTouch = 0, hiddenAt = 0, busyUntil = 0;
  let error = '';
  let working = false;
  let viewUrl = '';
  let pendingRestore = null;
  let copyToken = 0;
  let tmpTimer = 0;
  let bio = null;          // fingerprint unlock on this phone: { available, enabled } (null = not asked yet)
  let bioBusy = false;

  const unlocked = () => !!key;
  const find = (id) => items.find((i) => i.id === id);
  const typeIcon = (t) => `<span class="vic" style="--c:${TYPE_COLOR[t]}">${svg(TYPE_ICON[t])}</span>`;
  const secure = (on) => { if (!isNative) return; try { const p = plugin.setSecure({ on }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* an older APK has no such method */ } };

  // ---------- lock / unlock ----------
  function lock(redraw = true) {
    const was = !!key;
    key = null; items = []; draft = null; editing = false; shown = new Set(); pendingRestore = null; error = ''; query = ''; filter = 'all';
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; }
    clearTimeout(tmpTimer);
    F.clearTemp();
    if (was) secure(false);
    if (was && $('modal') && !$('modal').hidden) closeModal(true);
    if (redraw && was && getTab() === 'vault') render();
  }
  const $ = (id) => document.getElementById(id);

  async function afterOpen(k) {
    key = k;
    lastTouch = Date.now();
    secure(true);
    F.clearTemp();
    // files that no item points to (a form that was abandoned after adding a picture) are removed
    const used = new Set(items.flatMap((i) => i.files.map((f) => `${f.id}.${f.x}`)));
    F.listNames().then((names) => names.filter((n) => !used.has(n)).forEach((n) => { const [id, x] = n.split('.'); if (id && x && key) F.delBytes(id, x); }));
  }

  async function open(vault, pin) {
    const k = await V.unlock(vault, pin);
    items = V.cleanItems(await V.openJson(k, vault.blob));
    await afterOpen(k);
  }

  async function persist() {
    S().vault.blob = await V.sealJson(key, items);
    await db.save();
  }

  // ---------- fingerprint unlock (phone only) ----------
  // The phone keeps the data key locked behind a fingerprint (VaultBio.java, Android Keystore). The PIN always works too.
  async function refreshBio() {
    if (!isNative) { bio = { available: false, enabled: false }; return bio; }
    try { const r = await plugin.bioStatus(); bio = { available: !!r.available, enabled: !!r.enabled }; } catch (e) { bio = { available: false, enabled: false }; }
    return bio;
  }
  const dropBio = async () => { if (isNative) { try { await plugin.bioDisable(); } catch (e) { /* an older APK has no such method */ } } if (bio) bio.enabled = false; };

  async function bioUnlock(silent = false) {
    const v = S().vault;
    if (!v || key || bioBusy || !bio || !bio.enabled) return;
    bioBusy = true;
    try {
      const r = await plugin.bioUnlock();
      const raw = V.unb64(r.data);
      const k = await V.keyFromRaw(raw);
      raw.fill(0);
      items = V.cleanItems(await V.openJson(k, v.blob));
      await afterOpen(k);
      error = '';
      buzz('ok');
    } catch (e) {
      const code = String((e && (e.code || e.message)) || '');
      if (/cancel/i.test(code)) {
        // the user chose the PIN instead
      } else if (/invalid/i.test(code)) {
        await dropBio();
        error = "Your phone's fingerprints changed, so fingerprint unlock was switched off. Use your PIN, then turn it on again.";
      } else if (!silent) error = 'Fingerprint did not work. Use your PIN.';
    }
    bioBusy = false;
    if (getTab() === 'vault') render();
  }

  // ---------- locked screens ----------
  const pinField = (id, ph) => `<input id="${id}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" placeholder="${ph}">`;

  function setupView() {
    return `<div class="card vlock"><span class="vbig">${svg('vault')}</span><h2>Create your Vault</h2>
      <div class="sec" style="line-height:1.55">One safe place for your Aadhaar, PAN and other documents, plus passwords, bank details and private notes. Everything is encrypted with a PIN you choose. It never leaves this phone.</div>
      ${V.available() ? `${pinField('v-pin', 'Choose a Vault PIN')}${pinField('v-pin2', 'Type it again')}
        ${error ? `<div class="verr">${esc(error)}</div>` : ''}
        <button class="btn" data-act="vCreate" ${working ? 'disabled' : ''}>${working ? 'Creating…' : 'Create Vault'}</button>
        <div class="muted" style="margin-top:12px;line-height:1.55">At least ${V.MIN_PIN} characters, numbers are fine. <b>Prysm cannot recover this PIN.</b> If you forget it, the Vault has to be erased. Make a vault backup now and then, because photos, videos and PDFs are not part of the normal backup.</div>
        <button class="link center" data-act="vRestore">I have a vault backup file</button>`
      : '<div class="banner urgent"><div><b>Encryption is not available</b><span>This screen cannot do secure encryption, so the Vault stays off.</span></div></div>'}</div>`;
  }

  function lockView() {
    const v = S().vault;
    if (bio === null) refreshBio().then(() => { if (!key && getTab() === 'vault') render(); });
    const wait = v.until - Date.now();
    return `<div class="card vlock"><span class="vbig">${svg('vault')}</span><h2>Vault is locked</h2>
      <div class="sec">Enter your Vault PIN to open it.</div>
      ${pinField('v-pin', 'Vault PIN')}
      ${wait > 0 ? `<div class="verr">Too many wrong tries. Wait ${wait > 90000 ? Math.ceil(wait / 60000) + ' minutes' : Math.ceil(wait / 1000) + ' seconds'} and try again.</div>` : error ? `<div class="verr">${esc(error)}</div>` : ''}
      <button class="btn" data-act="vUnlock" ${working ? 'disabled' : ''}>${working ? 'Unlocking…' : 'Unlock'}</button>
      ${bio && bio.enabled ? `<button class="btn alt" style="margin-top:10px" data-act="vBioUnlock">${svg('fingerprint')}Use fingerprint</button>` : ''}
      <div class="row between" style="margin-top:6px"><button class="link" data-act="vForgot">Forgot PIN?</button><button class="link" data-act="vRestore">Restore backup</button></div></div>`;
  }

  // ---------- the list ----------
  const FILTERS = [['all', 'All'], ['doc', 'Documents'], ['login', 'Passwords'], ['bank', 'Bank'], ['note', 'Notes']];

  const rowHtml = (it) => `<div class="item tap" data-act="vOpen" data-id="${esc(it.id)}">${typeIcon(it.type)}
    <div class="grow"><div>${it.fav ? '★ ' : ''}${esc(it.title)}</div><div class="muted">${esc(V.subtitle(it) || V.TYPE[it.type].label)}</div></div>
    ${it.files.length ? `<span class="ptag">${svg('file')}${it.files.length}</span>` : ''}</div>`;

  function listHtml() {
    const list = V.sortItems(items.filter((i) => (filter === 'all' || i.type === filter) && V.matches(i, query)));
    if (list.length) return list.map(rowHtml).join('');
    if (!items.length) return '<div class="muted" style="line-height:1.6;padding:6px 0">Nothing here yet. Tap <b>+ Add</b> to save your first document, password or note.</div>';
    return '<div class="muted" style="padding:6px 0">Nothing matches.</div>';
  }

  function openView() {
    if (bio === null) refreshBio().then(() => { if (key && getTab() === 'vault') render(); });
    const count = (t) => (t === 'all' ? items.length : items.filter((i) => i.type === t).length);
    const files = items.reduce((n, i) => n + i.files.length, 0);
    return `<div class="card"><div class="row between"><h2 style="margin:0">Vault</h2><div class="row" style="gap:8px"><button class="btn alt sm" data-act="vLock">${svg('lock')} Lock</button><button class="btn sm" data-act="vAdd">+ Add</button></div></div>
      <input id="v-q" placeholder="Search your Vault" autocomplete="off" value="${esc(query)}" style="margin:14px 0 10px">
      <div class="chips scroll subtabs" id="v-chips">${FILTERS.map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-act="vFilter" data-v="${k}">${l}${count(k) ? `<i>${count(k)}</i>` : ''}</button>`).join('')}</div>
      <div id="v-list">${listHtml()}</div></div>
      <div class="card"><h2>Vault tools</h2>
        <div class="set-row"><div class="grow"><b>Back up Vault</b><span>One encrypted file with every item, photo and video. Only your PIN opens it</span></div><button class="capsule set" style="margin:0" data-act="vBackup"><span>Back up</span></button></div>
        <div class="set-row"><div class="grow"><b>Restore Vault</b><span>From a vault backup file</span></div><button class="capsule set" style="margin:0" data-act="vRestore"><span>Restore</span></button></div>
        ${bio && bio.available ? `<div class="set-row"><div class="grow"><b>Fingerprint unlock</b><span>${bio.enabled ? 'On. Your PIN still works too' : 'Open the Vault with your fingerprint instead of typing the PIN'}</span></div><button class="switch ${bio.enabled ? 'on' : ''}" role="switch" aria-checked="${bio.enabled}" aria-label="Fingerprint unlock" data-act="vBioToggle"><i></i></button></div>` : ''}
        <div class="set-row"><div class="grow"><b>Change PIN</b><span>Your items and files stay as they are</span></div><button class="capsule set" style="margin:0" data-act="vPinForm"><span>Change</span></button></div>
        <div class="muted" style="margin-top:12px;line-height:1.55">${items.length} item${items.length === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}. The Vault locks when you leave this page, after 45 seconds away from Prysm, or 3 minutes without a touch. Screenshots are blocked while it is open.</div></div>`;
  }

  function view() {
    const v = S().vault;
    if (!v) return setupView();
    return key ? openView() : lockView();
  }

  // ---------- detail sheet ----------
  const isShown = (it, k) => shown.has(`${it.id}:${k}`);

  function fieldRow(it, f) {
    const hidden = f.secret && !isShown(it, f.key);
    return `<div class="vf"><div class="grow"><span class="label">${esc(f.l)}</span><div class="vv ${f.multi ? 'multi' : ''}">${hidden ? '••••••••' : esc(f.v)}</div></div>
      ${f.secret ? `<button class="icon" data-act="vReveal" data-k="${f.key}" aria-label="${hidden ? 'Show' : 'Hide'}">${svg(hidden ? 'eye' : 'eyeoff')}</button>` : ''}
      ${f.copy ? `<button class="icon" data-act="vCopy" data-k="${f.key}" aria-label="Copy ${esc(f.l)}">${svg('copy')}</button>` : ''}</div>`;
  }

  function detailHtml(it) {
    const t = V.TYPE[it.type];
    const rows = V.listFields(it).map((f) => fieldRow(it, f)).join('');
    const files = it.files.map((f) => `<div class="vf"><span class="vic" style="--c:#60a5fa">${svg('file')}</span><div class="grow"><div class="vv">${esc(f.n || `${f.id}.${f.x}`)}</div><span class="muted">${esc(f.x.toUpperCase())} · ${V.fmtSize(f.size)}</span></div>
      <button class="btn alt sm" data-act="vView" data-fid="${esc(f.id)}">${V.isVideo(f.x) ? 'Play' : 'View'}</button><button class="btn sm" data-act="vShare" data-fid="${esc(f.id)}">${svg('share')}Share</button></div>`).join('');
    return `<h2>${esc(it.title)}</h2><div class="muted" style="margin:-8px 0 12px">${esc(t.label)}${it.fav ? ' · pinned' : ''}</div>
      ${rows || '<div class="muted" style="margin-bottom:8px">No details saved.</div>'}
      ${files ? `<span class="label" style="margin-top:14px">Files</span>${files}` : ''}
      <button class="btn" style="margin-top:18px" data-act="vShareOpen">${svg('share')}Share details or files</button>
      <div class="grid2" style="margin-top:10px"><button class="btn alt" data-act="vFav">${it.fav ? 'Unpin' : 'Pin to top'}</button><button class="btn alt" data-act="vEdit">Edit</button></div>
      <button class="btn danger" style="margin-top:10px" data-act="vDelete">Delete</button>
      <button class="btn alt" style="margin-top:10px" data-act="closeModal">Close</button>`;
  }

  // ---------- add / edit sheet ----------
  function typeSheet() {
    setSheet(`<h2>Add to Vault</h2><div class="muted" style="margin:-8px 0 12px">What do you want to save?</div>
      ${V.TYPES.map((t) => `<button class="app-pick" data-act="vNew" data-t="${t.id}">${typeIcon(t.id)}<span class="grow"><b style="display:block;font:700 15px Manrope,sans-serif">${t.label}</b><span class="muted">${t.hint}</span></span></button>`).join('')}
      <button class="btn alt" style="margin-top:14px" data-act="closeModal">Cancel</button>`);
  }

  function fieldInput(f, val) {
    const id = `vf-${f.k}`;
    if (f.multi) return `<textarea id="${id}" rows="3" maxlength="4000" autocomplete="off" spellcheck="false">${esc(val)}</textarea>`;
    if (f.kind === 'date') return `<input id="${id}" type="date" value="${esc(val)}">`;
    if (f.secret) return `<div class="vsec"><input id="${id}" type="password" value="${esc(val)}" maxlength="300" autocomplete="new-password" autocapitalize="off" spellcheck="false"><button class="icon" data-act="vEye" data-k="${f.k}" aria-label="Show or hide">${svg('eye')}</button>${f.gen ? `<button class="btn alt sm" data-act="vGen" data-k="${f.k}">Generate</button>` : ''}</div>`;
    return `<input id="${id}" value="${esc(val)}" maxlength="300" autocomplete="off" autocapitalize="${f.k === 'upi' || f.k === 'url' || f.k === 'user' ? 'off' : 'words'}" spellcheck="false">`;
  }

  function filesBlock() {
    const left = V.MAX_FILES - draft.files.length;
    return `<span class="label" style="margin-top:6px">Photos, videos and PDFs</span>
      ${draft.files.map((f) => `<div class="vf"><span class="vic" style="--c:#60a5fa">${svg('file')}</span><div class="grow"><div class="vv">${esc(f.n || f.id)}</div><span class="muted">${esc(f.x.toUpperCase())} · ${V.fmtSize(f.size)}</span></div><button class="icon" data-act="vFileDel" data-fid="${esc(f.id)}" aria-label="Remove file">${svg('trash')}</button></div>`).join('')}
      ${left > 0 ? `<div class="grid2" style="margin-top:8px"><button class="btn alt" data-act="vAddFile" data-cam="1">${svg('camera')} Take photo</button><button class="btn alt" data-act="vAddFile">+ Photo or PDF</button></div>` : '<div class="muted">That is the most files for one item.</div>'}
      <div class="muted" style="margin:8px 0 4px">Up to ${V.MAX_FILES} files. Photos and PDFs up to ${V.fmtSize(V.MAX_FILE)}, videos up to ${V.fmtSize(V.MAX_VIDEO)}. Saved encrypted.</div>`;
  }

  // fields the user adds on top of the built-in ones (CRN, branch, nominee ...): a label, a value, and a "secret" switch
  function extraBlock() {
    const have = new Set(draft.extra.map((e) => e.l.toLowerCase()));
    const ideas = (V.SUGGEST[draft.type] || []).filter((x) => !have.has(x.toLowerCase()));
    return `<span class="label" style="margin-top:6px">Your own fields</span>
      ${draft.extra.map((e, i) => `<div class="vx" data-i="${i}" data-s="${e.s ? 1 : 0}"><input class="vx-l" value="${esc(e.l)}" maxlength="40" placeholder="Field name, e.g. CRN" autocomplete="off" autocapitalize="words" spellcheck="false">
        <input class="vx-v" type="${e.s ? 'password' : 'text'}" value="${esc(e.v)}" maxlength="1000" placeholder="Value" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="row between"><button class="chipbtn ${e.s ? 'on' : ''}" data-act="vXSecret" data-i="${i}">${svg(e.s ? 'lock' : 'eye')} ${e.s ? 'Secret: hidden' : 'Visible'}</button><button class="icon" data-act="vXDel" data-i="${i}" aria-label="Remove field">${svg('trash')}</button></div></div>`).join('')}
      ${draft.extra.length < V.MAX_EXTRA ? `<button class="btn alt" style="margin-top:4px" data-act="vXAdd">+ Add field</button>` : ''}
      ${ideas.length && draft.extra.length < V.MAX_EXTRA ? `<div class="muted" style="margin:10px 0 6px">Quick add</div><div class="chips">${ideas.map((x) => `<button data-act="vXAdd" data-l="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}`;
  }

  function formHtml() {
    const t = V.TYPE[draft.type];
    return `<h2>${editing ? 'Edit' : 'New'} ${esc(t.label.toLowerCase())}</h2>
      ${draft.type === 'doc' ? `<span class="label">Quick pick</span><div class="chips scroll subtabs">${V.DOC_PRESETS.map((p) => `<button data-act="vPreset" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
      <span class="label">Title</span><input id="vf-title" value="${esc(draft.title)}" maxlength="80" autocomplete="off" placeholder="${draft.type === 'login' ? 'e.g. Gmail, Netflix' : draft.type === 'bank' ? 'e.g. SBI savings' : draft.type === 'doc' ? 'e.g. Aadhaar card' : 'Title'}">
      ${t.fields.map((f) => `<span class="label">${esc(f.l)}</span>${fieldInput(f, draft.fields[f.k] || '')}`).join('')}
      <div id="vf-extra">${extraBlock()}</div>
      <div id="vf-files">${filesBlock()}</div>
      <div class="grid2" style="margin-top:14px"><button class="btn alt" data-act="vCancel">Cancel</button><button class="btn" data-act="vSave">Save</button></div>`;
  }

  function readForm() {
    if (!draft) return;
    const v = (id) => ($(id) ? $(id).value : '');
    draft.title = v('vf-title').trim();
    draft.extra = [...document.querySelectorAll('#vf-extra .vx')].map((row) => ({ l: row.querySelector('.vx-l').value.trim(), v: row.querySelector('.vx-v').value.trim(), s: row.dataset.s === '1' }));
    V.TYPE[draft.type].fields.forEach((f) => { if ($(`vf-${f.k}`)) { const x = v(`vf-${f.k}`).trim(); if (x) draft.fields[f.k] = x; else delete draft.fields[f.k]; } });
  }

  function form(it, type) {
    editing = !!it;
    draft = it ? JSON.parse(JSON.stringify(it)) : { id: '', type, title: '', fields: {}, extra: [], files: [], fav: false, t: 0, u: 0 };
    if (!draft.extra) draft.extra = [];
    setSheet(formHtml());
    if (!it) setTimeout(() => { const t2 = $('vf-title'); if (t2 && draft.type !== 'doc') t2.focus(); }, 80);
  }

  const markBusy = () => { busyUntil = Date.now() + 180000; };

  function addFile(camera) {
    if (!key || !draft) return;
    readForm();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = camera ? 'image/*' : 'image/*,video/*,application/pdf,.pdf';
    if (camera) inp.setAttribute('capture', 'environment');
    inp.onchange = async () => {
      const file = inp.files[0];
      busyUntil = Date.now() + 5000;
      if (!file) return;
      if (!key || !draft) { await ui.alert('The Vault was locked while you were choosing. Unlock it and add the file again.', 'Vault locked'); return; }
      if (!V.fileOk(file)) { await ui.alert('Only photos, videos and PDF files can go into the Vault.', 'Not supported'); return; }
      if (file.size > V.limitFor(file)) { await ui.alert(`That file is ${V.fmtSize(file.size)}. The limit is ${V.fmtSize(V.limitFor(file))} for ${V.isVideoFile(file) ? 'a video' : 'a photo or PDF'}. Try a smaller or shorter one.`, 'Too big'); return; }
      if (draft.files.length >= V.MAX_FILES) return;
      try {
        const id = db.uid(), x = V.extOf(file);
        const sealed = await V.seal(key, new Uint8Array(await file.arrayBuffer()));
        await F.putBytes(id, x, sealed);
        draft.files.push({ id, x, n: String(file.name || '').slice(0, 80) || `photo.${x}`, size: file.size, t: Date.now() });
        const box = $('vf-files');
        if (box) box.innerHTML = filesBlock();
      } catch (e) { await ui.alert('Could not save the file. Is the phone storage full?', 'Not saved'); }
    };
    markBusy();
    inp.click();
  }

  async function save() {
    if (!key || !draft) return;
    readForm();
    if (!draft.title) { await ui.alert('Give it a title so you can find it again.', 'Title needed'); return; }
    const now = Date.now();
    const clean = V.cleanItems([{ ...draft, id: draft.id || db.uid(), t: draft.t || now, u: now }])[0];
    const old = draft.id ? find(draft.id) : null;
    if (old) items[items.indexOf(old)] = clean; else items.push(clean);
    await persist();
    // pictures removed in the form are deleted now
    if (old) old.files.filter((f) => !clean.files.some((g) => g.id === f.id)).forEach((f) => F.delBytes(f.id, f.x));
    draft = null;
    closeModal();
    buzz('ok');
    render();
  }

  async function remove(it) {
    if (!(await ui.confirm(`Delete "${it.title}"${it.files.length ? ' and its files' : ''} from the Vault? This cannot be undone.`, { title: 'Delete', ok: 'Delete', danger: true }))) return;
    items.splice(items.indexOf(it), 1);
    await persist();
    it.files.forEach((f) => F.delBytes(f.id, f.x));
    closeModal();
    buzz('warn');
    render();
  }

  // ---------- viewing and sharing a file ----------
  async function plainOf(f) {
    const encBytes = await F.getBytes(f.id, f.x);
    if (!encBytes) { await ui.alert('This file is not on the phone any more. A normal Prysm backup keeps only the list. Restore a vault backup file to get the files back.', 'File missing'); return null; }
    try { return await V.open(key, encBytes); } catch (e) { await ui.alert('This file could not be decrypted.', 'Cannot open'); return null; }
  }

  // hands a readable copy to another app (open = a viewer, share = the share sheet). It is deleted again soon after.
  async function sendOut(f, plain, mode) {
    if (!Capacitor.isNativePlatform()) {
      const url = URL.createObjectURL(new Blob([plain], { type: V.mimeOf(f.x) }));
      const a = document.createElement('a');
      a.href = url; a.download = f.n || `${f.id}.${f.x}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    markBusy();
    const tmp = await F.putTemp(f.id, f.x, plain);
    clearTimeout(tmpTimer);
    tmpTimer = setTimeout(() => F.clearTemp(), 300000);
    if (mode === 'open') {
      try { await plugin.openFile({ path: tmp.path, mime: V.mimeOf(f.x) }); return; } catch (e) { /* an older APK: use the share sheet */ }
    }
    try { await Share.share({ title: f.n || 'Document', files: [tmp.uri], dialogTitle: 'Send file' }); } catch (e) { /* share sheet closed */ }
  }

  async function viewFile(it, f) {
    const plain = await plainOf(f);
    if (!plain) return;
    if (V.isVideo(f.x)) {
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      viewUrl = URL.createObjectURL(new Blob([plain], { type: V.mimeOf(f.x) }));
      setSheet(`<h2 style="font-size:18px">${esc(f.n || it.title)}</h2><div class="vimg"><video src="${viewUrl}" controls playsinline preload="metadata" style="width:100%;max-height:60vh"></video></div>
        <button class="btn" style="margin-top:12px" data-act="vShare" data-fid="${esc(f.id)}">${svg('share')}Share</button>
        <button class="btn alt" style="margin-top:10px" data-act="vBack">Back</button>`);
      return;
    }
    if (!V.isImage(f.x)) { await sendOut(f, plain, 'open'); return; }
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = URL.createObjectURL(new Blob([plain], { type: V.mimeOf(f.x) }));
    setSheet(`<h2 style="font-size:18px">${esc(f.n || it.title)}</h2><div class="vimg" id="v-img"><img src="${viewUrl}" alt="${esc(it.title)}"></div>
      <div class="grid2" style="margin-top:12px"><button class="btn alt" data-act="vZoom">Zoom</button><button class="btn" data-act="vShare" data-fid="${esc(f.id)}">${svg('share')}Share</button></div>
      <button class="btn" style="margin-top:10px" data-act="vBack">Back</button>`);
  }

  // ---------- sharing: ready-made text + files ----------
  // The sheet lists every detail and file with a tick. The text is built from the ticked details ("Label: value" lines under the
  // title), so the person who receives it can simply copy and paste. Secret details (passwords, CVV, PIN) start unticked.
  let sh = null; // { id, keys: Set, files: Set }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (err) { /* no clipboard */ } t.remove();
    }
  }

  function shareHtml(it) {
    const fl = V.listFields(it);
    const shortV = (v) => (v.length > 48 ? `${v.slice(0, 48)}…` : v).replace(/\n/g, ' ');
    return `<h2>Share</h2><div class="muted" style="margin:-8px 0 12px">Tick what to send. It goes as a neat message you can copy and paste.</div>
      ${fl.length ? `<span class="label">Details</span>${fl.map((f) => `<label class="vck"><input type="checkbox" data-act="vShTick" data-k="${esc(f.key)}" ${sh.keys.has(f.key) ? 'checked' : ''}><span class="grow"><b>${esc(f.l)}</b><span>${f.secret ? 'Secret, hidden here' : esc(shortV(f.v))}</span></span></label>`).join('')}
        ${fl.some((f) => f.secret) ? '<div class="muted" style="margin:6px 0 4px;line-height:1.5">Passwords, CVV and PINs stay off unless you tick them. Think twice before sending them.</div>' : ''}` : '<div class="muted" style="margin-bottom:8px">This item has no details, only files.</div>'}
      ${it.files.length ? `<span class="label" style="margin-top:14px">Files</span>${it.files.map((f) => `<label class="vck"><input type="checkbox" data-act="vShFile" data-fid="${esc(f.id)}" ${sh.files.has(f.id) ? 'checked' : ''}><span class="grow"><b>${esc(f.n || `${f.id}.${f.x}`)}</b><span>${esc(f.x.toUpperCase())} · ${V.fmtSize(f.size)}</span></span></label>`).join('')}` : ''}
      <span class="label" style="margin-top:14px">Message preview</span><pre class="vprev" id="vsh-prev"></pre>
      <div class="grid2" style="margin-top:12px"><button class="btn alt" data-act="vShCopy">Copy text</button><button class="btn" data-act="vShGo">${svg('share')}Share</button></div>
      <button class="btn alt" style="margin-top:10px" data-act="vBack">Back</button>
      <div class="muted" style="margin-top:10px;line-height:1.5">WhatsApp may drop the text when you send several files at once. Then use Copy text and paste it.</div>`;
  }

  function paintShare() {
    const it = sh && find(sh.id), el = $('vsh-prev');
    if (el && it) el.textContent = V.shareText(it, sh.keys) || 'Nothing ticked yet.';
  }

  function openShare(it, fileId) {
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; }
    sh = { id: it.id, keys: new Set(V.listFields(it).filter((f) => !f.secret).map((f) => f.key)), files: new Set(fileId ? [fileId] : []) };
    setSheet(shareHtml(it));
    paintShare();
  }

  async function shareNow() {
    const it = key && sh && find(sh.id);
    if (!it) return;
    const text = V.shareText(it, sh.keys);
    const files = it.files.filter((f) => sh.files.has(f.id));
    if (!text && !files.length) { await ui.alert('Tick at least one detail or file to share.', 'Nothing to share'); return; }
    if (!Capacitor.isNativePlatform()) {
      // desktop test: the text is copied, files are downloaded
      if (text) await copyText(text);
      for (const f of files) { const plain = await plainOf(f); if (plain) await sendOut(f, plain, 'share'); }
      ui.note(text ? 'Text copied' + (files.length ? ' and files downloaded.' : '.') : 'Files downloaded.');
      return;
    }
    markBusy();
    const uris = [];
    for (const f of files) {
      const plain = await plainOf(f);
      if (!plain) return;
      const tmp = await F.putTemp(f.id, f.x, plain);
      uris.push(tmp.uri);
    }
    clearTimeout(tmpTimer);
    tmpTimer = setTimeout(() => F.clearTemp(), 300000);
    try { await Share.share({ title: it.title, text: text || undefined, files: uris.length ? uris : undefined, dialogTitle: 'Share' }); } catch (e) { /* share sheet closed */ }
  }

  // ---------- backup of the whole Vault (one encrypted file) ----------
  async function backup() {
    if (!key) return;
    const files = [];
    let total = 0;
    for (const it of items) {
      for (const f of it.files) {
        const bytes = await F.getBytes(f.id, f.x);
        if (!bytes) continue;
        total += bytes.length;
        if (total > 60 * 1024 * 1024) { await ui.alert('Your files add up to more than 60 MB, which is too much for one backup file. Remove a few large files first.', 'Too big to back up'); return; }
        files.push({ id: f.id, x: f.x, d: V.b64(bytes) });
      }
    }
    const text = JSON.stringify({ app: 'prysm-vault', v: 1, vault: S().vault, files });
    const name = `prysm-vault-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      if (Capacitor.isNativePlatform()) {
        markBusy();
        const r = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
        try { await Share.share({ title: name, url: r.uri, dialogTitle: 'Save vault backup' }); } catch (e) { /* share sheet closed */ }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name; a.click();
      }
      ui.note(`Vault backup made (${files.length} file${files.length === 1 ? '' : 's'}). Only your PIN can open it.`);
    } catch (e) { await ui.alert('Could not write the backup file.', 'Backup failed'); }
  }

  function pickRestore() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      busyUntil = Date.now() + 5000;
      const f = inp.files[0];
      if (!f) return;
      try {
        const p = JSON.parse(await f.text());
        const vault = p && p.app === 'prysm-vault' ? V.cleanVault(p.vault) : null;
        if (!vault) throw new Error('bad');
        const ok = /^[a-z0-9]{4,24}$/, xo = /^[a-z0-9]{1,5}$/;
        pendingRestore = { vault, files: (Array.isArray(p.files) ? p.files : []).filter((x) => x && ok.test(String(x.id)) && xo.test(String(x.x)) && typeof x.d === 'string') };
        setSheet(`<h2>Restore Vault</h2><div class="sec" style="line-height:1.55">Type the Vault PIN this backup was made with.${S().vault ? ' <b>It replaces the Vault on this phone.</b>' : ''}</div>${pinField('v-rpin', 'PIN of the backup')}<div id="v-rerr" class="verr" hidden></div>
          <div class="grid2"><button class="btn alt" data-act="closeModal">Cancel</button><button class="btn" data-act="vRestoreGo">Restore</button></div>`);
        setTimeout(() => $('v-rpin') && $('v-rpin').focus(), 80);
      } catch (e) { await ui.alert('This is not a Prysm vault backup file.', 'Cannot restore'); }
    };
    markBusy();
    inp.click();
  }

  async function restoreGo() {
    const pin = $('v-rpin') ? $('v-rpin').value : '';
    if (!pendingRestore || !pin) return;
    const r = pendingRestore;
    let k, list;
    try { k = await V.unlock(r.vault, pin); list = V.cleanItems(await V.openJson(k, r.vault.blob)); } catch (e) {
      const el = $('v-rerr'); if (el) { el.textContent = 'That PIN does not open this backup.'; el.hidden = false; }
      return;
    }
    await F.wipeAll();
    for (const f of r.files) { try { await F.putBytes(f.id, f.x, V.unb64(f.d)); } catch (e) { /* storage full: the file stays missing */ } }
    S().vault = { ...r.vault, fails: 0, until: 0 };
    await dropBio(); // the fingerprint lock belonged to the old data key
    items = list;
    await db.save();
    await afterOpen(k);
    pendingRestore = null;
    closeModal(true);
    render();
    ui.note(`Vault restored: ${list.length} item${list.length === 1 ? '' : 's'}.`);
  }

  // ---------- actions ----------
  const actions = {
    vCreate: async () => {
      const a = $('v-pin') ? $('v-pin').value : '', b = $('v-pin2') ? $('v-pin2').value : '';
      error = V.pinProblem(a) || (a !== b ? 'The two PINs do not match.' : '');
      if (error) { render(); return; }
      working = true; render();
      try {
        const r = await V.create(a);
        S().vault = r.vault;
        items = [];
        await db.save();
        await afterOpen(r.key);
        error = '';
      } catch (e) { error = 'Could not create the Vault on this device.'; }
      working = false;
      render();
    },
    vUnlock: async () => {
      const v = S().vault;
      const pin = $('v-pin') ? $('v-pin').value : '';
      if (!v || !pin || working) return;
      if (v.until > Date.now()) { render(); return; }
      working = true; error = ''; render();
      try {
        await open(v, pin);
        if (v.fails || v.until) { v.fails = 0; v.until = 0; db.save(); }
        buzz('ok');
      } catch (e) {
        v.fails = (v.fails || 0) + 1;
        v.until = Date.now() + V.waitAfter(v.fails);
        db.save();
        error = 'Wrong PIN.';
        buzz('warn');
      }
      working = false;
      render();
    },
    vLock: () => lock(true),
    vBioUnlock: () => bioUnlock(false),
    vBioToggle: async () => {
      if (!key || !bio) return;
      if (bio.enabled) {
        if (!(await ui.confirm('Turn off fingerprint unlock? You will use your PIN to open the Vault.', { title: 'Fingerprint unlock', ok: 'Turn off' }))) return;
        await dropBio();
        ui.note('Fingerprint unlock is off.');
        render();
        return;
      }
      setSheet(`<h2>Turn on fingerprint unlock</h2><div class="sec" style="line-height:1.55">Type your Vault PIN once to confirm it is you. Then touch the sensor. After that the Vault opens with your fingerprint, and the PIN still works.</div>${pinField('v-bpin', 'Vault PIN')}<div id="v-berr" class="verr" hidden></div>
        <div class="muted" style="margin:0 0 12px;line-height:1.55">Anyone whose fingerprint is saved on this phone can then open the Vault. If a fingerprint is added or removed on the phone, this switches off by itself and the PIN is needed again.</div>
        <div class="grid2"><button class="btn alt" data-act="closeModal">Cancel</button><button class="btn" data-act="vBioGo">Continue</button></div>`);
      setTimeout(() => $('v-bpin') && $('v-bpin').focus(), 80);
    },
    vBioGo: async () => {
      const say = (m) => { const el = $('v-berr'); if (el) { el.textContent = m; el.hidden = !m; } };
      const pin = $('v-bpin') ? $('v-bpin').value : '';
      if (!key || !pin) return;
      let raw;
      try { raw = await V.unlockRaw(S().vault, pin); } catch (e) { say('That PIN is wrong.'); return; }
      markBusy();
      try {
        await plugin.bioEnroll({ data: V.b64(raw) });
        bio.enabled = true;
        closeModal();
        ui.note('Fingerprint unlock is on.');
        render();
      } catch (e) {
        const code = String((e && (e.code || e.message)) || '');
        say(/cancel/i.test(code) ? 'Cancelled. Fingerprint unlock is still off.' : /none/i.test(code) ? 'No fingerprint is saved on this phone. Add one in the phone settings first.' : 'Could not turn it on. Update the app and try again.');
      }
      raw.fill(0);
    },
    vForgot: async () => {
      if (!(await ui.confirm('There is no way to recover a forgotten PIN. To use the Vault again it has to be erased: every saved item and picture in it is deleted. If you have a vault backup file, use Restore backup instead (it needs the same PIN).', { title: 'Erase the Vault?', ok: 'Erase everything', danger: true }))) return;
      if (!(await ui.confirm('Last check. This deletes all documents, passwords and notes in the Vault for good.', { title: 'Really erase?', ok: 'Yes, erase', danger: true }))) return;
      S().vault = null; items = []; key = null; error = '';
      await dropBio();
      await F.wipeAll();
      await db.save();
      render();
    },
    vFilter: (el) => { filter = el.dataset.v; render(); },
    vAdd: () => { if (key) typeSheet(); },
    vNew: (el) => { if (key && V.TYPE[el.dataset.t]) form(null, el.dataset.t); },
    vOpen: (el) => { const it = key && find(el.dataset.id); if (it) { draft = { id: it.id }; openModal(detailHtml(it)); } },
    vReveal: (el) => {
      const it = key && draft && find(draft.id);
      if (!it) return;
      const k = `${it.id}:${el.dataset.k}`;
      if (shown.has(k)) shown.delete(k); else { shown.add(k); setTimeout(() => { if (shown.delete(k) && key && draft && draft.id === it.id && !editing && !viewUrl) setSheet(detailHtml(it)); }, 15000); }
      setSheet(detailHtml(it));
    },
    vCopy: async (el) => {
      const it = key && draft && find(draft.id);
      const f = it && V.listFields(it).find((x) => x.key === el.dataset.k);
      if (!f) return;
      try { await navigator.clipboard.writeText(f.v); } catch (e) {
        const t = document.createElement('textarea'); t.value = f.v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (err) { /* no clipboard */ } t.remove();
      }
      buzz('ok');
      const mine = ++copyToken;
      // a copied password or PIN is wiped from the clipboard after half a minute, unless something newer was copied meanwhile
      if (f.secret) setTimeout(() => { if (mine === copyToken) { try { navigator.clipboard.writeText(' '); } catch (e) { /* not allowed in the background */ } } }, 30000);
      ui.note(f.secret ? `${f.l} copied. It clears in 30 seconds.` : `${f.l} copied.`);
    },
    vFav: async () => { const it = key && draft && find(draft.id); if (!it) return; it.fav = !it.fav; await persist(); setSheet(detailHtml(it)); render(); },
    vEdit: () => { const it = key && draft && find(draft.id); if (it) form(it); },
    vDelete: () => { const it = key && draft && find(draft.id); if (it) remove(it); },
    vCancel: () => {
      const id = draft && draft.id;
      const it = id && find(id);
      draft = null;
      // files added in an abandoned form are swept at the next unlock
      if (it) { draft = { id }; editing = false; setSheet(detailHtml(it)); } else { editing = false; closeModal(); }
    },
    vSave: save,
    vPreset: (el) => { const t = $('vf-title'); if (t) t.value = el.dataset.v; },
    vEye: (el) => { const i = $(`vf-${el.dataset.k}`); if (i) i.type = i.type === 'password' ? 'text' : 'password'; },
    vGen: (el) => { const i = $(`vf-${el.dataset.k}`); if (i) { i.value = V.genPassword(16); i.type = 'text'; } },
    vAddFile: (el) => addFile(!!el.dataset.cam),
    vFileDel: (el) => { if (!draft) return; readForm(); draft.files = draft.files.filter((f) => f.id !== el.dataset.fid); const box = $('vf-files'); if (box) box.innerHTML = filesBlock(); },
    vView: async (el) => { const it = key && draft && find(draft.id); const f = it && it.files.find((x) => x.id === el.dataset.fid); if (f) await viewFile(it, f); },
    vShare: (el) => { const it = key && draft && find(draft.id); if (it && it.files.some((x) => x.id === el.dataset.fid)) openShare(it, el.dataset.fid); },
    vShareOpen: () => { const it = key && draft && find(draft.id); if (it) openShare(it, ''); },
    vShTick: (el) => { if (!sh) return; if (el.checked) sh.keys.add(el.dataset.k); else sh.keys.delete(el.dataset.k); paintShare(); },
    vShFile: (el) => { if (!sh) return; if (el.checked) sh.files.add(el.dataset.fid); else sh.files.delete(el.dataset.fid); paintShare(); },
    vShCopy: async () => {
      const it = key && sh && find(sh.id);
      const text = it && V.shareText(it, sh.keys);
      if (!text) { await ui.alert('Tick at least one detail to copy.', 'Nothing to copy'); return; }
      await copyText(text);
      ui.note('Details copied. Paste them in any chat.');
    },
    vShGo: shareNow,
    vXAdd: (el) => {
      if (!draft || !draft.extra) return;
      readForm();
      if (draft.extra.length >= V.MAX_EXTRA) return;
      draft.extra.push({ l: el.dataset.l || '', v: '', s: false });
      const box = $('vf-extra'); if (box) box.innerHTML = extraBlock();
      const rows = document.querySelectorAll('#vf-extra .vx');
      const row = rows[rows.length - 1];
      if (row) { row.scrollIntoView({ block: 'center' }); setTimeout(() => row.querySelector(el.dataset.l ? '.vx-v' : '.vx-l').focus(), 120); }
    },
    vXDel: (el) => { if (!draft) return; readForm(); draft.extra.splice(Number(el.dataset.i), 1); const box = $('vf-extra'); if (box) box.innerHTML = extraBlock(); },
    vXSecret: (el) => { if (!draft) return; readForm(); const e = draft.extra[Number(el.dataset.i)]; if (e) e.s = !e.s; const box = $('vf-extra'); if (box) box.innerHTML = extraBlock(); },
    vZoom: () => { const b = $('v-img'); if (b) b.classList.toggle('zoom'); },
    vBack: () => { const it = key && draft && find(draft.id); if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; } if (it) setSheet(detailHtml(it)); else closeModal(); },
    vPinForm: () => {
      if (!key) return;
      setSheet(`<h2>Change Vault PIN</h2>${pinField('v-old', 'Current PIN')}${pinField('v-new', 'New PIN')}${pinField('v-new2', 'New PIN again')}<div id="v-perr" class="verr" hidden></div>
        <div class="grid2"><button class="btn alt" data-act="closeModal">Cancel</button><button class="btn" data-act="vPinGo">Change PIN</button></div>`);
    },
    vPinGo: async () => {
      const say = (m) => { const el = $('v-perr'); if (el) { el.textContent = m; el.hidden = !m; } };
      const o = $('v-old').value, a = $('v-new').value, b = $('v-new2').value;
      const bad = V.pinProblem(a) || (a !== b ? 'The two new PINs do not match.' : a === o ? 'The new PIN is the same as the old one.' : '');
      if (bad) { say(bad); return; }
      try { const r = await V.rewrap(S().vault, o, a); Object.assign(S().vault, r, { fails: 0, until: 0 }); await db.save(); closeModal(); ui.note('Vault PIN changed.'); } catch (e) { say('The current PIN is wrong.'); }
    },
    vBackup: backup,
    vRestore: pickRestore,
    vRestoreGo: restoreGo,
  };

  // ---------- events ----------
  document.addEventListener('input', (e) => {
    if (e.target.id === 'v-q' && key) { query = e.target.value; const l = $('v-list'); if (l) l.innerHTML = listHtml(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'v-pin') { if (S().vault) actions.vUnlock(); else if ($('v-pin2')) $('v-pin2').focus(); }
    else if (e.target.id === 'v-pin2') actions.vCreate();
    else if (e.target.id === 'v-rpin') restoreGo();
    else if (e.target.id === 'v-bpin') actions.vBioGo();
  });
  document.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);
  document.addEventListener('visibilitychange', () => {
    if (!key) return;
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() > busyUntil && Date.now() - hiddenAt > AWAY_LOCK) lock(true);
  });
  setInterval(() => { if (key && Date.now() > busyUntil && Date.now() - lastTouch > IDLE_LOCK) lock(true); }, 15000);
  F.clearTemp(); // a readable copy left behind by a closed app is removed at start

  // a tab other than the Vault page was opened: lock (called by render())
  const leave = (tab) => { if (key && tab !== 'vault') lock(false); };

  function widget() {
    return `<div class="card dcard"><div class="dhead"><h2>Vault</h2><button class="link" data-act="goVault">Open</button></div>
      <div class="drow"><span class="vic" style="--c:#a78bfa">${svg('vault')}</span><div class="grow"><div class="t-title">Documents and passwords</div><div class="t-meta">${S().vault ? 'Locked. Opens with your PIN' : 'Not set up yet'}</div></div></div></div>`;
  }

  // the Vault page was opened: with fingerprint unlock on, the prompt comes up by itself
  async function onOpen() {
    if (key || !S().vault) return;
    await refreshBio();
    if (bio.enabled && getTab() === 'vault') bioUnlock(true);
    else if (getTab() === 'vault') render();
  }

  return { view, actions, leave, widget, lock, unlocked, onOpen };
}
