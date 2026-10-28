// SVG rendering of the board: flat-topped hexes, bases as discs, tops as smaller discs on them.
// Two layers: hexes (which take the clicks) and pieces on top (which ignore the pointer), so a
// moving piece can be raised above everything during its animation.

import { CELLS, IS_GOAL, cellByName, MAX_Y, NONE, ORANGE, type BaseMove, type GameState, type Player, type TopMove, type Turn } from '../../src/engine';

const SVG = 'http://www.w3.org/2000/svg';
const R = 40;
const H = (Math.sqrt(3) / 2) * R;
// The padding always leaves room for the coordinate labels, so showing them never resizes the board.
const PAD = 26;
/** Distance of a coordinate label's centre from the board's edge. */
const LABEL_GAP = 13;
export const VIEW_W = PAD * 2 + R * 2 + 6 * 1.5 * R;
export const VIEW_H = PAD * 2 + H * 2 + MAX_Y * H;

export const BASE_MS = 380;
const TOP_MS_PER_CELL = 160;
const TOP_MS_MIN = 380;
const CAPTURE_FADE_MS = 450;
/** One full turn of the goal cell the winning top reached. */
const WIN_SPIN_MS = 1000;
/** How large the goal cell and its pieces grow halfway through the turn. */
const WIN_GROW = 1.2;

export interface Highlights {
  /** Cells that can be clicked as the next step. */
  clickable: Set<number>;
  /** Currently selected cell (chosen base or top). */
  selected: number | null;
  /** Possible destinations of the selected top. */
  targets: Set<number>;
  /** Cells changed by the last turn. */
  lastMove: Set<number>;
  /** A suggested turn, drawn as arrows. */
  hint?: Turn | null;
}

/** A step that just happened and should be animated; the state passed in is the position after it. */
export interface Motion {
  base?: BaseMove | null;
  top?: TopMove | null;
}

/** Screen centre of a cell. With `flipped`, Blue's side is at the bottom. */
function centre(id: number, flipped: boolean): [number, number] {
  const cell = CELLS[id]!;
  const c = flipped ? 6 - cell.col : cell.col;
  const row = flipped ? cell.y : MAX_Y - cell.y;
  return [PAD + R + c * 1.5 * R, PAD + H + row * H];
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

const hexPoints = (x: number, y: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const colourClass = (p: number) => (p === ORANGE ? 'orange' : 'blue');

function drawTop(parent: Element, x: number, y: number, owner: number): SVGGElement {
  const g = el('g', { class: 'top-piece' }, parent);
  el('circle', { cx: x, cy: y, r: R * 0.4, class: `top ${colourClass(owner)}` }, g);
  el('circle', { cx: x, cy: y, r: R * 0.13, class: 'top-knob' }, g);
  return g;
}

/** Slides `node` from cell `from` to where it is drawn now (cell `to`), raised above other pieces. */
function slide(node: Element, from: number, to: number, ms: number, flipped: boolean): void {
  const [x0, y0] = centre(from, flipped);
  const [x1, y1] = centre(to, flipped);
  node.parentElement?.parentElement?.appendChild(node.parentElement);
  node.animate([{ transform: `translate(${x0 - x1}px, ${y0 - y1}px)` }, { transform: 'translate(0, 0)' }], {
    duration: ms,
    easing: 'cubic-bezier(0.3, 0, 0.2, 1)',
  });
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderBoard(
  svg: SVGSVGElement,
  state: GameState,
  hl: Highlights,
  /** `flipped`: Blue's side at the bottom. `labels`: show column letters and row numbers. */
  view: { flipped: boolean; labels: boolean },
  onCell: (id: number) => void,
  motion: Motion = {},
): void {
  const { flipped } = view;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${VIEW_W.toFixed(1)} ${VIEW_H.toFixed(1)}`);
  const hexLayer = el('g', { class: 'hexes' }, svg);
  const pieceLayer = el('g', { class: 'pieces' }, svg);
  const baseEls = new Map<number, SVGCircleElement>();
  const topEls = new Map<number, SVGGElement>();
  // The goal cell the winner's top reached.
  const win = state.winner === NONE ? -1 : CELLS.findIndex((c) => IS_GOAL[state.winner]![c.id] && state.top[c.id] === state.winner);
  let winHex: SVGPolygonElement | undefined;
  let winPieces: SVGGElement | undefined;

  for (const cell of CELLS) {
    const [x, y] = centre(cell.id, flipped);
    const hexGroup = el('g', { class: 'cell', 'data-cell': cell.name }, hexLayer);
    const classes = ['hex'];
    if (IS_GOAL[0]![cell.id] || IS_GOAL[1]![cell.id]) classes.push('goal');
    if (hl.lastMove.has(cell.id)) classes.push('last');
    if (cell.id === win) classes.push('win', colourClass(state.winner));
    if (hl.clickable.has(cell.id) || hl.targets.has(cell.id)) classes.push('clickable');
    const hex = el('polygon', { points: hexPoints(x, y, R - 1.5), class: classes.join(' ') }, hexGroup);
    if (cell.id === win) winHex = hex;
    el('title', {}, hexGroup).textContent = cell.name;
    hexGroup.addEventListener('click', () => onCell(cell.id));

    const pieces = el('g', { 'data-cell': cell.name }, pieceLayer);
    if (cell.id === win) winPieces = pieces;
    // Selection rings sit just outside the base so they read against both piece colours.
    if (hl.selected === cell.id) el('circle', { cx: x, cy: y, r: R * 0.76, class: 'ring selected' }, pieces);
    else if (hl.clickable.has(cell.id)) el('circle', { cx: x, cy: y, r: R * 0.76, class: 'ring movable' }, pieces);
    const b = state.base[cell.id]!;
    const t = state.top[cell.id]!;
    if (b !== NONE) baseEls.set(cell.id, el('circle', { cx: x, cy: y, r: R * 0.62, class: `base ${colourClass(b)}` }, pieces));
    if (t !== NONE) topEls.set(cell.id, drawTop(pieces, x, y, t));
    if (hl.targets.has(cell.id)) el('circle', { cx: x, cy: y, r: R * 0.18, class: 'target' }, pieces);
  }

  if (view.labels) drawLabels(svg, flipped);
  if (hl.hint) drawHint(svg, hl.hint, flipped);

  if (reducedMotion()) return;
  const { base, top } = motion;
  if (base) {
    const moved = baseEls.get(base.to);
    if (moved) slide(moved, base.from, base.to, BASE_MS, flipped);
    const swapped = base.swap ? baseEls.get(base.from) : undefined;
    if (swapped) slide(swapped, base.to, base.from, BASE_MS, flipped);
  }
  if (top) {
    const moved = topEls.get(top.to);
    const cells = Math.abs(CELLS[top.to]!.col - CELLS[top.from]!.col);
    const ms = Math.max(TOP_MS_MIN, cells * TOP_MS_PER_CELL);
    if (moved) slide(moved, top.from, top.to, ms, flipped);
    if (top.captured !== NONE) {
      // The captured top is gone from the state; draw a ghost that fades as the jumper passes.
      const [x, y] = centre(top.captured, flipped);
      const owner = state.top[top.to] === ORANGE ? 1 : ORANGE;
      const ghost = drawTop(el('g', {}, pieceLayer), x, y, owner);
      ghost.style.transformOrigin = `${x}px ${y}px`;
      ghost.style.opacity = '0';
      ghost.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(1)', offset: 0.4 },
          { opacity: 0, transform: 'scale(0.4)' },
        ],
        { duration: Math.max(ms, CAPTURE_FADE_MS), easing: 'ease-in' },
      );
      if (moved?.parentElement) pieceLayer.appendChild(moved.parentElement);
    }
    // The turn that just won: once the top lands, the goal cell under it turns once, it and its
    // pieces growing and shrinking again on the way. Both are raised above their layers' other
    // elements so they overlap their neighbours. The pieces are scaled as a group, because the
    // top's own transform is used by the slide.
    if (top.to === win && winHex && winPieces) {
      const [x, y] = centre(win, flipped);
      const timing = { duration: WIN_SPIN_MS, delay: ms, easing: 'ease-in-out' };
      winHex.parentElement?.parentElement?.appendChild(winHex.parentElement);
      winHex.style.transformOrigin = `${x}px ${y}px`;
      winHex.animate(
        [
          { transform: 'rotate(0deg) scale(1)' },
          { transform: `rotate(180deg) scale(${WIN_GROW})` },
          { transform: 'rotate(360deg) scale(1)' },
        ],
        timing,
      );
      pieceLayer.appendChild(winPieces);
      winPieces.style.transformOrigin = `${x}px ${y}px`;
      winPieces.animate([{ transform: 'scale(1)' }, { transform: `scale(${WIN_GROW})` }, { transform: 'scale(1)' }], timing);
    }
  }
}

/**
 * Column letters above and below the board, and row numbers beside the outer columns. Ranks
 * count within each column, and the shifted columns b, d and f sit half a cell nearer rank 1,
 * so each number is centred between the two heights. Rank 7 exists only in the shifted columns.
 */
function drawLabels(svg: SVGSVGElement, flipped: boolean): void {
  const layer = el('g', { class: 'coords' }, svg);
  const label = (x: number, y: number, text: string) => {
    el('text', { x, y, class: 'coord' }, layer).textContent = text;
  };
  for (const cell of CELLS) {
    if (cell.y > 1) continue;
    // Once per column, at its first cell.
    const [x] = centre(cell.id, flipped);
    label(x, PAD - LABEL_GAP, cell.name[0]!);
    label(x, VIEW_H - PAD + LABEL_GAP, cell.name[0]!);
  }
  // Screen direction of increasing rank. Each number sits beside the diagonal edge on the rank-1
  // side of its cell, half a hex height from the centre: the lower edge on the normal board, the
  // upper one on the flipped board.
  const dir = flipped ? 1 : -1;
  const a1 = centre(cellByName('a1'), flipped)[1];
  for (let rank = 1; rank <= 7; rank++) {
    const y = a1 + dir * 2 * H * (rank - 1) - (dir * H) / 2;
    label(PAD - LABEL_GAP, y, String(rank));
    label(VIEW_W - PAD + LABEL_GAP, y, String(rank));
  }
}

/** Arrows for the base step and the top step of a suggested turn, above the pieces. */
function drawHint(svg: SVGSVGElement, turn: Turn, flipped: boolean): void {
  const layer = el('g', { class: 'hint-arrows' }, svg);
  const marker = el('marker', { id: 'hint-head', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto' }, el('defs', {}, layer));
  el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'hint-head' }, marker);
  for (const step of [turn.base, turn.top]) {
    if (!step) continue;
    const [x0, y0] = centre(step.from, flipped);
    const [x1, y1] = centre(step.to, flipped);
    // Start and end short of the cell centres so the arrow does not hide the pieces it joins.
    const len = Math.hypot(x1 - x0, y1 - y0);
    const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
    const inset = R * 0.35;
    el(
      'line',
      { x1: x0 + ux * inset, y1: y0 + uy * inset, x2: x1 - ux * inset, y2: y1 - uy * inset, class: 'hint-arrow', 'marker-end': 'url(#hint-head)' },
      layer,
    );
  }
}

export function playerName(p: Player): string {
  return p === ORANGE ? 'Orange' : 'Blue';
}
