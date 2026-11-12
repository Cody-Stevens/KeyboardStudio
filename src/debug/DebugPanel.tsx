/**
 * Plain debug UI for the core. It prints state as text and offers a few
 * write controls. The designed UI will replace it.
 */
import {useStore} from '@nanostores/react';
import {useEffect, useMemo, useState, type SubmitEvent, type ReactNode} from 'react';
import {
  SnapshotLibrary,
  createKeyboardStore,
  createLinky87Mock,
  decodeControlValue,
  errorMessage,
  getMenuZones,
  isWebHidSupported,
  parseSnapshot,
  preloadDefinitionParser,
  requestWebHidKeyboard,
  serializeSnapshot,
  snapshotFileName,
  visibleControls,
  type ControlInput,
  type MenuControl,
  type SnapshotSummary,
  type WriteRecord,
} from '../core/index.ts';

const params = new URLSearchParams(window.location.search);
const useMock = params.get('mock') === '1';
const mockLatency = Number(params.get('latency') ?? 0);
const mockFailRate = Number(params.get('fail') ?? 0);
const WRITE_COMMANDS = new Set([0x03, 0x05, 0x07, 0x09, 0x0f, 0x10, 0x13]);

const store = createKeyboardStore();
preloadDefinitionParser();
const library = new SnapshotLibrary();

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const readJsonFile = async (file: File): Promise<unknown> => JSON.parse(await file.text());

const describeTarget = (record: WriteRecord): string => {
  const {target} = record;
  switch (target.kind) {
    case 'key':
      return `key L${target.layer} R${target.row} C${target.col}`;
    case 'keymap':
      return `keymap (${target.keys} keys)`;
    case 'menu':
      return target.commandId;
    case 'macros':
      return 'macros';
    case 'layout-options':
      return 'layout options';
    default:
      return 'unknown';
  }
};

export default function DebugPanel() {
  const connection = useStore(store.$connection);
  const definition = useStore(store.$definition);
  const keymap = useStore(store.$keymap);
  const menuValues = useStore(store.$menuValues);
  const macros = useStore(store.$macros);
  const layoutChoices = useStore(store.$layoutChoices);
  const keycodes = useStore(store.$keycodes);
  const writes = useStore(store.$writes);
  const targetStatus = useStore(store.$targetStatus);
  const [allowWrites, setAllowWrites] = useState(useMock);
  const [message, setMessage] = useState<string>('');
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);

  const run = async (label: string, action: () => Promise<unknown> | unknown) => {
    setMessage(`${label}…`);
    try {
      await action();
      setMessage(`${label}: done`);
    } catch (error) {
      setMessage(`${label}: ${errorMessage(error)}`);
    }
  };

  const refreshLibrary = () => run('List snapshots', async () => setSnapshots(await library.list()));

  const connect = () =>
    run('Connect', async () => {
      if (useMock) {
        const transport = createLinky87Mock({
          latency: mockLatency,
          ...(mockFailRate > 0
            ? {failures: [{mode: 'send-error', match: (r: Uint8Array) => WRITE_COMMANDS.has(r[0] ?? 0) && Math.random() < mockFailRate}]}
            : {}),
        });
        await store.connect(transport, {readOnly: !allowWrites});
      } else {
        const transport = await requestWebHidKeyboard();
        if (!transport) {
          throw new Error('No keyboard selected');
        }
        await store.connect(transport, {readOnly: !allowWrites});
      }
      await refreshLibrary();
    });

  // With ?mock=1 there is no device picker, so connect straight away.
  useEffect(() => {
    if (useMock && store.$connection.get().status === 'disconnected') {
      void connect();
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zones = useMemo(() => (definition ? getMenuZones(definition) : []), [definition]);
  const visible = useMemo(
    () => new Set(definition ? visibleControls(definition, menuValues).map((control) => control.commandId) : []),
    [definition, menuValues],
  );

  return (
    <div>
      <section>
        <h2>Connection</h2>
        <p>
          Mode: <strong>{useMock ? 'mock Linky87' : 'WebHID'}</strong>
          {!useMock && !isWebHidSupported() && ' (this browser has no WebHID; use Chrome or Edge, or add ?mock=1)'}
        </p>
        <label>
          <input type="checkbox" checked={allowWrites} disabled={connection.status === 'connected'} onChange={(e) => setAllowWrites(e.target.checked)} />{' '}
          Allow writes {useMock ? '' : '(off by default: a real keyboard will be changed)'}
        </label>{' '}
        <button type="button" onClick={connect} disabled={connection.status === 'connecting'}>
          Connect
        </button>{' '}
        <button type="button" onClick={() => run('Refresh', store.refresh)} disabled={connection.status !== 'connected'}>
          Re-read
        </button>{' '}
        <button type="button" onClick={() => run('Disconnect', store.disconnect)} disabled={connection.status !== 'connected'}>
          Disconnect
        </button>
        <pre>{JSON.stringify(connection, null, 2)}</pre>
        {message && <p>{message}</p>}
      </section>

      {definition && (
        <section>
          <h2>Definition</h2>
          <pre>
            {`${definition.name} (${definition.format}, ${definition.source}) vendorProductId ${definition.vendorProductId}\n` +
              `matrix ${definition.matrix.rows}x${definition.matrix.cols}, ${definition.layout.keys.length} fixed keys, ` +
              `layout ${definition.layout.width}x${definition.layout.height} units\n` +
              `layout options: ${definition.layout.options.map((o) => `${o.label}=${o.choices[layoutChoices?.[o.index] ?? 0]}`).join(', ') || 'none'}\n` +
              `custom keycodes: ${definition.customKeycodes.length}`}
          </pre>
          {definition.layout.options.map((option) => (
            <label key={option.index}>
              {option.label}:{' '}
              <select
                value={layoutChoices?.[option.index] ?? 0}
                onChange={(e) => {
                  const next = [...(layoutChoices ?? [])];
                  next[option.index] = Number(e.target.value);
                  void run('Set layout option', () => store.setLayoutChoices(next).done);
                }}
              >
                {option.choices.map((choice, idx) => (
                  <option key={choice} value={idx}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p>
            Sideload a definition JSON (kept in this browser):{' '}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void run('Sideload definition', async () => {
                    const parsed = await store.registry.sideload(await readJsonFile(file));
                    setMessage(`Sideloaded ${parsed.name}. Reconnect to use it.`);
                  });
                }
              }}
            />
          </p>
        </section>
      )}

      {keymap && definition && keycodes && (
        <section>
          <h2>Keymap</h2>
          <p>
            Codes per matrix position. <span className="pending">*</span> pending, <span className="failed">!</span> failed.
          </p>
          {keymap.map((layer, layerIdx) => (
            <details key={layerIdx} open={layerIdx === 0}>
              <summary>Layer {layerIdx}</summary>
              <pre>
                {Array.from({length: definition.matrix.rows}, (_, row) =>
                  Array.from({length: definition.matrix.cols}, (_, col) => {
                    const value = layer[row * definition.matrix.cols + col] ?? 0;
                    const status = targetStatus[`key:${layerIdx}:${row}:${col}`]?.state;
                    const mark = status === 'pending' ? '*' : status === 'failed' ? '!' : ' ';
                    return `${keycodes.codeOf(value)}${mark}`.padEnd(12);
                  }).join(''),
                ).join('\n')}
              </pre>
            </details>
          ))}
          <KeycodeForm layerCount={keymap.length} rows={definition.matrix.rows} cols={definition.matrix.cols} onSubmit={run} />
        </section>
      )}

      {definition && zones.length > 0 && (
        <section>
          <h2>Lighting</h2>
          {zones.map((zone) => (
            <div key={zone.id}>
              <h3>
                {zone.menuLabel} / {zone.label} (channel {zone.channels.join(', ')})
              </h3>
              <table>
                <tbody>
                  {zone.controls.map((control) => (
                    <ControlRow
                      key={control.commandId}
                      control={control}
                      bytes={menuValues[control.commandId]}
                      visible={visible.has(control.commandId)}
                      status={targetStatus[`menu:${control.commandId}`]?.state}
                      onSubmit={run}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {macros && (
        <section>
          <h2>Macros</h2>
          <p>
            {macros.count} slots, {macros.bytesUsed} of {macros.bufferSize} bytes used
            {macros.decodeError && ` (decode error: ${macros.decodeError})`}. Status:{' '}
            <span className={targetStatus['macros']?.state}>{targetStatus['macros']?.state ?? 'unchanged'}</span>
          </p>
          <pre>{macros.expressions.map((expression, idx) => `M${idx}: ${expression}`).join('\n')}</pre>
          <MacroForm count={macros.count} onSubmit={run} />
        </section>
      )}

      {connection.status === 'connected' && (
        <section>
          <h2>Snapshots</h2>
          <button type="button" onClick={() => run('Export', () => {
            const snapshot = store.exportSnapshot();
            download(snapshotFileName(snapshot), serializeSnapshot(snapshot));
          })}>
            Export to file
          </button>{' '}
          <label>
            Restore from file:{' '}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void run('Restore file', async () => {
                    const json = await readJsonFile(file);
                    const result =
                      typeof json === 'object' && json !== null && 'layers' in json
                        ? await store.importViaLayoutFile(json)
                        : await store.restoreSnapshot(parseSnapshot(json));
                    if (!result.ok) {
                      throw new Error('Some writes failed; see the write log');
                    }
                  });
                }
              }}
            />
          </label>{' '}
          <button type="button" onClick={() => run('Save snapshot', async () => {
            await library.save(`Snapshot ${new Date().toLocaleString()}`, store.exportSnapshot());
            setSnapshots(await library.list());
          })}>
            Save in browser
          </button>
          <ul>
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                {snapshot.name} ({snapshot.savedAt}){' '}
                <button type="button" onClick={() => run('Restore snapshot', async () => {
                  const stored = await library.get(snapshot.id);
                  if (stored) {
                    await store.restoreSnapshot(stored);
                  }
                })}>
                  Restore
                </button>{' '}
                <button type="button" onClick={() => run('Delete snapshot', async () => {
                  await library.remove(snapshot.id);
                  setSnapshots(await library.list());
                })}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {writes.length > 0 && (
        <section>
          <h2>Write log</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Target</th>
                <th>State</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {[...writes].reverse().slice(0, 30).map((record) => (
                <tr key={record.id}>
                  <td>{record.id}</td>
                  <td>{describeTarget(record)}</td>
                  <td className={record.state}>{record.state}</td>
                  <td>
                    {record.error ?? ''}
                    {record.verified === true && ' (re-read from keyboard)'}
                    {record.verified === false && ' (could not re-read)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

type Runner = (label: string, action: () => Promise<unknown> | unknown) => Promise<void>;

function KeycodeForm({layerCount, rows, cols, onSubmit}: {layerCount: number; rows: number; cols: number; onSubmit: Runner}) {
  const [layer, setLayer] = useState(0);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);
  const [code, setCode] = useState('KC_A');
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void onSubmit('Set keycode', async () => {
      const table = store.$keycodes.get();
      const value = table?.valueOf(code);
      if (value === null || value === undefined) {
        throw new Error(`Unknown keycode ${code}`);
      }
      const record = await store.setKeycode(layer, row, col, value).done;
      if (record.state === 'failed') {
        throw new Error(record.error);
      }
    });
  };
  const numberInput = (value: number, set: (n: number) => void, max: number) => (
    <input type="number" min={0} max={max - 1} value={value} onChange={(e) => set(Number(e.target.value))} style={{width: '4em'}} />
  );
  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend>Set a keycode</legend>
        Layer {numberInput(layer, setLayer, layerCount)} Row {numberInput(row, setRow, rows)} Col {numberInput(col, setCol, cols)} Code{' '}
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="KC_A, MO(1), LCTL(KC_C)" />{' '}
        <button type="submit">Write</button>
      </fieldset>
    </form>
  );
}

function ControlRow({
  control,
  bytes,
  visible,
  status,
  onSubmit,
}: {
  control: MenuControl;
  bytes: readonly number[] | undefined;
  visible: boolean;
  status: string | undefined;
  onSubmit: Runner;
}) {
  const decoded = bytes ? decodeControlValue(control, bytes) : undefined;
  const [draft, setDraft] = useState('');
  let shown: ReactNode = 'not read';
  if (decoded) {
    switch (decoded.type) {
      case 'range':
        shown = `${decoded.value} (range ${control.range?.join('-')})${control.range && decoded.value > control.range[1] ? ' above range' : ''}`;
        break;
      case 'dropdown':
        shown = `${decoded.value} ${decoded.label ?? '(unknown option)'}`;
        break;
      case 'color':
        shown = `hue ${decoded.hue}, sat ${decoded.sat}`;
        break;
      case 'toggle':
        shown = decoded.value ? 'on' : 'off';
        break;
      default:
        shown = JSON.stringify(decoded);
    }
  }
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void onSubmit(`Set ${control.label}`, async () => {
      const numbers = draft.split(/[\s,]+/).filter(Boolean).map(Number);
      let input: ControlInput;
      switch (control.type) {
        case 'range':
          input = {type: 'range', value: numbers[0] ?? 0};
          break;
        case 'dropdown':
          input = {type: 'dropdown', value: numbers[0] ?? 0};
          break;
        case 'color':
          input = {type: 'color', hue: numbers[0] ?? 0, sat: numbers[1] ?? 255};
          break;
        case 'toggle':
          input = {type: 'toggle', value: (numbers[0] ?? 0) !== 0};
          break;
        default:
          throw new Error(`Editing ${control.type} controls is not supported here`);
      }
      const record = await store.setMenuValue(control.commandId, input).done;
      if (record.state === 'failed') {
        throw new Error(record.error);
      }
    });
  };
  return (
    <tr style={{opacity: visible ? 1 : 0.5}}>
      <td>{control.label}</td>
      <td>
        <code>{control.commandId}</code>
      </td>
      <td>{shown}</td>
      <td>
        <code>[{bytes?.join(', ') ?? ''}]</code>
      </td>
      <td className={status}>{status ?? ''}</td>
      <td>{visible ? '' : 'hidden by showIf'}</td>
      <td>
        <form onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={control.type === 'color' ? 'hue, sat' : 'value'}
            style={{width: '7em'}}
          />{' '}
          <button type="submit">Set</button>
        </form>
      </td>
    </tr>
  );
}

function MacroForm({count, onSubmit}: {count: number; onSubmit: Runner}) {
  const [index, setIndex] = useState(0);
  const [expression, setExpression] = useState('Hello{KC_ENT}');
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void onSubmit(`Set M${index}`, async () => {
      const record = await store.setMacro(index, expression).done;
      if (record.state === 'failed') {
        throw new Error(record.error);
      }
    });
  };
  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend>Set a macro</legend>
        M<input type="number" min={0} max={count - 1} value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{width: '4em'}} />{' '}
        <input value={expression} onChange={(e) => setExpression(e.target.value)} style={{width: '30em'}} /> <button type="submit">Write</button>
      </fieldset>
    </form>
  );
}
