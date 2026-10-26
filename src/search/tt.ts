import { NUM_CELLS, ORANGE, type GameState } from '../engine';
import { mulberry32 } from '../util/rng';

// Zobrist hashing: one random key per (cell, base owner, top owner) combination and one for
// the side to move. Two independent 32-bit hashes: `h1` picks the table slot, `h2` verifies.

const CODES = 9; // (base + 1) * 3 + (top + 1), with owners in {-1, 0, 1}
const rand = mulberry32(0x5eed);
const randomU32 = () => Math.floor(rand() * 2 ** 32) >>> 0;
const Z1 = Uint32Array.from({ length: NUM_CELLS * CODES }, randomU32);
const Z2 = Uint32Array.from({ length: NUM_CELLS * CODES }, randomU32);
const SIDE1 = randomU32();
const SIDE2 = randomU32();

export function hashState(state: GameState): [number, number] {
  let h1 = 0;
  let h2 = 0;
  for (let id = 0; id < NUM_CELLS; id++) {
    const code = id * CODES + (state.base[id]! + 1) * 3 + (state.top[id]! + 1);
    h1 ^= Z1[code]!;
    h2 ^= Z2[code]!;
  }
  if (state.toMove !== ORANGE) {
    h1 ^= SIDE1;
    h2 ^= SIDE2;
  }
  return [h1 >>> 0, h2 >>> 0];
}

export const EXACT = 0;
export const LOWER = 1;
export const UPPER = 2;
export type Bound = typeof EXACT | typeof LOWER | typeof UPPER;

export interface TTEntry {
  depth: number;
  score: number;
  bound: Bound;
  /** Index of the best turn in `legalTurns` order, or -1. */
  move: number;
}

/** Fixed-size transposition table with depth-preferred replacement. */
export class TranspositionTable {
  private readonly mask: number;
  private readonly keys: Uint32Array;
  private readonly scores: Float64Array;
  private readonly depths: Int8Array;
  private readonly bounds: Uint8Array;
  private readonly moves: Int16Array;
  private readonly used: Uint8Array;

  constructor(log2Size = 20) {
    const size = 1 << log2Size;
    this.mask = size - 1;
    this.keys = new Uint32Array(size);
    this.scores = new Float64Array(size);
    this.depths = new Int8Array(size);
    this.bounds = new Uint8Array(size);
    this.moves = new Int16Array(size);
    this.used = new Uint8Array(size);
  }

  get(h1: number, h2: number): TTEntry | null {
    const i = h1 & this.mask;
    if (!this.used[i] || this.keys[i] !== h2) return null;
    return { depth: this.depths[i]!, score: this.scores[i]!, bound: this.bounds[i] as Bound, move: this.moves[i]! };
  }

  set(h1: number, h2: number, depth: number, score: number, bound: Bound, move: number): void {
    const i = h1 & this.mask;
    if (this.used[i] && this.keys[i] !== h2 && this.depths[i]! > depth) return;
    this.used[i] = 1;
    this.keys[i] = h2;
    this.depths[i] = depth;
    this.scores[i] = score;
    this.bounds[i] = bound;
    this.moves[i] = move;
  }

  clear(): void {
    this.used.fill(0);
  }
}
