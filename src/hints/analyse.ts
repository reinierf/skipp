// The searches behind a hint: the best turn, the best of the others, and one natural-looking
// alternative to compare the hint with.

import { NONE, legalTurns, play, type BaseMove, type GameState, type Turn } from '../engine';
import { isMateScore, search, type SearchResult } from '../search/alphabeta';
import type { TranspositionTable } from '../search/tt';
import { capturableTops } from './facts';

export interface Line {
  turn: Turn;
  /** From the point of view of the side to move at the root. */
  score: number;
  depth: number;
  /** The root score at each completed depth (index depth - 1), for comparing lines searched to different depths. */
  scores: number[];
  /** Expected play starting with `turn`. */
  pv: Turn[];
}

/**
 * Why an alternative was picked: it starts with the base step the player already chose, it is
 * the best capture (the hint captures nothing), or it is the best turn that leaves no top open
 * to capture (the hint does).
 */
export type AlternativeKind = 'chosen-base' | 'capture' | 'safe';

export interface Analysis {
  best: Line;
  /** The best turn other than `best`, or null if there is no other. */
  runnerUp: Line | null;
  alternative: (Line & { kind: AlternativeKind }) | null;
}

export interface AnalyseOptions {
  /** Total time for all searches; unlimited if omitted. */
  timeMs?: number;
  /** Depth limit of the main search. Default 64, so time is the limit. */
  maxDepth?: number;
  tt?: TranspositionTable;
  /** The base step the player has already selected, if any (null: no base step possible). */
  chosenBase?: BaseMove | null;
}

const sameBase = (a: BaseMove | null, b: BaseMove | null) =>
  a === null || b === null ? a === b : a.from === b.from && a.to === b.to;
const sameTurn = (a: Turn, b: Turn) =>
  sameBase(a.base, b.base) &&
  (a.top === null || b.top === null ? a.top === b.top : a.top.from === b.top.from && a.top.to === b.top.to);
const captures = (t: Turn) => t.top !== null && t.top.captured !== NONE;

const toLine = (r: SearchResult, turn: Turn): Line => ({
  turn,
  score: r.score,
  depth: r.depth,
  scores: r.iterations.map((i) => i.score),
  pv: r.pv,
});

/** Searches `state` for a hint. Returns null if the side to move has no turn to play. */
export function analyse(state: GameState, opts: AnalyseOptions): Analysis | null {
  const turns = legalTurns(state);
  if (turns.length === 0) return null;
  const me = state.toMove;
  const share = (f: number) => (opts.timeMs === undefined ? undefined : opts.timeMs * f);
  const main = search(state, { maxDepth: opts.maxDepth ?? 64, timeMs: share(0.6), tt: opts.tt });
  if (!main.best) return null;
  const best = toLine(main, main.best);
  if (turns.length === 1 || isMateScore(best.score)) return { best, runnerUp: null, alternative: null };

  const others = (filter: (t: Turn) => boolean, timeMs: number | undefined): Line | null => {
    const r = search(state, { maxDepth: best.depth, timeMs, tt: opts.tt, rootFilter: (t) => !sameTurn(t, best.turn) && filter(t) });
    return r.best ? toLine(r, r.best) : null;
  };

  let kind: AlternativeKind | null = null;
  let filter: (t: Turn) => boolean = () => true;
  const exposed = (t: Turn) => capturableTops(play(state, t), me).length > 0;
  if (opts.chosenBase !== undefined && !sameBase(opts.chosenBase, best.turn.base)) {
    kind = 'chosen-base';
    filter = (t) => sameBase(t.base, opts.chosenBase!);
  } else if (!captures(best.turn) && turns.some(captures)) {
    kind = 'capture';
    filter = captures;
  } else if (exposed(best.turn) && turns.some((t) => !exposed(t))) {
    kind = 'safe';
    filter = (t) => !exposed(t);
  }

  const runnerUp = others(() => true, share(kind ? 0.2 : 0.4));
  const alt = kind ? others(filter, share(0.2)) : null;
  return { best, runnerUp, alternative: alt && kind ? { ...alt, kind } : null };
}
