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

## qmk/qmk_firmware

Repository: <https://github.com/qmk/qmk_firmware>
Commit: `33292390974c75362ca30873c482d052e0bd7a63` (2026-11-12)
License: GPL-2.0-or-later, used here under GPL-3.0. Copyright (C) the QMK
contributors; `flower_blooming_anim.h` Copyright 2023 HorrorTroll.

The lighting previews compute what the keyboard computes, so these formulas
are ported line by line to TypeScript, with C's integer types emulated.

| KeyboardStudio file | Upstream file | How |
| --- | --- | --- |
| `src/app/logic/qmk-math.ts` | `lib/lib8tion/scale8.h` (`scale8`, `scale16by8` with `FASTLED_SCALE8_FIXED=1`), `lib/lib8tion/math8.h` (`qadd8`, `qsub8`, `abs8`, `sqrt16`), `lib/lib8tion/trig8.h` (`sin8_C`, `cos8`, `atan2_8`), `quantum/color.c` (`hsv_to_rgb_impl` without the CIE curve) | Ported |
| `src/app/logic/rgb-matrix.ts` | `quantum/rgb_matrix/animations/`: `solid_color_anim.h`, `alpha_mods_anim.h`, `gradient_up_down_anim.h`, `gradient_left_right_anim.h`, `breathing_anim.h`, `colorband_*_anim.h` (6), `cycle_*_anim.h` (7), `rainbow_moving_chevron_anim.h`, `dual_beacon_anim.h`, `rainbow_beacon_anim.h`, `rainbow_pinwheels_anim.h`, `flower_blooming_anim.h`, `hue_breathing_anim.h`, `hue_pendulum_anim.h`, `hue_wave_anim.h`, `solid_reactive_anim.h`, `solid_reactive_wide.h`, `solid_reactive_cross.h`, `solid_reactive_nexus.h`, `splash_anim.h`, `solid_splash_anim.h`, and `runners/effect_runner_{i,dx_dy,dx_dy_dist,sin_cos_i,reactive,reactive_splash}.h`; key hit tracking from `quantum/rgb_matrix/rgb_matrix.c` | Ported; one function per effect |
| `src/app/logic/effect-info.ts` | The same animation files | Plain-language descriptions written from reading them; no code copied |

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

## Runtime libraries

These npm packages are bundled into the site. Their licences allow that.

| Package | Licence | Used for |
| --- | --- | --- |
| `react`, `react-dom` | MIT | The UI |
| `nanostores`, `@nanostores/react` | MIT | State |
| `three` | MIT, Copyright 2010-2026 three.js authors | The 3D keyboard (loaded as its own chunk), including its `examples/jsm` RoomEnvironment, EffectComposer, UnrealBloomPass, OutputPass and CopyShader |

## Fonts

| Font | Package | Licence |
| --- | --- | --- |
| Barlow (400, 500, 600), Latin subset | `@fontsource/barlow` | SIL Open Font License 1.1, Copyright 2017 The Barlow Project Authors |
| Barlow Semi Condensed (500, 600), Latin subset | `@fontsource/barlow-semi-condensed` | SIL Open Font License 1.1, Copyright 2017 The Barlow Project Authors |

The font files are served from the site itself; no font is loaded from a
third-party server.

## Development tools

Playwright (`@playwright/test`, Apache-2.0) runs the end-to-end flows in
`e2e/`. It is not part of the site.

## Not ported

`@the-via/pelpi` (the `showIf` parser VIA uses) is not used. Its npm package
contains no built code. `src/core/definitions/show-if.ts` is an independent
implementation of the same expression shape.
