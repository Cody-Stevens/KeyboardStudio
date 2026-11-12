/**
 * Definitions shipped with KeyboardStudio. Each entry is the manufacturer's
 * VIA JSON exactly as published, keyed by `vendorId * 65536 + productId`.
 *
 * To add a keyboard, drop its JSON in this folder and add a line below.
 */
import linky87 from './linky87.json';

export interface BundledDefinition {
  readonly vendorProductId: number;
  readonly name: string;
  readonly json: unknown;
}

const vpid = (vendorId: number, productId: number) => vendorId * 65536 + productId;

export const BUNDLED_DEFINITIONS: readonly BundledDefinition[] = [
  {vendorProductId: vpid(0x36b0, 0x3005), name: 'ELECFOX Linky87', json: linky87},
];

export const findBundledDefinition = (vendorProductId: number): BundledDefinition | undefined =>
  BUNDLED_DEFINITIONS.find((definition) => definition.vendorProductId === vendorProductId);
