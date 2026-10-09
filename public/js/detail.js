// One report, opened from the map, a list or a shared link.
import { html, icon, tip, mount, openModal, toast, shareReport } from './ui.js';
import { api, mine } from './api.js';
import { CATS, STATUS, FLAG_REASONS, whenLabel, timeAgo, whereLabel } from './format.js';
import { state } from './state.js';

const page = document.getElementById('page');
let current = null;
let mediaIndex = 0;
let revealed = false;
const revealedUpdates = new Set();

export async function openDetail(id) {
  current = null;
  mediaIndex = 0;
  revealed = false;
  revealedUpdates.clear();
  mount(page, html`<section class="page" aria-label="Report">
    ${head()}
    <div class="page-scroll"><p class="empty">Loading report…</p></div></section>`);
  try {
    const { reports } = await api.detail(id);
    if (!reports.length) {
      mount(page.querySelector('.page-scroll'), html`<p class="empty">This report is no longer available. It may have been removed by a moderator.</p>`);
      return;
    }
    current = reports[0];
    render();
  } catch (err) {
    mount(page.querySelector('.page-scroll'), html`<p class="empty">${err.message}</p>`);
  }
}

function head() {
  return html`<header class="page-head">
    <a class="round-btn" href="#/" aria-label="Back to the map">${icon('back', 22)}</a>
    <span class="t">Report</span>
    <button type="button" class="round-btn" id="share" aria-label="Share this warning" ${current ? '' : 'disabled'}>${icon('share', 20)}</button>
  </header>`;
}

function render() {
  const r = current;
  const c = CATS[r.category] || CATS.other;
  const posted = mine.posted().has(r.id);
  const voted = mine.votes()[r.id] || {};
  const media = r.media_items.filter((m) => m.url);

  mount(page.firstElementChild, html`
    ${head()}
    <div class="page-scroll"><div class="wrap" style="padding-bottom:16px">
      ${media.length ? mediaBlock(media, r.sensitive) : ''}
      ${r.old_media ? html`<div class="old-banner" role="note">${icon('clock', 18)}<span style="flex:1">The photo may be older than this report.</span>${tip('oldPhoto', 'What this warning means', 'inherit')}</div>` : ''}
      <div style="padding:18px 20px 0;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:12px;align-items:center">
          <span class="ct lg ${c.tone}">${icon(c.icon, 22)}</span>
          <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
            <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;line-height:1.1">${c.name}</h1>
            <span class="row-top sub">${r.live ? html`<span class="badge live">Live</span>` : r.is_now ? '' : html`<span class="badge past">Reported later</span>`}${whenLabel(r)} · posted ${timeAgo(r.created_at)}</span>
          </div>
        </div>
        <p style="margin:0;font-size:16px;line-height:1.55;color:#1C2A22;white-space:pre-wrap">${r.caption}</p>
        <div class="info-row">
          ${icon('pin', 18, 'style="color:var(--muted)"')}
          <span style="flex:1;min-width:0">${whereLabel(r)}</span>
          <span class="sub" style="display:flex;align-items:center;gap:2px">About 1 km ${tip('approx', 'Why the place is approximate')}</span>
        </div>
      </div>
      ${verifyBlock(r)}
      ${updatesBlock(r)}
    </div></div>
    <div class="page-foot"><div class="wrap" style="display:flex;flex-direction:column;gap:10px">
      ${posted ? html`<div class="done-note">${icon('check', 20)}You posted this report</div>`
        : voted.confirm ? html`<div class="done-note">${icon('check', 20)}You confirmed this</div>`
          : html`<button type="button" class="btn blue" id="confirm">${icon('check', 20, 'style="stroke-width:2.4"')}I can confirm this</button>`}
      <div class="btn-row">
        <button type="button" class="btn ghost" id="false" ${posted || voted.false ? 'disabled' : ''}>${icon('xcircle', 18)}${voted.false ? 'Marked false' : 'False or old'}</button>
        <button type="button" class="btn ghost" id="flag" ${voted.flag ? 'disabled' : ''}>${icon('flag', 18)}${voted.flag ? 'Flagged' : 'Flag'}</button>
      </div>
      <span class="small-note">Posted anonymously · In danger? Call 112</span>
    </div></div>`);

  bind();
}

function mediaBlock(media, sensitive) {
  const m = media[mediaIndex] || media[0];
  const isVideo = m.type.startsWith('video/');
  const blurred = sensitive && !revealed;
  return html`<div class="hero-media ${blurred ? 'blurred' : ''}">
    ${isVideo
      ? html`<video src="${m.url}" ${blurred ? '' : 'controls'} playsinline preload="metadata"></video>`
      : html`<img src="${m.url}" alt="Photo from the report">`}
    ${blurred ? html`<div class="hero-over">
      <span class="ring">${icon('eyeoff', 22)}</span>
      <span style="font-weight:600">May be upsetting</span>
      <button type="button" class="pill-light" id="reveal">Tap to view</button>
    </div>` : ''}
    ${media.length > 1 ? html`
      <button type="button" class="hero-nav" style="left:10px" id="prev" aria-label="Previous photo">${icon('back', 20)}</button>
      <button type="button" class="hero-nav" style="right:10px" id="next" aria-label="Next photo">${icon('next', 20)}</button>
      <span class="hero-tag" style="left:12px">${mediaIndex + 1} / ${media.length}</span>` : ''}
    <span class="hero-tag" style="right:12px">${icon('check', 13, 'style="stroke-width:2.6"')}Hidden data removed</span>
  </div>`;
}

function updatesBlock(r) {
  const items = r.update_items || [];
  return html`<section class="updates" aria-label="Updates from people nearby">
    <div class="updates-head">
      <span class="field-label" style="display:flex;align-items:center;gap:2px">Updates from people nearby${items.length ? ` (${items.length})` : ''} ${tip('updates', 'About updates')}</span>
    </div>
    ${items.length ? items.map((u, i) => html`<div class="update">
      <span class="update-rail" aria-hidden="true"><i></i>${i < items.length - 1 ? html`<b></b>` : ''}</span>
      <div class="update-body">
        <span class="sub">${timeAgo(u.created_at)}${u.old_media ? html` · <span style="color:var(--amber-ink);font-weight:600">photo may be old</span>` : ''}</span>
        ${u.caption ? html`<p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap">${u.caption}</p>` : ''}
        ${u.media_items.some((m) => m.url) ? html`<div class="update-media">${u.media_items.filter((m) => m.url).map((m) => {
          const blurred = u.sensitive && !revealedUpdates.has(u.id);
          return html`<div class="cell ${blurred ? 'blurred' : ''}">
            ${m.type.startsWith('video/') ? html`<video src="${m.url}" ${blurred ? '' : 'controls'} playsinline preload="metadata"></video>` : html`<img src="${m.url}" alt="Photo added by someone nearby" loading="lazy">`}
            ${blurred ? html`<button type="button" data-reveal-update="${u.id}">Tap to view</button>` : ''}
          </div>`;
        })}</div>` : ''}
        <span><button type="button" class="link-btn" data-flag-update="${u.id}">Flag this update</button></span>
      </div>
    </div>`) : html`<p class="sub" style="margin:0;line-height:1.5">Were you there too? Add your own photos or what you saw. It also counts as a confirmation.</p>`}
    <a class="btn ghost" href="#/r/${r.id}/add" style="height:46px;font-size:15px">${icon('camera', 18)}Add photos or an update</a>
  </section>`;
}

function verifyBlock(r) {
  if (r.status === 'corroborated') {
    return html`<div class="verify">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="display:flex;align-items:center;gap:4px"><span class="badge corroborated">Corroborated</span>${tip('corroborated', 'What corroborated means')}</span>
        <span class="sub tnum">${r.confirms} confirmations</span>
      </div>
      <span style="font-size:13.5px;color:var(--text-2);line-height:1.4">Several people nearby say this happened.${r.falses ? ` ${r.falses} said it is false or old.` : ''}</span>
    </div>`;
  }
  if (r.status === 'disputed') {
    return html`<div class="verify" style="background:var(--amber-soft)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="display:flex;align-items:center;gap:4px"><span class="badge disputed">Disputed</span>${tip('disputed', 'What disputed means')}</span>
        <span class="sub tnum">${r.falses} say false · ${r.confirms} confirm</span>
      </div>
      <span style="font-size:13.5px;color:var(--amber-ink);line-height:1.4">Be careful before sharing this one.</span>
    </div>`;
  }
  const n = Math.min(r.confirms, 3);
  return html`<div class="verify">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="display:flex;align-items:center;gap:4px"><span class="badge unverified">Unverified</span>${tip('unverified', 'What unverified means')}</span>
      <span class="sub tnum">${n} of 3 confirmations</span>
    </div>
    <div class="bars" aria-hidden="true">${[0, 1, 2].map((i) => html`<span class="${i < n ? 'on' : ''}"></span>`)}</div>
    <span style="font-size:13.5px;color:var(--text-2);line-height:1.4">${3 - n} more ${3 - n === 1 ? 'person' : 'people'} nearby need to confirm it.</span>
  </div>`;
}

function bind() {
  const r = current;
  const q = (s) => page.querySelector(s);
  q('#share')?.addEventListener('click', () => shareReport({
    id: r.id,
    title: (CATS[r.category] || CATS.other).name,
    where: r.area_label || r.place_label,
  }));
  q('#reveal')?.addEventListener('click', () => { revealed = true; render(); });
  q('#prev')?.addEventListener('click', () => { mediaIndex = (mediaIndex + r.media_items.length - 1) % r.media_items.length; render(); });
  q('#next')?.addEventListener('click', () => { mediaIndex = (mediaIndex + 1) % r.media_items.length; render(); });
  q('#confirm')?.addEventListener('click', () => vote('confirm'));
  q('#false')?.addEventListener('click', () => vote('false'));
  q('#flag')?.addEventListener('click', () => openFlag((reason) => vote('flag', reason)));
  page.querySelectorAll('[data-reveal-update]').forEach((b) => b.addEventListener('click', () => {
    revealedUpdates.add(b.dataset.revealUpdate);
    render();
  }));
  page.querySelectorAll('[data-flag-update]').forEach((b) => b.addEventListener('click', () => openFlag(async (reason) => {
    try {
      const res = await api.flagUpdate(b.dataset.flagUpdate, reason);
      toast(res.hidden ? 'Thanks. That update is hidden while moderators review it.' : 'Thanks. A moderator will review it.');
      if (res.hidden) openDetail(current.id);
    } catch (err) {
      toast(err.message);
    }
  })));
}

async function vote(kind, reason) {
  const r = current;
  const buttons = page.querySelectorAll('.page-foot button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await api.vote(r.id, kind, reason);
    mine.setVote(r.id, kind);
    Object.assign(r, { confirms: res.confirms, falses: res.falses, status: res.status });
    const light = state.byId.get(r.id);
    if (light) Object.assign(light, { confirms: res.confirms, status: res.status });
    if (res.counted === false) toast('This phone has already done that for this report.');
    else toast(kind === 'confirm' ? 'Thanks. Your confirmation helps others trust this report.'
      : kind === 'false' ? 'Thanks. We count this when deciding if a report is disputed.'
        : 'Thanks. A moderator will review it.');
    if (res.hidden) {
      mount(page.querySelector('.page-scroll'), html`<p class="empty">This report has been hidden while moderators review it.</p>`);
      return;
    }
  } catch (err) {
    toast(err.message);
  }
  render();
}

function openFlag(onReason) {
  openModal({
    title: 'What is wrong with it?',
    body: html`<div role="radiogroup" aria-label="Reason">
      ${Object.entries(FLAG_REASONS).map(([k, label]) => html`
        <button type="button" class="opt" role="radio" data-reason="${k}" aria-checked="false"><span class="radio"></span><span style="flex:1">${label}</span></button>`)}
      </div>
      <div style="padding:16px 20px 0"><button type="button" class="btn" id="send" disabled>Flag report</button></div>`,
    onMount(modal, close) {
      let reason = null;
      modal.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => {
        reason = b.dataset.reason;
        modal.querySelectorAll('[data-reason]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        modal.querySelector('#send').disabled = false;
      }));
      modal.querySelector('#send').addEventListener('click', () => {
        close();
        onReason(reason);
      });
    },
  });
}
