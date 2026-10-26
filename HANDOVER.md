## Skipp AI opponent — practical handover

Objective: Establish the complexity of Skipp and determine how strong a search-based computer opponent can be before committing to a more sophisticated AI approach.

https://www.skipp.game/speluitleg.html

### Recommended baseline

Use complete-turn minimax with alpha-beta pruning.

- Treat a turn as the complete sequence of base movement followed by top movement.
- Evaluate terminal wins and losses explicitly.
- Start with a simple heuristic: goal accessibility, captures, and mobility.
- Consider iterative deepening and transposition tables after establishing baseline performance.
- Do not start with reinforcement learning, neural networks, or MCTS.

### Practical work plan

1. Formalise the game rules.

   Establish board geometry, starting positions, legal moves, turn sequencing, win conditions, and whether repetition or non-terminating games are possible.
2. Analyse the branching factor.

   Collect representative positions from both board configurations. Measure legal base actions, legal top actions after each base action, and total complete turns. Record average, maximum, and distribution.
3. Create tactical test positions.

   Include immediate wins, threats, captures, long sprints, forced responses, blocked positions, and base moves that enable decisive top moves.
4. Benchmark search performance.

   Run alpha-beta at increasing depths. Measure nodes searched, elapsed time, effective branching factor, and pruning efficiency.
5. Build an evaluation function incrementally.

   Start with terminal outcomes, goal accessibility, captures, and mobility. Investigate base-network connectivity and route accessibility as additional features.
6. Run agent tournaments.

   Compare random, greedy, shallow-search, and deeper-search agents. Alternate player assignments and board configurations; track win rates and decision times.

### Key research questions

- How large is the complete-turn branching factor, especially in the Extended configuration?
- How many complete turns can be searched within a practical time budget?
- How important are base movements as enablers of future top movement?
- Can the game enter repeated or non-terminating positions?
- Does deeper search improve playing strength, or is positional evaluation the main limitation?

### Initial success criteria

The analysis spike should deliver:

1. A verified rules specification.
2. A representative set of game positions.
3. Branching-factor statistics for both boards.
4. A working alpha-beta benchmark with search-depth and timing measurements.
5. A baseline agent and reproducible tournament results.

Decision gate: Use the measurements to decide whether ordinary alpha-beta search is sufficient, whether the evaluation function needs more strategic features, or whether an alternative such as MCTS merits investigation.