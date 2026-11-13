import {useStore} from '@nanostores/react';
import {useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {splitLayout, SPLIT_HANDLE_PX, type SplitLayout} from '../logic/split.ts';
import {$boardShare, resetBoardShare, setBoardShare} from '../state/ui.ts';

interface SplitHandleProps {
  /** The element holding the board, this handle and the editor, top to bottom. */
  readonly container: HTMLElement | null;
}

/**
 * The bar between the board and the editor. Drag it (mouse or touch), or
 * focus it and use the arrow keys, to give one more room; double-click it
 * to go back to the default. The choice is remembered in this browser.
 */
export function SplitHandle({container}: SplitHandleProps) {
  const share = useStore($boardShare);
  const [layout, setLayout] = useState<SplitLayout | null>(null);
  const drag = useRef<{readonly pointerId: number; readonly offset: number} | null>(null);
  const [dragging, setDragging] = useState(false);

  // Size the panes from the container's height, the stored share and the minimums.
  useLayoutEffect(() => {
    const element = container;
    if (!element) {
      return;
    }
    const apply = () => {
      const next = splitLayout({height: element.clientHeight, share: $boardShare.get(), viewportHeight: window.innerHeight});
      element.style.setProperty('--dock-h', `${next.dock}px`);
      setLayout(next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    const unsubscribe = $boardShare.listen(apply);
    return () => {
      observer.disconnect();
      unsubscribe();
      element.style.removeProperty('--dock-h');
    };
  }, [container]);

  // A drag that ends outside the window still ends.
  useEffect(() => {
    const stop = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, []);

  if (!layout) {
    return <div className="split-handle" aria-hidden="true" />;
  }

  const shareFromBoard = (boardPx: number) => boardPx / Math.max(1, layout.available);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({preventScroll: true});
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {pointerId: event.pointerId, offset: event.clientY - rect.top};
    setDragging(true);
  };

  /** The board height the pointer asks for, clamped to the minimums. */
  const boardAt = (clientY: number, offset: number): number | null => {
    if (!container) {
      return null;
    }
    const wanted = clientY - offset - container.getBoundingClientRect().top;
    return Math.max(layout.minBoard, Math.min(layout.maxBoard, wanted));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const board = current?.pointerId === event.pointerId ? boardAt(event.clientY, current.offset) : null;
    if (board !== null) {
      setBoardShare(shareFromBoard(board), false);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    setDragging(false);
    // Remember where it ended.
    const board = boardAt(event.clientY, current.offset);
    if (board !== null) {
      setBoardShare(shareFromBoard(board), true);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = layout.available * (event.shiftKey ? 0.1 : 0.02);
    const moves: Record<string, number> = {
      ArrowUp: layout.board - step,
      ArrowDown: layout.board + step,
      PageUp: layout.board - layout.available * 0.1,
      PageDown: layout.board + layout.available * 0.1,
      Home: layout.minBoard,
      End: layout.maxBoard,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setBoardShare(shareFromBoard(Math.max(layout.minBoard, Math.min(layout.maxBoard, next))), true);
    } else if (event.key === 'Enter') {
      // The keyboard way to do what a double-click does.
      event.preventDefault();
      resetBoardShare();
    }
  };

  const percent = (px: number) => Math.round((px / Math.max(1, layout.available)) * 100);
  const now = percent(layout.board);
  return (
    <div
      className={`split-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Board and editor size"
      aria-controls="stage editor"
      aria-valuemin={percent(layout.minBoard)}
      aria-valuemax={percent(layout.maxBoard)}
      aria-valuenow={now}
      aria-valuetext={`Board ${now}% of the height${share === null ? ', the default' : ''}`}
      tabIndex={0}
      title="Drag to give the board or the editor more room. Double-click, or Enter, resets it."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => resetBoardShare()}
      onKeyDown={onKeyDown}
      style={{height: SPLIT_HANDLE_PX}}
      data-testid="split-handle"
    >
      <span className="split-grip" aria-hidden="true" />
    </div>
  );
}
