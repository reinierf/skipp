import { describe, expect, it } from 'vitest';
import { BLUE, startState, stateFromCells } from '../src/engine';
import { DEFAULT_WEIGHTS, evaluate, type Weights } from '../src/search/evaluate';

// Every standard term off, so each test sees one strategy term alone.
const ZERO: Weights = { top: 0, advance: 0, threat: 0, threatToMove: 0, topMobility: 0, baseMobility: 0 };

describe('strategy terms', () => {
  it('rewards tops in central columns', () => {
    expect(evaluate(stateFromCells({ d4: 'O', a3: 'B' }), { ...ZERO, centre: 4 })).toBe(12);
  });

  it('rewards tops still on their own back row', () => {
    expect(evaluate(stateFromCells({ a1: 'O', b4: 'B' }), { ...ZERO, defender: 15 })).toBe(15);
  });

  it('penalises empty bases on a player’s own back row', () => {
    expect(evaluate(stateFromCells({ a1: 'o', c6: 'B' }), { ...ZERO, exposedGoal: 15 })).toBe(-15);
  });

  it('rewards tops that no enemy top can still reach', () => {
    // Blue's a2 top is past Orange's d4 top; Blue's c6 top and Orange's d4 top still face each other.
    expect(evaluate(stateFromCells({ d4: 'O', a2: 'B', c6: 'B' }), { ...ZERO, passed: 20 })).toBe(-20);
    // Tops level with each other cannot capture each other.
    expect(evaluate(stateFromCells({ a3: 'O', c3: 'B' }), { ...ZERO, passed: 20 })).toBe(0);
  });

  it('rewards two goal landings at once, not one', () => {
    const one = stateFromCells({ c5: 'O', d6: 'b', e6: 'b' });
    const two = stateFromCells({ c5: 'O', d6: 'b', e6: 'b', b6: 'b', a6: 'b' });
    expect(evaluate(one, { ...ZERO, fork: 80 })).toBe(0);
    expect(evaluate(two, { ...ZERO, fork: 80 })).toBe(80);
    two.toMove = BLUE;
    expect(evaluate(two, { ...ZERO, fork: 80 })).toBe(-80);
  });

  it('changes nothing when every strategy term is zero', () => {
    const s = startState();
    const off = { ...DEFAULT_WEIGHTS, centre: 0, defender: 0, exposedGoal: 0, passed: 0, fork: 0 };
    expect(evaluate(s, off)).toBe(evaluate(s, DEFAULT_WEIGHTS));
  });
});
