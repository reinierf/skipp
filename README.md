# Skipp

Rules engine and computer opponent for the board game [Skipp](https://www.skipp.game/skipp-game-rules.html)
(Original board), written in TypeScript so it can later run in a web game.

- [RULES.md](RULES.md) — the rules specification the engine implements.
- [FINDINGS.md](FINDINGS.md) — results of the AI analysis spike (branching factor, search depth, tournaments).
- [HANDOVER.md](HANDOVER.md) — the original brief.

## Web game

```sh
npm run dev       # play locally at http://localhost:5173
npm run build     # static site in dist/, deployable to any static host
```

Play against the computer (Easy: depth 2, Medium: depth 4, Hard: 1 s per move, Expert: 3 s per
move, searched in a Web Worker) or two players on one device. A turn is entered by clicking a
base to move, then a top, then its destination.

The hint button suggests a turn, drawn as arrows, and says why it is good. The reasons come from
[src/hints](src/hints): a 2-second search finds the turn, its expected line of play, the next-best
turn and one natural-looking alternative (the base step the player already chose, a tempting
capture, or the safe move). Tactical reasons are read along the expected line, so a sacrifice is
explained by how it pays off; positional reasons compare the evaluation terms where the hint's
line and the next-best line lead.

### Deployment

Every push to `main` deploys the game to GitHub Pages at <https://reinierf.github.io/skipp/>
via [.github/workflows/pages.yml](.github/workflows/pages.yml): it runs `npm ci` and
`npm run build`, then publishes `dist/`. The workflow does not run the tests or the typecheck,
so run those before pushing. To redeploy without a new commit, run the workflow by hand from the
Actions tab ("Run workflow").

One-time setup: in the repository's Settings → Pages, set Source to "GitHub Actions". The Vite
`base` is `./` (relative asset paths), so the build works under the `/skipp/` subpath without
further configuration.

## Layout

| Path | Contents |
|---|---|
| `app` | Vite web game: SVG board, click-to-move input (`input.ts`), AI worker |
| `src/engine` | Board geometry, positions, legal complete turns, win/draw detection, notation; `fast.ts` has the allocation-free turn generation and make/unmake used by the search |
| `src/search` | Evaluation, alpha-beta with iterative deepening and transposition table, weight presets |
| `src/hints` | Hint analysis (`analyse`) and the rules that turn it into reasons (`explain`) |
| `src/agents` | Random, greedy and search agents; `makeAgent(spec)` builds one from a string |
| `src/analysis` | Analysis scripts that write their reports to `data/` |
| `test` | Vitest tests: rules, tactics, alpha-beta correctness, random self-play invariants |

## Commands

```sh
npm install
npm test                 # all tests
npm run typecheck

npm run branching -- --games 2000                                  # data/branching.md, positions.json
npm run branching -- --policies ab4 --games 200 --opening-plies 2 --out data/branching-ab4
npm run bench -- --positions data/branching-ab4/positions.json --out data/branching-ab4/search-bench.md
npm run compare -- --depth 6                                       # search configurations side by side
npm run profile                                                    # fixed search workload; node count must not change for pure speed-ups
npm run tournament -- --agents random,greedy,ab2,ab4 --openings 20 # data/tournament.md
```

Agent specs: `random`, `greedy`, `ab<depth>`, `t<ms>`. Add `:<preset>` to pick evaluation
weights from `src/search/presets.ts`, e.g. `ab4:v1`.
