/**
 * What restoring a snapshot would change, so the UI can say it before
 * anything is written.
 */
import {gridToKeymap, type KeyboardSnapshot, type MenuValues} from '../../core/index.ts';

export interface CurrentState {
  /** Flat keymap per layer. */
  readonly keymap: readonly (readonly number[])[];
  /** Macro buffer up to its last non-zero byte. */
  readonly macroBytes: readonly number[] | null;
  readonly macroExpressions: readonly string[];
  readonly menuValues: MenuValues;
  readonly layoutOptions: number | null;
}

export interface SnapshotDiff {
  /** Changed keys per layer; layers with no changes are left out. */
  readonly keys: readonly {readonly layer: number; readonly count: number}[];
  readonly totalKeys: number;
  /** Macro slots whose contents differ. */
  readonly macroSlots: readonly number[];
  /** Lighting command ids that differ. */
  readonly lighting: readonly string[];
  readonly layoutOptions: boolean;
  readonly isEmpty: boolean;
}

const sameBytes = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, idx) => value === b[idx]);

const trim = (bytes: readonly number[]) => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }
  return bytes.slice(0, end);
};

export const diffSnapshot = (snapshot: KeyboardSnapshot, current: CurrentState): SnapshotDiff => {
  const target = gridToKeymap(snapshot.keymap);
  const keys = target
    .map((layer, idx) => ({
      layer: idx,
      count: layer.filter((value, index) => value !== current.keymap[idx]?.[index]).length,
    }))
    .filter((entry) => entry.count > 0);
  const totalKeys = keys.reduce((sum, entry) => sum + entry.count, 0);

  let macroSlots: number[] = [];
  if (snapshot.macros && !sameBytes(trim(current.macroBytes ?? []), trim(snapshot.macros.bytes))) {
    const count = Math.max(snapshot.macros.expressions.length, current.macroExpressions.length);
    macroSlots = Array.from({length: count}, (_, idx) => idx).filter(
      (idx) => (snapshot.macros?.expressions[idx] ?? '') !== (current.macroExpressions[idx] ?? ''),
    );
    if (macroSlots.length === 0) {
      // The bytes differ but every expression reads the same: still a change.
      macroSlots = [0];
    }
  }

  const lighting = Object.entries(snapshot.lighting)
    .filter(([commandId, value]) => !sameBytes(current.menuValues[commandId], value.bytes))
    .map(([commandId]) => commandId);

  const layoutOptions = snapshot.layoutOptions !== null && snapshot.layoutOptions !== current.layoutOptions;
  return {
    keys,
    totalKeys,
    macroSlots,
    lighting,
    layoutOptions,
    isEmpty: totalKeys === 0 && macroSlots.length === 0 && lighting.length === 0 && !layoutOptions,
  };
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Lines that describe a diff in plain words, such as
 * "3 keys on Windows" or "Macros 1 and 4".
 */
export const describeDiff = (
  diff: SnapshotDiff,
  layerName: (layer: number) => string,
  lightingName: (commandId: string) => string,
): string[] => {
  const lines: string[] = diff.keys.map((entry) => `${plural(entry.count, 'key', 'keys')} on ${layerName(entry.layer)}`);
  if (diff.macroSlots.length > 0) {
    const slots = diff.macroSlots.map((slot) => String(slot + 1));
    const list = slots.length === 1 ? slots[0] : `${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]}`;
    lines.push(`${slots.length === 1 ? 'Macro' : 'Macros'} ${list}`);
  }
  if (diff.lighting.length > 0) {
    const names = [...new Set(diff.lighting.map(lightingName))];
    lines.push(`Lighting: ${names.join(', ')}`);
  }
  if (diff.layoutOptions) {
    lines.push('Layout options');
  }
  return lines;
};
