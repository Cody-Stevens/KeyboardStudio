import fixture from './fixtures/linky87-keymap-2026-11-12.json';
import {
  CommandChannel,
  KeyboardApi,
  createLinky87Mock,
  findBundledDefinition,
  parseDefinition,
  type KeyboardDefinition,
  type MockTransportOptions,
} from '../src/core/index.ts';

export const LINKY87_VPID = 0x36b0 * 65536 + 0x3005;

/** The real keymap read from the keyboard on 2026-11-12, `[layer][row][col]`. */
export const keymapFixture: number[][][] = fixture;

export const linky87Definition = async (): Promise<KeyboardDefinition> => {
  const bundled = findBundledDefinition(LINKY87_VPID);
  if (!bundled) {
    throw new Error('Linky87 definition is not bundled');
  }
  return parseDefinition(bundled.json, 'bundled');
};

export const connectApi = async (options: MockTransportOptions & {readOnly?: boolean; timeoutMs?: number} = {}) => {
  const transport = createLinky87Mock(options);
  await transport.open();
  const channel = new CommandChannel(transport, {
    ...(options.readOnly === undefined ? {} : {readOnly: options.readOnly}),
    ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs}),
  });
  return {transport, keyboard: transport.keyboard, channel, api: new KeyboardApi(channel)};
};
