/**
 * Plain-language descriptions and groups for lighting effects, keyed by the
 * QMK effect name a VIA definition uses ("solid_reactive"). The definition
 * stays the source of the option list; this table only explains and groups
 * it. Names it does not know fall back to a generic, honest line.
 *
 * Every line was checked against QMK's quantum/rgb_matrix/animations/ at
 * commit 33292390974c75362ca30873c482d052e0bd7a63.
 */

export type EffectGroupId = 'off' | 'steady' | 'your-colour-moving' | 'rainbow' | 'random' | 'reactive-lit' | 'reactive-dark' | 'other';

export const EFFECT_GROUPS: readonly {readonly id: EffectGroupId; readonly label: string}[] = [
  {id: 'off', label: 'Off'},
  {id: 'steady', label: 'Steady'},
  {id: 'your-colour-moving', label: 'Your colour, moving'},
  {id: 'rainbow', label: 'Rainbow, moving'},
  {id: 'random', label: 'Random twinkles'},
  {id: 'reactive-lit', label: 'Stays lit, flashes when you type'},
  {id: 'reactive-dark', label: 'Dark until you type'},
  {id: 'other', label: 'Other'},
];

/**
 * How the effect uses the colour control: `uses` its hue, `own` hues at the
 * colour's strength (saturation), `random` colours that ignore it, or `none`.
 */
export type ColourUse = 'uses' | 'own' | 'random' | 'none';

export interface EffectInfo {
  readonly group: EffectGroupId;
  /** What it looks like, in one short sentence. */
  readonly looks: string;
  readonly colour: ColourUse;
  readonly speed: boolean;
  readonly keys: boolean;
}

const info = (group: EffectGroupId, looks: string, colour: ColourUse, speed: boolean, keys = false): EffectInfo => ({group, looks, colour, speed, keys});

const RGB_MATRIX_EFFECTS: Readonly<Record<string, EffectInfo>> = {
  none: info('off', 'Lights off.', 'none', false),
  solid_color: info('steady', 'Every key glows in one colour.', 'uses', false),
  alphas_mods: info('steady', 'Letter keys in your colour; Shift, Ctrl and the other modifiers in a second colour set by the speed.', 'uses', true),
  gradient_up_down: info('steady', 'A still blend of colours from the top row to the bottom; the speed sets how far they spread.', 'uses', true),
  gradient_left_right: info('steady', 'A still blend of colours from left to right; the speed sets how far they spread.', 'uses', true),

  breathing: info('your-colour-moving', 'The whole board fades in and out.', 'uses', true),
  band_sat: info('your-colour-moving', 'A band of your colour sweeps left to right over white.', 'uses', true),
  band_val: info('your-colour-moving', 'A bright band of your colour sweeps left to right over dark keys.', 'uses', true),
  band_pinwheel_sat: info('your-colour-moving', 'Your colour turns around the centre like a pinwheel, fading to white.', 'uses', true),
  band_pinwheel_val: info('your-colour-moving', 'Your colour turns around the centre like a pinwheel, fading to dark.', 'uses', true),
  band_spiral_sat: info('your-colour-moving', 'A spiral of your colour turns from the centre, fading to white.', 'uses', true),
  band_spiral_val: info('your-colour-moving', 'A spiral of your colour turns from the centre, fading to dark.', 'uses', true),
  hue_breathing: info('your-colour-moving', 'The whole board drifts gently to a nearby colour and back.', 'uses', true),
  hue_pendulum: info('your-colour-moving', 'Nearby colours swing left and right across your colour.', 'uses', true),
  hue_wave: info('your-colour-moving', 'Waves of nearby colours roll across your colour.', 'uses', true),
  riverflow: info('your-colour-moving', 'Keys brighten and dim one after another, like a ripple.', 'uses', true),

  cycle_all: info('rainbow', 'The whole board steps through the rainbow together.', 'own', true),
  cycle_left_right: info('rainbow', 'A rainbow scrolls from left to right.', 'own', true),
  cycle_up_down: info('rainbow', 'A rainbow scrolls from top to bottom.', 'own', true),
  cycle_out_in: info('rainbow', 'Rainbow rings move in toward the centre.', 'own', true),
  cycle_out_in_dual: info('rainbow', 'Rainbow rings move toward two points, one on each half.', 'own', true),
  rainbow_moving_chevron: info('rainbow', 'A rainbow arrow shape moves across the board.', 'own', true),
  cycle_pinwheel: info('rainbow', 'A rainbow turns around the centre like a pinwheel.', 'own', true),
  cycle_spiral: info('rainbow', 'A rainbow spiral turns from the centre.', 'own', true),
  dual_beacon: info('rainbow', 'A soft rainbow sweeps around the centre like a lighthouse beam.', 'own', true),
  rainbow_beacon: info('rainbow', 'A tight rainbow sweeps around the centre like a lighthouse beam.', 'own', true),
  rainbow_pinwheels: info('rainbow', 'Two rainbow pinwheels turn, one on each half.', 'own', true),
  flower_blooming: info('rainbow', 'Rainbow petals flow outward from the middle row.', 'own', true),

  raindrops: info('random', 'Random keys change to your colour or two colours near it.', 'uses', true),
  jellybean_raindrops: info('random', 'Random keys change to random bright colours.', 'random', true),
  pixel_flow: info('random', 'Random colours stream along the keys, some keys dark.', 'random', true),
  digital_rain: info('random', 'Green drops fall down the columns, like falling code.', 'random', false),
  starlight: info('random', 'Random keys twinkle brighter and dimmer in your colour.', 'uses', true),
  starlight_dual_hue: info('random', 'Random keys twinkle in your colour and colours just past it.', 'uses', true),
  starlight_dual_sat: info('random', 'Random keys twinkle in your colour, some paler than others.', 'uses', true),

  solid_reactive: info('reactive-lit', 'Every key stays lit. A pressed key flashes a shifted colour, then slides back.', 'uses', true, true),

  solid_reactive_wide: info('reactive-dark', 'A pressed key lights a soft glow around itself that shrinks and fades.', 'uses', true, true),
  solid_reactive_multiwide: info('reactive-dark', 'A soft glow around every recently pressed key, shrinking as it fades.', 'uses', true, true),
  solid_reactive_cross: info('reactive-dark', 'A pressed key lights its row and column in a cross that fades.', 'uses', true, true),
  solid_reactive_multicross: info('reactive-dark', 'Crosses from every recent key press at once.', 'uses', true, true),
  solid_reactive_nexus: info('reactive-dark', 'Light runs out along the row and column of the pressed key.', 'uses', true, true),
  solid_reactive_multinexus: info('reactive-dark', 'Light runs along rows and columns from every recent key press.', 'uses', true, true),
  splash: info('reactive-dark', 'A rainbow ring spreads out from the pressed key.', 'uses', true, true),
  multisplash: info('reactive-dark', 'Rainbow rings spread from every recent key press.', 'uses', true, true),
  solid_splash: info('reactive-dark', 'A ring of your colour spreads out from the pressed key.', 'uses', true, true),
  solid_multisplash: info('reactive-dark', 'Rings of your colour spread from every recent key press.', 'uses', true, true),
};

/** Effect keys as definitions write them: "Solid Reactive" and "solid_reactive" both become "solid_reactive". */
export const effectKey = (label: string): string => label.trim().toLowerCase().replace(/[\s-]+/g, '_');

const OFF_NAMES = new Set(['none', 'off']);

/**
 * What an effect does. `rgbMatrix` says the zone uses QMK's rgb_matrix
 * effects; other zones (vendor effects with names like "wave") get the
 * fallback, since their behaviour is not published.
 */
export const effectInfo = (label: string, rgbMatrix: boolean): EffectInfo => {
  const key = effectKey(label);
  if (OFF_NAMES.has(key)) {
    return RGB_MATRIX_EFFECTS['none'] ?? info('off', 'Off.', 'none', false);
  }
  const known = rgbMatrix ? RGB_MATRIX_EFFECTS[key] : undefined;
  return known ?? info('other', 'Made by this keyboard’s maker, so the app cannot describe it.', 'uses', true);
};

export const isKnownEffect = (label: string, rgbMatrix: boolean): boolean => effectInfo(label, rgbMatrix).group !== 'other' || OFF_NAMES.has(effectKey(label));

/** One line under the effect picker: what it looks like, then what it uses. */
export const effectSentence = (label: string, rgbMatrix: boolean): string => {
  const entry = effectInfo(label, rgbMatrix);
  if (entry.group === 'off') {
    return entry.looks;
  }
  if (entry.group === 'other') {
    return entry.looks;
  }
  return `${entry.looks} ${usesSentence(entry)}`;
};

const usesSentence = (entry: EffectInfo): string => {
  const parts: string[] = [];
  if (entry.colour === 'uses') parts.push('your colour');
  if (entry.speed) parts.push('the speed');
  if (entry.keys) parts.push('key presses');
  const list = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
  if (entry.colour === 'own') {
    return list ? `Makes its own colours at your colour strength; uses ${list}.` : 'Makes its own colours at your colour strength.';
  }
  if (entry.colour === 'random') {
    return list ? `Makes its own colours; uses ${list}.` : 'Makes its own colours.';
  }
  return list ? `Uses ${list}.` : '';
};

export interface EffectChoice {
  readonly label: string;
  readonly value: number;
}

export interface EffectGroup {
  readonly id: EffectGroupId;
  readonly label: string;
  readonly choices: readonly EffectChoice[];
}

/**
 * Groups a definition's choices, keeping the definition's order inside each
 * group and dropping empty groups. Unknown names go to "Other". With fewer
 * than eight choices, grouping helps nobody, so one unnamed group is returned.
 */
export const groupEffects = (choices: readonly EffectChoice[], rgbMatrix: boolean): EffectGroup[] => {
  if (choices.length < 8) {
    return [{id: 'other', label: '', choices}];
  }
  return EFFECT_GROUPS.map((group) => ({
    ...group,
    choices: choices.filter((choice) => effectInfo(choice.label, rgbMatrix).group === group.id),
  })).filter((group) => group.choices.length > 0);
};
