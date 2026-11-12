/**
 * KeyboardStudio core: framework-free VIA keyboard engine.
 *
 * Layers, bottom to top:
 * - transport: moves 32-byte HID reports (WebHID or an in-memory mock)
 * - protocol: pairs requests with replies and exposes typed VIA calls
 * - definitions, keycodes, macros: pure data handling
 * - store: nanostores state with optimistic writes and per-write status
 * - snapshots: export, restore and keep named snapshots in the browser
 */

// Transport
export type {HidDeviceInfo, Transport, TransportKind} from './transport/types.ts';
export {WebHidTransport, isWebHidSupported, listAuthorizedWebHidKeyboards, requestWebHidKeyboard} from './transport/webhid.ts';
export {MockKeyboard, type MockKeyboardSeed} from './transport/mock-keyboard.ts';
export {
  MockTransport,
  matchCommand,
  type MockFailureMode,
  type MockFailureRule,
  type MockLatency,
  type MockTransportOptions,
} from './transport/mock-transport.ts';
export {createLinky87Mock, linky87Seed, LINKY87_LIGHTING_SEED, LINKY87_PRODUCT_ID, LINKY87_VENDOR_ID} from './mock/linky87.ts';

// Protocol
export {Command, CustomChannel, KeyboardValue, Protocol, REPORT_SIZE, MAX_BUFFER_CHUNK} from './protocol/constants.ts';
export {CommandChannel, type ChannelStats, type CommandChannelOptions, type CommandExchange} from './protocol/command-channel.ts';
export {KeyboardApi, planKeymapSegments, type Keymap, type KeymapSegment, type MatrixSize} from './protocol/keyboard-api.ts';
export {
  CommandTimeoutError,
  DisconnectedError,
  ForbiddenCommandError,
  KeyboardStudioError,
  ProtocolError,
  ReadOnlyError,
  UnhandledCommandError,
  ValidationError,
  errorMessage,
} from './protocol/errors.ts';
export {toHex} from './protocol/bytes.ts';

// Definitions
export type {
  ControlType,
  DefinitionSource,
  KeyboardDefinition,
  KeyboardLayout,
  LayoutKey,
  LayoutOption,
  MenuControl,
  MenuGroup,
  MenuNode,
  MenuText,
} from './definitions/types.ts';
export {parseDefinition, collectControls} from './definitions/parse.ts';
export {decodeLayoutOptions, encodeLayoutOptions, matrixIndex, visibleKeys} from './definitions/layout.ts';
export {evaluateShowIf, parseShowIf, type ShowIfValues} from './definitions/show-if.ts';
export {
  decodeControlValue,
  encodeControlValue,
  findControl,
  getMenuZones,
  getReadableControls,
  isNodeVisible,
  visibleControls,
  type ControlInput,
  type ControlValue,
  type MenuValues,
  type MenuZone,
} from './definitions/menus.ts';
export {BUNDLED_DEFINITIONS, findBundledDefinition, type BundledDefinition} from './definitions/bundled/index.ts';
export {
  USEVIA_DEFINITIONS_URL,
  fetchPublicDefinitionIndex,
  lookupPublicDefinition,
  type PublicDefinitionIndex,
  type PublicLookupOptions,
} from './definitions/lookup.ts';
export {DefinitionRegistry, type DefinitionRegistryOptions} from './definitions/registry.ts';

// Keycodes
export {
  KeycodeTable,
  SUPPORTED_KEYCODE_PROTOCOLS,
  type CustomKeycodeDefinition,
  type KeycodeCategory,
  type KeycodeEntry,
  type KeycodeInfo,
  type KeycodeKind,
  type KeycodeTableOptions,
} from './keycodes/keycode-table.ts';

// Macros
export {
  MAX_MACRO_DELAY_MS,
  decodeMacroBuffer,
  encodeMacros,
  expressionToRawSequence,
  expressionToSequence,
  macroBytesNeeded,
  optimizedToRaw,
  rawSequenceToExpression,
  rawToOptimized,
  sequenceToExpression,
  validateMacroExpression,
  type MacroAction,
  type MacroKeyResolver,
  type MacroSequence,
  type MacroValidation,
  type OptimizedMacroAction,
} from './macros/codec.ts';

// Store
export {
  createKeyboardStore,
  targetKey,
  type ConnectOptions,
  type ConnectedKeyboard,
  type ConnectionState,
  type KeyboardStore,
  type KeyboardStoreOptions,
  type MacroState,
  type RestoreResult,
  type TargetStatus,
  type WriteHandle,
  type WriteRecord,
  type WriteState,
  type WriteTarget,
} from './store/keyboard-store.ts';

// Snapshots and browser storage
export {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  gridToKeymap,
  keymapToGrid,
  parseSnapshot,
  serializeSnapshot,
  snapshotFileName,
  snapshotIncompatibilities,
  type KeyboardSnapshot,
  type SnapshotLightingValue,
} from './snapshots/snapshot.ts';
export {SnapshotLibrary, type SnapshotSummary, type StoredSnapshot} from './snapshots/library.ts';
export {importViaLayout, isViaLayoutFile, type ImportedViaLayout, type ViaLayoutFile} from './snapshots/via-layout.ts';
export {BrowserDb} from './storage/browser-db.ts';
