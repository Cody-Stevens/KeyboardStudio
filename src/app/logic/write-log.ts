/**
 * The session's change log: one line per user action, with a status that
 * comes only from the store's write records (never from a timer).
 */
import type {ConnectionState, WriteRecord} from '../../core/index.ts';

export type EntryStatus =
  | {readonly state: 'pending'}
  | {readonly state: 'saved'; readonly settledAt: number}
  | {readonly state: 'failed'; readonly verified: boolean; readonly error: string};

export interface LogEntryBase {
  readonly id: number;
  readonly at: number;
  /** What the action does, as a sentence ("Caps Lock on Windows is now Esc."). */
  readonly text: string;
  /** What the screen shows again after a failure ("Caps Lock is back to Caps Lock."). */
  readonly rollbackText: string;
  /** Every write the action made; the newest write per target decides. */
  readonly writeIds: readonly number[];
  /** Entries with the same merge key next to each other become one line (slider drags). */
  readonly mergeKey?: string;
  /** Set once the entry has been undone, to the id of the undo entry. */
  readonly undoneBy?: number;
  /** Set on an entry that undoes another. */
  readonly undoes?: number;
}

/**
 * Status of a log entry. Superseded writes are ignored (a newer write to
 * the same target replaced them before they were sent).
 */
export const entryStatus = (writeIds: readonly number[], writes: ReadonlyMap<number, WriteRecord>): EntryStatus => {
  const records = writeIds.map((id) => writes.get(id)).filter((record): record is WriteRecord => record !== undefined);
  const live = records.filter((record) => record.state !== 'superseded');
  if (live.length === 0) {
    // Every write was superseded by a later entry, or the records aged out.
    return records.length === 0 ? {state: 'saved', settledAt: 0} : {state: 'pending'};
  }
  if (live.some((record) => record.state === 'pending')) {
    return {state: 'pending'};
  }
  const failed = live.find((record) => record.state === 'failed');
  if (failed) {
    return {state: 'failed', verified: failed.verified ?? false, error: failed.error ?? 'The keyboard did not confirm the change'};
  }
  return {state: 'saved', settledAt: Math.max(...live.map((record) => record.settledAt ?? 0))};
};

export type LampState = 'disconnected' | 'connecting' | 'idle' | 'saving' | 'saved' | 'failed';

export interface Lamp {
  readonly state: LampState;
  readonly text: string;
}

/**
 * The always-visible status lamp. Saving wins over everything while a write
 * is open; otherwise the newest settled entry decides between saved and
 * failed.
 */
export const lampFor = (connection: ConnectionState, statuses: readonly EntryStatus[], pendingWrites: number): Lamp => {
  if (connection.status === 'connecting') {
    return {state: 'connecting', text: 'Connecting…'};
  }
  if (connection.status !== 'connected') {
    return {state: 'disconnected', text: 'Not connected'};
  }
  if (pendingWrites > 0 || statuses.some((status) => status.state === 'pending')) {
    return {state: 'saving', text: 'Saving to the keyboard…'};
  }
  const latest = statuses[statuses.length - 1];
  if (!latest) {
    return {state: 'idle', text: 'Connected. Nothing changed yet.'};
  }
  if (latest.state === 'failed') {
    return {state: 'failed', text: 'The last change did not save'};
  }
  return {state: 'saved', text: 'All changes are on the keyboard'};
};

/** Merges a new entry into the log: replaces the last entry when it has the same merge key and was not undone. */
export const appendEntry = <T extends LogEntryBase>(entries: readonly T[], entry: T, merge: (previous: T, next: T) => T): T[] => {
  const last = entries[entries.length - 1];
  if (last && entry.mergeKey !== undefined && last.mergeKey === entry.mergeKey && last.undoneBy === undefined) {
    return [...entries.slice(0, -1), merge(last, entry)];
  }
  return [...entries, entry];
};
