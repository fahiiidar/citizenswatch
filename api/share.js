import { queryOf } from './_lib/http.js';
import { env } from './_lib/env.js';
import { select } from './_lib/supa.js';
import { statusOf } from './_lib/reports.js';

// A shared link (/r/<id>) shows a proper preview in WhatsApp and X,
// then opens the report in the app. Previews never include the photo or caption.
const NAMES = {
  gunmen: 'Gunmen sighted', kidnapping: 'Kidnapping', attack: 'Attack happening', road: 'Road unsafe',
  robbery: 'Robbery', avoid: 'Area to avoid', officials: 'Harassment by officials', clear: 'All clear', other: 'Safety report',
};
const STATUS = { unverified: 'Unverified', corroborated: 'Corroborated', disputed: 'Disputed' };

export default async function handler(req, res) {
  const cfg = env();
  const id = queryOf(req).get('id') || '';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const origin = `https://${host}`;
  let title = `${cfg.siteName}: live safety map`;
  let description = 'See and share safety reports near you, posted anonymously by people on the ground.';

  if (/^[0-9a-f-]{36}$/i.test(id) && cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      const rows = await select(cfg, 'reports',
        `select=category,area_label,place_label,confirms,falses,mod_override&id=eq.${id}&status=eq.visible`);
      const r = rows[0];
      if (r) {
        title = `${NAMES[r.category] || 'Safety report'} · ${r.area_label || r.place_label}`;
        description = `${STATUS[statusOf(r)]} report on ${cfg.siteName}. Open the map for live updates.`;
      }
    } catch {
      // Fall back to the general preview.
    }
  }

  const target = /^[0-9a-f-]{36}$/i.test(id) ? `/#/r/${id}` : '/';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(origin)}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head><body style="font-family:system-ui,sans-serif;padding:24px">
<p><a href="${esc(target)}">Open the report on ${esc(cfg.siteName)}</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120');
  res.end(html);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
