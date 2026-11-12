// Payment-safe mode (Settings). Some payment and loan apps decline a payment while any non-Play-Store accessibility
// service is on. The phone side (PaySafe.java) switches Prysm's blocking service off while a chosen payment app is
// in front and back on when you leave it. The list and the switch are kept on the phone; this page only mirrors them.
export const ADB_COMMAND = 'adb shell pm grant com.personal.app android.permission.WRITE_SECURE_SETTINGS';

export function createPaySafe(d) {
  const { ui, openModal, closeModal, render, esc, plugin, isNative, toast, dot } = d;
  let st = null;          // what the phone said last: { on, secure, usage, paused, builtIn[], custom[] }
  let loading = false;
  let appList = null;

  async function load(redraw = true) {
    if (!isNative || loading) return;
    loading = true;
    try { st = await plugin.getPaySafe(); } catch (e) { st = { unsupported: true }; }
    loading = false;
    if (redraw) render();
  }

  const row = (name, sub, act, pkg) => `<div class="set-row"><div class="grow"><b>${esc(name)}</b><span>${esc(sub)}</span></div>${act ? `<button class="capsule" style="margin:0" data-act="${act}" data-pkg="${esc(pkg)}"><span>Remove</span></button>` : ''}</div>`;

  function card() {
    if (!isNative) return '';
    if (!st) { load(); return '<div class="card"><h2>Payment-safe mode</h2><div class="sec">Loading…</div></div>'; }
    if (st.unsupported) return '<div class="card"><h2>Payment-safe mode</h2><div class="sec">Update the app to use this.</div></div>';
    const ready = st.secure && st.usage;
    const setup = !st.secure
      ? `<div class="banner">${dot('#fbbf24')}<div><b>One-time setup from a computer</b><span>Android only lets an app switch its own accessibility service off after this is run once (it stays after updates). Plug the phone in with USB debugging on and run:</span></div></div>
         <div style="margin:10px 0;padding:12px;border-radius:12px;background:rgba(255,255,255,0.06);font-family:monospace;font-size:12px;line-height:1.5;word-break:break-all;user-select:all">${esc(ADB_COMMAND)}</div>
         <button class="btn alt" data-act="psRefresh">I did it, check again</button>`
      : !st.usage ? `<div class="banner">${dot('#fbbf24')}<div><b>Usage access is off</b><span>Prysm needs it to see when you leave the payment app. Turn it on in Screen time.</span></div></div>` : '';
    const builtIn = (st.builtIn || []).map((a) => `<span class="ptag">${esc(a.name)}</span>`).join(' ');
    const custom = (st.custom || []).map((a) => row(a.name, 'Added by you', 'psRemove', a.pkg)).join('');
    return `<div class="card"><h2>Payment-safe mode</h2>
      <div class="sec" style="line-height:1.55">Some payment and loan apps decline payments ("security reasons") while Prysm's blocking service is on. With this on, Prysm switches its blocking off while one of your payment apps is in front, and back on as soon as you leave it.</div>
      <div class="set-row"><div class="grow"><b>Pause blocking while I pay</b><span>${st.on ? (ready ? 'On' : 'On, waiting for the setup below') : 'Off'}</span></div><button class="switch ${st.on ? 'on' : ''}" role="switch" aria-checked="${!!st.on}" aria-label="Pause blocking while I pay" data-act="psToggle"><i></i></button></div>
      ${setup}
      ${st.on ? `<span class="label" style="margin-top:14px">Always covered (if installed)</span><div style="margin-bottom:6px">${builtIn || '<span class="muted">None installed</span>'}</div>
        <span class="label" style="margin-top:10px">Your payment and loan apps</span>${custom || '<div class="muted" style="margin:4px 0 8px">None yet. Add the app that declines your payments, for example your loan app.</div>'}
        <button class="btn alt" style="margin-top:6px" data-act="psAdd">Add an app</button>` : ''}
      <div class="muted" style="margin-top:12px;line-height:1.55">Rules that keep your promises safe: an app that a limit, the sleep lock or a focus session covers is never paused. Blocking comes back the moment you open anything else, when the screen goes off, or after 20 minutes at most. The first second after opening the app is not covered, so start the payment after the app has fully opened.</div></div>`;
  }

  async function save(on, custom) {
    try {
      st = await plugin.setPaySafe({ on, custom });
      const refused = (st.refused || []);
      if (refused.length) await ui.alert(refused.map((r) => `${r.name}: ${r.why}`).join('\n'), 'Not added');
    } catch (e) { toast('Could not save. Update the app.'); }
    render();
  }

  const customPkgs = () => (st && st.custom ? st.custom.map((a) => a.pkg) : []);

  async function appSheet() {
    if (!appList) {
      try { appList = (await plugin.getApps()).apps || []; } catch (e) { appList = []; }
    }
    const skip = new Set([...(st.builtIn || []).map((a) => a.pkg), ...customPkgs()]);
    const rows = (q) => appList.filter((a) => !skip.has(a.pkg) && (!q || a.name.toLowerCase().includes(q)))
      .map((a) => `<button class="app-pick" data-act="psPick" data-pkg="${esc(a.pkg)}"><span class="app-ic">${esc((a.name || '?').charAt(0).toUpperCase())}</span><span class="grow">${esc(a.name)}</span></button>`).join('')
      || '<div class="muted" style="padding:14px 0">No apps found.</div>';
    appSheet.rows = rows;
    openModal(`<h2>Add a payment app</h2><div class="muted" style="margin:-8px 0 12px">Pick the app that declines your payments.</div><input id="ps-q" placeholder="Search apps" autocomplete="off"><div class="app-list" id="ps-list">${rows('')}</div><button class="btn alt" style="margin-top:14px" data-act="closeModal">Close</button>`);
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'ps-q' && appSheet.rows && document.getElementById('ps-list')) document.getElementById('ps-list').innerHTML = appSheet.rows(e.target.value.trim().toLowerCase());
  });

  const actions = {
    psToggle: async () => {
      if (!st) return;
      const turnOn = !st.on;
      if (turnOn && !st.secure) await ui.alert('Run the one-time command shown in this card from a computer first, then switch this on.', 'One more step');
      await save(turnOn, customPkgs());
    },
    psRefresh: async () => { await load(false); render(); if (st && !st.unsupported && !st.secure) toast('Not granted yet'); },
    psAdd: () => appSheet(),
    psPick: async (el) => {
      closeModal();
      await save(true, [...customPkgs(), el.dataset.pkg]);
    },
    psRemove: async (el) => { await save(!!st.on, customPkgs().filter((p) => p !== el.dataset.pkg)); },
  };

  return { card, actions, load };
}
