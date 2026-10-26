import { describe, expect, it } from 'vitest';
import { BLUE, IS_GOAL, NONE, NUM_CELLS, ORANGE, baseMoves, countBaseMoves, countTopMoves, legalTurns, play, result, startState, topCounts, topMoves, type GameState } from '../src/engine';
import { mulberry32 } from '../src/util/rng';

function checkInvariants(s: GameState): void {
  const bases = [0, 0];
  for (let c = 0; c < NUM_CELLS; c++) {
    if (s.base[c] !== NONE) bases[s.base[c]!]!++;
    if (s.top[c] !== NONE) expect(s.base[c], 'top without base').not.toBe(NONE);
  }
  expect(bases).toEqual([14, 14]);
}

describe('random self-play', () => {
  it('always terminates and keeps the position consistent', () => {
    const rand = mulberry32(12345);
    const outcomes: Record<string, number> = {};
    for (let game = 0; game < 300; game++) {
      let s = startState();
      let tops = topCounts(s);
      while (result(s) === 'ongoing') {
        const turns = legalTurns(s);
        expect(turns.length).toBeGreaterThan(0);
        s = play(s, turns[Math.floor(rand() * turns.length)]!);
        checkInvariants(s);
        const next = topCounts(s);
        expect(next[0]).toBeLessThanOrEqual(tops[0]);
        expect(next[1]).toBeLessThanOrEqual(tops[1]);
        tops = next;
        expect(s.ply).toBeLessThan(500);
      }
      outcomes[result(s)] = (outcomes[result(s)] ?? 0) + 1;
    }
    expect(outcomes.orange! + outcomes.blue!).toBeGreaterThan(0);
  });
});

describe('non-allocating move counters', () => {
  it('agree with the full move generators on random positions', () => {
    const rand = mulberry32(99);
    const out = new Int32Array(2);
    for (let game = 0; game < 50; game++) {
      let s = startState();
      while (result(s) === 'ongoing') {
        for (const p of [ORANGE, BLUE] as const) {
          const tops = topMoves(s, p);
          countTopMoves(s, p, out);
          expect(out[0]).toBe(tops.length);
          expect(out[1]).toBe(tops.filter((m) => IS_GOAL[p]![m.to]).length);
          expect(countBaseMoves(s, p)).toBe(baseMoves(s, p).length);
        }
        const turns = legalTurns(s);
        s = play(s, turns[Math.floor(rand() * turns.length)]!);
      }
    }
  });
});
