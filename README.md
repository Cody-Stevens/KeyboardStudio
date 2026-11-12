# KeyboardStudio

KeyboardStudio is a browser-based configurator for keyboards that speak the
[VIA](https://www.caniusevia.com/) protocol. It talks to the keyboard over
WebHID, so it runs as a static site with no server, no accounts and no
backend. Everything it shows comes live from the keyboard.

This repository currently holds the engine (`src/core/`) and a plain debug
page that proves it. The designed interface will be built on top of the core.

First-class keyboard: ELECFOX Linky87 (USB `36B0:3005`, VIA protocol 12).

## Run it

You need Node.js 22.23.4 or later and pnpm 10.

```sh
pnpm install
pnpm test        # Vitest against the in-memory mock keyboard
pnpm build       # astro check, then a static build in dist/
pnpm dev         # http://127.0.0.1:4321
```

Open `http://127.0.0.1:4321/?mock=1` to use the mock Linky87. The mock needs
no hardware and connects on page load. Two more query options apply to the
mock:

- `&latency=2` delays each reply by 2 ms.
- `&fail=0.1` makes 10 % of write reports fail, to exercise rollback.

Without `?mock=1`, the page uses WebHID, which needs a Chromium-based browser
(Chrome, Edge) on HTTPS or localhost. Click **Connect** and pick the keyboard.

> [!WARNING]
> With a real keyboard, writes change the keyboard's EEPROM. The debug page
> connects read-only unless you tick **Allow writes** before connecting.

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

## License

GPL-3.0. KeyboardStudio reuses GPL-3.0 code from the VIA project; see
[NOTICE.md](NOTICE.md) for the files and commits.
