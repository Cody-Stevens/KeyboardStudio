# Notices and attribution

KeyboardStudio is licensed under the GNU General Public License v3.0 (see `LICENSE`).
It reuses code from the VIA project, which is also GPL-3.0. This file records what
came from where. Each ported file also names its upstream source in its header.

## the-via/app

Repository: <https://github.com/the-via/app>
Commit: `935106a990af39bdd1ade881c02366eac486240d` (2026-09-17)
License: GPL-3.0. Copyright (C) The VIA authors.

| KeyboardStudio file | Upstream file | How |
| --- | --- | --- |
| `src/core/keycodes/v12.ts` | `src/utils/key-to-byte/v12.ts` | Copied; export wrapper changed |
| `src/core/keycodes/deprecated.ts` | `src/utils/key-to-byte/deprecated-keycodes.ts` | Copied; export wrapper changed |
| `src/core/keycodes/catalog.ts` | `src/utils/key.ts` (keycode menus, label helpers, lighting keycode selection) | Copied blocks; strict types; no runtime dependency on `@the-via/reader` |
| `src/core/keycodes/advanced.ts` | `src/utils/advanced-keys.ts` | Ported; strict types; ranges looked up by name; parse failures return `null` |
| `src/core/keycodes/keycode-table.ts` | `src/utils/key.ts` (`getByteToKey`, `getCodeForByte`, `getByteForCode`, `getLabelForByte`, `getOtherMenu`, `getKeycodesForKeyboard`), `src/utils/keyboard-rendering.ts` (`getLabel`) | Ported into a class |
| `src/core/macros/codec.ts` | `src/utils/macro-api/macro-api.v11.ts`, `macro-api.common.ts`, `types.ts` | Ported; discriminated unions; no `eval` |
| `src/core/protocol/keyboard-api.ts` | `src/utils/keyboard-api.ts` | Ported; no Redux; EEPROM reset and bootloader jump removed |
| `src/core/protocol/command-channel.ts` | `src/utils/keyboard-api.ts` (`hidCommand`, `flushQueue`, `_hidCommand`), `src/shims/node-hid.ts` | Ported queue and echo check; stray replies are skipped instead of failing the next request |
| `src/core/protocol/constants.ts` | `src/utils/keyboard-api.ts`, `src/utils/keyboard-values.ts` | Command and value ids |
| `src/core/protocol/bytes.ts` | `src/utils/keyboard-api.ts` (`shiftTo16Bit`, `shiftFrom16Bit`), `src/utils/bit-pack.ts` | Ported |
| `src/core/transport/webhid.ts` | `src/shims/node-hid.ts` | Device filter |
| `src/core/definitions/parse.ts` | `src/store/menusSlice.ts` (`extractCommands`, `compileMenu`), `src/components/panes/configure-panes/custom/custom-control.tsx` | Menu flattening and control byte lengths |
| `src/core/definitions/menus.ts` | `src/components/panes/configure-panes/custom/custom-control.tsx`, `src/utils/range-constraints.ts` | Control value encoding |
| `src/core/snapshots/via-layout.ts` | `src/components/panes/configure-panes/save-load.tsx` | VIA layout file shape and import rules |

## the-via/reader

Repository: <https://github.com/the-via/reader>
Package: `@the-via/reader@1.14.4` (npm), used as a dependency, not copied.
Source reviewed at commit `c26009992a7a2e9776720ebf5644a50f8e92c7a5` (2026-08-15).
License: GPL-3.0.

It validates definitions, converts KLE layouts into key geometry and provides
VIA's common menus.

## the-via/keyboards

Repository: <https://github.com/the-via/keyboards>
Commit checked: `9e3e9f4aa9f50f9439fdebc747560f51aaf109a0` (2026-09-22)
License: GPL-3.0.

No files from this repository are bundled. The optional public lookup in
`src/core/definitions/lookup.ts` fetches its build output from usevia.app at
runtime.

## Bundled keyboard definition

`src/core/definitions/bundled/linky87.json` is the VIA V3 definition ELECFOX
publishes for the Linky87. It is not part of the-via/keyboards. It is included
unchanged, apart from line endings, so the keyboard works without a download.

## Not ported

`@the-via/pelpi` (the `showIf` parser VIA uses) is not used. Its npm package
contains no built code. `src/core/definitions/show-if.ts` is an independent
implementation of the same expression shape.
