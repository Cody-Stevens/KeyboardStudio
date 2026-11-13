/**
 * Lighting zones: which control does what, and how the on-screen model
 * previews a zone. Only effects whose firmware formula is ported
 * (rgb-matrix.ts) are animated. Every other effect shows its colour and
 * brightness only, and the UI says so.
 */
import {decodeControlValue, isNodeVisible, type MenuControl, type MenuValues, type MenuZone} from '../../core/index.ts';
import {effectInfo, effectKey} from './effect-info.ts';
import {effectKind, isPortedEffect, rgbMatrixColor, type LedPoint, type MatrixFrame} from './rgb-matrix.ts';

export interface ZoneControls {
  readonly effect?: MenuControl;
  readonly brightness?: MenuControl;
  readonly speed?: MenuControl;
  readonly color?: MenuControl;
}

/** Finds the effect, brightness, speed and colour controls of a zone by type and name. */
export const zoneControls = (zone: Pick<MenuZone, 'controls'>): ZoneControls => {
  const find = (type: MenuControl['type'], pattern: RegExp) =>
    zone.controls.find((control) => control.type === type && (pattern.test(control.commandId) || pattern.test(control.label)));
  const effect = find('dropdown', /effect|mode/i);
  const brightness = find('range', /bright/i);
  const speed = find('range', /speed/i);
  const color = zone.controls.find((control) => control.type === 'color');
  return {
    ...(effect ? {effect} : {}),
    ...(brightness ? {brightness} : {}),
    ...(speed ? {speed} : {}),
    ...(color ? {color} : {}),
  };
};

/** "solid_color" → "Solid colour", "fixed wave" → "Fixed wave". */
export const effectLabel = (raw: string): string => {
  const words = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\bcolor\b/g, 'colour');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "Effect Speed" → "Speed", "Color" → "Colour". */
export const controlLabel = (control: Pick<MenuControl, 'label'>): string => {
  const label = control.label.replace(/^effect\s+speed$/i, 'Speed').replace(/\bcolor\b/gi, 'Colour').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export type PreviewMode =
  | 'off'
  /** The effect's firmware formula is ported: the model computes every LED as the keyboard does. */
  | 'effect'
  /** The effect is not rendered; the model shows its colour. */
  | 'colour-only'
  /** The effect makes its own colours and is not rendered; the model shows a neutral glow. */
  | 'own-colours';

export interface ZonePreview {
  readonly mode: PreviewMode;
  /** QMK effect key, such as "solid_reactive". */
  readonly effect: string;
  /** QMK hue and saturation, 0-255. */
  readonly hue: number;
  readonly sat: number;
  /** Brightness as a fraction of the control's range, 0-1. */
  readonly level: number;
  /** Raw speed byte, 0-255 (scaled from the control's range). */
  readonly speed: number;
  /** True when the model shows this effect as the firmware does. */
  readonly faithful: boolean;
  /** True when the preview changes over time on its own and needs animation frames. */
  readonly animated: boolean;
  /** True when the preview reacts to key presses (and animates only after one). */
  readonly reactive: boolean;
  readonly effectName: string;
  /** True when the zone uses QMK's rgb_matrix effects. */
  readonly rgbMatrix: boolean;
  /** True when the keyboard reports a brightness above the definition's range. */
  readonly brightnessOutOfRange: boolean;
}

const OFF_EFFECTS = new Set(['none', 'off']);

const rangeValue = (control: MenuControl | undefined, values: MenuValues): {value: number; max: number} | null => {
  if (!control) {
    return null;
  }
  const bytes = values[control.commandId];
  if (!bytes) {
    return null;
  }
  const decoded = decodeControlValue(control, bytes);
  return decoded.type === 'range' ? {value: decoded.value, max: control.range?.[1] ?? 255} : null;
};

/** The current effect's raw label (such as "solid_color"), or null. */
export const currentEffect = (controls: ZoneControls, values: MenuValues): {label: string; value: number} | null => {
  const {effect} = controls;
  const bytes = effect ? values[effect.commandId] : undefined;
  if (!effect || !bytes) {
    return null;
  }
  const decoded = decodeControlValue(effect, bytes);
  return decoded.type === 'dropdown' ? {label: decoded.label ?? String(decoded.value), value: decoded.value} : null;
};

/** True when a zone's effect control is QMK's rgb_matrix (so QMK's effect names mean QMK's effects). */
export const isRgbMatrixZone = (controls: ZoneControls): boolean => /rgb_matrix/i.test(controls.effect?.commandId ?? '');

/** How the model should show a zone with the given values. */
export const zonePreview = (zone: Pick<MenuZone, 'controls'>, values: MenuValues): ZonePreview => {
  const controls = zoneControls(zone);
  const current = currentEffect(controls, values);
  const effect = current ? effectKey(current.label) : 'solid_color';
  const rgbMatrix = isRgbMatrixZone(controls);
  const colorVisible = controls.color !== undefined && isNodeVisible(controls.color, values);
  // Only QMK's own rgb_matrix effects follow the ported formulas; vendor
  // effects on other zones with the same name are not guaranteed to.
  const ported = rgbMatrix && isPortedEffect(effect);
  const usesColour = rgbMatrix && effectInfo(effect, true).colour === 'uses';
  const mode: PreviewMode = OFF_EFFECTS.has(effect)
    ? 'off'
    : ported
      ? 'effect'
      : colorVisible || controls.color === undefined || usesColour
        ? 'colour-only'
        : 'own-colours';
  const bright = rangeValue(controls.brightness, values);
  const level = mode === 'off' ? 0 : bright ? Math.max(0, Math.min(1, bright.value / Math.max(1, bright.max))) : 1;
  const speedRaw = rangeValue(controls.speed, values);
  const speed = speedRaw ? Math.round((Math.min(speedRaw.value, speedRaw.max) / Math.max(1, speedRaw.max)) * 255) : 128;
  const colorBytes = controls.color ? values[controls.color.commandId] : undefined;
  const kind = mode === 'effect' ? effectKind(effect) : null;
  return {
    mode,
    effect,
    hue: colorBytes?.[0] ?? 0,
    sat: colorBytes?.[1] ?? 0,
    level,
    speed,
    faithful: mode === 'off' || mode === 'effect',
    animated: kind === 'timed',
    reactive: kind === 'reactive',
    effectName: current ? effectLabel(current.label) : 'Unknown',
    rgbMatrix,
    brightnessOutOfRange: bright !== null && bright.value > bright.max,
  };
};

/**
 * For `prefers-reduced-motion`: the preview held still. Breathing effects
 * would sit dark at time zero, so they hold at full brightness instead.
 */
export const stillPreview = (preview: ZonePreview): ZonePreview =>
  preview.effect === 'breathing' || preview.effect === 'hue_breathing'
    ? {...preview, effect: 'solid_color', animated: false}
    : {...preview, animated: false};

// ---------------------------------------------------------------------------
// Colour math (QMK hsv_to_rgb and rgb_matrix animations)
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

/** QMK HSV (all 0-255) to RGB 0-1. */
export const hsvToRgb = (h: number, s: number, v: number): Rgb => {
  const hue = (((h % 256) + 256) % 256) / 256;
  const sat = Math.max(0, Math.min(255, s)) / 255;
  const val = Math.max(0, Math.min(255, v)) / 255;
  const f = (n: number) => {
    const k = (n + hue * 6) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

/** CSS colour for a QMK hue and saturation at full value. */
export const hueSatCss = (hue: number, sat: number): string => {
  const [r, g, b] = hsvToRgb(hue, sat, 255);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
};

/**
 * Colour of one backlight LED (0-1 per channel). Ported effects follow
 * QMK's formulas exactly; colour-only shows a steady colour, own-colours a
 * neutral white.
 */
export const backlightColor = (preview: ZonePreview, led: LedPoint, frame: MatrixFrame): Rgb => {
  const v = Math.round(preview.level * 255);
  switch (preview.mode) {
    case 'off':
      return [0, 0, 0];
    case 'colour-only':
      return hsvToRgb(preview.hue, preview.sat, v);
    case 'own-colours':
      return hsvToRgb(0, 0, v * 0.6);
    case 'effect': {
      const rgb = rgbMatrixColor(preview.effect, {hue: preview.hue, sat: preview.sat, val: v, speed: preview.speed}, led, frame);
      return rgb ? [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] : hsvToRgb(preview.hue, preview.sat, v);
    }
    default: {
      const unreachable: never = preview.mode;
      return unreachable;
    }
  }
};

/** Colour of a logo or side zone. These zones are shown steady: colour, or neutral when the effect picks its own. */
export const stripColor = (preview: ZonePreview): Rgb => {
  const v = preview.level * 255;
  switch (preview.mode) {
    case 'off':
      return [0, 0, 0];
    case 'own-colours':
      return hsvToRgb(0, 0, v * 0.6);
    default:
      return hsvToRgb(preview.hue, preview.sat, v);
  }
};

/** A short, true sentence on how well the model shows the zone. */
export const previewNote = (preview: ZonePreview): string => {
  if (preview.mode === 'off') {
    return 'Off.';
  }
  if (preview.faithful && preview.reactive) {
    return 'The model shows this effect. Type, or click keys on the model, to try it.';
  }
  if (preview.faithful) {
    return 'The model shows this effect.';
  }
  if (preview.mode === 'own-colours') {
    return 'This effect picks its own colours. Watch your keyboard to see it.';
  }
  return 'The model shows the colour. Watch your keyboard to see the effect.';
};
