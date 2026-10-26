// Turns the list of legal complete turns into a click-by-click selection:
// (1) pick a base to move (if any base can move), then (2) pick a top and (3) its destination.
// Pure functions of the legal turns, so they can be unit-tested without a DOM.

import { PASS, type BaseMove, type TopMove, type Turn } from '../../src/engine';

export interface Selection {
  /** undefined = base step not chosen yet; null = no base step this turn. */
  base: BaseMove | null | undefined;
  /** Cell of the selected top, or null. */
  topFrom: number | null;
}

export const EMPTY_SELECTION: Selection = { base: undefined, topFrom: null };

const sameBase = (a: BaseMove | null, b: BaseMove | null) =>
  a === null || b === null ? a === b : a.from === b.from && a.to === b.to;

export function isPassOnly(turns: Turn[]): boolean {
  return turns.length === 1 && turns[0] === PASS;
}

/** True if this turn has a base step to choose (a base step is mandatory whenever possible). */
export function needsBase(turns: Turn[]): boolean {
  return turns.some((t) => t.base !== null);
}

/** Movable bases, keyed by the cell they move from (each base has one forward destination). */
export function baseOptions(turns: Turn[]): Map<number, BaseMove> {
  const out = new Map<number, BaseMove>();
  for (const t of turns) if (t.base && !out.has(t.base.from)) out.set(t.base.from, t.base);
  return out;
}

/** The base step in effect: the chosen one, or null when no base can move. */
export function effectiveBase(turns: Turn[], sel: Selection): BaseMove | null | undefined {
  return needsBase(turns) ? sel.base : null;
}

/** Turns still possible after the base step in `sel`. Empty while the base step is pending. */
export function remainingTurns(turns: Turn[], sel: Selection): Turn[] {
  const base = effectiveBase(turns, sel);
  if (base === undefined) return [];
  return turns.filter((t) => sameBase(t.base, base));
}

/** Top moves available after the base step, keyed by the top's cell. */
export function topOptions(turns: Turn[], sel: Selection): Map<number, TopMove[]> {
  const out = new Map<number, TopMove[]>();
  for (const t of remainingTurns(turns, sel)) {
    if (!t.top) continue;
    out.set(t.top.from, [...(out.get(t.top.from) ?? []), t.top]);
  }
  return out;
}

/**
 * The completed turn once the selection pins one down without further input: a base step
 * after which no top can move. Returns null while a choice remains.
 */
export function autoComplete(turns: Turn[], sel: Selection): Turn | null {
  const rest = remainingTurns(turns, sel);
  return rest.length === 1 && rest[0]!.top === null ? rest[0]! : null;
}

/** The turn completed by moving the selected top to `to`, or null if that is not legal. */
export function completeWithTop(turns: Turn[], sel: Selection, to: number): Turn | null {
  if (sel.topFrom === null) return null;
  return remainingTurns(turns, sel).find((t) => t.top?.from === sel.topFrom && t.top.to === to) ?? null;
}
