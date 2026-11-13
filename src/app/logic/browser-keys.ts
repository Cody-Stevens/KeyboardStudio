/**
 * Maps browser key events to QMK keycode names, for "press the key you
 * want" and macro recording. Uses `KeyboardEvent.code` (the physical key on
 * a US layout), so a key maps the same way whatever the computer's layout.
 */
import type {ModName} from './legends.ts';

const CODE_TO_QMK: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {
    Enter: 'KC_ENT',
    Escape: 'KC_ESC',
    Backspace: 'KC_BSPC',
    Tab: 'KC_TAB',
    Space: 'KC_SPC',
    Minus: 'KC_MINS',
    Equal: 'KC_EQL',
    BracketLeft: 'KC_LBRC',
    BracketRight: 'KC_RBRC',
    Backslash: 'KC_BSLS',
    IntlBackslash: 'KC_NUBS',
    Semicolon: 'KC_SCLN',
    Quote: 'KC_QUOT',
    Backquote: 'KC_GRV',
    Comma: 'KC_COMM',
    Period: 'KC_DOT',
    Slash: 'KC_SLSH',
    CapsLock: 'KC_CAPS',
    PrintScreen: 'KC_PSCR',
    ScrollLock: 'KC_SLCK',
    Pause: 'KC_PAUS',
    Insert: 'KC_INS',
    Home: 'KC_HOME',
    PageUp: 'KC_PGUP',
    Delete: 'KC_DEL',
    End: 'KC_END',
    PageDown: 'KC_PGDN',
    ArrowRight: 'KC_RGHT',
    ArrowLeft: 'KC_LEFT',
    ArrowDown: 'KC_DOWN',
    ArrowUp: 'KC_UP',
    NumLock: 'KC_NLCK',
    NumpadDivide: 'KC_PSLS',
    NumpadMultiply: 'KC_PAST',
    NumpadSubtract: 'KC_PMNS',
    NumpadAdd: 'KC_PPLS',
    NumpadEnter: 'KC_PENT',
    NumpadDecimal: 'KC_PDOT',
    NumpadEqual: 'KC_PEQL',
    ContextMenu: 'KC_APP',
    ControlLeft: 'KC_LCTL',
    ShiftLeft: 'KC_LSFT',
    AltLeft: 'KC_LALT',
    MetaLeft: 'KC_LGUI',
    ControlRight: 'KC_RCTL',
    ShiftRight: 'KC_RSFT',
    AltRight: 'KC_RALT',
    MetaRight: 'KC_RGUI',
    AudioVolumeMute: 'KC_MUTE',
    AudioVolumeUp: 'KC_VOLU',
    AudioVolumeDown: 'KC_VOLD',
    MediaTrackNext: 'KC_MNXT',
    MediaTrackPrevious: 'KC_MPRV',
    MediaStop: 'KC_MSTP',
    MediaPlayPause: 'KC_MPLY',
  };
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    map[`Key${letter}`] = `KC_${letter}`;
  }
  for (let i = 0; i <= 9; i++) {
    map[`Digit${i}`] = `KC_${i}`;
    map[`Numpad${i}`] = `KC_P${i}`;
  }
  for (let i = 1; i <= 24; i++) {
    map[`F${i}`] = `KC_F${i}`;
  }
  return map;
})();

const MODIFIER_CODES: Readonly<Record<string, ModName>> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  AltLeft: 'alt',
  AltRight: 'alt',
  MetaLeft: 'gui',
  MetaRight: 'gui',
};

/** The subset of KeyboardEvent this module reads. */
export interface KeyEventLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** QMK name for the physical key, or null when there is no basic keycode for it. */
export const qmkCodeForEvent = (event: Pick<KeyEventLike, 'code'>): string | null => CODE_TO_QMK[event.code] ?? null;

export const isModifierEvent = (event: Pick<KeyEventLike, 'code'>): boolean => event.code in MODIFIER_CODES;

export const modifierOfEvent = (event: Pick<KeyEventLike, 'code'>): ModName | null => MODIFIER_CODES[event.code] ?? null;

/** Modifiers held during the event, excluding the key itself when it is a modifier. */
export const heldModifiers = (event: KeyEventLike): ModName[] => {
  const self = modifierOfEvent(event);
  const held: ModName[] = [];
  if (event.ctrlKey && self !== 'ctrl') held.push('ctrl');
  if (event.shiftKey && self !== 'shift') held.push('shift');
  if (event.altKey && self !== 'alt') held.push('alt');
  if (event.metaKey && self !== 'gui') held.push('gui');
  return held;
};

/** Keys a capture must never swallow: Tab moves focus, Escape cancels. */
export const isCaptureEscape = (event: Pick<KeyEventLike, 'code' | 'key'>): boolean => event.key === 'Escape';
export const isFocusKey = (event: Pick<KeyEventLike, 'key'>): boolean => event.key === 'Tab';

/** The printable ASCII character the event types, if it types one without Ctrl, Alt or Cmd. */
export const typedCharacter = (event: KeyEventLike): string | null => {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  if (event.key.length !== 1) {
    return null;
  }
  const code = event.key.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e ? event.key : null;
};

const MOD_KEY_NAMES: Readonly<Record<ModName, string>> = {ctrl: 'KC_LCTL', shift: 'KC_LSFT', alt: 'KC_LALT', gui: 'KC_LGUI'};

/** QMK name of the left-hand key for a modifier, as macros store it. */
export const modifierKeyName = (mod: ModName): string => MOD_KEY_NAMES[mod];

/**
 * The key (flat keymap index) that sends `keycode`, looking at `preferLayer`
 * first and then every other layer, or null. Used to show a typed key on the
 * model.
 */
export const matrixForKeycode = (keymap: readonly (readonly number[])[], preferLayer: number, keycode: number, matrices: readonly number[]): number | null => {
  const order = [preferLayer, ...keymap.map((_, index) => index).filter((index) => index !== preferLayer)];
  for (const layer of order) {
    const codes = keymap[layer];
    const found = codes ? matrices.find((matrix) => codes[matrix] === keycode) : undefined;
    if (found !== undefined) {
      return found;
    }
  }
  return null;
};
