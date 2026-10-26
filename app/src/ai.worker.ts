// Runs the alpha-beta search off the main thread so the page stays responsive.

import { encodeTurn, fromKey } from '../../src/engine';
import { search, type SearchOptions } from '../../src/search/alphabeta';
import { TranspositionTable } from '../../src/search/tt';

export type Level = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiRequest {
  id: number;
  key: string;
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

// Kept between moves: positions searched last turn are often reached again.
const tt = new TranspositionTable(19);
const post = (m: AiResponse) => (globalThis as unknown as { postMessage(m: AiResponse): void }).postMessage(m);

addEventListener('message', (e: Event) => {
  const req = (e as MessageEvent<AiRequest>).data;
  const r = search(fromKey(req.key), { ...LEVELS[req.level], tt });
  if (r.best) post({ id: req.id, code: encodeTurn(r.best), depth: r.depth, score: r.score });
});
