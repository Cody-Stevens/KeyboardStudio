/**
 * Per-board presentation metadata: what each layer is called, which layers
 * pair up, which lighting zone is which physical part, and plain names for
 * the board's custom keys. None of this exists in VIA definitions.
 *
 * A bundled board can ship a meta file next to its definition
 * (`bundled/<name>.meta.ts`). Every other board gets a generic fallback:
 * "Layer 0", "Layer 1", ..., no pairs, and zones matched by their labels.
 */
import {findBundledMeta} from './bundled/index.ts';
import {getMenuZones, type MenuZone} from './menus.ts';
import type {KeyboardDefinition} from './types.ts';

export type LayerOs = 'windows' | 'mac' | 'any';

export interface BoardLayerMeta {
  readonly index: number;
  /** Full name, such as "Windows Fn". */
  readonly name: string;
  /** Short name for tight spaces, such as "Win Fn". */
  readonly short: string;
  /** Which computer the layer is for; decides "Win" or "Cmd" legends. */
  readonly os: LayerOs;
  /** True for a layer that only applies while a Fn key is held. */
  readonly fn: boolean;
  /** For Fn layers: the layer underneath. Keys that match it are repeats. */
  readonly base?: number;
  /** The matching layer for the other computer, for "Also on Mac". */
  readonly pair?: number;
}

/** A physical part of the board that a lighting zone lights. */
export type BoardPart = 'backlight' | 'logo' | 'side';

export interface BoardZoneMeta {
  /** The zone's label in the definition's menus, matched without case. */
  readonly zoneLabel: string;
  readonly name: string;
  /** Where the light is, in a few words. */
  readonly description: string;
  readonly part: BoardPart;
}

export interface BoardKeyNote {
  /** Applies to every layer when omitted. */
  readonly layer?: number;
  readonly row: number;
  readonly col: number;
  readonly text: string;
  /** Replaces the keycap legend on that layer. */
  readonly legend?: string;
}

export interface CustomKeyName {
  readonly name: string;
  /** Keycap legend; `\n` splits two lines. */
  readonly legend: string;
}

export interface BoardLook {
  /** Text on the logo badge, if the board has a lit logo. */
  readonly logoText?: string;
}

export interface BoardMetaSource {
  readonly layers: readonly Omit<BoardLayerMeta, 'index'>[];
  readonly zones?: readonly BoardZoneMeta[];
  readonly keyNotes?: readonly BoardKeyNote[];
  /** Keyed by the custom keycode's `name` in the definition. */
  readonly customKeys?: Readonly<Record<string, CustomKeyName>>;
  readonly look?: BoardLook;
}

/** A resolved lighting zone: the definition's zone plus what it lights. */
export interface BoardZone {
  readonly zone: MenuZone;
  readonly name: string;
  readonly description: string;
  readonly part: BoardPart;
}

export interface BoardMeta {
  /** True when no meta file exists and names are generic. */
  readonly generic: boolean;
  readonly layers: readonly BoardLayerMeta[];
  readonly zones: readonly BoardZone[];
  readonly keyNotes: readonly BoardKeyNote[];
  readonly customKeys: Readonly<Record<string, CustomKeyName>>;
  readonly look: BoardLook;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Guesses the physical part of a zone from its label. */
export const guessZonePart = (label: string): BoardPart => {
  if (/logo|badge/i.test(label)) {
    return 'logo';
  }
  if (/side|edge|under ?glow|strip|bar/i.test(label)) {
    return 'side';
  }
  return 'backlight';
};

const genericZone = (zone: MenuZone): BoardZone => {
  const part = guessZonePart(zone.label);
  return {
    zone,
    name: capitalise(zone.label),
    description: part === 'logo' ? 'The lit logo' : part === 'side' ? 'Light along the edges' : 'Under the keys',
    part,
  };
};

export const genericLayers = (layerCount: number): BoardLayerMeta[] =>
  Array.from({length: layerCount}, (_, index) => ({index, name: `Layer ${index}`, short: `L${index}`, os: 'any', fn: false}));

/**
 * Builds the meta for a board from a meta source (or none). Layers beyond
 * the source's list get generic names; zones the source does not name are
 * matched by label.
 */
export const buildBoardMeta = (
  definition: Pick<KeyboardDefinition, 'menus'>,
  layerCount: number,
  source: BoardMetaSource | undefined,
): BoardMeta => {
  const generic = genericLayers(layerCount);
  const layers = generic.map((fallback, index) => {
    const named = source?.layers[index];
    if (!named) {
      return fallback;
    }
    const valid = (layer: number | undefined) => layer !== undefined && layer >= 0 && layer < layerCount && layer !== index;
    return {
      index,
      name: named.name,
      short: named.short,
      os: named.os,
      fn: named.fn,
      ...(valid(named.base) ? {base: named.base} : {}),
      ...(valid(named.pair) ? {pair: named.pair} : {}),
    };
  });
  const zones = getMenuZones(definition)
    .filter((zone) => zone.controls.length > 0)
    .map((zone) => {
      const named = source?.zones?.find((candidate) => candidate.zoneLabel.toLowerCase() === zone.label.toLowerCase());
      return named ? {zone, name: named.name, description: named.description, part: named.part} : genericZone(zone);
    });
  return {
    generic: source === undefined,
    layers,
    zones,
    keyNotes: source?.keyNotes ?? [],
    customKeys: source?.customKeys ?? {},
    look: source?.look ?? {},
  };
};

/** Meta for a connected board: its bundled meta file if there is one, otherwise generic. */
export const resolveBoardMeta = (
  definition: Pick<KeyboardDefinition, 'menus' | 'vendorProductId'>,
  layerCount: number,
): BoardMeta => buildBoardMeta(definition, layerCount, findBundledMeta(definition.vendorProductId));

/** The note for a key on a layer, if the meta has one. */
export const keyNoteFor = (meta: BoardMeta, layer: number, row: number, col: number): BoardKeyNote | undefined =>
  meta.keyNotes.find((note) => note.row === row && note.col === col && (note.layer === undefined || note.layer === layer));
