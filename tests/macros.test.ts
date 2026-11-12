import {describe, expect, it} from 'vitest';
import {
  KeycodeTable,
  decodeMacroBuffer,
  encodeMacros,
  expressionToRawSequence,
  rawSequenceToExpression,
  validateMacroExpression,
  type MacroAction,
} from '../src/core/index.ts';
import {connectApi} from './helpers.ts';

const keys = new KeycodeTable({protocol: 12}).macroKeys();

describe('macro codec (protocol 11+ format)', () => {
  it('encodes taps, key down/up, delays and text byte for byte', () => {
    const sequence: MacroAction[] = [
      {type: 'text', text: 'Hi'},
      {type: 'tap', key: 'KC_ENT'},
      {type: 'delay', ms: 250},
      {type: 'down', key: 'KC_LCTL'},
      {type: 'tap', key: 'KC_C'},
      {type: 'up', key: 'KC_LCTL'},
    ];
    expect(encodeMacros([sequence], keys)).toEqual([
      0x48, 0x69, // "Hi"
      0x01, 0x01, 0x28, // tap Enter
      0x01, 0x04, 0x32, 0x35, 0x30, 0x7c, // delay "250|"
      0x01, 0x02, 0xe0, // down LCtrl
      0x01, 0x01, 0x06, // tap C
      0x01, 0x03, 0xe0, // up LCtrl
      0x00,
    ]);
  });

  it('decodes what it encodes, for every slot', () => {
    const sequences: MacroAction[][] = [
      [{type: 'text', text: 'hello world'}],
      [],
      [
        {type: 'down', key: 'KC_LSFT'},
        {type: 'tap', key: 'KC_A'},
        {type: 'up', key: 'KC_LSFT'},
        {type: 'delay', ms: 9999},
      ],
    ];
    const bytes = encodeMacros(sequences, keys);
    const decoded = decodeMacroBuffer([...bytes, ...new Array(50).fill(0)], 16, keys);
    expect(decoded).toHaveLength(16);
    expect(decoded.slice(0, 3)).toEqual(sequences);
    expect(decoded.slice(3).every((sequence) => sequence.length === 0)).toBe(true);
  });

  it('reads an all-zero buffer (the Linky87 today) as 16 empty macros', () => {
    const decoded = decodeMacroBuffer(new Array(338).fill(0), 16, keys);
    expect(decoded).toEqual(new Array(16).fill([]));
  });

  it.each([
    'Hello{KC_ENT}',
    '{KC_LCTL,KC_C}{100}{KC_LCTL,KC_V}',
    '{+KC_LSFT}abc{-KC_LSFT}',
    'literal \\{braces}',
    '{KC_LGUI,KC_LSFT,KC_S}',
  ])('round-trips the expression %s', (expression) => {
    const raw = expressionToRawSequence(expression);
    expect(rawSequenceToExpression(raw)).toBe(expression);
    const bytes = encodeMacros([raw], keys);
    expect(decodeMacroBuffer(bytes, 1, keys)).toEqual([raw]);
  });

  it('expands chords into nested downs and reversed ups', () => {
    expect(expressionToRawSequence('{KC_LCTL,KC_LALT,KC_DEL}')).toEqual([
      {type: 'down', key: 'KC_LCTL'},
      {type: 'down', key: 'KC_LALT'},
      {type: 'down', key: 'KC_DEL'},
      {type: 'up', key: 'KC_DEL'},
      {type: 'up', key: 'KC_LALT'},
      {type: 'up', key: 'KC_LCTL'},
    ]);
  });

  it('validates expressions like VIA does', () => {
    expect(validateMacroExpression('ok{KC_A}{500}', keys).isValid).toBe(true);
    expect(validateMacroExpression('{KC_A', keys)).toMatchObject({isValid: false});
    expect(validateMacroExpression('{}', keys)).toMatchObject({isValid: false});
    expect(validateMacroExpression('{10000}', keys)).toMatchObject({isValid: false});
    expect(validateMacroExpression('{KC_NOPE}', keys).errorMessage).toMatch(/KC_NOPE/);
    expect(validateMacroExpression('{MO(1)}', keys)).toMatchObject({isValid: false});
    expect(validateMacroExpression('café', keys)).toMatchObject({isValid: false});
  });

  it('refuses keys that do not fit in one byte and non-ASCII text', () => {
    expect(() => encodeMacros([[{type: 'tap', key: 'MO(1)'}]], keys)).toThrow(/cannot be used/);
    expect(() => encodeMacros([[{type: 'text', text: 'é'}]], keys)).toThrow(/ASCII/);
    expect(() => encodeMacros([[{type: 'delay', ms: 10000}]], keys)).toThrow(/delay/);
  });

  it('writes and reads macros through the protocol', async () => {
    const {api} = await connectApi();
    const sequences = ['Hi{KC_ENT}', '', '{KC_LCTL,KC_C}'].map(expressionToRawSequence);
    await api.writeMacroBuffer(encodeMacros(sequences, keys));
    const decoded = decodeMacroBuffer(await api.readMacroBuffer(), 16, keys);
    expect(decoded.slice(0, 3).map(rawSequenceToExpression)).toEqual(['Hi{KC_ENT}', '', '{KC_LCTL,KC_C}']);
  });
});
