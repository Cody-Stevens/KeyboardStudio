/**
 * How the workspace divides its height between the board (top) and the
 * editor (bottom). Pure, so the rules are unit-tested.
 */

/** Height of the bar between the two panes, in CSS pixels. */
export const SPLIT_HANDLE_PX = 10;
/** The board keeps room for its controls and a readable keyboard. */
export const MIN_BOARD_PX = 260;
/** The editor keeps its tabs and a few lines of controls; it scrolls inside itself. */
export const MIN_EDITOR_PX = 200;

export interface SplitLayout {
  /** Height shared by the two panes (the container minus the handle). */
  readonly available: number;
  readonly board: number;
  readonly dock: number;
  readonly minBoard: number;
  readonly maxBoard: number;
}

/** The editor's default height, the same rule the stylesheet uses: 38% of the window, 250 to 400 px. */
export const defaultEditorPx = (viewportHeight: number): number => Math.max(250, Math.min(400, viewportHeight * 0.38));

/**
 * Pane sizes for a container height and a stored board share (0-1 of the
 * available height, or null for the default). Both minimums hold; when the
 * window is too short for both, they shrink in proportion.
 */
export const splitLayout = ({height, share, viewportHeight}: {readonly height: number; readonly share: number | null; readonly viewportHeight: number}): SplitLayout => {
  const available = Math.max(0, height - SPLIT_HANDLE_PX);
  const fit = Math.min(1, available / (MIN_BOARD_PX + MIN_EDITOR_PX));
  const minBoard = Math.floor(MIN_BOARD_PX * fit);
  const maxBoard = Math.max(minBoard, available - Math.floor(MIN_EDITOR_PX * fit));
  const wanted = share === null ? available - defaultEditorPx(viewportHeight) : share * available;
  const board = Math.round(Math.max(minBoard, Math.min(maxBoard, wanted)));
  return {available, board, dock: available - board, minBoard, maxBoard};
};

export const isBoardShare = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1);
