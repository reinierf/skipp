// Compares search configurations at a fixed depth on the benchmark positions.
// Usage: npx tsx src/analysis/search-compare.ts [--depth D] [--per-phase N]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromKey } from '../engine';
import { search, type SearchOptions } from '../search/alphabeta';
import { mulberry32 } from '../util/rng';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const DEPTH = Number(args.get('depth') ?? 6);
const PER_PHASE = Number(args.get('per-phase') ?? 10);
const PHASES: [number, number][] = [[0, 9], [10, 19], [20, 29], [30, 39], [40, Infinity]];

// Same selection as search-bench.ts.
const all: { key: string; ply: number; turns: number }[] = JSON.parse(readFileSync(join('data', 'positions.json'), 'utf8'));
const rand = mulberry32(42);
const keys: string[] = [];
for (const [lo, hi] of PHASES) {
  const pool = all.filter((s) => s.ply >= lo && s.ply <= hi && s.turns > 1);
  for (let i = 0; i < PER_PHASE && pool.length > 0; i++) keys.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!.key);
}

const configs: [string, Partial<SearchOptions>][] = [
  ['basic ordering', { tt: false, heuristics: false }],
  ['+ killers/history', { tt: false, heuristics: true }],
  ['+ transposition table', { heuristics: true }],
];

const rows: string[] = [];
let baseline = 0;
for (const [name, opts] of configs) {
  let nodes = 0;
  let ms = 0;
  for (const key of keys) {
    const r = search(fromKey(key), { maxDepth: DEPTH, ...opts });
    nodes += r.nodes;
    ms += r.timeMs;
  }
  if (!baseline) baseline = nodes;
  rows.push(`| ${name} | ${Math.round(nodes / 1000)}k | ${Math.round((100 * nodes) / baseline)}% | ${(ms / 1000).toFixed(1)} s | ${Math.round(nodes / ms)}k |`);
  process.stderr.write(`${name} done\n`);
}

console.log(`Depth ${DEPTH} iterative deepening, ${keys.length} positions, totals over all positions.\n`);
console.log('| configuration | nodes | vs basic | time | nodes/s |\n|---|---|---|---|---|\n' + rows.join('\n'));
