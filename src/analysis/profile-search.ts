// Fixed search workload for timing and profiling engine changes.
// Usage: npx tsx src/analysis/profile-search.ts [--depth D] [--positions N]
// Node count must stay identical across pure speed changes; time should drop.

import { readFileSync } from 'node:fs';
import { fromKey } from '../engine';
import { search } from '../search/alphabeta';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const DEPTH = Number(args.get('depth') ?? 5);
const N = Number(args.get('positions') ?? 30);

const all: { key: string; ply: number }[] = JSON.parse(readFileSync('data/branching-ab4/positions.json', 'utf8'));
const keys = all.filter((s) => s.ply >= 10 && s.ply < 40).slice(0, N).map((s) => s.key);
let nodes = 0;
const t0 = performance.now();
for (const k of keys) nodes += search(fromKey(k), { maxDepth: DEPTH }).nodes;
const ms = performance.now() - t0;
console.log(`depth ${DEPTH}, ${keys.length} positions: ${nodes} nodes, ${Math.round(ms)} ms, ${Math.round(nodes / ms)}k nodes/s`);
