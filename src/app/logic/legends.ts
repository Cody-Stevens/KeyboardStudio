/**
 * Keycap legends and plain names for keycodes, aware of the layer's
 * computer (Win or Cmd) and the board's layer names. Framework-free.
 */
import {keycodeDanger, keyNoteFor, type BoardMeta, type KeycodeTable, type LayerOs} from '../../core/index.ts';

export type LegendIcon =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'mute'
  | 'vol-up'
  | 'vol-down'
  | 'next'
  | 'prev'
  | 'play'
  | 'bright-up'
  | 'bright-down'
  | 'light-up'
  | 'light-down';

export type LegendKind = 'normal' | 'empty' | 'transparent' | 'layer' | 'macro' | 'custom' | 'media' | 'lighting' | 'danger' | 'combo';

export interface Legend {
  /** One or two lines. Two lines are drawn stacked (shifted symbol above, or a two-word label). */
  readonly lines: readonly string[];
  readonly icon?: LegendIcon;
  readonly kind: LegendKind;
}

export interface LegendContext {
  readonly table: KeycodeTable;
  readonly meta: BoardMeta;
  readonly layer: number;
  /** Names the user gave macros, by slot. Empty strings fall back to "Macro N". */
  readonly macroNames?: readonly string[];
}

// ---------------------------------------------------------------------------
// Basic keys
// ---------------------------------------------------------------------------

interface BasicLabel {
  readonly legend: string;
  readonly name: string;
  readonly icon?: LegendIcon;
  readonly kind?: LegendKind;
}

const BASIC: Readonly<Record<string, BasicLabel>> = {
  KC_ENT: {legend: 'Enter', name: 'Enter'},
  KC_ESC: {legend: 'Esc', name: 'Esc'},
  KC_BSPC: {legend: 'Backspace', name: 'Backspace'},
  KC_TAB: {legend: 'Tab', name: 'Tab'},
  KC_SPC: {legend: '', name: 'Space'},
  KC_CAPS: {legend: 'Caps Lock', name: 'Caps Lock'},
  KC_PSCR: {legend: 'PrtSc', name: 'Print Screen'},
  KC_SLCK: {legend: 'ScrLk', name: 'Scroll Lock'},
  KC_PAUS: {legend: 'Pause', name: 'Pause'},
  KC_INS: {legend: 'Ins', name: 'Insert'},
  KC_HOME: {legend: 'Home', name: 'Home'},
  KC_PGUP: {legend: 'PgUp', name: 'Page Up'},
  KC_DEL: {legend: 'Del', name: 'Delete'},
  KC_END: {legend: 'End', name: 'End'},
  KC_PGDN: {legend: 'PgDn', name: 'Page Down'},
  KC_RGHT: {legend: '', name: 'Right arrow', icon: 'right'},
  KC_LEFT: {legend: '', name: 'Left arrow', icon: 'left'},
  KC_DOWN: {legend: '', name: 'Down arrow', icon: 'down'},
  KC_UP: {legend: '', name: 'Up arrow', icon: 'up'},
  KC_NLCK: {legend: 'NumLk', name: 'Num Lock'},
  KC_APP: {legend: 'Menu', name: 'Menu'},
  KC_NUBS: {legend: '\\', name: 'Extra backslash (ISO)'},
  KC_MUTE: {legend: '', name: 'Mute', icon: 'mute', kind: 'media'},
  KC_VOLU: {legend: '', name: 'Volume up', icon: 'vol-up', kind: 'media'},
  KC_VOLD: {legend: '', name: 'Volume down', icon: 'vol-down', kind: 'media'},
  KC_MNXT: {legend: '', name: 'Next track', icon: 'next', kind: 'media'},
  KC_MPRV: {legend: '', name: 'Previous track', icon: 'prev', kind: 'media'},
  KC_MPLY: {legend: '', name: 'Play or pause', icon: 'play', kind: 'media'},
  KC_MSTP: {legend: 'Stop', name: 'Stop', kind: 'media'},
  KC_MSEL: {legend: 'Player', name: 'Open media player', kind: 'media'},
  KC_MAIL: {legend: 'Mail', name: 'Open mail', kind: 'media'},
  KC_CALC: {legend: 'Calc', name: 'Open calculator', kind: 'media'},
  KC_MYCM: {legend: 'This PC', name: 'Open My Computer', kind: 'media'},
  KC_WWW_SEARCH: {legend: 'Search', name: 'Web search', kind: 'media'},
  KC_WWW_HOME: {legend: 'Browser', name: 'Open the browser', kind: 'media'},
  KC_WWW_BACK: {legend: 'Back', name: 'Browser back', kind: 'media'},
  KC_WWW_FORWARD: {legend: 'Forward', name: 'Browser forward', kind: 'media'},
  KC_WWW_REFRESH: {legend: 'Reload', name: 'Browser reload', kind: 'media'},
  KC_BRIU: {legend: '', name: 'Screen brighter', icon: 'bright-up', kind: 'media'},
  KC_BRID: {legend: '', name: 'Screen dimmer', icon: 'bright-down', kind: 'media'},
  KC_MCTL: {legend: 'Mission\nControl', name: 'Mission Control (Mac)', kind: 'media'},
  KC_LPAD: {legend: 'Launch-\npad', name: 'Launchpad (Mac)', kind: 'media'},
  KC_PWR: {legend: 'Power', name: 'Power', kind: 'media'},
  KC_SLEP: {legend: 'Sleep', name: 'Put the computer to sleep', kind: 'media'},
  KC_EJCT: {legend: 'Eject', name: 'Eject', kind: 'media'},
  RGB_TOG: {legend: 'Lights\non/off', name: 'Backlight on or off', kind: 'lighting'},
  RGB_MOD: {legend: 'Effect', name: 'Next backlight effect', kind: 'lighting'},
  RGB_RMOD: {legend: 'Effect −', name: 'Previous backlight effect', kind: 'lighting'},
  RGB_HUI: {legend: 'Hue +', name: 'Backlight colour forward', kind: 'lighting'},
  RGB_HUD: {legend: 'Hue −', name: 'Backlight colour back', kind: 'lighting'},
  RGB_SAI: {legend: 'Sat +', name: 'Backlight colour stronger', kind: 'lighting'},
  RGB_SAD: {legend: 'Sat −', name: 'Backlight colour paler', kind: 'lighting'},
  RGB_VAI: {legend: '', name: 'Backlight brighter', icon: 'light-up', kind: 'lighting'},
  RGB_VAD: {legend: '', name: 'Backlight dimmer', icon: 'light-down', kind: 'lighting'},
  RGB_SPI: {legend: 'Speed +', name: 'Backlight effect faster', kind: 'lighting'},
  RGB_SPD: {legend: 'Speed −', name: 'Backlight effect slower', kind: 'lighting'},
};

const SHIFTED: Readonly<Record<string, readonly [string, string, string]>> = {
  KC_1: ['!', '1', '1'],
  KC_2: ['@', '2', '2'],
  KC_3: ['#', '3', '3'],
  KC_4: ['$', '4', '4'],
  KC_5: ['%', '5', '5'],
  KC_6: ['^', '6', '6'],
  KC_7: ['&', '7', '7'],
  KC_8: ['*', '8', '8'],
  KC_9: ['(', '9', '9'],
  KC_0: [')', '0', '0'],
  KC_MINS: ['_', '-', 'Minus'],
  KC_EQL: ['+', '=', 'Equals'],
  KC_LBRC: ['{', '[', 'Left bracket'],
  KC_RBRC: ['}', ']', 'Right bracket'],
  KC_BSLS: ['|', '\\', 'Backslash'],
  KC_SCLN: [':', ';', 'Semicolon'],
  KC_QUOT: ['"', "'", 'Quote'],
  KC_GRV: ['~', '`', 'Backtick'],
  KC_COMM: ['<', ',', 'Comma'],
  KC_DOT: ['>', '.', 'Full stop'],
  KC_SLSH: ['?', '/', 'Slash'],
};

type Side = 'Left' | 'Right';
const MODIFIER_CODES: Readonly<Record<string, {readonly mod: ModName; readonly side: Side}>> = {
  KC_LCTL: {mod: 'ctrl', side: 'Left'},
  KC_LSFT: {mod: 'shift', side: 'Left'},
  KC_LALT: {mod: 'alt', side: 'Left'},
  KC_LGUI: {mod: 'gui', side: 'Left'},
  KC_RCTL: {mod: 'ctrl', side: 'Right'},
  KC_RSFT: {mod: 'shift', side: 'Right'},
  KC_RALT: {mod: 'alt', side: 'Right'},
  KC_RGUI: {mod: 'gui', side: 'Right'},
};

export type ModName = 'ctrl' | 'shift' | 'alt' | 'gui';

/** What a modifier is called on a computer. */
export const modifierLabel = (mod: ModName, os: LayerOs): string => {
  switch (mod) {
    case 'ctrl':
      return 'Ctrl';
    case 'shift':
      return 'Shift';
    case 'alt':
      return os === 'mac' ? 'Option' : 'Alt';
    case 'gui':
      return os === 'mac' ? 'Cmd' : 'Win';
    default: {
      const unreachable: never = mod;
      return String(unreachable);
    }
  }
};

/** Modifier bits as protocol 12 packs them into bits 8-12 of a modified keycode. */
export const MOD_BITS: Readonly<Record<ModName, number>> = {ctrl: 0x01, shift: 0x02, alt: 0x04, gui: 0x08};
const RIGHT_BIT = 0x10;

export const modsFromBits = (bits: number): ModName[] =>
  (Object.entries(MOD_BITS) as [ModName, number][]).filter(([, bit]) => (bits & bit) !== 0).map(([mod]) => mod);

/** A keycode for `key` (a basic keycode 0x04-0xFF) held with modifiers. */
export const comboKeycode = (mods: readonly ModName[], key: number): number => {
  const bits = mods.reduce((acc, mod) => acc | MOD_BITS[mod], 0);
  return bits === 0 ? key & 0xff : (bits << 8) | (key & 0xff);
};

const QK_MODS = 0x0100;
const QK_MODS_MAX = 0x1fff;

const fallbackName = (title: string) => title.replace(/\s+/g, ' ').trim();

const layerName = (meta: BoardMeta, layer: number) => meta.layers[layer]?.name ?? `Layer ${layer}`;
const layerShort = (meta: BoardMeta, layer: number) => meta.layers[layer]?.short ?? `L${layer}`;
const layerOs = (meta: BoardMeta, layer: number): LayerOs => meta.layers[layer]?.os ?? 'any';

const macroName = (ctx: LegendContext, index: number) => {
  const given = ctx.macroNames?.[index]?.trim();
  return given && given.length > 0 ? given : `Macro ${index + 1}`;
};

interface Described {
  readonly legend: Legend;
  readonly name: string;
}

const basicDescribe = (value: number, ctx: LegendContext): Described => {
  const {table} = ctx;
  const os = layerOs(ctx.meta, ctx.layer);
  const code = table.codeOf(value);
  if (value === 0) {
    return {legend: {lines: [''], kind: 'empty'}, name: 'Nothing'};
  }
  if (value === 1) {
    return {legend: {lines: ['▽'], kind: 'transparent'}, name: 'Same as the layer below'};
  }
  const modifier = MODIFIER_CODES[code];
  if (modifier) {
    const label = modifierLabel(modifier.mod, os);
    return {legend: {lines: [label], kind: 'normal'}, name: `${modifier.side} ${label}`};
  }
  const shifted = SHIFTED[code];
  if (shifted) {
    return {legend: {lines: [shifted[0], shifted[1]], kind: 'normal'}, name: shifted[2]};
  }
  const basic = BASIC[code];
  if (basic) {
    return {
      legend: {lines: basic.legend.split('\n'), kind: basic.kind ?? 'normal', ...(basic.icon ? {icon: basic.icon} : {})},
      name: basic.name,
    };
  }
  const letter = /^KC_([A-Z])$/.exec(code);
  if (letter?.[1]) {
    return {legend: {lines: [letter[1]], kind: 'normal'}, name: letter[1]};
  }
  const fKey = /^KC_(F\d{1,2})$/.exec(code);
  if (fKey?.[1]) {
    return {legend: {lines: [fKey[1]], kind: 'normal'}, name: fKey[1]};
  }
  const keypad = /^KC_P(\d)$/.exec(code);
  if (keypad?.[1]) {
    return {legend: {lines: [keypad[1]], kind: 'normal'}, name: `Number pad ${keypad[1]}`};
  }
  const info = table.describe(value);
  const label = table.label(value);
  const kind: LegendKind = info.category === 'media' ? 'media' : info.category === 'qmk_lighting' ? 'lighting' : 'normal';
  return {legend: {lines: label.split('\n'), kind}, name: fallbackName(info.title)};
};

const describeValue = (value: number, ctx: LegendContext): Described => {
  const {table, meta} = ctx;
  const danger = keycodeDanger(value);
  if (danger) {
    return {legend: {lines: [danger.legend], kind: 'danger'}, name: danger.name};
  }
  if (value >= QK_MODS && value <= QK_MODS_MAX) {
    const bits = (value >> 8) & 0x1f;
    const key = basicDescribe(value & 0xff, ctx);
    const os = layerOs(meta, ctx.layer);
    const mods = modsFromBits(bits & 0x0f).map((mod) => modifierLabel(mod, os));
    const side = (bits & RIGHT_BIT) !== 0 ? 'Right ' : '';
    const keyLabel = key.legend.lines[key.legend.lines.length - 1] || key.name;
    return {
      legend: {lines: [mods.join('+'), keyLabel], kind: 'combo'},
      name: `${side}${mods.join(' + ')} + ${key.name}`,
    };
  }
  const info = table.describe(value);
  switch (info.kind) {
    case 'basic':
    case 'unknown':
      return basicDescribe(value, ctx);
    case 'layer': {
      const target = info.layer ?? 0;
      const op = info.code.slice(0, info.code.indexOf('('));
      const targetMeta = meta.layers[target];
      if (op === 'MO') {
        return {
          legend: {lines: targetMeta?.fn ? ['Fn'] : ['Hold', layerShort(meta, target)], kind: 'layer'},
          name: `Hold for ${layerName(meta, target)}`,
        };
      }
      const verbs: Readonly<Record<string, readonly [string, string]>> = {
        TG: ['Toggle', `Turn ${layerName(meta, target)} on or off`],
        TO: ['Go to', `Switch to ${layerName(meta, target)}`],
        DF: ['Default', `Make ${layerName(meta, target)} the default layer`],
        OSL: ['Once', `${layerName(meta, target)} for the next key only`],
        TT: ['Tap', `Hold for ${layerName(meta, target)}, tap a few times to stay`],
      };
      const verb = verbs[op] ?? [op, info.title];
      return {legend: {lines: [verb[0], layerShort(meta, target)], kind: 'layer'}, name: verb[1]};
    }
    case 'layer-tap': {
      const target = info.layer ?? 0;
      const tap = basicDescribe(value & 0xff, ctx);
      return {
        legend: {lines: [tap.legend.lines[tap.legend.lines.length - 1] || tap.name, `Hold ${layerShort(meta, target)}`], kind: 'layer'},
        name: `${tap.name} when tapped, ${layerName(meta, target)} while held`,
      };
    }
    case 'mod-tap': {
      const tap = basicDescribe(value & 0xff, ctx);
      const os = layerOs(meta, ctx.layer);
      const mods = modsFromBits((value >> 8) & 0x0f).map((mod) => modifierLabel(mod, os));
      return {
        legend: {lines: [tap.legend.lines[tap.legend.lines.length - 1] || tap.name, `Hold ${mods.join('+')}`], kind: 'combo'},
        name: `${tap.name} when tapped, ${mods.join(' + ')} while held`,
      };
    }
    case 'macro': {
      const index = info.index ?? 0;
      return {legend: {lines: [macroName(ctx, index)], kind: 'macro'}, name: `Macro: ${macroName(ctx, index)}`};
    }
    case 'custom': {
      const index = info.index ?? 0;
      const custom = table.customKeycodes[index];
      const named = custom ? meta.customKeys[custom.name] : undefined;
      if (named) {
        return {legend: {lines: named.legend.split('\n'), kind: 'custom'}, name: named.name};
      }
      return {legend: {lines: info.label.split('\n'), kind: 'custom'}, name: fallbackName(info.title)};
    }
    default:
      return {legend: {lines: table.label(value).split('\n'), kind: 'normal'}, name: fallbackName(info.title)};
  }
};

/** The keycap legend for a keycode on the context's layer. */
export const legendFor = (value: number, ctx: LegendContext, position?: {row: number; col: number}): Legend => {
  if (position) {
    const note = keyNoteFor(ctx.meta, ctx.layer, position.row, position.col);
    if (note?.legend) {
      return {lines: note.legend.split('\n'), kind: describeValue(value, ctx).legend.kind};
    }
  }
  return describeValue(value, ctx).legend;
};

/** A plain name for what a keycode does, such as "Volume up" or "Hold for Mac Fn". */
export const keycodeName = (value: number, ctx: LegendContext): string => describeValue(value, ctx).name;

/**
 * Whether a key on a Fn layer just repeats the layer underneath, so the UI
 * can fade it. Pass-through keys count as repeats.
 */
export const isRepeatOfBase = (meta: BoardMeta, keymap: readonly (readonly number[])[], layer: number, index: number): boolean => {
  const base = meta.layers[layer]?.base;
  if (base === undefined) {
    return false;
  }
  const value = keymap[layer]?.[index];
  return value === 1 || (value !== undefined && value === keymap[base]?.[index]);
};
