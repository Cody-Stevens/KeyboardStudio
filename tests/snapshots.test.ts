import {describe, expect, it} from 'vitest';
import {
  BrowserDb,
  Command,
  DefinitionRegistry,
  SnapshotLibrary,
  ValidationError,
  createKeyboardStore,
  createLinky87Mock,
  parseSnapshot,
  serializeSnapshot,
  snapshotFileName,
  type KeyboardSnapshot,
} from '../src/core/index.ts';
import {keymapFixture} from './helpers.ts';

const connected = async () => {
  const transport = createLinky87Mock();
  const store = createKeyboardStore({
    registry: new DefinitionRegistry({db: new BrowserDb(indexedDB, `snap-${Math.random()}`)}),
    menuSaveDelayMs: 0,
  });
  await store.connect(transport);
  return {store, keyboard: transport.keyboard};
};

describe('snapshots', () => {
  it('exports the confirmed keymap, macros, lighting and layout options', async () => {
    const {store} = await connected();
    await store.setMacros(['Hi{KC_ENT}']).done;
    const snapshot = store.exportSnapshot();
    expect(snapshot).toMatchObject({
      format: 'keyboard-studio/snapshot',
      version: 1,
      keyboard: {name: 'Linky87', vendorId: 0x36b0, productId: 0x3005, protocol: 12},
      matrix: {rows: 6, cols: 16},
      layerCount: 4,
      layoutOptions: 0,
    });
    expect(snapshot.keymap).toEqual(keymapFixture);
    expect(snapshot.macros?.expressions[0]).toBe('Hi{KC_ENT}');
    // "Hi", tap Enter; trailing terminators are trimmed.
    expect(snapshot.macros?.bytes).toEqual([0x48, 0x69, 0x01, 0x01, 0x28]);
    expect(Object.keys(snapshot.lighting)).toHaveLength(12);
    expect(snapshot.lighting['id_qmk_rgb_matrix_brightness']).toEqual({channel: 3, valueId: 1, bytes: [255]});
  });

  it('round-trips through JSON text', async () => {
    const {store} = await connected();
    const snapshot = store.exportSnapshot();
    const text = serializeSnapshot(snapshot);
    expect(text).toContain('[41, 58, 59, 60');
    expect(parseSnapshot(JSON.parse(text))).toEqual(snapshot);
    expect(snapshotFileName(snapshot)).toMatch(/^linky87-\d{4}-\d{2}-\d{2}\.keyboard-studio\.json$/);
  });

  it('restores a snapshot onto another keyboard, writing only what differs', async () => {
    const source = await connected();
    await Promise.all([
      source.store.setKeycode(0, 0, 1, 0x0004).done,
      source.store.setKeycode(3, 5, 15, 0x0005).done,
      source.store.setMenuValue('id_qmk_rgb_matrix_effect', {type: 'dropdown', value: 5}).done,
      source.store.setMenuValue('id_qmk_rgblight_color', {type: 'color', hue: 100, sat: 50}).done,
      source.store.setMacros(['first', '{KC_LCTL,KC_V}']).done,
      source.store.setLayoutChoices([1]).done,
    ]);
    const snapshot = source.store.exportSnapshot();

    const target = await connected();
    target.keyboard.log.length = 0;
    const result = await target.store.restoreSnapshot(snapshot);
    expect(result.ok).toBe(true);
    expect(target.store.exportSnapshot()).toEqual({...snapshot, createdAt: expect.any(String)});
    expect(target.keyboard.getKeycode(0, 0, 1)).toBe(0x0004);
    expect(target.keyboard.getSavedCustomValue(3, 2, 1)).toEqual([5]);
    expect(target.keyboard.getSavedCustomValue(2, 4, 2)).toEqual([100, 50]);
    expect(target.keyboard.layoutOptions).toBe(1);

    // Two changed keys far apart: two bulk keymap reports, no full rewrite.
    expect(target.keyboard.log.filter((r) => r[0] === Command.DYNAMIC_KEYMAP_SET_BUFFER)).toHaveLength(2);
    // Two changed lighting values on two channels: two sets, two saves.
    expect(target.keyboard.log.filter((r) => r[0] === Command.CUSTOM_MENU_SET_VALUE)).toHaveLength(2);
    expect(target.keyboard.log.filter((r) => r[0] === Command.CUSTOM_MENU_SAVE)).toHaveLength(2);
  });

  it('writes nothing when restoring a snapshot of the current state', async () => {
    const {store, keyboard} = await connected();
    const snapshot = store.exportSnapshot();
    keyboard.log.length = 0;
    const result = await store.restoreSnapshot(snapshot);
    expect(result.ok).toBe(true);
    expect(keyboard.log).toEqual([]);
  });

  it('refuses a snapshot for a different keyboard before writing anything', async () => {
    const {store, keyboard} = await connected();
    const snapshot = store.exportSnapshot();
    const other: KeyboardSnapshot = {...snapshot, keyboard: {...snapshot.keyboard, name: 'Other', vendorProductId: 1}};
    keyboard.log.length = 0;
    await expect(store.restoreSnapshot(other)).rejects.toThrow(/different keyboard/);
    expect(keyboard.log).toEqual([]);
  });

  it('rejects malformed snapshot files with reasons', () => {
    expect(() => parseSnapshot({format: 'nope'})).toThrow(ValidationError);
    expect(() =>
      parseSnapshot({
        format: 'keyboard-studio/snapshot',
        version: 1,
        keyboard: {vendorProductId: 1},
        matrix: {rows: 1, cols: 2},
        layerCount: 1,
        keymap: [[[1, 70000]]],
        macros: null,
        lighting: {},
        layoutOptions: null,
      }),
    ).toThrow(/keymap must be/);
  });

  it('keeps named snapshots in IndexedDB', async () => {
    const {store} = await connected();
    const library = new SnapshotLibrary(new BrowserDb(indexedDB, `library-${Math.random()}`));
    const snapshot = store.exportSnapshot();
    const saved = await library.save('Work setup', snapshot);
    await library.save('Gaming', snapshot);
    const list = await library.list(snapshot.keyboard.vendorProductId);
    expect(list.map((entry) => entry.name).sort()).toEqual(['Gaming', 'Work setup']);
    expect(await library.get(saved.id)).toEqual(snapshot);
    await library.rename(saved.id, 'Office');
    expect((await library.list()).map((entry) => entry.name)).toContain('Office');
    await library.remove(saved.id);
    expect(await library.list()).toHaveLength(1);
    expect(await library.list(123)).toEqual([]);
  });
});

describe('VIA layout import', () => {
  const viaFile = (overrides: Record<string, unknown> = {}) => ({
    name: 'Linky87',
    vendorProductId: 0x36b0 * 65536 + 0x3005,
    macros: ['{KC_A}bc', ...new Array(15).fill('')],
    layers: keymapFixture.map((layer, idx) =>
      layer.flat().map((value, key) => (idx === 0 && key === 1 ? 'KC_EXLM' : idx === 1 && key === 0 ? 'LT(2,KC_SPC)' : `0x${value.toString(16)}`)),
    ),
    ...overrides,
  });

  it('applies keymap and macros from a VIA save file', async () => {
    const {store, keyboard} = await connected();
    const result = await store.importViaLayoutFile(viaFile());
    expect(result.ok).toBe(true);
    expect(keyboard.getKeycode(0, 0, 1)).toBe(0x021e);
    expect(keyboard.getKeycode(1, 0, 0)).toBe(0x422c);
    expect(store.$macros.get()?.expressions[0]).toBe('{KC_A}bc');
  });

  it('rejects files for other keyboards and unknown keycodes', async () => {
    const {store} = await connected();
    await expect(store.importViaLayoutFile(viaFile({vendorProductId: 5}))).rejects.toThrow(/different keyboard/);
    const bad = viaFile();
    (bad.layers[0] as string[])[0] = 'KC_WHAT';
    await expect(store.importViaLayoutFile(bad)).rejects.toThrow(/KC_WHAT/);
  });
});
