import { describe, expect, it } from 'vitest';
import {
  BLUE,
  NONE,
  ORANGE,
  PASS,
  START_DIAGRAM,
  baseMoves,
  cellByName,
  legalTurns,
  parseDiagram,
  parseTurn,
  play,
  renderDiagram,
  result,
  startState,
  stateFromCells,
  topMoves,
  toKey,
  fromKey,
  turnToString,
  type GameState,
} from '../src/engine';

const turns = (s: GameState) => legalTurns(s).map(turnToString).sort();
const topStrings = (s: GameState) => topMoves(s).map((m) => turnToString({ base: null, top: m }).slice(3)).sort();
const at = (s: GameState, name: string) => [s.base[cellByName(name)], s.top[cellByName(name)]];

describe('start position', () => {
  it('round-trips through the diagram format', () => {
    const s = startState();
    expect(renderDiagram(parseDiagram(renderDiagram(s)))).toBe(renderDiagram(s));
    expect(renderDiagram(s).trim()).toBe(START_DIAGRAM.trim());
  });

  it('gives Orange 7 base moves, 12 top moves and 70 complete turns', () => {
    const s = startState();
    expect(baseMoves(s)).toHaveLength(7);
    expect(topMoves(s)).toHaveLength(12);
    // Per base move: a2-a3 11, b2-b3 9, c2-c3 10, d2-d3 10, e2-e3 10, f2-f3 9, g2-g3 11.
    // An advanced base can extend a diagonal run, e.g. after b2-b3 the e1 top reaches b3.
    expect(legalTurns(s)).toHaveLength(70);
    const s2 = play(s, parseTurn(s, 'b2-b3 e1-b3'));
    expect(at(s2, 'b3')).toEqual([ORANGE, ORANGE]);
  });

  it('is symmetric for Blue', () => {
    expect(legalTurns(parseDiagram(START_DIAGRAM, BLUE))).toHaveLength(70);
  });
});

describe('base step', () => {
  it('advances an empty base one cell straight forward into a cell without a base', () => {
    const s = stateFromCells({ d2: 'o', a1: 'B' });
    expect(baseMoves(s).map((m) => turnToString({ base: m, top: null }))).toEqual(['d2-d3 --']);
  });

  it('does not move a base that carries a top', () => {
    expect(baseMoves(stateFromCells({ d2: 'O' }))).toEqual([]);
    expect(baseMoves(stateFromCells({ d2: 'bO' }))).toEqual([]);
  });

  it('does not move the opponent’s bases', () => {
    expect(baseMoves(stateFromCells({ d2: 'b' }))).toEqual([]);
  });

  it('is blocked by an own base or a base with a top straight ahead', () => {
    expect(baseMoves(stateFromCells({ d2: 'o', d3: 'o' })).map((m) => m.from)).toEqual([cellByName('d3')]);
    expect(baseMoves(stateFromCells({ d2: 'o', d3: 'B' }))).toEqual([]);
  });

  it('swaps with an empty opponent base straight ahead', () => {
    const s = stateFromCells({ d2: 'o', d3: 'b' });
    expect(turns(s)).toEqual(['d2~d3 --']);
    const next = play(s, parseTurn(s, 'd2~d3 --'));
    expect(at(next, 'd2')).toEqual([BLUE, NONE]);
    expect(at(next, 'd3')).toEqual([ORANGE, NONE]);
  });

  it('cannot move past the far edge', () => {
    expect(baseMoves(stateFromCells({ d7: 'o' }))).toEqual([]);
    expect(baseMoves(stateFromCells({ d1: 'b' }, BLUE))).toEqual([]);
  });
});

describe('top step: sprint', () => {
  it('runs any distance along a forward diagonal over contiguous empty bases of either colour', () => {
    const s = stateFromCells({ c1: 'O', d2: 'o', e2: 'b', f3: 'o', g3: 'B' });
    expect(topStrings(s)).toEqual(['c1-d2', 'c1-e2', 'c1-f3']);
  });

  it('stops at a cell without a base', () => {
    const s = stateFromCells({ c1: 'O', d2: 'o', f3: 'o' });
    expect(topStrings(s)).toEqual(['c1-d2']);
  });

  it('never moves straight or backward', () => {
    const s = stateFromCells({ d4: 'O', d3: 'o', d5: 'o', c3: 'o', e3: 'o' });
    expect(topStrings(s)).toEqual([]);
  });

  it('moves Blue tops down the board', () => {
    const s = stateFromCells({ d4: 'B', c3: 'b', e3: 'o' }, BLUE);
    expect(topStrings(s)).toEqual(['d4-c3', 'd4-e3']);
  });
});

describe('top step: capture', () => {
  it('jumps an adjacent opponent top onto the empty base beyond and removes it', () => {
    const s = stateFromCells({ c2: 'O', d3: 'B', e3: 'b' });
    expect(turns(s)).toEqual(['-- c2xe3']);
    const next = play(s, parseTurn(s, '-- c2xe3'));
    expect(at(next, 'c2')).toEqual([ORANGE, NONE]);
    expect(at(next, 'd3')).toEqual([BLUE, NONE]);
    expect(at(next, 'e3')).toEqual([BLUE, ORANGE]);
  });

  it('never jumps an own top', () => {
    const s = stateFromCells({ c2: 'O', d3: 'O', e3: 'b' });
    expect(turns(s)).toEqual(['-- d3-e3']);
  });

  it('cannot jump two tops in a row', () => {
    const s = stateFromCells({ c2: 'O', d3: 'B', e3: 'B', f4: 'o' });
    expect(topMoves(s)).toEqual([]);
  });

  it('needs a base to land on', () => {
    expect(topMoves(stateFromCells({ c2: 'O', d3: 'B' }))).toEqual([]);
  });

  it('is optional', () => {
    const s = stateFromCells({ c2: 'O', d3: 'B', e3: 'o', b3: 'o' });
    expect(topStrings(s)).toEqual(['c2-b3', 'c2xe3']);
  });
});

describe('turn structure', () => {
  it('lets the base step enable the top step', () => {
    const s = stateFromCells({ a1: 'O', b1: 'o' });
    expect(turns(s)).toEqual(['b1-b2 a1-b2']);
  });

  it('makes the base step mandatory even when it removes the only top move', () => {
    const s = stateFromCells({ a1: 'O', b2: 'o' });
    expect(turns(s)).toEqual(['b2-b3 --']);
  });

  it('allows a top-only turn when no base can move', () => {
    const s = stateFromCells({ a1: 'O', b2: 'o', b3: 'o', b4: 'o', b5: 'o', b6: 'o', b7: 'o' });
    expect(turns(s)).toEqual(['-- a1-b2']);
  });

  it('passes when nothing can move', () => {
    const s = stateFromCells({ c2: 'O', d3: 'B', e3: 'B', g2: 'b' });
    expect(legalTurns(s)).toEqual([PASS]);
    const next = play(s, PASS);
    expect(next.toMove).toBe(BLUE);
    expect(result(next)).toBe('ongoing');
  });
});

describe('game result', () => {
  it('wins immediately when a top lands on a goal cell by sprint', () => {
    const s = stateFromCells({ c5: 'O', d6: 'b', e6: 'b' });
    expect(turns(s)).toEqual(['-- c5-d6', '-- c5-e6']);
    expect(result(play(s, parseTurn(s, '-- c5-d6')))).toBe('ongoing');
    const won = play(s, parseTurn(s, '-- c5-e6'));
    expect(result(won)).toBe('orange');
    expect(legalTurns(won)).toEqual([]);
  });

  it('wins by capture onto a goal cell', () => {
    const s = stateFromCells({ c5: 'O', d6: 'B', e6: 'b' });
    expect(result(play(s, parseTurn(s, '-- c5xe6')))).toBe('orange');
  });

  it('wins for Blue on Orange’s back row', () => {
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o' }, BLUE);
    expect(result(play(s, parseTurn(s, '-- c2-a1')))).toBe('blue');
  });

  it('is a draw when neither player can move', () => {
    const s = stateFromCells({ c2: 'O', d3: 'B', e3: 'B' });
    expect(result(s)).toBe('draw');
  });
});

describe('position keys', () => {
  it('round-trip, including mixed-colour stacks and side to move', () => {
    const s = stateFromCells({ c2: 'oB', d3: 'bO', e3: 'b', a1: 'O' }, BLUE);
    expect(toKey(fromKey(toKey(s)))).toBe(toKey(s));
    expect(renderDiagram(fromKey(toKey(s)))).toBe(renderDiagram(s));
    expect(fromKey(toKey(startState())).toMove).toBe(ORANGE);
  });
});
