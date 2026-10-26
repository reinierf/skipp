import {
  NONE,
  ORANGE,
  PASS,
  encodeTurn,
  legalTurns,
  opponent,
  play,
  result,
  startState,
  toKey,
  turnToString,
  type GameState,
  type BaseMove,
  type Player,
  type Turn,
} from '../../src/engine';
import type { AiRequest, AiResponse, Level } from './ai.worker';
import { playerName, renderBoard, type Highlights, type Motion } from './board';
import {
  EMPTY_SELECTION,
  autoComplete,
  baseOptions,
  completeWithTop,
  effectiveBase,
  isPassOnly,
  topOptions,
  type Selection,
} from './input';
import './style.css';

type Mode = 'ai' | 'pvp';

interface Settings {
  mode: Mode;
  human: Player;
  level: Level;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById('board') as unknown as SVGSVGElement;
const statusEl = $<HTMLParagraphElement>('status');
const passBtn = $<HTMLButtonElement>('pass');
const backBtn = $<HTMLButtonElement>('back');
const undoBtn = $<HTMLButtonElement>('undo');
const modeSel = $<HTMLSelectElement>('mode');
const sideSel = $<HTMLSelectElement>('side');
const levelSel = $<HTMLSelectElement>('level');
const movesEl = $<HTMLOListElement>('moves');

const SETTINGS_KEY = 'skipp.settings';
function loadSettings(): Settings {
  const fallback: Settings = { mode: 'ai', human: ORANGE, level: 'medium' };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}
function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this visit only.
  }
}

let settings = loadSettings();
/** Settings the current game was started with (mode and side apply from the next new game). */
let game = { ...settings };
let history: GameState[] = [startState()];
let log: Turn[] = [];
let sel: Selection = EMPTY_SELECTION;

const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
let requestId = 0;
let thinking = false;
/** The computer's base step while it is shown on its own, before the top step follows. */
let aiBaseShown: BaseMove | null = null;
/** Pause before each visible step of the computer's turn (search time counts toward the first). */
const AI_STEP_DELAY_MS = 2000;

const current = () => history[history.length - 1]!;
const isHumanTurn = (s: GameState) => game.mode === 'pvp' || s.toMove === game.human;

function lastMoveCells(): Set<number> {
  if (aiBaseShown) return new Set([aiBaseShown.from, aiBaseShown.to]);
  const t = log[log.length - 1];
  const cells = new Set<number>();
  if (t?.base) cells.add(t.base.from).add(t.base.to);
  if (t?.top) {
    cells.add(t.top.from).add(t.top.to);
    if (t.top.captured !== NONE) cells.add(t.top.captured);
  }
  return cells;
}

function render(motion: Motion = {}): void {
  const state = current();
  const turns = legalTurns(state);
  const over = result(state) !== 'ongoing';
  const humanToMove = !over && !thinking && isHumanTurn(state);
  const base = humanToMove ? effectiveBase(turns, sel) : undefined;

  const hl: Highlights = { clickable: new Set(), selected: null, targets: new Set(), lastMove: lastMoveCells() };
  let shown = aiBaseShown ? play(state, { base: aiBaseShown, top: null }) : state;
  if (humanToMove && !isPassOnly(turns)) {
    if (base === undefined) {
      for (const from of baseOptions(turns).keys()) hl.clickable.add(from);
    } else {
      if (base) shown = play(state, { base, top: null });
      const tops = topOptions(turns, sel);
      for (const from of tops.keys()) hl.clickable.add(from);
      if (sel.topFrom !== null) {
        hl.selected = sel.topFrom;
        for (const m of tops.get(sel.topFrom) ?? []) hl.targets.add(m.to);
      } else if (base) {
        hl.selected = base.to;
      }
    }
  }

  const flipped = game.mode === 'ai' && game.human !== ORANGE;
  renderBoard(svg, shown, hl, flipped, onCell, motion);
  statusEl.textContent = statusText(state, turns, base);
  statusEl.dataset.side = over ? '' : state.toMove === ORANGE ? 'orange' : 'blue';
  passBtn.hidden = !(humanToMove && isPassOnly(turns));
  backBtn.hidden = !(humanToMove && sel.base);
  undoBtn.disabled = history.length === 1;
  renderMoves();
}

function statusText(state: GameState, turns: Turn[], base: ReturnType<typeof effectiveBase>): string {
  const r = result(state);
  if (r === 'draw') return 'Draw: neither player can move.';
  if (r !== 'ongoing') {
    const winner = r === 'orange' ? ORANGE : opponent(ORANGE);
    if (game.mode === 'ai') return winner === game.human ? 'You win!' : 'The computer wins.';
    return `${playerName(winner)} wins!`;
  }
  const who = playerName(state.toMove);
  if (aiBaseShown) return `Computer (${who}) moved a base and is now moving a top…`;
  if (thinking) return `Computer (${who}) is thinking…`;
  const you = game.mode === 'ai' ? 'Your move' : `${who} to move`;
  if (isPassOnly(turns)) return `${you}: nothing can move, so you must pass.`;
  if (base === undefined) return `${you}: move one of your empty bases one step forward.`;
  if (sel.topFrom !== null) return `${you}: choose where this top goes.`;
  return `${you}: now move a top diagonally forward (sprint over empty bases, or jump an opponent's top).`;
}

function renderMoves(): void {
  movesEl.replaceChildren(
    ...log.map((t, i) => {
      const li = document.createElement('li');
      li.textContent = turnToString(t);
      li.className = i % 2 === 0 ? 'orange' : 'blue';
      return li;
    }),
  );
  movesEl.scrollTop = movesEl.scrollHeight;
}

/** Plays `turn`; `motion` is the part of it not yet shown on the board, to animate. */
function commit(turn: Turn, motion: Motion = {}): void {
  history.push(play(current(), turn));
  log.push(turn);
  sel = EMPTY_SELECTION;
  // Decide before rendering, so one render shows both the animation and the "thinking" state.
  thinking = aiToMove();
  render(motion);
  if (thinking) requestAiMove();
}

function onCell(id: number): void {
  const state = current();
  if (result(state) !== 'ongoing' || thinking || !isHumanTurn(state)) return;
  const turns = legalTurns(state);
  if (isPassOnly(turns)) return;

  if (effectiveBase(turns, sel) === undefined) {
    const move = baseOptions(turns).get(id);
    if (!move) return;
    sel = { base: move, topFrom: null };
    const auto = autoComplete(turns, sel);
    if (auto) commit(auto, { base: auto.base });
    else render({ base: move });
    return;
  }

  const tops = topOptions(turns, sel);
  if (tops.has(id)) {
    sel = { ...sel, topFrom: sel.topFrom === id ? null : id };
  } else if (sel.topFrom !== null) {
    const turn = completeWithTop(turns, sel, id);
    if (turn) return commit(turn, { top: turn.top });
    sel = { ...sel, topFrom: null };
  } else if (sel.base && id === sel.base.to) {
    sel = EMPTY_SELECTION;
  }
  render();
}

function aiToMove(): boolean {
  const state = current();
  return game.mode === 'ai' && result(state) === 'ongoing' && state.toMove !== game.human;
}

function maybeAiMove(): void {
  if (!aiToMove()) return;
  thinking = true;
  render();
  requestAiMove();
}

/** Asks the worker for the computer's turn and plays it in two visible steps. */
function requestAiMove(): void {
  const state = current();
  const id = ++requestId;
  const started = performance.now();
  const req: AiRequest = { id, key: toKey(state), level: settings.level };
  worker.postMessage(req);
  const onReply = (e: MessageEvent<AiResponse>) => {
    if (e.data.id !== id) return;
    worker.removeEventListener('message', onReply);
    const turn = legalTurns(state).find((t) => encodeTurn(t) === e.data.code);
    const finish = () => {
      if (id !== requestId) return;
      thinking = false;
      aiBaseShown = null;
      if (turn) commit(turn, turn.base && turn.top ? { top: turn.top } : { base: turn.base, top: turn.top });
      else render();
    };
    // Show the base step on its own first, then the top step, each after a pause.
    setTimeout(
      () => {
        if (id !== requestId) return;
        if (turn?.base && turn.top) {
          aiBaseShown = turn.base;
          render({ base: turn.base });
          setTimeout(finish, AI_STEP_DELAY_MS);
        } else {
          finish();
        }
      },
      Math.max(0, AI_STEP_DELAY_MS - (performance.now() - started)),
    );
  };
  worker.addEventListener('message', onReply);
}

function cancelAi(): void {
  requestId++;
  thinking = false;
  aiBaseShown = null;
}

function newGame(): void {
  cancelAi();
  game = { ...settings };
  history = [startState()];
  log = [];
  sel = EMPTY_SELECTION;
  render();
  maybeAiMove();
}

function undo(): void {
  cancelAi();
  if (history.length === 1) return;
  history.pop();
  log.pop();
  if (game.mode === 'ai') {
    while (history.length > 1 && current().toMove !== game.human) {
      history.pop();
      log.pop();
    }
  }
  sel = EMPTY_SELECTION;
  render();
  maybeAiMove();
}

function syncControls(): void {
  modeSel.value = settings.mode;
  sideSel.value = String(settings.human);
  levelSel.value = settings.level;
  $('side-row').hidden = settings.mode !== 'ai';
  $('level-row').hidden = settings.mode !== 'ai';
}

modeSel.addEventListener('change', () => {
  settings = { ...settings, mode: modeSel.value as Mode };
  saveSettings();
  syncControls();
  newGame();
});
sideSel.addEventListener('change', () => {
  settings = { ...settings, human: Number(sideSel.value) as Player };
  saveSettings();
  newGame();
});
levelSel.addEventListener('change', () => {
  settings = { ...settings, level: levelSel.value as Level };
  game.level = settings.level;
  saveSettings();
});
$('new').addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);
passBtn.addEventListener('click', () => commit(PASS));
backBtn.addEventListener('click', () => {
  sel = EMPTY_SELECTION;
  render();
});

syncControls();
newGame();
