import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, randInt } from '../src/ai.js';
import { initialState, fromAscii, legalMoves } from '../src/engine.js';

test('AC-6 AI returns legal moves, takes forced and free captures', () => {
  const s = initialState();
  const m = chooseMove(s, 2);
  assert.ok(legalMoves(s).some((x) => JSON.stringify(x) === JSON.stringify(m)));
  const forced = fromAscii(['........', '........', '..r.....', '...b....', '........', '........', '........', '........']);
  assert.deepEqual(chooseMove(forced, 2).path, [[3, 3], [1, 1]]);
  const free = fromAscii(['........', '........', '........', '..r.....', '...b....', '........', '.......b', '........'].map((r) => r));
  assert.equal(chooseMove(free, 2).path.length, 3 - 1);
});

test('AC-6 randInt range, coverage, rejection sampling', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const x = randInt(5); assert.ok(x >= 0 && x < 5); seen.add(x); }
  assert.equal(seen.size, 5);
  const orig = crypto.getRandomValues;
  const n = 3, limit = Math.floor(2 ** 32 / n) * n;
  const feed = [limit, 0xffffffff, 7]; let calls = 0;
  crypto.getRandomValues = (buf) => { buf[0] = feed[calls++]; return buf; };
  try { assert.equal(randInt(n), 7 % 3); assert.equal(calls, 3); } finally { crypto.getRandomValues = orig; }
});
