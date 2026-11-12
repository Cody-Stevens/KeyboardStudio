/** Named snapshots kept in this browser's IndexedDB. */
import {BrowserDb, Stores} from '../storage/browser-db.ts';
import {parseSnapshot, type KeyboardSnapshot} from './snapshot.ts';

export interface StoredSnapshot {
  readonly id: string;
  readonly name: string;
  readonly vendorProductId: number;
  readonly savedAt: string;
  readonly snapshot: KeyboardSnapshot;
}

export type SnapshotSummary = Omit<StoredSnapshot, 'snapshot'>;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class SnapshotLibrary {
  constructor(private readonly db: BrowserDb = new BrowserDb()) {}

  async save(name: string, snapshot: KeyboardSnapshot): Promise<StoredSnapshot> {
    const stored: StoredSnapshot = {
      id: newId(),
      name: name.trim() || 'Untitled snapshot',
      vendorProductId: snapshot.keyboard.vendorProductId,
      savedAt: new Date().toISOString(),
      snapshot,
    };
    await this.db.put(Stores.SNAPSHOTS, stored);
    return stored;
  }

  /** Summaries, newest first. Pass a vendorProductId to list one keyboard's snapshots. */
  async list(vendorProductId?: number): Promise<SnapshotSummary[]> {
    const all = await this.db.getAll<StoredSnapshot>(
      Stores.SNAPSHOTS,
      vendorProductId === undefined ? undefined : {name: 'vendorProductId', value: vendorProductId},
    );
    return all
      .map(({id, name, vendorProductId: vpid, savedAt}) => ({id, name, vendorProductId: vpid, savedAt}))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async get(id: string): Promise<KeyboardSnapshot | undefined> {
    const stored = await this.db.get<StoredSnapshot>(Stores.SNAPSHOTS, id);
    return stored ? parseSnapshot(stored.snapshot) : undefined;
  }

  async rename(id: string, name: string): Promise<void> {
    const stored = await this.db.get<StoredSnapshot>(Stores.SNAPSHOTS, id);
    if (stored) {
      await this.db.put(Stores.SNAPSHOTS, {...stored, name: name.trim() || stored.name});
    }
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(Stores.SNAPSHOTS, id);
  }
}
