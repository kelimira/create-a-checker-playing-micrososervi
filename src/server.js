import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Game, postJson, validSpeed } from './game.js';
import { randInt } from './ai.js';

const MAX_BODY = 64 * 1024;
const UI = readFileSync(new URL('../public/index.html', import.meta.url));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const COLORS = ['black', 'red'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.pause(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString());
        if (b === null || typeof b !== 'object' || Array.isArray(b)) throw 0;
        resolve(b);
      } catch { reject(new HttpError(400, 'malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

export function createApp(opts = {}) {
  const env = process.env;
  const cfg = {
    baseMs: Number(opts.baseMs ?? env.BASE_DELAY_MS ?? 1000),
    depth: Number(opts.depth ?? env.AI_DEPTH ?? 4),
    publicUrl: opts.publicUrl ?? env.PUBLIC_URL,
    allowed: [].concat(opts.allowedPeers ?? env.ALLOWED_PEERS?.split(',') ?? []).map((s) => s.trim()).filter(Boolean).map((o) => new URL(o).origin),
    net: { retries: opts.retries ?? 3, backoffMs: opts.backoffMs ?? 250, ...(opts.fetch && { fetch: opts.fetch }) },
  };
  const games = new Map();
  const pub = (req) => (cfg.publicUrl ?? `http://${req.headers.host}`).replace(/\/$/, '');

  function peerUrl(v, name) {
    let u;
    try { u = new URL(v); } catch { throw new HttpError(400, `${name} must be an http(s) URL`); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${name} must be an http(s) URL`);
    if (cfg.allowed.length && !cfg.allowed.includes(u.origin)) throw new HttpError(403, `${name} not in ALLOWED_PEERS`);
    return u.href.replace(/\/$/, '');
  }
  const speedOf = (b) => {
    if (b.speed === undefined) return 1;
    if (!validSpeed(b.speed)) throw new HttpError(400, 'speed must be a number 0.1-20');
    return b.speed;
  };
  const get = (id) => games.get(id) ?? (() => { throw new HttpError(404, 'unknown game'); })();
  const newGame = (o) => new Game({ baseMs: cfg.baseMs, depth: cfg.depth, net: cfg.net, ...o });

  const routes = [
    ['POST', /^\/api\/games$/, async (req, _p, b) => {
      if (b.color !== undefined && !COLORS.includes(b.color)) throw new HttpError(400, 'color must be black or red');
      const opponent = b.opponent === undefined ? null : peerUrl(b.opponent, 'opponent');
      const g = newGame({ id: randomUUID(), myColor: b.color ?? COLORS[randInt(2)], speed: speedOf(b) });
      games.set(g.id, g);
      if (opponent) {
        try {
          const r = await postJson(`${opponent}/api/games/join`, { peerUrl: pub(req), gameId: g.id }, cfg.net);
          if (r.status >= 300) g.abort(`invite failed (${r.status}): ${r.body?.error ?? ''}`);
        } catch { g.abort('peer unreachable'); }
      }
      return [201, g.snapshot()];
    }],
    ['POST', /^\/api\/games\/join$/, async (req, _p, b) => {
      const peer = peerUrl(b.peerUrl, 'peerUrl');
      if (typeof b.gameId !== 'string' || !b.gameId) throw new HttpError(400, 'gameId required');
      const speed = speedOf(b);
      if (games.has(b.gameId)) throw new HttpError(409, 'game already exists here');
      let r;
      try { r = await postJson(`${peer}/peer/games/${encodeURIComponent(b.gameId)}/join`, { callbackUrl: pub(req) }, cfg.net); }
      catch { throw new HttpError(502, 'peer unreachable'); }
      if (r.status >= 300) throw new HttpError(r.status, r.body?.error ?? 'join failed');
      if (!COLORS.includes(r.body.color) || typeof r.body.token !== 'string') throw new HttpError(502, 'bad join response');
      const g = newGame({ id: b.gameId, myColor: r.body.color, speed, peerUrl: peer, token: r.body.token });
      games.set(g.id, g);
      g.start();
      return [201, g.snapshot()];
    }],
    ['GET', /^\/api\/games$/, async () => [200, [...games.values()].map((g) => g.snapshot())]],
    ['GET', /^\/api\/games\/([^/]+)$/, async (_r, p) => [200, get(p[0]).snapshot()]],
    ['POST', /^\/api\/games\/([^/]+)\/speed$/, async (_r, p, b) => {
      const g = get(p[0]);
      if (!validSpeed(b.speed)) throw new HttpError(400, 'speed must be a number 0.1-20');
      g.setSpeed(b.speed);
      return [200, g.snapshot()];
    }],
    ['POST', /^\/api\/games\/([^/]+)\/pause$/, async (_r, p, b) => {
      const g = get(p[0]);
      if (typeof b.paused !== 'boolean') throw new HttpError(400, 'paused must be boolean');
      g.setPaused(b.paused);
      return [200, g.snapshot()];
    }],
    ['POST', /^\/peer\/games\/([^/]+)\/join$/, async (_r, p, b) => {
      const g = get(p[0]);
      const cb = peerUrl(b.callbackUrl, 'callbackUrl');
      if (g.status !== 'waiting') throw new HttpError(409, 'game not waiting');
      g.peerUrl = cb; g.token = randomUUID();
      g.status = 'active';
      setImmediate(() => g.start()); // let the join response go out first
      return [200, { color: COLORS.find((c) => c !== g.myColor), token: g.token }];
    }],
    ['POST', /^\/peer\/games\/([^/]+)\/moves$/, async (_r, p, b) => {
      const g = get(p[0]);
      if (!g.token || b.token !== g.token) throw new HttpError(401, 'bad token');
      if (!Array.isArray(b.move?.path) || !Number.isInteger(b.ply)) throw new HttpError(400, 'ply and move.path required');
      const r = g.receive(b.ply, b.move);
      return [r.status, r.error ? { error: r.error } : { ok: true }];
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      const path = new URL(req.url, 'http://x').pathname;
      if (req.method === 'GET' && path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(UI); }
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true });
      const sse = path.match(/^\/api\/games\/([^/]+)\/events$/);
      if (req.method === 'GET' && sse) {
        const g = get(sse[1]);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const push = (s) => res.write(`event: state\ndata: ${JSON.stringify(s)}\n\n`);
        push(g.snapshot());
        g.subs.add(push);
        req.on('close', () => g.subs.delete(push));
        return;
      }
      for (const [method, re, handler] of routes) {
        const m = path.match(re);
        if (m && method === req.method) {
          const body = method === 'POST' ? await readBody(req) : {};
          const [status, out] = await handler(req, m.slice(1).map(decodeURIComponent), body);
          return send(status, out);
        }
      }
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) { res.setHeader('connection', 'close'); return send(e.status, { error: e.message }); }
      console.error(e);
      send(500, { error: 'internal error' });
    }
  });

  return {
    server, games,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    close: () => { games.forEach((g) => g.unschedule()); server.closeAllConnections?.(); return new Promise((r) => server.close(r)); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port).then(() => console.log(`checkers service on http://localhost:${port}`));
}
