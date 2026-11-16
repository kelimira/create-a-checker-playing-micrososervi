import { legalMoves, play } from './engine.js';

// Uniform int in [0,n) via Web Crypto with rejection sampling (no modulo bias).
export function randInt(n) {
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

function evaluate(board, turn) {
  let s = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    const black = p.toLowerCase() === 'b';
    const v = p === p.toUpperCase() ? 160 : 100 + 3 * (black ? 7 - r : r);
    s += (black ? 'black' : 'red') === turn ? v : -v;
  }
  return s;
}

function nega(st, d, a, b) {
  const ms = legalMoves(st);
  if (!ms.length) return -1e5 - d;
  if (d === 0) return evaluate(st.board, st.turn);
  let best = -Infinity;
  for (const m of ms) {
    best = Math.max(best, -nega(play(st, m), d - 1, -b, -a));
    a = Math.max(a, best);
    if (a >= b) break;
  }
  return best;
}

export function chooseMove(state, depth = 4) {
  const ms = legalMoves(state);
  if (ms.length <= 1) return ms[0];
  const scores = ms.map((m) => -nega(play(state, m), Math.max(depth, 1) - 1, -Infinity, Infinity));
  const top = Math.max(...scores);
  const best = ms.filter((_, i) => scores[i] === top);
  return best[randInt(best.length)];
}
