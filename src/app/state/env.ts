/**
 * Page-level settings read once from the URL and the browser.
 *
 * - `?mock=1` runs the app on the in-memory Linky87 (no hardware).
 * - `&board=unknown` makes the mock act as a keyboard with no bundled
 *   definition, to show the drop zone.
 * - `&latency=2` and `&fail=0.1` set mock reply delay and write failure rate.
 * - `&view=flat` starts in the flat view; `&webgl=0` pretends WebGL is missing.
 */
import {isWebHidSupported} from '../../core/index.ts';

const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

const numberParam = (name: string) => {
  const value = Number(params.get(name) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const env = {
  mock: params.get('mock') === '1',
  mockUnknownBoard: params.get('board') === 'unknown',
  mockLatency: numberParam('latency'),
  mockFailRate: Math.min(1, numberParam('fail')),
  forceFlat: params.get('view') === 'flat',
  noWebGl: params.get('webgl') === '0',
  webHid: isWebHidSupported(),
  reducedMotion: typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
} as const;

/** Reads a JSON value from localStorage, falling back when storage is blocked or the value is malformed. */
export const loadSetting = <T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T => {
  try {
    const raw = window.localStorage.getItem(`keyboard-studio:${key}`);
    if (raw === null) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const saveSetting = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(`keyboard-studio:${key}`, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the setting lasts for this page only.
  }
};

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
export const isNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => Number.isInteger(item));
