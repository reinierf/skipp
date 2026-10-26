import { NUM_CELLS, ORANGE, type GameState } from '../engine';
import { mulberry32 } from '../util/rng';

// Zobrist hashing: one random key per (cell, base owner, top owner) combination and one for
// the side to move. Two independent 32-bit hashes: `h1` picks the table slot, `h2` verifies.

export const CODES = 9; // (base + 1) * 3 + (top + 1), with owners in {-1, 0, 1}
const rand = mulberry32(0x5eed);
const randomU32 = () => Math.floor(rand() * 2 ** 32) >>> 0;
export const Z1 = Uint32Array.from({ length: NUM_CELLS * CODES }, randomU32);
export const Z2 = Uint32Array.from({ length: NUM_CELLS * CODES }, randomU32);
export const SIDE1 = randomU32();
export const SIDE2 = randomU32();

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

/**
 * Incremental hashing for make/unmake. `h` holds [h1, h2]; a Uint32Array keeps them unsigned
 * (plain XOR yields signed values, which would never match the table's Uint32 keys).
 * Usage: xorTouchedCells before and after makeTurn/unmakeTurn, then toggleSide.
 */
export function xorTouchedCells(state: GameState, code: number, h: Uint32Array): void {
  const bf = code & 63;
  const bt = (code >> 6) & 63;
  if (bf !== 63) {
    xorCell(state, bf, h);
    xorCell(state, bt, h);
  }
  const tf = (code >> 13) & 63;
  if (tf !== 63) {
    xorCell(state, tf, h);
    // Only the top's landing cell can coincide with a base-step cell.
    const tt = (code >> 19) & 63;
    if (tt !== bf && tt !== bt) xorCell(state, tt, h);
    const cap = (code >> 25) & 63;
    if (cap !== 63) xorCell(state, cap, h);
  }
}

function xorCell(state: GameState, id: number, h: Uint32Array): void {
  const k = id * CODES + (state.base[id]! + 1) * 3 + (state.top[id]! + 1);
  h[0]! ^= Z1[k]!;
  h[1]! ^= Z2[k]!;
}

export function toggleSide(h: Uint32Array): void {
  h[0]! ^= SIDE1;
  h[1]! ^= SIDE2;
}

export const EXACT = 0;
export const LOWER = 1;
export const UPPER = 2;
export type Bound = typeof EXACT | typeof LOWER | typeof UPPER;

export interface TTEntry {
  depth: number;
  score: number;
  bound: Bound;
  /** Best turn as an encoded turn (see engine/fast.ts), or -1. */
  move: number;
}

/** Fixed-size transposition table with depth-preferred replacement. */
export class TranspositionTable {
  private readonly mask: number;
  private readonly keys: Uint32Array;
  private readonly scores: Float64Array;
  private readonly depths: Int8Array;
  private readonly bounds: Uint8Array;
  private readonly moves: Int32Array;
  private readonly used: Uint8Array;

  constructor(log2Size = 20) {
    const size = 1 << log2Size;
    this.mask = size - 1;
    this.keys = new Uint32Array(size);
    this.scores = new Float64Array(size);
    this.depths = new Int8Array(size);
    this.bounds = new Uint8Array(size);
    this.moves = new Int32Array(size);
    this.used = new Uint8Array(size);
  }

  get(h1: number, h2: number): TTEntry | null {
    const i = this.probe(h1, h2);
    return i < 0 ? null : { depth: this.depthAt(i), score: this.scoreAt(i), bound: this.boundAt(i), move: this.moveAt(i) };
  }

  /** Slot index holding this position, or -1. Read it with the *At accessors (no allocation). */
  probe(h1: number, h2: number): number {
    const i = h1 & this.mask;
    return this.used[i] && this.keys[i] === h2 ? i : -1;
  }

  depthAt(i: number): number {
    return this.depths[i]!;
  }

  scoreAt(i: number): number {
    return this.scores[i]!;
  }

  boundAt(i: number): Bound {
    return this.bounds[i] as Bound;
  }

  moveAt(i: number): number {
    return this.moves[i]!;
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
