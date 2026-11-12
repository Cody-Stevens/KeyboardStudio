/*
 * Parsing and printing of QMK "advanced" keycodes: modifiers with a key
 * (LCTL(KC_C)), mod-tap (MT), layer-tap (LT), layer-mod (LM), one-shot mods
 * (OSM), layer keys (MO/TG/TO/TT/OSL/DF), CUSTOM(n) and MACRO(n).
 *
 * Ported from the-via/app src/utils/advanced-keys.ts (GPL-3.0,
 * https://github.com/the-via/app, commit 935106a990af39bdd1ade881c02366eac486240d).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 *
 * Changes from upstream: strict typing, ranges are looked up by name instead
 * of relying on object key order, and parse failures return null instead of 0
 * (0 is KC_NO, a valid keycode).
 */

export type BasicKeyToByte = Readonly<Record<string, number>>;
export type ByteToKey = Readonly<Record<number, string>>;

const RANGE_NAMES = [
  '_QK_MODS',
  '_QK_MOD_TAP',
  '_QK_LAYER_TAP',
  '_QK_LAYER_MOD',
  '_QK_TO',
  '_QK_MOMENTARY',
  '_QK_DEF_LAYER',
  '_QK_TOGGLE_LAYER',
  '_QK_ONE_SHOT_LAYER',
  '_QK_ONE_SHOT_MOD',
  '_QK_LAYER_TAP_TOGGLE',
  '_QK_KB',
  '_QK_MACRO',
] as const;

export type QuantumRange = (typeof RANGE_NAMES)[number];

const modCodes = {
  QK_LCTL: 0x0100,
  QK_LSFT: 0x0200,
  QK_LALT: 0x0400,
  QK_LGUI: 0x0800,
  QK_RMODS_MIN: 0x1000,
  QK_RCTL: 0x1100,
  QK_RSFT: 0x1200,
  QK_RALT: 0x1400,
  QK_RGUI: 0x1800,
} as const;

const modMasks: Readonly<Record<string, number>> = {
  MOD_LCTL: 0x0001,
  MOD_LSFT: 0x0002,
  MOD_LALT: 0x0004,
  MOD_LGUI: 0x0008,
  MOD_RCTL: 0x0011,
  MOD_RSFT: 0x0012,
  MOD_RALT: 0x0014,
  MOD_RGUI: 0x0018,
  MOD_HYPR: 0x000f,
  MOD_MEH: 0x0007,
};

const topLevelMacroToRange: Readonly<Record<string, QuantumRange>> = {
  MT: '_QK_MOD_TAP',
  LT: '_QK_LAYER_TAP',
  LM: '_QK_LAYER_MOD',
  TO: '_QK_TO',
  MO: '_QK_MOMENTARY',
  DF: '_QK_DEF_LAYER',
  TG: '_QK_TOGGLE_LAYER',
  OSL: '_QK_ONE_SHOT_LAYER',
  OSM: '_QK_ONE_SHOT_MOD',
  TT: '_QK_LAYER_TAP_TOGGLE',
  CUSTOM: '_QK_KB',
  MACRO: '_QK_MACRO',
};

const rangeToTopLevelMacro: Readonly<Partial<Record<QuantumRange, string>>> = Object.fromEntries(
  Object.entries(topLevelMacroToRange).map(([macro, range]) => [range, macro]),
);

const modifierKeyToValue: Readonly<Record<string, number>> = {
  LCTL: modCodes.QK_LCTL,
  C: modCodes.QK_LCTL,
  LSFT: modCodes.QK_LSFT,
  S: modCodes.QK_LSFT,
  LALT: modCodes.QK_LALT,
  A: modCodes.QK_LALT,
  LGUI: modCodes.QK_LGUI,
  LCMD: modCodes.QK_LGUI,
  LWIN: modCodes.QK_LGUI,
  G: modCodes.QK_LGUI,
  RCTL: modCodes.QK_RCTL,
  RSFT: modCodes.QK_RSFT,
  ALGR: modCodes.QK_RALT,
  RALT: modCodes.QK_RALT,
  RCMD: modCodes.QK_RGUI,
  RWIN: modCodes.QK_RGUI,
  RGUI: modCodes.QK_RGUI,
  SCMD: modCodes.QK_LSFT | modCodes.QK_LGUI,
  SWIN: modCodes.QK_LSFT | modCodes.QK_LGUI,
  SGUI: modCodes.QK_LSFT | modCodes.QK_LGUI,
  LSG: modCodes.QK_LSFT | modCodes.QK_LGUI,
  LAG: modCodes.QK_LALT | modCodes.QK_LGUI,
  RSG: modCodes.QK_RSFT | modCodes.QK_RGUI,
  RAG: modCodes.QK_RALT | modCodes.QK_RGUI,
  LCA: modCodes.QK_LCTL | modCodes.QK_LALT,
  LSA: modCodes.QK_LSFT | modCodes.QK_LALT,
  SAGR: modCodes.QK_RSFT | modCodes.QK_RALT,
  RSA: modCodes.QK_RSFT | modCodes.QK_RALT,
  RCS: modCodes.QK_RCTL | modCodes.QK_RSFT,
  LCAG: modCodes.QK_LCTL | modCodes.QK_LALT | modCodes.QK_LGUI,
  MEH: modCodes.QK_LCTL | modCodes.QK_LALT | modCodes.QK_LSFT,
  HYPR: modCodes.QK_LCTL | modCodes.QK_LALT | modCodes.QK_LSFT | modCodes.QK_LGUI,
};

// Later aliases win, as in upstream's reduce.
const modifierValueToKey: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(modifierKeyToValue).map(([key, value]) => [value, key]),
);

const singleModValues: readonly number[] = Object.values(modCodes).filter((value) => value !== modCodes.QK_RMODS_MIN);

const singleModifierValueToKey = (right: boolean): [number, string][] =>
  Array.from(
    Object.entries(modifierKeyToValue)
      .filter(([, value]) => singleModValues.includes(value) && value >= modCodes.QK_RMODS_MIN === right)
      .reduce<Map<number, string>>((acc, [key, value]) => acc.set(value, key), new Map()),
  );

const leftModifierValueToKey = singleModifierValueToKey(false);
const rightModifierValueToKey = singleModifierValueToKey(true);

const rangeBounds = (basicKeyToByte: BasicKeyToByte, range: QuantumRange): [number, number] | null => {
  const min = basicKeyToByte[range];
  const max = basicKeyToByte[`${range}_MAX`];
  return min === undefined || max === undefined ? null : [min, max];
};

/** The quantum range a keycode falls in, with the range's first value. */
export const findQuantumRange = (
  keycode: number,
  basicKeyToByte: BasicKeyToByte,
): {range: QuantumRange; start: number} | null => {
  for (const range of RANGE_NAMES) {
    const bounds = rangeBounds(basicKeyToByte, range);
    if (bounds && keycode >= bounds[0] && keycode <= bounds[1]) {
      return {range, start: bounds[0]};
    }
  }
  return null;
};

const modValueToString = (modMask: number): string =>
  Object.entries(modMasks)
    .filter(([name, value]) => name !== 'MOD_HYPR' && name !== 'MOD_MEH' && (value & modMask) === value)
    .map(([name]) => name)
    .join(' | ');

const topLevelModToString = (keycode: number, byteToKey: ByteToKey): string => {
  const containedKeycode = byteToKey[keycode & 0x00ff] ?? `0x${(keycode & 0xff).toString(16)}`;
  const modifierValue = keycode & 0x1f00;
  const modifierKey = modifierValueToKey[modifierValue];
  if (modifierKey !== undefined) {
    return `${modifierKey}(${containedKeycode})`;
  }
  // Left and right mods are mutually exclusive: the bit shared by all right
  // mods picks which lookup to use.
  const enabledMods = (modifierValue & modCodes.QK_RMODS_MIN ? rightModifierValueToKey : leftModifierValueToKey)
    .filter(([value]) => (value & modifierValue) === value)
    .map(([, key]) => key);
  return `${enabledMods.join('(')}(${containedKeycode}${')'.repeat(enabledMods.length)}`;
};

/** Prints an advanced keycode, such as `LCTL(KC_C)` or `LT(1,KC_SPC)`. Returns null for basic keycodes. */
export const advancedKeycodeToString = (
  keycode: number,
  basicKeyToByte: BasicKeyToByte,
  byteToKey: ByteToKey,
): string | null => {
  const found = findQuantumRange(keycode, basicKeyToByte);
  if (!found) {
    return null;
  }
  const {range, start} = found;
  if (range === '_QK_MODS') {
    return topLevelModToString(keycode, byteToKey);
  }
  const macro = rangeToTopLevelMacro[range];
  if (!macro) {
    return null;
  }
  const remainder = keycode & ~start;
  const keyName = (byte: number) => byteToKey[byte] ?? `0x${byte.toString(16)}`;
  switch (range) {
    case '_QK_KB':
    case '_QK_MACRO':
      return `${macro}(${keycode - start})`;
    case '_QK_MOMENTARY':
    case '_QK_DEF_LAYER':
    case '_QK_TOGGLE_LAYER':
    case '_QK_ONE_SHOT_LAYER':
    case '_QK_LAYER_TAP_TOGGLE':
    case '_QK_TO':
      return `${macro}(${remainder})`;
    case '_QK_LAYER_TAP':
      return `${macro}(${remainder >> 8},${keyName(remainder & 0xff)})`;
    case '_QK_ONE_SHOT_MOD':
      return `${macro}(${modValueToString(remainder)})`;
    case '_QK_LAYER_MOD': {
      const mask = basicKeyToByte['_QK_LAYER_MOD_MASK'] ?? 0x1f;
      const shift = Math.log2(mask + 1);
      return `${macro}(${remainder >> shift},${modValueToString(remainder & mask)})`;
    }
    case '_QK_MOD_TAP':
      return `${macro}(${modValueToString((remainder >> 8) & 0x1f)},${keyName(remainder & 0xff)})`;
    default:
      return null;
  }
};

const parseMods = (input = ''): number | null => {
  const parts = input.split('|').map((part) => part.trim());
  let mods = 0;
  for (const part of parts) {
    const mask = modMasks[part];
    if (mask === undefined) {
      return null;
    }
    mods |= mask;
  }
  return mods === 0 ? null : mods;
};

const parseLayer = (input: string | undefined): number | null => {
  if (input === undefined || !/^\d+$/.test(input.trim())) {
    return null;
  }
  return Number.parseInt(input, 10);
};

const parseTopLevelMacro = (
  name: string,
  parameter: string,
  basicKeyToByte: BasicKeyToByte,
): number | null => {
  const range = topLevelMacroToRange[name];
  const bounds = range ? rangeBounds(basicKeyToByte, range) : null;
  if (!range || !bounds) {
    return null;
  }
  const [base, max] = bounds;
  const [param1, param2] = parameter.split(',').map((part) => part.trim());
  switch (name) {
    case 'MO':
    case 'DF':
    case 'TG':
    case 'OSL':
    case 'TT':
    case 'TO': {
      const layer = parseLayer(parameter);
      return layer === null || base + layer > max ? null : base | layer;
    }
    case 'OSM': {
      const mods = parseMods(parameter);
      return mods === null ? null : base | (mods & 0xff);
    }
    case 'LM': {
      const mask = basicKeyToByte['_QK_LAYER_MOD_MASK'] ?? 0x1f;
      const shift = Math.log2(mask + 1);
      const layer = parseLayer(param1);
      const mods = parseMods(param2);
      return layer === null || mods === null ? null : base | ((layer & 0xf) << shift) | (mods & mask);
    }
    case 'LT': {
      const layer = parseLayer(param1);
      const key = param2 === undefined ? undefined : basicKeyToByte[param2];
      return layer === null || key === undefined || key > 0xff ? null : base | ((layer & 0xf) << 8) | key;
    }
    case 'MT': {
      const mods = parseMods(param1);
      const key = param2 === undefined ? undefined : basicKeyToByte[param2];
      return mods === null || key === undefined || key > 0xff ? null : base | ((mods & 0x1f) << 8) | (key & 0xff);
    }
    case 'CUSTOM':
    case 'MACRO': {
      const n = parseLayer(parameter);
      return n === null || base + n > max ? null : base + n;
    }
    default:
      return null;
  }
};

const parseModifierCode = (parts: string[], basicKeyToByte: BasicKeyToByte): number | null => {
  const realParts = parts.filter((part) => part.length !== 0);
  let value = 0;
  for (const [idx, part] of realParts.entries()) {
    const byte = idx === realParts.length - 1 ? basicKeyToByte[part] : modifierKeyToValue[part];
    if (byte === undefined || (idx === realParts.length - 1 && byte > 0xff)) {
      return null;
    }
    value |= byte;
  }
  return value;
};

/** Parses an advanced keycode string. Returns null when the string is not valid. */
export const advancedStringToKeycode = (input: string, basicKeyToByte: BasicKeyToByte): number | null => {
  const upper = input.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z]+)\((.*)\)$/.exec(upper);
  if (!match) {
    return null;
  }
  const [, name = '', parameter = ''] = match;
  if (name in topLevelMacroToRange) {
    return parseTopLevelMacro(name, parameter, basicKeyToByte);
  }
  if (name in modifierKeyToValue) {
    return parseModifierCode(upper.split(/\(|\)/).map((part) => part.trim()), basicKeyToByte);
  }
  return null;
};
