// Talks to Supabase over its plain HTTP APIs, so the app needs no extra packages.
import { HttpError } from './http.js';

export const BUCKET = 'media';

function headers(cfg, extra = {}) {
  const h = { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', ...extra };
  // Older "service_role" keys are JWTs and also go in Authorization.
  // Newer "sb_secret_..." keys only go in the apikey header.
  if (cfg.supabaseKey.startsWith('eyJ')) h.Authorization = `Bearer ${cfg.supabaseKey}`;
  return h;
}

async function call(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.error('Supabase unreachable', err);
    throw new HttpError(503, 'Our database is not reachable right now. Please try again shortly.');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    console.error('Supabase error', res.status, url.replace(/token=[^&]+/, 'token=…'), text.slice(0, 500));
    const err = new HttpError(502, 'Our database returned an error. Please try again.');
    err.upstream = { status: res.status, data };
    throw err;
  }
  return data;
}

// ---- Database (PostgREST) ----------------------------------------------------

export function select(cfg, table, query) {
  return call(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: headers(cfg),
  });
}

export function insert(cfg, table, rows, { returning = true, ignoreDuplicates = false } = {}) {
  const prefer = [returning ? 'return=representation' : 'return=minimal'];
  if (ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
  return call(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(cfg, { Prefer: prefer.join(',') }),
    body: JSON.stringify(rows),
  });
}

export function update(cfg, table, query, patch) {
  return call(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: headers(cfg, { Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
}

export function remove(cfg, table, query) {
  return call(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: headers(cfg, { Prefer: 'return=minimal' }),
  });
}

export function rpc(cfg, fn, args) {
  return call(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(args),
  });
}

// ---- Storage ------------------------------------------------------------------

// A one-time link the phone uses to upload a file straight to storage.
export async function signUpload(cfg, path) {
  const data = await call(
    `${cfg.supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${encodePath(path)}`,
    { method: 'POST', headers: headers(cfg), body: '{}' },
  );
  const rel = data && (data.url || data.signedURL);
  if (!rel) throw new HttpError(502, 'Could not prepare the upload. Please try again.');
  return `${cfg.supabaseUrl}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
}

// Short-lived links for viewing files. Returns { path: url }.
export async function signDownloads(cfg, paths, expiresIn = 3600) {
  const out = {};
  if (!paths.length) return out;
  const data = await call(`${cfg.supabaseUrl}/storage/v1/object/sign/${BUCKET}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ expiresIn, paths }),
  });
  for (const item of Array.isArray(data) ? data : []) {
    const rel = item.signedURL || item.signedUrl;
    if (item.path && rel) {
      out[item.path] = `${cfg.supabaseUrl}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
    }
  }
  return out;
}

export async function listFolder(cfg, prefix) {
  const data = await call(`${cfg.supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ prefix, limit: 20, offset: 0 }),
  });
  return Array.isArray(data) ? data : [];
}

export async function removeFiles(cfg, paths) {
  if (!paths.length) return;
  await call(`${cfg.supabaseUrl}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: headers(cfg),
    body: JSON.stringify({ prefixes: paths }),
  });
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// PostgREST filter values need quoting when they contain commas or brackets.
export function inList(values) {
  return `(${values.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;
}
