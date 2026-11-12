import {useRef, useState, type DragEvent} from 'react';
import {errorMessage} from '../../core/index.ts';
import {env} from '../state/env.ts';
import {cancelDefinition, connect, hexId, lookUpPublicDefinition, provideDefinition, type Phase} from '../state/session.ts';
import {Outline} from './Outline.tsx';

const readJson = async (file: File): Promise<unknown> => JSON.parse(await file.text()) as unknown;

export function Landing({phase}: {readonly phase: Phase}) {
  return (
    <main className="landing">
      <Outline />
      <section className="landing-copy" aria-live="polite">
        {phase.name === 'needs-definition' ? <DefinitionDrop phase={phase} /> : <Welcome phase={phase} />}
      </section>
    </main>
  );
}

function Welcome({phase}: {readonly phase: Phase}) {
  const busy = phase.name === 'connecting' || phase.name === 'choosing';
  const supported = env.webHid || env.mock;
  return (
    <>
      <h1 className="landing-title">KeyboardStudio</h1>
      <p className="landing-lede">Change what your keyboard's keys do, its lights and its macros, right here in the browser.</p>
      {supported ? (
        <div className="landing-actions">
          <button type="button" className="button primary large" onClick={() => void connect()} disabled={busy} autoFocus>
            {phase.name === 'choosing' ? 'Choose your keyboard…' : phase.name === 'connecting' ? 'Reading the keyboard…' : env.mock ? 'Connect the demo keyboard' : 'Connect keyboard'}
          </button>
          {!env.mock && (
            <a className="link" href="?mock=1">
              Try the demo keyboard
            </a>
          )}
        </div>
      ) : (
        <div className="landing-actions">
          <p className="callout warning">
            This browser cannot talk to keyboards. Open this page in Chrome or Edge on a computer to change yours.
          </p>
          <a className="button large" href="?mock=1">
            Try the demo keyboard
          </a>
        </div>
      )}
      {phase.name === 'failed' && <p className="callout error">Connecting did not work: {phase.message}</p>}
      {phase.name === 'lost' && <p className="callout warning">{phase.message}. Plug it back in and connect again.</p>}
      <p className="landing-note">
        {env.mock
          ? 'The demo keyboard lives in this page. Nothing is sent to a real keyboard.'
          : 'Plug the keyboard in with its USB cable first. Every change is saved on the keyboard the moment you make it.'}
      </p>
    </>
  );
}

function DefinitionDrop({phase}: {readonly phase: Extract<Phase, {name: 'needs-definition'}>}) {
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = async (file: File | undefined) => {
    setReadError(null);
    if (!file) {
      return;
    }
    try {
      await provideDefinition(await readJson(file));
    } catch (error) {
      setReadError(`That file is not JSON: ${errorMessage(error)}`);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  };

  return (
    <>
      <h1 className="landing-title small">One file to go</h1>
      <p className="landing-lede">
        KeyboardStudio does not know <strong>{phase.productName}</strong> ({hexId(phase.vendorProductId)}) yet. Its maker publishes a VIA file that
        describes its keys and lights. Drop it here and this browser will remember it.
      </p>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        data-testid="definition-drop"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p>Drop the keyboard's VIA JSON file here</p>
        <button type="button" className="button" onClick={() => input.current?.click()}>
          Choose the file…
        </button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => void take(event.target.files?.[0])} />
      </div>
      {(phase.problem ?? readError) && <p className="callout error">{phase.problem ?? readError}</p>}
      <div className="landing-actions">
        <button type="button" className="button" onClick={() => void lookUpPublicDefinition()} disabled={phase.looking === true}>
          {phase.looking ? 'Looking it up…' : 'Look it up on usevia.app'}
        </button>
        <button type="button" className="button quiet" onClick={cancelDefinition}>
          Cancel
        </button>
      </div>
      <p className="landing-note">The lookup asks usevia.app for the file. The file stays in this browser.</p>
    </>
  );
}
