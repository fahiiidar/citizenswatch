// The three-step report flow: where, what and when, then photos and posting.
import { html, icon, tip, mount, toast, shareReport, openModal } from './ui.js';
import { api, upload, mine } from './api.js';
import { CATS, CAT_KEYS, AGENCIES, catTitle, lagosDate, timeAgo, whenLabel, whereLabel, STATUS } from './format.js';
import { state } from './state.js';
import { processPhoto, processClip, canProcessClips, classifyTaken, takenLabel } from './media.js';
import { mountCheck, getToken, resetCheck } from './turnstile.js';
import * as mapMod from './map.js';
import { showHome, runSearch, refresh } from './home.js';
import { prefillUpdate } from './addupdate.js';

const page = document.getElementById('page');
const CELL = 0.01;

let draft = fresh();
let lastPosted = null;
let unbindMove = null;
let reverseTimer = null;
let skipNextMove = false;

function fresh() {
  return {
    lat: null, lng: null, placeLabel: '', areaLabel: '', placeSub: '', placeEdited: false,
    category: null, agency: null, when: 'now', date: lagosDate(), time: '', caption: '',
    media: [], keepSound: false, sensitive: false,
    checks: { face: false, forces: false, today: false },
    error: null, duplicateOf: null, posting: false, progress: 0,
  };
}

// The day being reported, used to spot photos taken long before it.
function eventDay() {
  if (draft.when === 'date') return draft.date;
  if (draft.when === 'yesterday') return lagosDate(Date.now() - 86400e3);
  return lagosDate();
}
function checkOf(m) { return classifyTaken(m.takenAt, eventDay()); }
function warnIfOld(m) {
  if (checkOf(m) === 'old') {
    toast(`This ${m.type.startsWith('video/') ? 'clip' : 'photo'} looks like it was taken on ${takenLabel(m.takenAt)}. If it isn't from this event, remove it. Old photos are marked for moderators.`, 7000);
  }
}

// The time in Nigeria now, as "HH:MM".
const nowClock = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date());

const fuzz = (v) => Math.round((Math.floor(v / CELL) * CELL + CELL / 2) * 10000) / 10000;

export function openReport(step) {
  if (unbindMove) { unbindMove(); unbindMove = null; }
  if (step === 'done') return renderDone();
  if (step !== '1' && draft.lat === null) { location.hash = '#/report/1'; return; }
  if (step === '2') return renderWhat();
  if (step === '3') return renderMedia();
  return renderWhere();
}

export function leaveReport() {
  if (unbindMove) { unbindMove(); unbindMove = null; }
  clearTimeout(reverseTimer);
}

export function resetDraft() {
  draft.media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
  draft = fresh();
}

function stepBar(n) {
  return html`<div class="steps" aria-hidden="true">${[1, 2, 3].map((i) => html`<span class="${i <= n ? 'on' : ''}"></span>`)}</div>`;
}

function header(n, backHref) {
  return html`<header class="page-head">
    ${backHref
      ? html`<a class="round-btn" href="${backHref}" aria-label="Back">${icon('back', 22)}</a>`
      : html`<a class="round-btn" href="#/" aria-label="Cancel report" id="cancel">${icon('x', 18, 'style="stroke-width:2.2"')}</a>`}
    <span class="t">New report</span>
    <span class="sub tnum" style="width:40px;text-align:right">${n}/3</span>
  </header>`;
}

// ---- Step 1: where ------------------------------------------------------------
function renderWhere() {
  const mapOk = Boolean(mapMod.getMap());
  if (mapOk) showHome(false);

  if (mapOk) {
    mount(page, html`<div class="page transparent" aria-label="Choose where it happened">
      <div class="pick-top"><div class="wrap">
        ${header(1)}
        ${stepBar(1)}
        <div style="padding:16px 20px 14px;display:flex;flex-direction:column;gap:12px">
          <h1 class="big">Where is it happening?</h1>
          ${searchField()}
        </div>
      </div></div>
      <span class="pick-ring" aria-hidden="true"></span>
      <svg class="pick-pin" width="40" height="50" viewBox="0 0 40 50" aria-hidden="true"><path d="M20 2C10.1 2 2 9.8 2 19.4 2 32.3 20 48 20 48s18-15.7 18-28.6C38 9.8 29.9 2 20 2z" fill="#0E1A14"/><circle cx="20" cy="19" r="6.5" fill="#fff"/></svg>
      <div class="pick-bottom"><div class="wrap" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:flex-end"><button type="button" class="round-btn float" id="pick-locate" aria-label="Use my current location" style="color:var(--blue)">${icon('arrow', 20)}</button></div>
        ${placeCard()}
        <button type="button" class="btn" id="next" ${draft.placeLabel ? '' : 'disabled'}>Continue${icon('next', 18, 'style="stroke-width:2.4"')}</button>
      </div></div>
    </div>`);
    mapMod.clearPadding();
    const start = JSON.parse(sessionStorage.getItem('cw_report_start') || 'null');
    sessionStorage.removeItem('cw_report_start');
    if (draft.lat !== null) mapMod.flyTo(draft.lng, draft.lat, 15, { top: 0, bottom: 0, left: 0, right: 0 });
    else if (start) mapMod.flyTo(start.lng, start.lat, 14, { top: 0, bottom: 0, left: 0, right: 0 });
    else mapMod.zoomTo(12);
    unbindMove = mapMod.onMoveEnd(onMapMoved);
    onMapMoved();
  } else {
    mount(page, html`<section class="page" aria-label="Choose where it happened">
      ${header(1)}${stepBar(1)}
      <div class="page-scroll"><div class="wrap" style="padding:20px;display:flex;flex-direction:column;gap:14px">
        <h1 class="big">Where is it happening?</h1>
        <p class="lead" style="margin:0">The map could not load, so search for the street, landmark or area instead.</p>
        ${searchField()}
        ${draft.placeLabel ? placeCard() : ''}
      </div></div>
      <div class="page-foot"><div class="wrap"><button type="button" class="btn" id="next" ${draft.placeLabel ? '' : 'disabled'}>Continue${icon('next', 18, 'style="stroke-width:2.4"')}</button></div></div>
    </section>`);
  }
  bindWhere();
}

function searchField() {
  return html`<div class="search" role="search" style="box-shadow:none;border:1.5px solid var(--line-2);height:50px">
    ${icon('search', 18, 'style="color:var(--muted)"')}
    <label for="pq" class="sr">Search a street, landmark or area</label>
    <input id="pq" type="search" placeholder="Search a street, landmark or area" autocomplete="off" enterkeyhint="search">
    <div class="results" id="presults" role="listbox" aria-label="Places" hidden style="top:56px"></div>
  </div>`;
}

function placeCard() {
  return html`<div class="place-card" id="place-card">
    <label for="plabel" class="sr">Name of the spot</label>
    <input id="plabel" class="input" style="height:40px;border-width:0 0 1.5px;border-radius:0;padding:0;font-weight:600" value="${draft.placeLabel}" placeholder="Name the street or landmark" maxlength="140">
    <span class="sub">${draft.placeSub || draft.areaLabel || 'Move the map to the place'}</span>
    <span style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--blue);font-weight:500">Others see the road and area, not this exact spot ${tip('approx', 'Why the exact spot is hidden', 'inherit')}</span>
  </div>`;
}

function bindWhere() {
  const input = page.querySelector('#pq');
  const box = page.querySelector('#presults');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    timer = setTimeout(() => runSearch(q, box, (r) => {
      box.hidden = true;
      input.value = '';
      input.blur();
      Object.assign(draft, {
        lat: r.lat, lng: r.lng, placeLabel: r.label, areaLabel: r.area || r.sub, placeSub: r.sub, placeEdited: false,
      });
      if (mapMod.getMap()) {
        skipNextMove = true;
        mapMod.flyTo(r.lng, r.lat, r.kind === 'area' ? 13 : 16, { top: 0, bottom: 0, left: 0, right: 0 });
        updatePlaceCard();
      } else {
        renderWhere();
      }
    }), 300);
  });
  page.querySelector('#plabel')?.addEventListener('input', (e) => {
    draft.placeLabel = e.target.value.trimStart();
    draft.placeEdited = true;
    page.querySelector('#next').disabled = draft.placeLabel.trim().length < 2;
  });
  page.querySelector('#pick-locate')?.addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Your browser cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (pos) => mapMod.flyTo(pos.coords.longitude, pos.coords.latitude, 16, { top: 0, bottom: 0, left: 0, right: 0 }),
      () => toast('Location is turned off. Search or move the map instead.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
  page.querySelector('#next').addEventListener('click', () => {
    if (draft.lat === null || draft.placeLabel.trim().length < 2) return;
    const lat = draft.lat;
    const lng = draft.lng;
    if (lat < 4 || lat > 14 || lng < 2.6 || lng > 14.8) {
      toast('That place is outside Nigeria. Move the map and try again.');
      return;
    }
    location.hash = '#/report/2';
  });
}

function updatePlaceCard() {
  const card = page.querySelector('#place-card');
  if (!card) return;
  const tmp = document.createElement('div');
  mount(tmp, placeCard());
  card.replaceWith(tmp.firstElementChild);
  page.querySelector('#plabel').addEventListener('input', (e) => {
    draft.placeLabel = e.target.value.trimStart();
    draft.placeEdited = true;
    page.querySelector('#next').disabled = draft.placeLabel.trim().length < 2;
  });
  page.querySelector('#next').disabled = draft.placeLabel.trim().length < 2;
}

// Tapping the map while choosing a place moves the pin there.
export function pickTap({ lat, lng }) {
  draft.placeEdited = false;
  mapMod.flyTo(lng, lat, Math.max(15, mapMod.getMap()?.getZoom() || 15), { top: 0, bottom: 0, left: 0, right: 0 });
}

function onMapMoved() {
  const c = mapMod.center();
  if (!c) return;
  draft.lat = c.lat;
  draft.lng = c.lng;
  if (skipNextMove) { skipNextMove = false; return; }
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(async () => {
    try {
      const { results } = await api.reverse(c.lat, c.lng);
      const r = results[0];
      if (!r || !page.querySelector('#place-card')) return;
      if (!draft.placeEdited) draft.placeLabel = r.label;
      draft.areaLabel = r.area || r.sub;
      draft.placeSub = r.sub;
      // Show the place in the search bar too, unless the person is typing there.
      const search = page.querySelector('#pq');
      if (search && document.activeElement !== search) search.value = r.sub ? `${r.label}, ${r.sub}` : r.label;
    } catch {
      if (!draft.placeLabel) draft.placeSub = 'Could not look up this place. Type its name above.';
    }
    updatePlaceCard();
  }, 450);
}

// ---- Step 2: what and when -------------------------------------------------------
function renderWhat() {
  showHome(true);
  const maxDays = state.config?.maxDaysBack || 30;
  const today = lagosDate();
  const minDate = lagosDate(Date.now() - maxDays * 86400e3);
  const whenOpts = [
    ['now', html`<span style="width:7px;height:7px;border-radius:4px;background:var(--red)"></span>Happening now`],
    ['today', 'Earlier today'],
    ['yesterday', 'Yesterday'],
    ['date', html`${icon('calendar', 16)}Pick a date`],
  ];
  mount(page, html`<section class="page" aria-label="What happened">
    ${header(2, '#/report/1')}${stepBar(2)}
    <div class="page-scroll"><div class="wrap" style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:18px">
      <h1 class="big">What happened?</h1>
      <div class="tiles" role="radiogroup" aria-label="Category">
        ${CAT_KEYS.map((k) => html`<button type="button" class="tile" role="radio" data-cat="${k}" aria-checked="${draft.category === k}">
          <span class="ct sm ${CATS[k].tone}">${icon(CATS[k].icon, 18)}</span>${CATS[k].name}
          <span class="tick">${icon('check', 12, 'style="stroke-width:3.2"')}</span></button>`)}
      </div>
      <div id="agency-wrap" style="display:flex;flex-direction:column;gap:8px" ${draft.category === 'officials' ? '' : 'hidden'}>
        <span class="field-label" style="justify-content:flex-start;gap:2px">Which agency? ${tip('officials', 'What counts as harassment by officials')}</span>
        <div class="wrap-row" role="radiogroup" aria-label="Agency">
          ${Object.entries(AGENCIES).map(([k, label]) => html`<button type="button" class="pill-choice" role="radio" data-agency="${k}" aria-checked="${draft.agency === k}">${label}</button>`)}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="field-label">When did it happen?</span>
        <div class="wrap-row" role="radiogroup" aria-label="When">
          ${whenOpts.map(([k, label]) => html`<button type="button" class="pill-choice" role="radio" data-when="${k}" aria-checked="${draft.when === k}">${label}</button>`)}
        </div>
        <div id="date-wrap" ${draft.when === 'date' ? '' : 'hidden'}>
          <label for="date" class="sr">Date</label>
          <input id="date" class="input" type="date" min="${minDate}" max="${today}" value="${draft.date}">
          <span class="sub" style="display:block;margin-top:6px">Up to ${maxDays} days ago.</span>
        </div>
        <div id="tod" style="display:flex;flex-direction:column;gap:8px;margin-top:4px" ${draft.when === 'now' ? 'hidden' : ''}>
          <span class="sub" style="display:flex;align-items:center;gap:2px"><label for="time">What time?</label> <span style="color:var(--faint)">(optional)</span>${tip('timeOfDay', 'About the time')}</span>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="time" class="input" type="time" step="300" value="${draft.time || ''}" style="flex:1">
            <button type="button" class="act" id="clear-time" ${draft.time ? '' : 'hidden'}>Clear</button>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="field-label"><label for="caption">Describe it</label><span class="sub" style="display:flex;align-items:center;gap:2px">Posting rules ${tip('rules', 'Read the posting rules')}</span></span>
        <textarea id="caption" class="textarea" rows="3" maxlength="280" placeholder="What did you see, and where exactly?">${draft.caption}</textarea>
        <span class="sub" style="display:flex;justify-content:space-between;gap:12px"><span>Say what and where. No names, no blaming groups.</span><span class="tnum" id="count">${draft.caption.length}/280</span></span>
      </div>
      <p class="error-text" id="err" hidden></p>
    </div></div>
    <div class="page-foot"><div class="wrap"><button type="button" class="btn" id="next">Continue${icon('next', 18, 'style="stroke-width:2.4"')}</button></div></div>
  </section>`);

  const q = (s) => page.querySelector(s);
  page.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    draft.category = b.dataset.cat;
    page.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    q('#agency-wrap').hidden = draft.category !== 'officials';
    if (draft.category !== 'officials') draft.agency = null;
  }));
  page.querySelectorAll('[data-agency]').forEach((b) => b.addEventListener('click', () => {
    draft.agency = b.dataset.agency;
    page.querySelectorAll('[data-agency]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    q('#err').hidden = true;
  }));
  page.querySelectorAll('[data-when]').forEach((b) => b.addEventListener('click', () => {
    draft.when = b.dataset.when;
    page.querySelectorAll('[data-when]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    q('#date-wrap').hidden = draft.when !== 'date';
    q('#tod').hidden = draft.when === 'now';
    if (draft.when === 'now') draft.time = '';
    q('#err').hidden = true;
  }));
  q('#time').addEventListener('input', (e) => {
    draft.time = e.target.value;
    q('#clear-time').hidden = !draft.time;
    q('#err').hidden = true;
  });
  q('#clear-time').addEventListener('click', () => {
    draft.time = '';
    q('#time').value = '';
    q('#clear-time').hidden = true;
  });
  q('#date').addEventListener('change', (e) => { draft.date = e.target.value; });
  q('#caption').addEventListener('input', (e) => {
    draft.caption = e.target.value;
    q('#count').textContent = `${draft.caption.length}/280`;
  });
  q('#next').addEventListener('click', () => {
    const err = q('#err');
    const problem = !draft.category ? 'Choose what happened.'
      : draft.category === 'officials' && !draft.agency ? 'Choose which agency was involved.'
      : draft.caption.trim().length < 3 ? 'Describe what happened in a few words.'
        : draft.when === 'date' && (!draft.date || draft.date > today || draft.date < minDate) ? `Choose a date in the last ${maxDays} days.`
          : draft.time && (draft.when === 'today' || (draft.when === 'date' && draft.date === today)) && draft.time > nowClock()
            ? 'That time has not happened yet today. Check the time, or leave it empty.'
            : null;
    if (problem) { err.hidden = false; err.textContent = problem; err.scrollIntoView({ block: 'center' }); return; }
    checkSame(q('#next'));
  });
}

// ---- Is this the same incident? ----------------------------------------------------
// Before photos are added, show open reports of the same kind close by, so people
// strengthen one report instead of scattering ten pins over one attack.
const REPEAT_MS = 6 * 3600e3;
async function checkSame(btn) {
  if (draft.when !== 'now' && draft.when !== 'today') { location.hash = '#/report/3'; return; }
  btn.disabled = true;
  let found = [];
  try {
    ({ reports: found } = await api.nearby(fuzz(draft.lat), fuzz(draft.lng), draft.category));
  } catch {
    found = []; // never block a report because this check failed
  }
  btn.disabled = false;
  if (!found.length) { location.hash = '#/report/3'; return; }

  const posted = mine.posted();
  const ownRecent = found.find((r) => posted.has(r.id) && Date.now() - Date.parse(r.created_at) < REPEAT_MS);
  const title = ownRecent ? 'You already reported this' : 'Is this the same incident?';
  const lead = ownRecent
    ? 'You posted a report like this here in the last few hours. Add your new photos or details to it, so everything stays in one place.'
    : `${found.length === 1 ? 'Someone has' : 'People have'} already reported this nearby. If it's the same thing, add to their report. It counts as a confirmation and makes the warning stronger.`;
  const list = ownRecent ? [ownRecent] : found;

  openModal({
    title,
    body: html`<div style="display:flex;flex-direction:column;gap:12px;padding:4px 20px calc(20px + env(safe-area-inset-bottom))">
      <p class="lead" style="margin:0">${lead}</p>
      ${list.map((r) => html`<div class="same-card">
        <span class="row-top"><b style="font-weight:600">${catTitle(r)}</b><span class="badge ${r.status}">${STATUS[r.status]}</span></span>
        <span class="sub">${whereLabel(r)} · ${whenLabel(r)} · posted ${timeAgo(r.created_at)}${posted.has(r.id) ? ' · by you' : ''}</span>
        <span class="same-cap">${r.caption}</span>
        <span class="sub">${r.confirms} confirmed${r.updates ? ` · ${r.updates} update${r.updates === 1 ? '' : 's'}` : ''}</span>
        <button type="button" class="btn" data-same="${r.id}" style="height:44px;margin-top:4px">${icon('plus', 18)}Add to this one</button>
      </div>`)}
      ${ownRecent
        ? html`<button type="button" class="btn ghost" data-close-same>Change what I'm reporting</button>`
        : html`<button type="button" class="btn ghost" data-different>No, this is something different</button>`}
    </div>`,
    onMount: (modal, close) => {
      modal.querySelectorAll('[data-same]').forEach((b) => b.addEventListener('click', () => {
        close();
        prefillUpdate(b.dataset.same, draft.caption.trim());
        resetDraft();
        location.hash = `#/r/${b.dataset.same}/add`;
      }));
      modal.querySelector('[data-different]')?.addEventListener('click', () => { close(); location.hash = '#/report/3'; });
      modal.querySelector('[data-close-same]')?.addEventListener('click', close);
    },
  });
}

// ---- Step 3: photos, checks and posting ---------------------------------------------
function renderMedia() {
  showHome(true);
  const c = CATS[draft.category] || CATS.other;
  const maxPhotos = state.config?.maxPhotos || 3;
  const hasClip = draft.media.some((m) => m.type.startsWith('video/'));
  const photoCount = draft.media.filter((m) => m.type === 'image/jpeg').length;
  const busy = draft.media.some((m) => m.busy);
  const needsChecks = draft.media.length > 0;
  const checksOk = !needsChecks || Object.values(draft.checks).every(Boolean);
  const whenText = draft.when === 'now' ? 'Happening now' : draft.when === 'today' ? 'Earlier today'
    : draft.when === 'yesterday' ? 'Yesterday' : draft.date;

  mount(page, html`<section class="page" aria-label="Photos and posting">
    ${header(3, '#/report/2')}${stepBar(3)}
    <div class="page-scroll"><div class="wrap" style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:16px">
      <div>
        <h1 class="big" style="display:flex;align-items:center;gap:10px">Add photos <span class="badge unverified" style="height:24px">Optional</span></h1>
        <p class="lead">Up to ${maxPhotos} photos, or one clip. Clips are cut to 30 seconds.</p>
      </div>
      <div class="media-grid">
        ${draft.media.map((m, i) => html`<div class="media-tile">
          ${m.preview ? (m.type.startsWith('video/') ? html`<video src="${m.preview}" muted playsinline></video>` : html`<img src="${m.preview}" alt="Your photo ${i + 1}">`) : ''}
          ${m.busy ? html`<div class="busy">${m.label}<div class="progress" style="width:70%"><i style="width:${Math.round((m.progress || 0) * 100)}%"></i></div></div>` : ''}
          ${m.busy ? '' : html`<button type="button" class="x" data-remove="${i}" aria-label="Remove">${icon('x', 13, 'style="stroke-width:2.8"')}</button>`}
          ${!m.busy && checkOf(m) === 'old' ? html`<span class="old-tag">Taken ${takenLabel(m.takenAt)}</span>` : ''}
        </div>`)}
        ${!hasClip && photoCount < maxPhotos ? html`<label class="add-tile">${icon('camera', 22)}Photo<input type="file" accept="image/*" id="add-photo" ${photoCount < maxPhotos - 1 ? 'multiple' : ''}></label>` : ''}
        ${!draft.media.length ? html`<label class="add-tile">${icon('video', 22)}Clip<input type="file" accept="video/*" id="add-clip"></label>` : ''}
      </div>
      ${draft.media.length ? html`<span style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--green);font-weight:500">${icon('shield', 16)}Location and phone details removed ${tip('photoData', 'What we remove from photos', 'inherit')}</span>` : ''}
      ${hasClip ? html`<div class="toggle-row"><span style="display:flex;align-items:center;gap:2px">Keep the sound ${tip('sound', 'Why sound is off')}</span>
        <label class="switch"><input type="checkbox" id="sound" ${draft.keepSound ? 'checked' : ''} aria-label="Keep the sound"><span></span></label></div>` : ''}
      ${draft.media.length ? html`<div class="toggle-row"><span style="display:flex;align-items:center;gap:2px">Shows injuries or bodies ${tip('sensitive', 'What this does')}</span>
        <label class="switch"><input type="checkbox" id="sensitive" ${draft.sensitive ? 'checked' : ''} aria-label="Shows injuries or bodies"><span></span></label></div>` : ''}
      ${needsChecks ? html`<fieldset style="border:0;padding:0;margin:0">
        <legend class="field-label" style="margin-bottom:4px">Before you post, check that</legend>
        <label class="check-row"><input type="checkbox" data-check="face" ${draft.checks.face ? 'checked' : ''}>It doesn't show my face, my home or my voice</label>
        <label class="check-row"><input type="checkbox" data-check="forces" ${draft.checks.forces ? 'checked' : ''}>It doesn't show where soldiers, police or people hiding are</label>
        <label class="check-row"><input type="checkbox" data-check="today" ${draft.checks.today ? 'checked' : ''}>I took it myself, at this place</label>
      </fieldset>` : ''}
      <div style="padding:12px 14px;background:var(--soft-2);border-radius:16px;display:flex;gap:12px;align-items:center">
        <span class="ct sm ${c.tone}">${icon(c.icon, 18)}</span>
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0"><b style="font-weight:600">${catTitle({ category: draft.category, agency: draft.agency })} · ${whenText}${draft.time && draft.when !== 'now' ? `, ${draft.time}` : ''}</b>
        <span class="sub ellipsis">${draft.placeLabel} · no name or account ${tip('anonymous', 'How you stay anonymous')}</span></span>
      </div>
      <div id="cf-check"></div>
      ${draft.error ? html`<p class="error-text" role="alert">${draft.error}</p>` : ''}
      ${draft.duplicateOf ? html`<button type="button" class="btn ghost" id="to-dup">${icon('plus', 18)}Add to my earlier report</button>` : ''}
    </div></div>
    <div class="page-foot"><div class="wrap" style="display:flex;flex-direction:column;gap:8px">
      ${draft.posting ? html`<div class="progress" aria-label="Posting"><i style="width:${Math.round(draft.progress * 100)}%"></i></div>` : ''}
      <button type="button" class="btn red" id="post" ${busy || !checksOk || draft.posting ? 'disabled' : ''}>${draft.posting ? 'Posting…' : busy ? 'Preparing your files…' : 'Post anonymously'}</button>
      <span class="small-note">Up to 3 reports an hour from each phone ${tip('limit', 'Why there is a limit')}</span>
    </div></div>
  </section>`);

  bindMedia();
  mountCheck(page.querySelector('#cf-check')).then((err) => { if (err) toast(err); });
}

function bindMedia() {
  const q = (s) => page.querySelector(s);
  q('#add-photo')?.addEventListener('change', async (e) => {
    const maxPhotos = state.config?.maxPhotos || 3;
    const files = [...e.target.files].slice(0, maxPhotos - draft.media.length);
    for (const file of files) {
      const item = { type: 'image/jpeg', busy: true, label: 'Cleaning photo…', progress: 0.5 };
      draft.media.push(item);
      renderMedia();
      try {
        Object.assign(item, await processPhoto(file), { busy: false });
        warnIfOld(item);
      } catch (err) {
        draft.media.splice(draft.media.indexOf(item), 1);
        toast(err.message);
      }
      renderMedia();
    }
  });
  q('#add-clip')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) prepareClip(file);
  });
  q('#sound')?.addEventListener('change', (e) => {
    draft.keepSound = e.target.checked;
    const clip = draft.media.find((m) => m.type.startsWith('video/'));
    if (clip?.file) {
      // Re-make the clip so the sound is added or removed.
      draft.media = [];
      prepareClip(clip.file);
    }
  });
  q('#sensitive')?.addEventListener('change', (e) => { draft.sensitive = e.target.checked; });
  page.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('change', () => {
    draft.checks[b.dataset.check] = b.checked;
    const ok = Object.values(draft.checks).every(Boolean);
    q('#post').disabled = !ok || draft.media.some((m) => m.busy);
  }));
  page.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const [m] = draft.media.splice(Number(b.dataset.remove), 1);
    if (m?.preview) URL.revokeObjectURL(m.preview);
    renderMedia();
  }));
  q('#post').addEventListener('click', post);
  q('#to-dup')?.addEventListener('click', () => {
    const id = draft.duplicateOf;
    prefillUpdate(id, draft.caption.trim(), draft.media.filter((m) => !m.busy));
    draft.media = []; // handed over to the update, so their previews stay alive
    resetDraft();
    location.hash = `#/r/${id}/add`;
  });
}

async function prepareClip(file) {
  if (!canProcessClips()) { toast('This phone cannot prepare clips safely. Add photos instead.'); return; }
  const item = { type: 'video/webm', busy: true, label: 'Cleaning clip… keep this screen open', progress: 0, file };
  draft.media.push(item);
  renderMedia();
  let lastPaint = 0;
  try {
    const out = await processClip(file, {
      keepSound: draft.keepSound,
      onProgress: (p) => {
        item.progress = p;
        const now = performance.now();
        if (now - lastPaint > 400) {
          lastPaint = now;
          const bar = page.querySelector('.media-tile .progress i');
          if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        }
      },
    });
    Object.assign(item, out, { busy: false });
    warnIfOld(item);
    if (out.trimmed) toast('Your clip was cut to the first 30 seconds.');
    if (draft.keepSound && !out.soundKept) toast('The sound could not be kept on this phone. The clip is silent.');
  } catch (err) {
    draft.media.splice(draft.media.indexOf(item), 1);
    toast(err.message, 5000);
  }
  if (location.hash === '#/report/3') renderMedia();
}

// ---- Posting ---------------------------------------------------------------------------
async function post() {
  if (draft.posting) return;
  draft.error = null;
  draft.duplicateOf = null;
  draft.posting = true;
  draft.progress = 0.02;
  renderMedia();
  try {
    const token = await getToken();
    const res = await api.create({
      category: draft.category,
      agency: draft.category === 'officials' ? draft.agency : null,
      caption: draft.caption.trim(),
      placeLabel: draft.placeLabel.trim(),
      areaLabel: draft.areaLabel,
      lat: fuzz(draft.lat),
      lng: fuzz(draft.lng),
      when: draft.when,
      date: draft.date,
      time: draft.when === 'now' ? null : (draft.time || null),
      sensitive: draft.sensitive,
      media: draft.media.map((m) => ({ type: m.type, size: m.blob.size, check: checkOf(m), print: m.print || undefined })),
      turnstileToken: token,
    });
    const total = draft.media.reduce((s, m) => s + m.blob.size, 0) || 1;
    let done = 0;
    for (let i = 0; i < res.uploads.length; i += 1) {
      const m = draft.media[i];
      await upload(res.uploads[i].url, m.blob, (p) => {
        draft.progress = 0.05 + 0.9 * ((done + p * m.blob.size) / total);
        const bar = page.querySelector('.page-foot .progress i');
        if (bar) bar.style.width = `${Math.round(draft.progress * 100)}%`;
      });
      done += m.blob.size;
    }
    if (res.finalizeToken) await api.finalize(res.id, res.finalizeToken);
    mine.addPosted(res.id);
    lastPosted = {
      id: res.id,
      title: catTitle({ category: draft.category, agency: draft.agency }),
      where: draft.areaLabel || draft.placeLabel,
    };
    resetDraft();
    refresh({ quiet: true });
    location.hash = '#/report/done';
  } catch (err) {
    draft.posting = false;
    draft.error = err.message;
    draft.duplicateOf = err.data?.duplicateOf || null;
    resetCheck();
    renderMedia();
  }
}

// ---- Done -------------------------------------------------------------------------------
function renderDone() {
  showHome(true);
  if (!lastPosted) { location.hash = '#/'; return; }
  const p = lastPosted;
  const stamp = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
  }).format(new Date());
  mount(page, html`<section class="page" style="background:#F4F6F4" aria-label="Report posted">
    <div class="page-scroll"><div class="wrap">
      <div class="success">
        <span style="width:76px;height:76px;border-radius:38px;background:var(--green-soft);display:flex;align-items:center;justify-content:center">
          <span style="width:56px;height:56px;border-radius:28px;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center">${icon('check', 28, 'style="stroke-width:2.8"')}</span></span>
        <h1 class="big" style="margin-top:10px;font-size:30px">Report posted</h1>
        <p class="lead" style="max-width:290px">It shows as Unverified until people nearby confirm it. Thank you for warning others.</p>
      </div>
      <div style="margin:32px 28px 0;display:flex;flex-direction:column;gap:10px">
        <span class="section-label" style="padding:0">Share preview</span>
        <div class="share-card">
          <span style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">CitizensWatch alert</b><span class="badge" style="background:rgba(255,255,255,.12);color:#fff">Unverified</span></span>
          <span style="font-size:26px;font-weight:700;letter-spacing:-0.5px;color:#FF8A73">${p.title}</span>
          <span style="font-size:16px">${p.where}</span>
          <span style="font-size:13px;color:rgba(255,255,255,.65)">${stamp} · Live updates on the map</span>
        </div>
        <span class="sub" style="text-align:center;line-height:1.45">The link preview never shows your photo, your words or the exact spot.</span>
      </div>
    </div></div>
    <div class="page-foot" style="background:transparent;border:0"><div class="wrap" style="display:flex;flex-direction:column;gap:10px">
      <button type="button" class="btn" id="share">${icon('share', 20)}Share warning</button>
      <a class="btn ghost" href="#/r/${p.id}">View your report</a>
      <a class="btn ghost" href="#/">Back to map</a>
    </div></div>
  </section>`);
  page.querySelector('#share').addEventListener('click', () => shareReport(p));
}
