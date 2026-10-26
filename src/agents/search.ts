import { search, type SearchOptions } from '../search/alphabeta';
import type { Agent } from './simple';

export function searchAgent(opts: SearchOptions): Agent {
  return (state, turns) => search(state, opts).best ?? turns[0]!;
}
