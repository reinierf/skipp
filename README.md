# Skipp

Rules engine and computer opponent for the board game [Skipp](https://www.skipp.game/speluitleg.html)
(Original board), written in TypeScript so it can later run in a web game.

- [RULES.md](RULES.md) — the rules specification the engine implements.
- [FINDINGS.md](FINDINGS.md) — results of the AI analysis spike (branching factor, search depth, tournaments).
- [HANDOVER.md](HANDOVER.md) — the original brief.

## Layout

| Path | Contents |
|---|---|
| `src/engine` | Board geometry, positions, legal complete turns, win/draw detection, notation |
| `src/search` | Evaluation, alpha-beta with iterative deepening and transposition table, weight presets |
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
npm run tournament -- --agents random,greedy,ab2,ab4 --openings 20 # data/tournament.md
```

Agent specs: `random`, `greedy`, `ab<depth>`, `t<ms>`. Add `:<preset>` to pick evaluation
weights from `src/search/presets.ts`, e.g. `ab4:v1`.
