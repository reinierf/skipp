import {
  IS_GOAL,
  NONE,
  PASS,
  canMove,
  legalTurns,
  opponent,
  play,
  type GameState,
  type Player,
  type Turn,
} from '../engine';
import { DEFAULT_WEIGHTS, PROGRESS, evaluate, type Weights } from './evaluate';

/** Score of a win at the root. A win found `n` plies deep scores `WIN - n`. */
export const WIN = 1_000_000;
const MATE_BOUND = WIN - 1000;

export interface SearchOptions {
  /** Maximum depth in plies (complete turns). */
  maxDepth: number;
  /** Stop starting or continuing iterations after this many milliseconds. */
  timeMs?: number;
  weights?: Weights;
}

export interface DepthReport {
  depth: number;
  score: number;
  best: Turn;
  /** Nodes searched in this iteration alone. */
  nodes: number;
  /** Milliseconds spent in this iteration alone. */
  timeMs: number;
}

export interface SearchResult {
  best: Turn | null;
  score: number;
  /** Deepest fully completed iteration. */
  depth: number;
  nodes: number;
  timeMs: number;
  iterations: DepthReport[];
}

class Aborted extends Error {}

/** Cheap move-ordering key: wins, then captures, then top advancement. */
function orderKey(turn: Turn, p: Player): number {
  const t = turn.top;
  if (!t) return -100;
  if (IS_GOAL[p]![t.to]) return 10_000;
  const gain = PROGRESS[p]![t.to]! - PROGRESS[p]![t.from]!;
  return (t.captured !== NONE ? 1000 : 0) + PROGRESS[p]![t.to]! * 4 + gain;
}

function ordered(turns: Turn[], p: Player, first?: Turn): Turn[] {
  const keyed = turns.map((t) => ({ t, k: t === first ? Infinity : orderKey(t, p) }));
  keyed.sort((a, b) => b.k - a.k);
  return keyed.map((x) => x.t);
}

class Searcher {
  nodes = 0;
  private readonly deadline: number;

  constructor(
    private readonly weights: Weights,
    timeMs: number | undefined,
  ) {
    this.deadline = timeMs === undefined ? Infinity : performance.now() + timeMs;
  }

  /** Negamax with alpha-beta. Returns the score from the side to move's point of view. */
  negamax(state: GameState, depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new Aborted();
    // The previous mover won.
    if (state.winner !== NONE) return -(WIN - ply);
    if (depth === 0) return evaluate(state, this.weights);

    const p = state.toMove;
    const turns = legalTurns(state);
    if (turns.length === 1 && turns[0] === PASS && !canMove(state, opponent(p))) return 0;
    for (const t of turns) if (t.top && IS_GOAL[p]![t.top.to]) return WIN - ply - 1;

    let best = -Infinity;
    for (const t of ordered(turns, p)) {
      const score = -this.negamax(play(state, t), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  root(state: GameState, depth: number, first?: Turn): { best: Turn; score: number } {
    this.nodes++;
    const p = state.toMove;
    const turns = ordered(legalTurns(state), p, first);
    let alpha = -Infinity;
    let best = turns[0]!;
    for (const t of turns) {
      const score = -this.negamax(play(state, t), depth - 1, -Infinity, -alpha, 1);
      if (score > alpha) {
        alpha = score;
        best = t;
      }
    }
    return { best, score: alpha };
  }
}

/** Iterative-deepening alpha-beta over complete turns. */
export function search(state: GameState, opts: SearchOptions): SearchResult {
  const start = performance.now();
  const s = new Searcher(opts.weights ?? DEFAULT_WEIGHTS, opts.timeMs);
  const result: SearchResult = { best: null, score: 0, depth: 0, nodes: 0, timeMs: 0, iterations: [] };
  if (state.winner !== NONE || legalTurns(state).length === 0) return result;

  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const iterStart = performance.now();
    const nodesBefore = s.nodes;
    try {
      const { best, score } = s.root(state, depth, result.best ?? undefined);
      Object.assign(result, { best, score, depth });
      result.iterations.push({ depth, score, best, nodes: s.nodes - nodesBefore, timeMs: performance.now() - iterStart });
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
      break;
    }
    if (Math.abs(result.score) >= MATE_BOUND) break;
  }
  result.nodes = s.nodes;
  result.timeMs = performance.now() - start;
  return result;
}

/** Plain negamax without pruning or win shortcuts. Reference for tests and benchmarks. */
export function minimax(state: GameState, depth: number, weights: Weights = DEFAULT_WEIGHTS, ply = 0): number {
  if (state.winner !== NONE) return -(WIN - ply);
  if (depth === 0) return evaluate(state, weights);
  const turns = legalTurns(state);
  if (turns.length === 1 && turns[0] === PASS && !canMove(state, opponent(state.toMove))) return 0;
  let best = -Infinity;
  for (const t of turns) best = Math.max(best, -minimax(play(state, t), depth - 1, weights, ply + 1));
  return best;
}

/** Number of leaf positions at `depth` (perft), counting terminal positions as leaves. */
export function perft(state: GameState, depth: number): number {
  if (depth === 0 || state.winner !== NONE) return 1;
  const turns = legalTurns(state);
  if (turns.length === 1 && turns[0] === PASS && !canMove(state, opponent(state.toMove))) return 1;
  let n = 0;
  for (const t of turns) n += perft(play(state, t), depth - 1);
  return n;
}

/** True for scores that represent a forced win or loss. */
export function isMateScore(score: number): boolean {
  return Math.abs(score) >= MATE_BOUND;
}
