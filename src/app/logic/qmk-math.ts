/**
 * Integer helpers from QMK's lib8tion and colour code, ported so the
 * lighting previews compute exactly what the keyboard computes.
 *
 * Ported from qmk/qmk_firmware at commit 33292390974c75362ca30873c482d052e0bd7a63
 * (GPL-2.0-or-later): lib/lib8tion/scale8.h (scale8, scale16by8 with
 * FASTLED_SCALE8_FIXED=1, which QMK's build sets), lib/lib8tion/math8.h
 * (qadd8, qsub8, abs8, sqrt16), lib/lib8tion/trig8.h (sin8_C, cos8,
 * atan2_8) and quantum/color.c (hsv_to_rgb_impl without the CIE curve,
 * which is what rgb_matrix_hsv_to_rgb uses).
 *
 * C integer types are emulated: `u8` and `u16` wrap like uint8_t and
 * uint16_t, `i8` like int8_t, and `div` truncates toward zero.
 */

export const u8 = (value: number): number => value & 0xff;
export const u16 = (value: number): number => value & 0xffff;
export const i8 = (value: number): number => ((value & 0xff) ^ 0x80) - 0x80;
/** C integer division: truncates toward zero. */
export const div = (a: number, b: number): number => Math.trunc(a / b);

/** `i * (scale / 256)`, with QMK's "fixed" rounding so scale8(255, 255) is 255. */
export const scale8 = (i: number, scale: number): number => (u8(i) * (1 + u8(scale))) >> 8;

/** 16-bit value scaled by an 8-bit fraction; the input is truncated to 16 bits first, as in C. */
export const scale16by8 = (i: number, scale: number): number => u16((u16(i) * (1 + u8(scale))) >>> 8);

export const qadd8 = (a: number, b: number): number => Math.min(255, u8(a) + u8(b));
export const qsub8 = (a: number, b: number): number => Math.max(0, u8(a) - u8(b));

/** abs8 takes and returns int8_t, so abs8(-128) is -128. */
export const abs8 = (value: number): number => {
  const v = i8(value);
  return v < 0 ? i8(-v) : v;
};

/** Integer square root of a 16-bit value, as lib8tion's binary search computes it. */
export const sqrt16 = (value: number): number => {
  const x = u16(value);
  if (x <= 1) {
    return x;
  }
  let low = 1;
  let hi = x > 7904 ? 255 : (x >> 5) + 8;
  do {
    const mid = (low + hi) >> 1;
    if (u16(mid * mid) > x) {
      hi = mid - 1;
    } else {
      if (mid === 255) {
        return 255;
      }
      low = mid + 1;
    }
  } while (hi >= low);
  return low - 1;
};

const B_M16_INTERLEAVE = [0, 49, 49, 41, 90, 27, 117, 10] as const;

/** lib8tion's 8-bit sine: 0-255 in, 0-255 out (128 is zero). */
export const sin8 = (thetaIn: number): number => {
  const theta = u8(thetaIn);
  let offset = theta;
  if (theta & 0x40) {
    offset = 255 - offset;
  }
  offset &= 0x3f;
  let secoffset = offset & 0x0f;
  if (theta & 0x40) {
    secoffset += 1;
  }
  const section = offset >> 4;
  const b = B_M16_INTERLEAVE[section * 2] ?? 0;
  const m16 = B_M16_INTERLEAVE[section * 2 + 1] ?? 0;
  const mx = (m16 * secoffset) >> 4;
  let y = i8(mx + b);
  if (theta & 0x80) {
    y = i8(-y);
  }
  return u8(y + 128);
};

export const cos8 = (theta: number): number => sin8(u8(theta) + 64);

/** lib8tion's atan2 approximation: 0-255 around the circle. */
export const atan2_8 = (dy: number, dx: number): number => {
  if (dy === 0) {
    return dx >= 0 ? 0 : 128;
  }
  const absY = dy > 0 ? dy : -dy;
  const a = dx >= 0 ? i8(32 - div(32 * (dx - absY), dx + absY)) : i8(96 - div(32 * (dx + absY), absY - dx));
  return dy < 0 ? u8(-a) : u8(a);
};

export type Rgb8 = readonly [number, number, number];

/** QMK's integer HSV to RGB (all 0-255). */
export const hsvToRgb8 = (hIn: number, sIn: number, vIn: number): Rgb8 => {
  const h = u8(hIn);
  const s = u8(sIn);
  const v = u8(vIn);
  if (s === 0) {
    return [v, v, v];
  }
  const region = div(h * 6, 255);
  const remainder = u8((h * 2 - region * 85) * 3);
  const p = (v * (255 - s)) >> 8;
  const q = (v * (255 - ((s * remainder) >> 8))) >> 8;
  const t = (v * (255 - ((s * (255 - remainder)) >> 8))) >> 8;
  switch (region) {
    case 6:
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
};
