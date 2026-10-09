// Everything the app sends to or reads from its own server.

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

// A random code that stays in this browser. The server only keeps a hash of it.
export function deviceId() {
  let id = store('cw_device');
  if (!id || !/^[a-zA-Z0-9-]{16,64}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    store('cw_device', id);
  }
  return id;
}

// A one-way code describing this phone (screen, browser, graphics chip, time zone...).
// It survives clearing the browser, so one phone counts once when confirming.
// Only the code is sent; the server mixes it with the network and hashes it again.
let fpPromise = null;
export function fingerprint() {
  if (!fpPromise) fpPromise = computeFingerprint().catch(() => null);
  return fpPromise;
}
async function computeFingerprint() {
  if (!crypto.subtle) return null;
  const parts = [
    navigator.userAgent, navigator.language, (navigator.languages || []).join(','), navigator.platform,
    navigator.hardwareConcurrency, navigator.deviceMemory, navigator.maxTouchPoints,
    screen.width, screen.height, screen.colorDepth, window.devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) parts.push(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch { /* not available */ }
  try {
    const c = document.createElement('canvas');
    c.width = 220; c.height = 30;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillStyle = '#d92d20';
    ctx.fillRect(2, 2, 60, 20);
    ctx.fillStyle = '#0e1a14';
    ctx.fillText('CitizensWatch \u{1F6E1} 9ja', 4, 6);
    parts.push(c.toDataURL());
  } catch { /* not available */ }
  const data = new TextEncoder().encode(parts.join('|'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function request(path, { method = 'GET', body, headers = {}, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'The connection is slow. Please try again.'
      : 'You seem to be offline. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  config: () => request('/api/config'),
  list: (filters) => {
    const p = new URLSearchParams({ range: filters.range });
    if (filters.range === 'custom') { p.set('from', filters.from); p.set('to', filters.to); }
    if (filters.cats && filters.cats.length) p.set('cats', filters.cats.join(','));
    if (filters.corroborated) p.set('corroborated', '1');
    return request(`/api/reports?${p}`);
  },
  details: (ids) => request(`/api/reports?ids=${ids.slice(0, 40).join(',')}`),
  detail: (id) => request(`/api/reports?ids=${id}&updates=1`),
  create: async (payload) => request('/api/reports', {
    method: 'POST', body: { ...payload, device: deviceId(), fp: await fingerprint() }, timeout: 30000,
  }),
  finalize: (id, token, kind) => request('/api/finalize', { method: 'POST', body: { id, token, kind } }),
  vote: async (id, kind, reason) => request('/api/vote', {
    method: 'POST', body: { id, kind, reason, device: deviceId(), fp: await fingerprint() },
  }),
  addUpdate: async (payload) => request('/api/update', {
    method: 'POST', body: { ...payload, action: 'create', device: deviceId(), fp: await fingerprint() }, timeout: 30000,
  }),
  flagUpdate: (updateId, reason) => request('/api/update', {
    method: 'POST', body: { action: 'flag', updateId, reason, device: deviceId() },
  }),
  search: (q, center) => {
    const p = new URLSearchParams({ q });
    if (center) { p.set('lat', center.lat.toFixed(3)); p.set('lng', center.lng.toFixed(3)); }
    return request(`/api/geocode?${p}`, { timeout: 8000 });
  },
  reverse: (lat, lng) => request(`/api/geocode?reverse=1&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, { timeout: 8000 }),
  modQueue: (key, queue) => request(`/api/mod?queue=${queue}`, { headers: { 'X-Moderator-Key': key } }),
  modAct: (key, body) => request('/api/mod', { method: 'POST', body, headers: { 'X-Moderator-Key': key } }),
};

// Upload a file straight to storage with a progress callback.
export function upload(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error('A file did not upload. Check your connection and try again.')));
    xhr.onerror = () => reject(new Error('A file did not upload. Check your connection and try again.'));
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 180000;
    xhr.send(blob);
  });
}

// Reports this phone posted or voted on, so the screens can say so.
export const mine = {
  posted: () => new Set(store('cw_posted') || []),
  addPosted: (id) => store('cw_posted', [...(store('cw_posted') || []), id].slice(-200)),
  votes: () => store('cw_votes') || {},
  setVote: (id, kind) => {
    const v = store('cw_votes') || {};
    v[id] = { ...(v[id] || {}), [kind]: true };
    if (kind === 'confirm') delete v[id].false;
    if (kind === 'false') delete v[id].confirm;
    store('cw_votes', v);
  },
};
