/**
 * Keycodes that do something drastic when pressed. The UI marks them so a
 * factory reset never sits on a key unnoticed.
 *
 * Values are QMK protocol 12 quantum keycodes:
 * - 0x7C00 QK_BOOT (`RESET` in VIA's table): jump to the bootloader.
 * - 0x7C01 QK_REBOOT: restart the keyboard.
 * - 0x7C03 QK_CLEAR_EEPROM: erase the EEPROM, which resets the keymap,
 *   macros and lighting to the firmware defaults.
 */

export type KeycodeDangerKind = 'factory-reset' | 'bootloader' | 'reboot';

export interface KeycodeDanger {
  readonly kind: KeycodeDangerKind;
  /** Plain name for the key, such as "Factory reset". */
  readonly name: string;
  /** One or two sentences on what pressing the key does. */
  readonly explanation: string;
  /** Short keycap legend. */
  readonly legend: string;
}

const DANGERS: ReadonlyMap<number, KeycodeDanger> = new Map<number, KeycodeDanger>([
  [
    0x7c03,
    {
      kind: 'factory-reset',
      name: 'Factory reset',
      legend: 'Reset',
      explanation:
        'Pressing it erases every change saved on the keyboard. Keys, macros and lighting go back to how the maker set them.',
    },
  ],
  [
    0x7c00,
    {
      kind: 'bootloader',
      name: 'Firmware update mode',
      legend: 'Boot',
      explanation: 'Pressing it stops the keyboard so new firmware can be installed. It stops typing until you unplug it.',
    },
  ],
  [
    0x7c01,
    {
      kind: 'reboot',
      name: 'Restart keyboard',
      legend: 'Restart',
      explanation: 'Pressing it restarts the keyboard. It stops typing for a moment.',
    },
  ],
]);

/** The danger a keycode carries, or null for ordinary keys. */
export const keycodeDanger = (value: number): KeycodeDanger | null => DANGERS.get(value) ?? null;

/** Every dangerous keycode value, for pickers that list them. */
export const DANGEROUS_KEYCODES: readonly number[] = [...DANGERS.keys()];
