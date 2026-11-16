import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, fromAscii, legalMoves, applyMove, outcome } from '../src/engine.js';

const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v && deepFreeze(v)); return Object.freeze(o); };
const count = (s, ch) => s.board.flat().filter((p) => p?.toLowerCase() === ch).length;

test('AC-1 initial position', () => {
  const s = initialState();
  assert.equal(count(s, 'b'), 12); assert.equal(count(s, 'r'), 12);
  assert.equal(s.turn, 'black'); assert.equal(legalMoves(s).length, 7);
});

test('AC-2 mandatory capture', () => {
  const s = fromAscii(['........', '........', '..r.....', '...b....', '........', '.......b', '........', '........']);
  const ms = legalMoves(s);
  assert.deepEqual(ms.map((m) => m.path), [[[3, 3], [1, 1]]]);
});

test('AC-3 multi-jump is a single move', () => {
  const t = fromAscii(['........', '........', '..r.r...', '........', '..r.....', '.b......', '........', '........']);
  const ms = legalMoves(t);
  assert.equal(ms.length, 2);
  assert.ok(ms.every((m) => m.path.length === 3));
  assert.equal(count(applyMove(t, ms[0]), 'r'), 1);
});

test('AC-3 men capture forward only, kings both ways', () => {
  const behind = fromAscii(['........', '........', '..b.....', '...r....', '........', '........', '........', '........'], 'red');
  assert.ok(legalMoves(behind).every((m) => m.path.length === 2 && m.path[1][0] === 4)); // red man cannot jump back over (2,2)
  const king = fromAscii(['........', '........', '..r.....', '...R....', '........', '........', '........', '........'].map((r) => r.replace('R', 'B')), 'black');
  assert.deepEqual(legalMoves(king).map((m) => m.path), [[[3, 3], [1, 1]]]);
  const redKing = fromAscii(['........', '........', '..b.....', '...R....', '........', '........', '........', '........'], 'red');
  assert.deepEqual(legalMoves(redKing).map((m) => m.path), [[[3, 3], [1, 1]]]); // red king jumps backward (up)
});

test('AC-3 promotion ends the chain', () => {
  // black man (2,1) jumps (1,2) -> (0,3) and is crowned; a king could continue over (1,4) but the chain stops.
  const p = fromAscii(['........', '..r.r...', '.b......', '........', '........', '........', '........', '........']);
  const ms = legalMoves(p);
  assert.deepEqual(ms.map((m) => m.path), [[[2, 1], [0, 3]]]);
  assert.equal(applyMove(p, ms[0]).board[0][3], 'B');
});

test('AC-4 no moves loses; 40-ply draw; repetition draw', () => {
  const lost = fromAscii(['........', '........', '........', '........', '........', '........', '........', '........']);
  assert.equal(outcome(lost).winner, 'red');
  let s = fromAscii(['B.......', '........', '........', '........', '........', '........', '........', '.......R']);
  assert.equal(outcome({ ...s, noProgress: 40 }).winner, 'draw');
  // kings shuffle -> repetition
  s = fromAscii(['.B......', '........', '........', '........', '........', '........', '........', '.......R'], 'black');
  const seq = [[[0, 1], [1, 0]], [[7, 7], [6, 6]], [[1, 0], [0, 1]], [[6, 6], [7, 7]]];
  let r;
  for (let i = 0; i < 2; i++) for (const p of seq) { s = applyMove(s, { path: p }); r = outcome(s); }
  assert.equal(r?.winner, 'draw'); assert.match(r.reason, /repetition/);
});

test('AC-5 illegal move throws, input never mutated', () => {
  const s = deepFreeze(initialState());
  assert.throws(() => applyMove(s, { path: [[0, 0], [1, 1]] }));
  assert.throws(() => applyMove(s, {}));
  const m = legalMoves(s)[0];
  const n = applyMove(s, m);
  assert.equal(n.turn, 'red'); assert.equal(s.turn, 'black');
});
