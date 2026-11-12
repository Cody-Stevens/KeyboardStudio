import {CommandName} from './constants.ts';

const describeCommand = (command: number) =>
  `${CommandName[command] ?? 'UNKNOWN'} (0x${command.toString(16).padStart(2, '0')})`;

/** Base class for every error the core raises, so a UI can tell them apart from bugs. */
export class KeyboardStudioError extends Error {
  override readonly name: string = 'KeyboardStudioError';
}

/** The keyboard did not answer within the timeout. */
export class CommandTimeoutError extends KeyboardStudioError {
  override readonly name = 'CommandTimeoutError';
  constructor(
    readonly command: number,
    readonly timeoutMs: number,
  ) {
    super(`${describeCommand(command)} got no reply within ${timeoutMs} ms`);
  }
}

/** The firmware answered with id_unhandled (0xFF). */
export class UnhandledCommandError extends KeyboardStudioError {
  override readonly name = 'UnhandledCommandError';
  constructor(readonly command: number) {
    super(`The keyboard does not handle ${describeCommand(command)}`);
  }
}

/** The core refused to send a command because the channel is read-only. */
export class ReadOnlyError extends KeyboardStudioError {
  override readonly name = 'ReadOnlyError';
  constructor(readonly command: number) {
    super(`Refusing to send ${describeCommand(command)}: the connection is read-only`);
  }
}

/** The core refused to send a destructive command it never sends. */
export class ForbiddenCommandError extends KeyboardStudioError {
  override readonly name = 'ForbiddenCommandError';
  constructor(readonly command: number) {
    super(`${describeCommand(command)} is never sent by KeyboardStudio`);
  }
}

/** The transport is closed or the device went away. */
export class DisconnectedError extends KeyboardStudioError {
  override readonly name = 'DisconnectedError';
  constructor(message = 'The keyboard is not connected') {
    super(message);
  }
}

/** A reply or input could not be understood. */
export class ProtocolError extends KeyboardStudioError {
  override readonly name = 'ProtocolError';
}

/** A definition, snapshot or layout file failed validation. */
export class ValidationError extends KeyboardStudioError {
  override readonly name = 'ValidationError';
  constructor(
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(details.length ? `${message}: ${details.join('; ')}` : message);
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
