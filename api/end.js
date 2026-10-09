import { route, send, readJson, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, update } from './_lib/supa.js';
import { deviceHash, netFp, rateLimit } from './_lib/security.js';
import { isOwner } from './_lib/votes.js';

// The person who posted a report can mark it as over once the incident has ended.
export default route(['POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const body = await readJson(req);
  const id = String(body.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown report.');
  const dHash = deviceHash(cfg, body.device);
  const nf = netFp(cfg, req, body.fp);
  await rateLimit(cfg, `d:${dHash}`, 'end', 3600, 20, 'Please wait a little and try again.');

  const rows = await select(cfg, 'reports', `select=id,device_hash,net_fp,ended_at&id=eq.${id}&status=eq.visible`);
  const report = rows[0];
  if (!report) throw new HttpError(404, 'That report is no longer available.');
  if (!isOwner(report, dHash, nf)) throw new HttpError(403, 'Only the person who posted this can mark it as over.');
  if (!report.ended_at) await update(cfg, 'reports', `id=eq.${id}`, { ended_at: new Date().toISOString(), ended_by: 'poster' });
  return send(res, 200, { id, ended: true });
});
