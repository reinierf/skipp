// Turns an Analysis into sentences saying why the hint is good. Tactical reasons are read from
// the position and from the expected line of play, so sacrifices and threats a few turns deep
// are explained by what happens next; positional reasons compare the evaluation terms at the
// end of the hint's line with those at the end of the next-best turn's line.

import { NONE, ORANGE, cellName, legalTurns, opponent, play, turnToString, type GameState, type Player, type Turn } from '../engine';
import { WIN, isMateScore } from '../search/alphabeta';
import { DEFAULT_WEIGHTS, evaluateTerms, type Terms } from '../search/evaluate';
import type { Analysis, Line } from './analyse';
import { capturableTops, goalThreats, topBalance, topPath } from './facts';

export type ReasonKind =
  | 'only-legal'
  | 'win'
  | 'forced-win'
  | 'lost'
  | 'stops-threat'
  | 'only-move'
  | 'capture'
  | 'sacrifice'
  | 'offer'
  | 'saves'
  | 'threat'
  | 'bridge'
  | 'positional'
  | 'plan'
  | 'close'
  | 'alternative'
  | 'fallback';

export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface Hint {
  turn: Turn;
  /** Turns the search looked ahead. */
  depth: number;
  /** Most important first. */
  reasons: Reason[];
}

/** Lines are narrated for at most this many turns. */
const NARRATE_MAX = 4;
/** Score gaps, in evaluation points (a top is worth 100). */
const CLOSE_GAP = 3;
const NOTABLE_GAP = 15;
const CLEAR_GAP = 50;
/** Smallest difference in one evaluation term worth naming as a reason. */
const TERM_MIN = 8;
const TOP_VALUE = DEFAULT_WEIGHTS.top;

const TERM_PHRASES: Record<keyof Terms, string> = {
  material: 'keeps more of your tops on the board',
  advance: 'gets your tops further up the board',
  threats: 'leaves you more ways to reach the goal',
  topMobility: 'gives your tops more open lanes to sprint along',
  baseMobility: 'keeps more of your bases free to move, so you are less likely to be forced into a weakening base step',
};

/** What the expected line achieves, per term, when there is nothing to compare it with. */
const PLAN_PHRASES: Record<keyof Terms, string> = {
  material: 'wins material',
  advance: 'moves your tops up the board',
  threats: 'creates chances to reach the goal',
  topMobility: 'opens lanes for your tops to sprint along',
  baseMobility: 'frees up your bases to move',
};

const playerName = (p: Player) => (p === ORANGE ? 'Orange' : 'Blue');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "a1", "a1 and b2", "a1, b2 and c3". */
function cellList(cells: readonly number[]): string {
  const names = cells.map(cellName);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Own turns needed for a forced win with this score (see WIN in alphabeta.ts). */
const turnsToWin = (score: number) => (WIN - score + 1) / 2;
/** Opponent turns needed for a forced win against the side with this score. */
const turnsToLose = (score: number) => (WIN + score) / 2;

/** The position at the end of `pv`, played from `state`. */
const endOf = (state: GameState, pv: readonly Turn[]) => pv.reduce(play, state);

/** The term with the largest gain from `from` to `to` (both from one player's view), if at least TERM_MIN. */
function largestGain(from: Terms, to: Terms): keyof Terms | null {
  let best: keyof Terms | null = null;
  for (const k of Object.keys(to) as (keyof Terms)[]) {
    const d = to[k] - from[k];
    if (d >= TERM_MIN && (best === null || d > to[best] - from[best])) best = k;
  }
  return best;
}

/** Evaluation terms from p's point of view. */
function termsFor(state: GameState, p: Player): Terms {
  const t = evaluateTerms(state);
  if (state.toMove === p) return t;
  return { material: -t.material, advance: -t.advance, threats: -t.threats, topMobility: -t.topMobility, baseMobility: -t.baseMobility };
}

interface Sacrifice {
  /** Index in the line of the opponent's capture, and the cell of the top lost. */
  loss: number;
  cell: number;
  /** Index of the first own turn after it that wins or captures, or -1. */
  payoff: number;
}

/**
 * The first top the opponent wins outright along `pv` within two replies (a capture that is
 * not just taking back a top captured earlier in the line), and where it is paid back.
 */
function findSacrifice(state: GameState, pv: readonly Turn[], me: Player): Sacrifice | null {
  const start = topBalance(state, me);
  let s = state;
  let lost: { loss: number; cell: number } | null = null;
  for (let i = 0; i < pv.length; i++) {
    const t = pv[i]!;
    s = play(s, t);
    const mine = i % 2 === 0;
    if (!lost) {
      if (i > 3) return null;
      if (!mine && t.top?.captured !== undefined && t.top.captured !== NONE && topBalance(s, me) < start) {
        lost = { loss: i, cell: t.top.captured };
      }
    } else if (mine && (s.winner === me || (t.top !== null && t.top.captured !== NONE))) {
      return { ...lost, payoff: i };
    }
  }
  return lost && { ...lost, payoff: -1 };
}

export function explain(state: GameState, a: Analysis): Hint {
  const me = state.toMove;
  const opp = opponent(me);
  const them = playerName(opp);
  const { best, runnerUp, alternative } = a;
  const turn = best.turn;
  const after = play(state, turn);
  const reasons: Reason[] = [];
  const add = (kind: ReasonKind, text: string) => reasons.push({ kind, text });
  const hint = (): Hint => {
    if (reasons.length === 0) {
      add('fallback', `The computer rates this best, looking ${plural(best.depth, 'turn')} ahead, but no single reason stands out.`);
    }
    return { turn, depth: best.depth, reasons };
  };

  /** "Blue plays x, then you play y, …", for a line whose first turn is `first`'s. */
  const narrate = (turns: readonly Turn[], first: Player) => {
    const text = turns
      .slice(0, NARRATE_MAX)
      .map((t, i) => `${(i % 2 === 0) === (first === me) ? 'you play' : `${them} plays`} ${turnToString(t)}`)
      .join(', then ');
    return turns.length > NARRATE_MAX ? `${text}, …` : text;
  };
  const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (legalTurns(state).length === 1) {
    add('only-legal', 'This is your only legal move.');
    return hint();
  }
  if (after.winner === me) {
    add('win', `This wins: your top reaches the goal on ${cellName(turn.top!.to)}.`);
    return hint();
  }
  if (isMateScore(best.score)) {
    if (best.score > 0) {
      const k = turnsToWin(best.score);
      add('forced-win', `This forces a win in ${plural(k, 'turn')}, whatever ${them} does: ${narrate(best.pv, me)}.`);
    } else {
      const k = turnsToLose(best.score);
      add('lost', `${them} can force a win whatever you do. This move holds out longest: ${them} needs ${plural(k, 'more turn')}.`);
    }
    return hint();
  }

  // Threats against you, and whether this turn deals with them.
  const threatsBefore = goalThreats(state, opp);
  if (threatsBefore.length > 0 && goalThreats(after, opp).length === 0) {
    add('stops-threat', `Stops ${them}'s threat to reach the goal on ${cellList(threatsBefore)}.`);
  }
  if (runnerUp && isMateScore(runnerUp.score) && runnerUp.score < 0) {
    const k = turnsToLose(runnerUp.score);
    const how = k === 1 ? 'wins at once' : `wins in ${plural(k, 'turn')}`;
    add('only-move', `Every other move loses. After ${turnToString(runnerUp.turn)}, for example, ${them} ${how}: ${narrate(runnerUp.pv.slice(1), opp)}.`);
  }

  // Material: captures, sacrifices, tops saved or left open.
  if (turn.top && turn.top.captured !== NONE) {
    const retaken = best.pv[1]?.top?.captured ?? NONE;
    add(
      'capture',
      retaken === NONE
        ? `Captures ${them}'s top on ${cellName(turn.top.captured)}.`
        : `Captures ${them}'s top on ${cellName(turn.top.captured)}. ${them} takes back on ${cellName(retaken)}, so this trades a top each.`,
    );
  }
  const movedTo = (c: number) => (turn.top && turn.top.from === c ? turn.top.to : c);
  const openBefore = capturableTops(state, me);
  const openAfter = capturableTops(after, me);
  const newlyOpen = openAfter.filter((c) => !openBefore.map(movedTo).includes(c));
  // Open tops the opponent does not take in the expected line (a recapture is a trade, not an offer).
  const reply = best.pv[1];
  const offered = newlyOpen.filter((c) => reply?.top?.captured !== c);
  const sacrifice = findSacrifice(state, best.pv, me);
  if (sacrifice) {
    const cell = cellName(sacrifice.cell);
    const intro = newlyOpen.includes(sacrifice.cell) ? `Gives up your top on ${cell} on purpose` : `Lets ${them} take your top on ${cell}`;
    const take = turnToString(best.pv[sacrifice.loss]!);
    let text: string;
    if (sacrifice.payoff < 0) {
      // Without a payoff in the line, only claim compensation if the score does not count the top as lost.
      text =
        best.score > (topBalance(state, me) - 0.5) * TOP_VALUE
          ? `${intro}. After ${them} takes it with ${take}, the computer judges your position is worth more than the top.`
          : `${them} can take your top on ${cell} with ${take}, and the computer finds no better way to deal with that.`;
    } else {
      const follow = best.pv.slice(sacrifice.loss + 1, sacrifice.payoff + 1);
      const won = endOf(state, best.pv.slice(0, sacrifice.payoff + 1)).winner === me;
      const gain = won ? 'and reach the goal' : `and capture on ${cellName(best.pv[sacrifice.payoff]!.top!.captured)}`;
      text = `${intro}: if ${them} takes it with ${take}, ${narrate(follow, me)} ${gain}.`;
    }
    add('sacrifice', text);
  } else if (offered.length > 0) {
    add('offer', `Your top on ${cellList(offered)} can now be captured, but the computer finds that taking it does not pay off for ${them}.`);
  }
  const saved = openBefore.filter((c) => !openAfter.includes(movedTo(c)));
  if (saved.length > 0) {
    const moved = saved.length === 1 && movedTo(saved[0]!) !== saved[0];
    add('saves', moved ? `Takes your top on ${cellName(saved[0]!)} out of ${them}'s reach.` : `Protects your top on ${cellList(saved)} from capture.`);
  }

  // Your own threats, and how the base step serves the top step.
  const threats = goalThreats(after, me);
  if (threats.length > 0) {
    add('threat', `Threatens to reach the goal on ${cellList(threats)} next turn, so ${them} has to respond.`);
  }
  if (turn.base && !turn.base.swap && turn.top && topPath(turn.top, me).includes(turn.base.to)) {
    const at = cellName(turn.base.to);
    add(
      'bridge',
      turn.top.captured !== NONE && turn.top.to === turn.base.to
        ? `The base step to ${at} puts a base where your top lands after the jump.`
        : `The base step to ${at} builds part of the bridge your top sprints over.`,
    );
  }

  // Positional: compare where the hint's line and the next-best line lead. Lines searched to
  // different depths are compared at the shallower one.
  const gapTo = (l: Line) => Math.max(0, (best.scores[l.depth - 1] ?? best.score) - l.score);
  // A runner-up searched less deeply may only look close because it was not searched as far.
  const close = (l: Line) => l.depth === best.depth && best.score - l.score < CLOSE_GAP;
  const bestEnd = termsFor(endOf(state, best.pv), me);
  const tactical = reasons.length > 0;
  if (runnerUp && !isMateScore(runnerUp.score)) {
    const term = gapTo(runnerUp) < CLOSE_GAP ? null : largestGain(termsFor(endOf(state, runnerUp.pv), me), bestEnd);
    if (term && !(term === 'material' && reasons.some((r) => r.kind === 'capture'))) {
      add('positional', `Compared with ${turnToString(runnerUp.turn)}, the next-best move, it ${TERM_PHRASES[term]} a few turns from now.`);
    }
  }
  if (!tactical && !reasons.some((r) => r.kind === 'positional')) {
    const term = largestGain(termsFor(state, me), bestEnd);
    if (term) add('plan', `The idea: over the next few turns, this ${PLAN_PHRASES[term]}.`);
  }
  if (runnerUp && !isMateScore(runnerUp.score) && close(runnerUp)) {
    add('close', `${turnToString(runnerUp.turn)} is about as good; there is little to choose between them.`);
  }

  // Why not the natural-looking alternative.
  if (alternative) {
    const alt = turnToString(alternative.turn);
    const gap = gapTo(alternative);
    const reply = alternative.pv[1];
    let why: string | null = null;
    if (isMateScore(alternative.score) && alternative.score < 0) {
      why = `${them} then wins in ${plural(turnsToLose(alternative.score), 'turn')}: ${narrate(alternative.pv.slice(1), opp)}`;
    } else if (gap >= NOTABLE_GAP && reply?.top && reply.top.captured !== NONE) {
      why = `${them} answers ${turnToString(reply)}, capturing your top on ${cellName(reply.top.captured)}`;
    } else if (gap >= CLEAR_GAP) {
      why = 'it leaves you clearly worse off';
    } else if (gap >= NOTABLE_GAP) {
      why = 'it is somewhat weaker';
    }
    if (why) {
      const lead = {
        'chosen-base': `With the base step you chose, your best is ${alt}, but`,
        capture: `Capturing with ${alt} looks tempting, but`,
        safe: `Keeping every top out of reach with ${alt} looks safer, but`,
      }[alternative.kind];
      add('alternative', capitalise(`${lead} ${why}.`));
    } else if (alternative.kind === 'chosen-base') {
      add('alternative', `With the base step you chose, ${alt} is nearly as good.`);
    }
  }

  return hint();
}
