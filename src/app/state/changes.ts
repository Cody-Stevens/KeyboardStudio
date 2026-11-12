/**
 * Every change the user makes goes through here: it calls the store, adds a
 * line to the session's change log and knows how to undo itself. A line's
 * status (saving, saved, did not save) comes from the store's write records.
 */
import {atom, computed} from 'nanostores';
import {
  encodeMacros,
  errorMessage,
  expressionToRawSequence,
  importViaLayout,
  isViaLayoutFile,
  macroBytesNeeded,
  parseSnapshot,
  validateMacroExpression,
  type ControlInput,
  type KeyboardSnapshot,
  type MenuControl,
  type WriteHandle,
  type WriteRecord,
} from '../../core/index.ts';
import {keycodeName} from '../logic/legends.ts';
import {controlLabel, effectLabel, hueSatCss} from '../logic/lighting.ts';
import {appendEntry, entryStatus, lampFor, type EntryStatus, type LogEntryBase} from '../logic/write-log.ts';
import {$macroNames, $session, legendContext, physicalKeyName, setMacroName, store, type SessionView} from './session.ts';
import {$layer, pulseKey} from './ui.ts';

export interface LogEntry extends LogEntryBase {
  /** A colour swatch for lighting lines. */
  readonly swatch?: string;
  /** Reverts the change. Returns the new entry's id, or null if it could not start. */
  readonly undo?: () => number | null;
}

export const $log = atom<readonly LogEntry[]>([]);
let nextEntryId = 1;

const writesById = computed(store.$writes, (writes) => new Map<number, WriteRecord>(writes.map((record) => [record.id, record])));

export const $entryStatuses = computed([$log, writesById], (log, writes) => new Map<number, EntryStatus>(log.map((entry) => [entry.id, entryStatus(entry.writeIds, writes)])));

export const $lamp = computed([store.$connection, $log, $entryStatuses, store.$pendingWrites], (connection, log, statuses, pending) =>
  lampFor(
    connection,
    log.map((entry) => statuses.get(entry.id) ?? {state: 'pending'}),
    pending,
  ),
);

const mergeEntries = (previous: LogEntry, next: LogEntry): LogEntry => ({
  ...next,
  id: previous.id,
  at: previous.at,
  writeIds: [...previous.writeIds, ...next.writeIds],
  // Undo returns to the value before the first change in the merged run.
  ...(previous.undo ? {undo: previous.undo} : {}),
});

const addEntry = (entry: Omit<LogEntry, 'id' | 'at'>): number => {
  const full: LogEntry = {...entry, id: nextEntryId++, at: Date.now()};
  const next = appendEntry($log.get(), full, mergeEntries);
  $log.set(next);
  return next[next.length - 1]?.id ?? full.id;
};

const markUndone = (id: number, by: number) =>
  $log.set($log.get().map((entry) => (entry.id === id ? {...entry, undoneBy: by} : entry.id === by ? {...entry, undoes: id} : entry)));

/** Undoes one log line. */
export const undoEntry = (id: number): void => {
  const entry = $log.get().find((candidate) => candidate.id === id);
  if (!entry?.undo || entry.undoneBy !== undefined) {
    return;
  }
  const undoId = entry.undo();
  if (undoId !== null) {
    markUndone(id, undoId);
  }
};

/** Undoes the newest line that can still be undone (Ctrl+Z). */
export const undoLatest = (): boolean => {
  const statuses = $entryStatuses.get();
  const entry = [...$log.get()].reverse().find((candidate) => candidate.undo && candidate.undoneBy === undefined && candidate.undoes === undefined && statuses.get(candidate.id)?.state === 'saved');
  if (!entry) {
    return false;
  }
  undoEntry(entry.id);
  return true;
};

const requireLive = (): SessionView | null => {
  const session = $session.get();
  return session && !session.stale ? session : null;
};

const joinNames = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

interface KeyWrite {
  readonly layer: number;
  readonly matrix: number;
  readonly value: number;
}

const writeKeys = (session: SessionView, writes: readonly KeyWrite[]): WriteHandle[] =>
  writes.flatMap((write) => {
    const key = session.model.byMatrix.get(write.matrix);
    return key ? [store.setKeycode(write.layer, key.row, key.col, write.value)] : [];
  });

const keySentence = (session: SessionView, matrix: number, layers: readonly number[], value: number) => {
  const names = layers.map((layer) => session.meta.layers[layer]?.name ?? `Layer ${layer}`);
  return `${physicalKeyName(session, matrix)} on ${joinNames(names)} is now ${keycodeName(value, legendContext(session, layers[0] ?? 0))}.`;
};

/** Puts a keycode on a key, on the given layers, as one action. */
export const setKey = (matrix: number, value: number, layers: readonly number[]): number | null => {
  const session = requireLive();
  if (!session || layers.length === 0) {
    return null;
  }
  const before = layers.map((layer) => ({layer, matrix, value: session.keymap[layer]?.[matrix] ?? 0}));
  const unchanged = before.every((entry) => entry.value === value);
  if (unchanged) {
    return null;
  }
  const handles = writeKeys(
    session,
    layers.map((layer) => ({layer, matrix, value})),
  );
  pulseKey(matrix);
  const ctx = legendContext(session, layers[0] ?? 0);
  const keyName = physicalKeyName(session, matrix);
  const undo = (): number | null => {
    const live = requireLive();
    if (!live) {
      return null;
    }
    const undoHandles = writeKeys(live, before);
    pulseKey(matrix);
    return addEntry({
      text: `Undone: ${keyName} on ${joinNames(layers.map((layer) => live.meta.layers[layer]?.name ?? `Layer ${layer}`))} is ${keycodeName(before[0]?.value ?? 0, ctx)} again.`,
      rollbackText: `${keyName} stays ${keycodeName(value, ctx)}.`,
      writeIds: undoHandles.map((handle) => handle.id),
    });
  };
  return addEntry({
    text: keySentence(session, matrix, layers, value),
    rollbackText: `${keyName} is back to ${keycodeName(before[0]?.value ?? 0, ctx)}.`,
    writeIds: handles.map((handle) => handle.id),
    undo,
  });
};

/** The layers a change on `layer` goes to, with "Also on Mac" applied. */
export const targetLayers = (session: SessionView, layer: number, alsoPaired: boolean): number[] => {
  const pair = session.meta.layers[layer]?.pair;
  return alsoPaired && pair !== undefined ? [layer, pair] : [layer];
};

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

const describeMenuValue = (control: MenuControl, bytes: readonly number[]): {text: string; swatch?: string} => {
  switch (control.type) {
    case 'range':
      return {text: String(control.byteLength >= 2 ? ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0) : (bytes[0] ?? 0))};
    case 'dropdown': {
      const choice = control.choices?.find((candidate) => candidate.value[0] === bytes[0]);
      return {text: effectLabel(choice?.label ?? String(bytes[0] ?? 0))};
    }
    case 'color':
      return {text: 'a new colour', swatch: hueSatCss(bytes[0] ?? 0, bytes[1] ?? 0)};
    case 'toggle':
      return {text: (bytes[0] ?? 0) !== 0 ? 'on' : 'off'};
    default:
      return {text: 'changed'};
  }
};

/** Sets a lighting value. Slider drags merge into one log line. */
export const setLighting = (zoneName: string, control: MenuControl, input: ControlInput): void => {
  const session = requireLive();
  if (!session) {
    return;
  }
  const before = session.menuValues[control.commandId];
  let handle: WriteHandle;
  try {
    handle = store.setMenuValue(control.commandId, input);
  } catch {
    return;
  }
  const after = store.$menuValues.get()[control.commandId] ?? [];
  const label = controlLabel(control).toLowerCase();
  const described = describeMenuValue(control, after);
  const undo = (): number | null => {
    const live = requireLive();
    if (!live || !before) {
      return null;
    }
    const undoHandle = store.setMenuValue(control.commandId, before);
    const previous = describeMenuValue(control, before);
    return addEntry({
      text: `Undone: ${zoneName} ${label} is ${previous.text} again.`,
      rollbackText: `${zoneName} ${label} stays as it was.`,
      writeIds: [undoHandle.id],
      ...(previous.swatch ? {swatch: previous.swatch} : {}),
    });
  };
  addEntry({
    text: control.type === 'color' ? `${zoneName} colour changed.` : `${zoneName} ${label} is now ${described.text}.`,
    rollbackText: `${zoneName} ${label} is back to what the keyboard has.`,
    writeIds: [handle.id],
    mergeKey: `menu:${control.commandId}`,
    ...(described.swatch ? {swatch: described.swatch} : {}),
    ...(before ? {undo} : {}),
  });
};

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

export interface MacroBudget {
  readonly used: number;
  readonly size: number;
  readonly error?: string;
}

/** Bytes the macros would use with `expression` in slot `index`. */
export const macroBudget = (session: SessionView, index: number, expression: string): MacroBudget => {
  const size = session.info.macroBufferSize;
  const keys = session.table.macroKeys();
  const validation = validateMacroExpression(expression, keys);
  if (!validation.isValid) {
    return {used: 0, size, error: validation.errorMessage ?? 'This macro cannot be saved.'};
  }
  const expressions = Array.from({length: session.info.macroCount}, (_, idx) => (idx === index ? expression : (session.macros?.expressions[idx] ?? '')));
  try {
    return {used: macroBytesNeeded(expressions, keys), size};
  } catch (error) {
    return {used: 0, size, error: errorMessage(error)};
  }
};

export const macroDisplayName = (index: number, names: readonly string[] = $macroNames.get()): string => {
  const given = names[index]?.trim();
  return given && given.length > 0 ? given : `Macro ${index + 1}`;
};

/**
 * Saves a macro and, if `place` is given, puts it on that key in the same
 * action. Returns an error message when it could not start.
 */
export const saveMacro = (index: number, name: string, expression: string, place?: {matrix: number; layers: readonly number[]}): string | null => {
  const session = requireLive();
  if (!session) {
    return 'The keyboard is not connected.';
  }
  const budget = macroBudget(session, index, expression);
  if (budget.error) {
    return budget.error;
  }
  if (budget.used > budget.size) {
    return `The macros need ${budget.used} bytes; the keyboard holds ${budget.size}.`;
  }
  const beforeExpressions = Array.from({length: session.info.macroCount}, (_, idx) => session.macros?.expressions[idx] ?? '');
  const beforeName = $macroNames.get()[index] ?? '';
  const macroValue = session.table.valueOf(`MACRO(${index})`);
  setMacroName(index, name);
  const displayName = macroDisplayName(index);
  let handles: WriteHandle[];
  try {
    handles = [store.setMacro(index, expression)];
  } catch (error) {
    return errorMessage(error);
  }
  const keyBefore = place ? place.layers.map((layer) => ({layer, matrix: place.matrix, value: session.keymap[layer]?.[place.matrix] ?? 0})) : [];
  if (place && macroValue !== null) {
    handles.push(...writeKeys(session, place.layers.map((layer) => ({layer, matrix: place.matrix, value: macroValue}))));
    pulseKey(place.matrix);
  }
  const layerNames = place ? joinNames(place.layers.map((layer) => session.meta.layers[layer]?.name ?? `Layer ${layer}`)) : '';
  const text = place
    ? `Macro ${displayName} is saved and on ${physicalKeyName(session, place.matrix)} (${layerNames}).`
    : `Macro ${displayName} is saved. It is not on a key yet.`;
  const undo = (): number | null => {
    const live = requireLive();
    if (!live) {
      return null;
    }
    const undoHandles = [store.setMacros(beforeExpressions), ...writeKeys(live, keyBefore)];
    setMacroName(index, beforeName);
    return addEntry({
      text: `Undone: macro ${displayName} is back to how it was${place ? ' and the key is back too' : ''}.`,
      rollbackText: 'The macro stays as saved.',
      writeIds: undoHandles.map((handle) => handle.id),
    });
  };
  addEntry({text, rollbackText: 'The macro and keys are back to what the keyboard has.', writeIds: handles.map((handle) => handle.id), undo});
  return null;
};

/** Empties a macro slot. Keys that play it stay, and then do nothing. */
export const clearMacro = (index: number): void => {
  const session = requireLive();
  if (!session) {
    return;
  }
  const before = session.macros?.expressions[index] ?? '';
  const name = macroDisplayName(index);
  const handle = store.setMacro(index, '');
  addEntry({
    text: `Macro ${name} is now empty.`,
    rollbackText: `Macro ${name} is back to what the keyboard has.`,
    writeIds: [handle.id],
    undo: () => {
      if (!requireLive()) {
        return null;
      }
      const undoHandle = store.setMacro(index, before);
      return addEntry({text: `Undone: macro ${name} is back.`, rollbackText: 'The macro stays empty.', writeIds: [undoHandle.id]});
    },
  });
};

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Restores a snapshot. The store creates every write before its first
 * await, so the new write ids are known as soon as the call returns.
 */
export const restoreSnapshot = async (snapshot: KeyboardSnapshot, label: string): Promise<string | null> => {
  const session = requireLive();
  if (!session) {
    return 'The keyboard is not connected.';
  }
  let before: KeyboardSnapshot;
  try {
    before = store.exportSnapshot();
  } catch (error) {
    return errorMessage(error);
  }
  const known = new Set(store.$writes.get().map((record) => record.id));
  const pending = store.restoreSnapshot(snapshot);
  const writeIds = store.$writes.get().filter((record) => !known.has(record.id)).map((record) => record.id);
  if (writeIds.length > 0) {
    addEntry({
      text: `Restored "${label}".`,
      rollbackText: 'Some values are back to what the keyboard had.',
      writeIds,
      undo: () => {
        if (!requireLive()) {
          return null;
        }
        const knownNow = new Set(store.$writes.get().map((record) => record.id));
        void store.restoreSnapshot(before).catch(() => undefined);
        const ids = store.$writes.get().filter((record) => !knownNow.has(record.id)).map((record) => record.id);
        return addEntry({text: `Undone: the keyboard is back to how it was before "${label}".`, rollbackText: 'Some values stay restored.', writeIds: ids});
      },
    });
  }
  try {
    await pending;
    return null;
  } catch (error) {
    return errorMessage(error);
  }
};

export type ImportedFile = {readonly kind: 'snapshot'; readonly snapshot: KeyboardSnapshot} | {readonly kind: 'via'; readonly json: unknown};

/** Reads a dropped or chosen file as a snapshot or a VIA layout file. */
export const readStateFile = (json: unknown): ImportedFile => {
  if (isViaLayoutFile(json)) {
    return {kind: 'via', json};
  }
  return {kind: 'snapshot', snapshot: parseSnapshot(json)};
};

/** Turns a VIA layout file into a snapshot of the connected board, so it can be previewed and restored like one. */
export const snapshotFromViaFile = (json: unknown): KeyboardSnapshot => {
  const session = requireLive();
  if (!session) {
    throw new Error('Connect the keyboard first.');
  }
  const current = store.exportSnapshot();
  const imported = importViaLayout(json, session.table, {
    vendorProductId: session.definition.vendorProductId,
    keysPerLayer: session.definition.matrix.rows * session.definition.matrix.cols,
    layerCount: session.info.layerCount,
  });
  const cols = session.definition.matrix.cols;
  const keymap = current.keymap.map((grid, layer) => {
    const flat = imported.keymap[layer];
    return flat ? Array.from({length: grid.length}, (_, row) => flat.slice(row * cols, (row + 1) * cols)) : grid.map((row) => [...row]);
  });
  let macros = current.macros;
  if (imported.macroExpressions && current.macros) {
    const keys = session.table.macroKeys();
    const expressions = Array.from({length: current.macros.count}, (_, idx) => imported.macroExpressions?.[idx] ?? '');
    const bytes = encodeExpressions(expressions, keys);
    macros = {...current.macros, expressions, bytes};
  }
  return {...current, keymap, macros};
};

/** Macro buffer bytes for a set of expressions, up to the last non-zero byte (the snapshot format). */
const encodeExpressions = (expressions: readonly string[], keys: ReturnType<SessionView['table']['macroKeys']>): number[] => {
  const bytes = encodeMacros(expressions.map(expressionToRawSequence), keys);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }
  return bytes.slice(0, end);
};

export const $currentLayerName = computed([$session, $layer], (session, layer) => session?.meta.layers[layer]?.name ?? `Layer ${layer}`);
