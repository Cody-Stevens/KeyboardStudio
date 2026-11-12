import {useEffect, useRef, useState} from 'react';
import {SnapshotLibrary, errorMessage, serializeSnapshot, snapshotFileName, type KeyboardSnapshot, type SnapshotSummary} from '../../core/index.ts';
import {describeDiff, diffSnapshot} from '../logic/snapshot-diff.ts';
import {readStateFile, restoreSnapshot, snapshotFromViaFile} from '../state/changes.ts';
import {store, type SessionView} from '../state/session.ts';

const library = new SnapshotLibrary();

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

interface Review {
  readonly label: string;
  readonly snapshot: KeyboardSnapshot;
  /** For an imported file: offer to keep it in the browser too. */
  readonly imported: boolean;
}

export function SnapshotsPanel({session}: {readonly session: SessionView}) {
  const [list, setList] = useState<SnapshotSummary[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{tone: 'info' | 'error'; text: string} | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const vpid = session.definition.vendorProductId;

  const refresh = async () => {
    try {
      setList(await library.list(vpid));
    } catch {
      setList([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, [vpid]);

  const save = async () => {
    try {
      const snapshot = store.exportSnapshot();
      const label = name.trim() || `Snapshot ${new Date().toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}`;
      await library.save(label, snapshot);
      setName('');
      setMessage({tone: 'info', text: `Saved "${label}" in this browser. It holds what the keyboard has now.`});
      await refresh();
    } catch (error) {
      setMessage({tone: 'error', text: `Could not save the snapshot: ${errorMessage(error)}`});
    }
  };

  const openReview = async (summary: SnapshotSummary) => {
    const snapshot = await library.get(summary.id);
    if (snapshot) {
      setReview({label: summary.name, snapshot, imported: false});
      setMessage(null);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const parsed = readStateFile(JSON.parse(await file.text()) as unknown);
      const snapshot = parsed.kind === 'snapshot' ? parsed.snapshot : snapshotFromViaFile(parsed.json);
      setReview({label: file.name.replace(/\.json$/i, ''), snapshot, imported: true});
      setMessage(null);
    } catch (error) {
      setMessage({tone: 'error', text: `That file cannot be used: ${errorMessage(error)}`});
    } finally {
      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  };

  const current = {
    keymap: session.keymap,
    macroBytes: session.macros?.bytes ?? null,
    macroExpressions: session.macros?.expressions ?? [],
    menuValues: session.menuValues,
    layoutOptions: store.$layoutOptions.get(),
  };
  const lightingName = (commandId: string) =>
    session.meta.zones.find((zone) => zone.zone.controls.some((control) => control.commandId === commandId))?.name ?? 'Other';
  const diff = review ? diffSnapshot(review.snapshot, current) : null;
  const sameBoard = review ? review.snapshot.keyboard.vendorProductId === vpid : true;

  const confirmRestore = async () => {
    if (!review) {
      return;
    }
    setBusy(true);
    const error = await restoreSnapshot(review.snapshot, review.label);
    setBusy(false);
    if (error) {
      setMessage({tone: 'error', text: `Restore stopped: ${error}`});
    } else {
      setMessage({tone: 'info', text: `Restored "${review.label}". The changes list shows each write.`});
      setReview(null);
    }
  };

  return (
    <div className="snapshots">
      <div className="snapshot-make">
        <h3>Save a snapshot</h3>
        <p className="muted small">A snapshot keeps every key, macro and light setting the keyboard has now, in this browser.</p>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input type="text" value={name} placeholder="Name, such as Before the trip" aria-label="Snapshot name" onChange={(event) => setName(event.target.value)} data-testid="snapshot-name" />
          <button type="submit" className="button primary" disabled={session.stale} data-testid="snapshot-save">
            Save a snapshot
          </button>
        </form>
        <div className="row">
          <button type="button" className="button" onClick={() => download(snapshotFileName(store.exportSnapshot()), serializeSnapshot(store.exportSnapshot()))} disabled={session.stale}>
            Export to a file
          </button>
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={session.stale}>
            Import a file…
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} data-testid="snapshot-file" />
        </div>
        <p className="muted small">Import takes KeyboardStudio snapshots and VIA layout files.</p>
        {message && <p className={`callout ${message.tone}`} role="status">{message.text}</p>}
      </div>

      <div className="snapshot-list">
        {review && diff ? (
          <div className="review" role="region" aria-label="Restore review" data-testid="restore-review">
            <h3>Restore "{review.label}"?</h3>
            {!sameBoard ? (
              <p className="callout error">This snapshot is for {review.snapshot.keyboard.name}, a different keyboard. It cannot be restored here.</p>
            ) : diff.isEmpty ? (
              <p className="muted">The keyboard already matches this snapshot. Nothing would change.</p>
            ) : (
              <>
                <p>Restoring writes these to the keyboard:</p>
                <ul className="diff-list" data-testid="restore-diff">
                  {describeDiff(diff, (layer) => session.meta.layers[layer]?.name ?? `Layer ${layer}`, lightingName).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="muted small">Everything else stays as it is. You can undo the restore from the changes list.</p>
              </>
            )}
            <div className="row">
              {sameBoard && !diff.isEmpty && (
                <button type="button" className="button primary" disabled={busy || session.stale} onClick={() => void confirmRestore()} data-testid="restore-confirm">
                  {busy ? 'Restoring…' : 'Restore these changes'}
                </button>
              )}
              {review.imported && sameBoard && (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void library.save(review.label, review.snapshot).then(() => {
                      setMessage({tone: 'info', text: `Kept "${review.label}" in this browser.`});
                      return refresh();
                    })
                  }
                >
                  Keep in this browser
                </button>
              )}
              <button type="button" className="button quiet" onClick={() => setReview(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <div className="empty-panel">
            <p className="empty-title">No snapshots yet.</p>
            <p className="muted">Save one before a big change, so you can go back to it in one step.</p>
          </div>
        ) : (
          <ul className="snapshot-items" data-testid="snapshot-list">
            {list.map((summary) => (
              <li key={summary.id} className="snapshot-item">
                <div>
                  <p className="snapshot-name">{summary.name}</p>
                  <p className="muted small">{formatDate(summary.savedAt)}</p>
                </div>
                <div className="row">
                  <button type="button" className="button" onClick={() => void openReview(summary)} disabled={session.stale} data-testid="snapshot-restore">
                    Restore…
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() =>
                      void library.get(summary.id).then((snapshot) => {
                        if (snapshot) {
                          download(snapshotFileName(snapshot), serializeSnapshot(snapshot));
                        }
                      })
                    }
                  >
                    Export
                  </button>
                  <button type="button" className="button quiet" onClick={() => void library.remove(summary.id).then(refresh)} aria-label={`Delete ${summary.name}`}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
