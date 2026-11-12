/*
 * Import of VIA's "Save + Load" layout files. The file shape and the
 * deprecated-keycode mapping follow the-via/app
 * src/components/panes/configure-panes/save-load.tsx (GPL-3.0).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */
import {ValidationError} from '../protocol/errors.ts';
import type {KeycodeTable} from '../keycodes/keycode-table.ts';

/** VIA's saved layout: keycode names per layer in matrix order, plus macro expressions. */
export interface ViaLayoutFile {
  readonly name: string;
  readonly vendorProductId: number;
  readonly layers: readonly (readonly string[])[];
  readonly macros?: readonly string[];
  readonly encoders?: readonly (readonly [string, string])[][];
}

export const isViaLayoutFile = (json: unknown): json is ViaLayoutFile =>
  typeof json === 'object' &&
  json !== null &&
  typeof (json as Record<string, unknown>)['name'] === 'string' &&
  Number.isInteger((json as Record<string, unknown>)['vendorProductId']) &&
  Array.isArray((json as Record<string, unknown>)['layers']);

export interface ImportedViaLayout {
  readonly name: string;
  /** Flat per-layer keymap. */
  readonly keymap: number[][];
  readonly macroExpressions: readonly string[] | null;
}

/** Converts a VIA layout file into keycodes for this keyboard. Throws on any unknown keycode. */
export const importViaLayout = (
  json: unknown,
  table: KeycodeTable,
  target: {vendorProductId: number; keysPerLayer: number; layerCount: number},
): ImportedViaLayout => {
  if (!isViaLayoutFile(json)) {
    throw new ValidationError('Not a VIA layout file: name, vendorProductId and layers are required');
  }
  if (json.vendorProductId !== target.vendorProductId) {
    throw new ValidationError(`This layout was saved for ${json.name}, a different keyboard`);
  }
  if (json.layers.length > target.layerCount) {
    throw new ValidationError(`The layout has ${json.layers.length} layers; the keyboard has ${target.layerCount}`);
  }
  const unknown: string[] = [];
  const keymap = json.layers.map((layer, layerIdx) => {
    if (layer.length !== target.keysPerLayer) {
      throw new ValidationError(`Layer ${layerIdx} has ${layer.length} keys; the keyboard has ${target.keysPerLayer}`);
    }
    return layer.map((code) => {
      const value = code === '' ? 0 : table.valueOf(code);
      if (value === null) {
        unknown.push(code);
        return 0;
      }
      return value;
    });
  });
  if (unknown.length > 0) {
    throw new ValidationError('The layout uses keycodes this keyboard does not know', [...new Set(unknown)].slice(0, 10));
  }
  return {name: json.name, keymap, macroExpressions: json.macros ?? null};
};
