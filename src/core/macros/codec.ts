/*
 * VIA macro encoding (protocol 11+), the macro expression language, and the
 * sequence optimisation used to print expressions.
 *
 * Ported from the-via/app src/utils/macro-api/macro-api.v11.ts,
 * macro-api.common.ts and types.ts (GPL-3.0, https://github.com/the-via/app,
 * commit 935106a990af39bdd1ade881c02366eac486240d).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 *
 * Changes from upstream: discriminated-union actions instead of tuples, no
 * eval for the lookbehind regexes, no keyboard I/O (see keyboard-api.ts),
 * unknown key bytes print as hex instead of `undefined`, and text is limited
 * to printable ASCII because QMK's send_string handles nothing else.
 */
import {ValidationError} from '../protocol/errors.ts';

/** Bytes QMK's send_string treats as "magic codes". */
export const MacroByte = {
  TERMINATOR: 0x00,
  PREFIX: 0x01,
  TAP: 0x01,
  DOWN: 0x02,
  UP: 0x03,
  DELAY: 0x04,
  /** Ends a delay's decimal digits: '|'. */
  DELAY_TERMINATOR: 0x7c,
} as const;

/** One step of a macro as it is stored on the keyboard. */
export type MacroAction =
  | {readonly type: 'tap'; readonly key: string}
  | {readonly type: 'down'; readonly key: string}
  | {readonly type: 'up'; readonly key: string}
  | {readonly type: 'delay'; readonly ms: number}
  | {readonly type: 'text'; readonly text: string};

/** A macro step after optimisation: adds chords such as `{KC_LCTL,KC_C}`. */
export type OptimizedMacroAction = MacroAction | {readonly type: 'chord'; readonly keys: readonly string[]};

export type MacroSequence = readonly MacroAction[];

/** Converts keycode names to the single byte a macro stores, and back. */
export interface MacroKeyResolver {
  /** Returns the 8-bit basic keycode for a name, or null. */
  byteOf(name: string): number | null;
  /** Returns a name for a byte. */
  nameOf(byte: number): string;
}

export const MAX_MACRO_DELAY_MS = 9999;

const hexByte = (byte: number) => `0x${byte.toString(16).padStart(2, '0')}`;

/** Decodes a protocol 11+ macro buffer into `macroCount` sequences (upstream readRawKeycodeSequences). */
export const decodeMacroBuffer = (
  bytes: readonly number[],
  macroCount: number,
  keys: MacroKeyResolver,
): MacroAction[][] => {
  const sequences: MacroAction[][] = [];
  let current: MacroAction[] = [];
  let i = 0;
  const pushText = (char: string) => {
    const last = current[current.length - 1];
    if (last?.type === 'text') {
      current[current.length - 1] = {type: 'text', text: last.text + char};
    } else {
      current.push({type: 'text', text: char});
    }
  };
  while (i < bytes.length && sequences.length < macroCount) {
    const byte = bytes[i] ?? 0;
    if (byte === MacroByte.TERMINATOR) {
      sequences.push(current);
      current = [];
    } else if (byte === MacroByte.PREFIX) {
      const action = bytes[++i];
      if (action === MacroByte.TAP || action === MacroByte.DOWN || action === MacroByte.UP) {
        const key = keys.nameOf(bytes[++i] ?? 0);
        current.push({type: action === MacroByte.TAP ? 'tap' : action === MacroByte.DOWN ? 'down' : 'up', key});
      } else if (action === MacroByte.DELAY) {
        let digits = '';
        let next = bytes[++i];
        while (next !== MacroByte.DELAY_TERMINATOR && i < bytes.length) {
          digits += String.fromCharCode(next ?? 0);
          next = bytes[++i];
        }
        current.push({type: 'delay', ms: Number.parseInt(digits, 10) || 0});
      } else {
        throw new ValidationError(`Macro byte ${i}: expected a key action after 0x01, got ${hexByte(action ?? 0)}`);
      }
    } else {
      pushText(String.fromCharCode(byte));
    }
    i++;
  }
  while (sequences.length < macroCount) {
    sequences.push([]);
  }
  return sequences;
};

/** Encodes sequences into a protocol 11+ macro buffer, each terminated by 0x00 (upstream rawKeycodeSequencesToMacroBytes). */
export const encodeMacros = (sequences: readonly MacroSequence[], keys: MacroKeyResolver): number[] =>
  sequences.flatMap((sequence, macroIndex) => {
    const bytes: number[] = [];
    for (const action of sequence) {
      switch (action.type) {
        case 'tap':
        case 'down':
        case 'up': {
          const byte = keys.byteOf(action.key);
          if (byte === null) {
            throw new ValidationError(`Macro ${macroIndex}: ${action.key} cannot be used in a macro`);
          }
          const code = action.type === 'tap' ? MacroByte.TAP : action.type === 'down' ? MacroByte.DOWN : MacroByte.UP;
          bytes.push(MacroByte.PREFIX, code, byte);
          break;
        }
        case 'delay': {
          if (!Number.isInteger(action.ms) || action.ms < 0 || action.ms > MAX_MACRO_DELAY_MS) {
            throw new ValidationError(`Macro ${macroIndex}: delay ${action.ms} must be 0-${MAX_MACRO_DELAY_MS} ms`);
          }
          bytes.push(MacroByte.PREFIX, MacroByte.DELAY, ...[...String(action.ms)].map((c) => c.charCodeAt(0)), MacroByte.DELAY_TERMINATOR);
          break;
        }
        case 'text':
          for (const char of action.text) {
            const code = char.charCodeAt(0);
            if (char.length !== 1 || code < 0x20 || code > 0x7e) {
              throw new ValidationError(`Macro ${macroIndex}: "${char}" is not printable ASCII; use a keycode instead`);
            }
            bytes.push(code);
          }
          break;
        default: {
          const unreachable: never = action;
          throw new ValidationError(`Unknown macro action ${JSON.stringify(unreachable)}`);
        }
      }
    }
    bytes.push(MacroByte.TERMINATOR);
    return bytes;
  });

// ---------------------------------------------------------------------------
// Expressions: "Hello{KC_ENT}{100}{KC_LCTL,KC_C}{+KC_LSFT}abc{-KC_LSFT}"
// ---------------------------------------------------------------------------

/** Splits "{KC_A}bcd{KC_E}" into blocks, honouring escaped braces "\{". */
const splitExpression = (expression: string): string[] =>
  expression.split(/(?<!\\)(\{.*?\})/g).filter((part) => part.length > 0);

/** Parses a macro expression (upstream expressionToSequence). */
export const expressionToSequence = (expression: string): OptimizedMacroAction[] => {
  const result: OptimizedMacroAction[] = [];
  for (const part of splitExpression(expression)) {
    if (/^\{.*\}$/.test(part)) {
      const inner = part.slice(1, -1);
      if (/^\d+$/.test(inner)) {
        result.push({type: 'delay', ms: Number.parseInt(inner, 10)});
        continue;
      }
      const direction = /^[+-]/.test(inner) ? inner[0] : null;
      const keys = inner
        .replace(/^[+-]/, '')
        .split(',')
        .map((key) => key.trim().toUpperCase())
        .filter((key) => key.length > 0);
      const first = keys[0];
      if (first === undefined) {
        continue;
      }
      if (direction === null) {
        result.push(keys.length === 1 ? {type: 'tap', key: first} : {type: 'chord', keys});
      } else {
        result.push({type: direction === '+' ? 'down' : 'up', key: first});
      }
    } else {
      result.push({type: 'text', text: part.replace(/\\\{/g, '{')});
    }
  }
  return result;
};

/** Expands chords into nested key downs and reversed key ups (upstream optimizedSequenceToRawSequence). */
export const optimizedToRaw = (sequence: readonly OptimizedMacroAction[]): MacroAction[] =>
  sequence.flatMap((action): MacroAction[] =>
    action.type === 'chord'
      ? [
          ...action.keys.map((key): MacroAction => ({type: 'down', key})),
          ...[...action.keys].reverse().map((key): MacroAction => ({type: 'up', key})),
        ]
      : [action],
  );

/**
 * Turns matching key downs and ups back into taps and chords (upstream
 * convertToTapsAndChords), so expressions read the way people write them.
 */
export const rawToOptimized = (sequence: MacroSequence): OptimizedMacroAction[] => {
  const seq = sequence.flatMap((action): MacroAction[] =>
    action.type === 'tap'
      ? [
          {type: 'down', key: action.key},
          {type: 'up', key: action.key},
        ]
      : [action],
  );
  const grouped: OptimizedMacroAction[] = [];
  let pending: MacroAction[] = [];
  let downKeys: string[] = [];
  let unmatched = 0;
  seq.forEach((action, index) => {
    let keepGoing = false;
    pending.push(action);
    if (action.type === 'down') {
      if (unmatched === downKeys.length) {
        downKeys.push(action.key);
        unmatched++;
        keepGoing = true;
      }
    } else if (action.type === 'up') {
      if (downKeys.length > 0 && action.key === downKeys[unmatched - 1]) {
        unmatched--;
        if (unmatched === 0) {
          const [only] = downKeys;
          grouped.push(downKeys.length === 1 && only !== undefined ? {type: 'tap', key: only} : {type: 'chord', keys: downKeys});
          pending = [];
        } else {
          keepGoing = true;
        }
      }
    }
    if (index === seq.length - 1) {
      keepGoing = false;
    }
    if (!keepGoing) {
      grouped.push(...pending);
      pending = [];
      downKeys = [];
      unmatched = 0;
    }
  });
  // Fold any remaining adjacent down/up pairs into taps.
  const result: OptimizedMacroAction[] = [];
  for (let i = 0; i < grouped.length; i++) {
    const current = grouped[i];
    const next = grouped[i + 1];
    if (current?.type === 'down' && next?.type === 'up' && current.key === next.key) {
      result.push({type: 'tap', key: current.key});
      i++;
    } else if (current) {
      result.push(current);
    }
  }
  return result;
};

/** Prints a sequence as an expression (upstream sequenceToExpression). */
export const sequenceToExpression = (sequence: readonly OptimizedMacroAction[]): string =>
  sequence
    .map((action) => {
      switch (action.type) {
        case 'tap':
          return `{${action.key}}`;
        case 'down':
          return `{+${action.key}}`;
        case 'up':
          return `{-${action.key}}`;
        case 'delay':
          return `{${action.ms}}`;
        case 'chord':
          return `{${action.keys.join(',')}}`;
        case 'text':
          return action.text.replace(/\{/g, '\\{');
        default: {
          const unreachable: never = action;
          return String(unreachable);
        }
      }
    })
    .join('');

export const expressionToRawSequence = (expression: string): MacroAction[] => optimizedToRaw(expressionToSequence(expression));

export const rawSequenceToExpression = (sequence: MacroSequence): string => sequenceToExpression(rawToOptimized(sequence));

export interface MacroValidation {
  readonly isValid: boolean;
  readonly errorMessage?: string;
}

/** Checks an expression before it is encoded (upstream validateMacroExpressionV11). */
export const validateMacroExpression = (expression: string, keys: MacroKeyResolver): MacroValidation => {
  if (/(?<!\\)\{(?![^{]*\})/.test(expression)) {
    return {isValid: false, errorMessage: "A keycode block {} is not closed. Add the missing '}'."};
  }
  const blocks = expression.matchAll(/(?<!\\)\{(.*?)\}/g);
  for (const [, body = ''] of blocks) {
    const csv = body.replace(/\s+/g, '');
    if (csv.length === 0) {
      return {isValid: false, errorMessage: 'Empty {} blocks cannot be saved. Write \\{} to type braces.'};
    }
    if (/^\d+$/.test(csv)) {
      if (Number(csv) > MAX_MACRO_DELAY_MS) {
        return {isValid: false, errorMessage: `Delay ${csv} is too long. Use ${MAX_MACRO_DELAY_MS} ms or less.`};
      }
      continue;
    }
    const invalid = csv
      .replace(/^[-+]/, '')
      .split(',')
      .filter((key) => key.length > 0 && keys.byteOf(key.toUpperCase()) === null);
    if (invalid.length > 0) {
      return {isValid: false, errorMessage: `Unknown keycodes inside {}: ${invalid.join(', ')}`};
    }
  }
  for (const part of splitExpression(expression)) {
    if (!/^\{.*\}$/.test(part) && /[^\x20-\x7e]/.test(part.replace(/\\\{/g, '{'))) {
      return {isValid: false, errorMessage: 'Text can only contain printable ASCII characters.'};
    }
  }
  return {isValid: true};
};

/** Bytes a set of expressions needs on the keyboard. */
export const macroBytesNeeded = (expressions: readonly string[], keys: MacroKeyResolver): number =>
  encodeMacros(expressions.map(expressionToRawSequence), keys).length;
