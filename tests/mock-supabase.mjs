// A small in-memory stand-in for Supabase (database, storage) and the place
// search service, used only for local testing. Not deployed.
import http from 'node:http';

export function startMock(port = 54321) {
  const tables = { reports: [], votes: [], rate_events: [], blocked_devices: [], mod_log: [], report_updates: [], update_flags: [] };
  const files = new Map(); // path -> { type, body }
  let seq = 1;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  function parseVal(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    return v;
  }
  function cmp(a, b) {
    if (typeof a === 'number' || (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && a !== '' && b !== '' && typeof a !== 'boolean' && !/^\d{4}-/.test(String(a)))) {
      return Number(a) - Number(b);
    }
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  function matches(row, filters) {
    return filters.every(([col, op, raw]) => {
      if (col === 'or') {
        const parts = raw.replace(/^\(|\)$/g, '').split(',').map((x) => {
          const [c, o, ...v] = x.split('.');
          return [c, o, v.join('.')];
        });
        return parts.some((f) => matches(row, [f]));
      }
      const v = row[col];
      if (op === 'in') {
        const list = raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
        return list.includes(String(v));
      }
      const val = parseVal(raw);
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        const eq = JSON.stringify(v) === raw;
        return op === 'eq' ? eq : op === 'neq' ? !eq : false;
      }
      switch (op) {
        case 'eq': return String(v) === String(val);
        case 'neq': return String(v) !== String(val);
        case 'gt': return cmp(v, val) > 0;
        case 'gte': return cmp(v, val) >= 0;
        case 'lt': return cmp(v, val) < 0;
        case 'lte': return cmp(v, val) <= 0;
        default: throw new Error(`op ${op}`);
      }
    });
  }
  function parseQuery(search) {
    const p = new URLSearchParams(search);
    const filters = [];
    let select = null; let order = []; let limit = Infinity;
    for (const [k, v] of p) {
      if (k === 'select') select = v.split(',');
      else if (k === 'order') order = v.split(',').map((o) => o.split('.'));
      else if (k === 'limit') limit = Number(v);
      else if (k === 'or') filters.push(['or', 'or', v]);
      else {
        const i = v.indexOf('.');
        filters.push([k, v.slice(0, i), v.slice(i + 1)]);
      }
    }
    return { filters, select, order, limit };
  }
  function recount(reportId) {
    const r = tables.reports.find((x) => x.id === reportId);
    if (!r) return;
    const vs = tables.votes.filter((v) => v.report_id === reportId);
    r.confirms = vs.filter((v) => v.kind === 'confirm').length;
    r.falses = vs.filter((v) => v.kind === 'false').length;
    r.flags = vs.filter((v) => v.kind === 'flag').length;
    if (r.status === 'visible' && !r.reviewed && r.flags >= 5) { r.status = 'hidden'; r.hidden_reason = 'auto: 5 flags'; }
  }
  const DEFAULTS = {
    reports: () => ({
      created_at: new Date().toISOString(), media: [], sensitive: false, status: 'pending', reviewed: false,
      mod_override: null, confirms: 0, falses: 0, flags: 0, hidden_reason: null, time_of_day: null, area_label: null,
      old_media: false, net_fp: null, updates: 0, agency: null,
    }),
    report_updates: () => ({
      created_at: new Date().toISOString(), media: [], sensitive: false, old_media: false, status: 'pending',
      reviewed: false, flags: 0, hidden_reason: null, caption: null, net_fp: null,
    }),
    update_flags: () => ({ created_at: new Date().toISOString() }),
    votes: () => ({ created_at: new Date().toISOString(), reason: null, net_fp: null }),
    rate_events: () => ({ id: seq++, created_at: new Date().toISOString() }),
    blocked_devices: () => ({ created_at: new Date().toISOString() }),
    mod_log: () => ({ id: seq++, created_at: new Date().toISOString() }),
  };
  const KEYS = {
    reports: ['id'], votes: ['report_id', 'device_hash', 'kind'], blocked_devices: ['device_hash'],
    report_updates: ['id'], update_flags: ['update_id', 'device_hash'],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const body = await readBody(req);

    // ---- place search ----
    if (url.pathname.startsWith('/photon')) {
      const feat = (name, lng, lat, extra = {}) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { name, countrycode: 'NG', state: 'Kaduna State', county: 'Birnin Gwari', osm_key: 'highway', ...extra },
      });
      if (url.pathname.endsWith('/reverse')) {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        return json(res, 200, { features: [feat('Kaduna Road', lon, lat)] });
      }
      return json(res, 200, { features: [
        feat('Kaduna Road', 6.545, 10.665),
        feat('Kaduna Road Motor Park', 6.551, 10.668, { osm_key: 'amenity' }),
        feat('Birnin Gwari', 6.55, 10.67, { osm_key: 'place', type: 'city' }),
      ] });
    }

    // ---- storage ----
    if (url.pathname.startsWith('/storage/v1/')) {
      const rest = url.pathname.slice('/storage/v1/'.length);
      if (req.method === 'POST' && rest.startsWith('object/upload/sign/media/')) {
        const path = decodeURIComponent(rest.slice('object/upload/sign/media/'.length));
        return json(res, 200, { url: `/object/upload/sign/media/${path}?token=up-${seq++}` });
      }
      if (req.method === 'PUT' && rest.startsWith('object/upload/sign/media/')) {
        const path = decodeURIComponent(rest.slice('object/upload/sign/media/'.length));
        files.set(path, { type: req.headers['content-type'], body });
        return json(res, 200, { Key: `media/${path}` });
      }
      if (req.method === 'POST' && rest === 'object/sign/media') {
        const { paths } = JSON.parse(body.toString() || '{}');
        return json(res, 200, paths.map((p) => ({ path: p, signedURL: `/object/sign/media/${p}?token=dl`, error: null })));
      }
      if (req.method === 'GET' && rest.startsWith('object/sign/media/')) {
        const f = files.get(decodeURIComponent(rest.slice('object/sign/media/'.length)));
        if (!f) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': f.type, ...cors });
        return res.end(f.body);
      }
      if (req.method === 'POST' && rest === 'object/list/media') {
        const { prefix } = JSON.parse(body.toString() || '{}');
        const out = [...files.keys()].filter((k) => k.startsWith(`${prefix}/`)).map((k) => ({ name: k.slice(prefix.length + 1) }));
        return json(res, 200, out);
      }
      if (req.method === 'DELETE' && rest === 'object/media') {
        const { prefixes } = JSON.parse(body.toString() || '{}');
        prefixes.forEach((p) => files.delete(p));
        return json(res, 200, []);
      }
      return json(res, 404, { error: `no storage route ${req.method} ${rest}` });
    }

    // ---- database ----
    if (!url.pathname.startsWith('/rest/v1/')) return json(res, 404, { error: 'not found' });
    if (!req.headers.apikey) return json(res, 401, { message: 'no apikey' });
    const name = url.pathname.slice('/rest/v1/'.length);

    if (name.startsWith('rpc/')) {
      const fn = name.slice(4);
      const args = JSON.parse(body.toString() || '{}');
      if (fn === 'hit_rate') {
        const since = Date.now() - args.p_window_seconds * 1000;
        const n = tables.rate_events.filter((e) => e.key === args.p_key && e.kind === args.p_kind && Date.parse(e.created_at) > since).length;
        tables.rate_events.push({ ...DEFAULTS.rate_events(), key: args.p_key, kind: args.p_kind });
        return json(res, 200, n);
      }
      if (fn === 'cleanup_old_rows') return json(res, 200, null);
      return json(res, 404, { message: `no function ${fn}` });
    }

    const table = tables[name];
    if (!table) return json(res, 404, { message: `no table ${name}` });
    const q = parseQuery(url.search);
    const prefer = String(req.headers.prefer || '');

    if (req.method === 'GET') {
      let rows = table.filter((r) => matches(r, q.filters));
      for (const [col, dir] of [...q.order].reverse()) {
        rows = [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[col], b[col]));
      }
      rows = rows.slice(0, q.limit);
      if (q.select) rows = rows.map((r) => Object.fromEntries(q.select.map((c) => [c, r[c] ?? null])));
      return json(res, 200, rows);
    }
    if (req.method === 'POST') {
      const input = JSON.parse(body.toString());
      const list = Array.isArray(input) ? input : [input];
      const out = [];
      for (const row of list) {
        const full = { ...DEFAULTS[name](), ...row };
        const keys = KEYS[name];
        if (keys && table.some((r) => keys.every((k) => r[k] === full[k]))) {
          if (prefer.includes('ignore-duplicates')) continue;
          return json(res, 409, { message: 'duplicate key' });
        }
        table.push(full);
        out.push(full);
        if (name === 'votes') recount(full.report_id);
      }
      return json(res, 201, prefer.includes('return=representation') ? out : undefined);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body.toString());
      const rows = table.filter((r) => matches(r, q.filters));
      rows.forEach((r) => Object.assign(r, patch));
      return json(res, 200, rows);
    }
    if (req.method === 'DELETE') {
      const keep = table.filter((r) => !matches(r, q.filters));
      const removed = table.filter((r) => matches(r, q.filters));
      tables[name] = keep;
      if (name === 'votes') removed.forEach((v) => recount(v.report_id));
      if (name === 'reports') {
        tables.votes = tables.votes.filter((v) => keep.some((r) => r.id === v.report_id));
        tables.report_updates = tables.report_updates.filter((u) => keep.some((r) => r.id === u.report_id));
      }
      return json(res, 204);
    }
    return json(res, 405, {});
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, tables, files })));
}
