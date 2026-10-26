// Static geometry of the Original Skipp board. See RULES.md for the coordinate system.

export const ORANGE = 0;
export const BLUE = 1;
export type Player = typeof ORANGE | typeof BLUE;

export const COLUMNS = 7;
export const MAX_Y = 12;
export const COLUMN_LETTERS = 'abcdefg';

export interface Cell {
  readonly id: number;
  readonly col: number;
  readonly y: number;
  readonly name: string;
}

/** Cells ordered by column, then by y ascending. */
export const CELLS: readonly Cell[] = (() => {
  const cells: Cell[] = [];
  for (let col = 0; col < COLUMNS; col++) {
    for (let y = col % 2 === 0 ? 1 : 0; y <= MAX_Y; y += 2) {
      const name = `${COLUMN_LETTERS[col]}${(y >> 1) + 1}`;
      cells.push({ id: cells.length, col, y, name });
    }
  }
  return cells;
})();

export const NUM_CELLS = CELLS.length;

const idByCoord = new Map<string, number>(CELLS.map((c) => [`${c.col},${c.y}`, c.id]));
const idByName = new Map<string, number>(CELLS.map((c) => [c.name, c.id]));

/** Cell id at (col, y), or -1 if off the board. */
export function cellAt(col: number, y: number): number {
  return idByCoord.get(`${col},${y}`) ?? -1;
}

export function cellByName(name: string): number {
  const id = idByName.get(name);
  if (id === undefined) throw new Error(`Unknown cell: ${name}`);
  return id;
}

export function cellName(id: number): string {
  return CELLS[id]!.name;
}

export function opponent(p: Player): Player {
  return (1 - p) as Player;
}

/** Direction of travel along y for each player. */
const DY = [1, -1] as const;

/** FORWARD[p][cell]: the straight-forward neighbour for player p, or -1. */
export const FORWARD: readonly Int8Array[] = [ORANGE, BLUE].map((p) => {
  const arr = new Int8Array(NUM_CELLS);
  for (const c of CELLS) arr[c.id] = cellAt(c.col, c.y + 2 * DY[p]!);
  return arr;
});

/**
 * RAYS[p][cell]: the two forward-diagonal rays for player p, each the list of cells
 * along that diagonal (nearest first), excluding the starting cell. Empty rays are omitted.
 */
export const RAYS: readonly (readonly (readonly number[])[])[][] = [ORANGE, BLUE].map((p) =>
  CELLS.map((c) => {
    const rays: number[][] = [];
    for (const dc of [-1, 1]) {
      const ray: number[] = [];
      for (let k = 1; ; k++) {
        const id = cellAt(c.col + dc * k, c.y + DY[p]! * k);
        if (id < 0) break;
        ray.push(id);
      }
      if (ray.length > 0) rays.push(ray);
    }
    return rays;
  }),
);

/** Longest possible ray, plus one slot for the -1 terminator. */
export const RAY_STRIDE = 8;

/**
 * Flat copy of RAYS for hot loops: the ray in direction d (0 or 1) from `cell` starts at
 * ((cell * 2 + d) * RAY_STRIDE) and is terminated by -1. Missing rays are just a -1.
 */
export const RAYS_FLAT: readonly Int8Array[] = [ORANGE, BLUE].map((p) => {
  const arr = new Int8Array(NUM_CELLS * 2 * RAY_STRIDE).fill(-1);
  for (const c of CELLS) {
    for (const [d, dc] of [-1, 1].entries()) {
      for (let k = 1; k < RAY_STRIDE; k++) {
        const id = cellAt(c.col + dc * k, c.y + DY[p]! * k);
        if (id < 0) break;
        arr[(c.id * 2 + d) * RAY_STRIDE + k - 1] = id;
      }
    }
  }
  return arr;
});

/** IS_GOAL[p][cell]: true if a player-p top landing on this cell wins. */
export const IS_GOAL: readonly Uint8Array[] = [ORANGE, BLUE].map((p) => {
  const arr = new Uint8Array(NUM_CELLS);
  for (const c of CELLS) {
    // The goal row is the last cell of each column in the player's direction of travel.
    arr[c.id] = FORWARD[p]![c.id]! < 0 ? 1 : 0;
  }
  return arr;
});
