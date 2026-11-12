/*
 * Byte helpers. shiftTo16Bit / shiftFrom16Bit and the bit packing helpers are
 * ported from the-via/app src/utils/keyboard-api.ts and src/utils/bit-pack.ts
 * (GPL-3.0). Copyright (C) The VIA authors. Modifications Copyright (C) 2026
 * Cody Stevens. Licensed under the GNU General Public License v3.0.
 */

export const to16Bit = (hi: number, lo: number): number => ((hi & 0xff) << 8) | (lo & 0xff);

export const from16Bit = (value: number): [number, number] => [(value >> 8) & 0xff, value & 0xff];

export const bytesTo32Bit = (bytes: readonly number[]): number =>
  (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;

export const from32Bit = (value: number): [number, number, number, number] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/** Big-endian 16-bit words from a byte array. */
export const bytesToWords = (bytes: ArrayLike<number>): number[] => {
  const words: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    words.push(to16Bit(bytes[i] ?? 0, bytes[i + 1] ?? 0));
  }
  return words;
};

/** Big-endian bytes from 16-bit words. */
export const wordsToBytes = (words: readonly number[]): number[] =>
  words.flatMap((word) => from16Bit(word));

export const toHex = (value: number, width = 4): string =>
  `0x${value.toString(16).padStart(width, '0')}`;

const MAX_BIT_SIZE = 5;

/** Number of bits VIA uses to store a layout option with `numChoices` choices. */
export const layoutOptionBitSize = (numChoices: number): number =>
  1 + Array.from({length: MAX_BIT_SIZE}).findIndex((_, idx) => 2 << idx >= numChoices);

/** Packs layout option choices into VIA's 32-bit layout options value. The last option uses the lowest bits. */
export const packLayoutOptions = (options: readonly {choice: number; numChoices: number}[]): number =>
  options.reduce((acc, {choice, numChoices}) => (acc << layoutOptionBitSize(numChoices)) | choice, 0) >>> 0;

/** Inverse of {@link packLayoutOptions}. */
export const unpackLayoutOptions = (value: number, numChoices: readonly number[]): number[] => {
  const result: number[] = [];
  let bits = value >>> 0;
  for (let i = numChoices.length - 1; i >= 0; i--) {
    const size = layoutOptionBitSize(numChoices[i] ?? 2);
    result.unshift(bits & ((1 << size) - 1));
    bits >>>= size;
  }
  return result;
};
