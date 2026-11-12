import {describe, expect, it, vi} from 'vitest';
import {
  BrowserDb,
  DefinitionRegistry,
  ValidationError,
  decodeControlValue,
  decodeLayoutOptions,
  encodeControlValue,
  encodeLayoutOptions,
  evaluateShowIf,
  findBundledDefinition,
  findControl,
  getMenuZones,
  getReadableControls,
  lookupPublicDefinition,
  parseDefinition,
  visibleControls,
  visibleKeys,
} from '../src/core/index.ts';
import {loadReader} from '../src/core/definitions/parse.ts';
import {LINKY87_VPID, linky87Definition} from './helpers.ts';
import {LINKY87_LIGHTING_SEED} from '../src/core/mock/linky87.ts';

const lightingValues = {
  id_qmk_rgblight_brightness: [160],
  id_qmk_rgblight_effect: [2],
  id_qmk_rgb_matrix_effect: [31],
  id_qmk_audio_effect: [2],
};

describe('Linky87 V3 definition', () => {
  it('parses name, ids, matrix and key geometry', async () => {
    const definition = await linky87Definition();
    expect(definition).toMatchObject({
      format: 'v3',
      source: 'bundled',
      name: 'Linky87',
      vendorId: 0x36b0,
      productId: 0x3005,
      vendorProductId: LINKY87_VPID,
      matrix: {rows: 6, cols: 16},
      keycodeModules: ['qmk_lighting'],
    });
    expect(definition.layout.width).toBe(18.25);
    expect(definition.layout.height).toBe(6.25);
    expect(definition.layout.keys).toHaveLength(85);
    expect(definition.customKeycodes).toHaveLength(35);
  });

  it('exposes the ISO Enter layout option with its alternative keys', async () => {
    const {layout} = await linky87Definition();
    expect(layout.options).toEqual([{index: 0, label: 'ISO Enter', choices: ['Off', 'On']}]);
    const ansi = visibleKeys(layout, [0]);
    const iso = visibleKeys(layout, [1]);
    expect(ansi).toHaveLength(87);
    expect(iso).toHaveLength(87);
    const isoEnter = iso.find((key) => key.row === 3 && key.col === 13);
    expect(isoEnter).toMatchObject({w: 1.25, h: 2, w2: 1.5, h2: 1});
    expect(ansi.some((key) => key.row === 2 && key.col === 13)).toBe(true);
    expect(iso.some((key) => key.row === 3 && key.col === 12)).toBe(true);
  });

  it('packs and unpacks layout options like VIA', async () => {
    const {layout} = await linky87Definition();
    expect(decodeLayoutOptions(layout, 0)).toEqual([0]);
    expect(decodeLayoutOptions(layout, 1)).toEqual([1]);
    expect(encodeLayoutOptions(layout, [1])).toBe(1);
  });

  it('turns the three lighting submenus into zones on channels 2, 3 and 4', async () => {
    const zones = getMenuZones(await linky87Definition());
    expect(zones.map((zone) => [zone.label, zone.channels])).toEqual([
      ['logo', [2]],
      ['Backlight', [3]],
      ['side', [4]],
    ]);
    expect(zones[2]?.controls.map((control) => control.commandId)).toEqual([
      'id_qmk_audio_brightness',
      'id_qmk_audio_effect',
      'id_qmk_audio_effect_speed',
      'id_qmk_audio_color',
    ]);
  });

  it('reads byte lengths from control types', async () => {
    const definition = await linky87Definition();
    const controls = getReadableControls(definition);
    expect(controls).toHaveLength(12);
    expect(findControl(definition, 'id_qmk_rgb_matrix_effect_speed')).toMatchObject({type: 'range', range: [0, 255], byteLength: 1});
    expect(findControl(definition, 'id_qmk_rgblight_color')).toMatchObject({type: 'color', byteLength: 2, channel: 2, valueId: 4});
    expect(findControl(definition, 'id_qmk_rgb_matrix_effect')?.choices).toHaveLength(46);
  });

  it('evaluates showIf against current values', async () => {
    const definition = await linky87Definition();
    const visible = visibleControls(definition, lightingValues).map((control) => control.commandId);
    // Logo effect 2 shows color; matrix effect 31 shows color; side effect 2 shows color.
    expect(visible).toContain('id_qmk_rgblight_color');
    expect(visible).toContain('id_qmk_rgb_matrix_color');
    const off = visibleControls(definition, {...lightingValues, id_qmk_rgblight_effect: [0]}).map((control) => control.commandId);
    expect(off).not.toContain('id_qmk_rgblight_brightness');
    expect(off).not.toContain('id_qmk_rgblight_color');
    expect(off).toContain('id_qmk_rgblight_effect');
    const wave = visibleControls(definition, {...lightingValues, id_qmk_rgblight_effect: [1]}).map((control) => control.commandId);
    expect(wave).toContain('id_qmk_rgblight_brightness');
    expect(wave).not.toContain('id_qmk_rgblight_color');
  });

  it('decodes and encodes control values, keeping out-of-range reads as read', async () => {
    const definition = await linky87Definition();
    const brightness = findControl(definition, 'id_qmk_rgb_matrix_brightness')!;
    // The keyboard reports 255 although the range is 0-160.
    expect(decodeControlValue(brightness, LINKY87_LIGHTING_SEED['3:1']!)).toEqual({type: 'range', value: 255});
    expect(encodeControlValue(brightness, {type: 'range', value: 80})).toEqual([80]);
    expect(() => encodeControlValue(brightness, {type: 'range', value: 255})).toThrow(ValidationError);
    const effect = findControl(definition, 'id_qmk_rgb_matrix_effect')!;
    expect(decodeControlValue(effect, [31])).toEqual({type: 'dropdown', value: 31, label: 'solid_reactive'});
    expect(() => encodeControlValue(effect, {type: 'dropdown', value: 99})).toThrow(ValidationError);
    const color = findControl(definition, 'id_qmk_rgblight_color')!;
    expect(decodeControlValue(color, [17, 255])).toEqual({type: 'color', hue: 17, sat: 255});
    expect(encodeControlValue(color, {type: 'color', hue: 200, sat: 10})).toEqual([200, 10]);
  });

  it('parses the compiled V3 form that usevia.app serves', async () => {
    const reader = await loadReader();
    const compiled = reader.keyboardDefinitionV3ToVIADefinitionV3(findBundledDefinition(LINKY87_VPID)!.json as never);
    const definition = await parseDefinition(JSON.parse(JSON.stringify(compiled)), 'public');
    expect(definition).toMatchObject({format: 'v3', name: 'Linky87', vendorProductId: LINKY87_VPID});
    expect(definition.layout.keys).toHaveLength(85);
    expect(getMenuZones(definition)).toHaveLength(3);
  });

  it('parses a minimal V2 definition', async () => {
    const definition = await parseDefinition({
      name: 'Tiny V2',
      vendorId: '0x1234',
      productId: '0x0001',
      lighting: 'none',
      matrix: {rows: 1, cols: 2},
      layouts: {keymap: [['0,0', '0,1']]},
    });
    expect(definition).toMatchObject({format: 'v2', name: 'Tiny V2', matrix: {rows: 1, cols: 2}, hasV2Lighting: true});
    expect(definition.layout.keys).toHaveLength(2);
  });

  it('rejects JSON that is not a definition, with reasons', async () => {
    await expect(parseDefinition({hello: 'world'})).rejects.toBeInstanceOf(ValidationError);
    await expect(parseDefinition({name: 'x', vendorId: '0x1', productId: '0x2', matrix: {rows: 1, cols: 1}, layouts: {keymap: 'nope'}})).rejects.toThrow(
      /not a valid VIA/,
    );
    await expect(parseDefinition([])).rejects.toThrow(/JSON object/);
  });
});

describe('showIf evaluator', () => {
  it.each([
    ['{a} == 1', true],
    ['{a} != 1', false],
    ['{a} < 2 && {b.1} >= 5', true],
    ['!({a} == 1) || {b} == 0x04', true],
    ['({a} == 2 || {a} == 1) && !{c}', true],
  ])('%s -> %s', (expression, expected) => {
    expect(evaluateShowIf(expression, {a: [1], b: [4, 5], c: [0]})).toBe(expected);
  });

  it('treats unknown values as visible by default', () => {
    expect(evaluateShowIf('{missing} == 1', {})).toBe(true);
    expect(evaluateShowIf('{missing} == 1', {}, false)).toBe(false);
  });

  it('rejects malformed expressions', () => {
    expect(() => evaluateShowIf('{a} == ', {a: [1]})).toThrow(ValidationError);
    expect(() => evaluateShowIf('{a} = 1', {a: [1]})).toThrow(ValidationError);
  });
});

describe('definition lookup', () => {
  const compiledJson = async () => {
    const reader = await loadReader();
    return JSON.stringify(reader.keyboardDefinitionV3ToVIADefinitionV3(findBundledDefinition(LINKY87_VPID)!.json as never));
  };

  it('fetches a public definition listed in supported_kbs.json', async () => {
    const body = await compiledJson();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/supported_kbs.json')) {
        return new Response(JSON.stringify({generatedAt: 1, vendorProductIds: {v2: [], v3: [LINKY87_VPID]}}));
      }
      return new Response(body);
    });
    const definition = await lookupPublicDefinition(LINKY87_VPID, {baseUrl: 'https://example.test/a', fetch: fetchMock as typeof fetch});
    expect(definition?.name).toBe('Linky87');
    expect(fetchMock).toHaveBeenCalledWith(`https://example.test/a/v3/${LINKY87_VPID}.json`, {});
  });

  it('returns null for keyboards that are not listed, without fetching a definition', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({generatedAt: 1, vendorProductIds: {v2: [1], v3: [2]}})));
    expect(await lookupPublicDefinition(LINKY87_VPID, {baseUrl: 'https://example.test/b', fetch: fetchMock as typeof fetch})).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the HTML fallback page as an error instead of parsing it', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/supported_kbs.json')
        ? new Response(JSON.stringify({generatedAt: 1, vendorProductIds: {v3: [LINKY87_VPID]}}))
        : new Response('<!doctype html><html></html>', {headers: {'content-type': 'text/html'}}),
    );
    await expect(lookupPublicDefinition(LINKY87_VPID, {baseUrl: 'https://example.test/c', fetch: fetchMock as typeof fetch})).rejects.toThrow(
      /not JSON/,
    );
  });

  it('resolves sideloaded, then bundled, then nothing', async () => {
    const db = new BrowserDb(indexedDB, `test-registry-${Math.random()}`);
    const registry = new DefinitionRegistry({db});
    expect((await registry.resolve(LINKY87_VPID))?.source).toBe('bundled');
    expect(await registry.resolve(0x12340001)).toBeNull();

    const custom = {...(findBundledDefinition(LINKY87_VPID)!.json as Record<string, unknown>), name: 'Linky87 (edited)'};
    await registry.sideload(custom);
    const resolved = await registry.resolve(LINKY87_VPID);
    expect(resolved).toMatchObject({source: 'sideloaded', name: 'Linky87 (edited)'});
    expect(await registry.listSideloaded()).toEqual([expect.objectContaining({vendorProductId: LINKY87_VPID, name: 'Linky87 (edited)'})]);
    await registry.removeSideloaded(LINKY87_VPID);
    expect((await registry.resolve(LINKY87_VPID))?.source).toBe('bundled');
  });
});
