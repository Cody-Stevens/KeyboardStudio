import type {MatrixSize} from '../protocol/keyboard-api.ts';
import type {CustomKeycodeDefinition} from '../keycodes/keycode-table.ts';

/** One key as placed by the KLE layout, in key units. Mirrors @the-via/reader's VIAKey. */
export interface LayoutKey {
  readonly row: number;
  readonly col: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Rotation in degrees around (rx, ry). */
  readonly r: number;
  readonly rx: number;
  readonly ry: number;
  /** Second rectangle for stepped and ISO keys. */
  readonly x2?: number;
  readonly y2?: number;
  readonly w2?: number;
  readonly h2?: number;
  /** Decal: drawn but not a real key. */
  readonly d: boolean;
  readonly color: 'alpha' | 'mod' | 'accent';
  /** Encoder index, when the key is an encoder. */
  readonly ei?: number;
  /** LED index for per-key lighting. */
  readonly li?: number;
}

/**
 * A layout option such as "ISO Enter" (a toggle) or "Bottom Row" with
 * named choices. `choices` holds the choice labels; toggles get Off/On.
 */
export interface LayoutOption {
  readonly index: number;
  readonly label: string;
  readonly choices: readonly string[];
}

export interface KeyboardLayout {
  readonly width: number;
  readonly height: number;
  /** Keys that are always present. */
  readonly keys: readonly LayoutKey[];
  /** Alternative keys: `optionKeys[optionIndex][choiceIndex]`. */
  readonly optionKeys: Readonly<Record<string, Readonly<Record<string, readonly LayoutKey[]>>>>;
  readonly options: readonly LayoutOption[];
}

export type ControlType = 'range' | 'dropdown' | 'color' | 'toggle' | 'button' | 'keycode' | 'label' | 'color-palette';

export interface RangeConstraintDef {
  readonly operator: '<' | '<=' | '>' | '>=';
  readonly reference: string;
  readonly offset?: number;
  readonly onViolation?: 'clamp' | 'push';
}

/** A control bound to a custom menu value: `commandId` on `channel` / `valueId`. */
export interface MenuControl {
  readonly kind: 'control';
  /** Stable path id such as `menu0.1.2`, unique within the definition. */
  readonly path: string;
  readonly label: string;
  readonly type: ControlType;
  readonly commandId: string;
  readonly channel: number;
  readonly valueId: number;
  /** Bytes the value occupies on the keyboard. */
  readonly byteLength: number;
  readonly showIf?: string;
  /** Range: [min, max]. */
  readonly range?: readonly [number, number];
  readonly unit?: string;
  readonly constraints?: readonly RangeConstraintDef[];
  /** Dropdown: label and the bytes to write for each choice. */
  readonly choices?: readonly {readonly label: string; readonly value: readonly number[]}[];
  /** Toggle: bytes for off and on. */
  readonly toggleValues?: readonly [readonly number[], readonly number[]];
  /** Button: bytes to write when pressed. */
  readonly buttonValue?: readonly number[];
}

/** Static text, or a label with no command. */
export interface MenuText {
  readonly kind: 'text';
  readonly path: string;
  readonly label: string;
  readonly text: string;
  readonly showIf?: string;
}

/** A menu, submenu or conditional slice. Submenus of a top-level menu are the lighting zones. */
export interface MenuGroup {
  readonly kind: 'group';
  readonly path: string;
  readonly label?: string;
  readonly showIf?: string;
  readonly children: readonly MenuNode[];
}

export type MenuNode = MenuControl | MenuText | MenuGroup;

export type DefinitionSource = 'bundled' | 'sideloaded' | 'public' | 'inline';

/**
 * A keyboard definition after parsing and validation. `via` keeps the
 * compiled @the-via/reader form for anything this type does not normalise.
 */
export interface KeyboardDefinition {
  readonly format: 'v2' | 'v3';
  readonly source: DefinitionSource;
  readonly name: string;
  readonly vendorId: number;
  readonly productId: number;
  /** `vendorId * 65536 + productId`, the key VIA uses everywhere. */
  readonly vendorProductId: number;
  readonly firmwareVersion: number;
  readonly matrix: MatrixSize;
  readonly layout: KeyboardLayout;
  /** Top-level menus with common menus resolved. */
  readonly menus: readonly MenuGroup[];
  readonly customKeycodes: readonly CustomKeycodeDefinition[];
  readonly keycodeModules: readonly string[];
  readonly commonMenuIds: readonly string[];
  readonly hasV2Lighting: boolean;
  readonly via: unknown;
}
