// Cloudflare Turnstile: the invisible "are you a person" check before posting.
import { state } from './state.js';

let widget = null;
let token = null;
let waiters = [];

function load() {
  if (window.turnstile) return Promise.resolve();
  if (window._tsLoading) return window._tsLoading;
  window._tsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { window._tsLoading = null; reject(new Error('The security check could not load. Check your connection.')); };
    document.head.appendChild(s);
  });
  return window._tsLoading;
}

// Puts the check into `box`. Safe to call again after a screen redraws.
export async function mountCheck(box) {
  const key = state.config?.turnstileSiteKey;
  if (!key || !box) return null;
  try {
    await load();
    if (!document.body.contains(box)) return null;
    if (widget !== null) { try { window.turnstile.remove(widget); } catch { /* already gone */ } }
    widget = window.turnstile.render(box, {
      sitekey: key,
      appearance: 'interaction-only',
      callback: (t) => { token = t; waiters.forEach((w) => w(t)); waiters = []; },
      'expired-callback': () => { token = null; },
      'error-callback': () => { token = null; },
    });
    return null;
  } catch (err) {
    return err.message;
  }
}

export function getToken() {
  if (!state.config?.turnstileSiteKey) return Promise.resolve(null);
  if (token) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The security check is taking too long. Tap Post again.')), 20000);
    waiters.push((t) => { clearTimeout(timer); resolve(t); });
  });
}

// Tokens work once; get a fresh one after each attempt.
export function resetCheck() {
  token = null;
  if (window.turnstile && widget !== null) { try { window.turnstile.reset(widget); } catch { /* ignore */ } }
}
