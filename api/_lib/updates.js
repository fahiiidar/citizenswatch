import { select, update } from './supa.js';
import { castVote, isOwner } from './votes.js';

// Keeps the "N updates" count on a report correct.
export async function recountUpdates(cfg, reportId) {
  const rows = await select(cfg, 'report_updates', `select=id&report_id=eq.${reportId}&status=eq.visible&limit=1000`);
  await update(cfg, 'reports', `id=eq.${reportId}`, { updates: rows.length });
}

// Runs once an update is visible. Adding your own photos or words to someone
// else's report also counts as confirming it.
export async function afterUpdatePublished(cfg, upd) {
  await recountUpdates(cfg, upd.report_id);
  const rows = await select(cfg, 'reports', `select=id,device_hash,net_fp&id=eq.${upd.report_id}`);
  const report = rows[0];
  if (report && !isOwner(report, upd.device_hash, upd.net_fp)) {
    await castVote(cfg, { reportId: report.id, dHash: upd.device_hash, nf: upd.net_fp, kind: 'confirm' });
  }
}
