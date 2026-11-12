import {describe, expect, it} from 'vitest';
import {buildBoardMeta, guessZonePart, keyNoteFor, keycodeDanger, parseDefinition, resolveBoardMeta} from '../src/core/index.ts';
import {LINKY87_VPID, keymapFixture, linky87Definition} from './helpers.ts';

describe('board meta', () => {
  it('names the Linky87 layers and pairs them', async () => {
    const meta = resolveBoardMeta(await linky87Definition(), 4);
    expect(meta.generic).toBe(false);
    expect(meta.layers.map((layer) => layer.name)).toEqual(['Windows', 'Mac', 'Windows Fn', 'Mac Fn']);
    expect(meta.layers.map((layer) => layer.pair)).toEqual([1, 0, 3, 2]);
    expect(meta.layers[2]).toMatchObject({fn: true, base: 0, os: 'windows'});
    expect(meta.layers[3]).toMatchObject({fn: true, base: 1, os: 'mac'});
  });

  it('maps the three Linky87 lighting zones to parts of the board', async () => {
    const meta = resolveBoardMeta(await linky87Definition(), 4);
    expect(meta.zones.map((zone) => [zone.zone.label, zone.name, zone.part])).toEqual([
      ['logo', 'Logo', 'logo'],
      ['Backlight', 'Backlight', 'backlight'],
      ['side', 'Side lights', 'side'],
    ]);
  });

  it('notes the layer-0 Fn key without changing it', async () => {
    const meta = resolveBoardMeta(await linky87Definition(), 4);
    expect(keymapFixture[0]?.[5]?.[10]).toBe(0x5220);
    expect(keyNoteFor(meta, 0, 5, 10)?.legend).toBe('Fn');
    expect(keyNoteFor(meta, 1, 5, 10)).toBeUndefined();
  });

  it('falls back to generic layer names and guesses zones for other boards', async () => {
    const definition = await linky87Definition();
    const meta = buildBoardMeta(definition, 3, undefined);
    expect(meta.generic).toBe(true);
    expect(meta.layers.map((layer) => layer.name)).toEqual(['Layer 0', 'Layer 1', 'Layer 2']);
    expect(meta.layers.every((layer) => layer.pair === undefined && !layer.fn)).toBe(true);
    expect(meta.zones.map((zone) => zone.part)).toEqual(['logo', 'backlight', 'side']);
  });

  it('gives extra layers generic names and drops pairs that point past the last layer', async () => {
    const definition = await linky87Definition();
    const meta = buildBoardMeta(definition, 2, {
      layers: [
        {name: 'Base', short: 'Base', os: 'any', fn: false, pair: 5},
        {name: 'Fn', short: 'Fn', os: 'any', fn: true, base: 0},
      ],
    });
    expect(meta.layers[0]?.pair).toBeUndefined();
    expect(meta.layers[1]?.base).toBe(0);
    const wider = buildBoardMeta(definition, 3, {layers: [{name: 'Base', short: 'Base', os: 'any', fn: false}]});
    expect(wider.layers.map((layer) => layer.name)).toEqual(['Base', 'Layer 1', 'Layer 2']);
  });

  it('guesses zone parts from labels', () => {
    expect(guessZonePart('Logo light')).toBe('logo');
    expect(guessZonePart('Underglow')).toBe('side');
    expect(guessZonePart('RGB Matrix')).toBe('backlight');
  });

  it('keeps a sideloaded copy of a bundled board on the bundled meta', async () => {
    const definition = await parseDefinition((await import('../src/core/definitions/bundled/linky87.json')).default, 'sideloaded');
    expect(definition.vendorProductId).toBe(LINKY87_VPID);
    expect(resolveBoardMeta(definition, 4).generic).toBe(false);
  });
});

describe('dangerous keycodes', () => {
  it('marks clear-EEPROM as a factory reset', () => {
    expect(keycodeDanger(0x7c03)).toMatchObject({kind: 'factory-reset', name: 'Factory reset'});
    expect(keycodeDanger(0x7c00)?.kind).toBe('bootloader');
    expect(keycodeDanger(0x7c01)?.kind).toBe('reboot');
    expect(keycodeDanger(0x29)).toBeNull();
  });

  it('finds Fn + End as a factory reset on both Fn layers of the real keymap', () => {
    // Row 2, column 15 is End on the Linky87.
    expect(keycodeDanger(keymapFixture[2]?.[2]?.[15] ?? 0)?.kind).toBe('factory-reset');
    expect(keycodeDanger(keymapFixture[3]?.[2]?.[15] ?? 0)?.kind).toBe('factory-reset');
    expect(keycodeDanger(keymapFixture[0]?.[2]?.[15] ?? 0)).toBeNull();
  });
});
