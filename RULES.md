# Skipp — rules specification (draft)

Source: https://www.skipp.game/speluitleg.html (Dutch), the Original board start diagram,
and clarifications from the game owner (2026-10-26).

## Board geometry (Original)

Hex grid of flat-topped hexes arranged in 7 columns, `a`–`g` (index `c = 0..6`).
Odd-index columns (`b`, `d`, `f`) are shifted half a cell and have 7 cells; even-index
columns (`a`, `c`, `e`, `g`) have 6 cells. Total: 4×6 + 3×7 = **45 cells**.

Internal coordinates use a doubled vertical axis `y`, measured from Orange's side:

- even columns: `y ∈ {1, 3, 5, 7, 9, 11}`
- odd columns:  `y ∈ {0, 2, 4, 6, 8, 10, 12}`

Neighbours of `(c, y)`: `N (c, y+2)`, `S (c, y-2)`, `NE (c+1, y+1)`, `NW (c-1, y+1)`,
`SE (c+1, y-1)`, `SW (c-1, y-1)`.

Human notation: column letter + rank within the column counted from Orange's side,
`rank = y // 2 + 1`. So `a1 = (0,1)`, `b1 = (1,0)`, `b7 = (1,12)`, `a6 = (0,11)`.

Directions are relative to the player:

| | Orange (moves up) | Blue (moves down) |
|---|---|---|
| straight forward | N | S |
| diagonal forward | NE, NW | SE, SW |

## Pieces

Each player has **14 bases** and **7 tops**.

- A cell holds at most one base. Cells without a base are empty board.
- A top always stands on a base, and a base carries at most one top.
- A top may stand on a base of **either** colour.

## Start position (Original)

`O` = orange top on orange base, `o` = empty orange base, `B` / `b` = the same for Blue,
`.` = empty cell.

```
 y    a    b    c    d    e    f    g
12         B         B         B
11    B         B         B         B
10         b         b         b
 9    b         b         b         b
 8         .         .         .
 7    .         .         .         .
 6         .         .         .
 5    .         .         .         .
 4         .         .         .
 3    o         o         o         o
 2         o         o         o
 1    O         O         O         O
 0         O         O         O
```

That gives 17 empty cells at the start.

**Goal cells** (dark grey): each player's starting back row.
Orange's goal is Blue's back row, `y ∈ {11, 12}`: a6 b7 c6 d7 e6 f7 g6.
Blue's goal is Orange's back row, `y ∈ {0, 1}`: a1 b1 c1 d1 e1 f1 g1.

## Turn

A turn has two steps, in this order:

1. **Base step:** move one of your own bases.
2. **Top step:** move one of your own tops, as either a sprint or a capture.

You must make both steps if you can. If no base move is legal, you only make a top step;
if no top move is legal, you only make a base step. If neither is possible, you pass.

**[INTERPRETATION]** The base step is mandatory whenever any base can move, even if every
possible base move leaves no top move. A top-only turn happens only when no base can move.

### Base step

Only a base without a top may move.

- **Advance:** move one cell straight forward into a cell with no base.
- **Swap:** if the cell straight forward holds an empty *opponent* base, the two bases
  swap cells. Swaps are only ever straight forward, and a swap uses up the base step.

### Top step

Tops move diagonally forward only, along one diagonal line, and only over bases.

- **Sprint:** move `k ≥ 1` cells along one forward diagonal. Every cell passed over and
  the landing cell must hold an empty base (a base with no top). The line may not bend.
- **Capture:** if the adjacent cell on a forward diagonal holds an **opponent** top, and
  the next cell beyond it on the same line holds an empty base, jump there. The jumped
  top is removed and its base stays. There is at most one capture per turn, it jumps
  exactly one top, and capturing is optional. Jumping and capturing are the same thing:
  a top can never jump over its own side's tops.

### Winning

You win immediately when one of your tops lands on a cell in your goal row. Landing is
enough; the top does not have to survive the opponent's reply.

### Draw

If neither player can make any move, so both would have to pass, the game is a draw.

## Consequences worth noting

- Every base move and every top move goes strictly forward, so no position can repeat.
  A single pass is fine because the other player still moves forward, and a mutual pass
  ends the game as a draw. Every game therefore terminates.
- A goal cell can only be reached when it holds an empty base. At the start, every goal
  cell holds an enemy base with an enemy top on it, so the defender's back row has to
  move or be vacated first.
- A base on a goal cell can be reached from the side by a top even if the base is the
  opponent's.

## Open questions

1. **First player:** the rules leave it to the players. In analysis Orange moves first,
   and tournaments alternate colours.

## Scope

This spec covers the Original board only. The Extended board is out of scope.
