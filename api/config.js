import { route, send } from './_lib/http.js';
import { env } from './_lib/env.js';
import { MAX_DAYS_BACK, MAX_PHOTOS } from './_lib/reports.js';

// Public settings the browser needs. Nothing secret goes here.
export default route(['GET'], async (req, res) => {
  const cfg = env();
  send(res, 200, {
    siteName: cfg.siteName,
    turnstileSiteKey: cfg.turnstileSiteKey,
    mapStyle: cfg.mapStyle,
    maxDaysBack: MAX_DAYS_BACK,
    maxPhotos: MAX_PHOTOS,
    configured: Boolean(cfg.supabaseUrl && cfg.supabaseKey && cfg.hashSecret),
  }, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
});
