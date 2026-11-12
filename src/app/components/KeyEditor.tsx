import {useStore} from '@nanostores/react';
import {useCallback, useMemo} from 'react';
import {keyNoteFor, keycodeDanger, type WriteRecord} from '../../core/index.ts';
import {keycodeName, legendFor} from '../logic/legends.ts';
import {$entryStatuses, $log, setKey, targetLayers, undoEntry, type LogEntry} from '../state/changes.ts';
import {$macroNames, legendContext, physicalKeyName, store, type SessionView} from '../state/session.ts';
import {$alsoPaired, $layer, $selected, setAlsoPaired} from '../state/ui.ts';
import {LegendView} from './FlatBoard.tsx';
import {KeyPicker} from './KeyPicker.tsx';
import {StatusText} from './StatusText.tsx';

const touchesKey = (record: WriteRecord | undefined, layer: number, row: number, col: number) =>
  record?.target.kind === 'key' && record.target.layer === layer && record.target.row === row && record.target.col === col;

export function KeyEditor({session}: {readonly session: SessionView}) {
  const layer = useStore($layer);
  const selected = useStore($selected);
  const alsoPaired = useStore($alsoPaired);
  const log = useStore($log);
  const statuses = useStore($entryStatuses);
  const writes = useStore(store.$writes);
  const macroNames = useStore($macroNames);

  const key = selected === null ? undefined : session.model.byMatrix.get(selected);
  const ctx = useMemo(() => legendContext(session, layer), [session, layer, macroNames]);
  const layerMeta = session.meta.layers[layer];
  const pair = layerMeta?.pair;
  const pairName = pair === undefined ? undefined : session.meta.layers[pair]?.name;

  const onChoose = useCallback(
    (value: number) => {
      if (selected === null) {
        return;
      }
      setKey(selected, value, targetLayers(session, layer, alsoPaired));
    },
    [selected, session, layer, alsoPaired],
  );

  if (!key || selected === null) {
    return (
      <div className="empty-panel">
        <p className="empty-title">Choose a key on the board.</p>
        <p className="muted">
          You are editing <strong>{layerMeta?.name}</strong>. {layerMeta?.fn ? `These keys work while Fn is held.` : ''} With the board focused, the arrow
          keys move between keys and Enter picks one. Press V to switch between 3D and flat.
        </p>
      </div>
    );
  }

  const value = session.keymap[layer]?.[selected] ?? 0;
  const name = physicalKeyName(session, selected);
  const legend = legendFor(value, ctx, {row: key.row, col: key.col});
  const danger = keycodeDanger(value);
  const note = keyNoteFor(session.meta, layer, key.row, key.col);

  // The newest log line that wrote this key on this layer, while it has not been undone.
  const writesById = new Map(writes.map((record) => [record.id, record]));
  const entry: LogEntry | undefined = [...log]
    .reverse()
    .find((candidate) => candidate.writeIds.some((id) => touchesKey(writesById.get(id), layer, key.row, key.col)));
  const status = entry ? statuses.get(entry.id) : undefined;
  const fresh = entry && entry.undoneBy === undefined && Date.now() - entry.at < 120_000;

  return (
    <div className="key-editor">
      <div className="sentence-row">
        <span className={`mini-cap large tone-${key.tone}${danger ? ' danger' : ''}`} aria-hidden="true">
          <LegendView art={{legend, tone: key.tone, faded: false}} />
        </span>
        <div className="sentence" aria-live="polite" data-testid="key-sentence">
          {fresh && entry && status ? (
            <>
              <p className="sentence-text">{status.state === 'failed' ? <>Did not save. {entry.rollbackText}</> : entry.text}</p>
              <p className="sentence-status">
                <StatusText status={status} />
                {status.state === 'saved' && entry.undo && (
                  <button type="button" className="link" onClick={() => undoEntry(entry.id)} data-testid="sentence-undo">
                    Undo
                  </button>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="sentence-text">
                <strong>{name}</strong> on <strong>{layerMeta?.name}</strong> does <strong>{keycodeName(value, ctx)}</strong>.
              </p>
              <p className="sentence-status muted">Pick what it should do instead.</p>
            </>
          )}
        </div>
        <div className="sentence-tools">
          {pairName && (
            <label className="check">
              <input type="checkbox" checked={alsoPaired} onChange={(event) => setAlsoPaired(event.target.checked)} data-testid="also-paired" />
              Also on {pairName}
            </label>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={() => {
              $selected.set(null);
              document.querySelector<HTMLButtonElement>(`[data-matrix="${selected}"]`)?.focus();
            }}
          >
            ×
          </button>
        </div>
      </div>
      {danger && (
        <p className="callout danger">
          <strong>{danger.name}.</strong> {danger.explanation} {layerMeta?.fn ? `It works while Fn is held.` : ''}
        </p>
      )}
      {note && <p className="callout info">{note.text}</p>}
      <KeyPicker ctx={ctx} layerCount={session.info.layerCount} macroCount={session.info.macroCount} current={value} onChoose={onChoose} focusKey={selected} />
    </div>
  );
}
