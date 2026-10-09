import { route, send, HttpError } from './_lib/http.js';
import { requireServerConfig } from './_lib/env.js';
import { rpc } from './_lib/supa.js';

// Runs once a day (see vercel.json) to delete old rate-limit records
// and reports whose uploads never finished.
export default route(['GET'], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    throw new HttpError(401, 'Not allowed.');
  }
  const cfg = requireServerConfig();
  await rpc(cfg, 'cleanup_old_rows', {});
  send(res, 200, { ok: true });
});
