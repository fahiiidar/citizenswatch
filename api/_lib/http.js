// Small helpers so each API route stays short and works the same on Vercel
// and on the local test server.

export async function readJson(req, limitBytes = 64 * 1024) {
  // Vercel may have parsed the body already.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return safeParse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'That request is too large.');
    chunks.push(chunk);
  }
  return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.');
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!('Cache-Control' in headers)) res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length) return real.trim();
  return req.socket?.remoteAddress || '0.0.0.0';
}

export function queryOf(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams;
}

// Wraps a handler: method check plus one place that turns errors into JSON.
export function route(methods, handler) {
  return async function wrapped(req, res) {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return send(res, 405, { error: 'Method not allowed.' });
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, err.status, { error: err.message, ...(err.extra || {}) });
      }
      console.error(err);
      return send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    }
  };
}
