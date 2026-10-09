import { route, send, readJson, queryOf, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { select, update, insert, remove, signDownloads, removeFiles } from './_lib/supa.js';
import { requireModerator } from './_lib/security.js';
import { fullShape, statusOf, watToday } from './_lib/reports.js';

const COLUMNS =
  'id,created_at,category,is_now,occurred_on,time_of_day,occurred_at,caption,place_label,area_label,lat,lng,media,sensitive,status,hidden_reason,reviewed,mod_override,confirms,falses,flags,device_hash';

const QUEUES = {
  flagged: 'status=eq.visible&flags=gt.0&reviewed=eq.false&order=flags.desc,created_at.desc',
  media: 'status=eq.visible&reviewed=eq.false&media=neq.%5B%5D&order=created_at.desc',
  disputed: 'status=eq.visible&falses=gte.3&order=falses.desc',
  hidden: 'status=eq.hidden&order=created_at.desc',
  recent: 'status=eq.visible&order=created_at.desc',
};

export default route(['GET', 'POST'], async (req, res) => {
  const cfg = requireServerConfig();
  const moderator = requireModerator(cfg, req);
  if (req.method === 'GET') return getQueue(cfg, req, res, moderator);
  return act(cfg, req, res, moderator);
});

async function getQueue(cfg, req, res, moderator) {
  const q = queryOf(req);
  const name = q.get('queue') || 'flagged';
  if (!QUEUES[name]) throw new HttpError(400, 'Unknown queue.');

  const rows = await select(cfg, 'reports', `select=${COLUMNS}&${QUEUES[name]}&limit=60`);
  const list = name === 'disputed' ? rows.filter((r) => statusOf(r) === 'disputed') : rows;
  const urls = await signDownloads(cfg, list.flatMap((r) => (r.media || []).map((m) => m.path)), 1800);
  const reports = list.map((r) => ({
    ...fullShape(r, urls),
    flags: r.flags,
    reviewed: r.reviewed,
    hidden: r.status === 'hidden',
    hidden_reason: r.hidden_reason,
    mod_override: r.mod_override,
    device: r.device_hash.slice(0, 10),
  }));

  // Flag reasons, so moderators can see why people flagged each report.
  const reasons = {};
  if (reports.length) {
    const ids = reports.map((r) => `"${r.id}"`).join(',');
    const votes = await select(cfg, 'votes', `select=report_id,reason&kind=eq.flag&report_id=in.(${ids})`);
    for (const v of votes) {
      reasons[v.report_id] = reasons[v.report_id] || {};
      reasons[v.report_id][v.reason] = (reasons[v.report_id][v.reason] || 0) + 1;
    }
  }

  const counts = await countAll(cfg);
  return send(res, 200, { moderator, queue: name, reports: reports.map((r) => ({ ...r, flag_reasons: reasons[r.id] || {} })), counts });
}

async function countAll(cfg) {
  const since = new Date(Date.parse(`${watToday()}T00:00:00Z`) - 3600e3).toISOString();
  const [flagged, media, disputed, today, hiddenToday] = await Promise.all([
    select(cfg, 'reports', `select=id&${QUEUES.flagged}&limit=500`),
    select(cfg, 'reports', `select=id&${QUEUES.media}&limit=500`),
    select(cfg, 'reports', `select=id,confirms,falses,mod_override&${QUEUES.disputed}&limit=500`),
    select(cfg, 'reports', `select=id&status=neq.pending&created_at=gte.${since}&limit=5000`),
    select(cfg, 'reports', `select=id&status=eq.hidden&created_at=gte.${since}&limit=5000`),
  ]);
  return {
    flagged: flagged.length,
    media: media.length,
    disputed: disputed.filter((r) => statusOf(r) === 'disputed').length,
    today: today.length,
    hiddenToday: hiddenToday.length,
  };
}

async function act(cfg, req, res, moderator) {
  const body = await readJson(req);
  const id = String(body.id || '');
  const action = String(body.action || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown report.');

  const rows = await select(cfg, 'reports', `select=id,device_hash,media,status&id=eq.${id}`);
  const report = rows[0];
  if (!report) throw new HttpError(404, 'That report no longer exists.');
  const where = `id=eq.${id}`;
  let detail = null;

  switch (action) {
    case 'approve':
      await update(cfg, 'reports', where, { reviewed: true, status: 'visible', hidden_reason: null });
      break;
    case 'hide':
      await update(cfg, 'reports', where, { status: 'hidden', reviewed: true, hidden_reason: `moderator: ${moderator}` });
      break;
    case 'restore':
      await update(cfg, 'reports', where, { status: 'visible', reviewed: true, hidden_reason: null });
      break;
    case 'override': {
      const value = body.value === 'corroborated' || body.value === 'disputed' ? body.value : null;
      await update(cfg, 'reports', where, { mod_override: value, reviewed: true });
      detail = value || 'cleared';
      break;
    }
    case 'sensitive':
      await update(cfg, 'reports', where, { sensitive: Boolean(body.value) });
      detail = String(Boolean(body.value));
      break;
    case 'block':
      await insert(cfg, 'blocked_devices', [{ device_hash: report.device_hash, note: `by ${moderator}` }], {
        returning: false, ignoreDuplicates: true,
      });
      await update(cfg, 'reports', `device_hash=eq.${report.device_hash}&status=eq.visible`, {
        status: 'hidden', reviewed: true, hidden_reason: `blocked by ${moderator}`,
      });
      break;
    case 'delete':
      await removeFiles(cfg, (report.media || []).map((m) => m.path));
      await remove(cfg, 'reports', where);
      break;
    default:
      throw new HttpError(400, 'Unknown action.');
  }

  await insert(cfg, 'mod_log', [{ moderator, report_id: id, action, detail }], { returning: false });
  return send(res, 200, { ok: true });
}
