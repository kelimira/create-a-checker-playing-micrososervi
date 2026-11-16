import { initialState, applyMove, outcome } from './engine.js';
import { chooseMove } from './ai.js';

export const MIN_SPEED = 0.1, MAX_SPEED = 20;
export const validSpeed = (s) => typeof s === 'number' && Number.isFinite(s) && s >= MIN_SPEED && s <= MAX_SPEED;

// POST JSON with retry on network errors / 5xx (and 404 when retry404, for a peer that hasn't registered the game yet).
export async function postJson(url, body, { fetch = globalThis.fetch, retries = 3, backoffMs = 250, retry404 = false } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!(res.status >= 500 || (retry404 && res.status === 404)) || i >= retries) return { status: res.status, body: json };
    } catch (e) {
      if (i >= retries) throw e;
    }
    await new Promise((r) => setTimeout(r, backoffMs * 2 ** i));
  }
}

export class Game {
  constructor({ id, myColor, status = 'waiting', speed = 1, baseMs = 1000, depth = 4, peerUrl = null, token = null, timers = globalThis, net = {} }) {
    Object.assign(this, { id, myColor, status, speed, baseMs, depth, peerUrl, token, timers, net });
    this.st = initialState();
    this.history = [];
    this.winner = null;
    this.reason = null;
    this.paused = false;
    this.timer = null;
    this.subs = new Set();
  }

  snapshot() {
    return {
      id: this.id, status: this.status, myColor: this.myColor, board: this.st.board, turn: this.st.turn,
      ply: this.history.length, history: this.history, winner: this.winner, reason: this.reason,
      paused: this.paused, speed: this.speed, peerUrl: this.peerUrl, lastMove: this.history.at(-1) ?? null,
    };
  }

  emit() { const s = this.snapshot(); this.subs.forEach((f) => f(s)); }
  delayFor() { return this.baseMs / this.speed; }

  start() { this.status = 'active'; this.emit(); this.schedule(); }

  schedule() {
    if (this.timer !== null || this.status !== 'active' || this.paused || this.st.turn !== this.myColor) return;
    this.timer = this.timers.setTimeout(() => { this.timer = null; this.playOwn(); }, this.delayFor());
  }

  unschedule() {
    if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null; }
  }

  setSpeed(speed) { this.speed = speed; this.unschedule(); this.schedule(); this.emit(); }
  setPaused(p) { this.paused = p; this.unschedule(); this.schedule(); this.emit(); }

  abort(reason) {
    if (this.status === 'finished' || this.status === 'aborted') return;
    this.status = 'aborted'; this.reason = reason; this.unschedule(); this.emit();
  }

  commit(move) {
    this.st = applyMove(this.st, move);
    this.history.push({ path: move.path.map((p) => [...p]) });
    const o = outcome(this.st);
    if (o) { this.status = 'finished'; this.winner = o.winner; this.reason = o.reason; this.unschedule(); }
  }

  playOwn() {
    if (this.status !== 'active' || this.paused || this.st.turn !== this.myColor) return;
    const move = chooseMove(this.st, this.depth), ply = this.history.length;
    this.commit(move);
    this.emit();
    postJson(`${this.peerUrl}/peer/games/${encodeURIComponent(this.id)}/moves`, { token: this.token, ply, move }, { ...this.net, retry404: true })
      .then((r) => { if (r.status >= 300) this.abort(`peer rejected move (${r.status}): ${r.body?.error ?? ''}`); })
      .catch(() => this.abort('peer unreachable'));
  }

  // Apply a move received from the peer. Returns {status, error?} for the HTTP layer.
  receive(ply, move) {
    const dup = Number.isInteger(ply) && ply >= 0 && ply < this.history.length;
    if (dup) {
      return JSON.stringify(this.history[ply].path) === JSON.stringify(move?.path) ? { status: 200 } : { status: 409, error: 'ply mismatch' };
    }
    if (this.status !== 'active') return { status: 409, error: 'game not active' };
    if (ply !== this.history.length || this.st.turn === this.myColor) return { status: 409, error: 'wrong turn or ply' };
    try { this.commit(move); } catch { return { status: 422, error: 'illegal move' }; }
    this.emit();
    this.schedule();
    return { status: 202 };
  }
}
