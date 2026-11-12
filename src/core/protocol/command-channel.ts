/*
 * Serial request/reply channel over a raw HID transport.
 *
 * The queue and echo check follow the-via/app src/utils/keyboard-api.ts
 * (hidCommand, flushQueue, _hidCommand) and src/shims/node-hid.ts (GPL-3.0).
 * Copyright (C) The VIA authors. Modifications Copyright (C) 2026 Cody Stevens.
 * Licensed under the GNU General Public License v3.0.
 */
import {Command, FORBIDDEN_COMMANDS, ID_UNHANDLED, REPORT_SIZE, WRITE_COMMANDS} from './constants.ts';
import {
  CommandTimeoutError,
  DisconnectedError,
  ForbiddenCommandError,
  ProtocolError,
  ReadOnlyError,
  UnhandledCommandError,
} from './errors.ts';
import type {Transport} from '../transport/types.ts';

export interface CommandChannelOptions {
  /** How long to wait for each reply. Defaults to 1000 ms, like via_read.py. */
  readonly timeoutMs?: number;
  /** Refuse every command that changes keyboard state. */
  readonly readOnly?: boolean;
  /** Called for input reports that do not answer a request, such as UI sync requests (0x16). */
  readonly onUnsolicitedReport?: (report: Uint8Array) => void;
  /** Called after every completed exchange. Useful for debugging and metrics. */
  readonly onExchange?: (exchange: CommandExchange) => void;
}

export interface CommandExchange {
  readonly request: Uint8Array;
  readonly reply: Uint8Array | null;
  readonly durationMs: number;
  readonly error?: Error;
}

interface QueuedRequest {
  readonly request: Uint8Array;
  /** Bytes of the request that the firmware echoes back: command id plus arguments. */
  readonly echoLength: number;
  readonly resolve: (reply: Uint8Array) => void;
  readonly reject: (error: Error) => void;
}

interface InFlight {
  readonly request: Uint8Array;
  /** Bytes of the request that the firmware echoes back: command id plus arguments. */
  readonly echoLength: number;
  readonly resolve: (reply: Uint8Array) => void;
  readonly reject: (error: Error) => void;
}

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export interface ChannelStats {
  readonly requests: number;
  readonly failures: number;
  readonly strayReports: number;
}

/**
 * Sends one VIA command at a time and pairs each reply with its request by
 * checking that the reply echoes the request bytes, as QMK does.
 *
 * Replies that do not match the request in flight are treated as stray (for
 * example a late reply to a request that already timed out) and ignored, so
 * one slow reply cannot shift every later reply by one.
 */
export class CommandChannel {
  readonly readOnly: boolean;
  readonly timeoutMs: number;
  private readonly queue: QueuedRequest[] = [];
  private inFlight: InFlight | null = null;
  private flushing = false;
  private closed = false;
  private readonly unsubscribers: (() => void)[] = [];
  private stats = {requests: 0, failures: 0, strayReports: 0};

  constructor(
    private readonly transport: Transport,
    private readonly options: CommandChannelOptions = {},
  ) {
    this.readOnly = options.readOnly ?? false;
    this.timeoutMs = options.timeoutMs ?? 1000;
    this.unsubscribers.push(
      transport.onReport((report) => this.handleReport(report)),
      transport.onDisconnect(() => this.close(new DisconnectedError('The keyboard was disconnected'))),
    );
  }

  get statistics(): ChannelStats {
    return {...this.stats};
  }

  get isIdle(): boolean {
    return !this.flushing && this.queue.length === 0;
  }

  /**
   * Queues one command. `payload` starts with the command id; it is padded
   * to 32 bytes. Resolves with the full 32-byte reply.
   */
  request(payload: readonly number[]): Promise<Uint8Array> {
    const command = payload[0];
    if (command === undefined) {
      return Promise.reject(new ProtocolError('Empty command payload'));
    }
    if (payload.length > REPORT_SIZE) {
      return Promise.reject(new ProtocolError(`Command payload is ${payload.length} bytes; the limit is ${REPORT_SIZE}`));
    }
    if (FORBIDDEN_COMMANDS.has(command)) {
      return Promise.reject(new ForbiddenCommandError(command));
    }
    if (this.readOnly && WRITE_COMMANDS.has(command)) {
      return Promise.reject(new ReadOnlyError(command));
    }
    if (this.closed) {
      return Promise.reject(new DisconnectedError());
    }
    const request = new Uint8Array(REPORT_SIZE);
    request.set(payload.map((byte) => byte & 0xff));
    return new Promise<Uint8Array>((resolve, reject) => {
      this.queue.push({request, echoLength: payload.length, resolve, reject});
      void this.flush();
    });
  }

  /** Resolves once every queued command has finished. */
  async whenIdle(): Promise<void> {
    while (!this.isIdle) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  /** Rejects everything queued and stops listening to the transport. */
  close(reason: Error = new DisconnectedError()): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.inFlight?.reject(reason);
    this.inFlight = null;
    for (const queued of this.queue.splice(0)) {
      queued.reject(reason);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const next = this.queue.shift();
        if (!next) {
          break;
        }
        await this.exchange(next);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async exchange(queued: QueuedRequest): Promise<void> {
    const {request, echoLength} = queued;
    const command = request[0] ?? 0;
    const started = now();
    this.stats.requests++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await new Promise<Uint8Array>((resolve, reject) => {
        this.inFlight = {request, echoLength, resolve, reject};
        timer = setTimeout(() => reject(new CommandTimeoutError(command, this.timeoutMs)), this.timeoutMs);
        this.transport.send(request).catch((error: unknown) => {
          reject(error instanceof Error ? error : new DisconnectedError(String(error)));
        });
      });
      this.options.onExchange?.({request, reply, durationMs: now() - started});
      queued.resolve(reply);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.stats.failures++;
      this.options.onExchange?.({request, reply: null, durationMs: now() - started, error: err});
      queued.reject(err);
    } finally {
      clearTimeout(timer);
      this.inFlight = null;
    }
  }

  private handleReport(report: Uint8Array): void {
    const inFlight = this.inFlight;
    if (!inFlight) {
      this.handleStray(report);
      return;
    }
    const {request, echoLength} = inFlight;
    const restMatches = (from: number) => {
      for (let i = from; i < echoLength; i++) {
        if (report[i] !== request[i]) {
          return false;
        }
      }
      return true;
    };
    if (report[0] === request[0] && restMatches(1)) {
      inFlight.resolve(report.slice(0, REPORT_SIZE));
      return;
    }
    if (report[0] === ID_UNHANDLED && restMatches(1)) {
      inFlight.reject(new UnhandledCommandError(request[0] ?? 0));
      return;
    }
    this.handleStray(report);
  }

  private handleStray(report: Uint8Array): void {
    if (report[0] === Command.UI_SYNC_REQUEST) {
      this.options.onUnsolicitedReport?.(report);
      return;
    }
    this.stats.strayReports++;
    this.options.onUnsolicitedReport?.(report);
  }
}
