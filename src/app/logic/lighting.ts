/**
 * Lighting zones: which control does what, and how the on-screen model
 * previews a zone. Only effects whose firmware formula is known are
 * animated (QMK's rgb_matrix formulas, ported below). Every other effect
 * shows its colour and brightness only, and the UI says so.
 */
import {decodeControlValue, isNodeVisible, type MenuControl, type MenuValues, type MenuZone} from '../../core/index.ts';

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
  | 'solid'
  | 'alphas-mods'
  | 'gradient-y'
  | 'gradient-x'
  | 'breathing'
  | 'cycle-all'
  | 'cycle-x'
  | 'cycle-y'
  /** The effect is not rendered; the model shows its colour. */
  | 'colour-only'
  /** The effect makes its own colours and is not rendered; the model shows a neutral glow. */
  | 'own-colours';

export interface ZonePreview {
  readonly mode: PreviewMode;
  /** QMK hue and saturation, 0-255. */
  readonly hue: number;
  readonly sat: number;
  /** Brightness as a fraction of the control's range, 0-1. */
  readonly level: number;
  /** Raw speed byte, 0-255 (scaled from the control's range). */
  readonly speed: number;
  /** True when the model shows this effect as the firmware does. */
  readonly faithful: boolean;
  /** True when the preview changes over time and needs animation frames. */
  readonly animated: boolean;
  readonly effectName: string;
  /** True when the keyboard reports a brightness above the definition's range. */
  readonly brightnessOutOfRange: boolean;
}

const FAITHFUL: Readonly<Record<string, PreviewMode>> = {
  none: 'off',
  off: 'off',
  solid_color: 'solid',
  solid: 'solid',
  alphas_mods: 'alphas-mods',
  gradient_up_down: 'gradient-y',
  gradient_left_right: 'gradient-x',
  breathing: 'breathing',
  cycle_all: 'cycle-all',
  cycle_left_right: 'cycle-x',
  cycle_up_down: 'cycle-y',
};

const ANIMATED: ReadonlySet<PreviewMode> = new Set<PreviewMode>(['breathing', 'cycle-all', 'cycle-x', 'cycle-y']);

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

/** How the model should show a zone with the given values. */
export const zonePreview = (zone: Pick<MenuZone, 'controls'>, values: MenuValues): ZonePreview => {
  const controls = zoneControls(zone);
  const effect = currentEffect(controls, values);
  const effectKey = effect?.label.toLowerCase().replace(/\s+/g, '_') ?? 'solid';
  const colorVisible = controls.color !== undefined && isNodeVisible(controls.color, values);
  const known = FAITHFUL[effectKey];
  const mode: PreviewMode = known ?? (colorVisible || controls.color === undefined ? 'colour-only' : 'own-colours');
  // Only QMK's own rgb_matrix effects follow the ported formulas; vendor
  // effects on other zones with the same name are not guaranteed to.
  const isRgbMatrix = /rgb_matrix/i.test(controls.effect?.commandId ?? '');
  const faithful = known !== undefined && (known === 'off' || known === 'solid' || isRgbMatrix);

  const bright = rangeValue(controls.brightness, values);
  const level = mode === 'off' ? 0 : bright ? Math.max(0, Math.min(1, bright.value / Math.max(1, bright.max))) : 1;
  const speedRaw = rangeValue(controls.speed, values);
  const speed = speedRaw ? Math.round((Math.min(speedRaw.value, speedRaw.max) / Math.max(1, speedRaw.max)) * 255) : 128;
  const colorBytes = controls.color ? values[controls.color.commandId] : undefined;
  const hue = colorBytes?.[0] ?? 0;
  const sat = colorBytes?.[1] ?? 0;
  const animatedMode = faithful && ANIMATED.has(mode);
  return {
    mode,
    hue,
    sat,
    level,
    speed,
    faithful,
    animated: animatedMode,
    effectName: effect ? effectLabel(effect.label) : 'Unknown',
    brightnessOutOfRange: bright !== null && bright.value > bright.max,
  };
};

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

export interface LedPoint {
  /** 0-1 across the board, left to right. */
  readonly nx: number;
  /** 0-1 down the board, top to bottom. */
  readonly ny: number;
  /** True for modifier keys (QMK's LED_FLAG_MODIFIER). */
  readonly isMod: boolean;
}

/** QMK scale16by8: `value * scale / 256`. */
const scale16by8 = (value: number, scale: number) => (value * scale) / 256;

/**
 * Colour of one backlight LED at `timeMs`, following QMK's rgb_matrix
 * animations (LED points span x 0-224 and y 0-64). Returns black for
 * modes the model does not animate faithfully except colour-only and
 * own-colours, which return a steady colour or a neutral white.
 */
export const backlightColor = (preview: ZonePreview, led: LedPoint, timeMs: number): Rgb => {
  const v = preview.level * 255;
  const x = led.nx * 224;
  const y = led.ny * 64;
  const {hue, sat, speed} = preview;
  switch (preview.mode) {
    case 'off':
      return [0, 0, 0];
    case 'solid':
    case 'colour-only':
      return hsvToRgb(hue, sat, v);
    case 'own-colours':
      return hsvToRgb(0, 0, v * 0.6);
    case 'alphas-mods':
      return hsvToRgb(led.isMod ? hue + speed : hue, sat, v);
    case 'gradient-y': {
      const scale = (64 * speed) / 256;
      return hsvToRgb(hue + scale * (Math.floor(y) >> 4), sat, v);
    }
    case 'gradient-x': {
      const scale = (64 * speed) / 256;
      return hsvToRgb(hue + ((scale * x) >> 5), sat, v);
    }
    case 'breathing': {
      const time = scale16by8(timeMs, speed / 8);
      return hsvToRgb(hue, sat, v * Math.abs(Math.sin((2 * Math.PI * time) / 256)));
    }
    case 'cycle-all':
      return hsvToRgb(scale16by8(timeMs, speed / 4), sat, v);
    case 'cycle-x':
      return hsvToRgb(x - scale16by8(timeMs, speed / 4), sat, v);
    case 'cycle-y':
      return hsvToRgb(y - scale16by8(timeMs, speed / 4), sat, v);
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
  if (preview.faithful) {
    return 'The model shows this effect.';
  }
  if (preview.mode === 'own-colours') {
    return 'This effect picks its own colours. Watch your keyboard to see it.';
  }
  return 'The model shows the colour. Watch your keyboard to see the effect.';
};
