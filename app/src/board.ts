// SVG rendering of the board: flat-topped hexes, bases as discs, tops as smaller discs on them.

import { CELLS, IS_GOAL, MAX_Y, NONE, ORANGE, type GameState, type Player } from '../../src/engine';

const SVG = 'http://www.w3.org/2000/svg';
const R = 40;
const H = (Math.sqrt(3) / 2) * R;
const PAD = 10;
export const VIEW_W = PAD * 2 + R * 2 + 6 * 1.5 * R;
export const VIEW_H = PAD * 2 + H * 2 + MAX_Y * H;

export interface Highlights {
  /** Cells that can be clicked as the next step. */
  clickable: Set<number>;
  /** Currently selected cell (chosen base or top). */
  selected: number | null;
  /** Possible destinations of the selected top. */
  targets: Set<number>;
  /** Cells changed by the last turn. */
  lastMove: Set<number>;
}

/** Screen centre of a cell. With `flipped`, Blue's side is at the bottom. */
function centre(col: number, y: number, flipped: boolean): [number, number] {
  const c = flipped ? 6 - col : col;
  const row = flipped ? y : MAX_Y - y;
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

export function renderBoard(svg: SVGSVGElement, state: GameState, hl: Highlights, flipped: boolean, onCell: (id: number) => void): void {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${VIEW_W.toFixed(1)} ${VIEW_H.toFixed(1)}`);
  for (const cell of CELLS) {
    const [x, y] = centre(cell.col, cell.y, flipped);
    const g = el('g', { class: 'cell', 'data-cell': cell.name }, svg);
    const goal = IS_GOAL[0]![cell.id] || IS_GOAL[1]![cell.id];
    const classes = ['hex'];
    if (goal) classes.push('goal');
    if (hl.lastMove.has(cell.id)) classes.push('last');
    if (hl.clickable.has(cell.id) || hl.targets.has(cell.id)) classes.push('clickable');
    el('polygon', { points: hexPoints(x, y, R - 1.5), class: classes.join(' ') }, g);

    const b = state.base[cell.id]!;
    const t = state.top[cell.id]!;
    // Selection rings sit just outside the base so they read against both piece colours.
    if (hl.selected === cell.id) el('circle', { cx: x, cy: y, r: R * 0.76, class: 'ring selected' }, g);
    else if (hl.clickable.has(cell.id)) el('circle', { cx: x, cy: y, r: R * 0.76, class: 'ring movable' }, g);
    if (b !== NONE) el('circle', { cx: x, cy: y, r: R * 0.62, class: `base ${colourClass(b)}` }, g);
    if (t !== NONE) {
      el('circle', { cx: x, cy: y, r: R * 0.4, class: `top ${colourClass(t)}` }, g);
      el('circle', { cx: x, cy: y, r: R * 0.13, class: 'top-knob' }, g);
    }
    if (hl.targets.has(cell.id)) el('circle', { cx: x, cy: y, r: R * 0.18, class: 'target' }, g);

    el('title', {}, g).textContent = cell.name;
    g.addEventListener('click', () => onCell(cell.id));
  }
}

export function playerName(p: Player): string {
  return p === ORANGE ? 'Orange' : 'Blue';
}
