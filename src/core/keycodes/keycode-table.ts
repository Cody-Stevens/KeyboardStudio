/*
 * Keycode <-> name/label/category lookups for one keyboard.
 *
 * The lookup rules (getByteToKey, getCodeForByte, getByteForCode,
 * getLabelForByte, getOtherMenu, getKeycodesForKeyboard) are ported from
 * the-via/app src/utils/key.ts and src/utils/keyboard-rendering.ts (GPL-3.0,
 * commit 935106a990af39bdd1ade881c02366eac486240d).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */
import {ProtocolError} from '../protocol/errors.ts';
import {toHex} from '../protocol/bytes.ts';
import {advancedKeycodeToString, advancedStringToKeycode, findQuantumRange, type BasicKeyToByte} from './advanced.ts';
import {
  categoriesForKeycodeModule,
  getKeycodes,
  getQMKLightingKeycodes,
  getShortNameForKeycode,
  type IKeycode,
  type IKeycodeMenu,
} from './catalog.ts';
import deprecatedKeycodes from './deprecated.ts';
import type {MacroKeyResolver} from '../macros/codec.ts';
import v12KeyToByte from './v12.ts';

export interface CustomKeycodeDefinition {
  readonly name: string;
  readonly title: string;
  readonly shortName?: string;
}

export type KeycodeKind =
  | 'basic'
  | 'modified'
  | 'mod-tap'
  | 'layer-tap'
  | 'layer-mod'
  | 'layer'
  | 'one-shot-mod'
  | 'macro'
  | 'custom'
  | 'unknown';

export interface KeycodeInfo {
  readonly value: number;
  /** QMK-style code: `KC_A`, `MO(1)`, `LCTL(KC_C)`, `CUSTOM(3)`, or hex when unknown. */
  readonly code: string;
  /** Short legend for a keycap. May contain `\n` between a shifted and an unshifted legend. */
  readonly label: string;
  /** Longer description for tooltips. */
  readonly title: string;
  /** Picker category id, such as `basic`, `layers` or `custom`. */
  readonly category: string;
  readonly kind: KeycodeKind;
  /** Target layer for layer keys (MO, TG, TO, TT, OSL, DF, LT, LM). */
  readonly layer?: number;
  /** Index for MACRO(n) and CUSTOM(n). */
  readonly index?: number;
}

export interface KeycodeCategory {
  readonly id: string;
  readonly label: string;
  readonly keycodes: readonly KeycodeEntry[];
}

export interface KeycodeEntry {
  readonly code: string;
  readonly value: number;
  readonly name: string;
  readonly title?: string;
  readonly shortName?: string;
}

export interface KeycodeTableOptions {
  /** VIA protocol version reported by the keyboard. */
  readonly protocol: number;
  readonly customKeycodes?: readonly CustomKeycodeDefinition[];
  readonly macroCount?: number;
  /** Definition `keycodes` modules, such as `qmk_lighting`. */
  readonly keycodeModules?: readonly string[];
  /** Common menu ids from a V3 definition's `menus`. */
  readonly commonMenuIds?: readonly string[];
  /** True for V2 definitions with a `lighting` preset. */
  readonly hasV2Lighting?: boolean;
}

const LAYER_RANGE_KIND: Readonly<Record<string, KeycodeKind>> = {
  _QK_TO: 'layer',
  _QK_MOMENTARY: 'layer',
  _QK_DEF_LAYER: 'layer',
  _QK_TOGGLE_LAYER: 'layer',
  _QK_ONE_SHOT_LAYER: 'layer',
  _QK_LAYER_TAP_TOGGLE: 'layer',
  _QK_LAYER_TAP: 'layer-tap',
  _QK_LAYER_MOD: 'layer-mod',
  _QK_MOD_TAP: 'mod-tap',
  _QK_ONE_SHOT_MOD: 'one-shot-mod',
  _QK_MODS: 'modified',
  _QK_MACRO: 'macro',
  _QK_KB: 'custom',
};

/** Protocols whose keycode layout this core ships. */
export const SUPPORTED_KEYCODE_PROTOCOLS: readonly number[] = [12];

const basicTableFor = (protocol: number): BasicKeyToByte => {
  if (protocol === 12) {
    return v12KeyToByte;
  }
  throw new ProtocolError(
    `Keycode tables for VIA protocol ${protocol} are not bundled yet. Supported: ${SUPPORTED_KEYCODE_PROTOCOLS.join(', ')}`,
  );
};

const catalogList: readonly IKeycode[] = getKeycodes().flatMap((menu) => menu.keycodes);
const catalogByCode: ReadonlyMap<string, IKeycode> = new Map(catalogList.map((keycode) => [keycode.code, keycode]));
const catalogCategoryByCode: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const menu of getKeycodes()) {
    for (const keycode of menu.keycodes) {
      if (!map.has(keycode.code)) {
        map.set(keycode.code, menu.id);
      }
    }
  }
  return map;
})();

/**
 * Reverse lookup. When several names share a value, the one in VIA's catalog
 * wins, otherwise the first one in the table (upstream getByteToKey).
 */
const buildByteToKey = (basicKeyToByte: BasicKeyToByte): Record<number, string> => {
  const result: Record<number, string> = {};
  for (const [code, value] of Object.entries(basicKeyToByte)) {
    if (!(value in result)) {
      result[value] = code;
    } else if (catalogByCode.has(code) && !catalogByCode.has(result[value] ?? '')) {
      result[value] = code;
    }
  }
  return result;
};

/** Keycode lookups for one keyboard: its protocol, custom keycodes and macro count. */
export class KeycodeTable {
  readonly protocol: number;
  readonly basicKeyToByte: BasicKeyToByte;
  readonly byteToKey: Readonly<Record<number, string>>;
  readonly customKeycodes: readonly CustomKeycodeDefinition[];
  readonly macroCount: number;
  private readonly options: KeycodeTableOptions;
  private readonly customAliases: ReadonlyMap<string, number>;

  constructor(options: KeycodeTableOptions) {
    this.options = options;
    this.protocol = options.protocol;
    this.basicKeyToByte = basicTableFor(options.protocol);
    this.byteToKey = buildByteToKey(this.basicKeyToByte);
    this.customKeycodes = options.customKeycodes ?? [];
    this.macroCount = options.macroCount ?? 16;
    const kbBase = this.basicKeyToByte['_QK_KB'] ?? 0x7e00;
    const aliases = new Map<string, number>();
    this.customKeycodes.forEach((keycode, index) => {
      for (const alias of [keycode.shortName, keycode.name]) {
        if (alias && !aliases.has(alias.toUpperCase())) {
          aliases.set(alias.toUpperCase(), kbBase + index);
        }
      }
    });
    this.customAliases = aliases;
  }

  /** QMK-style code for a keycode value (upstream getCodeForByte). Unknown values print as hex. */
  codeOf(value: number): string {
    const basic = this.byteToKey[value];
    if (basic !== undefined && !basic.startsWith('_QK')) {
      return basic;
    }
    return advancedKeycodeToString(value, this.basicKeyToByte, this.byteToKey) ?? toHex(value);
  }

  /**
   * Keycode value for a code (upstream getByteForCode). Accepts table names,
   * advanced forms such as `LT(1,KC_SPC)`, deprecated aliases from old VIA
   * layout files, hex values, and the definition's custom keycode names.
   * Returns null when the code is not recognised.
   */
  valueOf(code: string): number | null {
    const trimmed = code.trim();
    const direct = this.basicKeyToByte[trimmed];
    if (direct !== undefined && !trimmed.startsWith('_')) {
      return direct;
    }
    const deprecated = deprecatedKeycodes[trimmed];
    if (deprecated !== undefined) {
      return this.valueOf(deprecated);
    }
    if (/^0x[0-9a-f]{1,4}$/i.test(trimmed)) {
      return Number.parseInt(trimmed, 16);
    }
    const custom = this.customAliases.get(trimmed.toUpperCase());
    if (custom !== undefined) {
      return custom;
    }
    return advancedStringToKeycode(trimmed, this.basicKeyToByte);
  }

  describe(value: number): KeycodeInfo {
    const code = this.codeOf(value);
    const found = findQuantumRange(value, this.basicKeyToByte);
    const kind: KeycodeKind = found
      ? (LAYER_RANGE_KIND[found.range] ?? 'unknown')
      : this.byteToKey[value] !== undefined
        ? 'basic'
        : 'unknown';
    const layer = this.layerOf(value, found);
    const index = kind === 'macro' || kind === 'custom' ? value - (found?.start ?? 0) : undefined;

    if (kind === 'custom' && index !== undefined) {
      const custom = this.customKeycodes[index];
      if (custom) {
        return {
          value,
          code,
          label: getShortNameForKeycode({code, name: custom.name, ...(custom.shortName ? {shortName: custom.shortName} : {})}),
          title: custom.title,
          category: 'custom',
          kind,
          index,
        };
      }
    }
    const entry = catalogByCode.get(code);
    const label = entry ? getShortNameForKeycode(entry) : code;
    const title = entry ? (entry.title ?? entry.name) : kind === 'macro' ? `Macro ${index ?? ''}` : code;
    const category =
      catalogCategoryByCode.get(code) ??
      (kind === 'macro'
        ? 'macro'
        : kind === 'custom'
          ? 'custom'
          : kind === 'layer' || kind === 'layer-tap' || kind === 'layer-mod'
            ? 'layers'
            : kind === 'modified' || kind === 'mod-tap' || kind === 'one-shot-mod'
              ? 'special'
              : 'other');
    return {
      value,
      code,
      label: kind === 'macro' && index !== undefined ? `M${index}` : label,
      title,
      category,
      kind,
      ...(layer === undefined ? {} : {layer}),
      ...(index === undefined ? {} : {index}),
    };
  }

  /**
   * Key lookups for macros. A macro stores one byte per key, so only basic
   * keycodes (0x00-0xFF) can appear in one.
   */
  macroKeys(): MacroKeyResolver {
    return {
      byteOf: (name) => {
        const value = this.valueOf(name);
        return value !== null && value <= 0xff ? value : null;
      },
      nameOf: (byte) => {
        const name = this.byteToKey[byte];
        return name !== undefined && !name.startsWith('_') ? name : toHex(byte, 2);
      },
    };
  }

  /** Keycap legend sized for a key `widthUnits` wide (upstream getLabelForByte). */
  label(value: number, widthUnits = 1): string {
    const info = this.describe(value);
    const entry = catalogByCode.get(info.code);
    if (info.kind === 'custom' && info.index !== undefined) {
      const custom = this.customKeycodes[info.index];
      if (custom) {
        return getShortNameForKeycode(
          {code: info.code, name: custom.name, ...(custom.shortName ? {shortName: custom.shortName} : {})},
          widthUnits * 100,
        );
      }
    }
    return entry ? getShortNameForKeycode(entry, widthUnits * 100) : info.label;
  }

  /**
   * Picker categories for this keyboard (upstream getKeycodesForKeyboard plus
   * the custom and other menus). Codes the protocol table cannot encode are
   * left out.
   */
  categories(): KeycodeCategory[] {
    const modules = this.options.keycodeModules ?? [];
    const include = new Set([
      ...categoriesForKeycodeModule('default'),
      ...(this.options.hasV2Lighting ? categoriesForKeycodeModule('qmk_lighting') : modules.flatMap(categoriesForKeycodeModule)),
    ]);
    const toEntries = (keycodes: readonly IKeycode[]): KeycodeEntry[] =>
      keycodes.flatMap((keycode) => {
        const value = this.valueOf(keycode.code);
        return value === null
          ? []
          : [
              {
                code: keycode.code,
                value,
                name: keycode.name,
                ...(keycode.title === undefined ? {} : {title: keycode.title}),
                ...(keycode.shortName === undefined ? {} : {shortName: keycode.shortName}),
              },
            ];
      });

    const menus: KeycodeCategory[] = getKeycodes(this.macroCount)
      .filter((menu: IKeycodeMenu) => include.has(menu.id))
      .map((menu) => ({
        id: menu.id,
        label: menu.label,
        keycodes: toEntries(
          menu.id === 'qmk_lighting'
            ? getQMKLightingKeycodes(
                {
                  hasV2Lighting: this.options.hasV2Lighting ?? false,
                  keycodeModules: modules,
                  commonMenuIds: this.options.commonMenuIds ?? [],
                },
                this.protocol,
              )
            : menu.keycodes,
        ),
      }));

    const kbBase = this.basicKeyToByte['_QK_KB'] ?? 0x7e00;
    if (this.customKeycodes.length > 0) {
      menus.push({
        id: 'custom',
        label: 'Custom',
        keycodes: this.customKeycodes.map((keycode, index) => ({
          code: `CUSTOM(${index})`,
          value: kbBase + index,
          name: keycode.name,
          title: keycode.title,
          ...(keycode.shortName === undefined ? {} : {shortName: keycode.shortName}),
        })),
      });
    }

    const catalogCodes = new Set(catalogList.map(({code}) => code));
    menus.push({
      id: 'other',
      label: 'Other',
      keycodes: Object.entries(this.basicKeyToByte)
        .filter(([code]) => !code.startsWith('_QK') && !catalogCodes.has(code))
        .map(([code, value]) => ({code, value, name: code.replace('KC_', '').replace(/_/g, ' ')})),
    });
    return menus;
  }

  private layerOf(value: number, found: ReturnType<typeof findQuantumRange>): number | undefined {
    if (!found) {
      return undefined;
    }
    const remainder = value - found.start;
    switch (found.range) {
      case '_QK_TO':
      case '_QK_MOMENTARY':
      case '_QK_DEF_LAYER':
      case '_QK_TOGGLE_LAYER':
      case '_QK_ONE_SHOT_LAYER':
      case '_QK_LAYER_TAP_TOGGLE':
        return remainder;
      case '_QK_LAYER_TAP':
        return (remainder >> 8) & 0xf;
      case '_QK_LAYER_MOD': {
        const mask = this.basicKeyToByte['_QK_LAYER_MOD_MASK'] ?? 0x1f;
        return remainder >> Math.log2(mask + 1);
      }
      default:
        return undefined;
    }
  }
}
