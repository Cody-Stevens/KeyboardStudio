import {useStore} from '@nanostores/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {keycodeName, modifierLabel, type ModName} from '../logic/legends.ts';
import {appendText, describeStep, expressionFromSteps, recordKeyPress, stepsFromExpression, type MacroStep} from '../logic/macro-steps.ts';
import {clearMacro, macroBudget, macroDisplayName, saveMacro} from '../state/changes.ts';
import {$macroNames, legendContext, physicalKeyName, type SessionView} from '../state/session.ts';
import {$layer, $macroSlot, $placing} from '../state/ui.ts';

const PAUSES = [100, 250, 500, 1000] as const;

export function MacroEditor({session}: {readonly session: SessionView}) {
  const slot = useStore($macroSlot);
  const names = useStore($macroNames);
  const layer = useStore($layer);
  const placing = useStore($placing);
  const macros = session.macros;
  const count = session.info.macroCount;
  const savedExpression = macros?.expressions[slot] ?? '';
  const [steps, setSteps] = useState<MacroStep[]>(() => stepsFromExpression(savedExpression));
  const [name, setName] = useState(names[slot] ?? '');
  const [dirty, setDirty] = useState(false);
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Load the slot from the keyboard when it changes, unless the user is mid-edit.
  useEffect(() => {
    setSteps(stepsFromExpression(savedExpression));
    setName(names[slot] ?? '');
    setDirty(false);
    setMessage(null);
    setRecording(false);
    // Only on slot changes; keyboard updates are handled below.
  }, [slot]);
  useEffect(() => {
    if (!dirty) {
      setSteps(stepsFromExpression(savedExpression));
    }
  }, [savedExpression]);

  const usage = useMemo(() => {
    const map = new Map<number, {layer: number; matrix: number}[]>();
    for (let index = 0; index < count; index++) {
      const value = session.table.valueOf(`MACRO(${index})`);
      const places: {layer: number; matrix: number}[] = [];
      session.keymap.forEach((keys, keyLayer) =>
        keys.forEach((keycode, matrix) => {
          if (keycode === value && session.model.byMatrix.has(matrix)) {
            places.push({layer: keyLayer, matrix});
          }
        }),
      );
      map.set(index, places);
    }
    return map;
  }, [session, count]);

  const expression = expressionFromSteps(steps);
  const budget = macroBudget(session, slot, expression);
  const free = budget.size - budget.used;
  const ctx = legendContext(session, 0);
  const MOD_CODES: Readonly<Record<string, ModName>> = {CTL: 'ctrl', SFT: 'shift', ALT: 'alt', GUI: 'gui'};
  const keyName = (code: string) => {
    // In a shortcut, "Ctrl + Shift + T" reads better than "Left Ctrl + Left Shift + T".
    const modifier = /^KC_[LR](CTL|SFT|ALT|GUI)$/.exec(code)?.[1];
    const mod = modifier ? MOD_CODES[modifier] : undefined;
    if (mod) {
      return modifierLabel(mod, 'any');
    }
    const value = session.table.valueOf(code);
    return value === null ? code : keycodeName(value, ctx);
  };

  // Recording: every key press becomes a step. Escape stops; Tab stops and moves focus.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const root = document.documentElement;
    root.dataset['capturing'] = 'true';
    const onDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setRecording(false);
        recordButton.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        setRecording(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const result = recordKeyPress(stepsRef.current, event);
      if (result.kind === 'added') {
        // Key presses can arrive faster than renders; keep the ref current.
        stepsRef.current = result.steps;
        setSteps(result.steps);
        setDirty(true);
      } else if (result.kind === 'unsupported') {
        setMessage(`"${result.key}" cannot be recorded. Skipped it.`);
      }
    };
    window.addEventListener('keydown', onDown, true);
    return () => {
      delete root.dataset['capturing'];
      window.removeEventListener('keydown', onDown, true);
    };
  }, [recording]);

  const edit = (next: MacroStep[]) => {
    setSteps(next);
    setDirty(true);
    setMessage(null);
  };

  const displayName = name.trim() || macroDisplayName(slot, []);
  const places = usage.get(slot) ?? [];
  const canSave = steps.length > 0 && !budget.error && free >= 0 && !session.stale;

  const startPlacing = () => {
    if (!canSave) {
      return;
    }
    setRecording(false);
    $placing.set({index: slot, name: displayName, expression});
    setDirty(false);
  };

  const saveOnly = () => {
    setRecording(false);
    const error = saveMacro(slot, name, expression);
    setMessage(error);
    if (!error) {
      setDirty(false);
    }
  };

  return (
    <div className="macros">
      <div className="macro-slots" role="listbox" aria-label="Macros" aria-activedescendant={`macro-slot-${slot}`}>
        {Array.from({length: count}, (_, index) => {
          const filled = (macros?.expressions[index] ?? '').length > 0;
          const used = (usage.get(index) ?? []).length > 0;
          return (
            <button
              key={index}
              id={`macro-slot-${index}`}
              type="button"
              role="option"
              aria-selected={index === slot}
              className={`macro-cap${index === slot ? ' active' : ''}${filled ? ' filled' : ''}${filled && !used ? ' orphan' : ''}`}
              onClick={() => $macroSlot.set(index)}
              title={filled && !used ? 'Saved, but not on any key' : undefined}
              data-testid={`macro-slot-${index}`}
            >
              <span className="macro-cap-name">{filled ? macroDisplayName(index, names) : index + 1}</span>
              {filled && !used && <span className="macro-flag">Not on a key</span>}
            </button>
          );
        })}
      </div>

      <div className="macro-edit">
        <div className="macro-head">
          <label className="field inline">
            <span className="field-label">Name on the key</span>
            <input
              type="text"
              value={name}
              maxLength={12}
              placeholder={`Macro ${slot + 1}`}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
              data-testid="macro-name"
            />
          </label>
          <p className="muted small macro-where">
            {places.length > 0
              ? `Plays on ${places.map((place) => `${physicalKeyName(session, place.matrix)} (${session.meta.layers[place.layer]?.name ?? place.layer})`).join(', ')}.`
              : (macros?.expressions[slot] ?? '').length > 0
                ? 'Saved on the keyboard, but not on any key yet.'
                : 'Empty.'}
          </p>
        </div>

        <ol className="steps" aria-label="Steps" data-testid="macro-steps">
          {steps.length === 0 && <li className="muted">No steps yet. Record, or add text and pauses.</li>}
          {steps.map((step, index) => {
            const words = describeStep(step, keyName);
            return (
              <li key={`${index}-${step.type}`} className={`step step-${step.type}`}>
                <span className="step-verb">{words.verb}</span> <span className="step-what">{words.what}</span>
                <button type="button" className="step-remove" aria-label={`Remove step ${index + 1}`} onClick={() => edit(steps.filter((_, idx) => idx !== index))}>
                  ×
                </button>
              </li>
            );
          })}
          {recording && <li className="step recording-cursor">Listening…</li>}
        </ol>

        <div className="macro-tools">
          <button
            ref={recordButton}
            type="button"
            className={`button${recording ? ' listening' : ''}`}
            aria-pressed={recording}
            onClick={() => setRecording(!recording)}
            data-testid="macro-record"
          >
            <span className="rec-dot" aria-hidden="true" />
            {recording ? 'Stop recording' : 'Record'}
          </button>
          <form
            className="add-text"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.length > 0) {
                edit(appendText(steps, text));
                setText('');
              }
            }}
          >
            <input type="text" value={text} placeholder="Text to type" aria-label="Text to type" onChange={(event) => setText(event.target.value)} data-testid="macro-text" />
            <button type="submit" className="button">
              Add text
            </button>
          </form>
          <label className="add-pause">
            <span className="sr-only">Add a pause</span>
            <select
              value=""
              onChange={(event) => {
                const ms = Number(event.target.value);
                if (ms > 0) {
                  edit([...steps, {type: 'delay', ms}]);
                }
              }}
            >
              <option value="">Add a pause…</option>
              {PAUSES.map((ms) => (
                <option key={ms} value={ms}>
                  {ms} ms
                </option>
              ))}
            </select>
          </label>
        </div>
        {recording && <p className="picker-note">Type on your keyboard. Shortcuts like Ctrl + Shift + T become one step. Esc stops.</p>}
        {message && <p className="callout error">{message}</p>}
        {budget.error && steps.length > 0 && <p className="callout error">{budget.error}</p>}

        <div className="macro-foot">
          <p className={`budget${free < 0 ? ' over' : ''}`} data-testid="macro-budget">
            <span className="budget-bar" aria-hidden="true">
              <span style={{width: `${Math.min(100, (budget.used / Math.max(1, budget.size)) * 100)}%`}} />
            </span>
            {free >= 0 ? `${free} of ${budget.size} bytes free on the keyboard` : `${-free} bytes too many: the keyboard holds ${budget.size}`}
          </p>
          <div className="macro-actions">
            {(macros?.expressions[slot] ?? '').length > 0 && (
              <button type="button" className="button quiet" onClick={() => clearMacro(slot)} disabled={session.stale}>
                Empty this macro
              </button>
            )}
            <button type="button" className="button" onClick={saveOnly} disabled={!canSave} data-testid="macro-save-only">
              Save without a key
            </button>
            <button type="button" className="button primary" onClick={startPlacing} disabled={!canSave || placing !== null} data-testid="macro-save-place">
              Save and put on a key
            </button>
          </div>
        </div>
        {placing && <p className="picker-note strong">Now click a key on the board ({session.meta.layers[layer]?.name}). Esc cancels.</p>}
      </div>
    </div>
  );
}
