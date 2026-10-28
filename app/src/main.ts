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
import type { Reason } from '../../src/hints';
import type { AiRequest, AiResponse, HintRequest, HintResponse, Level } from './ai.worker';
import { BASE_MS, playerName, renderBoard, type Highlights, type Motion } from './board';
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
type Speed = 'instant' | 'fast' | 'normal' | 'slow';
type Theme = 'system' | 'light' | 'dark';
type Coords = 'on' | 'off';

interface Settings {
  mode: Mode;
  human: Player;
  level: Level;
  speed: Speed;
  theme: Theme;
  coords: Coords;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById('board') as unknown as SVGSVGElement;
const statusEl = $<HTMLParagraphElement>('status');
const passBtn = $<HTMLButtonElement>('pass');
const undoBtn = $<HTMLButtonElement>('undo');
const replayBtn = $<HTMLButtonElement>('replay');
const hintBtn = $<HTMLButtonElement>('hint-btn');
const hintEl = $<HTMLDivElement>('hint');
const radio = (name: string, value: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
const radioValue = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
const setRadio = (name: string, value: string) => (radio(name, value).checked = true);
const movesEl = $<HTMLOListElement>('moves');
const matchEl = $<HTMLParagraphElement>('match');

const SETTINGS_KEY = 'skipp.settings';
function loadSettings(): Settings {
  const fallback: Settings = { mode: 'ai', human: ORANGE, level: 'medium', speed: 'normal', theme: 'system', coords: 'off' };
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

/** The game in progress is saved as its settings and the moves played, and replayed on load. */
const GAME_KEY = 'skipp.game';
interface SavedGame {
  mode: Mode;
  human: Player;
  level: Level;
  moves: number[];
}
function saveGame(): void {
  const saved: SavedGame = { mode: game.mode, human: game.human, level: game.level, moves: log.map(encodeTurn) };
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(saved));
  } catch {
    // Storage may be unavailable (private mode); the game is then not kept across visits.
  }
}
/** Restores the saved game; false if there is none or it no longer replays as legal moves. */
function loadGame(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as SavedGame | null;
    if (!saved || !Array.isArray(saved.moves)) return false;
    const states = [startState()];
    const turns: Turn[] = [];
    for (const code of saved.moves) {
      const turn = legalTurns(states[states.length - 1]!).find((t) => encodeTurn(t) === code);
      if (!turn) return false;
      turns.push(turn);
      states.push(play(states[states.length - 1]!, turn));
    }
    game = { ...settings, mode: saved.mode, human: saved.human, level: saved.level };
    history = states;
    log = turns;
    return true;
  } catch {
    return false;
  }
}

const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
let requestId = 0;
let thinking = false;
/** The computer's base step while it is shown on its own, before the top step follows. */
let aiBaseShown: BaseMove | null = null;
/**
 * Pause before each visible step of the computer's turn, per speed setting, drawn at random from
 * the range so the computer feels less mechanical. Search time counts toward the first pause.
 */
const AI_STEP_DELAY_MS: Record<Speed, readonly [number, number]> = {
  instant: [0, 0],
  fast: [500, 800],
  normal: [1200, 1700],
  slow: [2200, 3000],
};
/** Pause before each step of a replayed turn. */
const REPLAY_STEP_MS = 700;
/** The position shown, and the cells highlighted, while the last turn is replayed step by step. */
let replayShown: { state: GameState; cells: Set<number> } | null = null;
let replayId = 0;
/** The hint for the current position: being searched for, or found. */
let hint: { pending: true } | { pending: false; turn: Turn | null; depth: number; reasons: Reason[] } | null = null;
let hintId = 0;
const aiStepDelay = () => {
  const [min, max] = AI_STEP_DELAY_MS[settings.speed];
  return min + Math.random() * (max - min);
};

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
  const humanToMove = !over && !thinking && !replayShown && isHumanTurn(state);
  const base = humanToMove ? effectiveBase(turns, sel) : undefined;

  const hl: Highlights = {
    clickable: new Set(),
    selected: null,
    targets: new Set(),
    lastMove: replayShown?.cells ?? lastMoveCells(),
    hint: humanToMove && hint && !hint.pending ? hint.turn : null,
  };
  let shown = replayShown?.state ?? (aiBaseShown ? play(state, { base: aiBaseShown, top: null }) : state);
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
  // Hints and the move list use the coordinates, so they are always shown with a hint.
  const labels = settings.coords === 'on' || (humanToMove && hint !== null);
  renderBoard(svg, shown, hl, { flipped, labels }, onCell, motion);
  statusEl.textContent = statusText(state, turns, base);
  const r = result(state);
  const won = !replayShown && (r === 'orange' || r === 'blue');
  statusEl.dataset.side = won ? r : over ? '' : state.toMove === ORANGE ? 'orange' : 'blue';
  statusEl.classList.toggle('won', won);
  passBtn.hidden = !(humanToMove && isPassOnly(turns));
  undoBtn.disabled = history.length === 1;
  const last = log[log.length - 1];
  replayBtn.disabled = !last || (!last.base && !last.top) || thinking || replayShown !== null;
  hintBtn.disabled = !humanToMove || isPassOnly(turns);
  hintBtn.setAttribute('aria-pressed', String(hint !== null));
  renderHint(humanToMove);
  saveGame();
  renderMoves();
}

function statusText(state: GameState, turns: Turn[], base: ReturnType<typeof effectiveBase>): string {
  if (replayShown) return 'Replaying the last move…';
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

function renderHint(humanToMove: boolean): void {
  hintEl.hidden = !hint || !humanToMove;
  if (hintEl.hidden || !hint) return;
  const title = hintEl.querySelector('.hint-title')!;
  const list = hintEl.querySelector('.hint-reasons')!;
  if (hint.pending) {
    title.textContent = 'Looking for a good move…';
    list.replaceChildren();
    return;
  }
  if (!hint.turn) {
    title.textContent = 'No hint available.';
    list.replaceChildren();
    return;
  }
  const notation = document.createElement('span');
  notation.className = 'notation';
  notation.textContent = turnToString(hint.turn);
  const depth = document.createElement('span');
  depth.className = 'depth';
  depth.textContent = ` · looked ${hint.depth} turns ahead`;
  title.replaceChildren('Hint: ', notation, depth);
  list.replaceChildren(
    ...hint.reasons.map((r) => {
      const li = document.createElement('li');
      li.textContent = r.text;
      return li;
    }),
  );
}

/** Asks the worker for a hint for the player to move; a second click hides it again. */
function toggleHint(): void {
  if (hint) return clearHint(), render();
  const state = current();
  const id = ++hintId;
  // A base step already selected is compared with the hint, so the player learns why not.
  const chosenBase = effectiveBase(legalTurns(state), sel);
  const req: HintRequest = { kind: 'hint', id, key: toKey(state), ...(chosenBase !== undefined && { chosenBase }) };
  hint = { pending: true };
  render();
  const onReply = (e: MessageEvent<HintResponse>) => {
    if (e.data.kind !== 'hint' || e.data.id !== id) return;
    worker.removeEventListener('message', onReply);
    if (id !== hintId) return;
    const turn = legalTurns(state).find((t) => encodeTurn(t) === e.data.code) ?? null;
    hint = { pending: false, turn, depth: e.data.depth, reasons: e.data.reasons };
    render();
  };
  worker.addEventListener('message', onReply);
  worker.postMessage(req);
}

function clearHint(): void {
  hintId++;
  hint = null;
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
  clearHint();
  // Decide before rendering, so one render shows both the animation and the "thinking" state.
  thinking = aiToMove();
  render(motion);
  if (thinking) requestAiMove();
}

function onCell(id: number): void {
  const state = current();
  if (result(state) !== 'ongoing' || thinking || replayShown || !isHumanTurn(state)) return;
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
  const req: AiRequest = { kind: 'move', id, key: toKey(state), ply: state.ply, level: game.level };
  worker.postMessage(req);
  const onReply = (e: MessageEvent<AiResponse>) => {
    if (e.data.kind !== 'move' || e.data.id !== id) return;
    worker.removeEventListener('message', onReply);
    const turn = legalTurns(state).find((t) => encodeTurn(t) === e.data.code);
    const finish = () => {
      if (id !== requestId) return;
      thinking = false;
      const baseShown = aiBaseShown !== null;
      aiBaseShown = null;
      if (turn) commit(turn, baseShown ? { top: turn.top } : { base: turn.base, top: turn.top });
      else render();
    };
    // Show the base step on its own first, then the top step, each after a pause.
    setTimeout(
      () => {
        if (id !== requestId) return;
        if (turn?.base && turn.top) {
          aiBaseShown = turn.base;
          render({ base: turn.base });
          // Let the base finish sliding before the top moves, even at instant speed.
          setTimeout(finish, Math.max(BASE_MS, aiStepDelay()));
        } else {
          finish();
        }
      },
      Math.max(0, aiStepDelay() - (performance.now() - started)),
    );
  };
  worker.addEventListener('message', onReply);
}

function cancelAi(): void {
  requestId++;
  thinking = false;
  aiBaseShown = null;
}

/** Shows the last turn again from the position before it, base step then top step. */
function replayLastTurn(): void {
  const turn = log[log.length - 1];
  if (!turn || thinking || replayShown) return;
  const id = ++replayId;
  const before = history[history.length - 2]!;
  const step = (fn: () => void) =>
    setTimeout(() => {
      if (id === replayId) fn();
    }, REPLAY_STEP_MS);
  const finish = (motion: Motion) => {
    replayShown = null;
    render(motion);
  };
  sel = EMPTY_SELECTION;
  replayShown = { state: before, cells: new Set() };
  render();
  step(() => {
    if (turn.base && turn.top) {
      replayShown = { state: play(before, { base: turn.base, top: null }), cells: new Set([turn.base.from, turn.base.to]) };
      render({ base: turn.base });
      step(() => finish({ top: turn.top }));
    } else {
      finish({ base: turn.base, top: turn.top });
    }
  });
}

function cancelReplay(): void {
  replayId++;
  replayShown = null;
}

function showMatch(): void {
  // Use the dialog's own wording for the difficulty.
  const level = radio('level', game.level).parentElement!.textContent;
  matchEl.textContent = game.mode === 'ai' ? `Player vs Computer · ${level}` : 'Player vs Player';
}

function newGame(): void {
  cancelAi();
  cancelReplay();
  clearHint();
  game = { ...settings };
  history = [startState()];
  log = [];
  sel = EMPTY_SELECTION;
  showMatch();
  render();
  maybeAiMove();
}

function undo(): void {
  cancelAi();
  cancelReplay();
  clearHint();
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

// The new-game dialog edits a copy of the settings; they only apply on Start.
const newGameDialog = $<HTMLDivElement>('new-game');

function showAiRows(): void {
  $('side-row').hidden = radioValue('mode') !== 'ai';
  $('level-row').hidden = radioValue('mode') !== 'ai';
}

newGameDialog.addEventListener('beforetoggle', (e) => {
  if ((e as ToggleEvent).newState !== 'open') return;
  setRadio('mode', settings.mode);
  setRadio('side', String(settings.human));
  setRadio('level', settings.level);
  showAiRows();
});
$('mode').addEventListener('change', showAiRows);
setRadio('speed', settings.speed);
$('speed').addEventListener('change', (e) => {
  settings = { ...settings, speed: (e.target as HTMLInputElement).value as Speed };
  saveSettings();
});

function applyTheme(): void {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

setRadio('coords', settings.coords);
$('coords').addEventListener('change', (e) => {
  settings = { ...settings, coords: (e.target as HTMLInputElement).value as Coords };
  saveSettings();
  render();
});

setRadio('theme', settings.theme);
$('theme').addEventListener('change', (e) => {
  settings = { ...settings, theme: (e.target as HTMLInputElement).value as Theme };
  saveSettings();
  applyTheme();
});
$('start').addEventListener('click', () => {
  settings = {
    ...settings,
    mode: radioValue('mode') as Mode,
    human: Number(radioValue('side')) as Player,
    level: radioValue('level') as Level,
  };
  saveSettings();
  newGameDialog.hidePopover();
  newGame();
});
undoBtn.addEventListener('click', undo);
replayBtn.addEventListener('click', replayLastTurn);
hintBtn.addEventListener('click', toggleHint);
passBtn.addEventListener('click', () => commit(PASS));

if (loadGame()) {
  showMatch();
  render();
  maybeAiMove();
} else {
  newGame();
}
