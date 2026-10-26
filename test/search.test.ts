import { describe, expect, it } from 'vitest';
import {
  BLUE,
  legalTurns,
  play,
  result,
  startState,
  stateFromCells,
  turnToString,
  type GameState,
} from '../src/engine';
import { WIN, isMateScore, minimax, perft, search } from '../src/search/alphabeta';
import { TranspositionTable } from '../src/search/tt';
import { mulberry32, pick } from '../src/util/rng';

const best = (s: GameState, maxDepth: number) => {
  const r = search(s, { maxDepth });
  return { ...r, text: r.best ? turnToString(r.best) : null };
};

describe('tactical positions', () => {
  it('takes an immediate win', () => {
    const r = best(stateFromCells({ c5: 'O', d6: 'b', e6: 'b', g2: 'o' }), 3);
    expect(r.text).toBe('g2-g3 c5-e6');
    expect(r.score).toBe(WIN - 1);
  });

  it('finds a base step that enables a winning top step', () => {
    const r = best(stateFromCells({ a5: 'O', b5: 'o', c6: 'b', g2: 'o' }), 1);
    expect(r.text).toBe('b5-b6 a5-c6');
  });

  it('blocks an immediate threat with a base step', () => {
    // Blue threatens c2-a1 via the empty bases on b2 and a1.
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', g2: 'o' });
    const r = best(s, 2);
    expect(['a1-a2 --', 'b2-b3 --']).toContain(r.text);
    expect(isMateScore(r.score)).toBe(false);
    expect(result(play(s, search(s, { maxDepth: 2 }).best!))).toBe('ongoing');
  });

  it('captures the threatening top instead of playing elsewhere', () => {
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', a2: 'B', b3: 'o', b4: 'B', d2: 'O', e1: 'O', f2: 'b' });
    expect(legalTurns(s).map(turnToString).sort()).toEqual(['-- d2xb3', '-- e1-f2']);
    expect(best(s, 2).text).toBe('-- d2xb3');
  });

  it('reports a forced loss when every reply loses', () => {
    // Blue has two separate winning sprints; Orange can block only one.
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', f2: 'B', g1: 'o', e5: 'o' });
    const r = best(s, 2);
    expect(r.score).toBe(-(WIN - 2));
  });
});

describe('alpha-beta correctness', () => {
  function samplePositions(n: number): GameState[] {
    const rand = mulberry32(7);
    const out: GameState[] = [];
    while (out.length < n) {
      let s = startState();
      while (result(s) === 'ongoing') {
        if (s.ply >= 10 && s.ply % 9 === 0) out.push(s);
        s = play(s, pick(legalTurns(s), rand));
      }
    }
    return out.slice(0, n);
  }

  it.each([
    ['plain', { tt: false, heuristics: false }],
    ['killers and history', { tt: false, heuristics: true }],
    ['transposition table', { heuristics: true }],
  ] as const)('matches plain minimax at depths 1-3 (%s)', (_name, opts) => {
    for (const s of samplePositions(20)) {
      for (let d = 1; d <= 3; d++) expect(search(s, { maxDepth: d, ...opts }).score).toBe(minimax(s, d));
    }
  });

  it('gives the same result when a transposition table is reused between searches', () => {
    const tt = new TranspositionTable();
    for (const s of samplePositions(10)) {
      const fresh = search(s, { maxDepth: 4 });
      const reused = search(s, { maxDepth: 4, tt });
      expect(reused.score).toBe(fresh.score);
    }
  });

  it('searches fewer nodes than minimax', () => {
    const s = samplePositions(1)[0]!;
    expect(search(s, { maxDepth: 3 }).iterations[2]!.nodes).toBeLessThan(perft(s, 3));
  });

  it('respects a time limit', () => {
    const r = search(startState(), { maxDepth: 50, timeMs: 200 });
    expect(r.timeMs).toBeLessThan(1000);
    expect(r.best).not.toBeNull();
  });

  it('works for Blue to move', () => {
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', g5: 'b' }, BLUE);
    expect(best(s, 1).text).toBe('g5-g4 c2-a1');
  });
});
