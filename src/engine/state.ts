import { BLUE, CELLS, COLUMN_LETTERS, MAX_Y, NUM_CELLS, ORANGE, cellAt, cellByName, type Player } from './board';

export const NONE = -1;

/**
 * A position. `base[cell]` and `top[cell]` hold the owning player or NONE.
 * A top is only ever on a cell that also has a base.
 */
export class GameState {
  constructor(
    readonly base: Int8Array,
    readonly top: Int8Array,
    public toMove: Player,
    /** The player who has won, or NONE. Set when a top lands on a goal cell. */
    public winner: Player | typeof NONE = NONE,
    /** Number of turns played since the start position. */
    public ply = 0,
  ) {}

  clone(): GameState {
    return new GameState(this.base.slice(), this.top.slice(), this.toMove, this.winner, this.ply);
  }

  /** Returns true if `cell` holds a base without a top. */
  isEmptyBase(cell: number): boolean {
    return this.base[cell] !== NONE && this.top[cell] === NONE;
  }
}

export const START_DIAGRAM = `
 y    a    b    c    d    e    f    g
12         B         B         B
11    B         B         B         B
10         b         b         b
 9    b         b         b         b
 8         .         .         .
 7    .         .         .         .
 6         .         .         .
 5    .         .         .         .
 4         .         .         .
 3    o         o         o         o
 2         o         o         o
 1    O         O         O         O
 0         O         O         O
`;

/**
 * Cell tokens: `.` no base; `o` / `b` empty orange / blue base; `O` / `B` a top on a base of
 * its own colour; two-letter `oB` / `bO` a top on a base of the other colour (base first).
 */
const TOKENS: Record<string, [number, number]> = {
  '.': [NONE, NONE],
  o: [ORANGE, NONE],
  b: [BLUE, NONE],
  O: [ORANGE, ORANGE],
  B: [BLUE, BLUE],
  oO: [ORANGE, ORANGE],
  bB: [BLUE, BLUE],
  oB: [ORANGE, BLUE],
  bO: [BLUE, ORANGE],
};

/**
 * Parses a diagram in the RULES.md format: one line per y (top to bottom or any order),
 * first token the y value, then one token per column with matching parity, left to right.
 * Lines not starting with a number are ignored. Every cell must be listed.
 */
export function parseDiagram(text: string, toMove: Player = ORANGE): GameState {
  const base = new Int8Array(NUM_CELLS).fill(NONE);
  const top = new Int8Array(NUM_CELLS).fill(NONE);
  const seen = new Set<number>();
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (!/^\d+$/.test(tokens[0] ?? '')) continue;
    const y = Number(tokens[0]);
    const cols = [0, 1, 2, 3, 4, 5, 6].filter((c) => cellAt(c, y) >= 0);
    const cells = tokens.slice(1);
    if (cells.length !== cols.length) {
      throw new Error(`Row y=${y}: expected ${cols.length} cells, got ${cells.length}`);
    }
    cells.forEach((tok, i) => {
      const entry = TOKENS[tok];
      if (!entry) throw new Error(`Row y=${y}: unknown token "${tok}"`);
      const id = cellAt(cols[i]!, y);
      [base[id], top[id]] = entry;
      seen.add(id);
    });
  }
  if (seen.size !== NUM_CELLS) throw new Error(`Diagram lists ${seen.size} of ${NUM_CELLS} cells`);
  return new GameState(base, top, toMove);
}

/** Builds a position from named cells, e.g. `{ c2: 'O', d3: 'B', e3: 'o' }`. Unlisted cells are empty. */
export function stateFromCells(cells: Record<string, string>, toMove: Player = ORANGE): GameState {
  const base = new Int8Array(NUM_CELLS).fill(NONE);
  const top = new Int8Array(NUM_CELLS).fill(NONE);
  for (const [name, tok] of Object.entries(cells)) {
    const entry = TOKENS[tok];
    if (!entry) throw new Error(`Cell ${name}: unknown token "${tok}"`);
    const id = cellByName(name);
    [base[id], top[id]] = entry;
  }
  return new GameState(base, top, toMove);
}

export function startState(): GameState {
  return parseDiagram(START_DIAGRAM, ORANGE);
}

function token(state: GameState, id: number): string {
  const b = state.base[id]!;
  const t = state.top[id]!;
  if (b === NONE) return '.';
  const baseChar = b === ORANGE ? 'o' : 'b';
  if (t === NONE) return baseChar;
  if (t === b) return baseChar.toUpperCase();
  return baseChar + (t === ORANGE ? 'O' : 'B');
}

/** Renders a state in the same format `parseDiagram` reads. */
export function renderDiagram(state: GameState): string {
  const lines = [' y    ' + [...COLUMN_LETTERS].map((l) => l.padEnd(5)).join('').trimEnd()];
  for (let y = MAX_Y; y >= 0; y--) {
    let line = String(y).padStart(2) + '    ';
    for (let col = 0; col < COLUMN_LETTERS.length; col++) {
      const id = cellAt(col, y);
      line += (id >= 0 ? token(state, id) : '').padEnd(5);
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** Number of tops each player has on the board. */
export function topCounts(state: GameState): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const c of CELLS) {
    const t = state.top[c.id]!;
    if (t !== NONE) counts[t as Player]++;
  }
  return counts;
}
