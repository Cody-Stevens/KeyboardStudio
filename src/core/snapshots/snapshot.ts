/**
 * Snapshot files: the full state of a keyboard (keymap, macros, lighting,
 * layout options) as JSON, so it can be saved, shared and restored.
 */
import {ValidationError} from '../protocol/errors.ts';
import type {Keymap, MatrixSize} from '../protocol/keyboard-api.ts';

export const SNAPSHOT_FORMAT = 'keyboard-studio/snapshot';
export const SNAPSHOT_VERSION = 1;

export interface SnapshotLightingValue {
  readonly channel: number;
  readonly valueId: number;
  readonly bytes: readonly number[];
}

export interface KeyboardSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly createdAt: string;
  readonly keyboard: {
    readonly name: string;
    readonly vendorId: number;
    readonly productId: number;
    readonly vendorProductId: number;
    readonly protocol: number;
  };
  readonly matrix: MatrixSize;
  readonly layerCount: number;
  /** `[layer][row][col]` 16-bit keycodes. */
  readonly keymap: readonly (readonly (readonly number[])[])[];
  readonly macros: {
    readonly count: number;
    readonly bufferSize: number;
    /** Human-readable form. `bytes` is authoritative on restore. */
    readonly expressions: readonly string[];
    /** Macro buffer contents up to the last non-zero byte. */
    readonly bytes: readonly number[];
  } | null;
  /** Custom menu values keyed by command id. */
  readonly lighting: Readonly<Record<string, SnapshotLightingValue>>;
  /** Packed layout options value, or null when the keyboard does not report it. */
  readonly layoutOptions: number | null;
}

/** `[layer][row][col]` from flat per-layer arrays. */
export const keymapToGrid = (keymap: Keymap, cols: number): number[][][] =>
  keymap.map((layer) => Array.from({length: Math.ceil(layer.length / cols)}, (_, row) => layer.slice(row * cols, (row + 1) * cols)));

/** Flat per-layer arrays from `[layer][row][col]`. */
export const gridToKeymap = (grid: readonly (readonly (readonly number[])[])[]): number[][] => grid.map((layer) => layer.flat());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isByte = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;
const isWord = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff;

/** Validates untrusted JSON as a snapshot. */
export const parseSnapshot = (json: unknown): KeyboardSnapshot => {
  const problems: string[] = [];
  if (!isRecord(json)) {
    throw new ValidationError('A snapshot must be a JSON object');
  }
  if (json['format'] !== SNAPSHOT_FORMAT) {
    throw new ValidationError(`Not a KeyboardStudio snapshot (format must be "${SNAPSHOT_FORMAT}")`);
  }
  if (json['version'] !== SNAPSHOT_VERSION) {
    throw new ValidationError(`Unsupported snapshot version ${String(json['version'])}`);
  }
  const keyboard = json['keyboard'];
  const matrix = json['matrix'];
  if (!isRecord(keyboard) || !Number.isInteger(keyboard['vendorProductId'])) {
    problems.push('keyboard.vendorProductId is missing');
  }
  if (!isRecord(matrix) || !Number.isInteger(matrix['rows']) || !Number.isInteger(matrix['cols'])) {
    problems.push('matrix.rows and matrix.cols are required');
  }
  const layerCount = json['layerCount'];
  const keymap = json['keymap'];
  if (!Number.isInteger(layerCount)) {
    problems.push('layerCount is required');
  }
  if (
    !Array.isArray(keymap) ||
    keymap.length !== layerCount ||
    !keymap.every(
      (layer: unknown) =>
        Array.isArray(layer) &&
        isRecord(matrix) &&
        layer.length === matrix['rows'] &&
        layer.every((row: unknown) => Array.isArray(row) && row.length === matrix['cols'] && row.every(isWord)),
    )
  ) {
    problems.push('keymap must be [layer][row][col] 16-bit keycodes matching layerCount and matrix');
  }
  const macros = json['macros'];
  if (macros !== null && macros !== undefined) {
    if (
      !isRecord(macros) ||
      !Array.isArray(macros['bytes']) ||
      !macros['bytes'].every(isByte) ||
      !Array.isArray(macros['expressions'])
    ) {
      problems.push('macros must have bytes (0-255) and expressions');
    }
  }
  const lighting = json['lighting'];
  if (!isRecord(lighting)) {
    problems.push('lighting must be an object');
  } else {
    for (const [id, value] of Object.entries(lighting)) {
      if (
        !isRecord(value) ||
        !isByte(value['channel']) ||
        !isByte(value['valueId']) ||
        !Array.isArray(value['bytes']) ||
        !value['bytes'].every(isByte)
      ) {
        problems.push(`lighting.${id} must have channel, valueId and bytes`);
      }
    }
  }
  const layoutOptions = json['layoutOptions'];
  if (layoutOptions !== null && layoutOptions !== undefined && !Number.isInteger(layoutOptions)) {
    problems.push('layoutOptions must be an integer or null');
  }
  if (problems.length > 0) {
    throw new ValidationError('The snapshot is not valid', problems);
  }
  // Every field was checked above.
  return {...json, macros: macros ?? null, layoutOptions: layoutOptions ?? null} as unknown as KeyboardSnapshot;
};

export interface SnapshotTarget {
  readonly vendorProductId: number;
  readonly matrix: MatrixSize;
  readonly layerCount: number;
  readonly macroCount: number;
  readonly macroBufferSize: number;
}

/** Reasons a snapshot cannot be restored onto a keyboard. Empty when it can. */
export const snapshotIncompatibilities = (snapshot: KeyboardSnapshot, target: SnapshotTarget): string[] => {
  const problems: string[] = [];
  if (snapshot.keyboard.vendorProductId !== target.vendorProductId) {
    problems.push(`the snapshot is for ${snapshot.keyboard.name}, a different keyboard`);
  }
  if (snapshot.matrix.rows !== target.matrix.rows || snapshot.matrix.cols !== target.matrix.cols) {
    problems.push('the key matrix size differs');
  }
  if (snapshot.layerCount !== target.layerCount) {
    problems.push(`the snapshot has ${snapshot.layerCount} layers; the keyboard has ${target.layerCount}`);
  }
  if (snapshot.macros && snapshot.macros.bytes.length > target.macroBufferSize) {
    problems.push(`the macros need ${snapshot.macros.bytes.length} bytes; the keyboard holds ${target.macroBufferSize}`);
  }
  return problems;
};

/** Pretty JSON with one keymap row per line. */
export const serializeSnapshot = (snapshot: KeyboardSnapshot): string => {
  const placeholder = '__KEYMAP__';
  const text = JSON.stringify({...snapshot, keymap: placeholder}, null, 2);
  const keymap = snapshot.keymap
    .map((layer) => `    [\n${layer.map((row) => `      [${row.join(', ')}]`).join(',\n')}\n    ]`)
    .join(',\n');
  return text.replace(`"${placeholder}"`, `[\n${keymap}\n  ]`);
};

/** Suggested file name, such as `linky87-2026-11-12.keyboard-studio.json`. */
export const snapshotFileName = (snapshot: KeyboardSnapshot): string =>
  `${snapshot.keyboard.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'keyboard'}-${snapshot.createdAt.slice(0, 10)}.keyboard-studio.json`;
