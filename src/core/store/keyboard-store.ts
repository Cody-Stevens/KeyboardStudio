/**
 * Framework-free state for one connected keyboard, built on nanostores.
 *
 * Every value exists twice: the confirmed value (what the keyboard last
 * reported or acknowledged) and the displayed value (confirmed plus pending
 * optimistic writes). Each write gets a record with a status: `pending`,
 * `saved`, `failed` (rolled back to the confirmed value, which is re-read
 * from the keyboard when possible) or `superseded` (replaced by a newer
 * write to the same target before it was sent).
 */
import {atom, computed, type ReadableAtom} from 'nanostores';
import {CommandChannel} from '../protocol/command-channel.ts';
import {Protocol} from '../protocol/constants.ts';
import {DisconnectedError, KeyboardStudioError, UnhandledCommandError, ValidationError, errorMessage} from '../protocol/errors.ts';
import {KeyboardApi, planKeymapSegments, type Keymap} from '../protocol/keyboard-api.ts';
import type {HidDeviceInfo, Transport, TransportKind} from '../transport/types.ts';
import {DefinitionRegistry} from '../definitions/registry.ts';
import {encodeControlValue, findControl, getReadableControls, type ControlInput, type MenuValues} from '../definitions/menus.ts';
import {decodeLayoutOptions, encodeLayoutOptions} from '../definitions/layout.ts';
import type {KeyboardDefinition} from '../definitions/types.ts';
import {KeycodeTable} from '../keycodes/keycode-table.ts';
import {
  decodeMacroBuffer,
  encodeMacros,
  expressionToRawSequence,
  rawSequenceToExpression,
  validateMacroExpression,
  type MacroAction,
} from '../macros/codec.ts';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  gridToKeymap,
  keymapToGrid,
  snapshotIncompatibilities,
  type KeyboardSnapshot,
  type SnapshotLightingValue,
} from '../snapshots/snapshot.ts';
import {importViaLayout} from '../snapshots/via-layout.ts';
import {WriteQueue} from './write-queue.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConnectedKeyboard {
  readonly device: HidDeviceInfo;
  readonly transportKind: TransportKind;
  readonly protocol: number;
  readonly layerCount: number;
  readonly macroCount: number;
  readonly macroBufferSize: number;
  readonly firmwareVersion: number | null;
  readonly readOnly: boolean;
  /** Time from opening the transport to having the full state, in ms. */
  readonly connectMs: number;
  /** HID reports exchanged while connecting. */
  readonly connectReports: number;
  /** Non-fatal problems, such as a missing keycode table for the protocol. */
  readonly warnings: readonly string[];
}

export type ConnectionState =
  | {readonly status: 'disconnected'}
  | {readonly status: 'connecting'; readonly transportKind: TransportKind}
  | ({readonly status: 'connected'} & ConnectedKeyboard)
  | {readonly status: 'error'; readonly message: string};

export type WriteTarget =
  | {readonly kind: 'key'; readonly layer: number; readonly row: number; readonly col: number}
  | {readonly kind: 'keymap'; readonly keys: number}
  | {readonly kind: 'menu'; readonly commandId: string}
  | {readonly kind: 'macros'}
  | {readonly kind: 'layout-options'};

export type WriteState = 'pending' | 'saved' | 'failed' | 'superseded';

export interface WriteRecord {
  readonly id: number;
  readonly target: WriteTarget;
  readonly state: WriteState;
  readonly startedAt: number;
  readonly settledAt?: number;
  readonly error?: string;
  /**
   * After a failure: true if the value was re-read from the keyboard, so the
   * displayed value is known to match it; false if that read failed too.
   */
  readonly verified?: boolean;
}

export interface WriteHandle {
  readonly id: number;
  /** Resolves when the write settles. Never rejects; inspect `state`. */
  readonly done: Promise<WriteRecord>;
}

/** Latest write status per target key (`key:L:R:C`, `menu:<id>`, `macros`, `layout-options`). */
export type TargetStatus = Readonly<Record<string, {readonly state: WriteState; readonly writeId: number; readonly error?: string}>>;

export interface MacroState {
  readonly count: number;
  readonly bufferSize: number;
  readonly bytesUsed: number;
  readonly expressions: readonly string[];
  readonly sequences: readonly (readonly MacroAction[])[];
  /** Set when the buffer could not be decoded. `bytes` is still valid. */
  readonly decodeError?: string;
  readonly bytes: readonly number[];
}

export interface KeyboardStoreOptions {
  readonly registry?: DefinitionRegistry;
  /** Wait this long after the last change to a lighting channel before saving it to EEPROM. Default 300 ms. */
  readonly menuSaveDelayMs?: number;
  /** Per-command reply timeout. Default 1000 ms. */
  readonly timeoutMs?: number;
  /** Keep at most this many write records. Default 200. */
  readonly maxWriteRecords?: number;
}

export interface ConnectOptions {
  /** Use this definition instead of looking one up. */
  readonly definition?: KeyboardDefinition;
  /** Refuse every write at the protocol layer. */
  readonly readOnly?: boolean;
}

export interface RestoreResult {
  readonly handles: readonly WriteHandle[];
  readonly records: readonly WriteRecord[];
  readonly ok: boolean;
}

export const targetKey = (target: WriteTarget): string => {
  switch (target.kind) {
    case 'key':
      return `key:${target.layer}:${target.row}:${target.col}`;
    case 'keymap':
      return 'keymap';
    case 'menu':
      return `menu:${target.commandId}`;
    case 'macros':
      return 'macros';
    case 'layout-options':
      return 'layout-options';
    default: {
      const unreachable: never = target;
      return String(unreachable);
    }
  }
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Overlay<T> {
  readonly value: T;
  readonly writeId: number;
}

interface Session {
  readonly transport: Transport;
  readonly channel: CommandChannel;
  readonly api: KeyboardApi;
  readonly definition: KeyboardDefinition;
  readonly info: ConnectedKeyboard;
  readonly unsubscribe: () => void;
}

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

const trimTrailingZeros = (bytes: readonly number[]): number[] => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }
  return bytes.slice(0, end);
};

const sameBytes = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, idx) => value === b[idx]);

const withUnhandledAsNull = async <T>(promise: Promise<T>): Promise<T | null> => {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof UnhandledCommandError) {
      return null;
    }
    throw error;
  }
};

export type KeyboardStore = ReturnType<typeof createKeyboardStore>;

export const createKeyboardStore = (options: KeyboardStoreOptions = {}) => {
  const registry = options.registry ?? new DefinitionRegistry();
  const menuSaveDelayMs = options.menuSaveDelayMs ?? 300;
  const maxWriteRecords = options.maxWriteRecords ?? 200;

  // Confirmed state: what the keyboard reported or acknowledged.
  const $connection = atom<ConnectionState>({status: 'disconnected'});
  const $definition = atom<KeyboardDefinition | null>(null);
  const $confirmedKeymap = atom<Keymap | null>(null);
  const $confirmedMenuValues = atom<MenuValues>({});
  const $confirmedMacroBytes = atom<readonly number[] | null>(null);
  const $confirmedLayoutOptions = atom<number | null>(null);

  // Optimistic overlays, keyed by target key.
  const $keyOverlay = atom<Readonly<Record<string, Overlay<number>>>>({});
  const $menuOverlay = atom<Readonly<Record<string, Overlay<readonly number[]>>>>({});
  const $macroOverlay = atom<Overlay<readonly number[]> | null>(null);
  const $layoutOverlay = atom<Overlay<number> | null>(null);

  const $writes = atom<readonly WriteRecord[]>([]);
  const $targetStatus = atom<TargetStatus>({});

  // Displayed state.
  const $keymap: ReadableAtom<Keymap | null> = computed([$confirmedKeymap, $keyOverlay, $definition], (confirmed, overlay, definition) => {
    if (!confirmed || !definition) {
      return confirmed;
    }
    const entries = Object.entries(overlay);
    if (entries.length === 0) {
      return confirmed;
    }
    const cols = definition.matrix.cols;
    const result = confirmed.map((layer) => [...layer]);
    for (const [key, {value}] of entries) {
      const [, layer, row, col] = key.split(':').map(Number);
      const target = result[layer ?? -1];
      if (target && row !== undefined && col !== undefined) {
        target[row * cols + col] = value;
      }
    }
    return result;
  });

  const $menuValues: ReadableAtom<MenuValues> = computed([$confirmedMenuValues, $menuOverlay], (confirmed, overlay) => {
    const entries = Object.entries(overlay);
    if (entries.length === 0) {
      return confirmed;
    }
    const result: Record<string, readonly number[]> = {...confirmed};
    for (const [key, {value}] of entries) {
      result[key.slice('menu:'.length)] = value;
    }
    return result;
  });

  const $layoutOptions: ReadableAtom<number | null> = computed(
    [$confirmedLayoutOptions, $layoutOverlay],
    (confirmed, overlay) => overlay?.value ?? confirmed,
  );

  const $layoutChoices: ReadableAtom<number[] | null> = computed([$layoutOptions, $definition], (value, definition) =>
    value === null || !definition ? null : decodeLayoutOptions(definition.layout, value),
  );

  const $keycodes: ReadableAtom<KeycodeTable | null> = computed([$connection, $definition], (connection, definition) => {
    if (connection.status !== 'connected' || !definition) {
      return null;
    }
    try {
      return new KeycodeTable({
        protocol: connection.protocol,
        customKeycodes: definition.customKeycodes,
        macroCount: connection.macroCount,
        keycodeModules: definition.keycodeModules,
        commonMenuIds: definition.commonMenuIds,
        hasV2Lighting: definition.hasV2Lighting,
      });
    } catch {
      return null;
    }
  });

  const decodeMacros = (bytes: readonly number[] | null, connection: ConnectionState, table: KeycodeTable | null): MacroState | null => {
    if (!bytes || connection.status !== 'connected') {
      return null;
    }
    const base = {count: connection.macroCount, bufferSize: connection.macroBufferSize, bytes};
    if (!table) {
      return {...base, bytesUsed: trimTrailingZeros(bytes).length, expressions: [], sequences: [], decodeError: 'No keycode table for this protocol'};
    }
    try {
      const sequences = decodeMacroBuffer(bytes, connection.macroCount, table.macroKeys());
      const bytesUsed = encodeMacros(sequences, table.macroKeys()).length;
      return {...base, bytesUsed, sequences, expressions: sequences.map(rawSequenceToExpression)};
    } catch (error) {
      return {...base, bytesUsed: trimTrailingZeros(bytes).length, expressions: [], sequences: [], decodeError: errorMessage(error)};
    }
  };

  const $macros: ReadableAtom<MacroState | null> = computed(
    [$confirmedMacroBytes, $macroOverlay, $connection, $keycodes],
    (confirmed, overlay, connection, table) => decodeMacros(overlay?.value ?? confirmed, connection, table),
  );

  const $confirmedMacros: ReadableAtom<MacroState | null> = computed(
    [$confirmedMacroBytes, $connection, $keycodes],
    (confirmed, connection, table) => decodeMacros(confirmed, connection, table),
  );

  const $pendingWrites: ReadableAtom<number> = computed($writes, (writes) => writes.filter((w) => w.state === 'pending').length);

  // -------------------------------------------------------------------------
  // Write bookkeeping
  // -------------------------------------------------------------------------

  let session: Session | null = null;
  let nextWriteId = 1;
  const queue = new WriteQueue();
  const resolvers = new Map<number, (record: WriteRecord) => void>();
  const writeKeys = new Map<number, readonly string[]>();
  const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const saveWaiters = new Map<number, Set<number>>();

  const requireSession = (): Session => {
    if (!session) {
      throw new DisconnectedError();
    }
    return session;
  };

  const setStatus = (keys: readonly string[], status: {state: WriteState; writeId: number; error?: string}) => {
    const current = $targetStatus.get();
    const next: Record<string, TargetStatus[string]> = {...current};
    for (const key of keys) {
      const existing = current[key];
      // Only the newest write to a target decides its status.
      if (!existing || existing.writeId <= status.writeId) {
        next[key] = status;
      }
    }
    $targetStatus.set(next);
  };

  const beginWrite = (target: WriteTarget, keys: readonly string[]): WriteHandle => {
    const id = nextWriteId++;
    const record: WriteRecord = {id, target, state: 'pending', startedAt: Date.now()};
    writeKeys.set(id, keys);
    $writes.set([...$writes.get(), record].slice(-maxWriteRecords));
    setStatus(keys, {state: 'pending', writeId: id});
    const done = new Promise<WriteRecord>((resolve) => resolvers.set(id, resolve));
    return {id, done};
  };

  const settleWrite = (id: number, patch: {state: Exclude<WriteState, 'pending'>; error?: string; verified?: boolean}) => {
    const resolve = resolvers.get(id);
    if (!resolve) {
      return; // Already settled.
    }
    resolvers.delete(id);
    const keys = writeKeys.get(id) ?? [];
    writeKeys.delete(id);
    let settled: WriteRecord | undefined;
    $writes.set(
      $writes.get().map((record) => {
        if (record.id !== id) {
          return record;
        }
        settled = {...record, ...patch, settledAt: Date.now()};
        return settled;
      }),
    );
    if (patch.state !== 'superseded') {
      setStatus(keys, {state: patch.state, writeId: id, ...(patch.error === undefined ? {} : {error: patch.error})});
    }
    resolve(settled ?? {id, target: {kind: 'macros'}, startedAt: Date.now(), ...patch});
  };

  const removeOverlayEntries = <T>(store: typeof $keyOverlay | typeof $menuOverlay, keys: readonly string[], writeId: number) => {
    const current = store.get() as Readonly<Record<string, Overlay<T>>>;
    const next: Record<string, Overlay<T>> = {...current};
    let changed = false;
    for (const key of keys) {
      if (next[key]?.writeId === writeId) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) {
      (store as unknown as {set(value: Record<string, Overlay<T>>): void}).set(next);
    }
  };

  const updateConfirmedKeys = (changes: readonly {layer: number; index: number; value: number}[]) => {
    const keymap = $confirmedKeymap.get();
    if (!keymap) {
      return;
    }
    const next = keymap.map((layer) => [...layer]);
    for (const {layer, index, value} of changes) {
      const target = next[layer];
      if (target) {
        target[index] = value;
      }
    }
    $confirmedKeymap.set(next);
  };

  // -------------------------------------------------------------------------
  // Connect / disconnect
  // -------------------------------------------------------------------------

  const resetState = () => {
    for (const timer of saveTimers.values()) {
      clearTimeout(timer);
    }
    saveTimers.clear();
    $definition.set(null);
    $confirmedKeymap.set(null);
    $confirmedMenuValues.set({});
    $confirmedMacroBytes.set(null);
    $confirmedLayoutOptions.set(null);
    $keyOverlay.set({});
    $menuOverlay.set({});
    $macroOverlay.set(null);
    $layoutOverlay.set(null);
  };

  const failOutstanding = (reason: string) => {
    queue.clear();
    saveWaiters.clear();
    for (const id of [...resolvers.keys()]) {
      settleWrite(id, {state: 'failed', error: reason, verified: false});
    }
  };

  const readMenuValues = async (api: KeyboardApi, definition: KeyboardDefinition, protocol: number): Promise<Record<string, number[]>> => {
    if (protocol < Protocol.V3_MENUS) {
      return {};
    }
    const controls = getReadableControls(definition);
    const values = await Promise.all(
      controls.map((control) => withUnhandledAsNull(api.getCustomMenuValue(control.channel, control.valueId, control.byteLength))),
    );
    const result: Record<string, number[]> = {};
    controls.forEach((control, idx) => {
      const value = values[idx];
      if (value) {
        result[control.commandId] = value;
      }
    });
    return result;
  };

  const connect = async (transport: Transport, connectOptions: ConnectOptions = {}): Promise<ConnectedKeyboard> => {
    if (session) {
      await disconnect();
    }
    $connection.set({status: 'connecting', transportKind: transport.kind});
    const started = now();
    let channel: CommandChannel | undefined;
    try {
      await transport.open();
      channel = new CommandChannel(transport, {
        readOnly: connectOptions.readOnly ?? false,
        ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs}),
      });
      const api = new KeyboardApi(channel);
      const vendorProductId = transport.info.vendorId * 65536 + transport.info.productId;
      const [protocol, definition] = await Promise.all([
        api.getProtocolVersion(),
        connectOptions.definition ? Promise.resolve(connectOptions.definition) : registry.resolve(vendorProductId),
      ]);
      if (protocol < Protocol.MIN_SUPPORTED) {
        throw new KeyboardStudioError(`This keyboard speaks VIA protocol ${protocol}; KeyboardStudio needs ${Protocol.MIN_SUPPORTED} or later`);
      }
      if (!definition) {
        throw new KeyboardStudioError(
          `No definition found for ${transport.info.productName} (${vendorProductId}). Load the manufacturer's VIA JSON to continue.`,
        );
      }
      const warnings: string[] = [];
      if (definition.vendorProductId !== vendorProductId) {
        warnings.push(`The definition is for ${definition.name}, which has a different vendor/product id`);
      }

      // Queue every read at once; the channel sends them back to back.
      const [layerCount, macroCount, macroBufferSize, layoutOptions, firmwareVersion] = await Promise.all([
        api.getLayerCount(),
        api.getMacroCount(),
        api.getMacroBufferSize(),
        withUnhandledAsNull(api.getLayoutOptions()),
        withUnhandledAsNull(api.getFirmwareVersion()),
      ]);
      const [keymap, macroBytes, menuValues] = await Promise.all([
        api.readKeymap(definition.matrix, layerCount),
        macroCount > 0 ? api.readMacroBuffer() : Promise.resolve([]),
        readMenuValues(api, definition, protocol),
      ]);

      try {
        new KeycodeTable({protocol});
      } catch (error) {
        warnings.push(errorMessage(error));
      }

      const info: ConnectedKeyboard = {
        device: transport.info,
        transportKind: transport.kind,
        protocol,
        layerCount,
        macroCount,
        macroBufferSize,
        firmwareVersion,
        readOnly: channel.readOnly,
        connectMs: now() - started,
        connectReports: channel.statistics.requests,
        warnings,
      };
      const unsubscribe = transport.onDisconnect(() => {
        if (session?.transport === transport) {
          handleLostConnection('The keyboard was disconnected');
        }
      });
      session = {transport, channel, api, definition, info, unsubscribe};
      $definition.set(definition);
      $confirmedKeymap.set(keymap);
      $confirmedMenuValues.set({
        ...menuValues,
        ...(firmwareVersion === null ? {} : {id_firmware_version: [firmwareVersion]}),
      });
      $confirmedMacroBytes.set(macroBytes);
      $confirmedLayoutOptions.set(layoutOptions);
      $connection.set({status: 'connected', ...info});
      return info;
    } catch (error) {
      channel?.close();
      await transport.close().catch(() => undefined);
      session = null;
      resetState();
      $connection.set({status: 'error', message: errorMessage(error)});
      throw error;
    }
  };

  const handleLostConnection = (message: string) => {
    const current = session;
    session = null;
    current?.unsubscribe();
    current?.channel.close(new DisconnectedError(message));
    failOutstanding(message);
    resetState();
    $connection.set({status: 'error', message});
  };

  const disconnect = async (): Promise<void> => {
    const current = session;
    if (!current) {
      $connection.set({status: 'disconnected'});
      return;
    }
    await flushSaves();
    await queue.whenIdle();
    session = null;
    current.unsubscribe();
    current.channel.close();
    await current.transport.close().catch(() => undefined);
    failOutstanding('Disconnected');
    resetState();
    $connection.set({status: 'disconnected'});
  };

  // -------------------------------------------------------------------------
  // Keymap writes
  // -------------------------------------------------------------------------

  const setKeycode = (layer: number, row: number, col: number, keycode: number): WriteHandle => {
    const s = requireSession();
    const {rows, cols} = s.definition.matrix;
    if (layer < 0 || layer >= s.info.layerCount || row < 0 || row >= rows || col < 0 || col >= cols) {
      throw new ValidationError(`Key ${layer}:${row}:${col} is outside the keymap`);
    }
    if (!Number.isInteger(keycode) || keycode < 0 || keycode > 0xffff) {
      throw new ValidationError('A keycode must be a 16-bit integer');
    }
    const key = `key:${layer}:${row}:${col}`;
    const handle = beginWrite({kind: 'key', layer, row, col}, [key]);
    $keyOverlay.set({...$keyOverlay.get(), [key]: {value: keycode, writeId: handle.id}});
    queue.enqueue({
      coalesceKey: key,
      onSuperseded: () => settleWrite(handle.id, {state: 'superseded'}),
      run: async () => {
        try {
          await s.api.setKeycode(layer, row, col, keycode);
          updateConfirmedKeys([{layer, index: row * cols + col, value: keycode}]);
          removeOverlayEntries($keyOverlay, [key], handle.id);
          settleWrite(handle.id, {state: 'saved'});
        } catch (error) {
          removeOverlayEntries($keyOverlay, [key], handle.id);
          let verified = false;
          if (session === s) {
            try {
              const actual = await s.api.getKeycode(layer, row, col);
              updateConfirmedKeys([{layer, index: row * cols + col, value: actual}]);
              verified = true;
            } catch {
              verified = false;
            }
          }
          settleWrite(handle.id, {state: 'failed', error: errorMessage(error), verified});
        }
      },
    });
    return handle;
  };

  /**
   * Writes a whole keymap (or the changed part of it) with bulk buffer
   * writes, 14 keys per report. Unchanged keys cost nothing.
   */
  const writeKeymap = (target: Keymap): WriteHandle => {
    const s = requireSession();
    const confirmed = $confirmedKeymap.get();
    if (!confirmed || target.length !== confirmed.length || target.some((layer, idx) => layer.length !== confirmed[idx]?.length)) {
      throw new ValidationError('The keymap does not match the keyboard size');
    }
    const cols = s.definition.matrix.cols;
    const changes: {layer: number; index: number; value: number; key: string}[] = [];
    target.forEach((layer, l) =>
      layer.forEach((value, index) => {
        if (value !== $keymap.get()?.[l]?.[index]) {
          changes.push({layer: l, index, value, key: `key:${l}:${Math.floor(index / cols)}:${index % cols}`});
        }
      }),
    );
    const keys = changes.map((change) => change.key);
    const handle = beginWrite({kind: 'keymap', keys: changes.length}, keys);
    if (changes.length === 0) {
      settleWrite(handle.id, {state: 'saved'});
      return handle;
    }
    const overlay: Record<string, Overlay<number>> = {...$keyOverlay.get()};
    for (const change of changes) {
      overlay[change.key] = {value: change.value, writeId: handle.id};
    }
    $keyOverlay.set(overlay);
    queue.enqueue({
      run: async () => {
        try {
          const current = $confirmedKeymap.get() ?? confirmed;
          const desired = current.map((layer, l) => {
            const next = [...layer];
            for (const change of changes) {
              if (change.layer === l) {
                next[change.index] = change.value;
              }
            }
            return next;
          });
          await s.api.writeKeymapSegments(planKeymapSegments(current, desired));
          updateConfirmedKeys(changes);
          removeOverlayEntries($keyOverlay, keys, handle.id);
          settleWrite(handle.id, {state: 'saved'});
        } catch (error) {
          removeOverlayEntries($keyOverlay, keys, handle.id);
          let verified = false;
          if (session === s) {
            try {
              $confirmedKeymap.set(await s.api.readKeymap(s.definition.matrix, s.info.layerCount));
              verified = true;
            } catch {
              verified = false;
            }
          }
          settleWrite(handle.id, {state: 'failed', error: errorMessage(error), verified});
        }
      },
    });
    return handle;
  };

  // -------------------------------------------------------------------------
  // Lighting / custom menu writes
  // -------------------------------------------------------------------------

  const runSave = (s: Session, channel: number) => {
    queue.enqueue({
      coalesceKey: `save:${channel}`,
      run: async () => {
        const waiting = [...(saveWaiters.get(channel) ?? [])];
        saveWaiters.delete(channel);
        try {
          await s.api.saveCustomMenu(channel);
          for (const id of waiting) {
            settleWrite(id, {state: 'saved'});
          }
        } catch (error) {
          for (const id of waiting) {
            settleWrite(id, {
              state: 'failed',
              error: `Applied but not saved to EEPROM: ${errorMessage(error)}`,
              verified: false,
            });
          }
        }
      },
    });
  };

  const scheduleSave = (s: Session, channel: number, writeId: number) => {
    const waiters = saveWaiters.get(channel) ?? new Set<number>();
    waiters.add(writeId);
    saveWaiters.set(channel, waiters);
    clearTimeout(saveTimers.get(channel));
    saveTimers.set(
      channel,
      setTimeout(() => {
        saveTimers.delete(channel);
        if (session === s) {
          runSave(s, channel);
        }
      }, menuSaveDelayMs),
    );
  };

  /** Starts any pending debounced saves now. */
  const flushSaves = async () => {
    const s = session;
    for (const [channel, timer] of saveTimers) {
      clearTimeout(timer);
      saveTimers.delete(channel);
      if (s) {
        runSave(s, channel);
      }
    }
    await queue.whenIdle();
  };

  /**
   * Sets a custom menu value. Accepts a typed input (`{type: 'range', value: 80}`)
   * or raw bytes. The value applies immediately; the channel is saved to
   * EEPROM once no change has arrived for `menuSaveDelayMs`, and the write
   * reports `saved` after that save.
   */
  const setMenuValue = (commandId: string, input: ControlInput | readonly number[]): WriteHandle => {
    const s = requireSession();
    const control = findControl(s.definition, commandId);
    if (!control) {
      throw new ValidationError(`The definition has no control "${commandId}"`);
    }
    const bytes = Array.isArray(input) ? [...(input as readonly number[])] : encodeControlValue(control, input as ControlInput);
    const key = `menu:${commandId}`;
    const handle = beginWrite({kind: 'menu', commandId}, [key]);
    $menuOverlay.set({...$menuOverlay.get(), [key]: {value: bytes, writeId: handle.id}});
    const isButton = control.type === 'button';
    queue.enqueue({
      coalesceKey: key,
      onSuperseded: () => settleWrite(handle.id, {state: 'superseded'}),
      run: async () => {
        try {
          await s.api.setCustomMenuValue(control.channel, control.valueId, bytes);
          if (!isButton) {
            $confirmedMenuValues.set({...$confirmedMenuValues.get(), [commandId]: bytes});
          }
          removeOverlayEntries($menuOverlay, [key], handle.id);
          if (isButton) {
            settleWrite(handle.id, {state: 'saved'});
          } else {
            scheduleSave(s, control.channel, handle.id);
          }
        } catch (error) {
          removeOverlayEntries($menuOverlay, [key], handle.id);
          let verified = false;
          if (session === s && !isButton) {
            try {
              const actual = await s.api.getCustomMenuValue(control.channel, control.valueId, control.byteLength);
              $confirmedMenuValues.set({...$confirmedMenuValues.get(), [commandId]: actual});
              verified = true;
            } catch {
              verified = false;
            }
          }
          settleWrite(handle.id, {state: 'failed', error: errorMessage(error), verified});
        }
      },
    });
    return handle;
  };

  // -------------------------------------------------------------------------
  // Macros
  // -------------------------------------------------------------------------

  const writeMacroBytes = (s: Session, bytes: readonly number[]): WriteHandle => {
    if (bytes.length > s.info.macroBufferSize) {
      throw new ValidationError(`The macros need ${bytes.length} bytes; the keyboard holds ${s.info.macroBufferSize}`);
    }
    const padded = [...bytes, ...new Array<number>(s.info.macroBufferSize - bytes.length).fill(0)];
    const key = 'macros';
    const handle = beginWrite({kind: 'macros'}, [key]);
    $macroOverlay.set({value: padded, writeId: handle.id});
    queue.enqueue({
      coalesceKey: key,
      onSuperseded: () => settleWrite(handle.id, {state: 'superseded'}),
      run: async () => {
        const clearOverlay = () => {
          if ($macroOverlay.get()?.writeId === handle.id) {
            $macroOverlay.set(null);
          }
        };
        try {
          await s.api.writeMacroBuffer(trimTrailingZeros(bytes));
          $confirmedMacroBytes.set(padded);
          clearOverlay();
          settleWrite(handle.id, {state: 'saved'});
        } catch (error) {
          clearOverlay();
          let verified = false;
          if (session === s) {
            try {
              $confirmedMacroBytes.set(await s.api.readMacroBuffer());
              verified = true;
            } catch {
              verified = false;
            }
          }
          settleWrite(handle.id, {state: 'failed', error: errorMessage(error), verified});
        }
      },
    });
    return handle;
  };

  /** Replaces every macro. `expressions` may be shorter than the macro count; the rest become empty. */
  const setMacros = (expressions: readonly string[]): WriteHandle => {
    const s = requireSession();
    const table = $keycodes.get();
    if (!table) {
      throw new KeyboardStudioError('Macros need a keycode table for this protocol');
    }
    if (expressions.length > s.info.macroCount) {
      throw new ValidationError(`The keyboard has ${s.info.macroCount} macro slots`);
    }
    const keys = table.macroKeys();
    expressions.forEach((expression, idx) => {
      const result = validateMacroExpression(expression, keys);
      if (!result.isValid) {
        throw new ValidationError(`M${idx}: ${result.errorMessage ?? 'invalid macro'}`);
      }
    });
    const all = Array.from({length: s.info.macroCount}, (_, idx) => expressions[idx] ?? '');
    return writeMacroBytes(s, encodeMacros(all.map(expressionToRawSequence), keys));
  };

  /** Changes one macro and keeps the others as currently displayed. */
  const setMacro = (index: number, expression: string): WriteHandle => {
    const s = requireSession();
    const current = $macros.get();
    if (index < 0 || index >= s.info.macroCount) {
      throw new ValidationError(`Macro index ${index} is out of range`);
    }
    if (current?.decodeError) {
      throw new KeyboardStudioError(`The macro buffer could not be decoded: ${current.decodeError}`);
    }
    const expressions = Array.from({length: s.info.macroCount}, (_, idx) => current?.expressions[idx] ?? '');
    expressions[index] = expression;
    return setMacros(expressions);
  };

  // -------------------------------------------------------------------------
  // Layout options
  // -------------------------------------------------------------------------

  const setLayoutChoices = (choices: readonly number[]): WriteHandle => {
    const s = requireSession();
    return writeLayoutOptions(s, encodeLayoutOptions(s.definition.layout, choices));
  };

  const writeLayoutOptions = (s: Session, value: number): WriteHandle => {
    const key = 'layout-options';
    const handle = beginWrite({kind: 'layout-options'}, [key]);
    $layoutOverlay.set({value, writeId: handle.id});
    queue.enqueue({
      coalesceKey: key,
      onSuperseded: () => settleWrite(handle.id, {state: 'superseded'}),
      run: async () => {
        const clearOverlay = () => {
          if ($layoutOverlay.get()?.writeId === handle.id) {
            $layoutOverlay.set(null);
          }
        };
        try {
          await s.api.setLayoutOptions(value);
          $confirmedLayoutOptions.set(value);
          clearOverlay();
          settleWrite(handle.id, {state: 'saved'});
        } catch (error) {
          clearOverlay();
          let verified = false;
          try {
            $confirmedLayoutOptions.set(await s.api.getLayoutOptions());
            verified = true;
          } catch {
            verified = false;
          }
          settleWrite(handle.id, {state: 'failed', error: errorMessage(error), verified});
        }
      },
    });
    return handle;
  };

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  /** The keyboard's confirmed state (not pending writes) as a snapshot. */
  const exportSnapshot = (): KeyboardSnapshot => {
    const s = requireSession();
    const keymap = $confirmedKeymap.get();
    if (!keymap) {
      throw new KeyboardStudioError('The keymap has not been read yet');
    }
    const lighting: Record<string, SnapshotLightingValue> = {};
    const confirmedMenus = $confirmedMenuValues.get();
    for (const control of getReadableControls(s.definition)) {
      const bytes = confirmedMenus[control.commandId];
      if (bytes && control.type !== 'button' && control.type !== 'label') {
        lighting[control.commandId] = {channel: control.channel, valueId: control.valueId, bytes: [...bytes]};
      }
    }
    const macros = $confirmedMacros.get();
    return {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      keyboard: {
        name: s.definition.name,
        vendorId: s.info.device.vendorId,
        productId: s.info.device.productId,
        vendorProductId: s.info.device.vendorId * 65536 + s.info.device.productId,
        protocol: s.info.protocol,
      },
      matrix: s.definition.matrix,
      layerCount: s.info.layerCount,
      keymap: keymapToGrid(keymap, s.definition.matrix.cols),
      macros: macros
        ? {
            count: macros.count,
            bufferSize: macros.bufferSize,
            expressions: macros.expressions,
            bytes: trimTrailingZeros(macros.bytes),
          }
        : null,
      lighting,
      layoutOptions: $confirmedLayoutOptions.get(),
    };
  };

  const settleAll = async (handles: WriteHandle[]): Promise<RestoreResult> => {
    const records = await Promise.all(handles.map((handle) => handle.done));
    return {handles, records, ok: records.every((record) => record.state === 'saved')};
  };

  /**
   * Writes a snapshot onto the connected keyboard. Only values that differ
   * from the keyboard are sent. Throws before writing anything if the
   * snapshot does not fit this keyboard.
   */
  const restoreSnapshot = async (snapshot: KeyboardSnapshot): Promise<RestoreResult> => {
    const s = requireSession();
    const problems = snapshotIncompatibilities(snapshot, {
      vendorProductId: s.info.device.vendorId * 65536 + s.info.device.productId,
      matrix: s.definition.matrix,
      layerCount: s.info.layerCount,
      macroCount: s.info.macroCount,
      macroBufferSize: s.info.macroBufferSize,
    });
    if (problems.length > 0) {
      throw new ValidationError('This snapshot cannot be restored', problems);
    }
    const handles: WriteHandle[] = [writeKeymap(gridToKeymap(snapshot.keymap))];
    const confirmedMacros = $confirmedMacroBytes.get();
    if (snapshot.macros && !sameBytes(trimTrailingZeros(confirmedMacros ?? []), snapshot.macros.bytes)) {
      handles.push(writeMacroBytes(s, snapshot.macros.bytes));
    }
    const currentMenus = $menuValues.get();
    for (const [commandId, value] of Object.entries(snapshot.lighting)) {
      const control = findControl(s.definition, commandId);
      if (control && control.channel === value.channel && control.valueId === value.valueId && !sameBytes(currentMenus[commandId], value.bytes)) {
        handles.push(setMenuValue(commandId, value.bytes));
      }
    }
    if (snapshot.layoutOptions !== null && snapshot.layoutOptions !== $layoutOptions.get()) {
      handles.push(writeLayoutOptions(s, snapshot.layoutOptions));
    }
    await flushSaves();
    return settleAll(handles);
  };

  /** Applies a VIA "Save + Load" layout file: keymap and, if present, macros. */
  const importViaLayoutFile = async (json: unknown): Promise<RestoreResult> => {
    const s = requireSession();
    const table = $keycodes.get();
    const current = $keymap.get();
    if (!table || !current) {
      throw new KeyboardStudioError('Connect a keyboard with a supported protocol first');
    }
    const imported = importViaLayout(json, table, {
      vendorProductId: s.info.device.vendorId * 65536 + s.info.device.productId,
      keysPerLayer: s.definition.matrix.rows * s.definition.matrix.cols,
      layerCount: s.info.layerCount,
    });
    const keymap = current.map((layer, idx) => imported.keymap[idx] ?? [...layer]);
    const handles: WriteHandle[] = [writeKeymap(keymap)];
    if (imported.macroExpressions && s.info.macroCount > 0) {
      handles.push(setMacros(imported.macroExpressions.slice(0, s.info.macroCount)));
    }
    return settleAll(handles);
  };

  /** Re-reads everything from the keyboard, discarding nothing that is pending. */
  const refresh = async (): Promise<void> => {
    const s = requireSession();
    await flushSaves();
    await queue.whenIdle();
    const [keymap, macroBytes, menuValues, layoutOptions] = await Promise.all([
      s.api.readKeymap(s.definition.matrix, s.info.layerCount),
      s.info.macroCount > 0 ? s.api.readMacroBuffer() : Promise.resolve([]),
      readMenuValues(s.api, s.definition, s.info.protocol),
      withUnhandledAsNull(s.api.getLayoutOptions()),
    ]);
    $confirmedKeymap.set(keymap);
    $confirmedMacroBytes.set(macroBytes);
    $confirmedMenuValues.set({...$confirmedMenuValues.get(), ...menuValues});
    $confirmedLayoutOptions.set(layoutOptions);
  };

  /** Resolves when every queued write and pending save has finished. */
  const whenIdle = async (): Promise<void> => {
    await flushSaves();
    await queue.whenIdle();
  };

  return {
    // State
    $connection: $connection as ReadableAtom<ConnectionState>,
    $definition: $definition as ReadableAtom<KeyboardDefinition | null>,
    $keycodes,
    $keymap,
    $confirmedKeymap: $confirmedKeymap as ReadableAtom<Keymap | null>,
    $menuValues,
    $confirmedMenuValues: $confirmedMenuValues as ReadableAtom<MenuValues>,
    $macros,
    $confirmedMacros,
    $layoutOptions,
    $layoutChoices,
    $writes: $writes as ReadableAtom<readonly WriteRecord[]>,
    $targetStatus: $targetStatus as ReadableAtom<TargetStatus>,
    $pendingWrites,
    // Actions
    connect,
    disconnect,
    refresh,
    setKeycode,
    writeKeymap,
    setMenuValue,
    setMacros,
    setMacro,
    setLayoutChoices,
    exportSnapshot,
    restoreSnapshot,
    importViaLayoutFile,
    whenIdle,
    /** The definition registry used to resolve definitions; use it to sideload JSON. */
    registry,
    /** Raw protocol access for diagnostics. Undefined while disconnected. */
    get api(): KeyboardApi | undefined {
      return session?.api;
    },
  };
};

