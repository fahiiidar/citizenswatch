import { HttpError } from './http.js';

// All settings come from environment variables set in Vercel.
// The launch guide explains where each value comes from.
export function env() {
  const e = process.env;
  const cfg = {
    supabaseUrl: (e.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SECRET_KEY || '',
    turnstileSiteKey: e.TURNSTILE_SITE_KEY || '',
    turnstileSecret: e.TURNSTILE_SECRET_KEY || '',
    hashSecret: e.HASH_SECRET || '',
    moderatorKeys: parseModerators(e.MODERATOR_KEYS || ''),
    siteName: e.SITE_NAME || 'CitizensWatch',
    mapStyle: e.MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
    importSecret: e.IMPORT_SECRET || '',
    geocoderUrl: (e.GEOCODER_URL || 'https://photon.komoot.io').replace(/\/+$/, ''),
  };
  return cfg;
}

export function requireServerConfig() {
  const cfg = env();
  const missing = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.hashSecret || cfg.hashSecret.length < 16) missing.push('HASH_SECRET (at least 16 characters)');
  if (missing.length) {
    console.error('Missing settings: ' + missing.join(', '));
    throw new HttpError(503, 'The site is not fully set up yet. Missing: ' + missing.join(', '));
  }
  return cfg;
}

// MODERATOR_KEYS looks like:  amina:long-random-key,tunde:another-long-key
function parseModerators(text) {
  const out = [];
  for (const part of text.split(',')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const key = part.slice(i + 1).trim();
    if (name && key.length >= 16) out.push({ name, key });
  }
  return out;
}
