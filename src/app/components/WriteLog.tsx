import {useStore} from '@nanostores/react';
import {$entryStatuses, $log, undoEntry} from '../state/changes.ts';
import {$logOpen, setLogOpen} from '../state/ui.ts';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'});

/** Every write in this session, newest first, each with its own Undo. Collapses away completely. */
export function WriteLog() {
  const open = useStore($logOpen);
  const log = useStore($log);
  const statuses = useStore($entryStatuses);
  if (!open) {
    return null;
  }
  return (
    <aside className="writelog" aria-label="Changes in this session" data-testid="write-log">
      <header className="writelog-head">
        <h2>Changes</h2>
        <button type="button" className="icon-button" aria-label="Hide changes" title="Hide" onClick={() => setLogOpen(false)}>
          ×
        </button>
      </header>
      {log.length === 0 ? (
        <p className="writelog-empty">
          Each change is saved to the keyboard the moment you make it. Nothing to upload. Every change appears here with an Undo.
        </p>
      ) : (
        <ol className="writelog-list">
          {[...log].reverse().map((entry) => {
            const status = statuses.get(entry.id) ?? {state: 'pending' as const};
            return (
              <li key={entry.id} className={`entry entry-${status.state}${entry.undoneBy !== undefined ? ' undone' : ''}`} data-testid="log-entry" data-state={status.state}>
                <p className="entry-meta">
                  <span className="entry-time">{time(entry.at)}</span>
                  <span className="entry-state">
                    {status.state === 'pending' ? 'Saving…' : status.state === 'saved' ? (entry.undoneBy !== undefined ? 'Undone' : 'Saved to keyboard') : 'Did not save'}
                  </span>
                </p>
                <p className="entry-text">
                  {entry.swatch && <span className="entry-swatch" style={{background: entry.swatch}} aria-hidden="true" />}
                  {entry.text}
                </p>
                {status.state === 'failed' && <p className="entry-fail">{entry.rollbackText}</p>}
                {entry.undo && entry.undoneBy === undefined && status.state === 'saved' && (
                  <button type="button" className="link" onClick={() => undoEntry(entry.id)} data-testid="log-undo">
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
