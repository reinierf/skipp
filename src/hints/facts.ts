// Board facts the hint explanations are built from. These use the allocating reference move
// generator: a hint is computed once per request, so clarity matters more than speed.

import { IS_GOAL, NONE, RAYS, legalTurns, opponent, topCounts, type GameState, type Player, type TopMove, type Turn } from '../engine';

/** The turns p could play if it were p's move in `state`. */
export function turnsFor(state: GameState, p: Player): Turn[] {
  if (state.toMove === p) return legalTurns(state);
  const s = state.clone();
  s.toMove = p;
  return legalTurns(s);
}

const unique = (cells: number[]) => [...new Set(cells)].sort((a, b) => a - b);

/** Goal cells p could land on with its next turn, if it were p's move. */
export function goalThreats(state: GameState, p: Player): number[] {
  const goal = IS_GOAL[p]!;
  return unique(turnsFor(state, p).flatMap((t) => (t.top && goal[t.top.to] ? [t.top.to] : [])));
}

/** Cells of p's tops that the opponent could capture with its next turn, if it were its move. */
export function capturableTops(state: GameState, p: Player): number[] {
  return unique(turnsFor(state, opponent(p)).flatMap((t) => (t.top && t.top.captured !== NONE ? [t.top.captured] : [])));
}

/** p's tops minus the opponent's. */
export function topBalance(state: GameState, p: Player): number {
  const counts = topCounts(state);
  return counts[p] - counts[opponent(p)];
}

/** Cells a player-p top passes over and lands on, nearest first. */
export function topPath(top: TopMove, p: Player): number[] {
  for (const ray of RAYS[p]![top.from]!) {
    const i = ray.indexOf(top.to);
    if (i >= 0) return ray.slice(0, i + 1);
  }
  return [top.to];
}
