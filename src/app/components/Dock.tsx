import {useStore} from '@nanostores/react';
import type {KeyboardEvent} from 'react';
import {$session} from '../state/session.ts';
import {$mode, $placing, type Mode} from '../state/ui.ts';
import {KeyEditor} from './KeyEditor.tsx';
import {LightingPanels} from './LightingPanels.tsx';
import {MacroEditor} from './MacroEditor.tsx';
import {SnapshotsPanel} from './SnapshotsPanel.tsx';

const MODES: readonly {readonly id: Mode; readonly label: string}[] = [
  {id: 'keys', label: 'Keys'},
  {id: 'lighting', label: 'Lighting'},
  {id: 'macros', label: 'Macros'},
  {id: 'snapshots', label: 'Snapshots'},
];

export function Dock() {
  const mode = useStore($mode);
  const session = useStore($session);

  const select = (next: Mode) => {
    $placing.set(null);
    $mode.set(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.findIndex((entry) => entry.id === mode);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const next = MODES[(index + step + MODES.length) % MODES.length];
      if (next) {
        select(next.id);
        document.getElementById(`tab-${next.id}`)?.focus();
      }
    }
  };

  if (!session) {
    return null;
  }

  return (
    <section className="dock" id="editor" aria-label="Editor">
      <div className="dock-tabs" role="tablist" aria-label="What to change" onKeyDown={onKeyDown}>
        {MODES.map((entry) => (
          <button
            key={entry.id}
            id={`tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={mode === entry.id}
            aria-controls={`panel-${entry.id}`}
            tabIndex={mode === entry.id ? 0 : -1}
            className={`dock-tab${mode === entry.id ? ' active' : ''}`}
            onClick={() => select(entry.id)}
            data-testid={`tab-${entry.id}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>
        {mode === 'keys' && <KeyEditor session={session} />}
        {mode === 'lighting' && <LightingPanels session={session} />}
        {mode === 'macros' && <MacroEditor session={session} />}
        {mode === 'snapshots' && <SnapshotsPanel session={session} />}
      </div>
    </section>
  );
}
