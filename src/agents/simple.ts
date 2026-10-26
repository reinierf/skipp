import { IS_GOAL, NONE, legalTurns, play, type GameState, type Turn } from '../engine';
import { pick } from '../util/rng';

/** Chooses a turn from the legal turns of `state` (non-empty). */
export type Agent = (state: GameState, turns: Turn[]) => Turn;

export function isWinningTurn(state: GameState, turn: Turn): boolean {
  return turn.top !== null && IS_GOAL[state.toMove]![turn.top.to] === 1;
}

export function randomAgent(rand: () => number): Agent {
  return (_state, turns) => pick(turns, rand);
}

/**
 * One-ply greedy: wins if it can, avoids turns that let the opponent win next turn,
 * prefers captures, otherwise plays randomly.
 */
export function greedyAgent(rand: () => number): Agent {
  return (state, turns) => {
    const wins = turns.filter((t) => isWinningTurn(state, t));
    if (wins.length > 0) return pick(wins, rand);
    const safe = turns.filter((t) => {
      const next = play(state, t);
      return !legalTurns(next).some((r) => isWinningTurn(next, r));
    });
    const pool = safe.length > 0 ? safe : turns;
    const captures = pool.filter((t) => t.top !== null && t.top.captured !== NONE);
    return pick(captures.length > 0 ? captures : pool, rand);
  };
}
