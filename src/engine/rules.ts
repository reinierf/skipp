import { FORWARD, IS_GOAL, RAYS, cellName, opponent, type Player } from './board';
import { GameState, NONE } from './state';

export interface BaseMove {
  readonly from: number;
  readonly to: number;
  /** True if this base swapped places with an empty opponent base. */
  readonly swap: boolean;
}

export interface TopMove {
  readonly from: number;
  readonly to: number;
  /** Cell of the captured top, or NONE for a sprint. */
  readonly captured: number;
}

/** A complete turn. Either step may be null when it was not possible; both null is a pass. */
export interface Turn {
  readonly base: BaseMove | null;
  readonly top: TopMove | null;
}

export const PASS: Turn = { base: null, top: null };

export function baseMoves(state: GameState, p: Player = state.toMove): BaseMove[] {
  const moves: BaseMove[] = [];
  const fwd = FORWARD[p]!;
  for (let from = 0; from < state.base.length; from++) {
    if (state.base[from] !== p || state.top[from] !== NONE) continue;
    const to = fwd[from]!;
    if (to < 0) continue;
    const there = state.base[to]!;
    if (there === NONE) moves.push({ from, to, swap: false });
    else if (there !== p && state.top[to] === NONE) moves.push({ from, to, swap: true });
  }
  return moves;
}

export function topMoves(state: GameState, p: Player = state.toMove): TopMove[] {
  const moves: TopMove[] = [];
  const rays = RAYS[p]!;
  for (let from = 0; from < state.top.length; from++) {
    if (state.top[from] !== p) continue;
    for (const ray of rays[from]!) {
      const first = ray[0]!;
      if (state.base[first] === NONE) continue;
      const firstTop = state.top[first]!;
      if (firstTop === NONE) {
        // Sprint over a contiguous run of empty bases; any of them is a landing cell.
        for (const to of ray) {
          if (!state.isEmptyBase(to)) break;
          moves.push({ from, to, captured: NONE });
        }
      } else if (firstTop !== p) {
        const to = ray[1];
        if (to !== undefined && state.isEmptyBase(to)) moves.push({ from, to, captured: first });
      }
    }
  }
  return moves;
}

function applyBase(state: GameState, m: BaseMove): void {
  const mover = state.base[m.from]!;
  state.base[m.from] = m.swap ? state.base[m.to]! : NONE;
  state.base[m.to] = mover;
}

function applyTop(state: GameState, m: TopMove): void {
  const mover = state.top[m.from]! as Player;
  state.top[m.from] = NONE;
  if (m.captured !== NONE) state.top[m.captured] = NONE;
  state.top[m.to] = mover;
  if (IS_GOAL[mover]![m.to]) state.winner = mover;
}

/**
 * All legal complete turns for the side to move. A base step is mandatory when any base can
 * move; the top step is then mandatory if any top can move after that base step. A turn
 * with only a top step occurs only when no base can move. Returns [PASS] if nothing can move,
 * and [] if the game is already over.
 */
export function legalTurns(state: GameState): Turn[] {
  if (state.winner !== NONE) return [];
  const bases = baseMoves(state);
  if (bases.length === 0) {
    const tops = topMoves(state);
    return tops.length === 0 ? [PASS] : tops.map((top) => ({ base: null, top }));
  }
  const turns: Turn[] = [];
  const scratch = state.clone();
  for (const base of bases) {
    scratch.base.set(state.base);
    applyBase(scratch, base);
    const tops = topMoves(scratch, state.toMove);
    if (tops.length === 0) turns.push({ base, top: null });
    else for (const top of tops) turns.push({ base, top });
  }
  return turns;
}

/** Returns the state after `turn`. Does not check legality. */
export function play(state: GameState, turn: Turn): GameState {
  const next = state.clone();
  if (turn.base) applyBase(next, turn.base);
  if (turn.top) applyTop(next, turn.top);
  next.toMove = opponent(state.toMove);
  next.ply++;
  return next;
}

export function canMove(state: GameState, p: Player): boolean {
  return baseMoves(state, p).length > 0 || topMoves(state, p).length > 0;
}

export type Result = 'ongoing' | 'orange' | 'blue' | 'draw';

export function result(state: GameState): Result {
  if (state.winner !== NONE) return state.winner === 0 ? 'orange' : 'blue';
  if (!canMove(state, state.toMove) && !canMove(state, opponent(state.toMove))) return 'draw';
  return 'ongoing';
}

// Notation: base step `a3-a4` (advance) or `a3~a4` (swap); top step `b1-c2` (sprint) or
// `b1xd3` (capture); a missing step is `--`; a pass is `pass`. Example: `a3-a4 b1xd3`.

export function turnToString(turn: Turn): string {
  if (!turn.base && !turn.top) return 'pass';
  const b = turn.base ? `${cellName(turn.base.from)}${turn.base.swap ? '~' : '-'}${cellName(turn.base.to)}` : '--';
  const t = turn.top
    ? `${cellName(turn.top.from)}${turn.top.captured !== NONE ? 'x' : '-'}${cellName(turn.top.to)}`
    : '--';
  return `${b} ${t}`;
}

/** Finds the legal turn matching `text`, or throws. */
export function parseTurn(state: GameState, text: string): Turn {
  const want = text.trim().replace(/\s+/g, ' ');
  const found = legalTurns(state).find((t) => turnToString(t) === want);
  if (!found) throw new Error(`Illegal or malformed turn: ${text}`);
  return found;
}
