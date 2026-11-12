/*
 * VIA raw HID protocol constants.
 *
 * Command ids are taken from the-via/app src/utils/keyboard-api.ts
 * (GPL-3.0, https://github.com/the-via/app) and QMK's quantum/via.h.
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */

/** Size of one raw HID report, without the report-id prefix. */
export const REPORT_SIZE = 32;

/** Largest data payload that fits in one buffer read or write (32 - 4 header bytes). */
export const MAX_BUFFER_CHUNK = 28;

/** Raw HID collection that VIA firmware exposes. */
export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;

/** Byte 0 of a reply when the firmware does not handle the command. */
export const ID_UNHANDLED = 0xff;

export const Command = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
  SET_KEYBOARD_VALUE: 0x03,
  DYNAMIC_KEYMAP_GET_KEYCODE: 0x04,
  DYNAMIC_KEYMAP_SET_KEYCODE: 0x05,
  DYNAMIC_KEYMAP_RESET: 0x06,
  CUSTOM_MENU_SET_VALUE: 0x07,
  CUSTOM_MENU_GET_VALUE: 0x08,
  CUSTOM_MENU_SAVE: 0x09,
  EEPROM_RESET: 0x0a,
  BOOTLOADER_JUMP: 0x0b,
  DYNAMIC_KEYMAP_MACRO_GET_COUNT: 0x0c,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE: 0x0d,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER: 0x0e,
  DYNAMIC_KEYMAP_MACRO_SET_BUFFER: 0x0f,
  DYNAMIC_KEYMAP_MACRO_RESET: 0x10,
  DYNAMIC_KEYMAP_GET_LAYER_COUNT: 0x11,
  DYNAMIC_KEYMAP_GET_BUFFER: 0x12,
  DYNAMIC_KEYMAP_SET_BUFFER: 0x13,
  DYNAMIC_KEYMAP_GET_ENCODER: 0x14,
  DYNAMIC_KEYMAP_SET_ENCODER: 0x15,
  UI_SYNC_REQUEST: 0x16,
} as const;

export type CommandId = (typeof Command)[keyof typeof Command];

export const CommandName: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(Command).map(([name, id]) => [id, name]),
);

/**
 * Commands that change keyboard state. The command channel refuses them when
 * it runs in read-only mode.
 */
export const WRITE_COMMANDS: ReadonlySet<number> = new Set([
  Command.SET_KEYBOARD_VALUE,
  Command.DYNAMIC_KEYMAP_SET_KEYCODE,
  Command.DYNAMIC_KEYMAP_RESET,
  Command.CUSTOM_MENU_SET_VALUE,
  Command.CUSTOM_MENU_SAVE,
  Command.EEPROM_RESET,
  Command.BOOTLOADER_JUMP,
  Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER,
  Command.DYNAMIC_KEYMAP_MACRO_RESET,
  Command.DYNAMIC_KEYMAP_SET_BUFFER,
  Command.DYNAMIC_KEYMAP_SET_ENCODER,
]);

/**
 * Commands KeyboardStudio never sends, in any mode. Wiping EEPROM, resetting
 * the keymap and jumping to the bootloader are destructive and out of scope.
 */
export const FORBIDDEN_COMMANDS: ReadonlySet<number> = new Set([
  Command.DYNAMIC_KEYMAP_RESET,
  Command.EEPROM_RESET,
  Command.BOOTLOADER_JUMP,
]);

/** Sub-ids for GET_KEYBOARD_VALUE / SET_KEYBOARD_VALUE (from keyboard-values.ts). */
export const KeyboardValue = {
  UPTIME: 0x01,
  LAYOUT_OPTIONS: 0x02,
  SWITCH_MATRIX_STATE: 0x03,
  FIRMWARE_VERSION: 0x04,
  DEVICE_INDICATION: 0x05,
  KEYCODES_VERSION: 0x06,
} as const;

export type KeyboardValueId = (typeof KeyboardValue)[keyof typeof KeyboardValue];

/** VIA protocol versions with named feature levels. */
export const Protocol = {
  /** Bulk keymap buffer commands and layer count (0x11-0x13). */
  BETA: 8,
  /** Lowest version this core supports. */
  MIN_SUPPORTED: 9,
  /** Macro delays and the 0x01-prefixed action format. */
  MACRO_V11: 11,
  /** VIA V3 custom menus and the QMK 0.19+ keycode layout. */
  V3_MENUS: 11,
  /** QMK keycode layout used by VIA's v12 table. */
  KEYCODES_V12: 12,
} as const;

/** QMK custom menu channel ids used by VIA's common menus. */
export const CustomChannel = {
  CUSTOM: 0,
  BACKLIGHT: 1,
  RGBLIGHT: 2,
  RGB_MATRIX: 3,
  AUDIO: 4,
  LED_MATRIX: 5,
} as const;
