import {describe, expect, it} from 'vitest';
import {
  BrowserDb,
  Command,
  DefinitionRegistry,
  createKeyboardStore,
  createLinky87Mock,
  keymapToGrid,
  matchCommand,
  type MockTransportOptions,
} from '../src/core/index.ts';
import {keymapFixture} from './helpers.ts';

const setup = async (mockOptions: MockTransportOptions = {}, storeOptions: {menuSaveDelayMs?: number; timeoutMs?: number; readOnly?: boolean} = {}) => {
  const transport = createLinky87Mock(mockOptions);
  const store = createKeyboardStore({
    registry: new DefinitionRegistry({db: new BrowserDb(indexedDB, `store-${Math.random()}`)}),
    menuSaveDelayMs: storeOptions.menuSaveDelayMs ?? 0,
    timeoutMs: storeOptions.timeoutMs ?? 100,
  });
  const info = await store.connect(transport, storeOptions.readOnly ? {readOnly: true} : {});
  return {transport, keyboard: transport.keyboard, store, info};
};

describe('keyboard store: connecting', () => {
  it('reads the full state of the Linky87 mock', async () => {
    const {store, info} = await setup();
    expect(store.$connection.get()).toMatchObject({status: 'connected', protocol: 12, layerCount: 4, macroCount: 16, macroBufferSize: 338});
    expect(store.$definition.get()?.name).toBe('Linky87');
    expect(keymapToGrid(store.$keymap.get()!, 16)).toEqual(keymapFixture);
    expect(store.$menuValues.get()).toMatchObject({
      id_qmk_rgblight_brightness: [160],
      id_qmk_rgb_matrix_brightness: [255],
      id_qmk_rgb_matrix_effect: [31],
      id_qmk_audio_color: [0, 255],
      id_firmware_version: [0],
    });
    expect(store.$macros.get()).toMatchObject({count: 16, bufferSize: 338, bytesUsed: 16});
    expect(store.$macros.get()?.expressions).toEqual(new Array(16).fill(''));
    expect(store.$layoutChoices.get()).toEqual([0]);
    expect(store.$keycodes.get()?.codeOf(0x5220)).toBe('MO(0)');
    // protocol, layers, macro count, macro size, layout options, firmware,
    // 28 keymap chunks, 13 macro chunks, 12 menu values
    expect(info.connectReports).toBe(59);
    expect(info.warnings).toEqual([]);
  });

  it('connects in well under 100 ms without latency and stays bounded with 2 ms per report', async () => {
    const fast = await setup();
    expect(fast.info.connectMs).toBeLessThan(100);
    const slow = await setup({latency: 2});
    // 59 reports at >= 2 ms each.
    expect(slow.info.connectMs).toBeGreaterThanOrEqual(59 * 2);
    expect(slow.info.connectMs).toBeLessThan(1000);
  });

  it('reports an error state when no definition is found', async () => {
    const transport = createLinky87Mock({info: {vendorId: 0x1234, productId: 0x5678}});
    const store = createKeyboardStore({registry: new DefinitionRegistry({db: new BrowserDb(indexedDB, `none-${Math.random()}`)})});
    await expect(store.connect(transport)).rejects.toThrow(/No definition/);
    expect(store.$connection.get()).toMatchObject({status: 'error'});
  });
});

describe('keyboard store: write status', () => {
  it('shows a keycode change at once as pending, then saved', async () => {
    const {store, keyboard} = await setup({latency: 5});
    const handle = store.setKeycode(0, 0, 1, 0x0004);
    expect(store.$keymap.get()?.[0]?.[1]).toBe(0x0004);
    expect(store.$confirmedKeymap.get()?.[0]?.[1]).toBe(0x003a);
    expect(store.$targetStatus.get()['key:0:0:1']).toMatchObject({state: 'pending'});
    const record = await handle.done;
    expect(record).toMatchObject({state: 'saved', target: {kind: 'key', layer: 0, row: 0, col: 1}});
    expect(store.$confirmedKeymap.get()?.[0]?.[1]).toBe(0x0004);
    expect(store.$targetStatus.get()['key:0:0:1']).toMatchObject({state: 'saved'});
    expect(keyboard.getKeycode(0, 0, 1)).toBe(0x0004);
    expect(store.$pendingWrites.get()).toBe(0);
  });

  it('rolls back a failed write and re-reads the real value', async () => {
    const {store, transport, keyboard} = await setup();
    transport.injectFailure({mode: 'send-error', times: 1, match: matchCommand(Command.DYNAMIC_KEYMAP_SET_KEYCODE)});
    const handle = store.setKeycode(0, 0, 1, 0x0004);
    expect(store.$keymap.get()?.[0]?.[1]).toBe(0x0004);
    const record = await handle.done;
    expect(record).toMatchObject({state: 'failed', verified: true});
    expect(record.error).toMatch(/rejected/);
    expect(store.$keymap.get()?.[0]?.[1]).toBe(0x003a);
    expect(keyboard.getKeycode(0, 0, 1)).toBe(0x003a);
    expect(store.$targetStatus.get()['key:0:0:1']).toMatchObject({state: 'failed'});
  });

  it('shows the keyboard truth when a write applied but its reply was lost', async () => {
    const {store, transport} = await setup({}, {timeoutMs: 30});
    transport.injectFailure({mode: 'drop-after-apply', times: 1, match: matchCommand(Command.DYNAMIC_KEYMAP_SET_KEYCODE)});
    const record = await store.setKeycode(2, 1, 1, 0x0005).done;
    expect(record).toMatchObject({state: 'failed', verified: true});
    // The keyboard did apply it, and the verification read shows that.
    expect(store.$confirmedKeymap.get()?.[2]?.[16 + 1]).toBe(0x0005);
    expect(store.$keymap.get()?.[2]?.[16 + 1]).toBe(0x0005);
  });

  it('coalesces queued writes to the same key and marks the replaced ones superseded', async () => {
    const {store, keyboard} = await setup({latency: 5});
    const first = store.setKeycode(0, 1, 1, 0x0004); // starts immediately
    const second = store.setKeycode(0, 1, 2, 0x0005); // queued
    const third = store.setKeycode(0, 1, 2, 0x0006); // replaces second
    expect((await second.done).state).toBe('superseded');
    expect((await first.done).state).toBe('saved');
    expect((await third.done).state).toBe('saved');
    expect(keyboard.getKeycode(0, 1, 2)).toBe(0x0006);
    const setCommands = keyboard.log.filter((r) => r[0] === Command.DYNAMIC_KEYMAP_SET_KEYCODE);
    expect(setCommands).toHaveLength(2);
  });

  it('applies lighting at once, saves the channel after the debounce, and survives a power cycle', async () => {
    const {store, keyboard} = await setup({}, {menuSaveDelayMs: 20});
    const handle = store.setMenuValue('id_qmk_rgb_matrix_brightness', {type: 'range', value: 80});
    expect(store.$menuValues.get()['id_qmk_rgb_matrix_brightness']).toEqual([80]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(keyboard.getCustomValue(3, 1, 1)).toEqual([80]);
    expect(keyboard.getSavedCustomValue(3, 1, 1)).toEqual([255]);
    expect(store.$targetStatus.get()['menu:id_qmk_rgb_matrix_brightness']?.state).toBe('pending');
    expect((await handle.done).state).toBe('saved');
    expect(keyboard.getSavedCustomValue(3, 1, 1)).toEqual([80]);
    keyboard.powerCycle();
    expect(keyboard.getCustomValue(3, 1, 1)).toEqual([80]);
  });

  it('sends one save per channel for a burst of slider changes', async () => {
    const {store, keyboard} = await setup({latency: 1}, {menuSaveDelayMs: 30});
    const handles = [10, 20, 30, 40, 50].map((value) => store.setMenuValue('id_qmk_rgblight_brightness', {type: 'range', value}));
    const records = await Promise.all(handles.map((h) => h.done));
    expect(records.at(-1)?.state).toBe('saved');
    expect(records.filter((r) => r.state === 'superseded').length).toBeGreaterThan(0);
    expect(keyboard.log.filter((r) => r[0] === Command.CUSTOM_MENU_SAVE)).toHaveLength(1);
    expect(keyboard.getSavedCustomValue(2, 1, 1)).toEqual([50]);
  });

  it('rolls back a failed lighting write', async () => {
    const {store, transport} = await setup();
    transport.injectFailure({mode: 'unhandled', times: 1, match: matchCommand(Command.CUSTOM_MENU_SET_VALUE)});
    const record = await store.setMenuValue('id_qmk_audio_effect', {type: 'dropdown', value: 4}).done;
    expect(record).toMatchObject({state: 'failed', verified: true});
    expect(store.$menuValues.get()['id_qmk_audio_effect']).toEqual([2]);
  });

  it('refuses invalid values before queueing anything', async () => {
    const {store, keyboard} = await setup();
    const before = keyboard.log.length;
    expect(() => store.setMenuValue('id_qmk_rgblight_brightness', {type: 'range', value: 161})).toThrow(/0 to 160/);
    expect(() => store.setMenuValue('id_nope', [1])).toThrow(/no control/);
    expect(() => store.setKeycode(9, 0, 0, 4)).toThrow(/outside/);
    expect(keyboard.log.length).toBe(before);
  });

  it('fails every write in read-only mode and keeps the displayed state equal to the keyboard', async () => {
    const {store, keyboard} = await setup({}, {readOnly: true});
    const records = await Promise.all([
      store.setKeycode(0, 0, 0, 0x0004).done,
      store.setMenuValue('id_qmk_rgblight_effect', {type: 'dropdown', value: 0}).done,
      store.setMacros(['hello']).done,
    ]);
    expect(records.map((r) => r.state)).toEqual(['failed', 'failed', 'failed']);
    expect(records.every((r) => /read-only/.test(r.error ?? ''))).toBe(true);
    expect(store.$keymap.get()?.[0]?.[0]).toBe(0x0029);
    expect(store.$menuValues.get()['id_qmk_rgblight_effect']).toEqual([2]);
    expect(keyboard.log.filter((r) => [0x05, 0x07, 0x09, 0x0f, 0x10, 0x13].includes(r[0] ?? 0))).toEqual([]);
  });

  it('writes macros and decodes them back', async () => {
    const {store, keyboard} = await setup();
    const record = await store.setMacros(['Hello{KC_ENT}', '{KC_LCTL,KC_C}', '{100}x']).done;
    expect(record.state).toBe('saved');
    expect(store.$macros.get()?.expressions.slice(0, 4)).toEqual(['Hello{KC_ENT}', '{KC_LCTL,KC_C}', '{100}x', '']);
    expect(Array.from(keyboard.macroBuffer.slice(0, 6))).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x01]);
    expect((await store.setMacro(1, 'bye').done).state).toBe('saved');
    expect(store.$macros.get()?.expressions.slice(0, 3)).toEqual(['Hello{KC_ENT}', 'bye', '{100}x']);
    expect(() => store.setMacros(['{KC_NOPE}'])).toThrow(/KC_NOPE/);
    expect(() => store.setMacros([`${'x'.repeat(400)}`])).toThrow(/338/);
  });

  it('rolls back a macro write that fails half way and re-reads the buffer', async () => {
    const {store, transport} = await setup();
    // Fail the first data chunk (offset 0); the reset and marker writes succeed.
    transport.injectFailure({mode: 'send-error', times: 1, match: (r) => r[0] === Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER && r[1] === 0 && r[2] === 0});
    const record = await store.setMacros(['abc']).done;
    expect(record).toMatchObject({state: 'failed', verified: true});
    // The buffer was cleared before the failure, and the store shows that truth.
    expect(store.$macros.get()?.expressions[0]).toBe('');
  });

  it('writes layout options', async () => {
    const {store, keyboard} = await setup();
    expect((await store.setLayoutChoices([1]).done).state).toBe('saved');
    expect(keyboard.layoutOptions).toBe(1);
    expect(store.$layoutChoices.get()).toEqual([1]);
  });

  it('fails pending writes when the keyboard is unplugged', async () => {
    const {store, transport} = await setup({latency: 20});
    const handle = store.setKeycode(0, 0, 1, 0x0004);
    const queued = store.setKeycode(0, 0, 2, 0x0005);
    transport.unplug();
    expect((await handle.done).state).toBe('failed');
    expect((await queued.done).state).toBe('failed');
    expect(store.$connection.get()).toMatchObject({status: 'error', message: expect.stringMatching(/disconnected/i)});
    expect(store.$keymap.get()).toBeNull();
    expect(() => store.setKeycode(0, 0, 1, 4)).toThrow(/not connected/);
  });

  it('disconnects cleanly after flushing pending saves', async () => {
    const {store, keyboard} = await setup({}, {menuSaveDelayMs: 10_000});
    const handle = store.setMenuValue('id_qmk_rgblight_effect_speed', {type: 'range', value: 4});
    await store.disconnect();
    expect((await handle.done).state).toBe('saved');
    expect(keyboard.getSavedCustomValue(2, 3, 1)).toEqual([4]);
    expect(store.$connection.get()).toEqual({status: 'disconnected'});
  });
});
