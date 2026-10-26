import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  autoComplete,
  baseOptions,
  completeWithTop,
  isPassOnly,
  needsBase,
  topOptions,
  type Selection,
} from '../app/src/input';
import { cellByName, cellName, legalTurns, startState, stateFromCells, turnToString } from '../src/engine';

const names = (cells: Iterable<number>) => [...cells].map(cellName).sort();

describe('turn input', () => {
  it('starts with a base step when bases can move', () => {
    const turns = legalTurns(startState());
    expect(needsBase(turns)).toBe(true);
    expect(names(baseOptions(turns).keys())).toEqual(['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2']);
    expect(topOptions(turns, EMPTY_SELECTION).size).toBe(0);
  });

  it('offers the top moves that remain after the chosen base step', () => {
    const turns = legalTurns(startState());
    const sel: Selection = { base: baseOptions(turns).get(cellByName('b2'))!, topFrom: null };
    expect(names(topOptions(turns, sel).keys())).toEqual(['c1', 'e1', 'g1']);
    const e1: Selection = { ...sel, topFrom: cellByName('e1') };
    expect(names(topOptions(turns, sel).get(cellByName('e1'))!.map((m) => m.to))).toEqual(['b3', 'c2', 'd2', 'f2', 'g2']);
    expect(turnToString(completeWithTop(turns, e1, cellByName('b3'))!)).toBe('b2-b3 e1-b3');
    expect(completeWithTop(turns, e1, cellByName('a2'))).toBeNull();
  });

  it('completes a turn automatically when the base step leaves no top move', () => {
    const turns = legalTurns(stateFromCells({ a1: 'O', b2: 'o' }));
    const sel: Selection = { base: baseOptions(turns).get(cellByName('b2'))!, topFrom: null };
    expect(turnToString(autoComplete(turns, sel)!)).toBe('b2-b3 --');
  });

  it('skips the base step when no base can move', () => {
    const turns = legalTurns(stateFromCells({ c2: 'O', d3: 'B', e3: 'b' }));
    expect(needsBase(turns)).toBe(false);
    expect(names(topOptions(turns, EMPTY_SELECTION).keys())).toEqual(['c2']);
  });

  it('recognises a forced pass', () => {
    expect(isPassOnly(legalTurns(stateFromCells({ c2: 'O', d3: 'B', e3: 'B' })))).toBe(true);
  });
});
