import { createApp } from '../src/server.js';

export const fast = { baseMs: 0, depth: 1, retries: 4, backoffMs: 5 };
export async function boot(o = {}) {
  const app = createApp({ ...fast, ...o });
  const port = await app.listen(0);
  return { ...app, url: `http://127.0.0.1:${port}` };
}
export const call = async (base, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
export async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('waitFor timeout'); await new Promise((r) => setTimeout(r, 10)); }
}

