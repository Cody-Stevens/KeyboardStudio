import {beforeAll, describe, expect, it} from 'vitest';
import {
  KeycodeTable,
  LINKY87_LIGHTING_SEED,
  getMenuZones,
  keymapToGrid,
  resolveBoardMeta,
  type BoardMeta,
  type KeyboardDefinition,
  type KeyboardSnapshot,
  type MenuValues,
  type WriteRecord,
} from '../src/core/index.ts';
import {buildBoardModel} from '../src/app/logic/board-model.ts';
import {qmkCodeForEvent, heldModifiers, typedCharacter} from '../src/app/logic/browser-keys.ts';
import {comboKeycode, isRepeatOfBase, keycodeName, legendFor, type LegendContext} from '../src/app/logic/legends.ts';
import {backlightColor, effectLabel, hsvToRgb, previewNote, zoneControls, zonePreview} from '../src/app/logic/lighting.ts';
import {describeStep, expressionFromSteps, recordKeyPress, stepsFromExpression, type MacroStep} from '../src/app/logic/macro-steps.ts';
import {buildPicker, searchPicker} from '../src/app/logic/picker.ts';
import {describeDiff, diffSnapshot} from '../src/app/logic/snapshot-diff.ts';
import {appendEntry, entryStatus, lampFor, type LogEntryBase} from '../src/app/logic/write-log.ts';
import {keymapFixture, linky87Definition} from './helpers.ts';

let definition: KeyboardDefinition;
let table: KeycodeTable;
let meta: BoardMeta;
const flatKeymap = keymapFixture.map((layer) => layer.flat());
const ctx = (layer: number, macroNames: string[] = []): LegendContext => ({table, meta, layer, macroNames});
const menuValuesFromSeed = (): MenuValues => {
  const values: Record<string, number[]> = {};
  for (const control of getMenuZones(definition).flatMap((zone) => zone.controls)) {
    const seed = LINKY87_LIGHTING_SEED[`${control.channel}:${control.valueId}`];
    if (seed) {
      values[control.commandId] = [...seed];
    }
  }
  return values;
};

beforeAll(async () => {
  definition = await linky87Definition();
  table = new KeycodeTable({protocol: 12, customKeycodes: definition.customKeycodes, macroCount: 16, keycodeModules: definition.keycodeModules});
  meta = resolveBoardMeta(definition, 4);
});

describe('board model', () => {
  it('lays out the 87 keys of the ANSI Linky87', () => {
    const model = buildBoardModel(definition.layout, [0], 16);
    expect(model.keys).toHaveLength(87);
    expect(model.width).toBe(18.25);
    expect(model.height).toBe(6.25);
    expect(model.byMatrix.get(2 * 16 + 15)).toMatchObject({row: 2, col: 15});
    // Sorted top to bottom, left to right: Esc first.
    expect(model.keys[0]).toMatchObject({row: 0, col: 0, x: 0, y: 0});
  });

  it('swaps in the ISO Enter keys when that option is on', () => {
    const model = buildBoardModel(definition.layout, [1], 16);
    expect(model.keys).toHaveLength(87);
    expect(model.byMatrix.get(3 * 16 + 13)?.h).toBe(2);
  });
});

describe('legends and names', () => {
  it('names Win keys Cmd on Mac layers', () => {
    expect(legendFor(0xe3, ctx(0)).lines).toEqual(['Win']);
    expect(legendFor(0xe3, ctx(1)).lines).toEqual(['Cmd']);
    expect(keycodeName(0xe2, ctx(1))).toBe('Left Option');
  });

  it('shows the Fn keys as Fn and names the layer they open', () => {
    expect(legendFor(0x5223, ctx(1)).lines).toEqual(['Fn']);
    expect(keycodeName(0x5223, ctx(1))).toBe('Hold for Mac Fn');
    // Layer 0 holds MO(0); the board meta keeps its legend as Fn without changing it.
    expect(legendFor(0x5220, ctx(0), {row: 5, col: 10}).lines).toEqual(['Fn']);
    expect(keycodeName(0x5220, ctx(0))).toBe('Hold for Windows');
  });

  it('marks Fn + End as a factory reset', () => {
    const legend = legendFor(flatKeymap[2]?.[2 * 16 + 15] ?? 0, ctx(2));
    expect(legend.kind).toBe('danger');
    expect(keycodeName(0x7c03, ctx(2))).toBe('Factory reset');
  });

  it('uses plain names for the board keys', () => {
    expect(keycodeName(0x7e01, ctx(2))).toBe('Bluetooth 1');
    expect(legendFor(0x7e06, ctx(2)).lines).toEqual(['Win', 'lock']);
    expect(keycodeName(0x7e00, ctx(2))).toBe('2.4 GHz wireless');
  });

  it('writes shifted symbols on two lines and combos with modifiers', () => {
    expect(legendFor(0x1e, ctx(0)).lines).toEqual(['!', '1']);
    const ctrlC = comboKeycode(['ctrl'], 0x06);
    expect(ctrlC).toBe(0x0106);
    expect(table.valueOf('LCTL(KC_C)')).toBe(ctrlC);
    expect(keycodeName(ctrlC, ctx(0))).toBe('Ctrl + C');
    expect(keycodeName(comboKeycode(['ctrl', 'gui'], 0x17), ctx(1))).toBe('Ctrl + Cmd + T');
  });

  it('uses the names given to macros', () => {
    expect(legendFor(0x7701, ctx(0, ['', 'Sig'])).lines).toEqual(['Sig']);
    expect(keycodeName(0x7700, ctx(0))).toBe('Macro: Macro 1');
  });

  it('finds Fn-layer keys that repeat the base layer', () => {
    // Q (row 2, col 1) is the same on Windows and Windows Fn; F1 (row 0, col 1) is not.
    expect(isRepeatOfBase(meta, flatKeymap, 2, 2 * 16 + 1)).toBe(true);
    expect(isRepeatOfBase(meta, flatKeymap, 2, 1)).toBe(false);
    expect(isRepeatOfBase(meta, flatKeymap, 0, 2 * 16 + 1)).toBe(false);
  });
});

describe('browser keys', () => {
  const event = (code: string, key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
    code,
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });

  it('maps physical keys to QMK codes', () => {
    expect(qmkCodeForEvent(event('KeyA', 'a'))).toBe('KC_A');
    expect(qmkCodeForEvent(event('Escape', 'Escape'))).toBe('KC_ESC');
    expect(qmkCodeForEvent(event('Digit3', '#'))).toBe('KC_3');
    expect(qmkCodeForEvent(event('Fn', 'Fn'))).toBeNull();
    expect(table.valueOf(qmkCodeForEvent(event('CapsLock', 'CapsLock')) ?? '')).toBe(0x39);
  });

  it('separates typed text from shortcuts', () => {
    expect(typedCharacter(event('KeyA', 'A', {shiftKey: true}))).toBe('A');
    expect(typedCharacter(event('KeyC', 'c', {ctrlKey: true}))).toBeNull();
    expect(heldModifiers(event('KeyT', 'T', {ctrlKey: true, shiftKey: true}))).toEqual(['ctrl', 'shift']);
    expect(heldModifiers(event('ControlLeft', 'Control', {ctrlKey: true}))).toEqual([]);
  });
});

describe('macro steps', () => {
  const press = (steps: MacroStep[], code: string, key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => {
    const result = recordKeyPress(steps, {code, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods});
    return result.kind === 'added' ? result.steps : steps;
  };

  it('records text, shortcuts and special keys', () => {
    let steps: MacroStep[] = [];
    steps = press(steps, 'KeyH', 'H', {shiftKey: true});
    steps = press(steps, 'KeyI', 'i');
    steps = press(steps, 'Enter', 'Enter');
    steps = press(steps, 'ControlLeft', 'Control', {ctrlKey: true});
    steps = press(steps, 'KeyT', 't', {ctrlKey: true, shiftKey: true});
    expect(steps).toEqual([
      {type: 'text', text: 'Hi'},
      {type: 'tap', key: 'KC_ENT'},
      {type: 'chord', keys: ['KC_LCTL', 'KC_LSFT', 'KC_T']},
    ]);
    expect(expressionFromSteps(steps)).toBe('Hi{KC_ENT}{KC_LCTL,KC_LSFT,KC_T}');
    expect(stepsFromExpression('Hi{KC_ENT}{KC_LCTL,KC_LSFT,KC_T}')).toEqual(steps);
  });

  it('describes steps in words', () => {
    const name = (code: string) => code.replace('KC_', '');
    expect(describeStep({type: 'chord', keys: ['KC_LCTL', 'KC_C']}, name)).toEqual({verb: 'presses', what: 'LCTL + C'});
    expect(describeStep({type: 'delay', ms: 100}, name)).toEqual({verb: 'waits', what: '100 ms'});
  });
});

describe('lighting', () => {
  it('finds the controls of each zone', () => {
    const [logo, backlight] = getMenuZones(definition);
    expect(zoneControls(backlight!).effect?.commandId).toBe('id_qmk_rgb_matrix_effect');
    expect(zoneControls(backlight!).brightness?.range).toEqual([0, 160]);
    expect(zoneControls(logo!).speed?.range).toEqual([0, 4]);
    expect(effectLabel('solid_color')).toBe('Solid colour');
  });

  it('shows the real backlight (solid reactive, brightness 255) from the firmware formula', () => {
    const backlight = getMenuZones(definition)[1]!;
    const preview = zonePreview(backlight, menuValuesFromSeed());
    expect(preview.effectName).toBe('Solid reactive');
    expect(preview.mode).toBe('effect');
    expect(preview.faithful).toBe(true);
    expect(preview.animated).toBe(false);
    expect(preview.reactive).toBe(true);
    expect(preview.brightnessOutOfRange).toBe(true);
    expect(preview.level).toBe(1);
    expect(previewNote(preview)).toMatch(/Type, or click keys on the model/);
  });

  it('shows the colour, and says so, for effects it cannot compute', () => {
    const backlight = getMenuZones(definition)[1]!;
    const preview = zonePreview(backlight, {...menuValuesFromSeed(), id_qmk_rgb_matrix_effect: [42]});
    expect(preview.effectName).toBe('Starlight');
    expect(preview.mode).toBe('colour-only');
    expect(preview.faithful).toBe(false);
    expect(previewNote(preview)).toMatch(/shows the colour/);
  });

  it('animates breathing on the backlight from the QMK formula', () => {
    const backlight = getMenuZones(definition)[1]!;
    const preview = zonePreview(backlight, {...menuValuesFromSeed(), id_qmk_rgb_matrix_effect: [5], id_qmk_rgb_matrix_brightness: [80]});
    expect(preview.mode).toBe('effect');
    expect(preview.effect).toBe('breathing');
    expect(preview.faithful && preview.animated).toBe(true);
    expect(preview.level).toBe(0.5);
    const led = {x: 112, y: 32, index: 0, isMod: false};
    expect(backlightColor(preview, led, {timer: 0, hits: []})).toEqual([0, 0, 0]);
    const lit = backlightColor(preview, led, {timer: 1000, hits: []});
    expect(Math.max(...lit)).toBeGreaterThan(0);
  });

  it('treats a logo effect that picks its own colours as neutral', () => {
    const logo = getMenuZones(definition)[0]!;
    const preview = zonePreview(logo, {...menuValuesFromSeed(), id_qmk_rgblight_effect: [1]});
    expect(preview.effectName).toBe('Wave');
    expect(preview.mode).toBe('own-colours');
    const off = zonePreview(logo, {...menuValuesFromSeed(), id_qmk_rgblight_effect: [0]});
    expect(off.mode).toBe('off');
    expect(off.level).toBe(0);
  });

  it('converts QMK HSV to RGB', () => {
    expect(hsvToRgb(0, 255, 255)).toEqual([1, 0, 0]);
    expect(hsvToRgb(0, 0, 255)).toEqual([1, 1, 1]);
  });
});

describe('picker', () => {
  it('finds Esc first when searching "esc"', () => {
    const categories = buildPicker(ctx(0), 4, 16);
    expect(searchPicker(categories, 'esc')[0]?.name).toBe('Esc');
  });

  it('lists the board keys with plain names and layer keys by layer name', () => {
    const categories = buildPicker(ctx(0), 4, 16);
    const board = categories.find((category) => category.id === 'board');
    expect(board?.items.map((item) => item.name).slice(0, 5)).toEqual(['2.4 GHz wireless', 'Bluetooth 1', 'Bluetooth 2', 'Bluetooth 3', 'USB cable']);
    expect(searchPicker(categories, 'bluetooth').map((item) => item.name)).toContain('Bluetooth 2');
    expect(searchPicker(categories, 'mac fn').map((item) => item.name)).toContain('Hold for Mac Fn');
  });

  it('marks dangerous keys with an explanation', () => {
    const special = buildPicker(ctx(2), 4, 16).find((category) => category.id === 'special');
    const reset = special?.items.find((item) => item.value === 0x7c03);
    expect(reset?.danger).toMatch(/erases every change/);
  });
});

describe('snapshot diff', () => {
  const snapshotFrom = (keymap: number[][]): KeyboardSnapshot => ({
    format: 'keyboard-studio/snapshot',
    version: 1,
    createdAt: '2026-11-12T00:00:00.000Z',
    keyboard: {name: 'Linky87', vendorId: 0x36b0, productId: 0x3005, vendorProductId: 0x36b0 * 65536 + 0x3005, protocol: 12},
    matrix: {rows: 6, cols: 16},
    layerCount: 4,
    keymap: keymapToGrid(keymap, 16),
    macros: {count: 16, bufferSize: 338, expressions: ['Hi'], bytes: [72, 105, 0]},
    lighting: {id_qmk_rgb_matrix_effect: {channel: 3, valueId: 2, bytes: [1]}},
    layoutOptions: 0,
  });

  it('counts changed keys per layer, macros and lighting', () => {
    const target = flatKeymap.map((layer) => [...layer]);
    target[0]![3 * 16] = 0x29;
    target[0]![0] = 0x39;
    target[3]![5] = 0;
    const diff = diffSnapshot(snapshotFrom(target), {
      keymap: flatKeymap,
      macroBytes: [],
      macroExpressions: [],
      menuValues: {id_qmk_rgb_matrix_effect: [31]},
      layoutOptions: 0,
    });
    expect(diff.keys).toEqual([
      {layer: 0, count: 2},
      {layer: 3, count: 1},
    ]);
    expect(diff.macroSlots).toEqual([0]);
    expect(diff.lighting).toEqual(['id_qmk_rgb_matrix_effect']);
    expect(describeDiff(diff, (layer) => meta.layers[layer]?.name ?? '', () => 'Backlight')).toEqual([
      '2 keys on Windows',
      '1 key on Mac Fn',
      'Macro 1',
      'Lighting: Backlight',
    ]);
  });

  it('reports an empty diff when the keyboard already matches', () => {
    const diff = diffSnapshot(snapshotFrom(flatKeymap), {
      keymap: flatKeymap,
      macroBytes: [72, 105, 0, 0],
      macroExpressions: ['Hi'],
      menuValues: {id_qmk_rgb_matrix_effect: [1]},
      layoutOptions: 0,
    });
    expect(diff.isEmpty).toBe(true);
  });
});

describe('write log', () => {
  const record = (id: number, state: WriteRecord['state'], extra: Partial<WriteRecord> = {}): WriteRecord => ({
    id,
    target: {kind: 'key', layer: 0, row: 0, col: 0},
    state,
    startedAt: 0,
    ...extra,
  });

  it('derives status from the store records, ignoring superseded writes', () => {
    const writes = new Map([
      [1, record(1, 'superseded')],
      [2, record(2, 'saved', {settledAt: 5})],
      [3, record(3, 'pending')],
      [4, record(4, 'failed', {verified: true, error: 'timeout'})],
    ]);
    expect(entryStatus([1, 2], writes)).toEqual({state: 'saved', settledAt: 5});
    expect(entryStatus([2, 3], writes)).toEqual({state: 'pending'});
    expect(entryStatus([2, 4], writes)).toEqual({state: 'failed', verified: true, error: 'timeout'});
  });

  it('lights the lamp from the newest entry', () => {
    const connected = {
      status: 'connected' as const,
      device: {vendorId: 1, productId: 2, productName: 'x'},
      transportKind: 'mock' as const,
      protocol: 12,
      layerCount: 4,
      macroCount: 16,
      macroBufferSize: 338,
      firmwareVersion: null,
      readOnly: false,
      connectMs: 1,
      connectReports: 1,
      warnings: [],
    };
    expect(lampFor(connected, [], 0).state).toBe('idle');
    expect(lampFor(connected, [{state: 'saved', settledAt: 1}], 1).state).toBe('saving');
    expect(lampFor(connected, [{state: 'saved', settledAt: 1}, {state: 'failed', verified: true, error: 'x'}], 0).state).toBe('failed');
    expect(lampFor(connected, [{state: 'failed', verified: true, error: 'x'}, {state: 'saved', settledAt: 1}], 0).text).toBe(
      'All changes are on the keyboard',
    );
    expect(lampFor({status: 'disconnected'}, [], 0).state).toBe('disconnected');
  });

  it('merges slider drags into one line', () => {
    const entry = (id: number, mergeKey?: string): LogEntryBase => ({
      id,
      at: id,
      text: `t${id}`,
      rollbackText: '',
      writeIds: [id],
      ...(mergeKey ? {mergeKey} : {}),
    });
    const merge = (a: LogEntryBase, b: LogEntryBase): LogEntryBase => ({...b, id: a.id, writeIds: [...a.writeIds, ...b.writeIds]});
    let log: LogEntryBase[] = [];
    log = appendEntry(log, entry(1, 'menu:x'), merge);
    log = appendEntry(log, entry(2, 'menu:x'), merge);
    log = appendEntry(log, entry(3), merge);
    log = appendEntry(log, entry(4, 'menu:x'), merge);
    expect(log.map((e) => [e.id, e.writeIds])).toEqual([
      [1, [1, 2]],
      [3, [3]],
      [4, [4]],
    ]);
  });
});
