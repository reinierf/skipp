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
  // Strategy terms, off unless set. They test strategy principles in tournaments
  // (data/tournament-strategy*.md) and are not part of `evaluateTerms`.
  /** Per top, times its column's closeness to the centre (0 on the edge, 3 in column d). */
  centre?: number;
  /** Per top still on its own back row, guarding a goal cell of the opponent. */
  defender?: number;
  /** Subtracted per cell of a player's own back row holding an empty base: a landing spot for the opponent. */
  exposedGoal?: number;
  /** Per top with no enemy top further back, so no enemy top can ever capture it. */
  passed?: number;
  /** Once, when a player has two or more top moves landing on a goal cell (a double threat). */
  fork?: number;
}

/** True if `w` sets any strategy term. */
export function hasStrategyTerms(w: Weights): boolean {
  return !!(w.centre || w.defender || w.exposedGoal || w.passed || w.fork);
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
  const score = toMoveIsOrange ? orange - blue : blue - orange;
  return w === DEFAULT_WEIGHTS || !hasStrategyTerms(w) ? score : score + strategyScore(state, w);
}

/** CENTRALITY[cell]: 3 minus the distance of the cell's column from the centre column. */
const CENTRALITY = Int8Array.from(CELLS, (c) => 3 - Math.abs(c.col - 3));
/** OWN_BACK_ROW[p][cell]: the cell is on player p's back row (the opponent's goal row). */
const OWN_BACK_ROW = [IS_GOAL[BLUE]!, IS_GOAL[ORANGE]!];

/** The strategy terms of `w`, from the point of view of the side to move. A separate pass, so they cost nothing when off. */
function strategyScore(state: GameState, w: Weights): number {
  const base = state.base;
  const top = state.top;
  const s = [0, 0];
  const goalMoves = [0, 0];
  // Furthest-back top of each player, as progress from its own back row (13 = none).
  const rearmost = [MAX_Y + 1, MAX_Y + 1];
  for (let id = 0; id < NUM_CELLS; id++) {
    const t = top[id]!;
    if (t !== NONE) {
      const p = t as Player;
      s[p]! += (w.centre ?? 0) * CENTRALITY[id]! + (OWN_BACK_ROW[p]![id] ? (w.defender ?? 0) : 0);
      if (w.fork) goalMoves[p]! += topMovesFrom(base, top, p, id) >> 8;
      if (PROGRESS[p]![id]! < rearmost[p]!) rearmost[p] = PROGRESS[p]![id]!;
    } else if (base[id] !== NONE && w.exposedGoal) {
      if (OWN_BACK_ROW[ORANGE]![id]) s[ORANGE]! -= w.exposedGoal;
      else if (OWN_BACK_ROW[BLUE]![id]) s[BLUE]! -= w.exposedGoal;
    }
  }
  if (w.passed) {
    // An enemy top can only capture a top it is still moving toward: one ahead of it in its own
    // direction of travel. Progress runs in opposite directions, so a player-p top with progress g
    // is passed when every enemy top has progress of at least MAX_Y - g (level with it or beyond).
    for (let id = 0; id < NUM_CELLS; id++) {
      const t = top[id]!;
      if (t === NONE) continue;
      if (rearmost[1 - t]! >= MAX_Y - PROGRESS[t]![id]!) s[t]! += w.passed;
    }
  }
  if (w.fork) {
    if (goalMoves[ORANGE]! >= 2) s[ORANGE]! += w.fork;
    if (goalMoves[BLUE]! >= 2) s[BLUE]! += w.fork;
  }
  return s[state.toMove]! - s[1 - state.toMove]!;
}

/** The raw quantities `evaluate` weighs, for one player. */
export interface Features {
  tops: number;
  /** Sum over tops of squared progress. */
  progress: number;
  topMoves: number;
  /** Top moves landing on a goal cell. */
  goalMoves: number;
  baseMoves: number;
}

/** Features of Orange and Blue, in that order. Slower than `evaluate`; not for the search. */
export function features(state: GameState): [Features, Features] {
  const out: [Features, Features] = [
    { tops: 0, progress: 0, topMoves: 0, goalMoves: 0, baseMoves: 0 },
    { tops: 0, progress: 0, topMoves: 0, goalMoves: 0, baseMoves: 0 },
  ];
  for (let id = 0; id < NUM_CELLS; id++) {
    const t = state.top[id]!;
    if (t !== NONE) {
      const f = out[t]!;
      const g = PROGRESS[t]![id]!;
      const moves = topMovesFrom(state.base, state.top, t as Player, id);
      f.tops++;
      f.progress += g * g;
      f.topMoves += moves & 0xff;
      f.goalMoves += moves >> 8;
      continue;
    }
    const b = state.base[id]!;
    if (b === NONE) continue;
    const to = FORWARD[b]![id]!;
    if (to < 0) continue;
    const there = state.base[to]!;
    if (there === NONE || (there !== b && state.top[to] === NONE)) out[b]!.baseMoves++;
  }
  return out;
}

/** The weighted terms of `evaluate`, side to move minus opponent. They sum to `evaluate`. */
export interface Terms {
  material: number;
  advance: number;
  threats: number;
  topMobility: number;
  baseMobility: number;
}

export function evaluateTerms(state: GameState, w: Weights = DEFAULT_WEIGHTS): Terms {
  const fs = features(state);
  const me = fs[state.toMove]!;
  const them = fs[1 - state.toMove]!;
  return {
    material: (me.tops - them.tops) * w.top,
    advance: (w.advance * (me.progress - them.progress)) / MAX_Y,
    threats: me.goalMoves * (w.threat + w.threatToMove) - them.goalMoves * w.threat,
    topMobility: (me.topMoves - them.topMoves) * w.topMobility,
    baseMobility: (me.baseMoves - them.baseMoves) * w.baseMobility,
  };
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
