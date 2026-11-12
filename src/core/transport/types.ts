export interface HidDeviceInfo {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
}

export type TransportKind = 'webhid' | 'mock';

/**
 * A raw HID link to one keyboard. Reports are always 32 bytes and never
 * include the report-id prefix; implementations add or strip it.
 *
 * The transport only moves bytes. Pairing a request with its reply, timeouts
 * and queueing live in {@link CommandChannel}, so the mock and WebHID share
 * that logic.
 */
export interface Transport {
  readonly kind: TransportKind;
  readonly info: HidDeviceInfo;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Sends one output report. Rejects if the device is gone. */
  send(report: Uint8Array): Promise<void>;
  /** Subscribes to input reports. Returns an unsubscribe function. */
  onReport(listener: (report: Uint8Array) => void): () => void;
  /** Subscribes to the device disappearing. Returns an unsubscribe function. */
  onDisconnect(listener: () => void): () => void;
}
