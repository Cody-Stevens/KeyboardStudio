import {useStore} from '@nanostores/react';
import {useEffect, useMemo, useState} from 'react';
import type {BoardPart} from '../../core/index.ts';
import {keycodeDanger} from '../../core/index.ts';
import {canUseWebGl} from '../scene/webgl.ts';
import {keyArts} from '../state/arts.ts';
import {saveMacro, targetLayers} from '../state/changes.ts';
import {env} from '../state/env.ts';
import {$hasShownBoard, $macroNames, $phase, $session, physicalKeyName, reconnect} from '../state/session.ts';
import {
  $alsoPaired,
  $flatReason,
  $focusedKey,
  $focusedPart,
  $hint,
  $hoveredPart,
  $layer,
  $mode,
  $placing,
  $pressPulse,
  $selected,
  $viewChoice,
  pulseKey,
  setView,
  showHint,
} from '../state/ui.ts';
import {Board3D} from './Board3D.tsx';
import {FlatBoard} from './FlatBoard.tsx';

type ThreeState = 'loading' | 'ready' | 'unavailable';

const useNarrow = () => {
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

export function Stage() {
  const session = useStore($session);
  const phase = useStore($phase);
  const layer = useStore($layer);
  const mode = useStore($mode);
  const selected = useStore($selected);
  const focusedKey = useStore($focusedKey);
  const pulse = useStore($pressPulse);
  const viewChoice = useStore($viewChoice);
  const flatReason = useStore($flatReason);
  const placing = useStore($placing);
  const hoveredPart = useStore($hoveredPart);
  const focusedPart = useStore($focusedPart);
  const hint = useStore($hint);
  const macroNames = useStore($macroNames);
  const narrow = useNarrow();
  const [threeState, setThreeState] = useState<ThreeState>(() => (env.noWebGl || !canUseWebGl() ? 'unavailable' : 'loading'));
  const [settledFlat, setSettledFlat] = useState(viewChoice === 'flat');
  const [intro] = useState(() => !$hasShownBoard.get());

  useEffect(() => {
    $hasShownBoard.set(true);
    if (threeState === 'unavailable') {
      $flatReason.set('no-webgl');
    }
  }, [threeState]);

  const arts = useMemo(() => (session ? keyArts(session, layer) : []), [session, layer, macroNames]);

  if (!session) {
    return null;
  }

  const can3d = threeState !== 'unavailable' && !narrow && flatReason !== 'slow' && flatReason !== 'load-failed' && flatReason !== 'no-webgl';
  const want3d = can3d && viewChoice === '3d';
  const domVisible = threeState !== 'ready' || !can3d || (!want3d && settledFlat);
  const layerMeta = session.meta.layers[layer];
  const baseName = layerMeta?.base !== undefined ? session.meta.layers[layerMeta.base]?.name : undefined;
  const hasDanger = session.model.keys.some((key) => keycodeDanger(session.keymap[layer]?.[key.matrix] ?? 0) !== null);
  const highlight: BoardPart | null = mode === 'lighting' ? (hoveredPart ?? focusedPart) : null;

  const onPick = (matrix: number) => {
    if (session.stale) {
      showHint('Reconnect the keyboard to make changes.');
      return;
    }
    const current = $placing.get();
    if (current) {
      const error = saveMacro(current.index, current.name, current.expression, {matrix, layers: targetLayers(session, layer, $alsoPaired.get())});
      if (error) {
        showHint(error);
      }
      $placing.set(null);
      return;
    }
    if ($mode.get() === 'lighting') {
      $focusedPart.set('backlight');
      return;
    }
    if ($mode.get() !== 'keys') {
      $mode.set('keys');
    }
    $selected.set(matrix);
    pulseKey(matrix);
  };

  const onPartClick = (part: BoardPart) => {
    $mode.set('lighting');
    $focusedPart.set(part);
  };

  return (
    <section className={`stage${placing ? ' placing' : ''}`} aria-label="Keyboard">
      <div className="stage-top">
        {(mode === 'keys' || mode === 'macros') && (
          <div className="layer-tabs" role="radiogroup" aria-label="Layer to edit">
            {session.meta.layers.map((meta) => (
              <button
                key={meta.index}
                type="button"
                role="radio"
                aria-checked={meta.index === layer}
                className={`layer-tab${meta.index === layer ? ' active' : ''}`}
                onClick={() => $layer.set(meta.index)}
                data-testid={`layer-${meta.index}`}
              >
                {meta.name}
              </button>
            ))}
          </div>
        )}
        {mode === 'lighting' && <p className="stage-caption">Your keyboard shows every change as you make it. The model follows.</p>}
        <div className="stage-spacer" />
        {!narrow && threeState !== 'unavailable' && (
          <div className="view-toggle" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={want3d} className={want3d ? 'active' : ''} onClick={() => {
              $flatReason.set(null);
              setView('3d');
            }} title="3D view (V)" data-testid="view-3d">
              3D
            </button>
            <button type="button" role="radio" aria-checked={!want3d} className={!want3d ? 'active' : ''} onClick={() => setView('flat')} title="Flat view (V)" data-testid="view-flat">
              Flat
            </button>
          </div>
        )}
      </div>

      <div className="board-area">
        {threeState !== 'unavailable' && !narrow && flatReason !== 'load-failed' && (
          <Board3D
            session={session}
            arts={arts}
            layer={layer}
            selected={selected}
            focused={focusedKey}
            pulse={pulse}
            flat={!want3d}
            visible={!domVisible}
            intro={intro}
            reducedMotion={env.reducedMotion}
            highlightPart={highlight}
            onReady={() => setThreeState('ready')}
            onFail={() => {
              setThreeState('unavailable');
              $flatReason.set('load-failed');
            }}
            onSlow={() => $flatReason.set('slow')}
            onSettled={(isFlat) => setSettledFlat(isFlat)}
            onKeyClick={onPick}
            onPartClick={onPartClick}
            onHoverPart={(part) => $hoveredPart.set(part)}
          />
        )}
        <div className={`flat-wrap${domVisible ? ' shown' : ''}`}>
          <FlatBoard
            model={session.model}
            arts={arts}
            selected={selected}
            pulse={pulse}
            hidden={!domVisible}
            label={`Keys on ${layerMeta?.name ?? `layer ${layer}`}`}
            names={(matrix) => physicalKeyName(session, matrix)}
            onPick={onPick}
            onFocusKey={(matrix) => $focusedKey.set(matrix)}
            disabled={session.stale}
          />
        </div>
        {!domVisible && focusedKey !== null && (
          <p className="focus-label" aria-hidden="true">
            {physicalKeyName(session, focusedKey)}. Enter to change it.
          </p>
        )}
      </div>

      <div className="stage-bottom">
        {placing ? (
          <p className="stage-note strong" role="status">
            Click the key that should play <strong>{placing.name}</strong> on {layerMeta?.name}. Esc cancels.
          </p>
        ) : hint ? (
          <p className="stage-note" role="status">
            {hint}
          </p>
        ) : (
          <>
            {mode === 'keys' && selected === null && <p className="stage-note">Click a key to change what it does on {layerMeta?.name}.</p>}
            {mode === 'keys' && baseName && <p className="stage-note">Faded keys do the same as on {baseName}.</p>}
            {(mode === 'keys' || mode === 'macros') && hasDanger && (
              <p className="stage-note danger-note">
                <span className="danger-swatch" aria-hidden="true" /> Red keys reset or restart the keyboard.
              </p>
            )}
          </>
        )}
        {flatReason === 'slow' && (
          <p className="stage-note">
            3D ran slowly on this computer, so the flat board is shown.{' '}
            <button type="button" className="link" onClick={() => $flatReason.set(null)}>
              Try 3D again
            </button>
          </p>
        )}
        {flatReason === 'no-webgl' && !narrow && <p className="stage-note">This browser cannot draw 3D, so the flat board is shown.</p>}
      </div>

      {phase.name === 'lost' && (
        <div className="lost-banner" role="alert">
          <p>
            <strong>The keyboard was disconnected.</strong> Everything marked saved is on the keyboard. Plug it back in to keep going.
          </p>
          <button type="button" className="button primary" onClick={() => void reconnect()}>
            Reconnect
          </button>
        </div>
      )}
    </section>
  );
}
