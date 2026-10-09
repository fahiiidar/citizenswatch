import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, update, listFolder } from './_lib/supa.js';

// Called by the phone after its photos or clip have finished uploading.
export default route(['POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const body = await readJson(req);
  const id = String(body.id || '');
  const token = String(body.token || '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{48}$/.test(token)) {
    throw new HttpError(400, 'That upload could not be matched to a report.');
  }

  const rows = await select(cfg, 'reports',
    `select=id,media,status,finalize_token&id=eq.${id}&finalize_token=eq.${token}&status=eq.pending`);
  const report = rows[0];
  if (!report) throw new HttpError(404, 'That report was not found or is already posted.');

  const files = await listFolder(cfg, id);
  const names = new Set(files.map((f) => `${id}/${f.name}`));
  const missing = (report.media || []).filter((m) => !names.has(m.path));
  if (missing.length) {
    throw new HttpError(409, 'Some files did not finish uploading. Check your connection and post again.');
  }

  await update(cfg, 'reports', `id=eq.${id}`, { status: 'visible', finalize_token: null });
  return send(res, 200, { id, status: 'visible' });
});
