import {
  IS_GOAL,
  NONE,
  NUM_CELLS,
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
import { EXACT, LOWER, TranspositionTable, UPPER, hashState } from './tt';

/** Score of a win at the root. A win found `n` plies deep scores `WIN - n`. */
export const WIN = 1_000_000;
const MATE_BOUND = WIN - 1000;

export interface SearchOptions {
  /** Maximum depth in plies (complete turns). */
  maxDepth: number;
  /** Stop starting or continuing iterations after this many milliseconds. */
  timeMs?: number;
  weights?: Weights;
  /**
   * Transposition table to use (and keep between searches), or false to disable.
   * Defaults to a fresh table per search.
   */
  tt?: TranspositionTable | false;
  /** Killer-move and history ordering. Default true. */
  heuristics?: boolean;
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

const MAX_PLY = 128;
const PART = NUM_CELLS * NUM_CELLS + 1;

/** Cheap move-ordering key: wins, then captures, then top advancement. */
function orderKey(turn: Turn, p: Player): number {
  const t = turn.top;
  if (!t) return -100;
  if (IS_GOAL[p]![t.to]) return 10_000;
  const gain = PROGRESS[p]![t.to]! - PROGRESS[p]![t.from]!;
  return (t.captured !== NONE ? 1000 : 0) + PROGRESS[p]![t.to]! * 4 + gain;
}

const basePart = (t: Turn) => (t.base ? t.base.from * NUM_CELLS + t.base.to : PART - 1);
const topPart = (t: Turn) => (t.top ? t.top.from * NUM_CELLS + t.top.to : PART - 1);
const turnCode = (t: Turn) => basePart(t) * PART + topPart(t);
const isQuiet = (t: Turn) => !t.top || t.top.captured === NONE;

/**
 * Returns the index of the highest key and marks it taken. Picking lazily is cheaper than
 * sorting because most nodes cut off after the first few turns. Ties go to the lower index.
 */
function takeBest(keys: Float64Array): number {
  let best = -1;
  let bestKey = -Infinity;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]! > bestKey) {
      bestKey = keys[i]!;
      best = i;
    }
  }
  keys[best] = -Infinity;
  return best;
}

// Scores in the TT are stored relative to the node, so mate distances stay valid
// when the same position is reached at a different ply.
const toTT = (score: number, ply: number) =>
  score >= MATE_BOUND ? score + ply : score <= -MATE_BOUND ? score - ply : score;
const fromTT = (score: number, ply: number) =>
  score >= MATE_BOUND ? score - ply : score <= -MATE_BOUND ? score + ply : score;

class Searcher {
  nodes = 0;
  private readonly deadline: number;
  private readonly killers = new Int32Array(MAX_PLY * 2).fill(-1);
  private readonly baseHistory = new Float64Array(PART);
  private readonly topHistory = new Float64Array(PART);

  constructor(
    private readonly weights: Weights,
    timeMs: number | undefined,
    private readonly tt: TranspositionTable | null,
    private readonly heuristics: boolean,
  ) {
    this.deadline = timeMs === undefined ? Infinity : performance.now() + timeMs;
  }

  /** Ordering keys for `turns` (higher is searched first); the index `first` (if >= 0) leads. */
  private orderKeys(turns: Turn[], p: Player, ply: number, first: number): Float64Array {
    const keys = new Float64Array(turns.length);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      let k = orderKey(t, p);
      if (i === first) k = 1e12;
      else if (!isQuiet(t)) k += 1e10;
      else if (this.heuristics) {
        const code = turnCode(t);
        if (code === this.killers[ply * 2]) k = 1e9;
        else if (code === this.killers[ply * 2 + 1]) k = 1e9 - 1;
        else k += this.baseHistory[basePart(t)]! + this.topHistory[topPart(t)]!;
      }
      keys[i] = k;
    }
    return keys;
  }

  private recordCutoff(t: Turn, depth: number, ply: number): void {
    if (!this.heuristics || !isQuiet(t)) return;
    const code = turnCode(t);
    if (this.killers[ply * 2] !== code) {
      this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
      this.killers[ply * 2] = code;
    }
    this.baseHistory[basePart(t)]! += depth * depth;
    this.topHistory[topPart(t)]! += depth * depth;
  }

  /** Negamax with alpha-beta. Returns the score from the side to move's point of view. */
  negamax(state: GameState, depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new Aborted();
    // The previous mover won.
    if (state.winner !== NONE) return -(WIN - ply);
    if (depth === 0) return evaluate(state, this.weights);

    const alphaOrig = alpha;
    let ttMove = -1;
    let h1 = 0;
    let h2 = 0;
    if (this.tt) {
      [h1, h2] = hashState(state);
      const e = this.tt.get(h1, h2);
      if (e) {
        ttMove = e.move;
        if (e.depth >= depth) {
          const score = fromTT(e.score, ply);
          if (e.bound === EXACT) return score;
          if (e.bound === LOWER && score > alpha) alpha = score;
          else if (e.bound === UPPER && score < beta) beta = score;
          if (alpha >= beta) return score;
        }
      }
    }

    const p = state.toMove;
    const turns = legalTurns(state);
    if (turns.length === 1 && turns[0] === PASS && !canMove(state, opponent(p))) return 0;
    for (const t of turns) if (t.top && IS_GOAL[p]![t.top.to]) return WIN - ply - 1;

    let best = -Infinity;
    let bestIndex = -1;
    const keys = this.orderKeys(turns, p, ply, ttMove < turns.length ? ttMove : -1);
    for (let n = 0; n < turns.length; n++) {
      const i = takeBest(keys);
      const t = turns[i]!;
      const score = -this.negamax(play(state, t), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) {
        best = score;
        bestIndex = i;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        this.recordCutoff(t, depth, ply);
        break;
      }
    }
    if (this.tt) {
      const bound = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
      this.tt.set(h1, h2, depth, toTT(best, ply), bound, bestIndex);
    }
    return best;
  }

  root(state: GameState, turns: Turn[], depth: number, first: number): { best: number; score: number } {
    this.nodes++;
    let alpha = -Infinity;
    let best = -1;
    const keys = this.orderKeys(turns, state.toMove, 0, first);
    for (let n = 0; n < turns.length; n++) {
      const i = takeBest(keys);
      const score = -this.negamax(play(state, turns[i]!), depth - 1, -Infinity, -alpha, 1);
      if (score > alpha || best < 0) {
        alpha = score;
        best = i;
      }
    }
    return { best, score: alpha };
  }
}

/** Iterative-deepening alpha-beta over complete turns. */
export function search(state: GameState, opts: SearchOptions): SearchResult {
  const start = performance.now();
  const tt = opts.tt === false ? null : (opts.tt ?? new TranspositionTable());
  const s = new Searcher(opts.weights ?? DEFAULT_WEIGHTS, opts.timeMs, tt, opts.heuristics ?? true);
  const result: SearchResult = { best: null, score: 0, depth: 0, nodes: 0, timeMs: 0, iterations: [] };
  const turns = legalTurns(state);
  if (turns.length === 0) return result;

  let bestIndex = -1;
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const iterStart = performance.now();
    const nodesBefore = s.nodes;
    try {
      const { best, score } = s.root(state, turns, depth, bestIndex);
      bestIndex = best;
      Object.assign(result, { best: turns[best]!, score, depth });
      result.iterations.push({
        depth,
        score,
        best: turns[best]!,
        nodes: s.nodes - nodesBefore,
        timeMs: performance.now() - iterStart,
      });
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
