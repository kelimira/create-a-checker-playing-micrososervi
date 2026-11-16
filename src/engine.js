// Pure American-checkers rules. Board: 8x8 grid, null|'b'|'B'|'r'|'R' (upper = king). Row 0 = top (red side).
export const other = (c) => (c === 'black' ? 'red' : 'black');
const owner = (p) => (p.toLowerCase() === 'b' ? 'black' : 'red');
const isKing = (p) => p === 'B' || p === 'R';
const KDIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const dirs = (p) => (isKing(p) ? KDIRS : owner(p) === 'black' ? KDIRS.slice(0, 2) : KDIRS.slice(2));
const kingRow = (c) => (c === 'black' ? 0 : 7);
const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const key = (s) => s.turn + s.board.map((r) => r.map((p) => p || '.').join('')).join('');

function mkState(board, turn) {
  const s = { board, turn, noProgress: 0, seen: [] };
  s.seen = [key(s)];
  return s;
}

export function initialState() {
  const board = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 1 ? (r < 3 ? 'r' : r > 4 ? 'b' : null) : null)));
  return mkState(board, 'black');
}

// Test helper: 8 strings of 8 chars, '.' = empty.
export function fromAscii(rows, turn = 'black') {
  return mkState(rows.map((l) => [...l].map((ch) => (ch === '.' ? null : ch))), turn);
}

function jumps(board, [r, c], piece, taken, path, out) {
  const me = owner(piece);
  for (const [dr, dc] of dirs(piece)) {
    const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
    if (!inb(lr, lc) || !board[mr][mc] || owner(board[mr][mc]) === me || taken.has(mr * 8 + mc) || board[lr][lc]) continue;
    const np = [...path, [lr, lc]];
    taken.add(mr * 8 + mc);
    if (!isKing(piece) && lr === kingRow(me)) out.push({ path: np }); // promotion ends the chain
    else {
      const n = out.length;
      jumps(board, [lr, lc], piece, taken, np, out);
      if (out.length === n) out.push({ path: np });
    }
    taken.delete(mr * 8 + mc);
  }
}

export function legalMoves(state) {
  const work = state.board.map((r) => r.slice());
  const jumpsOut = [], steps = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = work[r][c];
    if (!p || owner(p) !== state.turn) continue;
    work[r][c] = null; // lift the piece so its origin counts as empty during chains
    jumps(work, [r, c], p, new Set(), [[r, c]], jumpsOut);
    work[r][c] = p;
    for (const [dr, dc] of dirs(p)) if (inb(r + dr, c + dc) && !work[r + dr][c + dc]) steps.push({ path: [[r, c], [r + dr, c + dc]] });
  }
  return jumpsOut.length ? jumpsOut : steps;
}

// Unchecked move execution (used by AI on moves it generated itself).
export function play(state, move) {
  const b = state.board.map((r) => r.slice());
  const p = move.path;
  const piece = b[p[0][0]][p[0][1]];
  b[p[0][0]][p[0][1]] = null;
  let captured = false;
  for (let i = 1; i < p.length; i++) {
    if (Math.abs(p[i][0] - p[i - 1][0]) === 2) {
      b[(p[i][0] + p[i - 1][0]) / 2][(p[i][1] + p[i - 1][1]) / 2] = null;
      captured = true;
    }
  }
  const [er, ec] = p[p.length - 1];
  b[er][ec] = !isKing(piece) && er === kingRow(owner(piece)) ? piece.toUpperCase() : piece;
  const reset = captured || !isKing(piece);
  const s = { board: b, turn: other(state.turn), noProgress: reset ? 0 : state.noProgress + 1, seen: [] };
  s.seen = reset ? [key(s)] : [...state.seen, key(s)];
  return s;
}

export function applyMove(state, move) {
  const want = JSON.stringify(move?.path);
  if (!legalMoves(state).some((m) => JSON.stringify(m.path) === want)) throw new Error('illegal move');
  return play(state, move);
}

export function outcome(state) {
  if (!legalMoves(state).length) return { winner: other(state.turn), reason: 'no legal moves' };
  if (state.noProgress >= 40) return { winner: 'draw', reason: '40 plies without progress' };
  const k = key(state);
  if (state.seen.filter((x) => x === k).length >= 3) return { winner: 'draw', reason: 'threefold repetition' };
  return null;
}
