import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, clientIp } from './http.js';
import { rpc, select } from './supa.js';

export function hashWith(secret, value) {
  return createHash('sha256').update(`${secret}|${value}`).digest('hex').slice(0, 40);
}

// Each phone keeps a random ID in its browser. We only ever store a salted hash of it.
export function deviceHash(cfg, deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(deviceId)) {
    throw new HttpError(400, 'Your browser did not send a valid device code. Reload the page and try again.');
  }
  return hashWith(cfg.hashSecret, `device:${deviceId}`);
}

// A code for "this kind of phone on this network". The phone sends a one-way
// fingerprint of its own features; we mix it with the network and hash again.
// Clearing the browser does not change it, and real people with the same phone
// model are rarely on the same network at the same moment.
export function netFp(cfg, req, fp) {
  if (typeof fp !== 'string' || !/^[a-f0-9]{64}$/.test(fp)) return null;
  return hashWith(cfg.hashSecret, `nf:${fp}|${clientIp(req)}`);
}

export function ipHash(cfg, req) {
  return hashWith(cfg.hashSecret, `ip:${clientIp(req)}`);
}

// Cloudflare Turnstile: the invisible "are you a person" check.
export async function verifyHuman(cfg, token, req) {
  if (!cfg.turnstileSecret) {
    // Lets you try the site before Turnstile is set up. The guide tells you to add it before launch.
    console.warn('TURNSTILE_SECRET_KEY is not set: skipping the bot check.');
    return;
  }
  if (typeof token !== 'string' || token.length < 10) {
    throw new HttpError(400, 'The security check did not finish. Wait a moment, then post again.');
  }
  const form = new URLSearchParams();
  form.set('secret', cfg.turnstileSecret);
  form.set('response', token);
  form.set('remoteip', clientIp(req));
  let ok = false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    ok = Boolean(data.success);
  } catch (err) {
    console.error('Turnstile verify failed', err);
    throw new HttpError(503, 'The security check service is not responding. Please try again.');
  }
  if (!ok) throw new HttpError(403, 'The security check failed. Reload the page and try again.');
}

// Throws once a key has been used `max` times in the window.
export async function rateLimit(cfg, key, kind, windowSeconds, max, message) {
  const count = await rpc(cfg, 'hit_rate', {
    p_key: key,
    p_kind: kind,
    p_window_seconds: windowSeconds,
  });
  if (Number(count) >= max) throw new HttpError(429, message);
}

export async function assertNotBlocked(cfg, dHash) {
  const rows = await select(cfg, 'blocked_devices', `device_hash=eq.${dHash}&select=device_hash`);
  if (Array.isArray(rows) && rows.length) {
    throw new HttpError(403, 'This phone can no longer post or vote here.');
  }
}

export function moderatorFor(cfg, req) {
  const supplied = String(req.headers['x-moderator-key'] || '');
  if (supplied.length < 16) return null;
  const a = Buffer.from(supplied);
  for (const m of cfg.moderatorKeys) {
    const b = Buffer.from(m.key);
    if (a.length === b.length && timingSafeEqual(a, b)) return m.name;
  }
  return null;
}

export function requireModerator(cfg, req) {
  const name = moderatorFor(cfg, req);
  if (!name) throw new HttpError(401, 'That moderator key is not recognised.');
  return name;
}
