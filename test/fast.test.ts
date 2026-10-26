import { describe, expect, it } from 'vitest';
import {
  MAX_TURNS,
  PASS_CODE,
  decodeTurn,
  encodeTurn,
  generateTurns,
  legalTurns,
  makeTurn,
  play,
  result,
  startState,
  stateFromCells,
  turnToString,
  unmakeTurn,
  type GameState,
} from '../src/engine';
import { hashState, toggleSide, xorTouchedCells } from '../src/search/tt';
import { mulberry32, pick } from '../src/util/rng';

const buf = new Int32Array(MAX_TURNS);

function codes(s: GameState): number[] {
  return [...buf.subarray(0, generateTurns(s, buf, 0))];
}

function same(a: GameState, b: GameState): void {
  expect([...a.base]).toEqual([...b.base]);
  expect([...a.top]).toEqual([...b.top]);
  expect([a.toMove, a.winner, a.ply]).toEqual([b.toMove, b.winner, b.ply]);
}

function* randomPositions(games: number, seed: number): Generator<GameState> {
  const rand = mulberry32(seed);
  for (let g = 0; g < games; g++) {
    let s = startState();
    while (result(s) === 'ongoing') {
      yield s;
      s = play(s, pick(legalTurns(s), rand));
    }
    yield s;
  }
}

describe('fast engine', () => {
  it('round-trips turn encoding', () => {
    for (const s of randomPositions(5, 3)) {
      for (const t of legalTurns(s)) expect(turnToString(decodeTurn(encodeTurn(t)))).toBe(turnToString(t));
    }
  });

  it('generates the same turns in the same order as legalTurns', () => {
    for (const s of randomPositions(60, 11)) {
      expect(codes(s)).toEqual(legalTurns(s).map(encodeTurn));
    }
  });

  it('encodes a pass and generates nothing after a win', () => {
    expect(codes(stateFromCells({ c2: 'O', d3: 'B', e3: 'B' }))).toEqual([PASS_CODE]);
    const s = stateFromCells({ c5: 'O', d6: 'b', e6: 'b' });
    expect(codes(play(s, decodeTurn(codes(s)[1]!)))).toEqual([]);
  });

  it('makes turns exactly like play and unmakes them exactly', () => {
    for (const s of randomPositions(30, 5)) {
      if (s.winner !== -1) continue;
      for (const code of codes(s)) {
        const work = s.clone();
        const hash = hashState(work);
        makeTurn(work, code);
        same(work, play(s, decodeTurn(code)));
        unmakeTurn(work, code);
        same(work, s);
        expect(hashState(work)).toEqual(hash);
      }
    }
  });
});

describe('incremental hashing', () => {
  it('matches a full rehash after every make and unmake', () => {
    for (const s of randomPositions(30, 8)) {
      if (s.winner !== -1) continue;
      for (const code of codes(s)) {
        const work = s.clone();
        const h = Uint32Array.from(hashState(work));
        xorTouchedCells(work, code, h);
        makeTurn(work, code);
        xorTouchedCells(work, code, h);
        toggleSide(h);
        expect([...h]).toEqual(hashState(work));
        xorTouchedCells(work, code, h);
        unmakeTurn(work, code);
        xorTouchedCells(work, code, h);
        toggleSide(h);
        expect([...h]).toEqual(hashState(s));
      }
    }
  });
});
