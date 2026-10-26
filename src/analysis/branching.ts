// Self-play branching-factor analysis (HANDOVER step 2).
// Usage: npx tsx src/analysis/branching.ts [--games N] [--policies random,greedy] [--opening-plies K] [--seed S] [--out DIR]
// Policies are agent specs (see src/agents/factory.ts) playing both sides. The first K plies of
// each game are random, so deterministic search agents still produce varied games.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeAgent } from '../agents/factory';
import { NONE, baseMoves, fromKey, legalTurns, play, result, startState, toKey, topMoves, type Result } from '../engine';
import { mulberry32, pick } from '../util/rng';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const GAMES = Number(args.get('games') ?? 2000);
const SEED = Number(args.get('seed') ?? 1);
const OUT = args.get('out') ?? 'data';
const POLICIES = (args.get('policies') ?? 'random,greedy').split(',');
const OPENING_PLIES = Number(args.get('opening-plies') ?? 0);
const SAMPLE_EVERY = 4;
const SAMPLE_GAMES = 200;
const PHASE_SIZE = 10;

interface PositionRecord {
  ply: number;
  turns: number;
  baseMoves: number;
  topMoves: number;
}

interface GameRecord {
  result: Result;
  plies: number;
  captures: number;
  passes: number;
  baseOnly: number;
  topOnly: number;
  log10Tree: number;
}

interface PolicyStats {
  positions: PositionRecord[];
  games: GameRecord[];
  samples: Map<string, { ply: number; turns: number }>;
}

function runPolicy(spec: string, seed: number): PolicyStats {
  const agent = makeAgent(spec, seed);
  const openingRand = mulberry32(seed + 1000);
  const stats: PolicyStats = { positions: [], games: [], samples: new Map() };
  for (let g = 0; g < GAMES; g++) {
    let s = startState();
    const game: GameRecord = { result: 'ongoing', plies: 0, captures: 0, passes: 0, baseOnly: 0, topOnly: 0, log10Tree: 0 };
    while (result(s) === 'ongoing') {
      const turns = legalTurns(s);
      stats.positions.push({ ply: s.ply, turns: turns.length, baseMoves: baseMoves(s).length, topMoves: topMoves(s).length });
      game.log10Tree += Math.log10(turns.length);
      if (g < SAMPLE_GAMES && s.ply % SAMPLE_EVERY === 0) stats.samples.set(toKey(s), { ply: s.ply, turns: turns.length });
      const turn = s.ply < OPENING_PLIES ? pick(turns, openingRand) : agent(s, turns);
      if (!turn.base && !turn.top) game.passes++;
      else if (!turn.top) game.baseOnly++;
      else if (!turn.base) game.topOnly++;
      if (turn.top && turn.top.captured !== NONE) game.captures++;
      s = play(s, turn);
    }
    game.result = result(s);
    game.plies = s.ply;
    stats.games.push(game);
  }
  return stats;
}

// ---- summary helpers ----

function summary(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, mean: round(mean), min: v[0]!, p10: q(0.1), median: q(0.5), p90: q(0.9), max: v[v.length - 1]! };
}

function histogram(values: number[], width: number): [string, number][] {
  const counts = new Map<number, number>();
  for (const x of values) counts.set(Math.floor(x / width), (counts.get(Math.floor(x / width)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => [`${k * width}-${k * width + width - 1}`, c]);
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (n: number, total: number) => `${round((100 * n) / total)}%`;

function table(header: string[], rows: (string | number)[][]): string {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function report(name: string, st: PolicyStats): { md: string; json: object } {
  const turns = st.positions.map((p) => p.turns);
  const b = summary(turns);
  const base = summary(st.positions.map((p) => p.baseMoves));
  const top = summary(st.positions.map((p) => p.topMoves));
  const len = summary(st.games.map((g) => g.plies));
  const tree = summary(st.games.map((g) => g.log10Tree));
  const geo = 10 ** (st.positions.reduce((a, p) => a + Math.log10(p.turns), 0) / st.positions.length);
  const outcomes = { orange: 0, blue: 0, draw: 0 } as Record<string, number>;
  for (const g of st.games) outcomes[g.result]!++;
  const totalTurns = st.games.reduce((a, g) => a + g.plies, 0);
  const sum = (f: (g: GameRecord) => number) => st.games.reduce((a, g) => a + f(g), 0);

  const phases = new Map<number, number[]>();
  for (const p of st.positions) {
    const k = Math.floor(p.ply / PHASE_SIZE);
    phases.set(k, [...(phases.get(k) ?? []), p.turns]);
  }

  const md = [
    `## Policy: ${name}`,
    '',
    `${GAMES} games, ${st.positions.length} positions.`,
    '',
    '### Complete turns per position',
    '',
    table(['measure', 'mean', 'min', 'p10', 'median', 'p90', 'max'], [
      ['complete turns', b.mean, b.min, b.p10, b.median, b.p90, b.max],
      ['base moves', base.mean, base.min, base.p10, base.median, base.p90, base.max],
      ['top moves (before base step)', top.mean, top.min, top.p10, top.median, top.p90, top.max],
    ]),
    '',
    `Geometric mean of complete turns: ${round(geo)}.`,
    '',
    '### Complete turns by game phase',
    '',
    table(
      ['plies', 'positions', 'mean', 'median', 'p90', 'max'],
      [...phases.entries()]
        .sort((a, c) => a[0] - c[0])
        .map(([k, v]) => {
          const s = summary(v);
          return [`${k * PHASE_SIZE}-${k * PHASE_SIZE + PHASE_SIZE - 1}`, s.n, s.mean, s.median, s.p90, s.max];
        }),
    ),
    '',
    '### Distribution of complete turns',
    '',
    table(['turns', 'positions', 'share'], histogram(turns, 10).map(([k, c]) => [k, c, pct(c, turns.length)])),
    '',
    '### Games',
    '',
    table(['measure', 'mean', 'min', 'p10', 'median', 'p90', 'max'], [
      ['length (plies)', len.mean, len.min, len.p10, len.median, len.p90, len.max],
      ['log10 game-tree size', tree.mean, round(tree.min), round(tree.p10), round(tree.median), round(tree.p90), round(tree.max)],
    ]),
    '',
    `Outcomes: Orange (first) ${pct(outcomes.orange!, GAMES)}, Blue ${pct(outcomes.blue!, GAMES)}, draw ${pct(outcomes.draw!, GAMES)}.`,
    '',
    `Turn types: base+top ${pct(totalTurns - sum((g) => g.baseOnly + g.topOnly + g.passes), totalTurns)}, ` +
      `base only ${pct(sum((g) => g.baseOnly), totalTurns)}, top only ${pct(sum((g) => g.topOnly), totalTurns)}, ` +
      `pass ${pct(sum((g) => g.passes), totalTurns)}. Captures per game: ${round(sum((g) => g.captures) / GAMES)}.`,
    '',
  ].join('\n');

  return { md, json: { policy: name, games: GAMES, positions: st.positions.length, completeTurns: b, geometricMean: round(geo), baseMoves: base, topMoves: top, gameLength: len, log10Tree: tree, outcomes } };
}

function benchmark(keys: string[]): string {
  const states = keys.map(fromKey);
  let generated = 0;
  const t0 = performance.now();
  let rounds = 0;
  while (performance.now() - t0 < 2000) {
    for (const s of states) generated += legalTurns(s).length;
    rounds++;
  }
  const secs = (performance.now() - t0) / 1000;
  return `Move generation: ${round((rounds * states.length) / secs / 1000)}k positions/s, ${round(generated / secs / 1e6, 2)}M complete turns/s (legalTurns, ${states.length} sampled positions).`;
}

const t0 = performance.now();
const policies = POLICIES.map((spec, i) => [spec, runPolicy(spec, SEED + i)] as const);
const elapsed = round((performance.now() - t0) / 1000);

const reports = policies.map(([name, st]) => report(name, st));
const samples: { key: string; policy: string; ply: number; turns: number }[] = [];
for (const [name, st] of policies) for (const [key, v] of st.samples) samples.push({ key, policy: name, ...v });

const md = [
  '# Branching-factor analysis (Original board)',
  '',
  `Generated by \`src/analysis/branching.ts\` with ${GAMES} games per policy, ${OPENING_PLIES} random opening plies, seed ${SEED}, in ${elapsed}s.`,
  'A complete turn is one base step followed by one top step (see RULES.md). Orange moves first.',
  '',
  'Policies (both sides): **random** uniformly random legal turns; **greedy** wins if it can, avoids turns that allow',
  'an immediate opponent win, prefers captures; **abN** alpha-beta search to depth N plies.',
  '',
  benchmark(samples.map((s) => s.key)),
  '',
  ...reports.map((r) => r.md),
].join('\n');

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'branching.md'), md);
writeFileSync(join(OUT, 'branching.json'), JSON.stringify(reports.map((r) => r.json), null, 2));
writeFileSync(join(OUT, 'positions.json'), JSON.stringify(samples));
console.log(md);
console.log(`Wrote ${OUT}/branching.md, ${OUT}/branching.json and ${OUT}/positions.json (${samples.length} positions).`);
