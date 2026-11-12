import type {EntryStatus} from '../logic/write-log.ts';

/** Saving / saved / did not save, from the store's write records only. */
export function StatusText({status}: {readonly status: EntryStatus}) {
  switch (status.state) {
    case 'pending':
      return (
        <span className="status status-pending">
          <span className="status-dot" aria-hidden="true" />
          Saving to the keyboard…
        </span>
      );
    case 'saved':
      return (
        <span className="status status-saved">
          <span className="status-dot" aria-hidden="true" />
          Saved to keyboard.
        </span>
      );
    case 'failed':
      return (
        <span className="status status-failed">
          <span className="status-dot" aria-hidden="true" />
          {status.verified ? 'The keyboard was checked and still has the old value.' : 'Could not check the keyboard. Reconnect to be sure.'}
        </span>
      );
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
