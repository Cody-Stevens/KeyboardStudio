import {packLayoutOptions, unpackLayoutOptions} from '../protocol/bytes.ts';
import type {KeyboardLayout, LayoutKey} from './types.ts';

/** Decodes the keyboard's 32-bit layout options value into one choice per option. */
export const decodeLayoutOptions = (layout: KeyboardLayout, value: number): number[] =>
  unpackLayoutOptions(
    value,
    layout.options.map((option) => option.choices.length),
  );

/** Encodes one choice per option into the keyboard's 32-bit layout options value. */
export const encodeLayoutOptions = (layout: KeyboardLayout, choices: readonly number[]): number =>
  packLayoutOptions(layout.options.map((option, idx) => ({choice: choices[idx] ?? 0, numChoices: option.choices.length})));

/**
 * Keys to draw for the chosen layout options: every fixed key plus the keys
 * of each option's chosen alternative. Decals are left in; filter on `d` to
 * drop them.
 */
export const visibleKeys = (layout: KeyboardLayout, choices: readonly number[]): LayoutKey[] => [
  ...layout.keys,
  ...layout.options.flatMap((option) => layout.optionKeys[String(option.index)]?.[String(choices[option.index] ?? 0)] ?? []),
];

/** Flat keymap index for a key. */
export const matrixIndex = (key: Pick<LayoutKey, 'row' | 'col'>, cols: number): number => key.row * cols + key.col;
