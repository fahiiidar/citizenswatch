// Local test server: serves the app and its API the way Vercel does.
// Usage:  node dev-server.mjs            (uses your real settings from the environment)
//         node dev-server.mjs --mock     (uses an in-memory fake database, no accounts needed)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

if (process.argv.includes('--mock')) {
  const { startMock } = await import('./tests/mock-supabase.mjs');
  await startMock(54321);
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJmock-service-key',
    HASH_SECRET: 'local-testing-secret-123456',
    MODERATOR_KEYS: 'tester:local-moderator-key-123',
    GEOCODER_URL: 'http://localhost:54321/photon',
  });
  console.log('Using the fake database. Moderator key: local-moderator-key-123');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = url.pathname;

  const share = path.match(/^\/r\/([0-9a-f-]{36})$/i);
  if (share) { req.url = `/api/share?id=${share[1]}`; path = '/api/share'; }

  if (path.startsWith('/api/')) {
    const name = path.slice(5).replace(/[^a-z]/g, '');
    try {
      const mod = await import(join(ROOT, 'api', `${name}.js`));
      return await mod.default(req, res);
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') { res.statusCode = 404; return res.end('Not found'); }
      console.error(err);
      res.statusCode = 500;
      return res.end('Server error');
    }
  }

  if (path === '/') path = '/index.html';
  const file = normalize(join(ROOT, 'public', path));
  if (!file.startsWith(join(ROOT, 'public'))) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`CitizensWatch running at http://localhost:${PORT}`));
