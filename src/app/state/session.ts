/**
 * The connection to one keyboard and the view of its state the UI draws.
 *
 * The store forgets everything when the keyboard disconnects. The UI keeps
 * the last state it saw (`$session` with `stale: true`), so the page stays
 * readable while the user plugs the keyboard back in.
 */
import {atom, computed} from 'nanostores';
import {
  DefinitionRegistry,
  MockKeyboard,
  MockTransport,
  KeyboardStudioError,
  LINKY87_PRODUCT_ID,
  LINKY87_VENDOR_ID,
  createKeyboardStore,
  errorMessage,
  linky87Seed,
  listAuthorizedWebHidKeyboards,
  lookupPublicDefinition,
  matchCommand,
  parseDefinition,
  preloadDefinitionParser,
  requestWebHidKeyboard,
  resolveBoardMeta,
  type BoardMeta,
  type ConnectedKeyboard,
  type KeyboardDefinition,
  type KeycodeTable,
  type Keymap,
  type MacroState,
  type MenuValues,
  type MockFailureMode,
  type Transport,
} from '../../core/index.ts';
import {buildBoardModel, type BoardModel} from '../logic/board-model.ts';
import {keycodeName, legendFor, type LegendContext} from '../logic/legends.ts';
import {env, isNumberArray, isStringArray, loadSetting, saveSetting} from './env.ts';

export const registry = new DefinitionRegistry();
export const store = createKeyboardStore({registry});
if (typeof window !== 'undefined') {
  preloadDefinitionParser();
}

// ---------------------------------------------------------------------------
// Phases of the connect flow
// ---------------------------------------------------------------------------

export type Phase =
  | {readonly name: 'landing'}
  | {readonly name: 'choosing'}
  | {readonly name: 'connecting'}
  | {
      readonly name: 'needs-definition';
      readonly vendorProductId: number;
      readonly productName: string;
      readonly problem?: string;
      readonly looking?: boolean;
    }
  | {readonly name: 'connected'}
  | {readonly name: 'lost'; readonly message: string}
  | {readonly name: 'failed'; readonly message: string};

export const $phase = atom<Phase>({name: 'landing'});
/** True once the board has been shown, so reconnects skip the assemble animation. */
export const $hasShownBoard = atom(false);

let pendingTransport: Transport | null = null;
let lastDevice: {vendorId: number; productId: number} | null = null;

// ---------------------------------------------------------------------------
// Mock keyboard (?mock=1)
// ---------------------------------------------------------------------------

const WRITE_COMMANDS = [0x03, 0x05, 0x07, 0x09, 0x0f, 0x10, 0x13];
let mockKeyboard: MockKeyboard | null = null;
let mockTransport: MockTransport | null = null;

const makeMockTransport = (): MockTransport => {
  mockKeyboard ??= new MockKeyboard(linky87Seed());
  const transport = new MockTransport(mockKeyboard, {
    // About what the real Linky87 answers in (2.1 ms per report, measured 2026-11-12).
    latency: env.mockLatency > 0 ? env.mockLatency : {minMs: 1, maxMs: 3},
    info: {vendorId: LINKY87_VENDOR_ID, productId: LINKY87_PRODUCT_ID, productName: 'Linky87 (demo)'},
    ...(env.mockFailRate > 0
      ? {failures: [{mode: 'send-error' as const, match: (r: Uint8Array) => WRITE_COMMANDS.includes(r[0] ?? 0) && Math.random() < env.mockFailRate}]}
      : {}),
  });
  mockTransport = transport;
  return transport;
};

/**
 * Hooks for automated tests against the mock, on `window.__keyboardStudio`.
 * Only installed with `?mock=1`.
 */
const installTestHooks = () => {
  if (!env.mock || typeof window === 'undefined') {
    return;
  }
  const hooks = {
    store,
    keyboard: () => mockKeyboard,
    keymap: () => mockKeyboard?.keymapGrid() ?? null,
    customValue: (channel: number, valueId: number, length: number) => mockKeyboard?.getCustomValue(channel, valueId, length) ?? null,
    savedCustomValue: (channel: number, valueId: number, length: number) => mockKeyboard?.getSavedCustomValue(channel, valueId, length) ?? null,
    macroBuffer: () => (mockKeyboard ? [...mockKeyboard.macroBuffer] : null),
    /** Makes the next `times` writes of the given command ids fail. */
    failWrites: (times: number, mode: MockFailureMode = 'send-error', commands: number[] = WRITE_COMMANDS) =>
      mockTransport?.injectFailure({mode, times, match: matchCommand(...commands)}),
    unplug: () => mockTransport?.unplug(),
    idle: () => store.whenIdle(),
  };
  Object.assign(window, {__keyboardStudio: hooks});
};
installTestHooks();

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

const vpidOf = (transport: Transport) => transport.info.vendorId * 65536 + transport.info.productId;

const connectWith = async (transport: Transport, definition: KeyboardDefinition) => {
  $phase.set({name: 'connecting'});
  try {
    await store.connect(transport, {definition});
    lastDevice = {vendorId: transport.info.vendorId, productId: transport.info.productId};
    pendingTransport = null;
    $phase.set({name: 'connected'});
  } catch (error) {
    $phase.set({name: 'failed', message: errorMessage(error)});
  }
};

/** Finds the definition for a transport, or asks for one. */
const begin = async (transport: Transport) => {
  $phase.set({name: 'connecting'});
  const vendorProductId = vpidOf(transport);
  let definition: KeyboardDefinition | null = null;
  try {
    definition = env.mock && env.mockUnknownBoard ? await registry.getSideloaded(vendorProductId) : await registry.resolve(vendorProductId);
  } catch (error) {
    $phase.set({name: 'needs-definition', vendorProductId, productName: transport.info.productName, problem: errorMessage(error)});
    pendingTransport = transport;
    return;
  }
  if (!definition) {
    pendingTransport = transport;
    $phase.set({name: 'needs-definition', vendorProductId, productName: transport.info.productName});
    return;
  }
  await connectWith(transport, definition);
};

/** The Connect button: the browser's device chooser, or the mock. */
export const connect = async (): Promise<void> => {
  if (env.mock) {
    await begin(makeMockTransport());
    return;
  }
  $phase.set({name: 'choosing'});
  try {
    const transport = await requestWebHidKeyboard();
    if (!transport) {
      $phase.set({name: 'landing'});
      return;
    }
    await begin(transport);
  } catch (error) {
    // Closing the chooser without picking throws NotFoundError in Chromium.
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      $phase.set({name: 'landing'});
      return;
    }
    $phase.set({name: 'failed', message: errorMessage(error)});
  }
};

/** Reconnects to the last keyboard without the chooser when the browser still has access. */
export const reconnect = async (): Promise<void> => {
  if (env.mock) {
    await begin(makeMockTransport());
    return;
  }
  const authorized = await listAuthorizedWebHidKeyboards();
  const match = authorized.find(
    (transport) => lastDevice && transport.info.vendorId === lastDevice.vendorId && transport.info.productId === lastDevice.productId,
  );
  if (match) {
    await begin(match);
  } else {
    await connect();
  }
};

export const disconnect = async (): Promise<void> => {
  await store.disconnect();
  $lastKnown.set(null);
  $phase.set({name: 'landing'});
};

/** A definition file the user dropped for an unknown keyboard. Kept in this browser for next time. */
export const provideDefinition = async (json: unknown): Promise<void> => {
  const phase = $phase.get();
  const transport = pendingTransport;
  if (phase.name !== 'needs-definition' || !transport) {
    return;
  }
  try {
    const definition = await parseDefinition(json, 'sideloaded');
    if (definition.vendorProductId !== phase.vendorProductId) {
      $phase.set({
        ...phase,
        problem: `This file is for ${definition.name} (${hexId(definition.vendorProductId)}), but the keyboard is ${hexId(phase.vendorProductId)}.`,
      });
      return;
    }
    await registry.sideload(json).catch(() => definition);
    await connectWith(transport, definition);
  } catch (error) {
    $phase.set({...phase, problem: `That file is not a VIA definition this app can read. ${errorMessage(error)}`});
  }
};

/** Looks the keyboard up in the public list usevia.app serves. */
export const lookUpPublicDefinition = async (): Promise<void> => {
  const phase = $phase.get();
  const transport = pendingTransport;
  if (phase.name !== 'needs-definition' || !transport) {
    return;
  }
  $phase.set({...phase, looking: true});
  try {
    const definition = await lookupPublicDefinition(phase.vendorProductId);
    if (!definition) {
      $phase.set({...phase, looking: false, problem: 'usevia.app has no definition for this keyboard. Ask its maker for the VIA JSON file.'});
      return;
    }
    await connectWith(transport, definition);
  } catch (error) {
    $phase.set({...phase, looking: false, problem: `The lookup did not work: ${errorMessage(error)}`});
  }
};

export const cancelDefinition = (): void => {
  pendingTransport = null;
  $phase.set({name: 'landing'});
};

export const hexId = (vendorProductId: number): string => {
  const vendor = Math.floor(vendorProductId / 65536);
  const product = vendorProductId % 65536;
  return `${vendor.toString(16).toUpperCase().padStart(4, '0')}:${product.toString(16).toUpperCase().padStart(4, '0')}`;
};

store.$connection.subscribe((connection) => {
  if (connection.status === 'error' && $phase.get().name === 'connected') {
    $phase.set({name: 'lost', message: connection.message});
  }
});

// ---------------------------------------------------------------------------
// The session view
// ---------------------------------------------------------------------------

export interface SessionView {
  /** True when the keyboard is gone and this is the last state seen. Read-only. */
  readonly stale: boolean;
  readonly info: ConnectedKeyboard;
  readonly definition: KeyboardDefinition;
  readonly meta: BoardMeta;
  readonly model: BoardModel;
  readonly table: KeycodeTable;
  readonly keymap: Keymap;
  readonly menuValues: MenuValues;
  readonly macros: MacroState | null;
  readonly layoutChoices: readonly number[];
}

const metaCache = new WeakMap<KeyboardDefinition, Map<number, BoardMeta>>();
const modelCache = new WeakMap<KeyboardDefinition, Map<string, BoardModel>>();

const metaFor = (definition: KeyboardDefinition, layerCount: number): BoardMeta => {
  const byCount = metaCache.get(definition) ?? new Map<number, BoardMeta>();
  metaCache.set(definition, byCount);
  const cached = byCount.get(layerCount);
  if (cached) {
    return cached;
  }
  const meta = resolveBoardMeta(definition, layerCount);
  byCount.set(layerCount, meta);
  return meta;
};

const modelFor = (definition: KeyboardDefinition, choices: readonly number[]): BoardModel => {
  const byChoice = modelCache.get(definition) ?? new Map<string, BoardModel>();
  modelCache.set(definition, byChoice);
  const key = choices.join(',');
  const cached = byChoice.get(key);
  if (cached) {
    return cached;
  }
  const model = buildBoardModel(definition.layout, choices, definition.matrix.cols);
  byChoice.set(key, model);
  return model;
};

const $live = computed(
  [store.$connection, store.$definition, store.$keycodes, store.$keymap, store.$menuValues, store.$macros, store.$layoutChoices],
  (connection, definition, table, keymap, menuValues, macros, layoutChoices): SessionView | null => {
    if (connection.status !== 'connected' || !definition || !table || !keymap) {
      return null;
    }
    const choices = layoutChoices ?? definition.layout.options.map(() => 0);
    return {
      stale: false,
      info: connection,
      definition,
      meta: metaFor(definition, connection.layerCount),
      model: modelFor(definition, choices),
      table,
      keymap,
      menuValues,
      macros,
      layoutChoices: choices,
    };
  },
);

const $lastKnown = atom<SessionView | null>(null);
$live.subscribe((live) => {
  if (live) {
    $lastKnown.set(live);
  }
});

export const $session = computed([$live, $lastKnown], (live, last): SessionView | null => live ?? (last ? {...last, stale: true} : null));

// ---------------------------------------------------------------------------
// Names kept in the browser: macro names and the keys' own names
// ---------------------------------------------------------------------------

/** Macro names by slot. Keyboards do not store names, so they live in this browser. */
export const $macroNames = atom<readonly string[]>([]);
/** Layer 0 as first seen, so a key keeps its own name ("Caps Lock") after it is remapped. */
export const $homeLayer = atom<readonly number[]>([]);

let namesFor: number | null = null;
$live.subscribe((live) => {
  if (!live) {
    return;
  }
  const vpid = live.definition.vendorProductId;
  if (namesFor === vpid) {
    return;
  }
  namesFor = vpid;
  $macroNames.set(loadSetting(`macro-names:${vpid}`, [], isStringArray));
  const home = loadSetting<number[]>(`home-layer:${vpid}`, [], isNumberArray);
  const fresh = [...(store.$confirmedKeymap.get()?.[0] ?? [])];
  if (home.length === fresh.length && home.length > 0) {
    $homeLayer.set(home);
  } else {
    $homeLayer.set(fresh);
    saveSetting(`home-layer:${vpid}`, fresh);
  }
});

export const setMacroName = (index: number, name: string): void => {
  const session = $session.get();
  if (!session) {
    return;
  }
  const names = [...$macroNames.get()];
  while (names.length <= index) {
    names.push('');
  }
  names[index] = name.trim();
  $macroNames.set(names);
  saveSetting(`macro-names:${session.definition.vendorProductId}`, names);
};

export const legendContext = (session: SessionView, layer: number): LegendContext => ({
  table: session.table,
  meta: session.meta,
  layer,
  macroNames: $macroNames.get(),
});

/** What a physical key is called, by what it did on layer 0 when first seen. */
export const physicalKeyName = (session: SessionView, matrix: number): string => {
  const key = session.model.byMatrix.get(matrix);
  const note = key ? session.meta.keyNotes.find((candidate) => candidate.row === key.row && candidate.col === key.col && candidate.legend) : undefined;
  if (note?.legend) {
    return note.legend.replace(/\n/g, ' ');
  }
  const value = $homeLayer.get()[matrix] ?? session.keymap[0]?.[matrix] ?? 0;
  const ctx = legendContext(session, 0);
  const name = keycodeName(value, ctx);
  if (value === 0) {
    return key ? `The key at row ${key.row + 1}, column ${key.col + 1}` : 'This key';
  }
  return legendFor(value, ctx).kind === 'danger' ? `The ${name} key` : name;
};

export const isKeyboardStudioError = (error: unknown): error is KeyboardStudioError => error instanceof KeyboardStudioError;
