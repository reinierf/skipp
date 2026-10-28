import {
  IS_GOAL,
  MAX_TURNS,
  NONE,
  NO_CELL,
  NUM_CELLS,
  PASS,
  PASS_CODE,
  canMove,
  decodeTurn,
  encodeTurn,
  generateTurns,
  legalTurns,
  makeTurn,
  opponent,
  play,
  unmakeTurn,
  type GameState,
  type Player,
  type Turn,
} from '../engine';
import { DEFAULT_WEIGHTS, PROGRESS, evaluate, type Weights } from './evaluate';
import { EXACT, LOWER, TranspositionTable, UPPER, hashState, toggleSide, xorTouchedCells } from './tt';

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
  /**
   * Play a random turn among those scoring within `margin` of the best, favouring better
   * ones; a margin of 0 only breaks ties at random. Never trades away a forced win.
   * Off by default, which keeps the search deterministic.
   */
  random?: { margin: number; rng?: () => number };
  /** Only consider root turns for which this returns true. */
  rootFilter?: (turn: Turn) => boolean;
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
  /**
   * Expected line of play starting with `best`, read back from the transposition table and
   * at most `depth` turns long. Just [best] without a table.
   */
  pv: Turn[];
}

class Aborted extends Error {}

const MAX_PLY = 128;
/**
 * Width of the minimal PVS window. Must be smaller than the gap between distinct scores;
 * evaluation scores are multiples of 1/12 or coarser for the weights in use.
 */
const NULL_WINDOW = 1e-6;
const PART = NUM_CELLS * NUM_CELLS + 1;

// Per-ply turn and ordering-key buffers, shared by all searches (search is not re-entrant).
const TURNS = new Int32Array(MAX_PLY * MAX_TURNS);
const KEYS = new Float64Array(MAX_PLY * MAX_TURNS);

// Field accessors for encoded turns; see engine/fast.ts for the layout.
const BF = (c: number) => c & 63;
const BT = (c: number) => (c >> 6) & 63;
const TF = (c: number) => (c >> 13) & 63;
const TT = (c: number) => (c >> 19) & 63;
const CAP = (c: number) => (c >> 25) & 63;

/** Cheap move-ordering key: wins, then captures, then top advancement. */
function orderKey(code: number, p: Player): number {
  const tf = TF(code);
  if (tf === NO_CELL) return -100;
  const tt = TT(code);
  if (IS_GOAL[p]![tt]) return 10_000;
  const progress = PROGRESS[p]!;
  return (CAP(code) !== NO_CELL ? 1000 : 0) + progress[tt]! * 4 + progress[tt]! - progress[tf]!;
}

const basePart = (c: number) => (BF(c) === NO_CELL ? PART - 1 : BF(c) * NUM_CELLS + BT(c));
const topPart = (c: number) => (TF(c) === NO_CELL ? PART - 1 : TF(c) * NUM_CELLS + TT(c));
const isQuiet = (c: number) => TF(c) === NO_CELL || CAP(c) === NO_CELL;

/**
 * Returns the index in [start, end) of the highest key and marks it taken. Picking lazily is
 * cheaper than sorting because most nodes cut off after the first few turns. Ties go to the
 * lower index.
 */
function takeBest(start: number, end: number): number {
  let best = start;
  let bestKey = -Infinity;
  for (let i = start; i < end; i++) {
    if (KEYS[i]! > bestKey) {
      bestKey = KEYS[i]!;
      best = i;
    }
  }
  KEYS[best] = -Infinity;
  return best;
}

// Scores in the TT are stored relative to the node, so mate distances stay valid
// when the same position is reached at a different ply.
const toTT = (score: number, ply: number) =>
  score >= MATE_BOUND ? score + ply : score <= -MATE_BOUND ? score - ply : score;
const fromTT = (score: number, ply: number) =>
  score >= MATE_BOUND ? score - ply : score <= -MATE_BOUND ? score + ply : score;

interface RootResult {
  best: number;
  score: number;
  /** Turns within the margin of the best, including it; empty without a margin. */
  near: { code: number; score: number }[];
}

/**
 * Picks among turns within `margin` of the best, weighting each by how far inside the
 * margin it is, so the best is likeliest and the worst allowed rarely chosen.
 */
function pickNear(near: RootResult['near'], best: number, margin: number, rng: () => number): RootResult['near'][number] {
  const weight = (score: number) => margin - (best - score) + 1;
  let r = rng() * near.reduce((sum, t) => sum + weight(t.score), 0);
  for (const t of near) if ((r -= weight(t.score)) < 0) return t;
  return near[near.length - 1]!;
}

class Searcher {
  nodes = 0;
  private readonly deadline: number;
  private readonly killers = new Int32Array(MAX_PLY * 2).fill(-1);
  private readonly baseHistory = new Float64Array(PART);
  private readonly topHistory = new Float64Array(PART);
  /** Incrementally maintained [h1, h2] of `state`. */
  private readonly hash: Uint32Array;

  constructor(
    /** Private copy of the root position, changed in place by make/unmake. */
    private readonly state: GameState,
    private readonly weights: Weights,
    timeMs: number | undefined,
    private readonly tt: TranspositionTable | null,
    private readonly heuristics: boolean,
  ) {
    this.deadline = timeMs === undefined ? Infinity : performance.now() + timeMs;
    this.hash = Uint32Array.from(hashState(state));
  }

  private make(code: number): void {
    xorTouchedCells(this.state, code, this.hash);
    makeTurn(this.state, code);
    xorTouchedCells(this.state, code, this.hash);
    toggleSide(this.hash);
  }

  private unmake(code: number): void {
    xorTouchedCells(this.state, code, this.hash);
    unmakeTurn(this.state, code);
    xorTouchedCells(this.state, code, this.hash);
    toggleSide(this.hash);
  }

  /** Fills KEYS[start, end) with ordering keys (higher first); the turn `first` leads. */
  private orderKeys(start: number, end: number, p: Player, ply: number, first: number): void {
    const k0 = this.killers[ply * 2];
    const k1 = this.killers[ply * 2 + 1];
    for (let i = start; i < end; i++) {
      const c = TURNS[i]!;
      let k = orderKey(c, p);
      if (c === first) k = 1e12;
      else if (!isQuiet(c)) k += 1e10;
      else if (this.heuristics) {
        if (c === k0) k = 1e9;
        else if (c === k1) k = 1e9 - 1;
        else k += this.baseHistory[basePart(c)]! + this.topHistory[topPart(c)]!;
      }
      KEYS[i] = k;
    }
  }

  private recordCutoff(c: number, depth: number, ply: number): void {
    if (!this.heuristics || !isQuiet(c)) return;
    if (this.killers[ply * 2] !== c) {
      this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
      this.killers[ply * 2] = c;
    }
    this.baseHistory[basePart(c)]! += depth * depth;
    this.topHistory[topPart(c)]! += depth * depth;
  }

  /** Negamax with alpha-beta. Returns the score from the side to move's point of view. */
  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new Aborted();
    const state = this.state;
    // The previous mover won.
    if (state.winner !== NONE) return -(WIN - ply);
    if (depth === 0) return evaluate(state, this.weights);

    const alphaOrig = alpha;
    let ttMove = -1;
    const h1 = this.hash[0]!;
    const h2 = this.hash[1]!;
    if (this.tt) {
      const slot = this.tt.probe(h1, h2);
      if (slot >= 0) {
        ttMove = this.tt.moveAt(slot);
        if (this.tt.depthAt(slot) >= depth) {
          const score = fromTT(this.tt.scoreAt(slot), ply);
          const bound = this.tt.boundAt(slot);
          if (bound === EXACT) return score;
          if (bound === LOWER && score > alpha) alpha = score;
          else if (bound === UPPER && score < beta) beta = score;
          if (alpha >= beta) return score;
        }
      }
    }

    const p = state.toMove;
    const start = ply * MAX_TURNS;
    const end = generateTurns(state, TURNS, start);
    if (end - start === 1 && TURNS[start] === PASS_CODE && !canMove(state, opponent(p))) return 0;
    const goal = IS_GOAL[p]!;
    for (let i = start; i < end; i++) {
      const c = TURNS[i]!;
      if (TF(c) !== NO_CELL && goal[TT(c)]) return WIN - ply - 1;
    }

    this.orderKeys(start, end, p, ply, ttMove);
    let best = -Infinity;
    let bestCode = -1;
    for (let n = start; n < end; n++) {
      const c = TURNS[takeBest(start, end)]!;
      this.make(c);
      const score = n === start ? -this.negamax(depth - 1, -beta, -alpha, ply + 1) : this.pvs(depth - 1, alpha, beta, ply + 1);
      this.unmake(c);
      if (score > best) {
        best = score;
        bestCode = c;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        this.recordCutoff(c, depth, ply);
        break;
      }
    }
    if (this.tt) {
      const bound = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
      this.tt.set(h1, h2, depth, toTT(best, ply), bound, bestCode);
    }
    return best;
  }

  /**
   * Principal-variation search for a turn after the first: a minimal window around alpha
   * proves cheaply that it is no better; only if it is, re-search with the full window.
   * Called after make; returns the score from the parent's point of view.
   */
  private pvs(depth: number, alpha: number, beta: number, ply: number): number {
    const score = -this.negamax(depth, -alpha - NULL_WINDOW, -alpha, ply);
    return score > alpha && score < beta ? -this.negamax(depth, -beta, -alpha, ply) : score;
  }

  /**
   * Searches the root to `depth`; `first` is the encoded turn to try first (or -1).
   * With a `margin`, also returns every turn scoring within it of the best, with exact scores.
   */
  root(depth: number, first: number, margin?: number, allowed?: Set<number>): RootResult {
    this.nodes++;
    const end = generateTurns(this.state, TURNS, 0);
    this.orderKeys(0, end, this.state.toMove, 0, first);
    let alpha = -Infinity;
    let best = -1;
    const near: { code: number; score: number }[] = [];
    for (let i = 0, n = 0; i < end; i++) {
      const c = TURNS[takeBest(0, end)]!;
      if (allowed && !allowed.has(c)) continue;
      n++;
      this.make(c);
      // Lowering the window by the margin makes scores of turns within it exact, not bounds.
      const floor = margin === undefined ? alpha : alpha - margin - NULL_WINDOW;
      const score = n === 1 ? -this.negamax(depth - 1, -Infinity, Infinity, 1) : this.pvs(depth - 1, floor, Infinity, 1);
      this.unmake(c);
      if (margin !== undefined && score > floor) near.push({ code: c, score });
      if (score > alpha || best < 0) {
        alpha = score;
        best = c;
      }
    }
    return { best, score: alpha, near: near.filter((t) => t.score >= alpha - margin!) };
  }
}

/** Iterative-deepening alpha-beta over complete turns. Does not modify `state`. */
export function search(state: GameState, opts: SearchOptions): SearchResult {
  const start = performance.now();
  const result: SearchResult = { best: null, score: 0, depth: 0, nodes: 0, timeMs: 0, iterations: [], pv: [] };
  const legal = legalTurns(state);
  const filter = opts.rootFilter;
  const allowed = filter ? new Set(legal.filter(filter).map(encodeTurn)) : undefined;
  if (legal.length === 0 || allowed?.size === 0) return result;
  const tt = opts.tt === false ? null : (opts.tt ?? new TranspositionTable());
  const s = new Searcher(state.clone(), opts.weights ?? DEFAULT_WEIGHTS, opts.timeMs, tt, opts.heuristics ?? true);

  let bestCode = -1;
  let near: RootResult['near'] = [];
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const iterStart = performance.now();
    const nodesBefore = s.nodes;
    try {
      const root = s.root(depth, bestCode, opts.random?.margin, allowed);
      const { best, score } = root;
      bestCode = best;
      near = root.near;
      const turn = decodeTurn(best);
      Object.assign(result, { best: turn, score, depth });
      result.iterations.push({ depth, score, best: turn, nodes: s.nodes - nodesBefore, timeMs: performance.now() - iterStart });
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
      break;
    }
    if (Math.abs(result.score) >= MATE_BOUND) break;
  }
  if (opts.random && near.length > 1 && result.score < MATE_BOUND) {
    const t = pickNear(near, result.score, opts.random.margin, opts.random.rng ?? Math.random);
    Object.assign(result, { best: decodeTurn(t.code), score: t.score });
  }
  result.nodes = s.nodes;
  result.timeMs = performance.now() - start;
  if (result.best) result.pv = tt ? principalVariation(state, result.best, tt, result.depth) : [result.best];
  return result;
}

/**
 * Follows the best moves stored in the table from the position after `first`. A position the
 * search won outright has no stored move, so a turn reaching the goal ends the line instead.
 */
function principalVariation(state: GameState, first: Turn, tt: TranspositionTable, maxLen: number): Turn[] {
  const pv = [first];
  let s = play(state, first);
  while (pv.length < maxLen && s.winner === NONE) {
    const turns = legalTurns(s);
    if (turns.length === 1 && turns[0] === PASS && !canMove(s, opponent(s.toMove))) break;
    const code = tt.get(...hashState(s))?.move;
    const goal = IS_GOAL[s.toMove]!;
    const next = turns.find((t) => encodeTurn(t) === code) ?? turns.find((t) => t.top !== null && goal[t.top.to]);
    if (!next) break;
    pv.push(next);
    s = play(s, next);
  }
  return pv;
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
