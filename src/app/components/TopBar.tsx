import {useStore} from '@nanostores/react';
import {$lamp, $log} from '../state/changes.ts';
import {$session, disconnect} from '../state/session.ts';
import {$logOpen, setLogOpen} from '../state/ui.ts';

export function TopBar() {
  const session = useStore($session);
  const lamp = useStore($lamp);
  const log = useStore($log);
  const logOpen = useStore($logOpen);
  const transport = session?.info.transportKind === 'mock' ? 'Demo' : 'USB';
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          K
        </span>
        <span className="brand-name">KeyboardStudio</span>
      </div>
      {session && (
        <div className="board-chip">
          <span className="board-name">{session.definition.name}</span>
          <span className="tag">{transport}</span>
        </div>
      )}
      <div className="topbar-spacer" />
      <div className={`lamp lamp-${lamp.state}`} role="status" aria-live="polite" data-testid="lamp" data-state={lamp.state}>
        <span className="lamp-dot" aria-hidden="true" />
        <span className="lamp-text">{lamp.text}</span>
      </div>
      <button type="button" className="button quiet" aria-pressed={logOpen} onClick={() => setLogOpen(!logOpen)} data-testid="log-toggle">
        Changes{log.length > 0 ? ` (${log.length})` : ''}
      </button>
      {session && !session.stale && (
        <button type="button" className="button quiet" onClick={() => void disconnect()}>
          Disconnect
        </button>
      )}
    </header>
  );
}
