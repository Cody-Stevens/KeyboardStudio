/*
 * WebHID transport. Device filtering follows the-via/app
 * src/shims/node-hid.ts (GPL-3.0). Copyright (C) The VIA authors.
 * Modifications Copyright (C) 2026 Cody Stevens. Licensed under the GNU
 * General Public License v3.0.
 */
import {REPORT_SIZE, VIA_USAGE, VIA_USAGE_PAGE} from '../protocol/constants.ts';
import {DisconnectedError, KeyboardStudioError} from '../protocol/errors.ts';
import type {HidDeviceInfo, Transport} from './types.ts';

/** True when the browser exposes WebHID (Chromium-based browsers over HTTPS or localhost). */
export const isWebHidSupported = (): boolean => typeof navigator !== 'undefined' && 'hid' in navigator;

const isViaInterface = (device: HIDDevice): boolean =>
  device.collections.some((collection) => collection.usagePage === VIA_USAGE_PAGE && collection.usage === VIA_USAGE);

const requireHid = (): HID => {
  if (!isWebHidSupported()) {
    throw new KeyboardStudioError('This browser does not support WebHID. Use a Chromium-based browser such as Chrome or Edge.');
  }
  return navigator.hid;
};

export class WebHidTransport implements Transport {
  readonly kind = 'webhid' as const;
  readonly info: HidDeviceInfo;
  private readonly reportListeners = new Set<(report: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  constructor(readonly device: HIDDevice) {
    this.info = {vendorId: device.vendorId, productId: device.productId, productName: device.productName};
  }

  get isOpen(): boolean {
    return this.device.opened;
  }

  async open(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }
    this.device.addEventListener('inputreport', this.handleInputReport);
    requireHid().addEventListener('disconnect', this.handleDisconnect);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.handleInputReport);
    if (isWebHidSupported()) {
      navigator.hid.removeEventListener('disconnect', this.handleDisconnect);
    }
    if (this.device.opened) {
      await this.device.close();
    }
  }

  async send(report: Uint8Array): Promise<void> {
    if (!this.device.opened) {
      throw new DisconnectedError();
    }
    const data = new Uint8Array(REPORT_SIZE);
    data.set(report.subarray(0, REPORT_SIZE));
    // VIA's raw HID interface has no numbered reports, so the report id is 0.
    await this.device.sendReport(0, data);
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private readonly handleInputReport = (event: HIDInputReportEvent): void => {
    const report = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice();
    this.reportListeners.forEach((listener) => listener(report));
  };

  private readonly handleDisconnect = (event: HIDConnectionEvent): void => {
    if (event.device === this.device) {
      this.disconnectListeners.forEach((listener) => listener());
    }
  };
}

/** Shows the browser's device picker filtered to VIA keyboards. Resolves to null if the user cancels. */
export const requestWebHidKeyboard = async (): Promise<WebHidTransport | null> => {
  const devices = await requireHid().requestDevice({filters: [{usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE}]});
  const device = devices.find(isViaInterface);
  return device ? new WebHidTransport(device) : null;
};

/** Keyboards the user already granted access to on this origin. */
export const listAuthorizedWebHidKeyboards = async (): Promise<WebHidTransport[]> => {
  if (!isWebHidSupported()) {
    return [];
  }
  const devices = await navigator.hid.getDevices();
  return devices.filter(isViaInterface).map((device) => new WebHidTransport(device));
};
