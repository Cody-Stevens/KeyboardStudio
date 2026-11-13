/** UI state that is not keyboard state: modes, selection, view and panel choices. */
import {atom} from 'nanostores';
import type {BoardPart} from '../../core/index.ts';
import {isBoardShare} from '../logic/split.ts';
import {env, isBoolean, loadSetting, saveSetting} from './env.ts';

export type Mode = 'keys' | 'lighting' | 'macros' | 'snapshots';
export const $mode = atom<Mode>('keys');

/** The layer being edited. */
export const $layer = atom(0);

/** Selected key, by flat keymap index. */
export const $selected = atom<number | null>(null);

/** Key with keyboard focus in the board's key list. */
export const $focusedKey = atom<number | null>(null);

/** A short press to play on a key, for feedback. `at` makes repeats distinct. */
export const $pressPulse = atom<{readonly matrix: number; readonly at: number} | null>(null);
export const pulseKey = (matrix: number): void => $pressPulse.set({matrix, at: performance.now()});

/** A key press for the reactive lighting preview (typed on the keyboard or clicked on the model). */
export const $keyHit = atom<{readonly matrix: number; readonly at: number} | null>(null);
export const hitKey = (matrix: number): void => $keyHit.set({matrix, at: performance.now()});

/** True while typing previews a reactive backlight effect, so letter shortcuts (V) stay out of the way. */
export const $typingPreview = atom(false);

export type ViewKind = '3d' | 'flat';
const isView = (value: unknown): value is ViewKind => value === '3d' || value === 'flat';
/** The view the user chose. The page may still show flat if 3D is unavailable. */
export const $viewChoice = atom<ViewKind>(env.forceFlat ? 'flat' : loadSetting('view', '3d', isView));
export const setView = (view: ViewKind): void => {
  $viewChoice.set(view);
  saveSetting('view', view);
};
export const toggleView = (): void => setView($viewChoice.get() === '3d' ? 'flat' : '3d');

/** Why 3D is not available, if it is not. */
export type FlatReason = 'no-webgl' | 'slow' | 'narrow' | 'load-failed';
export const $flatReason = atom<FlatReason | null>(null);

const wideDefault = typeof window !== 'undefined' && window.innerWidth >= 1500;
export const $logOpen = atom<boolean>(loadSetting('log-open', wideDefault, isBoolean));
export const setLogOpen = (open: boolean): void => {
  $logOpen.set(open);
  saveSetting('log-open', open);
};

/** How much of the workspace height the board gets (0-1), or null for the default. Remembered in this browser. */
export const $boardShare = atom<number | null>(loadSetting('board-share', null, isBoardShare));
export const setBoardShare = (share: number, persist: boolean): void => {
  const next = Math.max(0.02, Math.min(0.98, share));
  $boardShare.set(next);
  if (persist) {
    saveSetting('board-share', next);
  }
};
export const resetBoardShare = (): void => {
  $boardShare.set(null);
  saveSetting('board-share', null);
};

/** "Also on Mac": write the paired layer in the same action. */
export const $alsoPaired = atom<boolean>(loadSetting('also-paired', false, isBoolean));
export const setAlsoPaired = (value: boolean): void => {
  $alsoPaired.set(value);
  saveSetting('also-paired', value);
};

/** Lighting: the zone panel that has focus, and the part hovered on the model or a panel. */
export const $focusedPart = atom<BoardPart | null>(null);
export const $hoveredPart = atom<BoardPart | null>(null);

/** A macro waiting for the key it goes on. */
export interface Placing {
  readonly index: number;
  readonly name: string;
  readonly expression: string;
}
export const $placing = atom<Placing | null>(null);

/** Macros panel: the slot being edited. */
export const $macroSlot = atom(0);

/** A one-line message near the board, such as why a click did nothing. */
export const $hint = atom<string | null>(null);
let hintTimer: ReturnType<typeof setTimeout> | undefined;
export const showHint = (text: string): void => {
  $hint.set(text);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => $hint.set(null), 4000);
};
