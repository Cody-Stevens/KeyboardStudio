/*
 * In-memory emulation of a VIA keyboard's raw HID command handler.
 *
 * Behaviour follows QMK's quantum/via.c and quantum/dynamic_keymap.c: replies
 * echo the request with data filled in, reads past the end of a buffer return
 * zeros, writes past the end are ignored, and unknown commands reply with
 * id_unhandled (0xFF) in byte 0.
 */
import {Command, ID_UNHANDLED, KeyboardValue, REPORT_SIZE} from '../protocol/constants.ts';
import {bytesTo32Bit, from16Bit, from32Bit, to16Bit} from '../protocol/bytes.ts';

export interface MockKeyboardSeed {
  readonly protocolVersion?: number;
  readonly layerCount: number;
  readonly rows: number;
  readonly cols: number;
  /** `[layer][row][col]` keycodes, as read from a real keyboard. */
  readonly keymap?: readonly (readonly (readonly number[])[])[];
  readonly macroCount?: number;
  readonly macroBufferSize?: number;
  readonly macroBuffer?: readonly number[];
  /** Custom menu values keyed by `"channel:valueId"`, as raw bytes. */
  readonly customValues?: Readonly<Record<string, readonly number[]>>;
  readonly layoutOptions?: number;
  readonly firmwareVersion?: number;
  /** Channels whose custom menu commands the firmware answers. Others reply id_unhandled. */
  readonly customChannels?: readonly number[];
}

/** Bytes a custom menu value occupies in the emulated firmware. Longer reads return zero padding. */
const CUSTOM_VALUE_MAX = REPORT_SIZE - 3;

/**
 * A VIA keyboard in memory. {@link handle} takes a 32-byte request and
 * returns the 32-byte reply the firmware would send.
 *
 * Custom menu values have separate RAM and EEPROM copies, so tests can check
 * that a value only survives {@link powerCycle} after CUSTOM_MENU_SAVE.
 */
export class MockKeyboard {
  readonly protocolVersion: number;
  readonly layerCount: number;
  readonly rows: number;
  readonly cols: number;
  readonly macroCount: number;
  readonly keymapBytes: Uint8Array;
  readonly macroBuffer: Uint8Array;
  layoutOptions: number;
  firmwareVersion: number;
  private customRam = new Map<string, Uint8Array>();
  private customEeprom = new Map<string, Uint8Array>();
  private readonly customChannels: ReadonlySet<number>;
  private readonly bootTime = Date.now();
  /** Every request received, in order. Tests use it to count and inspect traffic. */
  readonly log: Uint8Array[] = [];

  constructor(seed: MockKeyboardSeed) {
    this.protocolVersion = seed.protocolVersion ?? 12;
    this.layerCount = seed.layerCount;
    this.rows = seed.rows;
    this.cols = seed.cols;
    this.macroCount = seed.macroCount ?? 16;
    this.keymapBytes = new Uint8Array(this.layerCount * this.rows * this.cols * 2);
    seed.keymap?.forEach((layer, l) =>
      layer.forEach((row, r) =>
        row.forEach((keycode, c) => {
          const offset = ((l * this.rows + r) * this.cols + c) * 2;
          const [hi, lo] = from16Bit(keycode);
          this.keymapBytes[offset] = hi;
          this.keymapBytes[offset + 1] = lo;
        }),
      ),
    );
    this.macroBuffer = new Uint8Array(seed.macroBufferSize ?? 338);
    this.macroBuffer.set((seed.macroBuffer ?? []).slice(0, this.macroBuffer.length));
    for (const [key, bytes] of Object.entries(seed.customValues ?? {})) {
      const value = new Uint8Array(CUSTOM_VALUE_MAX);
      value.set(bytes.slice(0, CUSTOM_VALUE_MAX));
      this.customRam.set(key, value);
      this.customEeprom.set(key, value.slice());
    }
    this.customChannels = new Set(
      seed.customChannels ?? Object.keys(seed.customValues ?? {}).map((key) => Number(key.split(':')[0])),
    );
    this.layoutOptions = seed.layoutOptions ?? 0;
    this.firmwareVersion = seed.firmwareVersion ?? 0;
  }

  getKeycode(layer: number, row: number, col: number): number {
    const offset = ((layer * this.rows + row) * this.cols + col) * 2;
    return to16Bit(this.keymapBytes[offset] ?? 0, this.keymapBytes[offset + 1] ?? 0);
  }

  /** `[layer][row][col]` view of the emulated EEPROM keymap. */
  keymapGrid(): number[][][] {
    return Array.from({length: this.layerCount}, (_, l) =>
      Array.from({length: this.rows}, (_, r) => Array.from({length: this.cols}, (_, c) => this.getKeycode(l, r, c))),
    );
  }

  /** Current RAM value of a custom menu setting. */
  getCustomValue(channel: number, valueId: number, length: number): number[] {
    return Array.from((this.customRam.get(`${channel}:${valueId}`) ?? new Uint8Array(CUSTOM_VALUE_MAX)).slice(0, length));
  }

  /** Value of a custom menu setting as saved in EEPROM. */
  getSavedCustomValue(channel: number, valueId: number, length: number): number[] {
    return Array.from(
      (this.customEeprom.get(`${channel}:${valueId}`) ?? new Uint8Array(CUSTOM_VALUE_MAX)).slice(0, length),
    );
  }

  /** Simulates unplugging and replugging: RAM-only custom values revert to EEPROM. */
  powerCycle(): void {
    this.customRam = new Map([...this.customEeprom].map(([key, value]) => [key, value.slice()]));
  }

  handle(request: Uint8Array): Uint8Array {
    this.log.push(request.slice());
    const reply = new Uint8Array(REPORT_SIZE);
    reply.set(request.subarray(0, REPORT_SIZE));
    const at = (i: number) => request[i] ?? 0;
    switch (at(0)) {
      case Command.GET_PROTOCOL_VERSION:
        reply.set(from16Bit(this.protocolVersion), 1);
        break;
      case Command.GET_KEYBOARD_VALUE:
        this.getKeyboardValue(at(1), reply);
        break;
      case Command.SET_KEYBOARD_VALUE:
        if (at(1) === KeyboardValue.LAYOUT_OPTIONS) {
          this.layoutOptions = bytesTo32Bit([at(2), at(3), at(4), at(5)]);
        } else {
          reply[0] = ID_UNHANDLED;
        }
        break;
      case Command.DYNAMIC_KEYMAP_GET_KEYCODE: {
        const [layer, row, col] = [at(1), at(2), at(3)];
        if (layer < this.layerCount && row < this.rows && col < this.cols) {
          reply.set(from16Bit(this.getKeycode(layer, row, col)), 4);
        } else {
          reply.set([0, 0], 4);
        }
        break;
      }
      case Command.DYNAMIC_KEYMAP_SET_KEYCODE: {
        const [layer, row, col] = [at(1), at(2), at(3)];
        if (layer < this.layerCount && row < this.rows && col < this.cols) {
          const offset = ((layer * this.rows + row) * this.cols + col) * 2;
          this.keymapBytes[offset] = at(4);
          this.keymapBytes[offset + 1] = at(5);
        }
        break;
      }
      case Command.CUSTOM_MENU_SET_VALUE:
      case Command.CUSTOM_MENU_GET_VALUE:
      case Command.CUSTOM_MENU_SAVE:
        this.customMenu(request, reply);
        break;
      case Command.DYNAMIC_KEYMAP_MACRO_GET_COUNT:
        reply[1] = this.macroCount;
        break;
      case Command.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE:
        reply.set(from16Bit(this.macroBuffer.length), 1);
        break;
      case Command.DYNAMIC_KEYMAP_MACRO_GET_BUFFER:
        this.readBuffer(this.macroBuffer, request, reply);
        break;
      case Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER:
        this.writeBuffer(this.macroBuffer, request);
        break;
      case Command.DYNAMIC_KEYMAP_MACRO_RESET:
        this.macroBuffer.fill(0);
        break;
      case Command.DYNAMIC_KEYMAP_GET_LAYER_COUNT:
        reply[1] = this.layerCount;
        break;
      case Command.DYNAMIC_KEYMAP_GET_BUFFER:
        this.readBuffer(this.keymapBytes, request, reply);
        break;
      case Command.DYNAMIC_KEYMAP_SET_BUFFER:
        this.writeBuffer(this.keymapBytes, request);
        break;
      default:
        // Includes keymap reset, EEPROM reset, bootloader jump and encoders,
        // which this emulated board does not implement.
        reply[0] = ID_UNHANDLED;
    }
    return reply;
  }

  private getKeyboardValue(id: number, reply: Uint8Array): void {
    switch (id) {
      case KeyboardValue.UPTIME:
        reply.set(from32Bit(Date.now() - this.bootTime), 2);
        break;
      case KeyboardValue.LAYOUT_OPTIONS:
        reply.set(from32Bit(this.layoutOptions), 2);
        break;
      case KeyboardValue.FIRMWARE_VERSION:
        reply.set(from32Bit(this.firmwareVersion), 2);
        break;
      default:
        // The Linky87 replies id_unhandled to KEYCODES_VERSION (0x06), as protocol 12 boards do.
        reply[0] = ID_UNHANDLED;
    }
  }

  private customMenu(request: Uint8Array, reply: Uint8Array): void {
    const command = request[0] ?? 0;
    const channel = request[1] ?? 0;
    if (!this.customChannels.has(channel)) {
      reply[0] = ID_UNHANDLED;
      return;
    }
    if (command === Command.CUSTOM_MENU_SAVE) {
      for (const [key, value] of this.customRam) {
        if (key.startsWith(`${channel}:`)) {
          this.customEeprom.set(key, value.slice());
        }
      }
      return;
    }
    const key = `${channel}:${request[2] ?? 0}`;
    if (command === Command.CUSTOM_MENU_SET_VALUE) {
      const value = new Uint8Array(CUSTOM_VALUE_MAX);
      value.set(request.subarray(3, 3 + CUSTOM_VALUE_MAX));
      this.customRam.set(key, value);
      return;
    }
    reply.set(this.customRam.get(key) ?? new Uint8Array(CUSTOM_VALUE_MAX), 3);
  }

  private readBuffer(buffer: Uint8Array, request: Uint8Array, reply: Uint8Array): void {
    const offset = to16Bit(request[1] ?? 0, request[2] ?? 0);
    const size = Math.min(request[3] ?? 0, REPORT_SIZE - 4);
    for (let i = 0; i < size; i++) {
      reply[4 + i] = buffer[offset + i] ?? 0;
    }
  }

  private writeBuffer(buffer: Uint8Array, request: Uint8Array): void {
    const offset = to16Bit(request[1] ?? 0, request[2] ?? 0);
    const size = Math.min(request[3] ?? 0, REPORT_SIZE - 4);
    for (let i = 0; i < size && offset + i < buffer.length; i++) {
      buffer[offset + i] = request[4 + i] ?? 0;
    }
  }
}
