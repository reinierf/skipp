import { WEIGHT_PRESETS } from '../search/presets';
import { TranspositionTable } from '../search/tt';
import { mulberry32 } from '../util/rng';
import { searchAgent } from './search';
import { greedyAgent, randomAgent, type Agent } from './simple';

/**
 * Builds an agent from a spec: random | greedy | ab<depth> | t<ms> (iterative deepening on a
 * time budget), optionally followed by :<weights preset> from WEIGHT_PRESETS, e.g. ab4:noMobility.
 */
export function makeAgent(spec: string, seed: number): Agent {
  const [kind, preset] = spec.split(':');
  const weights = preset ? WEIGHT_PRESETS[preset] : undefined;
  if (preset && !weights) throw new Error(`Unknown weights preset: ${preset}`);
  const rand = mulberry32(seed);
  if (kind === 'random') return randomAgent(rand);
  if (kind === 'greedy') return greedyAgent(rand);
  const tt = new TranspositionTable();
  let m = /^ab(\d+)$/.exec(kind!);
  if (m) return searchAgent({ maxDepth: Number(m[1]), tt, weights });
  m = /^t(\d+)$/.exec(kind!);
  if (m) return searchAgent({ maxDepth: 64, timeMs: Number(m[1]), tt, weights });
  throw new Error(`Unknown agent: ${spec}`);
}
