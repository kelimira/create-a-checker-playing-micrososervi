import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';

import { boot, call, waitFor } from './helpers.js';

test('AC-7 create / validate / 404', async () => {
  const a = await boot({ baseMs: 1000 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { color: 'black' });
    assert.equal(r.status, 201); assert.equal(r.body.status, 'waiting');
    assert.equal((await call(a.url, 'POST', '/api/games', { color: 'green' })).status, 400);
    assert.equal((await call(a.url, 'POST', '/api/games', '{bad')).status, 400);
    assert.equal((await call(a.url, 'GET', '/api/games/nope')).status, 404);
    assert.equal((await call(a.url, 'GET', `/api/games/${r.body.id}`)).status, 200);
  } finally { await a.close(); }
});

test('AC-8 join, AC-11 peer validation, second join 409', async () => {
  const a = await boot({ baseMs: 100000 }), b = await boot({ baseMs: 100000 });
  try {
    const { body: g } = await call(a.url, 'POST', '/api/games', { color: 'red' });
    const j = await call(b.url, 'POST', '/api/games/join', { peerUrl: a.url, gameId: g.id });
    assert.equal(j.status, 201); assert.equal(j.body.myColor, 'black');
    await waitFor(async () => (await call(a.url, 'GET', `/api/games/${g.id}`)).body.status === 'active');
    assert.equal((await call(a.url, 'POST', '/api/games/join', { peerUrl: a.url, gameId: g.id })).status, 409);
    const c = await boot();
    assert.equal((await call(c.url, 'POST', '/api/games/join', { peerUrl: a.url, gameId: g.id })).status, 409);
    await c.close();

    // A is red, black (B) moves first. Peer calls go to A with A's token.
    const token = a.games.get(g.id).token;
    const mv = { path: [[5, 0], [4, 1]] };
    const post = (b2) => call(a.url, 'POST', `/peer/games/${g.id}/moves`, b2);
    assert.equal((await post({ token: 'x', ply: 0, move: mv })).status, 401);
    assert.equal((await post({ token, ply: 3, move: mv })).status, 409);
    assert.equal((await post({ token, ply: 0, move: { path: [[5, 0], [3, 2]] } })).status, 422);
    assert.equal((await post({ token, ply: 'x' })).status, 400);
    assert.equal(a.games.get(g.id).history.length, 0);
    assert.equal((await post({ token, ply: 0, move: mv })).status, 202);
    assert.equal((await post({ token, ply: 0, move: mv })).status, 200); // duplicate is idempotent
    assert.equal((await post({ token, ply: 0, move: { path: [[5, 2], [4, 1]] } })).status, 409);
  } finally { await a.close(); await b.close(); }
});

test('AC-9 initiate with opponent activates both', async () => {
  const a = await boot({ baseMs: 100000 }), b = await boot({ baseMs: 100000 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { opponent: b.url });
    assert.equal(r.status, 201);
    const gb = await waitFor(() => b.games.get(r.body.id));
    assert.equal(gb.status, 'active');
    assert.equal(a.games.get(r.body.id).status, 'active');
    assert.notEqual(gb.myColor, r.body.myColor);
  } finally { await a.close(); await b.close(); }
});

test('AC-12 unreachable peer aborts', async () => {
  const dead = await boot(); const deadUrl = dead.url; await dead.close();
  const a = await boot({ retries: 2 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { opponent: deadUrl });
    assert.equal(r.body.status, 'aborted'); assert.match(r.body.reason, /unreachable/);
  } finally { await a.close(); }
});

test('AC-12 peer vanishing mid-game aborts', async () => {
  const a = await boot({ retries: 1 }), b = await boot({ baseMs: 100000 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { opponent: b.url, color: 'black' });
    await b.close();
    const g = await waitFor(() => a.games.get(r.body.id).status === 'aborted' && a.games.get(r.body.id));
    assert.match(g.reason, /unreachable/);
  } finally { await a.close(); }
});

test('AC-13 speed validation, delayFor, re-arm', async () => {
  const a = await boot({ baseMs: 100000 });
  try {
    const { body: g } = await call(a.url, 'POST', '/api/games', {});
    for (const bad of [0, 21, '5', null]) assert.equal((await call(a.url, 'POST', `/api/games/${g.id}/speed`, { speed: bad })).status, 400);
    for (const ok of [0.1, 20, 2.5]) assert.equal((await call(a.url, 'POST', `/api/games/${g.id}/speed`, { speed: ok })).body.speed, ok);
  } finally { await a.close(); }
  const timers = { set: [], cleared: [], setTimeout(fn, ms) { this.set.push(ms); return this.set.length; }, clearTimeout(id) { this.cleared.push(id); } };
  const g = new Game({ id: 'x', myColor: 'black', baseMs: 1000, timers });
  g.start();
  assert.equal(g.delayFor(), 1000); assert.deepEqual(timers.set, [1000]);
  g.setSpeed(4);
  assert.equal(g.delayFor(), 250); assert.deepEqual(timers.cleared, [1]); assert.deepEqual(timers.set, [1000, 250]);
});

test('AC-14 pause stops own moves but peer moves still apply', async () => {
  const timers = { fns: [], setTimeout(fn) { this.fns.push(fn); return this.fns.length; }, clearTimeout() {} };
  const g = new Game({ id: 'x', myColor: 'red', baseMs: 0, timers, net: { fetch: async () => ({ status: 202, json: async () => ({}) }) }, peerUrl: 'http://p', token: 't' });
  g.start(); g.setPaused(true);
  assert.equal(g.receive(0, { path: [[5, 0], [4, 1]] }).status, 202); // applied while paused
  assert.equal(g.st.turn, 'red');
  assert.equal(timers.fns.length, 0); // no move scheduled while paused
  g.setPaused(false);
  assert.equal(timers.fns.length, 1);
  timers.fns[0]();
  assert.equal(g.history.length, 2);
});

test('AC-15 SSE snapshot then updates', async () => {
  const a = await boot({ baseMs: 100000 }), b = await boot({ baseMs: 100000 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { opponent: b.url, color: 'red' });
    const res = await fetch(`${a.url}/api/games/${r.body.id}/events`);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    const next = async () => { while (!buf.includes('\n\n')) { const { value } = await reader.read(); buf += dec.decode(value); } const i = buf.indexOf('\n\n'); const ev = buf.slice(0, i); buf = buf.slice(i + 2); return ev; };
    assert.match(await next(), /^event: state\ndata: /);
    const token = a.games.get(r.body.id).token;
    await call(a.url, 'POST', `/peer/games/${r.body.id}/moves`, { token, ply: 0, move: { path: [[5, 0], [4, 1]] } });
    let ev; do { ev = await next(); } while (!ev.includes('"ply":1'));
    assert.ok(ev.startsWith('event: state'));
    await reader.cancel();
  } finally { await a.close(); await b.close(); }
});

test('AC-16 UI served, no external assets', async () => {
  const a = await boot();
  try {
    const res = await fetch(a.url + '/'); const html = await res.text();
    assert.match(res.headers.get('content-type'), /html/);
    assert.match(html, /id="speed"/); assert.match(html, /id="board"/);
    assert.doesNotMatch(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /(src|href)=["']https?:/);
    assert.equal((await call(a.url, 'GET', '/health')).body.ok, true);
  } finally { await a.close(); }
});

test('AC-17 security', async () => {
  const a = await boot({ allowedPeers: ['http://127.0.0.1:1'] });
  try {
    assert.equal((await call(a.url, 'POST', '/api/games', { opponent: 'file:///etc/passwd' })).status, 400);
    assert.equal((await call(a.url, 'POST', '/api/games/join', { peerUrl: 'ftp://x', gameId: 'g' })).status, 400);
    assert.equal((await call(a.url, 'POST', '/api/games', { opponent: 'http://127.0.0.1:2' })).status, 403);
    assert.equal((await call(a.url, 'POST', '/api/games', { pad: 'x'.repeat(70000) })).status, 413);
  } finally { await a.close(); }
});

test('AC-18 no dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.devDependencies, undefined);
});
