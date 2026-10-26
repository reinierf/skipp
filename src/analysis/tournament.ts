// Round-robin agent tournament (HANDOVER step 6).
// Usage: npx tsx src/analysis/tournament.ts [--agents random,greedy,ab2,ab4] [--openings N]
//        [--opening-plies K] [--workers W] [--seed S] [--out FILE]
//
// Agent specs: see makeAgent in src/agents/factory.ts.
// Every pairing plays each opening twice with colours swapped. Openings are K random plies
// from the start position, so deterministic agents still play varied games.

import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeAgent } from '../agents/factory';
import { fromKey, legalTurns, play, result, startState, toKey, type GameState } from '../engine';
import { mulberry32, pick } from '../util/rng';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);

interface Job {
  id: number;
  orange: string;
  blue: string;
  opening: string;
}

interface GameResult {
  id: number;
  orange: string;
  blue: string;
  result: 'orange' | 'blue' | 'draw';
  plies: number;
  /** Total thinking time and number of decisions per side. */
  ms: [number, number];
  moves: [number, number];
}

function playGame(job: Job): GameResult {
  const agents = [makeAgent(job.orange, job.id * 2 + 1), makeAgent(job.blue, job.id * 2 + 2)];
  const out: GameResult = { id: job.id, orange: job.orange, blue: job.blue, result: 'draw', plies: 0, ms: [0, 0], moves: [0, 0] };
  let s: GameState = fromKey(job.opening);
  while (result(s) === 'ongoing') {
    const turns = legalTurns(s);
    const side = s.toMove;
    const t0 = performance.now();
    const turn = turns.length === 1 ? turns[0]! : agents[side]!(s, turns);
    out.ms[side] += performance.now() - t0;
    out.moves[side]++;
    s = play(s, turn);
  }
  out.result = result(s) as GameResult['result'];
  out.plies = s.ply;
  return out;
}

// ---------------------------------------------------------------- worker

if (process.argv.includes('--worker')) {
  process.on('message', (job: Job | 'stop') => {
    if (job === 'stop') process.exit(0);
    process.send!(playGame(job));
  });
} else {
  await main();
}

// ---------------------------------------------------------------- main

function openings(n: number, plies: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const seen = new Set<string>();
  while (seen.size < n) {
    let s = startState();
    for (let i = 0; i < plies && result(s) === 'ongoing'; i++) s = play(s, pick(legalTurns(s), rand));
    if (result(s) === 'ongoing') seen.add(toKey(s));
  }
  return [...seen];
}

async function main(): Promise<void> {
  const agents = (args.get('agents') ?? 'random,greedy,ab2,ab4,ab6').split(',');
  const nOpenings = Number(args.get('openings') ?? 20);
  const openingPlies = Number(args.get('opening-plies') ?? 2);
  const workers = Number(args.get('workers') ?? Math.max(1, cpus().length - 1));
  const seed = Number(args.get('seed') ?? 1);
  const outFile = args.get('out') ?? 'data/tournament.md';

  const jobs: Job[] = [];
  const ops = openings(nOpenings, openingPlies, seed);
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      for (const opening of ops) {
        jobs.push({ id: jobs.length, orange: agents[i]!, blue: agents[j]!, opening });
        jobs.push({ id: jobs.length, orange: agents[j]!, blue: agents[i]!, opening });
      }
    }
  }

  const t0 = performance.now();
  const results: GameResult[] = [];
  const script = fileURLToPath(import.meta.url);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, () => {
      const child = fork(script, ['--worker'], { execArgv: process.execArgv });
      return new Promise<void>((resolve, reject) => {
        const feed = () => child.send(next < jobs.length ? jobs[next++]! : 'stop');
        child.on('message', (r: GameResult) => {
          results.push(r);
          process.stderr.write(`\r${results.length}/${jobs.length} games`);
          feed();
        });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
        feed();
      });
    }),
  );
  process.stderr.write('\n');
  const elapsed = (performance.now() - t0) / 1000;

  writeFileSync(outFile, report(agents, results, { nOpenings, openingPlies, seed, elapsed }));
  writeFileSync(outFile.replace(/\.md$/, '.json'), JSON.stringify(results));
  console.log(report(agents, results, { nOpenings, openingPlies, seed, elapsed }));
}

// ---------------------------------------------------------------- report

function report(agents: string[], results: GameResult[], meta: { nOpenings: number; openingPlies: number; seed: number; elapsed: number }): string {
  const idx = new Map(agents.map((a, i) => [a, i]));
  const n = agents.length;
  // points[i][j]: points agent i scored against agent j; games[i][j]: games played.
  const points = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const games = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const wdl = Array.from({ length: n }, () => [0, 0, 0]);
  const ms = new Array<number>(n).fill(0);
  const moves = new Array<number>(n).fill(0);
  const firstMover = { orange: 0, blue: 0, draw: 0 };
  let plies = 0;
  for (const r of results) {
    const o = idx.get(r.orange)!;
    const b = idx.get(r.blue)!;
    const po = r.result === 'orange' ? 1 : r.result === 'draw' ? 0.5 : 0;
    points[o]![b]! += po;
    points[b]![o]! += 1 - po;
    games[o]![b]!++;
    games[b]![o]!++;
    wdl[o]![po === 1 ? 0 : po === 0.5 ? 1 : 2]!++;
    wdl[b]![po === 0 ? 0 : po === 0.5 ? 1 : 2]!++;
    ms[o]! += r.ms[0];
    ms[b]! += r.ms[1];
    moves[o]! += r.moves[0];
    moves[b]! += r.moves[1];
    firstMover[r.result]++;
    plies += r.plies;
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const elo = (s: number) => (s <= 0 ? '-∞' : s >= 1 ? '+∞' : `${Math.round(-400 * Math.log10(1 / s - 1))}`);
  const order = [...agents.keys()].sort(
    (a, b) => points[b]!.reduce((x, y) => x + y, 0) / games[b]!.reduce((x, y) => x + y, 0) - points[a]!.reduce((x, y) => x + y, 0) / games[a]!.reduce((x, y) => x + y, 0),
  );

  const standings = order.map((i) => {
    const p = points[i]!.reduce((x, y) => x + y, 0);
    const g = games[i]!.reduce((x, y) => x + y, 0);
    const [w, d, l] = wdl[i]!;
    return `| ${agents[i]} | ${g} | ${w}-${d}-${l} | ${pct(p / g)} | ${(ms[i]! / Math.max(1, moves[i]!)).toFixed(1)} |`;
  });
  const cross = order.map(
    (i) => `| **${agents[i]}** | ` + order.map((j) => (i === j ? '—' : `${pct(points[i]![j]! / games[i]![j]!)} (${elo(points[i]![j]! / games[i]![j]!)})`)).join(' | ') + ' |',
  );

  return [
    '# Agent tournament (Original board)',
    '',
    `Generated by \`src/analysis/tournament.ts\`: round robin, ${meta.nOpenings} openings of ${meta.openingPlies} random plies, ` +
      `each played with both colour assignments (${results.length} games, seed ${meta.seed}, ${Math.round(meta.elapsed)}s).`,
    'Agents: `random`, `greedy` (wins if possible, avoids allowing an immediate win, prefers captures), ' +
      '`abN` (alpha-beta to depth N plies), `tMS` (alpha-beta with MS milliseconds per move); `:preset` selects evaluation weights.',
    '',
    '## Standings',
    '',
    '| agent | games | W-D-L | score | ms/move |',
    '|---|---|---|---|---|',
    ...standings,
    '',
    '## Crosstable',
    '',
    'Row agent’s score against column agent, with the implied Elo difference.',
    '',
    `| | ${order.map((i) => agents[i]).join(' | ')} |`,
    `|---|${order.map(() => '---').join('|')}|`,
    ...cross,
    '',
    `Colour: Orange (moves first) won ${pct(firstMover.orange / results.length)}, Blue ${pct(firstMover.blue / results.length)}, ` +
      `draws ${pct(firstMover.draw / results.length)}. Mean game length ${(plies / results.length).toFixed(1)} plies.`,
    '',
  ].join('\n');
}
