import {useStore} from '@nanostores/react';
import {useEffect, useState} from 'react';
import {undoLatest} from '../state/changes.ts';
import {$session} from '../state/session.ts';
import {$hint, $logOpen, $mode, $placing, $selected, $typingPreview, showHint, toggleView} from '../state/ui.ts';
import {Dock} from './Dock.tsx';
import {SplitHandle} from './SplitHandle.tsx';
import {Stage} from './Stage.tsx';
import {TopBar} from './TopBar.tsx';
import {WriteLog} from './WriteLog.tsx';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** True while a "press a key" capture or a macro recording owns the keyboard. */
export const isCapturing = () => document.documentElement.dataset['capturing'] === 'true';

/** Phones stack the board and the editor in one scrolling page, so they have no split. */
const useNarrowLayout = () => {
  const query = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return narrow;
};

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
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'v' && !$typingPreview.get()) {
        toggleView();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const session = useStore($session);
  const [main, setMain] = useState<HTMLElement | null>(null);
  const narrow = useNarrowLayout();
  return (
    <div className={`workspace${logOpen ? ' log-open' : ''}${session?.stale ? ' stale' : ''}`}>
      <TopBar />
      <main className="workspace-main" id="main" ref={setMain}>
        <Stage />
        {!narrow && <SplitHandle container={main} />}
        <Dock />
      </main>
      <WriteLog />
      <div className="sr-only" aria-live="polite">
        {hint}
      </div>
    </div>
  );
}
