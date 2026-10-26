# Skipp AI opponent — analysis spike findings

Original board only. All measurements are single-threaded Node 22 on a laptop (i7-11370H). Absolute
timings vary by about ±20% between runs with the machine's thermal state. Tournament Elo
differences come from 40–60 games per pairing, so treat differences under about 80 Elo as noise.

## Decision

**Ordinary alpha-beta search is sufficient.** MCTS or learned approaches are not warranted at this stage.

- The game is small for search: about 50 plies per game, and about 29 complete turns per position
  in strong play.
- Alpha-beta reaches depth 6–9 in one second in most positions, and solves many endgames outright.
- Playing strength still rises steeply with depth: about +200 to +500 Elo for every 2 extra plies,
  with no sign of levelling off at depth 8.
- The evaluation is far from saturated. One weight change (base mobility) gained about 150 Elo at
  depth 6. Evaluation work and search speed are both productive next steps.

## Success criteria

| Criterion | Deliverable |
|---|---|
| Verified rules specification | [RULES.md](RULES.md), implemented in [src/engine](src/engine) with a test per rule ([test/rules.test.ts](test/rules.test.ts)) |
| Representative positions | [data/positions.json](data/positions.json) (random and greedy play); [data/branching-ab4/positions.json](data/branching-ab4/positions.json) and [data/branching-ab6/positions.json](data/branching-ab6/positions.json) (search-agent play); tactical positions in [test/search.test.ts](test/search.test.ts) |
| Branching-factor statistics | [data/branching.md](data/branching.md), [data/branching-ab4/branching.md](data/branching-ab4/branching.md), [data/branching-ab6/branching.md](data/branching-ab6/branching.md) |
| Alpha-beta benchmark | [data/search-bench.md](data/search-bench.md) (random-play positions), [data/branching-ab4/search-bench.md](data/branching-ab4/search-bench.md) (strong-play positions) |
| Baseline agent and reproducible tournaments | [src/agents](src/agents); [data/tournament.md](data/tournament.md) and the `data/tournament-*.md` ablations, all seeded |

## Research questions

### How large is the complete-turn branching factor?

| Play style | mean | median | p90 | max | geometric mean | game length (plies) |
|---|---|---|---|---|---|---|
| random | 18.3 | 13 | 43 | 84 | 11.3 | 50 |
| greedy | 18.9 | 14 | 44 | 109 | 12.0 | 52 |
| alpha-beta depth 4 | 29.7 | 28 | 55 | 110 | 21.5 | 49 |
| alpha-beta depth 6 | 28.5 | 27 | 53 | 106 | 20.6 | 51 |

The start position has 70 complete turns. In strong play the count falls through the game:
about 52 in plies 0–9, 40 in plies 10–19, 26 in plies 20–29, then 12–16. Bases only move
forward, so they jam up and options shrink. Random play jams the board much faster than strong play,
so **benchmark on positions from strong play**: random positions understate search cost by
roughly 3–10× in the middlegame. The game tree holds about 10^65 games in strong play.

### How many complete turns can be searched within a practical time budget?

Search speed is about 550k nodes per second. Completed depth (median, with minimum in brackets) on
positions from strong play:

| Game phase (plies) | turns per position | 100 ms | 1 s | 5 s |
|---|---|---|---|---|
| 0–9 | 47 | 5 (4) | 6 (6) | 7 (7) |
| 10–19 | 40 | 5 (4) | 6 (6) | 7 (7) |
| 20–29 | 25 | 6 (4) | 8 (6) | 9 (7) |
| 30–39 | 16 | 7 (5) | 9 (7) | 12 (8) |
| 40+ | 8 | 12 (6) | 12 (8) | 12 (9) |

A transposition table plus killer and history move ordering cut nodes at depth 6 to 27% of the
basic alpha-beta search (3.3× faster). Leaner evaluation code and lazy move ordering added another
1.4×. At depth 4, alpha-beta visits about 1–3% of the nodes full minimax would.

### How important are base movements as enablers of future top movement?

**Very important, and more than top mobility.** In depth-4 ablations with the v1 weights
([data/tournament-mobility.md](data/tournament-mobility.md)), removing the base-mobility term cost
about as much as removing all mobility. Removing the top-mobility term made no clear difference.
Raising the base-mobility weight from 2 to 12 gained +95 Elo at depth 4
([data/tournament-basemob.md](data/tournament-basemob.md)) and +154 Elo at depth 6
([data/tournament-basemob-d6.md](data/tournament-basemob-d6.md)), so 12 is now the default.

The base step is mandatory, which is a likely explanation. Keeping your own bases free to move
keeps future sprint paths open and avoids being forced into weakening base moves.

### Can the game enter repeated or non-terminating positions?

**No.** Every base move and top move goes strictly forward, so no position can repeat. A single pass
leaves the opponent still moving forward, and a mutual pass ends the game as a draw (RULES.md). The
longest game observed in about 4,500 games was 91 plies. Draws are rare: 1–8% depending on the
agents.

### Does deeper search improve strength, or is evaluation the main limitation?

Both matter, and depth matters a lot ([data/tournament.md](data/tournament.md), v1 weights,
40 games per pairing):

| Pairing | Score | Elo difference |
|---|---|---|
| ab8 vs ab6 | 76% | +203 |
| ab6 vs ab4 | 85% | +301 |
| ab4 vs ab2 | 95% | +512 |
| ab2 vs greedy | 91% | +407 |
| greedy vs random | 85% | +301 |

Evaluation ablations at depth 4 ([data/tournament-eval.md](data/tournament-eval.md)) against the
full v1 evaluation:

| Removed term | Elo cost |
|---|---|
| everything except material | about −380 |
| mobility | about −130 (almost all of it base mobility) |
| advancement | about −60 |
| immediate goal threats | about −35 (search already sees most threats) |

Doubling advancement or mobility made no measurable difference. A single re-weighted term still
gained 150 Elo, so systematic tuning is likely to find more.

### Other observations

- **Colour:** no consistent first-move advantage. Orange won between 42% and 57% across
  tournaments, and the higher figures come from small samples.
- **Captures** happen 3–5 times per game.
- **Base-only and top-only turns** together are 4–9% of turns, and passes about 1%.

## Recommended next steps

1. **Web game.** The engine and search are TypeScript with no dependencies, so they run in the
   browser unchanged. Run the search in a Web Worker with a time budget (`t<ms>` agents).
   Possible difficulty levels: easy `greedy` or `ab2`, medium `ab4`, hard `t1000`, expert `t3000`.
2. **Evaluation tuning.** Automate weight tuning with self-play (SPSA or simple local search using
   the tournament runner), then try new features: blocked or jammed bases, sprint-route
   accessibility to goal cells, and contested goal cells.
3. **Search speed.** Make/unmake moves instead of copying positions, and generate turns without
   allocating. This could give about 1.5–2× more speed, worth about half a ply. Principal-variation
   search and aspiration windows are further small gains.

## Reproducing

See [README.md](README.md) for the commands. Every analysis is seeded, so re-running a command
reproduces the move choices and results; only the timings vary.
