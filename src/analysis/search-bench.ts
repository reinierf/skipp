// Alpha-beta search benchmark (HANDOVER step 4).
// Usage: npx tsx src/analysis/search-bench.ts [--positions FILE] [--per-phase N] [--max-depth D] [--cap-ms MS]
//        [--perft-depth P] [--out FILE]
// Positions come from a positions.json written by npm run branching (default data/positions.json).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromKey } from '../engine';
import { perft, search, type DepthReport } from '../search/alphabeta';
import { mulberry32 } from '../util/rng';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const PER_PHASE = Number(args.get('per-phase') ?? 10);
const MAX_DEPTH = Number(args.get('max-depth') ?? 10);
const CAP_MS = Number(args.get('cap-ms') ?? 20000);
const PERFT_DEPTH = Number(args.get('perft-depth') ?? 4);
const POSITIONS = args.get('positions') ?? join('data', 'positions.json');
const OUT = args.get('out') ?? join('data', 'search-bench.md');
const BUDGETS_MS = [100, 1000, 5000];
const PHASES: [string, number, number][] = [
  ['0-9', 0, 9],
  ['10-19', 10, 19],
  ['20-29', 20, 29],
  ['30-39', 30, 39],
  ['40+', 40, Infinity],
];

interface Sample {
  key: string;
  policy: string;
  ply: number;
  turns: number;
}

const all: Sample[] = JSON.parse(readFileSync(POSITIONS, 'utf8'));
const rand = mulberry32(42);
const chosen: { phase: string; sample: Sample }[] = [];
for (const [phase, lo, hi] of PHASES) {
  const pool = all.filter((s) => s.ply >= lo && s.ply <= hi && s.turns > 1);
  for (let i = 0; i < PER_PHASE && pool.length > 0; i++) {
    chosen.push({ phase, sample: pool.splice(Math.floor(rand() * pool.length), 1)[0]! });
  }
}

interface Row {
  phase: string;
  turns: number;
  iterations: DepthReport[];
  /** Full-width minimax node counts per depth (sum of perft over plies 0..d). */
  minimaxNodes: number[];
}

const rows: Row[] = [];
const t0 = performance.now();
for (const [i, { phase, sample }] of chosen.entries()) {
  const state = fromKey(sample.key);
  const r = search(state, { maxDepth: MAX_DEPTH, timeMs: CAP_MS });
  const minimaxNodes: number[] = [];
  let cumulative = 0;
  for (let d = 0; d <= PERFT_DEPTH; d++) {
    cumulative += perft(state, d);
    if (d > 0) minimaxNodes.push(cumulative);
  }
  rows.push({ phase, turns: sample.turns, iterations: r.iterations, minimaxNodes });
  process.stderr.write(`\r${i + 1}/${chosen.length} positions (depth ${r.depth})   `);
}
process.stderr.write('\n');
const elapsed = (performance.now() - t0) / 1000;

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const geomean = (v: number[]) => 10 ** mean(v.map(Math.log10));
const fmt = (n: number) => (n >= 1e6 ? `${round(n / 1e6)}M` : n >= 1e3 ? `${round(n / 1e3)}k` : `${round(n)}`);
const table = (header: string[], body: (string | number)[][]) =>
  [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const depthRows: (string | number)[][] = [];
for (let d = 1; d <= MAX_DEPTH; d++) {
  const at = rows.map((r) => r.iterations.find((it) => it.depth === d)).filter((x) => x !== undefined);
  // Positions where the search ended early on a forced win/loss count as solved, not timed out.
  const solved = rows.filter((r) => r.iterations.length > 0 && r.iterations.length < d && Math.abs(r.iterations.at(-1)!.score) >= 999_000).length;
  if (at.length === 0) break;
  const ebf = rows
    .map((r) => {
      const cur = r.iterations.find((it) => it.depth === d);
      const prev = r.iterations.find((it) => it.depth === d - 1);
      return cur && prev && prev.nodes > 0 ? cur.nodes / prev.nodes : undefined;
    })
    .filter((x) => x !== undefined);
  const pruning = rows
    .map((r) => {
      const cur = r.iterations.find((it) => it.depth === d);
      const full = r.minimaxNodes[d - 1];
      return cur && full ? cur.nodes / full : undefined;
    })
    .filter((x) => x !== undefined);
  depthRows.push([
    d,
    `${at.length}/${rows.length - solved}`,
    fmt(mean(at.map((x) => x.nodes))),
    fmt(median(at.map((x) => x.nodes))),
    fmt(Math.max(...at.map((x) => x.nodes))),
    round(mean(at.map((x) => x.timeMs))),
    round(median(at.map((x) => x.timeMs))),
    round(Math.max(...at.map((x) => x.timeMs))),
    ebf.length ? round(geomean(ebf), 2) : '',
    pruning.length ? `${round(100 * geomean(pruning), 2)}%` : '',
    solved,
  ]);
}

// Deepest completed iteration whose cumulative time fits each budget. A position proven
// won or lost within the budget counts as reaching MAX_DEPTH.
function depthWithin(r: Row, budget: number): number {
  let total = 0;
  let depth = 0;
  for (const it of r.iterations) {
    total += it.timeMs;
    if (total > budget) break;
    depth = Math.abs(it.score) >= 999_000 ? MAX_DEPTH : it.depth;
  }
  return depth;
}

const phaseRows = PHASES.map(([phase]) => {
  const rs = rows.filter((r) => r.phase === phase);
  return [phase, rs.length, round(mean(rs.map((r) => r.turns))), ...BUDGETS_MS.map((b) => `${median(rs.map((r) => depthWithin(r, b)))} (min ${Math.min(...rs.map((r) => depthWithin(r, b)))})`)];
});

const nps = mean(rows.flatMap((r) => r.iterations.filter((it) => it.timeMs > 50).map((it) => (it.nodes / it.timeMs) * 1000)));

const md = [
  '# Alpha-beta search benchmark (Original board)',
  '',
  `Generated by \`src/analysis/search-bench.ts\`: ${rows.length} positions from ${POSITIONS} (${PER_PHASE} per game phase), ` +
    `iterative deepening to depth ${MAX_DEPTH} with a ${CAP_MS / 1000}s cap per position, in ${round(elapsed)}s.`,
  'Depth is in plies; one ply is one complete turn (base step + top step).',
  'Search: negamax alpha-beta, iterative deepening, transposition table, ordering: TT move > captures > killers > history + advancement.',
  'Evaluation: tops, squared advancement, immediate goal threats, top and base mobility.',
  '',
  `Search speed: ${fmt(nps)} nodes/s.`,
  '',
  '## By depth',
  '',
  'Nodes and times are for that iteration alone. EBF is the geometric mean of nodes(d) / nodes(d-1).',
  `Pruning is alpha-beta nodes as a share of full minimax nodes (computed up to depth ${PERFT_DEPTH}).`,
  '"Solved" counts positions where a forced win or loss was proven at a shallower depth.',
  '',
  table(['depth', 'completed', 'mean nodes', 'median nodes', 'max nodes', 'mean ms', 'median ms', 'max ms', 'EBF', 'pruning', 'solved'], depthRows),
  '',
  '## Depth reached within a time budget',
  '',
  'Median (and minimum) completed depth per position, from cumulative iteration times. Positions proven won or lost count as the maximum depth.',
  '',
  table(['plies', 'positions', 'mean turns', ...BUDGETS_MS.map((b) => `${b} ms`)], phaseRows),
  '',
].join('\n');

writeFileSync(OUT, md);
console.log(md);
