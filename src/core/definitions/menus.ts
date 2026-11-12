/*
 * Reading and writing custom menu control values. Value encoding follows
 * the-via/app src/components/panes/configure-panes/custom/custom-control.tsx
 * and src/utils/range-constraints.ts (GPL-3.0).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */
import {ValidationError} from '../protocol/errors.ts';
import {collectControls} from './parse.ts';
import {evaluateShowIf, type ShowIfValues} from './show-if.ts';
import type {KeyboardDefinition, MenuControl, MenuGroup, MenuNode} from './types.ts';

/** Raw bytes per command id, as read from the keyboard. */
export type MenuValues = Readonly<Record<string, readonly number[]>>;

/**
 * A lighting zone: one submenu of a top-level menu, such as the Linky87's
 * "logo", "Backlight" and "side". Zones are taken from the definition, so
 * any VIA V3 keyboard gets them.
 */
export interface MenuZone {
  /** Path of the submenu, stable for a given definition. */
  readonly id: string;
  readonly label: string;
  readonly menuLabel: string;
  readonly controls: readonly MenuControl[];
  /** Custom menu channels the zone's controls use. */
  readonly channels: readonly number[];
}

export const getMenuZones = (definition: Pick<KeyboardDefinition, 'menus'>): MenuZone[] =>
  definition.menus.flatMap((menu: MenuGroup) => {
    const submenus = menu.children.filter((child): child is MenuGroup => child.kind === 'group' && child.label !== undefined);
    const groups = submenus.length > 0 ? submenus : [menu];
    return groups.map((group) => {
      const controls = collectControls(group.children);
      return {
        id: group.path,
        label: group.label ?? menu.label ?? group.path,
        menuLabel: menu.label ?? '',
        controls,
        channels: [...new Set(controls.map((control) => control.channel))],
      };
    });
  });

/** Every control in the definition's menus that reads a value from the keyboard. */
export const getReadableControls = (definition: Pick<KeyboardDefinition, 'menus'>): MenuControl[] => {
  const seen = new Set<string>();
  return definition.menus
    .flatMap((menu) => collectControls(menu.children))
    .filter((control) => {
      if (control.type === 'color-palette' || seen.has(control.commandId)) {
        return false;
      }
      seen.add(control.commandId);
      return true;
    });
};

export const findControl = (definition: Pick<KeyboardDefinition, 'menus'>, commandId: string): MenuControl | undefined =>
  definition.menus.flatMap((menu) => collectControls(menu.children)).find((control) => control.commandId === commandId);

/** Whether a node is shown, given the current values. Groups hide their children too. */
export const isNodeVisible = (node: Pick<MenuNode, 'showIf'>, values: ShowIfValues): boolean =>
  evaluateShowIf(node.showIf, values);

/** Controls of a zone that are visible with the current values. */
export const visibleControls = (definition: Pick<KeyboardDefinition, 'menus'>, values: ShowIfValues): MenuControl[] => {
  const walk = (nodes: readonly MenuNode[]): MenuControl[] =>
    nodes.flatMap((node) => {
      if (!isNodeVisible(node, values)) {
        return [];
      }
      if (node.kind === 'control') {
        return [node];
      }
      return node.kind === 'group' ? walk(node.children) : [];
    });
  return definition.menus.flatMap((menu) => (isNodeVisible(menu, values) ? walk(menu.children) : []));
};

export type ControlValue =
  | {readonly type: 'range'; readonly value: number}
  | {readonly type: 'dropdown'; readonly value: number; readonly label: string | undefined}
  | {readonly type: 'toggle'; readonly value: boolean}
  | {readonly type: 'color'; readonly hue: number; readonly sat: number}
  | {readonly type: 'keycode'; readonly value: number}
  | {readonly type: 'label'; readonly text: string}
  | {readonly type: 'button'}
  | {readonly type: 'color-palette'};

const sameBytes = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Interprets raw bytes for a control. */
export const decodeControlValue = (control: MenuControl, bytes: readonly number[]): ControlValue => {
  const b = (i: number) => bytes[i] ?? 0;
  switch (control.type) {
    case 'range':
      return {type: 'range', value: control.byteLength >= 2 ? (b(0) << 8) | b(1) : b(0)};
    case 'dropdown': {
      const length = control.byteLength;
      const choice = control.choices?.find((c) => sameBytes(c.value, bytes.slice(0, Math.max(length, c.value.length))));
      return {type: 'dropdown', value: b(0), label: choice?.label};
    }
    case 'toggle': {
      const on = control.toggleValues?.[1] ?? [1];
      return {type: 'toggle', value: on.every((value, idx) => value === bytes[idx])};
    }
    case 'color':
      return {type: 'color', hue: b(0), sat: b(1)};
    case 'keycode':
      return {type: 'keycode', value: (b(0) << 8) | b(1)};
    case 'label': {
      const end = bytes.indexOf(0);
      return {type: 'label', text: new TextDecoder().decode(new Uint8Array(bytes.slice(0, end === -1 ? undefined : end)))};
    }
    case 'button':
      return {type: 'button'};
    case 'color-palette':
      return {type: 'color-palette'};
    default: {
      const unreachable: never = control.type;
      throw new ValidationError(`Unknown control type ${String(unreachable)}`);
    }
  }
};

export type ControlInput =
  | {readonly type: 'range'; readonly value: number}
  | {readonly type: 'dropdown'; readonly value: number}
  | {readonly type: 'toggle'; readonly value: boolean}
  | {readonly type: 'color'; readonly hue: number; readonly sat: number}
  | {readonly type: 'keycode'; readonly value: number}
  | {readonly type: 'button'};

const byte = (value: number, what: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new ValidationError(`${what} must be an integer from 0 to 255`);
  }
  return value;
};

/**
 * Bytes to write for a control. Range values are checked against the
 * definition's [min, max]; a keyboard can still report values outside it
 * (the Linky87 reports backlight brightness 255 with a 0-160 range), and
 * those are displayed as read, never rewritten.
 */
export const encodeControlValue = (control: MenuControl, input: ControlInput): number[] => {
  if (input.type !== control.type) {
    throw new ValidationError(`${control.commandId} is a ${control.type} control, not ${input.type}`);
  }
  switch (input.type) {
    case 'range': {
      const [min, max] = control.range ?? [0, 255];
      if (!Number.isInteger(input.value) || input.value < min || input.value > max) {
        throw new ValidationError(`${control.label} must be from ${min} to ${max}`);
      }
      return control.byteLength >= 2 ? [(input.value >> 8) & 0xff, input.value & 0xff] : [input.value];
    }
    case 'dropdown': {
      const choice = control.choices?.find((c) => c.value[0] === input.value);
      if (!choice) {
        throw new ValidationError(`${input.value} is not an option for ${control.label}`);
      }
      return [...choice.value];
    }
    case 'toggle':
      return [...(control.toggleValues?.[input.value ? 1 : 0] ?? [input.value ? 1 : 0])];
    case 'color':
      return [byte(input.hue, 'Hue'), byte(input.sat, 'Saturation')];
    case 'keycode':
      return [(input.value >> 8) & 0xff, input.value & 0xff];
    case 'button':
      return [...(control.buttonValue ?? [1])];
    default: {
      const unreachable: never = input;
      throw new ValidationError(`Unknown control input ${JSON.stringify(unreachable)}`);
    }
  }
};
