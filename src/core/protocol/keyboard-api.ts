/*
 * Typed VIA protocol calls.
 *
 * Ported from the-via/app src/utils/keyboard-api.ts (GPL-3.0,
 * https://github.com/the-via/app, commit 935106a990af39bdd1ade881c02366eac486240d).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 *
 * Changes from upstream: no global store or Redux coupling; the protocol
 * version, macro buffer size and matrix are cached instead of re-read before
 * every bulk call; EEPROM reset, keymap reset and bootloader jump are not
 * exposed; macro buffer reads stop at the buffer size instead of reading past it.
 */
import {Command, KeyboardValue, MAX_BUFFER_CHUNK, Protocol, type KeyboardValueId} from './constants.ts';
import {bytesTo32Bit, bytesToWords, from16Bit, from32Bit, to16Bit, wordsToBytes} from './bytes.ts';
import {ProtocolError} from './errors.ts';
import type {CommandChannel} from './command-channel.ts';

export interface MatrixSize {
  readonly rows: number;
  readonly cols: number;
}

/**
 * A full keymap: one flat array per layer, indexed by `row * cols + col`,
 * holding 16-bit keycodes.
 */
export type Keymap = readonly (readonly number[])[];

/** A run of keymap bytes to write with DYNAMIC_KEYMAP_SET_BUFFER. */
export interface KeymapSegment {
  /** Byte offset into the whole keymap (layer-major, two bytes per key). */
  readonly byteOffset: number;
  readonly keycodes: readonly number[];
}

export class KeyboardApi {
  private protocolVersion: number | undefined;
  private macroBufferSize: number | undefined;

  constructor(readonly channel: CommandChannel) {}

  get readOnly(): boolean {
    return this.channel.readOnly;
  }

  /** VIA protocol version, such as 12. Cached after the first read. */
  async getProtocolVersion(): Promise<number> {
    if (this.protocolVersion === undefined) {
      const reply = await this.channel.request([Command.GET_PROTOCOL_VERSION]);
      this.protocolVersion = to16Bit(reply[1] ?? 0, reply[2] ?? 0);
    }
    return this.protocolVersion;
  }

  async getLayerCount(): Promise<number> {
    const version = await this.getProtocolVersion();
    if (version < Protocol.BETA) {
      return 4;
    }
    const reply = await this.channel.request([Command.DYNAMIC_KEYMAP_GET_LAYER_COUNT]);
    return reply[1] ?? 0;
  }

  async getKeyboardValue(id: KeyboardValueId, params: readonly number[] = [], resultLength = 1): Promise<number[]> {
    const bytes = [id, ...params];
    const reply = await this.channel.request([Command.GET_KEYBOARD_VALUE, ...bytes]);
    return Array.from(reply.slice(1 + bytes.length, 1 + bytes.length + resultLength));
  }

  async setKeyboardValue(id: KeyboardValueId, data: readonly number[]): Promise<void> {
    await this.channel.request([Command.SET_KEYBOARD_VALUE, id, ...data]);
  }

  /** Milliseconds since the keyboard powered on. */
  async getUptime(): Promise<number> {
    return bytesTo32Bit(await this.getKeyboardValue(KeyboardValue.UPTIME, [], 4));
  }

  /** The packed 32-bit layout options value. Decode it with the definition's layout labels. */
  async getLayoutOptions(): Promise<number> {
    return bytesTo32Bit(await this.getKeyboardValue(KeyboardValue.LAYOUT_OPTIONS, [], 4));
  }

  async setLayoutOptions(value: number): Promise<void> {
    await this.setKeyboardValue(KeyboardValue.LAYOUT_OPTIONS, from32Bit(value));
  }

  /** The firmware version VIA definitions can test with `{id_firmware_version}`. */
  async getFirmwareVersion(): Promise<number> {
    return bytesTo32Bit(await this.getKeyboardValue(KeyboardValue.FIRMWARE_VERSION, [], 4));
  }

  async getKeycode(layer: number, row: number, col: number): Promise<number> {
    const reply = await this.channel.request([Command.DYNAMIC_KEYMAP_GET_KEYCODE, layer, row, col]);
    return to16Bit(reply[4] ?? 0, reply[5] ?? 0);
  }

  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    await this.channel.request([Command.DYNAMIC_KEYMAP_SET_KEYCODE, layer, row, col, ...from16Bit(keycode)]);
  }

  /** Reads `size` bytes (at most 28) of the dynamic keymap starting at `byteOffset`. */
  async readKeymapBytes(byteOffset: number, size: number): Promise<number[]> {
    if (size > MAX_BUFFER_CHUNK) {
      throw new ProtocolError(`Keymap reads are limited to ${MAX_BUFFER_CHUNK} bytes`);
    }
    const reply = await this.channel.request([Command.DYNAMIC_KEYMAP_GET_BUFFER, ...from16Bit(byteOffset), size]);
    return Array.from(reply.slice(4, 4 + size));
  }

  /**
   * Reads every layer with DYNAMIC_KEYMAP_GET_BUFFER in 28-byte chunks. All
   * chunks are queued at once so the channel never idles between them.
   */
  async readKeymap(matrix: MatrixSize, layerCount: number): Promise<number[][]> {
    const version = await this.getProtocolVersion();
    if (version < Protocol.BETA) {
      return this.slowReadKeymap(matrix, layerCount);
    }
    const keysPerLayer = matrix.rows * matrix.cols;
    const totalBytes = layerCount * keysPerLayer * 2;
    const chunks: Promise<number[]>[] = [];
    for (let offset = 0; offset < totalBytes; offset += MAX_BUFFER_CHUNK) {
      chunks.push(this.readKeymapBytes(offset, Math.min(MAX_BUFFER_CHUNK, totalBytes - offset)));
    }
    const words = bytesToWords((await Promise.all(chunks)).flat());
    return Array.from({length: layerCount}, (_, layer) => words.slice(layer * keysPerLayer, (layer + 1) * keysPerLayer));
  }

  private async slowReadKeymap({rows, cols}: MatrixSize, layerCount: number): Promise<number[][]> {
    return Promise.all(
      Array.from({length: layerCount}, (_, layer) =>
        Promise.all(Array.from({length: rows * cols}, (_, i) => this.getKeycode(layer, Math.floor(i / cols), i % cols))),
      ),
    );
  }

  /**
   * Writes keycode runs with DYNAMIC_KEYMAP_SET_BUFFER, 14 keycodes per report.
   * Use {@link planKeymapSegments} to turn a diff into segments.
   */
  async writeKeymapSegments(segments: readonly KeymapSegment[]): Promise<void> {
    const writes: Promise<Uint8Array>[] = [];
    for (const {byteOffset, keycodes} of segments) {
      const bytes = wordsToBytes(keycodes);
      for (let i = 0; i < bytes.length; i += MAX_BUFFER_CHUNK) {
        const chunk = bytes.slice(i, i + MAX_BUFFER_CHUNK);
        writes.push(
          this.channel.request([Command.DYNAMIC_KEYMAP_SET_BUFFER, ...from16Bit(byteOffset + i), chunk.length, ...chunk]),
        );
      }
    }
    await Promise.all(writes);
  }

  async getMacroCount(): Promise<number> {
    const reply = await this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_GET_COUNT]);
    return reply[1] ?? 0;
  }

  /** Macro buffer size in bytes. Cached after the first read. */
  async getMacroBufferSize(): Promise<number> {
    if (this.macroBufferSize === undefined) {
      const reply = await this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE]);
      this.macroBufferSize = to16Bit(reply[1] ?? 0, reply[2] ?? 0);
    }
    return this.macroBufferSize;
  }

  /** Reads the whole macro buffer in 28-byte chunks. */
  async readMacroBuffer(): Promise<number[]> {
    const size = await this.getMacroBufferSize();
    const chunks: Promise<number[]>[] = [];
    for (let offset = 0; offset < size; offset += MAX_BUFFER_CHUNK) {
      const length = Math.min(MAX_BUFFER_CHUNK, size - offset);
      chunks.push(
        this.channel
          .request([Command.DYNAMIC_KEYMAP_MACRO_GET_BUFFER, ...from16Bit(offset), length])
          .then((reply) => Array.from(reply.slice(4, 4 + length))),
      );
    }
    return (await Promise.all(chunks)).flat();
  }

  /**
   * Replaces the macro buffer. Follows VIA: clear the buffer, mark the last
   * byte 0xFF while writing, write the data, then clear the marker so a
   * half-written buffer is detectable.
   */
  async writeMacroBuffer(data: readonly number[]): Promise<void> {
    const size = await this.getMacroBufferSize();
    if (data.length > size) {
      throw new ProtocolError(`Macro data is ${data.length} bytes; the keyboard holds ${size}`);
    }
    const lastOffset = from16Bit(size - 1);
    await this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_RESET]);
    try {
      await this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, ...lastOffset, 1, 0xff]);
      const writes: Promise<Uint8Array>[] = [];
      for (let offset = 0; offset < data.length; offset += MAX_BUFFER_CHUNK) {
        const chunk = data.slice(offset, offset + MAX_BUFFER_CHUNK);
        writes.push(
          this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, ...from16Bit(offset), chunk.length, ...chunk]),
        );
      }
      await Promise.all(writes);
    } finally {
      await this.channel.request([Command.DYNAMIC_KEYMAP_MACRO_SET_BUFFER, ...lastOffset, 1, 0x00]);
    }
  }

  /** Reads a V3 custom menu value. Returns `length` bytes after the echoed channel and value id. */
  async getCustomMenuValue(channel: number, valueId: number, length: number): Promise<number[]> {
    const reply = await this.channel.request([Command.CUSTOM_MENU_GET_VALUE, channel, valueId]);
    return Array.from(reply.slice(3, 3 + length));
  }

  /** Sets a V3 custom menu value in RAM. Call {@link saveCustomMenu} to persist it. */
  async setCustomMenuValue(channel: number, valueId: number, data: readonly number[]): Promise<void> {
    await this.channel.request([Command.CUSTOM_MENU_SET_VALUE, channel, valueId, ...data]);
  }

  /** Persists a custom menu channel to EEPROM. */
  async saveCustomMenu(channel: number): Promise<void> {
    await this.channel.request([Command.CUSTOM_MENU_SAVE, channel]);
  }
}

/**
 * Groups changed keys into DYNAMIC_KEYMAP_SET_BUFFER segments. Each segment
 * spans at most 14 keys, so it costs exactly one HID report, and keys that
 * did not change but sit between changed ones are rewritten with their
 * current value.
 */
export const planKeymapSegments = (current: Keymap, target: Keymap): KeymapSegment[] => {
  const flatCurrent = current.flat();
  const flatTarget = target.flat();
  if (flatCurrent.length !== flatTarget.length) {
    throw new ProtocolError('Keymaps differ in size');
  }
  const keysPerReport = MAX_BUFFER_CHUNK / 2;
  const segments: KeymapSegment[] = [];
  let index = 0;
  while (index < flatTarget.length) {
    if (flatTarget[index] === flatCurrent[index]) {
      index++;
      continue;
    }
    const start = index;
    let lastChanged = index;
    for (let i = start; i < Math.min(start + keysPerReport, flatTarget.length); i++) {
      if (flatTarget[i] !== flatCurrent[i]) {
        lastChanged = i;
      }
    }
    segments.push({byteOffset: start * 2, keycodes: flatTarget.slice(start, lastChanged + 1)});
    index = lastChanged + 1;
  }
  return segments;
};
