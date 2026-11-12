/**
 * A mock ELECFOX Linky87 seeded with state read from the owner's keyboard on
 * 2026-11-12 using GET commands only: the keymap dump, the custom menu
 * values of the three lighting zones, layout options and firmware version.
 */
import {MockKeyboard, type MockKeyboardSeed} from '../transport/mock-keyboard.ts';
import {MockTransport, type MockTransportOptions} from '../transport/mock-transport.ts';
import keymap from './seeds/linky87-keymap-2026-11-12.json';

export const LINKY87_VENDOR_ID = 0x36b0;
export const LINKY87_PRODUCT_ID = 0x3005;

/**
 * Lighting values as the keyboard reported them. The backlight brightness
 * reads 255 although the definition's range is 0-160; the mock keeps that.
 */
export const LINKY87_LIGHTING_SEED: Readonly<Record<string, readonly number[]>> = {
  // logo (channel 2): brightness, effect "fixed wave", speed, color [hue, sat]
  '2:1': [160],
  '2:2': [2],
  '2:3': [2],
  '2:4': [17, 255],
  // backlight / RGB matrix (channel 3): effect 31 = solid_reactive
  '3:1': [255],
  '3:2': [31],
  '3:3': [54],
  '3:4': [254, 254],
  // side (channel 4)
  '4:1': [160],
  '4:2': [2],
  '4:3': [2],
  '4:4': [0, 255],
};

export const linky87Seed = (): MockKeyboardSeed => ({
  protocolVersion: 12,
  layerCount: 4,
  rows: 6,
  cols: 16,
  keymap,
  macroCount: 16,
  macroBufferSize: 338,
  macroBuffer: [],
  customValues: LINKY87_LIGHTING_SEED,
  customChannels: [2, 3, 4],
  layoutOptions: 0,
  firmwareVersion: 0,
});

export const createLinky87Mock = (options: MockTransportOptions = {}): MockTransport =>
  new MockTransport(new MockKeyboard(linky87Seed()), {
    ...options,
    info: {vendorId: LINKY87_VENDOR_ID, productId: LINKY87_PRODUCT_ID, productName: 'Linky87 (mock)', ...options.info},
  });
