import {describe, expect, it} from 'vitest';
import {matrixForKeycode} from '../src/app/logic/browser-keys.ts';
import {MIN_BOARD_PX, MIN_EDITOR_PX, SPLIT_HANDLE_PX, defaultEditorPx, isBoardShare, splitLayout} from '../src/app/logic/split.ts';

describe('board and editor split', () => {
  it('uses the stylesheet default when nothing is stored', () => {
    // 1600 x 1000: the workspace below the 52 px top bar is 948 px.
    const layout = splitLayout({height: 948, share: null, viewportHeight: 1000});
    expect(layout.dock).toBe(Math.round(defaultEditorPx(1000)));
    expect(layout.board + layout.dock + SPLIT_HANDLE_PX).toBe(948);
  });

  it('follows a stored share inside the minimums', () => {
    const layout = splitLayout({height: 948, share: 0.5, viewportHeight: 1000});
    expect(layout.board).toBe(469);
    expect(splitLayout({height: 948, share: 0.05, viewportHeight: 1000}).board).toBe(MIN_BOARD_PX);
    expect(splitLayout({height: 948, share: 0.98, viewportHeight: 1000}).dock).toBe(MIN_EDITOR_PX);
  });

  it('keeps both panes usable at 1280 x 720', () => {
    const layout = splitLayout({height: 668, share: null, viewportHeight: 720});
    expect(layout.board).toBeGreaterThan(280);
    expect(layout.minBoard).toBe(MIN_BOARD_PX);
    expect(layout.maxBoard).toBe(668 - SPLIT_HANDLE_PX - MIN_EDITOR_PX);
  });

  it('shrinks both minimums in proportion when the window is too short for both', () => {
    const layout = splitLayout({height: 310, share: 0.9, viewportHeight: 362});
    expect(layout.board + layout.dock).toBe(300);
    expect(layout.dock).toBeGreaterThan(100);
    expect(layout.board).toBeGreaterThan(150);
  });

  it('accepts only sensible stored values', () => {
    expect(isBoardShare(null)).toBe(true);
    expect(isBoardShare(0.6)).toBe(true);
    expect(isBoardShare(1.4)).toBe(false);
    expect(isBoardShare('0.5')).toBe(false);
    expect(isBoardShare(Number.NaN)).toBe(false);
  });
});

describe('typed keys on the model', () => {
  const keymap = [
    [0x29, 0x04, 0x05],
    [0x29, 0x06, 0x05],
  ];

  it('finds the key that sends a keycode, on the layer being edited first', () => {
    expect(matrixForKeycode(keymap, 1, 0x06, [0, 1, 2])).toBe(1);
    expect(matrixForKeycode(keymap, 0, 0x06, [0, 1, 2])).toBe(1);
    expect(matrixForKeycode(keymap, 0, 0x05, [0, 1, 2])).toBe(2);
    expect(matrixForKeycode(keymap, 0, 0x50, [0, 1, 2])).toBeNull();
  });
});
