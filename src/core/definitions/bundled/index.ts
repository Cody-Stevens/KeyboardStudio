/**
 * Definitions shipped with KeyboardStudio. Each entry is the manufacturer's
 * VIA JSON exactly as published, keyed by `vendorId * 65536 + productId`,
 * plus an optional presentation meta file (layer names, lighting zones,
 * custom key names; see `../board-meta.ts`).
 *
 * To add a keyboard, drop its JSON in this folder and add a line below.
 */
import type {BoardMetaSource} from '../board-meta.ts';
import linky87 from './linky87.json';
import {linky87Meta} from './linky87.meta.ts';

export interface BundledDefinition {
  readonly vendorProductId: number;
  readonly name: string;
  readonly json: unknown;
  readonly meta?: BoardMetaSource;
}

const vpid = (vendorId: number, productId: number) => vendorId * 65536 + productId;

export const BUNDLED_DEFINITIONS: readonly BundledDefinition[] = [
  {vendorProductId: vpid(0x36b0, 0x3005), name: 'ELECFOX Linky87', json: linky87, meta: linky87Meta},
];

export const findBundledDefinition = (vendorProductId: number): BundledDefinition | undefined =>
  BUNDLED_DEFINITIONS.find((definition) => definition.vendorProductId === vendorProductId);

/** The presentation meta for a board, whether its definition is bundled or sideloaded. */
export const findBundledMeta = (vendorProductId: number): BoardMetaSource | undefined =>
  findBundledDefinition(vendorProductId)?.meta;
