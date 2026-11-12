import {describe, expect, it} from 'vitest';
import {KeycodeTable} from '../src/core/index.ts';
import v12KeyToByte from '../src/core/keycodes/v12.ts';
import {keymapFixture, linky87Definition} from './helpers.ts';

const linky87Table = async () => {
  const definition = await linky87Definition();
  return new KeycodeTable({
    protocol: 12,
    customKeycodes: definition.customKeycodes,
    macroCount: 16,
    keycodeModules: definition.keycodeModules,
    commonMenuIds: definition.commonMenuIds,
  });
};

describe('protocol 12 keycode table', () => {
  it('round-trips every named keycode: value -> code -> value', async () => {
    const table = await linky87Table();
    for (const [name, value] of Object.entries(v12KeyToByte)) {
      if (name.startsWith('_')) {
        continue;
      }
      const code = table.codeOf(value);
      expect(table.valueOf(code), `${name} -> ${code}`).toBe(value);
    }
  });

  it.each([
    ['LCTL(KC_C)', 0x0106],
    ['S(KC_1)', 0x021e],
    ['RALT(KC_E)', 0x1408],
    ['HYPR(KC_A)', 0x0f04],
    ['LCTL(LSFT(KC_A))', 0x0304],
    ['MO(0)', 0x5220],
    ['MO(3)', 0x5223],
    ['TG(1)', 0x5261],
    ['TO(2)', 0x5202],
    ['TT(1)', 0x52c1],
    ['OSL(2)', 0x5282],
    ['DF(1)', 0x5241],
    ['LT(1,KC_SPC)', 0x412c],
    ['MT(MOD_LCTL,KC_A)', 0x2104],
    ['MT(MOD_LCTL | MOD_LSFT,KC_ESC)', 0x2329],
    ['LM(1,MOD_LALT)', 0x5024],
    ['OSM(MOD_LSFT)', 0x52a2],
    ['MACRO(0)', 0x7700],
    ['MACRO(15)', 0x770f],
    ['CUSTOM(34)', 0x7e22],
  ])('parses %s as 0x%s and prints it back', async (code, value) => {
    const table = await linky87Table();
    expect(table.valueOf(code)).toBe(value);
    expect(table.valueOf(table.codeOf(value))).toBe(value);
  });

  it('rejects malformed codes instead of returning KC_NO', async () => {
    const table = await linky87Table();
    for (const bad of ['KC_NOPE', 'MO(x)', 'LT(1,KC_FAKE)', 'MT(MOD_XYZ,KC_A)', 'LCTL()', 'MACRO(999)']) {
      expect(table.valueOf(bad), bad).toBeNull();
    }
    expect(table.valueOf('KC_NO')).toBe(0);
  });

  it('accepts deprecated names from old VIA layout files', async () => {
    const table = await linky87Table();
    expect(table.valueOf('KC_EXLM')).toBe(0x021e);
    expect(table.valueOf('MACRO00')).toBe(0x7700);
    expect(table.valueOf('SPC_FN1')).toBe(0x412c);
  });

  it('names every keycode in the real Linky87 keymap', async () => {
    const table = await linky87Table();
    const unknown = keymapFixture.flat(2).filter((value) => /^0x/.test(table.codeOf(value)));
    expect(unknown).toEqual([]);
  });

  it('describes layer, macro and custom keycodes from the fixture', async () => {
    const table = await linky87Table();
    expect(table.describe(0x5220)).toMatchObject({code: 'MO(0)', kind: 'layer', layer: 0, category: 'layers'});
    expect(table.describe(0x5223)).toMatchObject({code: 'MO(3)', layer: 3});
    expect(table.describe(0x7e00)).toMatchObject({code: 'CUSTOM(0)', kind: 'custom', label: 'MD_24G', title: 'Set to 2.4G working mode', index: 0});
    expect(table.describe(0x7e22)).toMatchObject({kind: 'custom', label: 'SI_SPD', index: 34});
    expect(table.describe(0x7703)).toMatchObject({code: 'MACRO(3)', kind: 'macro', label: 'M3', category: 'macro'});
    expect(table.describe(0x0029)).toMatchObject({code: 'KC_ESC', kind: 'basic', label: 'Esc', category: 'basic'});
    expect(table.describe(0x7821)).toMatchObject({code: 'RGB_MOD', category: 'qmk_lighting'});
    expect(table.describe(0x7c03)).toMatchObject({code: 'QK_CLEAR_EEPROM', category: 'other'});
    // Like VIA, the last alias for a modifier wins: C(), S(), A(), G().
    expect(table.describe(0x0106)).toMatchObject({code: 'C(KC_C)', kind: 'modified'});
  });

  it('accepts custom keycode short names from the definition', async () => {
    const table = await linky87Table();
    expect(table.valueOf('MD_BLE1')).toBe(0x7e01);
    expect(table.valueOf('SI_SPD')).toBe(0x7e22);
  });

  it('builds picker categories with the definition custom keycodes and legacy RGB keys', async () => {
    const table = await linky87Table();
    const categories = table.categories();
    const ids = categories.map((category) => category.id);
    expect(ids).toEqual(['basic', 'media', 'macro', 'layers', 'special', 'qmk_lighting', 'custom', 'other']);
    const custom = categories.find((category) => category.id === 'custom');
    expect(custom?.keycodes).toHaveLength(35);
    expect(custom?.keycodes[0]).toMatchObject({code: 'CUSTOM(0)', value: 0x7e00, name: '2.4G'});
    const lighting = categories.find((category) => category.id === 'qmk_lighting');
    expect(lighting?.keycodes.map((keycode) => keycode.code)).toContain('RGB_TOG');
    expect(categories.find((category) => category.id === 'macro')?.keycodes).toHaveLength(16);
    // Every listed keycode encodes to a value the table prints back to the same value.
    for (const category of categories) {
      for (const keycode of category.keycodes) {
        expect(table.valueOf(table.codeOf(keycode.value))).toBe(keycode.value);
      }
    }
  });

  it('refuses protocols it has no table for', () => {
    expect(() => new KeycodeTable({protocol: 13})).toThrow(/protocol 13/);
  });
});
