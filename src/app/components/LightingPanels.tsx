import {useStore} from '@nanostores/react';
import {useEffect, useRef, type ReactNode} from 'react';
import {decodeControlValue, isNodeVisible, type BoardZone, type ControlInput, type MenuControl} from '../../core/index.ts';
import {effectInfo, effectSentence, groupEffects} from '../logic/effect-info.ts';
import {controlLabel, effectLabel, hueSatCss, isRgbMatrixZone, previewNote, zoneControls, zonePreview, type ZonePreview} from '../logic/lighting.ts';
import {reactiveFadeMs, reactiveFlashHue} from '../logic/rgb-matrix.ts';
import {$entryStatuses, $log, setLighting} from '../state/changes.ts';
import {store, type SessionView} from '../state/session.ts';
import {$focusedPart, $hoveredPart} from '../state/ui.ts';
import {StatusText} from './StatusText.tsx';

const QUICK_COLOURS: readonly (readonly [number, number])[] = [
  [21, 255],
  [0, 0],
  [128, 255],
  [170, 255],
  [200, 255],
  [234, 200],
];

/** Sends at most one write per animation frame while a slider moves; the last value always goes out. */
const useFrameThrottle = () => {
  const pending = useRef<(() => void) | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (run: () => void) => {
    pending.current = run;
    if (frame.current === 0) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const next = pending.current;
        pending.current = null;
        next?.();
      });
    }
  };
};

export function LightingPanels({session}: {readonly session: SessionView}) {
  const focused = useStore($focusedPart);
  if (session.meta.zones.length === 0) {
    return (
      <div className="empty-panel">
        <p className="empty-title">This keyboard has no lighting settings.</p>
        <p className="muted">Its VIA file does not describe any lights that can be changed.</p>
      </div>
    );
  }
  return (
    <div className="zones" style={{gridTemplateColumns: `repeat(${session.meta.zones.length}, minmax(0, 1fr))`}}>
      {session.meta.zones.map((zone) => (
        <ZonePanel key={zone.zone.id} zone={zone} session={session} focused={focused === zone.part} />
      ))}
    </div>
  );
}

function ZonePanel({zone, session, focused}: {readonly zone: BoardZone; readonly session: SessionView; readonly focused: boolean}) {
  const panel = useRef<HTMLElement>(null);
  const throttle = useFrameThrottle();
  const log = useStore($log);
  const statuses = useStore($entryStatuses);
  const writes = useStore(store.$writes);
  const values = session.menuValues;
  const preview = zonePreview(zone.zone, values);
  const roles = zoneControls(zone.zone);
  // Effect first, then colour, brightness and speed: the order people decide in.
  const rank = (control: MenuControl) =>
    control === roles.effect ? 0 : control === roles.color ? 1 : control === roles.brightness ? 2 : control === roles.speed ? 3 : 4;
  const visible = zone.zone.controls.filter((control) => isNodeVisible(control, values)).sort((a, b) => rank(a) - rank(b));
  const stale = session.stale;
  const rgbMatrix = isRgbMatrixZone(roles);
  const colourHidden = roles.color !== undefined && !isNodeVisible(roles.color, values);

  useEffect(() => {
    // A click on this zone on the model: bring its panel into view and focus its first control.
    if (focused && panel.current && !panel.current.contains(document.activeElement)) {
      panel.current.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      panel.current.querySelector<HTMLElement>('select, input')?.focus({preventScroll: true});
    }
  }, [focused]);

  // Newest log line for this zone.
  const commandIds = new Set(zone.zone.controls.map((control) => control.commandId));
  const writesById = new Map(writes.map((record) => [record.id, record]));
  const entry = [...log].reverse().find((candidate) =>
    candidate.writeIds.some((id) => {
      const target = writesById.get(id)?.target;
      return target?.kind === 'menu' && commandIds.has(target.commandId);
    }),
  );
  const status = entry ? statuses.get(entry.id) : undefined;

  const write = (control: MenuControl, input: ControlInput, throttled: boolean) => {
    if (stale) {
      return;
    }
    const run = () => setLighting(zone.name, control, input);
    if (throttled) {
      throttle(run);
    } else {
      run();
    }
  };

  const swatch = preview.mode === 'off' ? 'transparent' : preview.mode === 'own-colours' ? 'conic-gradient(#f66, #fd5, #6e8, #5cf, #a7f, #f66)' : hueSatCss(preview.hue, preview.sat);

  return (
    <section
      ref={panel}
      className={`zone${focused ? ' focused' : ''}`}
      aria-labelledby={`zone-${zone.zone.id}`}
      onMouseEnter={() => $hoveredPart.set(zone.part)}
      onMouseLeave={() => $hoveredPart.set(null)}
      onFocus={() => $focusedPart.set(zone.part)}
      data-testid={`zone-${zone.part}`}
    >
      <header className="zone-head">
        <span className="zone-swatch" style={{background: swatch}} aria-hidden="true" />
        <div className="zone-title">
          <h3 id={`zone-${zone.zone.id}`}>{zone.name}</h3>
          <p className="muted small">{zone.description}</p>
        </div>
        {entry && status && (
          <p className="small zone-status" aria-live="polite">
            <StatusText status={status} />
          </p>
        )}
      </header>
      <div className="zone-controls">
        {visible.map((control) => (
          <Control
            key={control.commandId}
            control={control}
            session={session}
            isEffect={control === roles.effect}
            rgbMatrix={rgbMatrix}
            disabled={stale}
            onWrite={write}
            after={control === roles.color && preview.effect === 'solid_reactive' && rgbMatrix ? <FlashColour preview={preview} /> : null}
          />
        ))}
        {colourHidden && preview.mode !== 'off' && (
          <p className="muted small" data-testid={`colour-hidden-${zone.part}`}>
            {rgbMatrix && effectInfo(preview.effect, true).colour === 'uses'
              ? `This keyboard’s settings hide the colour for ${preview.effectName}, but the effect still uses the colour set last. To change it, pick another effect, set the colour, then come back.`
              : `${preview.effectName} makes its own colours.`}
          </p>
        )}
        {preview.mode === 'off' && <p className="muted small">Off. Choose an effect to turn it on.</p>}
      </div>
      <footer className="zone-foot">
        <p className="muted small">{previewNote(preview)}</p>
      </footer>
    </section>
  );
}

/**
 * Solid reactive: the colour a pressed key flashes, worked out with the
 * firmware's own rule (the hue turned 64 of 255 steps), so people see it
 * before they type and know it cannot be set on its own.
 */
function FlashColour({preview}: {readonly preview: ZonePreview}) {
  const flashHue = reactiveFlashHue(preview.hue);
  const fade = reactiveFadeMs(preview.speed);
  const seconds = fade < 10_000 ? (fade / 1000).toFixed(1) : String(Math.round(fade / 1000));
  return (
    <div className="flash-colour" data-testid="flash-colour" data-flash-hue={flashHue}>
      <span className="flash-swatches" aria-hidden="true">
        <span className="flash-swatch" style={{background: hueSatCss(preview.hue, preview.sat)}} />
        <svg className="flash-arrow" viewBox="0 0 16 10">
          <path d="M1 5h12m-4-4 4 4-4 4" />
        </svg>
        <span className="flash-swatch" style={{background: hueSatCss(flashHue, preview.sat)}} />
      </span>
      <div>
        <p className="flash-title">Pressed keys flash this colour</p>
        <p className="muted small">
          {preview.sat < 24
            ? 'With white light the flash cannot be seen: there is no colour to turn. Pick a colour to see it.'
            : `It follows your colour, a quarter turn around the colour wheel, and fades back in ${seconds} s at this speed. The keyboard has no setting for it.`}
        </p>
      </div>
    </div>
  );
}

interface ControlProps {
  readonly control: MenuControl;
  readonly session: SessionView;
  readonly isEffect: boolean;
  readonly rgbMatrix: boolean;
  readonly disabled: boolean;
  readonly onWrite: (control: MenuControl, input: ControlInput, throttled: boolean) => void;
  /** Shown under the control, inside its field. */
  readonly after?: ReactNode;
}

function Control({control, session, isEffect, rgbMatrix, disabled, onWrite, after}: ControlProps) {
  const bytes = session.menuValues[control.commandId];
  const label = isEffect ? 'Effect' : controlLabel(control);
  const id = `control-${control.commandId}`;
  if (!bytes) {
    return null;
  }
  const decoded = decodeControlValue(control, bytes);
  switch (decoded.type) {
    case 'dropdown': {
      const choices = (control.choices ?? []).map((choice) => ({label: choice.label, value: choice.value[0] ?? 0}));
      const option = (choice: {readonly label: string; readonly value: number}) => (
        <option key={choice.label} value={choice.value}>
          {effectLabel(choice.label)}
        </option>
      );
      const select = (
        <select
          id={id}
          value={decoded.value}
          disabled={disabled}
          aria-describedby={isEffect ? `${id}-about` : undefined}
          onChange={(event) => onWrite(control, {type: 'dropdown', value: Number(event.target.value)}, false)}
          data-testid={id}
        >
          {isEffect
            ? groupEffects(choices, rgbMatrix).map((group) =>
                group.label ? (
                  <optgroup key={group.id} label={group.label}>
                    {group.choices.map(option)}
                  </optgroup>
                ) : (
                  group.choices.map(option)
                ),
              )
            : choices.map(option)}
        </select>
      );
      if (!isEffect) {
        return (
          <label className="field" htmlFor={id}>
            <span className="field-label">{label}</span>
            {select}
          </label>
        );
      }
      // Effects: grouped by what they do, with one plain line on the chosen one.
      const chosen = choices.find((choice) => choice.value === decoded.value);
      return (
        <div className="field">
          <label className="field-label" htmlFor={id}>
            {label}
          </label>
          {select}
          <p className="effect-about" id={`${id}-about`} data-testid={`${id}-about`}>
            {effectSentence(chosen?.label ?? decoded.label ?? '', rgbMatrix)}
          </p>
        </div>
      );
    }
    case 'range': {
      const [min, max] = control.range ?? [0, 255];
      const outOfRange = decoded.value > max || decoded.value < min;
      return (
        <label className="field" htmlFor={id}>
          <span className="field-label">
            {label}
            <span className="field-value">{outOfRange ? `${decoded.value}, above the usual ${min} to ${max}` : `${decoded.value} of ${max}`}</span>
          </span>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            value={Math.max(min, Math.min(max, decoded.value))}
            disabled={disabled}
            onChange={(event) => onWrite(control, {type: 'range', value: Number(event.target.value)}, true)}
            data-testid={id}
          />
        </label>
      );
    }
    case 'color':
      return (
        <div className="field">
          <span className="field-label">
            {label}
            <span className="quick-colours" role="group" aria-label={`${label} presets`}>
            {QUICK_COLOURS.map(([hue, sat]) => (
              <button
                key={`${hue}-${sat}`}
                type="button"
                className={`swatch${decoded.hue === hue && decoded.sat === sat ? ' on' : ''}`}
                style={{background: hueSatCss(hue, sat)}}
                aria-label={sat === 0 ? 'White' : `Hue ${Math.round((hue / 255) * 360)} degrees`}
                disabled={disabled}
                onClick={() => onWrite(control, {type: 'color', hue, sat}, false)}
              />
            ))}
            </span>
          </span>
          <input
            type="range"
            className="hue"
            min={0}
            max={255}
            value={decoded.hue}
            aria-label={`${label} hue`}
            disabled={disabled}
            onChange={(event) => onWrite(control, {type: 'color', hue: Number(event.target.value), sat: decoded.sat}, true)}
            data-testid={`${id}-hue`}
          />
          <input
            type="range"
            className="sat"
            min={0}
            max={255}
            value={decoded.sat}
            aria-label={`${label} strength`}
            style={{['--sat-end' as string]: hueSatCss(decoded.hue, 255)}}
            disabled={disabled}
            onChange={(event) => onWrite(control, {type: 'color', hue: decoded.hue, sat: Number(event.target.value)}, true)}
            data-testid={`${id}-sat`}
          />
          {after}
        </div>
      );
    case 'toggle':
      return (
        <label className="check">
          <input type="checkbox" checked={decoded.value} disabled={disabled} onChange={(event) => onWrite(control, {type: 'toggle', value: event.target.checked}, false)} />
          {label}
        </label>
      );
    case 'button':
      return (
        <button type="button" className="button" disabled={disabled} onClick={() => onWrite(control, {type: 'button'}, false)}>
          {label}
        </button>
      );
    default:
      return null;
  }
}
