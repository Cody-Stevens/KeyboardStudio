/*
 * Definition parsing on top of @the-via/reader (GPL-3.0,
 * https://github.com/the-via/reader). Menu flattening follows
 * the-via/app src/store/menusSlice.ts (extractCommands, compileMenu) and
 * src/components/panes/configure-panes/custom/custom-control.tsx.
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */
import {ValidationError, errorMessage} from '../protocol/errors.ts';
import type {
  ControlType,
  DefinitionSource,
  KeyboardDefinition,
  KeyboardLayout,
  LayoutKey,
  LayoutOption,
  MenuControl,
  MenuGroup,
  MenuNode,
  RangeConstraintDef,
} from './types.ts';

type Reader = typeof import('@the-via/reader');

let readerPromise: Promise<Reader> | undefined;

/**
 * Loads @the-via/reader on first use. Its JSON schema validators are compiled
 * when the module loads, and ajv logs a few hundred strict-mode warnings
 * while doing so; those are silenced for the duration of the load only.
 * Loading lazily also keeps ajv out of the initial page bundle.
 */
export const loadReader = (): Promise<Reader> => {
  readerPromise ??= (async () => {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const module = await import('@the-via/reader');
      // CommonJS interop: Vite and Node expose the exports on `default`.
      const candidate = (module as unknown as {default?: Reader}).default;
      return candidate && typeof candidate.keyboardDefinitionV3ToVIADefinitionV3 === 'function' ? candidate : module;
    } finally {
      console.warn = warn;
    }
  })();
  return readerPromise;
};

/**
 * Starts loading the definition parser in the background. The first load
 * compiles @the-via/reader's JSON schemas, which takes a few hundred
 * milliseconds; call this at page load so the first connect does not wait.
 */
export const preloadDefinitionParser = (): void => {
  void loadReader().catch(() => undefined);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const CONTROL_TYPES: ReadonlySet<string> = new Set<ControlType>([
  'range',
  'dropdown',
  'color',
  'toggle',
  'button',
  'keycode',
  'label',
  'color-palette',
]);

const isCommandContent = (content: unknown): content is [string, number, number, ...number[]] =>
  Array.isArray(content) &&
  content.length >= 3 &&
  typeof content[0] === 'string' &&
  content.slice(1).every((value) => typeof value === 'number');

const boxed = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : typeof value === 'number' ? [value] : [];

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const normalizeControl = (item: Record<string, unknown>, path: string): MenuControl | null => {
  const type = item['type'];
  const content = item['content'];
  if (typeof type !== 'string' || !CONTROL_TYPES.has(type) || !isCommandContent(content)) {
    return null;
  }
  const [commandId, channel, valueId] = content;
  const options = item['options'];
  const explicitBytes = typeof item['bytes'] === 'number' ? item['bytes'] : undefined;
  const label = optionalString(item['label']) ?? commandId;
  const showIf = optionalString(item['showIf']);
  const base = {kind: 'control' as const, path, label, type: type as ControlType, commandId, channel, valueId};
  const withShowIf = showIf === undefined ? {} : {showIf};

  switch (type) {
    case 'range': {
      const [min = 0, max = 255] = boxed(options);
      const unit = optionalString(item['unit']);
      const constraints = Array.isArray(item['constraints'])
        ? item['constraints'].filter(isRecord).map(
            (constraint): RangeConstraintDef => ({
              operator: constraint['operator'] as RangeConstraintDef['operator'],
              reference: Array.isArray(constraint['reference'])
                ? String(constraint['reference'][0])
                : String(constraint['reference']),
              ...(typeof constraint['offset'] === 'number' ? {offset: constraint['offset']} : {}),
              ...(constraint['onViolation'] === 'push' || constraint['onViolation'] === 'clamp'
                ? {onViolation: constraint['onViolation']}
                : {}),
            }),
          )
        : undefined;
      return {
        ...base,
        ...withShowIf,
        byteLength: explicitBytes ?? (max > 255 ? 2 : 1),
        range: [min, max],
        ...(unit === undefined ? {} : {unit}),
        ...(constraints === undefined ? {} : {constraints}),
      };
    }
    case 'dropdown': {
      const choices = (Array.isArray(options) ? options : []).map((option: unknown, idx) => {
        if (typeof option === 'string') {
          return {label: option, value: [idx]};
        }
        const [choiceLabel, ...value] = Array.isArray(option) ? option : [String(option)];
        const bytes = boxed(value);
        return {label: String(choiceLabel), value: bytes.length ? bytes : [idx]};
      });
      const byteLength = explicitBytes ?? Math.max(1, ...choices.map((choice) => choice.value.length));
      return {...base, ...withShowIf, byteLength, choices};
    }
    case 'toggle': {
      const [off, on] = Array.isArray(options) && options.length === 2 ? options : [0, 1];
      const toggleValues: [number[], number[]] = [boxed(off), boxed(on)];
      return {
        ...base,
        ...withShowIf,
        byteLength: explicitBytes ?? Math.max(toggleValues[0].length, toggleValues[1].length, 1),
        toggleValues,
      };
    }
    case 'button':
      return {...base, ...withShowIf, byteLength: explicitBytes ?? 1, buttonValue: boxed(options).length ? boxed(options) : [1]};
    case 'color':
      return {...base, ...withShowIf, byteLength: 2};
    case 'keycode':
      return {...base, ...withShowIf, byteLength: 2};
    case 'label':
      // A label bound to a command shows a null-terminated string from the keyboard.
      return {...base, ...withShowIf, byteLength: explicitBytes ?? 29};
    default:
      return {...base, ...withShowIf, byteLength: explicitBytes ?? 1};
  }
};

const normalizeNode = (node: unknown, path: string): MenuNode | null => {
  if (!isRecord(node)) {
    return null;
  }
  const label = optionalString(node['label']);
  const showIf = optionalString(node['showIf']);
  const content = node['content'];
  if (typeof node['type'] === 'string') {
    if (node['type'] === 'label' && Array.isArray(content) && content.length === 1 && typeof content[0] === 'string') {
      return {kind: 'text', path, label: label ?? '', text: content[0], ...(showIf === undefined ? {} : {showIf})};
    }
    return normalizeControl(node, path);
  }
  if (typeof content === 'string') {
    return {kind: 'text', path, label: label ?? '', text: content, ...(showIf === undefined ? {} : {showIf})};
  }
  if (Array.isArray(content)) {
    return {
      kind: 'group',
      path,
      ...(label === undefined ? {} : {label}),
      ...(showIf === undefined ? {} : {showIf}),
      children: content.flatMap((child, idx) => normalizeNode(child, `${path}.${idx}`) ?? []),
    };
  }
  return null;
};

/** Normalises VIA menus (V3 `menus` or V2 `customMenus`), resolving common menu ids. */
export const normalizeMenus = (menus: readonly unknown[], commonMenus: Readonly<Record<string, unknown>>): MenuGroup[] =>
  menus
    .flatMap((menu) => {
      if (typeof menu !== 'string') {
        return [menu];
      }
      const common = commonMenus[menu];
      if (common === undefined) {
        throw new ValidationError(`Unknown common menu "${menu}"`);
      }
      return Array.isArray(common) ? common : [common];
    })
    .flatMap((menu, idx) => {
      const node = normalizeNode(menu, `menu${idx}`);
      return node?.kind === 'group' ? [node] : [];
    });

/** Every control in a menu tree, depth first. */
export const collectControls = (nodes: readonly MenuNode[]): MenuControl[] =>
  nodes.flatMap((node) =>
    node.kind === 'control' ? [node] : node.kind === 'group' ? collectControls(node.children) : [],
  );

const toLayoutKey = (key: Record<string, unknown>): LayoutKey => {
  const num = (name: string, fallback = 0) => (typeof key[name] === 'number' ? (key[name] as number) : fallback);
  const optional = (name: string) => (typeof key[name] === 'number' ? {[name]: key[name] as number} : {});
  const color = key['color'];
  return {
    row: num('row'),
    col: num('col'),
    x: num('x'),
    y: num('y'),
    w: num('w', 1),
    h: num('h', 1),
    r: num('r'),
    rx: num('rx'),
    ry: num('ry'),
    d: key['d'] === true,
    color: color === 'alpha' || color === 'mod' || color === 'accent' ? color : 'alpha',
    ...optional('x2'),
    ...optional('y2'),
    ...optional('w2'),
    ...optional('h2'),
    ...optional('ei'),
    ...optional('li'),
  } as LayoutKey;
};

const toLayout = (layouts: Record<string, unknown>): KeyboardLayout => {
  const keys = Array.isArray(layouts['keys']) ? layouts['keys'].filter(isRecord).map(toLayoutKey) : [];
  const rawOptionKeys = isRecord(layouts['optionKeys']) ? layouts['optionKeys'] : {};
  const optionKeys: Record<string, Record<string, LayoutKey[]>> = {};
  for (const [group, choices] of Object.entries(rawOptionKeys)) {
    if (!isRecord(choices)) {
      continue;
    }
    optionKeys[group] = Object.fromEntries(
      Object.entries(choices).map(([choice, choiceKeys]) => [
        choice,
        Array.isArray(choiceKeys) ? choiceKeys.filter(isRecord).map(toLayoutKey) : [],
      ]),
    );
  }
  const labels = Array.isArray(layouts['labels']) ? layouts['labels'] : [];
  const options: LayoutOption[] = labels.map((label: unknown, index) =>
    Array.isArray(label)
      ? {index, label: String(label[0]), choices: label.slice(1).map(String)}
      : {index, label: String(label), choices: ['Off', 'On']},
  );
  return {
    width: typeof layouts['width'] === 'number' ? layouts['width'] : 0,
    height: typeof layouts['height'] === 'number' ? layouts['height'] : 0,
    keys,
    optionKeys,
    options,
  };
};

const definitionName = (name: unknown): string => {
  if (typeof name === 'string') {
    return name;
  }
  if (isRecord(name) && Array.isArray(name['options']) && typeof name['options'][0] === 'string') {
    return name['options'][0];
  }
  return 'Unknown keyboard';
};

const fromCompiled = (via: Record<string, unknown>, format: 'v2' | 'v3', source: DefinitionSource, reader: Reader): KeyboardDefinition => {
  const vendorProductId = Number(via['vendorProductId']);
  const matrix = isRecord(via['matrix']) ? via['matrix'] : {};
  const rawMenus = format === 'v3' ? via['menus'] : via['customMenus'];
  const menuList = Array.isArray(rawMenus) ? rawMenus : [];
  const customKeycodes = Array.isArray(via['customKeycodes'])
    ? via['customKeycodes'].filter(isRecord).map((keycode) => ({
        name: String(keycode['name'] ?? ''),
        title: String(keycode['title'] ?? keycode['name'] ?? ''),
        ...(typeof keycode['shortName'] === 'string' ? {shortName: keycode['shortName']} : {}),
      }))
    : [];
  return {
    format,
    source,
    name: definitionName(via['name']),
    vendorId: Math.floor(vendorProductId / 65536),
    productId: vendorProductId % 65536,
    vendorProductId,
    firmwareVersion: typeof via['firmwareVersion'] === 'number' ? via['firmwareVersion'] : 0,
    matrix: {rows: Number(matrix['rows'] ?? 0), cols: Number(matrix['cols'] ?? 0)},
    layout: toLayout(isRecord(via['layouts']) ? via['layouts'] : {}),
    menus: normalizeMenus(menuList, reader.commonMenus as unknown as Record<string, unknown>),
    customKeycodes,
    keycodeModules: Array.isArray(via['keycodes']) ? via['keycodes'].map(String) : [],
    commonMenuIds: menuList.filter((menu): menu is string => typeof menu === 'string'),
    hasV2Lighting: format === 'v2' && via['lighting'] !== undefined,
    via,
  };
};

const validatorErrors = (validator: {errors?: unknown}): string[] =>
  Array.isArray(validator.errors)
    ? validator.errors
        .slice(0, 5)
        .map((error: {instancePath?: string; message?: string}) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    : [];

/**
 * Parses a definition in any of the four shapes VIA uses: an authored V3 or
 * V2 keyboard definition (with `layouts.keymap`, as in the-via/keyboards), or
 * a compiled V3 or V2 definition (with `vendorProductId` and `layouts.keys`,
 * as usevia.app serves them).
 */
export const parseDefinition = async (json: unknown, source: DefinitionSource = 'inline'): Promise<KeyboardDefinition> => {
  if (!isRecord(json)) {
    throw new ValidationError('A keyboard definition must be a JSON object');
  }
  const reader = await loadReader();
  try {
    if (isRecord(json['layouts']) && 'keymap' in json['layouts']) {
      if (reader.isKeyboardDefinitionV3(json)) {
        return fromCompiled(reader.keyboardDefinitionV3ToVIADefinitionV3(json) as unknown as Record<string, unknown>, 'v3', source, reader);
      }
      const v3Errors = validatorErrors(reader.isKeyboardDefinitionV3);
      if (reader.isKeyboardDefinitionV2(json)) {
        return fromCompiled(reader.keyboardDefinitionV2ToVIADefinitionV2(json) as unknown as Record<string, unknown>, 'v2', source, reader);
      }
      throw new ValidationError('The definition is not a valid VIA V3 or V2 definition', v3Errors);
    }
    if ('vendorProductId' in json) {
      if (reader.isVIADefinitionV3(json)) {
        return fromCompiled(json, 'v3', source, reader);
      }
      const v3Errors = validatorErrors(reader.isVIADefinitionV3);
      if (reader.isVIADefinitionV2(json)) {
        return fromCompiled(json, 'v2', source, reader);
      }
      throw new ValidationError('The compiled definition is not valid', v3Errors);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('The definition could not be parsed', [errorMessage(error)]);
  }
  throw new ValidationError('The JSON is not a keyboard definition: it has neither layouts.keymap nor vendorProductId');
};
