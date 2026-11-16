import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, waitFor } from './helpers.js';
import { initialState, applyMove } from '../src/engine.js';

test('AC-10 two instances play to a terminal state with identical records', async () => {
  const a = await boot({ depth: 2 }), b = await boot({ depth: 2 });
  try {
    const r = await call(a.url, 'POST', '/api/games', { opponent: b.url, speed: 20 });
    const id = r.body.id;
    const done = (s) => s.status === 'finished';
    const ga = await waitFor(() => done(a.games.get(id)?.snapshot() ?? {}) && a.games.get(id).snapshot(), 60000);
    const gb = await waitFor(() => done(b.games.get(id)?.snapshot() ?? {}) && b.games.get(id).snapshot(), 60000);
    assert.deepEqual(ga.board, gb.board); assert.deepEqual(ga.history, gb.history);
    assert.equal(ga.winner, gb.winner); assert.ok(ga.winner);
    let s = initialState();
    for (const m of ga.history) s = applyMove(s, m); // throws if any move illegal
    assert.deepEqual(s.board, ga.board);
  } finally { await a.close(); await b.close(); }
});
