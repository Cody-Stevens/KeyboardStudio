/**
 * QMK rgb_matrix effects, ported so the model shows what the keyboard shows.
 *
 * Ported from qmk/qmk_firmware at commit 33292390974c75362ca30873c482d052e0bd7a63
 * (GPL-2.0-or-later), quantum/rgb_matrix/animations/: the *_anim.h files
 * named in PORTED below, solid_reactive_wide.h, solid_reactive_cross.h,
 * solid_reactive_nexus.h, and the runners effect_runner_i.h,
 * effect_runner_dx_dy.h, effect_runner_dx_dy_dist.h,
 * effect_runner_sin_cos_i.h, effect_runner_reactive.h and
 * effect_runner_reactive_splash.h. Key hits follow
 * quantum/rgb_matrix/rgb_matrix.c (8 remembered hits, ticks in ms).
 *
 * Not ported: effects that use random numbers (raindrops, jellybean
 * raindrops, pixel flow, digital rain, the starlights), and riverflow,
 * which depends on the order the LEDs are wired in.
 *
 * Assumptions, since VIA data has none of this: LED positions come from
 * the key centres scaled to QMK's 224 x 64 grid, the centre is QMK's
 * default (112, 32), modifier keys are the non-alpha caps, and
 * RGB_MATRIX_SOLID_REACTIVE_GRADIENT_MODE is off.
 */
import {
  abs8,
  atan2_8,
  cos8,
  div,
  hsvToRgb8,
  i8,
  qadd8,
  qsub8,
  scale16by8,
  scale8,
  sin8,
  sqrt16,
  u16,
  u8,
  type Rgb8,
} from './qmk-math.ts';

/** One LED, in QMK's coordinates (x 0-224, y 0-64). */
export interface LedPoint {
  readonly x: number;
  readonly y: number;
  /** LED index (here: key order). */
  readonly index: number;
  /** QMK's LED_FLAG_MODIFIER. */
  readonly isMod: boolean;
}

/** rgb_matrix_config: hue, saturation, value (brightness) and speed, all 0-255. */
export interface MatrixConfig {
  readonly hue: number;
  readonly sat: number;
  readonly val: number;
  readonly speed: number;
}

/** A remembered key press: where, which LED, and how long ago in ms (QMK's tick). */
export interface KeyHit {
  readonly x: number;
  readonly y: number;
  readonly index: number;
  readonly tick: number;
}

export interface MatrixFrame {
  /** g_rgb_timer, in ms. */
  readonly timer: number;
  /** Oldest first, at most LED_HITS_TO_REMEMBER (8). */
  readonly hits: readonly KeyHit[];
}

export const LED_HITS_TO_REMEMBER = 8;
const CENTER = {x: 112, y: 32} as const;

interface Hsv {
  h: number;
  s: number;
  v: number;
}

type Kind = 'static' | 'timed' | 'reactive';

/** Effects whose firmware formula is ported, and whether they change over time or with key presses. */
const PORTED: Readonly<Record<string, Kind>> = {
  solid_color: 'static',
  alphas_mods: 'static',
  gradient_up_down: 'static',
  gradient_left_right: 'static',
  breathing: 'timed',
  band_sat: 'timed',
  band_val: 'timed',
  band_pinwheel_sat: 'timed',
  band_pinwheel_val: 'timed',
  band_spiral_sat: 'timed',
  band_spiral_val: 'timed',
  cycle_all: 'timed',
  cycle_left_right: 'timed',
  cycle_up_down: 'timed',
  cycle_out_in: 'timed',
  cycle_out_in_dual: 'timed',
  rainbow_moving_chevron: 'timed',
  cycle_pinwheel: 'timed',
  cycle_spiral: 'timed',
  dual_beacon: 'timed',
  rainbow_beacon: 'timed',
  rainbow_pinwheels: 'timed',
  flower_blooming: 'timed',
  hue_breathing: 'timed',
  hue_pendulum: 'timed',
  hue_wave: 'timed',
  solid_reactive: 'reactive',
  solid_reactive_wide: 'reactive',
  solid_reactive_multiwide: 'reactive',
  solid_reactive_cross: 'reactive',
  solid_reactive_multicross: 'reactive',
  solid_reactive_nexus: 'reactive',
  solid_reactive_multinexus: 'reactive',
  splash: 'reactive',
  multisplash: 'reactive',
  solid_splash: 'reactive',
  solid_multisplash: 'reactive',
};

export const isPortedEffect = (effect: string): boolean => effect in PORTED;
export const effectKind = (effect: string): Kind | null => PORTED[effect] ?? null;

/** Builds QMK-style LED points from key centres (in key units). */
export const ledPoints = (keys: readonly {readonly cx: number; readonly cy: number; readonly isMod: boolean}[]): LedPoint[] => {
  const xs = keys.map((key) => key.cx);
  const ys = keys.map((key) => key.cy);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1e-6, Math.max(...xs) - minX);
  const spanY = Math.max(1e-6, Math.max(...ys) - minY);
  return keys.map((key, index) => ({
    x: Math.round(((key.cx - minX) / spanX) * 224),
    y: Math.round(((key.cy - minY) / spanY) * 64),
    index,
    isMod: key.isMod,
  }));
};

// Runner clocks (effect_runner_*.h).
const timeI = (frame: MatrixFrame, c: MatrixConfig) => u8(scale16by8(frame.timer, qadd8(c.speed >> 2, 1)));
const timeDxDy = (frame: MatrixFrame, c: MatrixConfig) => u8(scale16by8(frame.timer, c.speed >> 1));

/** One LED's colour (0-255 per channel), or null when the effect is not ported. */
export const rgbMatrixColor = (effect: string, c: MatrixConfig, led: LedPoint, frame: MatrixFrame): Rgb8 | null => {
  const hsv: Hsv = {h: u8(c.hue), s: u8(c.sat), v: u8(c.val)};
  const {x, y} = led;
  const dx = x - CENTER.x;
  const dy = y - CENTER.y;
  const out = (value: Hsv): Rgb8 => hsvToRgb8(value.h, value.s, value.v);
  switch (effect) {
    case 'solid_color':
      return out(hsv);
    case 'alphas_mods':
      return out(led.isMod ? {...hsv, h: u8(hsv.h + c.speed)} : hsv);
    case 'gradient_up_down':
      return out({...hsv, h: u8(hsv.h + scale8(64, c.speed) * (y >> 4))});
    case 'gradient_left_right':
      return out({...hsv, h: u8(hsv.h + ((scale8(64, c.speed) * x) >> 5))});
    case 'breathing': {
      const t = timeI(frame, c);
      return out({...hsv, v: scale8(u8(abs8(sin8(t >> 1) - 128) * 2), hsv.v)});
    }
    case 'band_sat':
    case 'band_val': {
      const t = timeI(frame, c);
      const which = effect === 'band_sat' ? hsv.s : hsv.v;
      const raw = which - Math.abs(scale8(x, 228) + 28 - t) * 8;
      const next = scale8(raw < 0 ? 0 : raw, which);
      return out(effect === 'band_sat' ? {...hsv, s: next} : {...hsv, v: next});
    }
    case 'band_pinwheel_sat':
    case 'band_pinwheel_val': {
      const t = timeDxDy(frame, c);
      const which = effect === 'band_pinwheel_sat' ? hsv.s : hsv.v;
      const next = scale8(u8(which - t - atan2_8(dy, dx) * 3), which);
      return out(effect === 'band_pinwheel_sat' ? {...hsv, s: next} : {...hsv, v: next});
    }
    case 'band_spiral_sat':
    case 'band_spiral_val': {
      const t = timeDxDy(frame, c);
      const dist = sqrt16(dx * dx + dy * dy);
      const which = effect === 'band_spiral_sat' ? hsv.s : hsv.v;
      const next = scale8(u8(which + dist - t - atan2_8(dy, dx)), which);
      return out(effect === 'band_spiral_sat' ? {...hsv, s: next} : {...hsv, v: next});
    }
    case 'cycle_all':
      return out({...hsv, h: timeI(frame, c)});
    case 'cycle_left_right':
      return out({...hsv, h: u8(x - timeI(frame, c))});
    case 'cycle_up_down':
      return out({...hsv, h: u8(y - timeI(frame, c))});
    case 'cycle_out_in': {
      const dist = sqrt16(dx * dx + dy * dy);
      return out({...hsv, h: u8(div(3 * dist, 2) + timeDxDy(frame, c))});
    }
    case 'cycle_out_in_dual': {
      const ddx = div(CENTER.x, 2) - abs8(dx);
      const dist = sqrt16(ddx * ddx + dy * dy);
      return out({...hsv, h: u8(3 * dist + timeDxDy(frame, c))});
    }
    case 'rainbow_moving_chevron':
      return out({...hsv, h: u8(hsv.h + abs8(y - CENTER.y) + (x - timeI(frame, c)))});
    case 'cycle_pinwheel':
      return out({...hsv, h: u8(atan2_8(dy, dx) + timeDxDy(frame, c))});
    case 'cycle_spiral': {
      const dist = sqrt16(dx * dx + dy * dy);
      return out({...hsv, h: u8(dist - timeDxDy(frame, c) - atan2_8(dy, dx))});
    }
    case 'dual_beacon':
    case 'rainbow_beacon':
    case 'rainbow_pinwheels': {
      // effect_runner_sin_cos_i passes (cos_value, sin_value) into parameters named (sin, cos).
      const time = scale16by8(frame.timer, c.speed >> 2);
      const sinParam = i8(cos8(time) - 128);
      const cosParam = i8(sin8(time) - 128);
      const shift =
        effect === 'dual_beacon'
          ? div(dy * cosParam + dx * sinParam, 128)
          : effect === 'rainbow_beacon'
            ? div(dy * 2 * cosParam + dx * 2 * sinParam, 128)
            : div(dy * 3 * cosParam + (56 - abs8(dx)) * 3 * sinParam, 128);
      return out({...hsv, h: u8(hsv.h + shift)});
    }
    case 'flower_blooming': {
      const t = u8(scale16by8(frame.timer, qadd8(div(c.speed, 10), 1)));
      if (y > CENTER.y) {
        const [r, g, b] = out({...hsv, h: u8(x * 3 - y * 3 + t)});
        return [b, g, r];
      }
      return out({...hsv, h: u8(x * 3 - y * 3 - t)});
    }
    case 'hue_breathing': {
      const t = timeI(frame, c);
      return out({...hsv, h: u8(hsv.h + scale8(u8(abs8(sin8(t >> 1) - 128) * 2), 12))});
    }
    case 'hue_pendulum': {
      const t = timeI(frame, c);
      return out({...hsv, h: u8(hsv.h + scale8(u8(abs8(sin8(t) + x - 128) * 2), 12))});
    }
    case 'hue_wave': {
      const t = timeI(frame, c);
      return out({...hsv, h: u8(hsv.h + scale8(u8(abs8(x - t)), 24))});
    }
    case 'solid_reactive':
      return out(solidReactive(hsv, c, led, frame));
    case 'solid_reactive_wide':
    case 'solid_reactive_cross':
    case 'solid_reactive_nexus':
    case 'splash':
    case 'solid_splash':
      return out(reactiveSplash(effect, qsub8(frame.hits.length, 1), hsv, c, led, frame));
    case 'solid_reactive_multiwide':
    case 'solid_reactive_multicross':
    case 'solid_reactive_multinexus':
    case 'multisplash':
    case 'solid_multisplash':
      return out(reactiveSplash(effect, 0, hsv, c, led, frame));
    default:
      return null;
  }
};

/** effect_runner_reactive with SOLID_REACTIVE_math. */
const solidReactive = (hsv: Hsv, c: MatrixConfig, led: LedPoint, frame: MatrixFrame): Hsv => {
  const maxTick = div(65535, qadd8(c.speed, 1));
  let tick = maxTick;
  for (let j = frame.hits.length - 1; j >= 0; j--) {
    const hit = frame.hits[j];
    if (hit && hit.index === led.index && hit.tick < tick) {
      tick = hit.tick;
      break;
    }
  }
  const offset = Math.min(255, scale16by8(tick, qadd8(c.speed, 1)));
  return {...hsv, h: u8(hsv.h + scale8(255 - offset, 64))};
};

const BASE_NAME: Readonly<Record<string, string>> = {
  solid_reactive_multiwide: 'solid_reactive_wide',
  solid_reactive_multicross: 'solid_reactive_cross',
  solid_reactive_multinexus: 'solid_reactive_nexus',
  multisplash: 'splash',
  solid_multisplash: 'solid_splash',
};

/** effect_runner_reactive_splash with the WIDE, CROSS, NEXUS, SPLASH and SOLID_SPLASH maths. */
const reactiveSplash = (effect: string, start: number, base: Hsv, c: MatrixConfig, led: LedPoint, frame: MatrixFrame): Hsv => {
  const name = BASE_NAME[effect] ?? effect;
  const hsv: Hsv = {...base, v: 0};
  for (let j = start; j < frame.hits.length; j++) {
    const hit = frame.hits[j];
    if (!hit) {
      continue;
    }
    const dx = led.x - hit.x;
    const dy = led.y - hit.y;
    const dist = sqrt16(dx * dx + dy * dy);
    const tick = scale16by8(hit.tick, qadd8(c.speed, 1));
    let effectValue: number;
    switch (name) {
      case 'solid_reactive_wide':
        effectValue = Math.min(255, u16(tick + dist * 5));
        break;
      case 'solid_reactive_cross': {
        const ax = Math.min(255, Math.abs(dx) * 16);
        const ay = Math.min(255, Math.abs(dy) * 16);
        effectValue = Math.min(255, u16(tick + dist + Math.min(ax, ay)));
        break;
      }
      case 'solid_reactive_nexus':
        effectValue = Math.min(255, u16(tick - dist));
        if (dist > 72 || ((dx > 8 || dx < -8) && (dy > 8 || dy < -8))) {
          effectValue = 255;
        }
        hsv.h = u8(c.hue + div(dy, 4));
        break;
      case 'splash':
        effectValue = Math.min(255, u16(tick - dist));
        hsv.h = u8(hsv.h + effectValue);
        break;
      default:
        effectValue = Math.min(255, u16(tick - dist));
        break;
    }
    hsv.v = qadd8(hsv.v, 255 - effectValue);
  }
  hsv.v = scale8(hsv.v, c.val);
  return hsv;
};

/** True while a key press still changes what an effect shows. */
export const hitsStillShowing = (effect: string, speed: number, hits: readonly KeyHit[]): boolean => {
  if (effectKind(effect) !== 'reactive') {
    return false;
  }
  // Splash rings travel up to about 234 steps across the 224 x 64 grid before they fade.
  const limit = effect === 'solid_reactive' || effect.includes('wide') || effect.includes('cross') ? 255 : 255 + 234;
  return hits.some((hit) => scale16by8(hit.tick, qadd8(speed, 1)) < limit);
};

/**
 * Solid reactive: the hue a pressed key flashes to. SOLID_REACTIVE_math adds
 * scale8(255 - offset, 64) to the hue, which is 64 of 255 steps (about a
 * quarter turn of the colour wheel) at the moment of the press.
 */
export const reactiveFlashHue = (hue: number): number => u8(hue + scale8(255, 64));

/** Solid reactive: how long a flash takes to slide back to the main colour, in ms. */
export const reactiveFadeMs = (speed: number): number => {
  const step = qadd8(speed, 1);
  // offset = scale16by8(tick, step) reaches 255 at the first tick where (tick * (step + 1)) >> 8 >= 255.
  return Math.ceil((255 * 256) / (step + 1));
};
