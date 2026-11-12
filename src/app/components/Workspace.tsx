import {useStore} from '@nanostores/react';
import {useEffect} from 'react';
import {undoLatest} from '../state/changes.ts';
import {$session} from '../state/session.ts';
import {$hint, $logOpen, $mode, $placing, $selected, showHint, toggleView} from '../state/ui.ts';
import {Dock} from './Dock.tsx';
import {Stage} from './Stage.tsx';
import {TopBar} from './TopBar.tsx';
import {WriteLog} from './WriteLog.tsx';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** True while a "press a key" capture or a macro recording owns the keyboard. */
export const isCapturing = () => document.documentElement.dataset['capturing'] === 'true';

export function Workspace() {
  const logOpen = useStore($logOpen);
  const hint = useStore($hint);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCapturing() || event.defaultPrevented) {
        return;
      }
      if (event.key === 'Escape') {
        if ($placing.get()) {
          $placing.set(null);
          showHint('Cancelled. The macro was not saved.');
          event.preventDefault();
        } else if ($selected.get() !== null && $mode.get() === 'keys') {
          $selected.set(null);
          event.preventDefault();
        }
        return;
      }
      if (isTyping(event.target)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (undoLatest()) {
          event.preventDefault();
        }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'v') {
        toggleView();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const session = useStore($session);
  return (
    <div className={`workspace${logOpen ? ' log-open' : ''}${session?.stale ? ' stale' : ''}`}>
      <TopBar />
      <main className="workspace-main" id="main">
        <Stage />
        <Dock />
      </main>
      <WriteLog />
      <div className="sr-only" aria-live="polite">
        {hint}
      </div>
    </div>
  );
}
