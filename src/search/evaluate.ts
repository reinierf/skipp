import {
  BLUE,
  CELLS,
  FORWARD,
  IS_GOAL,
  MAX_Y,
  NONE,
  NUM_CELLS,
  ORANGE,
  RAYS_FLAT,
  RAY_STRIDE,
  type GameState,
  type Player,
} from '../engine';

export interface Weights {
  /** Per top on the board. */
  top: number;
  /** Per squared half-row of progress of a top toward its goal, divided by MAX_Y. */
  advance: number;
  /** Per top move that would land on a goal cell (an immediate winning threat). */
  threat: number;
  /** Extra weight for threats belonging to the side to move. */
  threatToMove: number;
  /** Per legal top move (before the base step). */
  topMobility: number;
  /** Per legal base move. */
  baseMobility: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  top: 100,
  advance: 3,
  threat: 60,
  threatToMove: 200,
  topMobility: 4,
  // Raised from 2 (v1): +95 Elo at depth 4, +154 at depth 6 (data/tournament-basemob*.md).
  baseMobility: 12,
};

/** PROGRESS[p][cell]: half-rows a player-p top on this cell has advanced from p's back row. */
export const PROGRESS: readonly Int8Array[] = [ORANGE, BLUE].map((p) => {
  const arr = new Int8Array(NUM_CELLS);
  for (const c of CELLS) arr[c.id] = p === ORANGE ? c.y : MAX_Y - c.y;
  return arr;
});

/**
 * Static evaluation from the point of view of the side to move. One pass over the board
 * collects, per player: tops with their squared advancement, top moves and goal threats
 * (moves landing on a goal cell), and base moves.
 */
export function evaluate(state: GameState, w: Weights = DEFAULT_WEIGHTS): number {
  const base = state.base;
  const top = state.top;
  // Per player (0 = Orange, 1 = Blue): tops, sum of squared progress, top moves, goal
  // threats, base moves. Weights are applied once at the end.
  let n0 = 0;
  let n1 = 0;
  let g0 = 0;
  let g1 = 0;
  let moves0 = 0;
  let moves1 = 0;
  let bases0 = 0;
  let bases1 = 0;
  for (let id = 0; id < NUM_CELLS; id++) {
    const t = top[id]!;
    if (t === ORANGE) {
      const g = PROGRESS0[id]!;
      n0++;
      g0 += g * g;
      moves0 += topMovesFrom(base, top, ORANGE, id);
    } else if (t === BLUE) {
      const g = PROGRESS1[id]!;
      n1++;
      g1 += g * g;
      moves1 += topMovesFrom(base, top, BLUE, id);
    } else {
      const b = base[id]!;
      if (b === NONE) continue;
      const to = FORWARD[b]![id]!;
      if (to < 0) continue;
      const there = base[to]!;
      if (there === NONE || (there !== b && top[to] === NONE)) {
        if (b === ORANGE) bases0++;
        else bases1++;
      }
    }
  }
  const toMoveIsOrange = state.toMove === ORANGE;
  const orange =
    n0 * w.top +
    (w.advance * g0) / MAX_Y +
    (moves0 >> 8) * (w.threat + (toMoveIsOrange ? w.threatToMove : 0)) +
    (moves0 & 0xff) * w.topMobility +
    bases0 * w.baseMobility;
  const blue =
    n1 * w.top +
    (w.advance * g1) / MAX_Y +
    (moves1 >> 8) * (w.threat + (toMoveIsOrange ? 0 : w.threatToMove)) +
    (moves1 & 0xff) * w.topMobility +
    bases1 * w.baseMobility;
  return toMoveIsOrange ? orange - blue : blue - orange;
}

const PROGRESS0 = PROGRESS[ORANGE]!;
const PROGRESS1 = PROGRESS[BLUE]!;

/**
 * Top moves of the player-p top on `from`, packed as count | (goal landings << 8). Packed
 * values can be summed: a player has at most 84 top moves, so counts never reach bit 8.
 */
function topMovesFrom(base: Int8Array, top: Int8Array, p: Player, from: number): number {
  const rays = RAYS_FLAT[p]!;
  const goal = IS_GOAL[p]!;
  let n = 0;
  let goals = 0;
  for (let start = from * 2 * RAY_STRIDE; start < (from * 2 + 2) * RAY_STRIDE; start += RAY_STRIDE) {
    const first = rays[start]!;
    if (first < 0 || base[first] === NONE) continue;
    const firstTop = top[first]!;
    if (firstTop === NONE) {
      for (let k = start; ; k++) {
        const to = rays[k]!;
        if (to < 0 || base[to] === NONE || top[to] !== NONE) break;
        n++;
        goals += goal[to]!;
      }
    } else if (firstTop !== p) {
      const to = rays[start + 1]!;
      if (to >= 0 && base[to] !== NONE && top[to] === NONE) {
        n++;
        goals += goal[to]!;
      }
    }
  }
  return n | (goals << 8);
}
