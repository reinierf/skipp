// Runs the alpha-beta search off the main thread so the page stays responsive.

import { encodeTurn, fromKey } from '../../src/engine';
import { search, type SearchOptions } from '../../src/search/alphabeta';
import { TranspositionTable } from '../../src/search/tt';

export type Level = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiRequest {
  id: number;
  key: string;
  /** Turns played so far; the key does not record it. */
  ply: number;
  level: Level;
}

export interface AiResponse {
  id: number;
  code: number;
  depth: number;
  score: number;
}

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
const post = (m: AiResponse) => (globalThis as unknown as { postMessage(m: AiResponse): void }).postMessage(m);

addEventListener('message', (e: Event) => {
  const req = (e as MessageEvent<AiRequest>).data;
  const margin = req.ply < OPENING_PLIES ? OPENING_MARGIN[req.level] : 0;
  const r = search(fromKey(req.key), { ...LEVELS[req.level], tt, random: { margin } });
  if (r.best) post({ id: req.id, code: encodeTurn(r.best), depth: r.depth, score: r.score });
});
