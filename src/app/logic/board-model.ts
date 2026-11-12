/**
 * Key geometry for drawing a board, from the definition's layout and the
 * chosen layout options. Units are key units (1u = one standard key).
 */
import {matrixIndex, visibleKeys, type KeyboardLayout} from '../../core/index.ts';

export type CapTone = 'alpha' | 'mod' | 'accent';

export interface BoardKey {
  /** Position in `BoardModel.keys`. */
  readonly index: number;
  readonly row: number;
  readonly col: number;
  /** Flat keymap index: `row * cols + col`. */
  readonly matrix: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tone: CapTone;
  /** Centre, in key units. */
  readonly cx: number;
  readonly cy: number;
  /** Centre as a fraction of the board, 0-1. */
  readonly nx: number;
  readonly ny: number;
}

export interface BoardModel {
  readonly keys: readonly BoardKey[];
  readonly width: number;
  readonly height: number;
  /** Keys by flat keymap index. */
  readonly byMatrix: ReadonlyMap<number, BoardKey>;
}

export const buildBoardModel = (layout: KeyboardLayout, choices: readonly number[], cols: number): BoardModel => {
  const raw = visibleKeys(layout, choices).filter((key) => !key.d);
  const minX = Math.min(...raw.map((key) => key.x));
  const minY = Math.min(...raw.map((key) => key.y));
  const width = Math.max(...raw.map((key) => key.x + key.w)) - minX;
  const height = Math.max(...raw.map((key) => key.y + key.h)) - minY;
  // Sort by row of the layout, then left to right, so tab order follows the board.
  const sorted = [...raw].sort((a, b) => a.y - b.y || a.x - b.x);
  const keys = sorted.map((key, index): BoardKey => {
    const x = key.x - minX;
    const y = key.y - minY;
    return {
      index,
      row: key.row,
      col: key.col,
      matrix: matrixIndex(key, cols),
      x,
      y,
      w: key.w,
      h: key.h,
      tone: key.color,
      cx: x + key.w / 2,
      cy: y + key.h / 2,
      nx: (x + key.w / 2) / width,
      ny: (y + key.h / 2) / height,
    };
  });
  return {keys, width, height, byMatrix: new Map(keys.map((key) => [key.matrix, key]))};
};
