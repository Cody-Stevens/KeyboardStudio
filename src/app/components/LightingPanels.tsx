import {useStore} from '@nanostores/react';
import {useEffect, useRef} from 'react';
import {decodeControlValue, isNodeVisible, type BoardZone, type ControlInput, type MenuControl} from '../../core/index.ts';
import {controlLabel, effectLabel, hueSatCss, previewNote, zoneControls, zonePreview} from '../logic/lighting.ts';
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
          <Control key={control.commandId} control={control} session={session} isEffect={control === roles.effect} disabled={stale} onWrite={write} />
        ))}
        {roles.color && !isNodeVisible(roles.color, values) && preview.mode !== 'off' && <p className="muted small">{preview.effectName} picks its own colours.</p>}
        {preview.mode === 'off' && <p className="muted small">Off. Choose an effect to turn it on.</p>}
      </div>
      <footer className="zone-foot">
        <p className="muted small">{previewNote(preview)}</p>
      </footer>
    </section>
  );
}

interface ControlProps {
  readonly control: MenuControl;
  readonly session: SessionView;
  readonly isEffect: boolean;
  readonly disabled: boolean;
  readonly onWrite: (control: MenuControl, input: ControlInput, throttled: boolean) => void;
}

function Control({control, session, isEffect, disabled, onWrite}: ControlProps) {
  const bytes = session.menuValues[control.commandId];
  const label = isEffect ? 'Effect' : controlLabel(control);
  const id = `control-${control.commandId}`;
  if (!bytes) {
    return null;
  }
  const decoded = decodeControlValue(control, bytes);
  switch (decoded.type) {
    case 'dropdown':
      return (
        <label className="field" htmlFor={id}>
          <span className="field-label">{label}</span>
          <select
            id={id}
            value={decoded.value}
            disabled={disabled}
            onChange={(event) => onWrite(control, {type: 'dropdown', value: Number(event.target.value)}, false)}
            data-testid={id}
          >
            {(control.choices ?? []).map((choice) => (
              <option key={choice.label} value={choice.value[0]}>
                {effectLabel(choice.label)}
              </option>
            ))}
          </select>
        </label>
      );
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
