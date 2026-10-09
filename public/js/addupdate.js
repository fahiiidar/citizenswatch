// Adding your own photos or words to someone else's report.
import { html, icon, tip, mount, toast } from './ui.js';
import { api, upload, mine } from './api.js';
import { CATS, whereLabel, lagosDate } from './format.js';
import { state } from './state.js';
import { processPhoto, processClip, canProcessClips, classifyTaken, takenLabel } from './media.js';
import { mountCheck, getToken, resetCheck } from './turnstile.js';

const page = document.getElementById('page');
let d = null;

function fresh(report) {
  return {
    report,
    caption: '',
    media: [],
    keepSound: false,
    sensitive: false,
    checks: { face: false, forces: false, here: false },
    error: null,
    posting: false,
    progress: 0,
  };
}

const eventDay = () => (d.report.is_now ? lagosDate(Date.parse(d.report.created_at)) : d.report.occurred_on);
const checkOf = (m) => classifyTaken(m.takenAt, eventDay());

export async function openAddUpdate(reportId) {
  if (!d || d.report.id !== reportId) {
    mount(page, html`<section class="page" aria-label="Add to this report"><p class="empty">Loading…</p></section>`);
    try {
      const { reports } = await api.detail(reportId);
      if (!reports.length) {
        mount(page, html`<section class="page"><p class="empty">This report is no longer available.</p><a class="btn ghost" href="#/" style="margin:0 20px;width:auto">Back to map</a></section>`);
        return;
      }
      d = fresh(reports[0]);
    } catch (err) {
      mount(page, html`<section class="page"><p class="empty">${err.message}</p></section>`);
      return;
    }
  }
  render();
}

function render() {
  const r = d.report;
  const c = CATS[r.category] || CATS.other;
  const maxPhotos = state.config?.maxPhotos || 3;
  const hasClip = d.media.some((m) => m.type.startsWith('video/'));
  const photoCount = d.media.filter((m) => m.type === 'image/jpeg').length;
  const busy = d.media.some((m) => m.busy);
  const checksOk = !d.media.length || Object.values(d.checks).every(Boolean);
  const hasContent = d.media.length > 0 || d.caption.trim().length >= 3;

  mount(page, html`<section class="page" aria-label="Add to this report">
    <header class="page-head">
      <a class="round-btn" href="#/r/${r.id}" aria-label="Back to the report">${icon('back', 22)}</a>
      <span class="t">Add to this report</span>
      <span style="width:40px"></span>
    </header>
    <div class="page-scroll"><div class="wrap" style="padding:8px 20px 20px;display:flex;flex-direction:column;gap:16px">
      <div style="padding:12px 14px;background:var(--soft-2);border-radius:16px;display:flex;gap:12px;align-items:center">
        <span class="ct sm ${c.tone}">${icon(c.icon, 18)}</span>
        <span style="display:flex;flex-direction:column;gap:1px;min-width:0"><b style="font-weight:600">${c.name}</b><span class="sub ellipsis">${whereLabel(r)}</span></span>
      </div>
      <div>
        <h1 class="big" style="font-size:24px">Were you there too?</h1>
        <p class="lead">Add photos from another angle, or what happened next. Your update also counts as a confirmation.</p>
      </div>

      <div class="media-grid">
        ${d.media.map((m, i) => html`<div class="media-tile">
          ${m.preview ? (m.type.startsWith('video/') ? html`<video src="${m.preview}" muted playsinline></video>` : html`<img src="${m.preview}" alt="Your photo ${i + 1}">`) : ''}
          ${m.busy ? html`<div class="busy">${m.label}<div class="progress" style="width:70%"><i style="width:${Math.round((m.progress || 0) * 100)}%"></i></div></div>` : ''}
          ${m.busy ? '' : html`<button type="button" class="x" data-remove="${i}" aria-label="Remove">${icon('x', 13, 'style="stroke-width:2.8"')}</button>`}
          ${!m.busy && checkOf(m) === 'old' ? html`<span class="old-tag">Taken ${takenLabel(m.takenAt)}</span>` : ''}
        </div>`)}
        ${!hasClip && photoCount < maxPhotos ? html`<label class="add-tile">${icon('camera', 22)}Photo<input type="file" accept="image/*" id="add-photo" ${photoCount < maxPhotos - 1 ? 'multiple' : ''}></label>` : ''}
        ${!d.media.length ? html`<label class="add-tile">${icon('video', 22)}Clip<input type="file" accept="video/*" id="add-clip"></label>` : ''}
      </div>
      ${d.media.length ? html`<span style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--green);font-weight:500">${icon('shield', 16)}Location and phone details removed ${tip('photoData', 'What we remove from photos', 'inherit')}</span>` : ''}
      ${hasClip ? html`<div class="toggle-row"><span style="display:flex;align-items:center;gap:2px">Keep the sound ${tip('sound', 'Why sound is off')}</span>
        <label class="switch"><input type="checkbox" id="sound" ${d.keepSound ? 'checked' : ''} aria-label="Keep the sound"><span></span></label></div>` : ''}
      ${d.media.length ? html`<div class="toggle-row"><span style="display:flex;align-items:center;gap:2px">Shows injuries or bodies ${tip('sensitive', 'What this does')}</span>
        <label class="switch"><input type="checkbox" id="sensitive" ${d.sensitive ? 'checked' : ''} aria-label="Shows injuries or bodies"><span></span></label></div>` : ''}

      <div style="display:flex;flex-direction:column;gap:8px">
        <span class="field-label"><label for="ucaption">What did you see? <span class="sub" style="font-weight:400">(optional with photos)</span></label><span class="sub" style="display:flex;align-items:center;gap:2px">Rules ${tip('rules', 'Read the posting rules')}</span></span>
        <textarea id="ucaption" class="textarea" rows="3" maxlength="280" placeholder="For example: the road is still blocked, people are turning back">${d.caption}</textarea>
        <span class="sub" style="text-align:right" id="ucount">${d.caption.length}/280</span>
      </div>

      ${d.media.length ? html`<fieldset style="border:0;padding:0;margin:0">
        <legend class="field-label" style="margin-bottom:4px">Before you post, check that</legend>
        <label class="check-row"><input type="checkbox" data-check="face" ${d.checks.face ? 'checked' : ''}>It doesn't show my face, my home or my voice</label>
        <label class="check-row"><input type="checkbox" data-check="forces" ${d.checks.forces ? 'checked' : ''}>It doesn't show where soldiers, police or people hiding are</label>
        <label class="check-row"><input type="checkbox" data-check="here" ${d.checks.here ? 'checked' : ''}>I took it myself, at this place</label>
      </fieldset>` : ''}
      <div id="turnstile"></div>
      ${d.error ? html`<p class="error-text" role="alert">${d.error}</p>` : ''}
    </div></div>
    <div class="page-foot"><div class="wrap" style="display:flex;flex-direction:column;gap:8px">
      ${d.posting ? html`<div class="progress" aria-label="Posting"><i style="width:${Math.round(d.progress * 100)}%"></i></div>` : ''}
      <button type="button" class="btn" id="post" ${busy || !checksOk || !hasContent || d.posting ? 'disabled' : ''}>${d.posting ? 'Adding…' : busy ? 'Preparing your files…' : 'Add to report anonymously'}</button>
    </div></div>
  </section>`);
  bind();
  mountCheck(page.querySelector('#turnstile')).then((err) => { if (err) toast(err); });
}

function updatePostButton() {
  const btn = page.querySelector('#post');
  if (!btn) return;
  const checksOk = !d.media.length || Object.values(d.checks).every(Boolean);
  const hasContent = d.media.length > 0 || d.caption.trim().length >= 3;
  btn.disabled = d.posting || d.media.some((m) => m.busy) || !checksOk || !hasContent;
}

function warnIfOld(m) {
  if (checkOf(m) === 'old') {
    toast(`This looks like it was taken on ${takenLabel(m.takenAt)}, before this report. If it isn't from this event, remove it.`, 7000);
  }
}

function bind() {
  const q = (s) => page.querySelector(s);
  q('#ucaption').addEventListener('input', (e) => {
    d.caption = e.target.value;
    q('#ucount').textContent = `${d.caption.length}/280`;
    updatePostButton();
  });
  q('#add-photo')?.addEventListener('change', async (e) => {
    const maxPhotos = state.config?.maxPhotos || 3;
    for (const file of [...e.target.files].slice(0, maxPhotos - d.media.length)) {
      const item = { type: 'image/jpeg', busy: true, label: 'Cleaning photo…', progress: 0.5 };
      d.media.push(item);
      render();
      try {
        Object.assign(item, await processPhoto(file), { busy: false });
        warnIfOld(item);
      } catch (err) {
        d.media.splice(d.media.indexOf(item), 1);
        toast(err.message);
      }
      render();
    }
  });
  q('#add-clip')?.addEventListener('change', (e) => { if (e.target.files[0]) prepareClip(e.target.files[0]); });
  q('#sound')?.addEventListener('change', (e) => {
    d.keepSound = e.target.checked;
    const clip = d.media.find((m) => m.type.startsWith('video/'));
    if (clip?.file) { d.media = []; prepareClip(clip.file); }
  });
  q('#sensitive')?.addEventListener('change', (e) => { d.sensitive = e.target.checked; });
  page.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('change', () => {
    d.checks[b.dataset.check] = b.checked;
    updatePostButton();
  }));
  page.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const [m] = d.media.splice(Number(b.dataset.remove), 1);
    if (m?.preview) URL.revokeObjectURL(m.preview);
    render();
  }));
  q('#post').addEventListener('click', post);
}

async function prepareClip(file) {
  if (!canProcessClips()) { toast('This phone cannot prepare clips safely. Add photos instead.'); return; }
  const item = { type: 'video/webm', busy: true, label: 'Cleaning clip… keep this screen open', progress: 0, file };
  d.media.push(item);
  render();
  try {
    const out = await processClip(file, {
      keepSound: d.keepSound,
      onProgress: (p) => {
        item.progress = p;
        const bar = page.querySelector('.media-tile .progress i');
        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      },
    });
    Object.assign(item, out, { busy: false });
    warnIfOld(item);
    if (out.trimmed) toast('Your clip was cut to the first 30 seconds.');
  } catch (err) {
    d.media.splice(d.media.indexOf(item), 1);
    toast(err.message, 5000);
  }
  if (location.hash.endsWith('/add')) render();
}

async function post() {
  if (d.posting) return;
  d.error = null;
  d.posting = true;
  d.progress = 0.02;
  render();
  try {
    const token = await getToken();
    const res = await api.addUpdate({
      reportId: d.report.id,
      caption: d.caption.trim(),
      sensitive: d.sensitive,
      media: d.media.map((m) => ({ type: m.type, size: m.blob.size, check: checkOf(m) })),
      turnstileToken: token,
    });
    const total = d.media.reduce((s, m) => s + m.blob.size, 0) || 1;
    let done = 0;
    for (let i = 0; i < res.uploads.length; i += 1) {
      const m = d.media[i];
      await upload(res.uploads[i].url, m.blob, (p) => {
        d.progress = 0.05 + 0.9 * ((done + p * m.blob.size) / total);
        const bar = page.querySelector('.page-foot .progress i');
        if (bar) bar.style.width = `${Math.round(d.progress * 100)}%`;
      });
      done += m.blob.size;
    }
    if (res.finalizeToken) await api.finalize(res.id, res.finalizeToken, 'update');
    const reportId = d.report.id;
    if (!mine.posted().has(reportId)) mine.setVote(reportId, 'confirm');
    d.media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
    d = null;
    toast('Thanks. Your update is on the report, and it counts as a confirmation.', 5000);
    location.hash = `#/r/${reportId}`;
  } catch (err) {
    d.posting = false;
    d.error = err.message;
    resetCheck();
    render();
  }
}
