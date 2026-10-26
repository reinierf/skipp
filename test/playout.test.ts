import { describe, expect, it } from 'vitest';
import { NONE, NUM_CELLS, legalTurns, play, result, startState, topCounts, type GameState } from '../src/engine';

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
