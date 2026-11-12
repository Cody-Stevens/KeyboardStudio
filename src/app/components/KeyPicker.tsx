import {useEffect, useMemo, useRef, useState} from 'react';
import {qmkCodeForEvent, heldModifiers, modifierOfEvent} from '../logic/browser-keys.ts';
import {comboKeycode, keycodeName, modifierLabel, type LegendContext, type ModName} from '../logic/legends.ts';
import {buildPicker, searchPicker, type PickerCategoryId, type PickerItem} from '../logic/picker.ts';
import type {CapTone} from '../logic/board-model.ts';
import {LegendView} from './FlatBoard.tsx';

interface KeyPickerProps {
  readonly ctx: LegendContext;
  readonly layerCount: number;
  readonly macroCount: number;
  readonly current: number;
  readonly onChoose: (value: number) => void;
  /** Focus the search box when this changes (a new key was selected). */
  readonly focusKey: number;
}

const MODS: readonly ModName[] = ['ctrl', 'shift', 'alt', 'gui'];

export function KeyPicker({ctx, layerCount, macroCount, current, onChoose, focusKey}: KeyPickerProps) {
  const categories = useMemo(() => buildPicker(ctx, layerCount, macroCount), [ctx, layerCount, macroCount]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PickerCategoryId>('typing');
  const [mods, setMods] = useState<ModName[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PickerItem | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const captureButton = useRef<HTMLButtonElement>(null);
  const os = ctx.meta.layers[ctx.layer]?.os ?? 'any';

  useEffect(() => {
    setQuery('');
    setConfirming(null);
    setCaptureNote(null);
    search.current?.focus({preventScroll: true});
  }, [focusKey]);

  const results = query.trim().length > 0 ? searchPicker(categories, query) : (categories.find((entry) => entry.id === category)?.items ?? []);

  const choose = (item: PickerItem) => {
    if (item.danger && confirming?.value !== item.value) {
      setConfirming(item);
      return;
    }
    setConfirming(null);
    const value = mods.length > 0 && item.value >= 0x04 && item.value <= 0xff ? comboKeycode(mods, item.value) : item.value;
    onChoose(value);
    setMods([]);
  };

  // "Press the key you want": one key or combination. Escape cancels, Tab still moves focus.
  useEffect(() => {
    if (!capturing) {
      return;
    }
    const root = document.documentElement;
    root.dataset['capturing'] = 'true';
    let lastModifier: {code: string; mod: ModName} | null = null;
    const stop = () => {
      setCapturing(false);
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setCaptureNote('Cancelled.');
        stop();
        captureButton.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        stop();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const mod = modifierOfEvent(event);
      if (mod) {
        lastModifier = {code: event.code, mod};
        return;
      }
      lastModifier = null;
      const code = qmkCodeForEvent(event);
      const value = code === null ? null : ctx.table.valueOf(code);
      if (value === null) {
        setCaptureNote(`The browser does not say which key "${event.key}" is. Find it in the list instead.`);
        stop();
        return;
      }
      const combo = comboKeycode(heldModifiers(event), value);
      onChoose(combo);
      setCaptureNote(null);
      stop();
    };
    const onUp = (event: KeyboardEvent) => {
      // A modifier pressed and let go on its own: that modifier is the key.
      if (lastModifier && event.code === lastModifier.code) {
        event.preventDefault();
        const code = qmkCodeForEvent(event);
        const value = code === null ? null : ctx.table.valueOf(code);
        if (value !== null) {
          onChoose(value);
        }
        stop();
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      delete root.dataset['capturing'];
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [capturing, ctx.table, onChoose]);

  const modName = (mod: ModName) => modifierLabel(mod, os);
  const previewTone: CapTone = 'alpha';

  return (
    <div className="picker">
      <div className="picker-row">
        <label className="search">
          <span className="sr-only">Find a key</span>
          <input
            ref={search}
            type="search"
            placeholder="Find a key: volume, bluetooth, F13…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = results[0];
              if (event.key === 'Enter' && first) {
                event.preventDefault();
                choose(first);
              }
            }}
            data-testid="picker-search"
          />
        </label>
        <button
          ref={captureButton}
          type="button"
          className={`button${capturing ? ' listening' : ''}`}
          onClick={() => {
            setCaptureNote(null);
            setCapturing(!capturing);
          }}
          aria-pressed={capturing}
          data-testid="capture"
        >
          {capturing ? 'Press the key you want…' : 'Press a key'}
        </button>
        <div className="mods" role="group" aria-label="Hold with">
          <span className="mods-label">Hold with</span>
          {MODS.map((mod) => (
            <button
              key={mod}
              type="button"
              className={`chip${mods.includes(mod) ? ' on' : ''}`}
              aria-pressed={mods.includes(mod)}
              onClick={() => setMods(mods.includes(mod) ? mods.filter((entry) => entry !== mod) : [...mods, mod])}
            >
              {modName(mod)}
            </button>
          ))}
        </div>
      </div>
      {(capturing || captureNote) && (
        <p className="picker-note" role="status">
          {capturing ? 'Press a key or a combination like Ctrl + C. Esc cancels. Keys your computer keeps for itself (like the Windows key) are in the list.' : captureNote}
        </p>
      )}
      {mods.length > 0 && (
        <p className="picker-note" role="status">
          Pick a key to hold with {mods.map(modName).join(' + ')}, for example {keycodeName(comboKeycode(mods, 0x06), ctx)}.
        </p>
      )}
      {confirming && (
        <div className="callout danger" role="alert">
          <p>
            <strong>{confirming.name}.</strong> {confirming.danger}
          </p>
          <div className="callout-actions">
            <button type="button" className="button danger" onClick={() => choose(confirming)} data-testid="confirm-danger">
              Put it on this key anyway
            </button>
            <button type="button" className="button quiet" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {query.trim().length === 0 && (
        <div className="categories" role="tablist" aria-label="Kinds of keys">
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === category}
              className={`category${entry.id === category ? ' active' : ''}`}
              onClick={() => setCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      <ul className="picker-grid" aria-label={query ? 'Search results' : 'Keys'}>
        {results.length === 0 && <li className="picker-empty">No key matches "{query}". Try a shorter word.</li>}
        {results.map((item) => (
          <li key={item.value}>
            <button
              type="button"
              className={`pick${item.value === current ? ' current' : ''}${item.danger ? ' danger' : ''}`}
              title={item.danger ? `${item.name}: ${item.danger}` : item.name}
              onClick={() => choose(item)}
              data-testid={`pick-${item.value.toString(16)}`}
            >
              <span className={`mini-cap tone-${previewTone}${item.danger ? ' danger' : ''}`} aria-hidden="true">
                <LegendView art={{legend: item.legend, tone: previewTone, faded: false}} />
              </span>
              <span className="pick-name">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
