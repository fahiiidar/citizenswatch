import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, update, listFolder } from './_lib/supa.js';
import { afterUpdatePublished } from './_lib/updates.js';
import { savePrints } from './_lib/dupes.js';

// Called by the phone after its photos or clip have finished uploading,
// for a new report or for an update added to one.
export default route(['POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const body = await readJson(req);
  const id = String(body.id || '');
  const token = String(body.token || '');
  const isUpdate = body.kind === 'update';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{48}$/.test(token)) {
    throw new HttpError(400, 'That upload could not be matched to a report.');
  }

  const table = isUpdate ? 'report_updates' : 'reports';
  const cols = isUpdate ? 'id,report_id,media,device_hash,net_fp' : 'id,media';
  const rows = await select(cfg, table, `select=${cols}&id=eq.${id}&finalize_token=eq.${token}&status=eq.pending`);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'That report was not found or is already posted.');

  const folder = isUpdate ? `u/${id}` : id;
  const files = await listFolder(cfg, folder);
  const names = new Set(files.map((f) => `${folder}/${f.name}`));
  const missing = (row.media || []).filter((m) => !names.has(m.path));
  if (missing.length) {
    throw new HttpError(409, 'Some files did not finish uploading. Check your connection and post again.');
  }

  await update(cfg, table, `id=eq.${id}`, { status: 'visible', finalize_token: null });
  if (isUpdate) await afterUpdatePublished(cfg, row);
  await savePrints(cfg, { reportId: isUpdate ? row.report_id : row.id, updateId: isUpdate ? row.id : null, media: row.media });
  return send(res, 200, { id, status: 'visible' });
});
