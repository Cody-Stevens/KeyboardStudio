import {REPORT_SIZE} from '../protocol/constants.ts';
import {DisconnectedError} from '../protocol/errors.ts';
import {MockKeyboard} from './mock-keyboard.ts';
import type {HidDeviceInfo, Transport} from './types.ts';

/**
 * How an injected failure behaves:
 * - `timeout`: the keyboard never replies.
 * - `disconnect`: sending fails and the device disappears.
 * - `send-error`: sending this one report fails; the device stays connected.
 * - `unhandled`: the keyboard replies id_unhandled (0xFF).
 * - `corrupt`: the reply does not echo the request.
 * - `drop-after-apply`: the keyboard applies the command but the reply is lost.
 */
export type MockFailureMode = 'timeout' | 'disconnect' | 'send-error' | 'unhandled' | 'corrupt' | 'drop-after-apply';

export interface MockFailureRule {
  readonly mode: MockFailureMode;
  /** Which reports fail. Defaults to every report. */
  readonly match?: (request: Uint8Array) => boolean;
  /** How many matching reports fail before the rule expires. Defaults to unlimited. */
  readonly times?: number;
}

export interface MockLatency {
  readonly minMs: number;
  readonly maxMs: number;
}

export interface MockTransportOptions {
  readonly info?: Partial<HidDeviceInfo>;
  /** Delay before each reply, in milliseconds, or a random range. Defaults to 0. */
  readonly latency?: number | MockLatency;
  readonly failures?: readonly MockFailureRule[];
}

interface ActiveRule {
  readonly rule: MockFailureRule;
  remaining: number;
}

/** Matches reports with the given command id. */
export const matchCommand =
  (...commands: number[]) =>
  (request: Uint8Array): boolean =>
    commands.includes(request[0] ?? -1);

/**
 * A {@link Transport} backed by a {@link MockKeyboard}. Replies are delivered
 * asynchronously through `onReport`, as WebHID input reports are, so the same
 * {@link CommandChannel} code runs against the mock and real hardware.
 */
export class MockTransport implements Transport {
  readonly kind = 'mock' as const;
  readonly info: HidDeviceInfo;
  private open_ = false;
  private latency: number | MockLatency;
  private rules: ActiveRule[] = [];
  private readonly reportListeners = new Set<(report: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  constructor(
    readonly keyboard: MockKeyboard,
    options: MockTransportOptions = {},
  ) {
    this.info = {vendorId: 0, productId: 0, productName: 'Mock keyboard', ...options.info};
    this.latency = options.latency ?? 0;
    options.failures?.forEach((rule) => this.injectFailure(rule));
  }

  get isOpen(): boolean {
    return this.open_;
  }

  async open(): Promise<void> {
    this.open_ = true;
  }

  async close(): Promise<void> {
    this.open_ = false;
  }

  setLatency(latency: number | MockLatency): void {
    this.latency = latency;
  }

  injectFailure(rule: MockFailureRule): void {
    this.rules.push({rule, remaining: rule.times ?? Number.POSITIVE_INFINITY});
  }

  clearFailures(): void {
    this.rules = [];
  }

  /** Simulates unplugging the keyboard. */
  unplug(): void {
    this.open_ = false;
    this.disconnectListeners.forEach((listener) => listener());
  }

  async send(report: Uint8Array): Promise<void> {
    if (!this.open_) {
      throw new DisconnectedError();
    }
    const request = new Uint8Array(REPORT_SIZE);
    request.set(report.subarray(0, REPORT_SIZE));
    const failure = this.takeFailure(request);
    if (failure === 'disconnect') {
      this.unplug();
      throw new DisconnectedError('The mock keyboard was unplugged');
    }
    if (failure === 'send-error') {
      throw new DisconnectedError('The mock keyboard rejected the report');
    }
    if (failure === 'timeout') {
      return;
    }
    let reply: Uint8Array;
    if (failure === 'unhandled') {
      // The firmware rejects the command without applying it.
      reply = request.slice();
      reply[0] = 0xff;
    } else {
      reply = this.keyboard.handle(request);
    }
    if (failure === 'drop-after-apply') {
      return;
    }
    if (failure === 'corrupt') {
      reply = new Uint8Array(REPORT_SIZE).fill(0xee);
    }
    const delay = this.nextDelay();
    const deliver = () => {
      if (this.open_) {
        this.reportListeners.forEach((listener) => listener(reply));
      }
    };
    if (delay > 0) {
      setTimeout(deliver, delay);
    } else {
      queueMicrotask(deliver);
    }
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private takeFailure(request: Uint8Array): MockFailureMode | null {
    for (const active of this.rules) {
      if (active.remaining > 0 && (active.rule.match?.(request) ?? true)) {
        active.remaining--;
        return active.rule.mode;
      }
    }
    this.rules = this.rules.filter((active) => active.remaining > 0);
    return null;
  }

  private nextDelay(): number {
    if (typeof this.latency === 'number') {
      return this.latency;
    }
    const {minMs, maxMs} = this.latency;
    return minMs + Math.random() * (maxMs - minMs);
  }
}
