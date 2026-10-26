// Allocation-free move generation and in-place make/unmake for search.
// A turn is encoded in one integer (31 bits):
//   bits  0-5   base from      (NO_CELL if no base step)
//   bits  6-11  base to
//   bit   12    base step is a swap
//   bits 13-18  top from       (NO_CELL if no top step)
//   bits 19-24  top to
//   bits 25-30  captured cell  (NO_CELL for a sprint)
// legalTurns / play in rules.ts remain the reference implementation; tests check that both agree.

import { FORWARD, IS_GOAL, NUM_CELLS, RAYS_FLAT, RAY_STRIDE, opponent, type Player } from './board';
import type { BaseMove, TopMove, Turn } from './rules';
import { NONE, type GameState } from './state';

export const NO_CELL = 63;
const NO_TOP = (NO_CELL << 13) | (NO_CELL << 25);
export const PASS_CODE = NO_CELL | (NO_CELL << 6) | NO_TOP;

/** Upper bound on complete turns in any position: 14 base moves x 7 tops x 12 ray cells. */
export const MAX_TURNS = 1200;

export const baseFrom = (code: number) => code & 63;
export const baseTo = (code: number) => (code >> 6) & 63;
export const isSwap = (code: number) => ((code >> 12) & 1) === 1;
export const topFrom = (code: number) => (code >> 13) & 63;
export const topTo = (code: number) => (code >> 19) & 63;
export const captured = (code: number) => (code >> 25) & 63;

export function encodeTurn(t: Turn): number {
  const b = t.base ? t.base.from | (t.base.to << 6) | (t.base.swap ? 1 << 12 : 0) : NO_CELL | (NO_CELL << 6);
  const tp = t.top
    ? (t.top.from << 13) | (t.top.to << 19) | ((t.top.captured === NONE ? NO_CELL : t.top.captured) << 25)
    : NO_TOP;
  return b | tp;
}

export function decodeTurn(code: number): Turn {
  const base: BaseMove | null =
    baseFrom(code) === NO_CELL ? null : { from: baseFrom(code), to: baseTo(code), swap: isSwap(code) };
  const cap = captured(code);
  const top: TopMove | null =
    topFrom(code) === NO_CELL ? null : { from: topFrom(code), to: topTo(code), captured: cap === NO_CELL ? NONE : cap };
  return { base, top };
}

const topCells = new Int8Array(8);

/** Appends all top moves of player p's tops (listed in topCells[0..n)) combined with `baseCode`. */
function pushTopMoves(base: Int8Array, top: Int8Array, p: Player, n: number, baseCode: number, out: Int32Array, end: number): number {
  const rays = RAYS_FLAT[p]!;
  for (let i = 0; i < n; i++) {
    const from = topCells[i]!;
    const fromBits = baseCode | (from << 13);
    for (let start = from * 2 * RAY_STRIDE; start < (from * 2 + 2) * RAY_STRIDE; start += RAY_STRIDE) {
      const first = rays[start]!;
      if (first < 0 || base[first] === NONE) continue;
      const firstTop = top[first]!;
      if (firstTop === NONE) {
        for (let k = start; ; k++) {
          const to = rays[k]!;
          if (to < 0 || base[to] === NONE || top[to] !== NONE) break;
          out[end++] = fromBits | (to << 19) | (NO_CELL << 25);
        }
      } else if (firstTop !== p) {
        const to = rays[start + 1]!;
        if (to >= 0 && base[to] !== NONE && top[to] === NONE) out[end++] = fromBits | (to << 19) | (first << 25);
      }
    }
  }
  return end;
}

/**
 * Writes the legal turns of the side to move into out[start..) and returns the end index.
 * Same turns and order as legalTurns. Writes PASS_CODE if nothing can move; writes nothing
 * if the game is over. `out` must have room for MAX_TURNS entries from `start`.
 */
export function generateTurns(state: GameState, out: Int32Array, start: number): number {
  if (state.winner !== NONE) return start;
  const p = state.toMove;
  const base = state.base;
  const top = state.top;
  const fwd = FORWARD[p]!;
  let nTops = 0;
  for (let id = 0; id < NUM_CELLS; id++) if (top[id] === p) topCells[nTops++] = id;

  let end = start;
  let anyBase = false;
  for (let from = 0; from < NUM_CELLS; from++) {
    if (base[from] !== p || top[from] !== NONE) continue;
    const to = fwd[from]!;
    if (to < 0) continue;
    const there = base[to]!;
    let baseCode: number;
    if (there === NONE) baseCode = from | (to << 6);
    else if (there !== p && top[to] === NONE) baseCode = from | (to << 6) | (1 << 12);
    else continue;
    anyBase = true;
    // Apply the base step in place, generate top steps, then restore.
    base[from] = there;
    base[to] = p;
    const before = end;
    end = pushTopMoves(base, top, p, nTops, baseCode, out, end);
    if (end === before) out[end++] = baseCode | NO_TOP;
    base[from] = p;
    base[to] = there;
  }
  if (!anyBase) {
    end = pushTopMoves(base, top, p, nTops, NO_CELL | (NO_CELL << 6), out, end);
    if (end === start) out[end++] = PASS_CODE;
  }
  return end;
}

/** Applies `code` to `state` in place. */
export function makeTurn(state: GameState, code: number): void {
  const p = state.toMove;
  const bf = code & 63;
  if (bf !== NO_CELL) {
    const bt = (code >> 6) & 63;
    state.base[bf] = (code >> 12) & 1 ? state.base[bt]! : NONE;
    state.base[bt] = p;
  }
  const tf = (code >> 13) & 63;
  if (tf !== NO_CELL) {
    const tt = (code >> 19) & 63;
    const cap = (code >> 25) & 63;
    state.top[tf] = NONE;
    if (cap !== NO_CELL) state.top[cap] = NONE;
    state.top[tt] = p;
    if (IS_GOAL[p]![tt]) state.winner = p;
  }
  state.toMove = opponent(p);
  state.ply++;
}

/** Reverts `makeTurn(state, code)`. The position before the turn must not have been won. */
export function unmakeTurn(state: GameState, code: number): void {
  const p = opponent(state.toMove);
  const q = state.toMove;
  state.toMove = p;
  state.ply--;
  state.winner = NONE;
  const tf = (code >> 13) & 63;
  if (tf !== NO_CELL) {
    const tt = (code >> 19) & 63;
    const cap = (code >> 25) & 63;
    state.top[tt] = NONE;
    if (cap !== NO_CELL) state.top[cap] = q;
    state.top[tf] = p;
  }
  const bf = code & 63;
  if (bf !== NO_CELL) {
    const bt = (code >> 6) & 63;
    state.base[bf] = p;
    state.base[bt] = (code >> 12) & 1 ? q : NONE;
  }
}
