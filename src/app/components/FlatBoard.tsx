import {useRef, type KeyboardEvent, type ReactNode} from 'react';
import type {BoardKey, BoardModel} from '../logic/board-model.ts';
import type {LegendIcon} from '../logic/legends.ts';
import type {LegendArt} from '../scene/legend-art.ts';

interface FlatBoardProps {
  readonly model: BoardModel;
  readonly arts: readonly LegendArt[];
  readonly selected: number | null;
  readonly pulse: {readonly matrix: number; readonly at: number} | null;
  /** Backlight colour per key (CSS), in model key order, or null for an unlit board. */
  readonly glows?: readonly string[] | null;
  /** Visually hidden: only the keyboard-focus list for the 3D view. */
  readonly hidden: boolean;
  readonly label: string;
  readonly names: (matrix: number) => string;
  readonly onPick: (matrix: number) => void;
  readonly onFocusKey: (matrix: number | null) => void;
  readonly disabled: boolean;
}

/**
 * The flat, top-down board: real buttons laid out from the definition. It is
 * the flat view, the fallback without WebGL, and (visually hidden) the
 * keyboard path through the 3D board. Arrow keys move between keys.
 */
export function FlatBoard({model, arts, selected, pulse, glows, hidden, label, names, onPick, onFocusKey, disabled}: FlatBoardProps) {
  const root = useRef<HTMLDivElement>(null);
  const active = selected ?? model.keys[0]?.matrix ?? 0;

  const focusKey = (matrix: number) => {
    root.current?.querySelector<HTMLButtonElement>(`[data-matrix="${matrix}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: BoardKey) => {
    const move = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
    if (move) {
      event.preventDefault();
      const next = nearestKey(model, key, move[0] ?? 0, move[1] ?? 0);
      if (next) {
        focusKey(next.matrix);
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const row = model.keys.filter((candidate) => Math.abs(candidate.cy - key.cy) < 0.5);
      const target = event.key === 'Home' ? row[0] : row[row.length - 1];
      if (target) {
        focusKey(target.matrix);
      }
    }
  };

  return (
    <div
      ref={root}
      className={`flat-board${hidden ? ' sr-board' : ''}${glows ? ' lit' : ''}`}
      role="group"
      aria-label={label}
      style={{aspectRatio: `${model.width} / ${model.height}`, ['--ratio' as string]: model.width / model.height, ['--board-w' as string]: model.width}}
      data-testid={hidden ? 'key-list' : 'flat-board'}
    >
      {model.keys.map((key) => {
        const art = arts[key.index];
        const isSelected = selected === key.matrix;
        const pulsing = pulse?.matrix === key.matrix;
        const glow = glows?.[key.index];
        return (
          <button
            key={key.matrix}
            type="button"
            className={[
              'cap',
              `tone-${key.tone}`,
              art?.faded ? 'faded' : '',
              art?.legend.kind === 'danger' ? 'danger' : '',
              isSelected ? 'selected' : '',
              pulsing && pulse ? `pulse-${Math.round(pulse.at) % 2}` : '',
              (art?.legend.lines.length ?? 0) > 1 ? 'two-line' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: `${(key.x / model.width) * 100}%`,
              top: `${(key.y / model.height) * 100}%`,
              width: `${(key.w / model.width) * 100}%`,
              height: `${(key.h / model.height) * 100}%`,
              ...(glow ? {['--led' as string]: glow} : {}),
            }}
            tabIndex={key.matrix === active ? 0 : -1}
            aria-pressed={isSelected}
            aria-label={names(key.matrix)}
            aria-disabled={disabled}
            data-matrix={key.matrix}
            data-testid={`key-${key.row}-${key.col}`}
            onClick={() => onPick(key.matrix)}
            onFocus={() => onFocusKey(key.matrix)}
            onBlur={() => onFocusKey(null)}
            onKeyDown={(event) => onKeyDown(event, key)}
          >
            <span className="cap-top">{art ? <LegendView art={art} /> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

const nearestKey = (model: BoardModel, from: BoardKey, dx: number, dy: number): BoardKey | undefined => {
  let best: BoardKey | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const key of model.keys) {
    const ox = key.cx - from.cx;
    const oy = key.cy - from.cy;
    const along = ox * dx + oy * dy;
    if (along <= 0.2) {
      continue;
    }
    const across = Math.abs(ox * dy) + Math.abs(oy * dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
};

export function LegendView({art}: {readonly art: LegendArt}) {
  const {legend} = art;
  if (legend.icon) {
    return <LegendIconSvg icon={legend.icon} />;
  }
  const lines = legend.lines;
  if (lines.length >= 2) {
    const symbols = lines.every((line) => line.length === 1);
    return (
      <span className={`legend stacked${symbols ? ' symbols' : ''}`}>
        <span>{lines[0]}</span>
        <span>{lines[1]}</span>
      </span>
    );
  }
  const text = lines[0] ?? '';
  return <span className={`legend${text.length === 1 ? ' single' : text.length > 6 ? ' long' : ''}`}>{text}</span>;
}

const ICON_PATHS: Readonly<Record<LegendIcon, ReactNode>> = {
  left: <path d="M17 12H7m4-5-5 5 5 5" />,
  right: <path d="M7 12h10m-4-5 5 5-5 5" />,
  up: <path d="M12 17V7m-5 4 5-5 5 5" />,
  down: <path d="M12 7v10m-5-4 5 5 5-5" />,
  mute: (
    <>
      <path d="M4 10h3l4-3v10l-4-3H4z" className="fill" />
      <path d="m15 9 5 6m0-6-5 6" />
    </>
  ),
  'vol-up': (
    <>
      <path d="M4 10h3l4-3v10l-4-3H4z" className="fill" />
      <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5M17 7a7 7 0 0 1 0 10" />
    </>
  ),
  'vol-down': (
    <>
      <path d="M4 10h3l4-3v10l-4-3H4z" className="fill" />
      <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5" />
    </>
  ),
  play: (
    <>
      <path d="M5 7v10l7-5z" className="fill" />
      <path d="M15 7v10M19 7v10" />
    </>
  ),
  next: (
    <>
      <path d="M4 7v10l6-5zm7 0v10l6-5z" className="fill" />
      <path d="M19 7v10" />
    </>
  ),
  prev: (
    <>
      <path d="M20 7v10l-6-5zm-7 0v10l-6-5z" className="fill" />
      <path d="M5 7v10" />
    </>
  ),
  'bright-up': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />
    </>
  ),
  'bright-down': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 6v1m0 10v1M6 12h1m10 0h1M7.8 7.8l.7.7m7 7 .7.7M7.8 16.2l.7-.7m7-7 .7-.7" />
    </>
  ),
  'light-up': (
    <>
      <rect x="5" y="13" width="14" height="5" rx="1" />
      <path d="M12 5v4M7 7l2 3m8-3-2 3" />
    </>
  ),
  'light-down': (
    <>
      <rect x="5" y="13" width="14" height="5" rx="1" />
      <path d="M12 8v2" />
    </>
  ),
};

export function LegendIconSvg({icon}: {readonly icon: LegendIcon}) {
  return (
    <svg className="legend-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[icon]}
    </svg>
  );
}
