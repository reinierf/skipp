// Runs the alpha-beta search off the main thread so the page stays responsive: the computer's
// moves, and hints for the player.

import { encodeTurn, fromKey, type BaseMove } from '../../src/engine';
import { analyse, explain, type Reason } from '../../src/hints';
import { search, type SearchOptions } from '../../src/search/alphabeta';
import { TranspositionTable } from '../../src/search/tt';

export type Level = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiRequest {
  kind: 'move';
  id: number;
  key: string;
  /** Turns played so far; the key does not record it. */
  ply: number;
  level: Level;
}

export interface AiResponse {
  kind: 'move';
  id: number;
  code: number;
  depth: number;
  score: number;
}

export interface HintRequest {
  kind: 'hint';
  id: number;
  key: string;
  /** The base step the player has already selected, if any. */
  chosenBase?: BaseMove | null;
}

export interface HintResponse {
  kind: 'hint';
  id: number;
  /** The suggested turn, or null if there is none. */
  code: number | null;
  depth: number;
  reasons: Reason[];
}

/** Time for the searches behind one hint. */
const HINT_MS = 2000;

const LEVELS: Record<Level, Omit<SearchOptions, 'tt'>> = {
  easy: { maxDepth: 2 },
  medium: { maxDepth: 4 },
  hard: { maxDepth: 64, timeMs: 1000 },
  expert: { maxDepth: 64, timeMs: 3000 },
};

// Opening variety: in the first plies, play any turn scoring within this margin of the best
// (a top is worth 100). Later, only exact ties are broken at random.
const OPENING_PLIES = 6;
const OPENING_MARGIN: Record<Level, number> = { easy: 60, medium: 30, hard: 15, expert: 10 };

// Kept between moves: positions searched last turn are often reached again.
const tt = new TranspositionTable(19);
type Response = AiResponse | HintResponse;
const post = (m: Response) => (globalThis as unknown as { postMessage(m: Response): void }).postMessage(m);

addEventListener('message', (e: Event) => {
  const req = (e as MessageEvent<AiRequest | HintRequest>).data;
  const state = fromKey(req.key);
  if (req.kind === 'hint') {
    const a = analyse(state, { timeMs: HINT_MS, tt, chosenBase: req.chosenBase });
    const hint = a && explain(state, a);
    post({ kind: 'hint', id: req.id, code: hint ? encodeTurn(hint.turn) : null, depth: hint?.depth ?? 0, reasons: hint?.reasons ?? [] });
    return;
  }
  const margin = req.ply < OPENING_PLIES ? OPENING_MARGIN[req.level] : 0;
  const r = search(state, { ...LEVELS[req.level], tt, random: { margin } });
  if (r.best) post({ kind: 'move', id: req.id, code: encodeTurn(r.best), depth: r.depth, score: r.score });
});
