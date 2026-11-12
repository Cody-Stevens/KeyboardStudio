/**
 * The key picker's catalogue: plain categories and search over every
 * keycode a key can hold on this board.
 */
import {keycodeDanger, DANGEROUS_KEYCODES} from '../../core/index.ts';
import {comboKeycode, keycodeName, legendFor, type Legend, type LegendContext, type ModName} from './legends.ts';

export interface PickerItem {
  readonly value: number;
  readonly name: string;
  readonly legend: Legend;
  readonly category: PickerCategoryId;
  /** Lower-case text searched besides the name: QMK code, legend, aliases. */
  readonly keywords: string;
  /** Plain explanation for dangerous keys; the UI asks before using them. */
  readonly danger?: string;
}

export type PickerCategoryId = 'typing' | 'editing' | 'fkeys' | 'modifiers' | 'media' | 'lighting' | 'board' | 'layers' | 'macros' | 'special';

export interface PickerCategory {
  readonly id: PickerCategoryId;
  readonly label: string;
  readonly items: readonly PickerItem[];
}

const CATEGORY_LABELS: Readonly<Record<PickerCategoryId, string>> = {
  typing: 'Letters and symbols',
  editing: 'Editing and arrows',
  fkeys: 'F keys',
  modifiers: 'Modifiers',
  media: 'Media and apps',
  lighting: 'Lighting',
  board: 'This keyboard',
  layers: 'Layers',
  macros: 'Macros',
  special: 'Special',
};

const TYPING = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `KC_${letter}`),
  ...'1234567890'.split('').map((digit) => `KC_${digit}`),
  'KC_MINS',
  'KC_EQL',
  'KC_LBRC',
  'KC_RBRC',
  'KC_BSLS',
  'KC_SCLN',
  'KC_QUOT',
  'KC_GRV',
  'KC_COMM',
  'KC_DOT',
  'KC_SLSH',
  'KC_SPC',
  'KC_ENT',
  'KC_ESC',
  'KC_TAB',
  'KC_BSPC',
  'KC_NUBS',
];

const EDITING = [
  'KC_UP',
  'KC_DOWN',
  'KC_LEFT',
  'KC_RGHT',
  'KC_HOME',
  'KC_END',
  'KC_PGUP',
  'KC_PGDN',
  'KC_INS',
  'KC_DEL',
  'KC_CAPS',
  'KC_PSCR',
  'KC_SLCK',
  'KC_PAUS',
  'KC_NLCK',
  'KC_APP',
  ...'1234567890'.split('').map((digit) => `KC_P${digit}`),
  'KC_PSLS',
  'KC_PAST',
  'KC_PMNS',
  'KC_PPLS',
  'KC_PENT',
  'KC_PDOT',
];

const FKEYS = Array.from({length: 24}, (_, idx) => `KC_F${idx + 1}`);
const MODIFIERS = ['KC_LCTL', 'KC_LSFT', 'KC_LALT', 'KC_LGUI', 'KC_RCTL', 'KC_RSFT', 'KC_RALT', 'KC_RGUI'];
const MEDIA = [
  'KC_MUTE',
  'KC_VOLU',
  'KC_VOLD',
  'KC_MPLY',
  'KC_MNXT',
  'KC_MPRV',
  'KC_MSTP',
  'KC_BRIU',
  'KC_BRID',
  'KC_MSEL',
  'KC_MAIL',
  'KC_CALC',
  'KC_MYCM',
  'KC_WWW_SEARCH',
  'KC_WWW_HOME',
  'KC_WWW_BACK',
  'KC_WWW_FORWARD',
  'KC_WWW_REFRESH',
  'KC_MCTL',
  'KC_LPAD',
  'KC_PWR',
  'KC_SLEP',
];

/** Builds the picker for a board. `macroCount` and `layerCount` come from the keyboard. */
export const buildPicker = (ctx: LegendContext, layerCount: number, macroCount: number): PickerCategory[] => {
  const {table} = ctx;
  const item = (value: number, category: PickerCategoryId, extra = ''): PickerItem => {
    const name = keycodeName(value, ctx);
    const legend = legendFor(value, ctx);
    const danger = keycodeDanger(value);
    return {
      value,
      name,
      legend,
      category,
      keywords: `${table.codeOf(value)} ${legend.lines.join(' ')} ${extra}`.toLowerCase(),
      ...(danger ? {danger: danger.explanation} : {}),
    };
  };
  const fromCodes = (codes: readonly string[], category: PickerCategoryId) =>
    codes.flatMap((code) => {
      const value = table.valueOf(code);
      return value === null ? [] : [item(value, category)];
    });

  const lighting = table.categories().find((category) => category.id === 'qmk_lighting');
  const layers: PickerItem[] = [];
  for (const op of ['MO', 'TG', 'TO', 'OSL'] as const) {
    for (let layer = 0; layer < layerCount; layer++) {
      const value = table.valueOf(`${op}(${layer})`);
      if (value !== null) {
        layers.push(item(value, 'layers', `layer ${layer} fn`));
      }
    }
  }
  const custom = table.customKeycodes.map((keycode, index) => {
    const value = table.valueOf(`CUSTOM(${index})`);
    return value === null ? null : item(value, 'board', `${keycode.name} ${keycode.title} ${keycode.shortName ?? ''}`);
  });
  const macros = Array.from({length: macroCount}, (_, index) => table.valueOf(`MACRO(${index})`))
    .filter((value): value is number => value !== null)
    .map((value) => item(value, 'macros', 'macro'));
  const special = [item(0, 'special', 'none off disable blank'), item(1, 'special', 'transparent pass through trns'), ...DANGEROUS_KEYCODES.map((value) => item(value, 'special', 'reset eeprom boot'))];

  const categories: PickerCategory[] = [
    {id: 'typing', label: CATEGORY_LABELS.typing, items: fromCodes(TYPING, 'typing')},
    {id: 'editing', label: CATEGORY_LABELS.editing, items: fromCodes(EDITING, 'editing')},
    {id: 'fkeys', label: CATEGORY_LABELS.fkeys, items: fromCodes(FKEYS, 'fkeys')},
    {id: 'modifiers', label: CATEGORY_LABELS.modifiers, items: fromCodes(MODIFIERS, 'modifiers')},
    {id: 'media', label: CATEGORY_LABELS.media, items: fromCodes(MEDIA, 'media')},
    {
      id: 'lighting',
      label: CATEGORY_LABELS.lighting,
      items: (lighting?.keycodes ?? []).map((entry) => item(entry.value, 'lighting', `${entry.name} ${entry.title ?? ''} light rgb`)),
    },
    {id: 'board', label: CATEGORY_LABELS.board, items: custom.filter((entry): entry is PickerItem => entry !== null)},
    {id: 'layers', label: CATEGORY_LABELS.layers, items: layers},
    {id: 'macros', label: CATEGORY_LABELS.macros, items: macros},
    {id: 'special', label: CATEGORY_LABELS.special, items: special},
  ];
  return categories.filter((category) => category.items.length > 0);
};

/**
 * Searches the picker. Exact name matches first, then names that start
 * with the query, then anything that mentions it.
 */
export const searchPicker = (categories: readonly PickerCategory[], query: string, limit = 48): PickerItem[] => {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const scored: {item: PickerItem; score: number}[] = [];
  const seen = new Set<number>();
  for (const category of categories) {
    for (const item of category.items) {
      if (seen.has(item.value)) {
        continue;
      }
      const name = item.name.toLowerCase();
      const legend = item.legend.lines.join(' ').toLowerCase();
      let score = -1;
      if (name === q || legend === q) score = 0;
      else if (name.startsWith(q) || legend.startsWith(q)) score = 1;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 2;
      else if (name.includes(q) || item.keywords.includes(q)) score = 3;
      if (score >= 0) {
        seen.add(item.value);
        scored.push({item, score});
      }
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length)
    .slice(0, limit)
    .map((entry) => entry.item);
};

/** A picker item for a key combined with modifiers, such as Ctrl + C. */
export const comboItem = (ctx: LegendContext, mods: readonly ModName[], baseValue: number): PickerItem => {
  const value = comboKeycode(mods, baseValue);
  return {value, name: keycodeName(value, ctx), legend: legendFor(value, ctx), category: 'typing', keywords: ''};
};
