import {useStore} from '@nanostores/react';
import {useEffect} from 'react';
import {env} from '../state/env.ts';
import {$phase, $session, connect} from '../state/session.ts';
import {Landing} from './Landing.tsx';
import {Workspace} from './Workspace.tsx';

export default function App() {
  const phase = useStore($phase);
  const session = useStore($session);

  useEffect(() => {
    document.documentElement.dataset['ready'] = 'true';
    // The demo keyboard needs no device chooser, so go straight in.
    if (env.mock && $phase.get().name === 'landing') {
      void connect();
    }
  }, []);

  const showWorkspace = session !== null && (phase.name === 'connected' || phase.name === 'lost' || phase.name === 'connecting' || phase.name === 'failed');
  return showWorkspace ? <Workspace /> : <Landing phase={phase} />;
}
