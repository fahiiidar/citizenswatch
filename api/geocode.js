import { route, send, queryOf, HttpError } from './_lib/http.js';
import { env } from './_lib/env.js';

// Street and landmark search, limited to Nigeria. Searches go through our
// server so the map provider never sees the person's own IP address.
const NIGERIA_BBOX = '2.6,4.2,14.7,13.95';

export default route(['GET'], async (req, res) => {
  const cfg = env();
  const q = queryOf(req);
  const lat = Number(q.get('lat'));
  const lng = Number(q.get('lng'));
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && lat > 4 && lat < 14 && lng > 2.6 && lng < 14.8;

  let url;
  if (q.get('reverse') === '1') {
    if (!hasPoint) throw new HttpError(400, 'Missing point.');
    url = `${cfg.geocoderUrl}/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&limit=1&lang=en`;
  } else {
    const text = (q.get('q') || '').trim().slice(0, 100);
    if (text.length < 2) return send(res, 200, { results: [] });
    url = `${cfg.geocoderUrl}/api/?q=${encodeURIComponent(text)}&limit=8&lang=en&bbox=${NIGERIA_BBOX}`;
    if (hasPoint) url += `&lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`;
  }

  let data;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': `${cfg.siteName} (community safety map)` } });
    if (!r.ok) throw new Error(`status ${r.status}`);
    data = await r.json();
  } catch (err) {
    console.error('Geocoder failed', err);
    throw new HttpError(503, 'Place search is not responding. Move the map to the place instead.');
  }

  const results = [];
  const seen = new Set();
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.countrycode && p.countrycode !== 'NG') continue;
    const [fx, fy] = f.geometry?.coordinates || [];
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue;
    const item = describe(p, fy, fx);
    const key = `${item.label}|${item.sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }

  send(res, 200, { results }, { 'Cache-Control': 'public, max-age=300, s-maxage=86400' });
});

function describe(p, lat, lng) {
  const kind = p.osm_key === 'highway' ? 'street'
    : p.osm_key === 'place' || p.type === 'city' || p.type === 'district' || p.type === 'locality' ? 'area'
      : 'landmark';
  let label = p.name || p.street || p.city || p.county || 'Unnamed place';
  if (!p.name && p.street && p.housenumber) label = `${p.housenumber} ${p.street}`;
  const town = p.city || p.district || p.locality || p.county;
  const parts = [];
  if (p.street && p.name && p.street !== p.name) parts.push(p.street);
  if (town && town !== label) parts.push(town);
  if (p.state) parts.push(p.state);
  const area = [p.county || p.city || p.district, p.state].filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return {
    label,
    sub: parts.filter((v, i, a) => a.indexOf(v) === i).join(', '),
    area,
    kind,
    lat,
    lng,
  };
}
