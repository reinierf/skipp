import { BLUE, CELLS, MAX_Y, NUM_CELLS, ORANGE, countBaseMoves, countTopMoves, opponent, type GameState, type Player } from '../engine';

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

const topCounts = new Int32Array(2);

function side(state: GameState, p: Player, w: Weights): number {
  let score = 0;
  const progress = PROGRESS[p]!;
  for (let id = 0; id < NUM_CELLS; id++) {
    if (state.top[id] !== p) continue;
    const g = progress[id]!;
    score += w.top + (w.advance * g * g) / MAX_Y;
  }
  countTopMoves(state, p, topCounts);
  score += topCounts[1]! * (w.threat + (p === state.toMove ? w.threatToMove : 0));
  score += topCounts[0]! * w.topMobility + countBaseMoves(state, p) * w.baseMobility;
  return score;
}

/** Static evaluation from the point of view of the side to move. */
export function evaluate(state: GameState, w: Weights = DEFAULT_WEIGHTS): number {
  const me = state.toMove;
  return side(state, me, w) - side(state, opponent(me), w);
}
