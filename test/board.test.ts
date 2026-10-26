import { describe, expect, it } from 'vitest';
import { BLUE, CELLS, FORWARD, IS_GOAL, NUM_CELLS, ORANGE, RAYS, cellByName, cellName } from '../src/engine';

const names = (ids: readonly number[]) => ids.map(cellName);

describe('board geometry', () => {
  it('has 45 cells: 6 in columns a/c/e/g and 7 in b/d/f', () => {
    expect(NUM_CELLS).toBe(45);
    const perColumn = [0, 1, 2, 3, 4, 5, 6].map((col) => CELLS.filter((c) => c.col === col).length);
    expect(perColumn).toEqual([6, 7, 6, 7, 6, 7, 6]);
  });

  it('names cells by column letter and rank from Orange’s side', () => {
    expect(CELLS[cellByName('a1')]).toMatchObject({ col: 0, y: 1 });
    expect(CELLS[cellByName('b1')]).toMatchObject({ col: 1, y: 0 });
    expect(CELLS[cellByName('b7')]).toMatchObject({ col: 1, y: 12 });
    expect(CELLS[cellByName('g6')]).toMatchObject({ col: 6, y: 11 });
  });

  it('moves bases straight forward per player', () => {
    expect(cellName(FORWARD[ORANGE]![cellByName('c2')]!)).toBe('c3');
    expect(cellName(FORWARD[BLUE]![cellByName('c2')]!)).toBe('c1');
    expect(FORWARD[ORANGE]![cellByName('c6')]).toBe(-1);
    expect(FORWARD[BLUE]![cellByName('b1')]).toBe(-1);
  });

  it('builds forward-diagonal rays per player', () => {
    const orange = RAYS[ORANGE]![cellByName('c1')]!.map(names);
    expect(orange).toEqual([
      ['b2', 'a2'],
      ['d2', 'e2', 'f3', 'g3'],
    ]);
    const blue = RAYS[BLUE]![cellByName('d4')]!.map(names);
    expect(blue).toEqual([
      ['c3', 'b3', 'a2'],
      ['e3', 'f3', 'g2'],
    ]);
  });

  it('puts each player’s goal on the opponent’s back row', () => {
    const goal = (p: number) => CELLS.filter((c) => IS_GOAL[p]![c.id]).map((c) => c.name);
    expect(goal(ORANGE)).toEqual(['a6', 'b7', 'c6', 'd7', 'e6', 'f7', 'g6']);
    expect(goal(BLUE)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1']);
  });
});
