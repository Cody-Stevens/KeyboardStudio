# KeyboardStudio

KeyboardStudio is a browser-based configurator for keyboards that speak the
[VIA](https://www.caniusevia.com/) protocol. It talks to the keyboard over
WebHID, so it runs as a static site with no server, no accounts and no
backend. Everything it shows comes live from the keyboard.

The app at `/` puts a real-time 3D model of the connected keyboard in the
middle of the page, built from the keyboard's own VIA layout. A docked editor
below it changes keys, lighting, macros and snapshots, and every change reads
back as a sentence with its real save status. A plain debug page that
exercises the engine directly lives at `/debug`.

First-class keyboard: ELECFOX Linky87 (USB `36B0:3005`, VIA protocol 12).

## Run it

You need Node.js 22.23.4 or later and pnpm 10.

```sh
pnpm install
pnpm test        # Vitest: the core and the UI logic, against the in-memory mock
pnpm build       # astro check, then a static build in dist/
pnpm dev         # http://127.0.0.1:4321
pnpm e2e         # builds, then drives every flow in headless Chromium (Playwright)
```

Open `http://127.0.0.1:4321/?mock=1` (or follow "Try the demo keyboard" on the
landing page) to run the whole app on the mock Linky87. The mock needs no
hardware and connects on page load. More query options:

- `&latency=2` delays each mock reply by 2 ms (default: 1-3 ms, about what the
  real Linky87 takes).
- `&fail=0.1` makes 10 % of mock write reports fail, to exercise rollback.
- `&board=unknown` makes the mock act as a keyboard with no bundled
  definition, which shows the drop zone for its VIA JSON.
- `&view=flat` starts in the flat view; `&webgl=0` pretends WebGL is missing.

`/debug?mock=1` opens the debug page on the mock.

`pnpm e2e` needs Playwright's Chromium (`pnpm exec playwright install chromium`
once). It starts `astro preview` on port 4321 unless one is already running.
Set `KS_SHOTS=<folder>` to also save a screenshot of every state.

Without `?mock=1`, the page uses WebHID, which needs a Chromium-based browser
(Chrome, Edge) on HTTPS or localhost. Click **Connect** and pick the keyboard.

> [!WARNING]
> With a real keyboard, writes change the keyboard's EEPROM. The app writes
> each change as you make it (that is the point). The debug page connects
> read-only unless you tick **Allow writes** before connecting.

## The app

`src/app/` holds the designed interface: one React island (`client:only`) on
`src/pages/index.astro`, built on the core store.

| Folder | Job |
| --- | --- |
| `logic/` | Framework-free and unit-tested: keycap legends and plain key names (Win or Cmd per layer), the key picker catalogue and search, lighting previews (QMK's rgb_matrix formulas), macro steps and recording, snapshot diffs, write-log status. |
| `state/` | nanostores atoms: the connect flow, the session view (kept after a disconnect so the page stays readable), UI state, and `changes.ts`, which makes every write, logs it as a sentence and knows how to undo it. |
| `scene/` | The three.js board. Loaded as its own chunk after the 2D shell. |
| `components/` | React components. |

### What it does

- **3D board, flat view.** The keyboard is drawn from the definition's layout.
  Drag to turn it. **3D / Flat** (or the **V** key) tips it to a straight
  top-down view; the flat view is real buttons with DOM text, so every legend
  is crisp. The choice is remembered.
- **Docked editor.** Selecting a key presses it and rings it; the editor sits
  below the board, which stays fully visible. Arrow keys move between keys
  when the board has focus.
- **Sentences and a write log.** "Caps Lock on Windows is now Esc. Saved to
  keyboard. Undo". Status comes from the store's write records (pending,
  saved, failed with rollback), never from a timer. The **Changes** panel
  lists every write in the session with its own Undo, and hides away
  completely. The lamp in the top bar shows connected, saving, all changes on
  the keyboard, or that the last change did not save.
- **Layers by name.** Windows, Mac, Windows Fn, Mac Fn on the Linky87. Fn
  layers fade keys that repeat the layer underneath. "Also on Mac" writes the
  paired layer in the same action.
- **Lighting.** One panel per zone, side by side, generated from the
  definition's menus and `showIf` rules. Hovering a panel brings its zone
  forward on the model; clicking the logo or a side strip on the model focuses
  its panel. The model animates only effects whose firmware formula is known
  (off, solid, alphas/mods, gradients, breathing, the three cycles) and
  otherwise shows colour and brightness and says so. A brightness above the
  definition's range (the Linky87 reports 255 of 160) is shown as read and
  never rewritten unless you move the slider.
- **Macros.** Name it, record it or add text and pauses, then **Save and put
  on a key** and click the key: one action writes the macro and the key.
  Macros saved on no key are flagged. Bytes left are counted against the
  keyboard's own buffer size. Names live in this browser; keyboards do not
  store them.
- **Key picker.** Search first, plain categories, "press the key you want"
  (Escape cancels, Tab still moves focus), modifier combinations, layer keys
  by layer name, macros, and the board's own keys with plain names. Factory
  reset (`0x7C03`), firmware update mode and restart are red, explained, and
  ask before they go on a key.
- **Connect.** Known boards go straight in, with a short assemble animation
  the first time that never blocks the editor. Unknown boards get a drop zone
  for their VIA JSON (kept in this browser) and an optional lookup on
  usevia.app. Browsers without WebHID are told so plainly. A disconnect keeps
  the page and offers **Reconnect**.
- **Snapshots.** Save named snapshots in the browser, export and import them
  as files (VIA layout files too), and see exactly what a restore will change
  before it writes.

### Per-board metadata

Layer names, layer pairs, which lighting zone lights which part of the board,
plain names for custom keys and notes on particular keys are not in VIA
definitions. A bundled board can ship them in a meta file next to its
definition (`src/core/definitions/bundled/linky87.meta.ts`, typed by
`src/core/definitions/board-meta.ts`). Any other board gets "Layer 0, 1, ...",
no pairs, and zones matched by their labels.

On the Linky87, layer 0 holds `MO(0)` where the Fn key is. The app does not
change it: the vendor firmware probably handles Fn itself. The key shows "Fn"
and a quiet note says why it is best left alone.

### Performance

Measured on 2026-11-12 with `astro preview` and headless Chromium 158 at
1600 x 1000:

| What | Size (gzip) |
| --- | --- |
| JavaScript before the 3D board: app 24 KB, React DOM 66 KB, shared core and React 35 KB, other 5 KB | 130 KB |
| Definition parser (`@the-via/reader`), loaded at start, needed to connect | 49 KB |
| three.js and the scene, loaded as its own chunk | 148 KB |
| CSS | 6 KB |
| Fonts: 5 Latin woff2 files | 112 KB (already compressed) |

| What | Result |
| --- | --- |
| First contentful paint (static landing) | about 0.4 s |
| Editor usable on the demo keyboard | about 1.3 s |
| Frames drawn while nothing moves | 0 (renders on demand) |
| GPU (D3D11), backlight breathing | 60 fps, 31 draw calls |
| CPU renderer (SwiftShader), backlight breathing | about 19-20 fps |

Keycaps are instanced (one mesh per cap size) with every legend in one atlas
texture. If frames stay slower than 18 per second over a second of animation,
or WebGL is missing, the page switches to the flat board and says why.
`prefers-reduced-motion` skips the assemble animation and camera moves and
holds lighting previews still.

## Architecture of the core

`src/core/` has no UI framework dependency. Import everything from
`src/core/index.ts`. The layers, from the bottom up:

| Layer | Folder | Job |
| --- | --- | --- |
| Transport | `transport/` | Moves 32-byte HID reports. `WebHidTransport` for real keyboards, `MockTransport` + `MockKeyboard` for an in-memory VIA keyboard. |
| Protocol | `protocol/` | `CommandChannel` sends one command at a time and pairs each reply by its echoed request bytes. `KeyboardApi` wraps the VIA commands. |
| Definitions | `definitions/` | Parses VIA V3 and V2 definitions (authored or compiled), lays out keys and layout options, normalises menus, evaluates `showIf`, finds definitions. |
| Keycodes | `keycodes/` | Protocol 12 keycode table, names, labels, picker categories and the definition's custom keycodes. |
| Macros | `macros/` | VIA's protocol 11+ macro byte format and expression language. |
| Store | `store/` | nanostores state for one keyboard, with optimistic writes and a status per write. |
| Snapshots | `snapshots/`, `storage/` | Export and restore full keyboard state, import VIA layout files, keep named snapshots in IndexedDB. |

### Safety rails

- `CommandChannel` never sends keymap reset (`0x06`), EEPROM reset (`0x0A`)
  or bootloader jump (`0x0B`), and `KeyboardApi` has no method for them.
- `connect(transport, {readOnly: true})` refuses every write command at the
  channel, before it reaches the device.

### Store and write status

`createKeyboardStore()` returns atoms any UI can subscribe to (with
`@nanostores/react`, `@nanostores/vue` or plain `.subscribe`):

| Atom | Holds |
| --- | --- |
| `$connection` | `disconnected`, `connecting`, `connected` (protocol, layers, macro slots, timing) or `error` |
| `$definition` | The parsed `KeyboardDefinition` |
| `$keymap` / `$confirmedKeymap` | Displayed keymap (with pending writes) / what the keyboard confirmed |
| `$menuValues` / `$confirmedMenuValues` | Lighting and other custom menu values, raw bytes per command id |
| `$macros` / `$confirmedMacros` | Decoded macros with expressions and bytes used |
| `$layoutChoices` | One choice per layout option, such as ISO Enter |
| `$keycodes` | A `KeycodeTable` for the connected keyboard |
| `$writes`, `$targetStatus`, `$pendingWrites` | Write records and the latest status per target |

Every write (`setKeycode`, `writeKeymap`, `setMenuValue`, `setMacros`,
`setMacro`, `setLayoutChoices`) updates the displayed value at once and
returns a handle whose `done` promise resolves with the final record:

- `pending`: queued or in flight.
- `saved`: the keyboard acknowledged it. Lighting values count as saved once
  their channel is written to EEPROM, which happens after 300 ms without
  further changes, so a dragged slider costs one save.
- `failed`: the displayed value rolls back. The store then re-reads the value
  from the keyboard (`verified: true`), so the screen shows what the keyboard
  really holds, even when a write applied but its reply was lost.
- `superseded`: a newer write to the same target replaced it before it was sent.

Queued writes to the same target coalesce. Bulk keymap writes (restore,
import) use the 28-byte buffer command and send only the reports that cover
changed keys.

### Connect timing

On connect the store queues every read at once: 59 reports for the Linky87
(metadata, 28 keymap chunks, 13 macro chunks, 12 lighting values).

| Measurement | Result |
| --- | --- |
| Mock, definition already parsed | 0.45 ms median over 20 runs (Node) |
| Mock, including definition lookup and parse | about 9 ms |
| First connect in a page | adds about 300-420 ms to load and compile `@the-via/reader`'s schemas once; call `preloadDefinitionParser()` at page load to hide it |
| Real Linky87, same 59 GET reports from Python `hidapi` | about 125 ms (2.1 ms per report), measured 2026-11-12 |

## Add a keyboard

1. Get the keyboard's VIA definition JSON from the manufacturer or from
   [the-via/keyboards](https://github.com/the-via/keyboards).
2. Save it as `src/core/definitions/bundled/<name>.json`.
3. Add an entry to `BUNDLED_DEFINITIONS` in
   `src/core/definitions/bundled/index.ts` with its `vendorId * 65536 + productId`.
4. Run `pnpm test`. The definition is parsed and validated on connect.
5. Optional: add a `<name>.meta.ts` next to it with layer names, layer pairs,
   lighting zone parts and plain names for its custom keys (see
   `linky87.meta.ts`), and set `meta` on its `BUNDLED_DEFINITIONS` entry.

Users can also sideload a definition in the browser:
`store.registry.sideload(json)` validates it and keeps it in IndexedDB for
that keyboard. A sideloaded definition takes precedence over a bundled one.

### Public definitions from usevia.app

`DefinitionRegistry` can look up keyboards on usevia.app when you pass
`publicLookup: {}`. usevia.app serves the build output of the-via/keyboards:
`/definitions/supported_kbs.json` (about 37 KB, 2,061 ids on 2026-11-12) and
`/definitions/v3/<vendorProductId>.json`, both with
`Access-Control-Allow-Origin: *`. This is not a documented API, so the lookup
is off by default. The Linky87 is not in that set; its definition is bundled.

## Known limits

- Keycode tables ship for protocol 12 only. A protocol 11 or 13 keyboard
  connects, but keycode names and macros are unavailable until its table is
  ported (`keycodes/keycode-table.ts` reports this as a warning).
- V2 definitions parse (layout, custom menus, custom keycodes), but V2
  `lighting` presets that use the legacy backlight commands are not wired up.
- Encoders, per-key RGB (`color-palette`) and VIA's UI sync requests (`0x16`)
  are not implemented.
- The app draws ISO Enter and other stepped keys as plain rectangles, and has
  no control yet for layout options such as ISO Enter.
- The case, logo badge and side strips on the 3D model are drawn for the
  Linky87's zones; their shape is invented, since VIA data has none.
- "Press the key you want" and macro recording use the key the browser
  reports. Keys the operating system keeps (the Windows key alone, media
  keys on some systems, Fn) have to be picked from the list.

## License

GPL-3.0. KeyboardStudio reuses GPL-3.0 code from the VIA project and ships
three.js (MIT) and the Barlow fonts (SIL Open Font License); see
[NOTICE.md](NOTICE.md).
