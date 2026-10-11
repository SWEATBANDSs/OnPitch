import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './service.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50_000) throw new HttpError(413, 'Body too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function createApp(svc, { adminToken } = {}) {
  const routes = [];
  const add = (method, path, fn, { auth = true } = {}) =>
    routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, auth });

  add('POST', '/api/players', (c) => svc.register(c.body), { auth: false });
  add('GET', '/api/me', (c) => svc.me(c.user));
  add('PATCH', '/api/me', (c) => svc.updateMe(c.user, c.body));
  add('GET', '/api/calls', (c) => svc.listCalls(c.user, { mine: c.query.get('mine') === '1' }));
  add('POST', '/api/calls', (c) => svc.createCall(c.user, c.body));
  add('GET', '/api/calls/:id', (c) => svc.getCall(c.user, c.params.id));
  add('PATCH', '/api/calls/:id', (c) => svc.editCall(c.user, c.params.id, c.body));
  add('POST', '/api/calls/:id/cancel', (c) => svc.cancelCall(c.user, c.params.id));
  add('POST', '/api/calls/:id/claims', (c) => svc.claim(c.user, c.params.id));
  add('DELETE', '/api/calls/:id/claims/me', (c) => svc.withdraw(c.user, c.params.id));
  add('POST', '/api/calls/:id/claims/:pid/accept', (c) => svc.decide(c.user, c.params.id, c.params.pid, true));
  add('POST', '/api/calls/:id/claims/:pid/decline', (c) => svc.decide(c.user, c.params.id, c.params.pid, false));
  add('POST', '/api/calls/:id/attendance/:pid', (c) => svc.attendance(c.user, c.params.id, c.params.pid, c.body));
  add('GET', '/api/notifications', (c) => svc.inbox(c.user));
  add('POST', '/api/notifications/read', (c) => { svc.markRead(c.user); return { ok: true }; });
  add('POST', '/api/leads', (c) => svc.addLead(c.body), { auth: false });
  add('GET', '/api/leads', (c) => {
    if (!adminToken || c.token !== adminToken) throw new HttpError(401, 'Admin only');
    return svc.leads();
  }, { auth: false });

  async function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname === '/join' ? 'join.html' : pathname.slice(1);
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 404, { error: 'Not found' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { send(res, 404, { error: 'Not found' }); }
  }

  const send = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    try {
      let match, params;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) { match = r; params = m.groups ?? {}; break; }
      }
      if (!match) throw new HttpError(404, 'Not found');
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const ctx = { params, query: url.searchParams, token, body: req.method === 'GET' || req.method === 'DELETE' ? {} : await body(req) };
      if (match.auth) ctx.user = svc.auth(token);
      const result = match.fn(ctx);
      send(res, 200, result);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Internal error' });
    }
  });
}
