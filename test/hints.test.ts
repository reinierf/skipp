import { describe, expect, it } from 'vitest';
import {
  BLUE,
  cellByName,
  cellName,
  fromKey,
  legalTurns,
  parseTurn,
  play,
  result,
  startState,
  stateFromCells,
  turnToString,
  type GameState,
} from '../src/engine';
import { analyse, explain, type Hint } from '../src/hints';
import { capturableTops, goalThreats, topPath } from '../src/hints/facts';
import { search } from '../src/search/alphabeta';
import { evaluate, evaluateTerms } from '../src/search/evaluate';
import { mulberry32, pick } from '../src/util/rng';

const hintFor = (s: GameState, maxDepth: number): Hint => explain(s, analyse(s, { maxDepth })!);
const kinds = (h: Hint) => h.reasons.map((r) => r.kind);
const text = (h: Hint, kind: string) => h.reasons.find((r) => r.kind === kind)?.text ?? '';

function samplePositions(n: number): GameState[] {
  const rand = mulberry32(11);
  const out: GameState[] = [];
  while (out.length < n) {
    let s = startState();
    while (result(s) === 'ongoing') {
      if (s.ply % 7 === 3) out.push(s);
      s = play(s, pick(legalTurns(s), rand));
    }
  }
  return out.slice(0, n);
}

describe('search support for hints', () => {
  it('splits the evaluation into terms that add up to it', () => {
    for (const s of samplePositions(40)) {
      const sum = Object.values(evaluateTerms(s)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(evaluate(s), 9);
    }
  });

  it('returns a legal main line starting with the best turn', () => {
    for (const s of samplePositions(10)) {
      const r = search(s, { maxDepth: 4 });
      expect(r.pv[0]).toEqual(r.best);
      expect(r.pv.length).toBeLessThanOrEqual(r.depth);
      let pos = s;
      for (const t of r.pv) {
        expect(legalTurns(pos).map(turnToString)).toContain(turnToString(t));
        pos = play(pos, t);
      }
    }
  });

  it('ends the main line of a forced win with the winning turn', () => {
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', f2: 'B', g1: 'o', e5: 'o' });
    const r = search(s, { maxDepth: 2 });
    expect(r.pv).toHaveLength(2);
    expect(play(play(s, r.pv[0]!), r.pv[1]!).winner).toBe(BLUE);
  });

  it('only searches root turns that pass the filter', () => {
    const s = startState();
    const r = search(s, { maxDepth: 3, rootFilter: (t) => t.base?.from === cellByName('g2') });
    expect(r.best?.base?.from).toBe(cellByName('g2'));
    expect(search(s, { maxDepth: 3, rootFilter: () => false }).best).toBeNull();
  });
});

describe('board facts', () => {
  it('finds goal threats and capturable tops for either side', () => {
    const s = stateFromCells({ c2: 'B', b2: 'o', a1: 'o', d3: 'O', e3: 'B', f4: 'o' });
    expect(goalThreats(s, BLUE).map(cellName)).toEqual(['a1']);
    expect(capturableTops(s, 0).map(cellName)).toEqual([]);
    expect(capturableTops(s, BLUE).map(cellName)).toEqual(['e3']);
  });

  it('lists the cells a sprint passes over', () => {
    const top = { from: cellByName('a1'), to: cellByName('d3'), captured: -1 };
    expect(topPath(top, 0).map(cellName)).toEqual(['b2', 'c2', 'd3']);
  });
});

describe('hint explanations', () => {
  it('names an immediate win and nothing else', () => {
    const h = hintFor(stateFromCells({ c5: 'O', d6: 'b', e6: 'b', g2: 'o' }), 3);
    expect(kinds(h)).toEqual(['win']);
    expect(text(h, 'win')).toContain('e6');
  });

  it('says when every move loses', () => {
    const h = hintFor(stateFromCells({ c2: 'B', b2: 'o', a1: 'o', f2: 'B', g1: 'o', e5: 'o' }), 2);
    expect(kinds(h)).toEqual(['lost']);
  });

  it('explains blocking a threat', () => {
    const h = hintFor(stateFromCells({ c2: 'B', b2: 'o', a1: 'o', g2: 'o' }), 3);
    expect(kinds(h)).toContain('stops-threat');
    expect(text(h, 'stops-threat')).toContain('a1');
  });

  it('shows how Blue wins after the next-best move when every other move loses', () => {
    const s = fromKey('.ooBb.O..boB..oyb.xO.Ob.b..oobb..oxb.b..oOy.B o');
    const h = hintFor(s, 5);
    expect(text(h, 'only-move')).toMatch(/^Every other move loses\. After .*, for example, Blue wins in 2 turns: Blue plays /);
  });

  it('explains a capture', () => {
    const h = hintFor(stateFromCells({ d3: 'O', e3: 'B', f4: 'o', a1: 'o' }), 3);
    expect(turnToString(h.turn)).toBe('a1-a2 d3xf4');
    expect(text(h, 'capture')).toBe("Captures Blue's top on e3.");
  });

  it('explains a sacrifice by the line that pays it back', () => {
    // From strong play: the top moved to e3 can be taken, but Orange takes back next turn.
    const s = fromKey('o.o.bBO.o..bBOO.b.b.oO..BBOo..bbOo.B..BOo.b.B o');
    const h = hintFor(s, 5);
    expect(turnToString(h.turn)).toBe('e2-e3 d3-e3');
    expect(text(h, 'sacrifice')).toMatch(/Gives up your top on e3 on purpose: if Blue takes it with .*, you play .* and capture on/);
    expect(kinds(h)).toContain('bridge');
  });

  it('explains why a tempting capture is wrong', () => {
    const s = fromKey('.ooBB...bObo...Obboo.xy.b..boB.ob.boo..ObBO.. o');
    const a = analyse(s, { maxDepth: 5 })!;
    expect(a.alternative?.kind).toBe('capture');
    const h = explain(s, a);
    expect(text(h, 'alternative')).toMatch(/^Capturing with .* looks tempting, but Blue then wins in 2 turns/);
  });

  it('compares with the base step the player chose', () => {
    const s = startState();
    const a = analyse(s, { maxDepth: 3, chosenBase: { from: cellByName('g2'), to: cellByName('g3'), swap: false } })!;
    if (a.best.turn.base?.from === cellByName('g2')) return; // nothing to compare
    expect(a.alternative?.kind).toBe('chosen-base');
    expect(a.alternative?.turn.base?.from).toBe(cellByName('g2'));
    expect(text(explain(s, a), 'alternative')).toContain('With the base step you chose');
  });

  it('describes what the base step does for the top step', () => {
    // Explains a given turn without searching, to pin down each case.
    const bridge = (cells: Record<string, string>, turn: string) => {
      const s = stateFromCells(cells);
      const t = parseTurn(s, turn);
      const line = { turn: t, score: 0, depth: 1, scores: [0], pv: [t] };
      return text(explain(s, { best: line, runnerUp: null, alternative: null }), 'bridge');
    };
    expect(bridge({ c1: 'O', d1: 'o', a1: 'o', g6: 'b' }, 'd1-d2 c1-d2')).toBe('The base step to d2 gives your top a base to step onto.');
    expect(bridge({ c1: 'O', d2: 'o', e1: 'o', g6: 'b' }, 'e1-e2 c1-e2')).toBe("The base step to e2 puts a base at the end of your top's sprint.");
    expect(bridge({ c1: 'O', d2: 'o', e1: 'o', f3: 'o', g6: 'b' }, 'e1-e2 c1-f3')).toBe('The base step to e2 fills the gap your top sprints across to f3.');
  });

  it('always gives at least one reason', () => {
    for (const s of samplePositions(15)) {
      if (legalTurns(s).length === 0) continue;
      expect(hintFor(s, 3).reasons.length).toBeGreaterThan(0);
    }
  });
});
