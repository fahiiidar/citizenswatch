// Private moderation page. Open it at  /#/moderate  and enter your moderator key.
import { html, icon, mount, toast } from './ui.js';
import { api, store } from './api.js';
import { CATS, STATUS, FLAG_REASONS, timeAgo, whenLabel, whereLabel, catTitle } from './format.js';

const page = document.getElementById('page');
const QUEUES = [
  ['flagged', 'Flagged'],
  ['media', 'New with photos'],
  ['disputed', 'Disputed'],
  ['updates', 'Added updates'],
  ['hidden', 'Hidden'],
  ['recent', 'All recent'],
];
let queue = 'flagged';
let data = null;
let confirmDelete = null;

export function openModerate() {
  const key = store('cw_mod');
  if (!key) return renderLogin();
  load();
}

function shell(inner) {
  return html`<section class="page mod" aria-label="Moderation">
    <header style="background:#fff;border-bottom:1px solid var(--line);padding:0 20px;flex:none">
      <div style="max-width:1180px;margin:0 auto;min-height:60px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <a href="#/" style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:var(--ink);text-decoration:none">${icon('back', 20)}CitizensWatch <span style="font-weight:500;color:var(--muted)">Moderation</span></a>
        ${data ? html`<span class="sub" style="display:flex;align-items:center;gap:12px">Signed in as ${data.moderator}
          <button type="button" class="act" id="logout">Sign out</button></span>` : ''}
      </div>
    </header>
    <div class="page-scroll">${inner}</div>
  </section>`;
}

function renderLogin(error) {
  data = null;
  mount(page, shell(html`<form class="mod-wrap" id="login" style="max-width:420px">
    <h1 class="big">Moderator sign in</h1>
    <p class="lead" style="margin:0">Enter the moderator key you were given. It stays on this device until you sign out.</p>
    <label for="key" class="field-label">Moderator key</label>
    <input id="key" class="input" type="password" autocomplete="current-password" required minlength="16">
    ${error ? html`<p class="error-text">${error}</p>` : ''}
    <button class="btn" type="submit">Sign in</button>
  </form>`));
  page.querySelector('#login').addEventListener('submit', (e) => {
    e.preventDefault();
    store('cw_mod', page.querySelector('#key').value.trim());
    load();
  });
}

async function load() {
  const key = store('cw_mod');
  try {
    data = await api.modQueue(key, queue);
    render();
  } catch (err) {
    if (err.status === 401) { store('cw_mod', null); return renderLogin('That key was not recognised.'); }
    mount(page, shell(html`<div class="mod-wrap"><p class="empty">${err.message}</p></div>`));
  }
}

function render() {
  const c = data.counts;
  mount(page, shell(html`<div class="mod-wrap">
    <div>
      <h1 class="big">Review queue</h1>
      <p class="lead">Work through flagged reports first. Hidden reports can be restored.</p>
    </div>
    <div class="mod-stats">
      <div class="mod-stat"><span class="sub">Flags waiting</span><b style="color:var(--red-icon)">${c.flagged}</b></div>
      <div class="mod-stat"><span class="sub">New with photos</span><b>${c.media}</b></div>
      <div class="mod-stat"><span class="sub">Disputed</span><b>${c.disputed}</b></div>
      <div class="mod-stat"><span class="sub">Reports today</span><b>${c.today}</b></div>
      <div class="mod-stat"><span class="sub">Hidden today</span><b>${c.hiddenToday}</b></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Queues">
      ${QUEUES.map(([k, label]) => html`<button type="button" class="tab" role="tab" data-q="${k}" aria-selected="${queue === k}">${label}
        ${k === 'flagged' ? html`<span class="cnt" style="${c.flagged ? 'background:var(--red-soft);color:var(--red-ink)' : ''}">${c.flagged}</span>` : ''}
        ${k === 'media' ? html`<span class="cnt">${c.media}</span>` : ''}
        ${k === 'disputed' ? html`<span class="cnt">${c.disputed}</span>` : ''}
        ${k === 'updates' ? html`<span class="cnt">${c.updates || 0}</span>` : ''}</button>`)}
    </div>
    ${queue === 'updates'
      ? (data.updates.length ? data.updates.map(updateCard) : html`<p class="empty">No new updates to review.</p>`)
      : (data.reports.length ? data.reports.map(card) : html`<p class="empty">Nothing waiting here.</p>`)}
  </div>`));

  page.querySelector('#logout')?.addEventListener('click', () => { store('cw_mod', null); renderLogin(); });
  page.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { queue = b.dataset.q; load(); }));
  page.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b)));
}

function card(r) {
  const cat = CATS[r.category] || CATS.other;
  const reasons = Object.entries(r.flag_reasons || {});
  return html`<article class="mod-card">
    ${r.media_items.length ? html`<div class="mod-media">${r.media_items.map((m) => (m.url
      ? (m.type.startsWith('video/') ? html`<video src="${m.url}" controls muted playsinline preload="metadata"></video>` : html`<a href="${m.url}" target="_blank" rel="noopener"><img src="${m.url}" alt="Report photo"></a>`)
      : ''))}</div>` : ''}
    <div style="flex:999 1 360px;min-width:0;display:flex;flex-direction:column;gap:6px">
      <span class="row-top"><b class="cat-${cat.tone}" style="font-weight:600">${catTitle(r)}</b>
        <span class="sub">${whereLabel(r)}</span><span class="sub">${whenLabel(r)} · posted ${timeAgo(r.created_at)}</span></span>
      <span style="line-height:1.45;white-space:pre-wrap">${r.caption}</span>
      <span class="row-top">
        ${r.hidden ? html`<span class="badge past">Hidden${r.hidden_reason ? `: ${r.hidden_reason}` : ''}</span>` : html`<span class="badge ${r.status}">${STATUS[r.status]}</span>`}
        ${r.mod_override ? html`<span class="badge past">Set by moderator</span>` : ''}
        ${r.sensitive ? html`<span class="badge past">Blurred</span>` : ''}
        ${r.old_media ? html`<span class="flagchip" style="background:var(--amber-soft);color:var(--amber-ink)">Photo may be old</span>` : ''}
        ${r.updates ? html`<span class="badge past">${r.updates} update${r.updates === 1 ? '' : 's'}</span>` : ''}
        ${reasons.map(([k, n]) => html`<span class="flagchip">${(FLAG_REASONS[k] || k).split(',')[0]} · ${n}</span>`)}
        <span class="sub">${r.confirms} confirm · ${r.falses} false · phone ${r.device}</span>
      </span>
    </div>
    <div class="mod-actions">
      ${r.hidden
        ? html`<button type="button" class="act pri" data-act="restore" data-id="${r.id}">Restore</button>`
        : html`<button type="button" class="act" data-act="approve" data-id="${r.id}">Approve</button>
          <button type="button" class="act pri" data-act="hide" data-id="${r.id}">Hide</button>`}
      ${r.media_items.length ? html`<button type="button" class="act" data-act="sensitive" data-value="${r.sensitive ? '' : '1'}" data-id="${r.id}">${r.sensitive ? 'Unblur' : 'Blur media'}</button>` : ''}
      <button type="button" class="act" data-act="override" data-value="${r.mod_override === 'corroborated' ? '' : 'corroborated'}" data-id="${r.id}">${r.mod_override === 'corroborated' ? 'Clear corroborated' : 'Mark corroborated'}</button>
      <button type="button" class="act" data-act="override" data-value="${r.mod_override === 'disputed' ? '' : 'disputed'}" data-id="${r.id}">${r.mod_override === 'disputed' ? 'Clear disputed' : 'Mark disputed'}</button>
      <button type="button" class="act danger" data-act="block" data-id="${r.id}">Block phone</button>
      <button type="button" class="act danger" data-act="delete" data-id="${r.id}">${confirmDelete === r.id ? 'Tap again to delete' : 'Delete'}</button>
    </div>
  </article>`;
}

function updateCard(u) {
  const cat = u.report ? (CATS[u.report.category] || CATS.other) : CATS.other;
  const reasons = Object.entries(u.flag_reasons || {});
  return html`<article class="mod-card">
    ${u.media_items.length ? html`<div class="mod-media">${u.media_items.map((m) => (m.url
      ? (m.type.startsWith('video/') ? html`<video src="${m.url}" controls muted playsinline preload="metadata"></video>` : html`<a href="${m.url}" target="_blank" rel="noopener"><img src="${m.url}" alt="Update photo"></a>`)
      : ''))}</div>` : ''}
    <div style="flex:999 1 360px;min-width:0;display:flex;flex-direction:column;gap:6px">
      <span class="row-top"><span class="sub">Update on</span><a href="#/r/${u.report_id}" class="cat-${cat.tone}" style="font-weight:600;text-decoration:none">${cat.name}${u.report ? ` · ${whereLabel(u.report)}` : ''}</a><span class="sub">${timeAgo(u.created_at)}</span></span>
      ${u.caption ? html`<span style="line-height:1.45;white-space:pre-wrap">${u.caption}</span>` : html`<span class="sub">Photos only</span>`}
      <span class="row-top">
        ${u.hidden ? html`<span class="badge past">Hidden${u.hidden_reason ? `: ${u.hidden_reason}` : ''}</span>` : ''}
        ${u.sensitive ? html`<span class="badge past">Blurred</span>` : ''}
        ${u.old_media ? html`<span class="flagchip" style="background:var(--amber-soft);color:var(--amber-ink)">Photo may be old</span>` : ''}
        ${reasons.map(([k, n]) => html`<span class="flagchip">${(FLAG_REASONS[k] || k).split(',')[0]} · ${n}</span>`)}
        <span class="sub">phone ${u.device}</span>
      </span>
    </div>
    <div class="mod-actions">
      ${u.hidden
        ? html`<button type="button" class="act pri" data-act="restore" data-target="update" data-id="${u.id}">Restore</button>`
        : html`<button type="button" class="act" data-act="approve" data-target="update" data-id="${u.id}">Approve</button>
          <button type="button" class="act pri" data-act="hide" data-target="update" data-id="${u.id}">Hide</button>`}
      ${u.media_items.length ? html`<button type="button" class="act" data-act="sensitive" data-target="update" data-value="${u.sensitive ? '' : '1'}" data-id="${u.id}">${u.sensitive ? 'Unblur' : 'Blur media'}</button>` : ''}
      <button type="button" class="act danger" data-act="block" data-target="update" data-id="${u.id}">Block phone</button>
      <button type="button" class="act danger" data-act="delete" data-target="update" data-id="${u.id}">${confirmDelete === u.id ? 'Tap again to delete' : 'Delete'}</button>
    </div>
  </article>`;
}

async function act(btn) {
  const { act: action, id, target } = btn.dataset;
  if (action === 'delete' && confirmDelete !== id) {
    confirmDelete = id;
    render();
    return;
  }
  confirmDelete = null;
  let value;
  if (action === 'override') value = btn.dataset.value || null;
  if (action === 'sensitive') value = btn.dataset.value === '1';
  btn.disabled = true;
  try {
    await api.modAct(store('cw_mod'), { id, action, value, target });
    toast({
      approve: 'Approved.', hide: 'Hidden from the map.', restore: 'Back on the map.', delete: 'Deleted for good.',
      block: 'Phone blocked and its reports hidden.', sensitive: 'Updated.', override: 'Status updated.',
    }[action]);
    load();
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}
