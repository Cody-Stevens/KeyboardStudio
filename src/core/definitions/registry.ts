import {ValidationError} from '../protocol/errors.ts';
import {BrowserDb, Stores} from '../storage/browser-db.ts';
import {findBundledDefinition} from './bundled/index.ts';
import {lookupPublicDefinition, type PublicLookupOptions} from './lookup.ts';
import {parseDefinition} from './parse.ts';
import type {KeyboardDefinition} from './types.ts';

interface StoredDefinition {
  readonly vendorProductId: number;
  readonly name: string;
  readonly savedAt: string;
  readonly json: unknown;
}

export interface DefinitionRegistryOptions {
  readonly db?: BrowserDb;
  /** Look up unknown keyboards on usevia.app. Off by default. */
  readonly publicLookup?: false | PublicLookupOptions;
}

/**
 * Finds a definition for a keyboard. Order: a definition the user sideloaded
 * in this browser, then the bundled ones, then (if enabled) usevia.app.
 */
export class DefinitionRegistry {
  private readonly db: BrowserDb;
  private readonly publicLookup: false | PublicLookupOptions;

  constructor(options: DefinitionRegistryOptions = {}) {
    this.db = options.db ?? new BrowserDb();
    this.publicLookup = options.publicLookup ?? false;
  }

  async resolve(vendorProductId: number): Promise<KeyboardDefinition | null> {
    const sideloaded = await this.getSideloaded(vendorProductId);
    if (sideloaded) {
      return sideloaded;
    }
    const bundled = findBundledDefinition(vendorProductId);
    if (bundled) {
      return parseDefinition(bundled.json, 'bundled');
    }
    if (this.publicLookup !== false) {
      return lookupPublicDefinition(vendorProductId, this.publicLookup);
    }
    return null;
  }

  /** Parses a user-supplied definition and keeps it in this browser for its keyboard. */
  async sideload(json: unknown): Promise<KeyboardDefinition> {
    const definition = await parseDefinition(json, 'sideloaded');
    await this.db.put<StoredDefinition>(Stores.DEFINITIONS, {
      vendorProductId: definition.vendorProductId,
      name: definition.name,
      savedAt: new Date().toISOString(),
      json,
    });
    return definition;
  }

  async getSideloaded(vendorProductId: number): Promise<KeyboardDefinition | null> {
    let stored: StoredDefinition | undefined;
    try {
      stored = await this.db.get<StoredDefinition>(Stores.DEFINITIONS, vendorProductId);
    } catch {
      // IndexedDB unavailable (private mode, tests): fall through to bundled.
      return null;
    }
    if (!stored) {
      return null;
    }
    try {
      return await parseDefinition(stored.json, 'sideloaded');
    } catch (error) {
      throw new ValidationError(`The sideloaded definition for ${stored.name} no longer parses`, [String(error)]);
    }
  }

  async listSideloaded(): Promise<{vendorProductId: number; name: string; savedAt: string}[]> {
    const all = await this.db.getAll<StoredDefinition>(Stores.DEFINITIONS);
    return all.map(({vendorProductId, name, savedAt}) => ({vendorProductId, name, savedAt}));
  }

  async removeSideloaded(vendorProductId: number): Promise<void> {
    await this.db.delete(Stores.DEFINITIONS, vendorProductId);
  }
}
