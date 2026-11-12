/**
 * Minimal IndexedDB wrapper for data that stays in this browser: named
 * snapshots and sideloaded definitions. There is no server.
 */
import {KeyboardStudioError} from '../protocol/errors.ts';

export const DB_NAME = 'keyboard-studio';
export const DB_VERSION = 1;

export const Stores = {
  SNAPSHOTS: 'snapshots',
  DEFINITIONS: 'definitions',
} as const;

type StoreName = (typeof Stores)[keyof typeof Stores];

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new KeyboardStudioError('IndexedDB request failed'));
  });

export class BrowserDb {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
    private readonly name: string = DB_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(new KeyboardStudioError('IndexedDB is not available in this environment'));
    }
    const factory = this.factory;
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(Stores.SNAPSHOTS)) {
          const snapshots = db.createObjectStore(Stores.SNAPSHOTS, {keyPath: 'id'});
          snapshots.createIndex('vendorProductId', 'vendorProductId');
        }
        if (!db.objectStoreNames.contains(Stores.DEFINITIONS)) {
          db.createObjectStore(Stores.DEFINITIONS, {keyPath: 'vendorProductId'});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new KeyboardStudioError('Could not open IndexedDB'));
    });
    return this.dbPromise;
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.open();
    return requestToPromise<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
  }

  async getAll<T>(store: StoreName, index?: {name: string; value: IDBValidKey}): Promise<T[]> {
    const db = await this.open();
    const objectStore = db.transaction(store, 'readonly').objectStore(store);
    const source = index ? objectStore.index(index.name) : objectStore;
    return requestToPromise<T[]>(index ? source.getAll(index.value) : source.getAll());
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new KeyboardStudioError('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new KeyboardStudioError('IndexedDB write aborted'));
    });
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new KeyboardStudioError('IndexedDB delete failed'));
    });
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = undefined;
    }
  }
}
