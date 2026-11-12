import {describe, expect, it} from 'vitest';
import {
  Command,
  CommandTimeoutError,
  ForbiddenCommandError,
  ReadOnlyError,
  UnhandledCommandError,
  keymapToGrid,
  matchCommand,
  planKeymapSegments,
} from '../src/core/index.ts';
import {connectApi, keymapFixture} from './helpers.ts';

describe('VIA protocol against the Linky87 mock', () => {
  it('reads the protocol metadata the real keyboard reports', async () => {
    const {api} = await connectApi();
    expect(await api.getProtocolVersion()).toBe(12);
    expect(await api.getLayerCount()).toBe(4);
    expect(await api.getMacroCount()).toBe(16);
    expect(await api.getMacroBufferSize()).toBe(338);
    expect(await api.getLayoutOptions()).toBe(0);
    expect(await api.getFirmwareVersion()).toBe(0);
  });

  it('bulk-reads a keymap equal to the fixture dumped from the keyboard', async () => {
    const {api, channel} = await connectApi();
    const keymap = await api.readKeymap({rows: 6, cols: 16}, 4);
    expect(keymapToGrid(keymap, 16)).toEqual(keymapFixture);
    // 4 layers x 96 keys x 2 bytes = 768 bytes = 28 reports of up to 28 bytes, plus one protocol read.
    expect(channel.statistics.requests).toBe(29);
  });

  it('keeps the vendor quirk: layer 0 Fn holds MO(0) (0x5220)', async () => {
    const {api} = await connectApi();
    expect(await api.getKeycode(0, 5, 10)).toBe(0x5220);
  });

  it('round-trips a single keycode write', async () => {
    const {api, keyboard} = await connectApi();
    await api.setKeycode(1, 2, 3, 0x0004);
    expect(await api.getKeycode(1, 2, 3)).toBe(0x0004);
    expect(keyboard.getKeycode(1, 2, 3)).toBe(0x0004);
  });

  it('writes planned keymap segments with one report per 14 keys', async () => {
    const {api, channel, keyboard} = await connectApi();
    const current = await api.readKeymap({rows: 6, cols: 16}, 4);
    const target = current.map((layer) => [...layer]);
    target[0]![0] = 0x0029; // unchanged (Esc)
    target[0]![1] = 0x0004;
    target[0]![10] = 0x0005; // same report as index 1
    target[3]![95] = 0x0006;
    const segments = planKeymapSegments(current, target);
    expect(segments).toHaveLength(2);
    const before = channel.statistics.requests;
    await api.writeKeymapSegments(segments);
    expect(channel.statistics.requests - before).toBe(2);
    expect(keyboard.getKeycode(0, 0, 1)).toBe(0x0004);
    expect(keyboard.getKeycode(0, 0, 10)).toBe(0x0005);
    expect(keyboard.getKeycode(3, 5, 15)).toBe(0x0006);
    expect(await api.readKeymap({rows: 6, cols: 16}, 4)).toEqual(target);
  });

  it('reads, sets and saves custom menu values per channel', async () => {
    const {api, keyboard} = await connectApi();
    expect(await api.getCustomMenuValue(2, 1, 1)).toEqual([160]);
    expect(await api.getCustomMenuValue(3, 1, 1)).toEqual([255]);
    expect(await api.getCustomMenuValue(4, 4, 2)).toEqual([0, 255]);

    await api.setCustomMenuValue(3, 2, [5]);
    expect(await api.getCustomMenuValue(3, 2, 1)).toEqual([5]);
    keyboard.powerCycle();
    expect(await api.getCustomMenuValue(3, 2, 1)).toEqual([31]);

    await api.setCustomMenuValue(3, 2, [5]);
    await api.saveCustomMenu(3);
    keyboard.powerCycle();
    expect(await api.getCustomMenuValue(3, 2, 1)).toEqual([5]);
  });

  it('round-trips the macro buffer with VIA write markers', async () => {
    const {api, keyboard} = await connectApi();
    const data = [0x48, 0x69, 0x00, 0x01, 0x01, 0x04, 0x00];
    await api.writeMacroBuffer(data);
    const read = await api.readMacroBuffer();
    expect(read).toHaveLength(338);
    expect(read.slice(0, data.length)).toEqual(data);
    expect(read[337]).toBe(0);
    // reset (0x10), marker on, one data chunk, marker off
    const macroWrites = keyboard.log.filter((r) => r[0] === Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER || r[0] === Command.DYNAMIC_KEYMAP_MACRO_RESET);
    expect(macroWrites.map((r) => r[0])).toEqual([0x10, 0x0f, 0x0f, 0x0f]);
  });

  it('refuses macro data larger than the buffer', async () => {
    const {api} = await connectApi();
    await expect(api.writeMacroBuffer(new Array(339).fill(1))).rejects.toThrow(/338/);
  });

  it('never sends keymap reset, EEPROM reset or bootloader jump', async () => {
    const {channel, keyboard} = await connectApi();
    for (const command of [Command.DYNAMIC_KEYMAP_RESET, Command.EEPROM_RESET, Command.BOOTLOADER_JUMP]) {
      await expect(channel.request([command])).rejects.toBeInstanceOf(ForbiddenCommandError);
    }
    expect(keyboard.log).toHaveLength(0);
  });

  it('refuses writes in read-only mode before they reach the device', async () => {
    const {api, keyboard} = await connectApi({readOnly: true});
    expect(await api.getProtocolVersion()).toBe(12);
    await expect(api.setKeycode(0, 0, 0, 4)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(api.setCustomMenuValue(2, 1, [10])).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(api.saveCustomMenu(2)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(api.writeMacroBuffer([1])).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(api.writeKeymapSegments([{byteOffset: 0, keycodes: [4]}])).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(api.setLayoutOptions(1)).rejects.toBeInstanceOf(ReadOnlyError);
    const writes = [0x03, 0x05, 0x07, 0x09, 0x0f, 0x10, 0x13, 0x15];
    expect(keyboard.log.filter((r) => writes.includes(r[0] ?? 0))).toEqual([]);
  });

  it('reports id_unhandled replies as UnhandledCommandError', async () => {
    const {api} = await connectApi();
    // The Linky87 does not answer KEYCODES_VERSION (0x02 0x06), and has no channel 1.
    await expect(api.getKeyboardValue(0x06, [], 4)).rejects.toBeInstanceOf(UnhandledCommandError);
    await expect(api.getCustomMenuValue(1, 1, 1)).rejects.toBeInstanceOf(UnhandledCommandError);
  });

  it('times out when the keyboard does not reply, then recovers', async () => {
    const {api, transport} = await connectApi({timeoutMs: 30});
    transport.injectFailure({mode: 'timeout', times: 1});
    await expect(api.getLayerCount()).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(await api.getLayerCount()).toBe(4);
  });

  it('ignores corrupt or late replies instead of pairing them with the next request', async () => {
    const {api, transport, channel} = await connectApi({timeoutMs: 30});
    transport.injectFailure({mode: 'corrupt', times: 1, match: matchCommand(Command.DYNAMIC_KEYMAP_GET_LAYER_COUNT)});
    await expect(api.getLayerCount()).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(channel.statistics.strayReports).toBe(1);
    expect(await api.getMacroCount()).toBe(16);
  });

  it('serialises concurrent requests and keeps their replies in order', async () => {
    const {api} = await connectApi({latency: {minMs: 0, maxMs: 3}});
    const results = await Promise.all([api.getLayerCount(), api.getMacroCount(), api.getKeycode(0, 0, 0), api.getMacroBufferSize()]);
    expect(results).toEqual([4, 16, 0x29, 338]);
  });
});
