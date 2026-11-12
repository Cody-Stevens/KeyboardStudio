/**
 * Optional lookup of public definitions from usevia.app.
 *
 * usevia.app serves the build output of the-via/keyboards (GPL-3.0):
 * `/definitions/supported_kbs.json` lists vendor/product ids, and
 * `/definitions/v3/<vendorProductId>.json` holds a compiled V3 definition.
 * Both answer with `Access-Control-Allow-Origin: *` (checked 2026-11-12).
 * Ids listed under `v2` also have a V3 file. A missing id falls back to the
 * site's HTML page with status 200, so the index is checked first and the
 * reply must parse as JSON.
 *
 * This is not a documented API. It is off unless the caller opts in.
 */
import {ValidationError} from '../protocol/errors.ts';
import {parseDefinition} from './parse.ts';
import type {KeyboardDefinition} from './types.ts';

export const USEVIA_DEFINITIONS_URL = 'https://usevia.app/definitions';

export interface PublicDefinitionIndex {
  readonly generatedAt: number;
  /** Ids with a V3 file (every id in either list). */
  readonly vendorProductIds: ReadonlySet<number>;
}

export interface PublicLookupOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

const getFetch = (options: PublicLookupOptions): typeof fetch => options.fetch ?? globalThis.fetch.bind(globalThis);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

let cachedIndex: {url: string; index: Promise<PublicDefinitionIndex>} | undefined;

export const fetchPublicDefinitionIndex = (options: PublicLookupOptions = {}): Promise<PublicDefinitionIndex> => {
  const url = `${options.baseUrl ?? USEVIA_DEFINITIONS_URL}/supported_kbs.json`;
  if (cachedIndex?.url === url) {
    return cachedIndex.index;
  }
  const index = (async () => {
    const response = await getFetch(options)(url, options.signal ? {signal: options.signal} : {});
    if (!response.ok) {
      throw new ValidationError(`Definition index request failed with HTTP ${response.status}`);
    }
    const json: unknown = await response.json();
    if (!isRecord(json) || !isRecord(json['vendorProductIds'])) {
      throw new ValidationError('The definition index has an unexpected shape');
    }
    const ids = Object.values(json['vendorProductIds']).flatMap((list) =>
      Array.isArray(list) ? list.filter((id): id is number => typeof id === 'number') : [],
    );
    return {generatedAt: Number(json['generatedAt'] ?? 0), vendorProductIds: new Set(ids)};
  })();
  cachedIndex = {url, index};
  index.catch(() => {
    if (cachedIndex?.index === index) {
      cachedIndex = undefined;
    }
  });
  return index;
};

/** Fetches and parses the public V3 definition for a keyboard, or returns null if none is listed. */
export const lookupPublicDefinition = async (
  vendorProductId: number,
  options: PublicLookupOptions = {},
): Promise<KeyboardDefinition | null> => {
  const index = await fetchPublicDefinitionIndex(options);
  if (!index.vendorProductIds.has(vendorProductId)) {
    return null;
  }
  const url = `${options.baseUrl ?? USEVIA_DEFINITIONS_URL}/v3/${vendorProductId}.json`;
  const response = await getFetch(options)(url, options.signal ? {signal: options.signal} : {});
  if (!response.ok) {
    throw new ValidationError(`Definition request failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValidationError('The public definition is not JSON');
  }
  return parseDefinition(json, 'public');
};
