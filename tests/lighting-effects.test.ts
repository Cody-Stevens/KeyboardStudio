import {beforeAll, describe, expect, it} from 'vitest';
import {getMenuZones, type KeyboardDefinition} from '../src/core/index.ts';
import {EFFECT_GROUPS, effectInfo, effectSentence, groupEffects} from '../src/app/logic/effect-info.ts';
import {abs8, atan2_8, cos8, hsvToRgb8, scale16by8, scale8, sin8, sqrt16} from '../src/app/logic/qmk-math.ts';
import {
  hitsStillShowing,
  ledPoints,
  reactiveFadeMs,
  reactiveFlashHue,
  rgbMatrixColor,
  type KeyHit,
  type LedPoint,
  type MatrixConfig,
} from '../src/app/logic/rgb-matrix.ts';
import {linky87Definition} from './helpers.ts';

let definition: KeyboardDefinition;
beforeAll(async () => {
  definition = await linky87Definition();
});

const backlightChoices = () => {
  const zone = getMenuZones(definition)[1];
  const effect = zone?.controls.find((control) => control.commandId === 'id_qmk_rgb_matrix_effect');
  return (effect?.choices ?? []).map((choice) => ({label: choice.label, value: choice.value[0] ?? 0}));
};

describe('QMK lib8tion port', () => {
  it('scales with the fixed rounding QMK builds with', () => {
    expect(scale8(255, 255)).toBe(255);
    expect(scale8(255, 64)).toBe(64);
    expect(scale8(128, 128)).toBe(64);
    // scale16by8 takes a uint16_t, so the 32-bit timer wraps every 65.536 s.
    expect(scale16by8(70_000, 255)).toBe(70_000 - 65_536);
  });

  it('matches lib8tion sine, atan2 and square root', () => {
    expect([0, 64, 128, 192].map(sin8)).toEqual([128, 255, 128, 1]);
    expect(cos8(0)).toBe(255);
    expect(atan2_8(1, 0)).toBe(64);
    expect(atan2_8(0, -1)).toBe(128);
    expect(atan2_8(-1, 0)).toBe(192);
    expect(atan2_8(10, 10)).toBe(32);
    expect(sqrt16(224 * 224 + 64 * 64)).toBe(232);
    expect(abs8(-128)).toBe(-128);
  });

  it('converts HSV the way quantum/color.c does', () => {
    expect(hsvToRgb8(0, 255, 255)).toEqual([255, 0, 0]);
    expect(hsvToRgb8(85, 255, 255)).toEqual([0, 255, 0]);
    expect(hsvToRgb8(170, 255, 255)).toEqual([0, 0, 255]);
    expect(hsvToRgb8(123, 0, 90)).toEqual([90, 90, 90]);
  });
});

describe('solid reactive flash colour', () => {
  it('shifts the hue 64 of 255 steps, a quarter turn, and wraps', () => {
    expect(reactiveFlashHue(0)).toBe(64);
    expect(reactiveFlashHue(200)).toBe(8);
    expect(reactiveFlashHue(192)).toBe(0);
  });

  it('fades back over a time set by the speed', () => {
    expect(reactiveFadeMs(255)).toBe(255);
    expect(reactiveFadeMs(54)).toBe(1166);
    expect(reactiveFadeMs(0)).toBe(32_640);
  });
});

describe('reactive effects', () => {
  const config: MatrixConfig = {hue: 0, sat: 255, val: 255, speed: 128};
  const centre: LedPoint = {x: 112, y: 32, index: 40, isMod: false};
  const hitAt = (led: LedPoint, tick: number): KeyHit => ({x: led.x, y: led.y, index: led.index, tick});
  const frame = (hits: KeyHit[]) => ({timer: 0, hits});

  it('solid reactive keeps every key lit and flashes the pressed key', () => {
    expect(rgbMatrixColor('solid_reactive', config, centre, frame([]))).toEqual([255, 0, 0]);
    const pressed = rgbMatrixColor('solid_reactive', config, centre, frame([hitAt(centre, 0)]));
    expect(pressed).toEqual(hsvToRgb8(64, 255, 255));
    const other = rgbMatrixColor('solid_reactive', config, {...centre, index: 41, x: 126}, frame([hitAt(centre, 0)]));
    expect(other).toEqual([255, 0, 0]);
    // Back to the main colour once the fade is over.
    expect(rgbMatrixColor('solid_reactive', config, centre, frame([hitAt(centre, reactiveFadeMs(128))]))).toEqual([255, 0, 0]);
  });

  it('a white backlight flashes white: the shift has nothing to move', () => {
    const white = {...config, sat: 0};
    expect(rgbMatrixColor('solid_reactive', white, centre, frame([hitAt(centre, 0)]))).toEqual([255, 255, 255]);
  });

  it('wide, cross, nexus and splash are dark until a key is pressed', () => {
    for (const effect of ['solid_reactive_wide', 'solid_reactive_multicross', 'solid_reactive_nexus', 'splash', 'solid_multisplash']) {
      expect(rgbMatrixColor(effect, config, centre, frame([]))).toEqual([0, 0, 0]);
    }
  });

  it('wide lights a shrinking glow around the pressed key', () => {
    const hit = hitAt(centre, 0);
    expect(rgbMatrixColor('solid_reactive_wide', config, centre, frame([hit]))).toEqual([255, 0, 0]);
    const near = rgbMatrixColor('solid_reactive_wide', config, {...centre, x: 132}, frame([hit]));
    expect(near?.[0]).toBeGreaterThan(100);
    expect(rgbMatrixColor('solid_reactive_wide', config, {...centre, x: 180}, frame([hit]))).toEqual([0, 0, 0]);
  });

  it('cross lights the row and column, not the diagonal', () => {
    const hit = hitAt(centre, 0);
    const row = rgbMatrixColor('solid_reactive_cross', config, {...centre, x: 200}, frame([hit]));
    const diagonal = rgbMatrixColor('solid_reactive_cross', config, {...centre, x: 150, y: 64}, frame([hit]));
    expect(row?.[0]).toBeGreaterThan(0);
    expect(diagonal).toEqual([0, 0, 0]);
  });

  it('splash sends a ring outward', () => {
    // Speed 128 scales ticks by 129/256: 76 ms is tick 38, so the ring is 38 steps out.
    const hit = hitAt(centre, 76);
    expect(rgbMatrixColor('solid_splash', config, {...centre, x: 150}, frame([hit]))).toEqual([255, 0, 0]);
    expect(rgbMatrixColor('solid_splash', config, centre, frame([hit]))?.[0]).toBeLessThan(255);
  });

  it('single versions follow only the latest press, multi versions every press', () => {
    const left = {...centre, x: 20, index: 1};
    const hits = [hitAt(left, 0), hitAt(centre, 0)];
    expect(rgbMatrixColor('solid_reactive_wide', config, left, frame(hits))).toEqual([0, 0, 0]);
    expect(rgbMatrixColor('solid_reactive_multiwide', config, left, frame(hits))).toEqual([255, 0, 0]);
  });

  it('stops animating once every press has faded', () => {
    expect(hitsStillShowing('solid_reactive', 255, [hitAt(centre, 100)])).toBe(true);
    expect(hitsStillShowing('solid_reactive', 255, [hitAt(centre, 300)])).toBe(false);
    expect(hitsStillShowing('splash', 255, [hitAt(centre, 400)])).toBe(true);
    expect(hitsStillShowing('breathing', 255, [hitAt(centre, 0)])).toBe(false);
  });
});

describe('time-based effects', () => {
  const config: MatrixConfig = {hue: 20, sat: 255, val: 200, speed: 100};
  const led: LedPoint = {x: 60, y: 10, index: 3, isMod: false};

  it('breathing follows sin8 of the scaled timer', () => {
    expect(rgbMatrixColor('breathing', config, led, {timer: 0, hits: []})).toEqual([0, 0, 0]);
    // time = scale16by8(1000, qadd8(100 / 4, 1)) = 105; v = scale8(abs8(sin8(time / 2) - 128) * 2, 200).
    const time = scale16by8(1000, 26);
    expect(time).toBe(105);
    const v = scale8((Math.abs(sin8(time >> 1) - 128) * 2) & 0xff, 200);
    expect(rgbMatrixColor('breathing', config, led, {timer: 1000, hits: []})).toEqual(hsvToRgb8(20, 255, v));
  });

  it('cycle left to right shifts the hue with x', () => {
    const a = rgbMatrixColor('cycle_left_right', config, led, {timer: 0, hits: []});
    expect(a).toEqual(hsvToRgb8(60, 255, 200));
  });

  it('gradient left to right spreads the hue by the speed', () => {
    // scale = scale8(64, 100) = 25; hue = 20 + (25 * 60 >> 5) = 66.
    expect(rgbMatrixColor('gradient_left_right', config, led, {timer: 0, hits: []})).toEqual(hsvToRgb8(66, 255, 200));
  });

  it('returns null for effects it does not port', () => {
    expect(rgbMatrixColor('raindrops', config, led, {timer: 0, hits: []})).toBeNull();
    expect(rgbMatrixColor('riverflow', config, led, {timer: 0, hits: []})).toBeNull();
  });

  it('places LEDs on QMK’s 224 x 64 grid from key centres', () => {
    const points = ledPoints([
      {cx: 0.5, cy: 0.5, isMod: false},
      {cx: 18, cy: 6, isMod: true},
    ]);
    expect(points).toEqual([
      {x: 0, y: 0, index: 0, isMod: false},
      {x: 224, y: 64, index: 1, isMod: true},
    ]);
  });
});

describe('effect descriptions', () => {
  it('describes every effect the Linky87 offers, from the definition’s own list', () => {
    const choices = backlightChoices();
    expect(choices).toHaveLength(46);
    for (const choice of choices) {
      expect(effectInfo(choice.label, true).group, choice.label).not.toBe('other');
    }
  });

  it('groups the long list and keeps the definition order inside each group', () => {
    const groups = groupEffects(backlightChoices(), true);
    expect(groups.map((group) => group.id)).toEqual(['off', 'steady', 'your-colour-moving', 'rainbow', 'random', 'reactive-lit', 'reactive-dark']);
    expect(groups.find((group) => group.id === 'reactive-lit')?.choices.map((choice) => choice.value)).toEqual([31]);
    expect(groups.find((group) => group.id === 'reactive-dark')?.choices.map((choice) => choice.value)).toEqual([32, 33, 34, 35, 36, 37, 38, 39, 40, 41]);
    const all = groups.flatMap((group) => group.choices.map((choice) => choice.value));
    expect([...all].sort((a, b) => a - b)).toEqual(backlightChoices().map((choice) => choice.value));
    expect(EFFECT_GROUPS.at(-1)?.id).toBe('other');
  });

  it('says what each effect uses', () => {
    expect(effectSentence('solid_reactive', true)).toBe(
      'Every key stays lit. A pressed key flashes a shifted colour, then slides back. Uses your colour, the speed and key presses.',
    );
    expect(effectSentence('solid_color', true)).toBe('Every key glows in one colour. Uses your colour.');
    expect(effectSentence('cycle_all', true)).toMatch(/Makes its own colours at your colour strength; uses the speed\./);
    expect(effectSentence('digital_rain', true)).toMatch(/Makes its own colours\.$/);
  });

  it('falls back gracefully for names it does not know and for vendor zones', () => {
    expect(effectInfo('rainbow_sparkle_9000', true).group).toBe('other');
    expect(effectSentence('rainbow_sparkle_9000', true)).toMatch(/cannot describe it/);
    expect(effectSentence('fixed wave', false)).toMatch(/cannot describe it/);
    expect(effectSentence('none', false)).toBe('Lights off.');
    expect(groupEffects([{label: 'none', value: 0}, {label: 'wave', value: 1}], false)).toHaveLength(1);
  });
});
