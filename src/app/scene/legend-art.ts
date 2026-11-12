/**
 * Draws keycap legends with the 2D canvas API, for the 3D legend atlas.
 * The flat board draws the same legends with DOM text and SVG icons.
 */
import type {CapTone} from '../logic/board-model.ts';
import type {Legend, LegendIcon} from '../logic/legends.ts';

export const CAP_COLORS: Readonly<Record<CapTone, {readonly body: string; readonly ink: string}>> = {
  alpha: {body: '#ebe8e1', ink: '#262a36'},
  mod: {body: '#c6c8cf', ink: '#262a36'},
  accent: {body: '#596075', ink: '#f3f1ec'},
};

export const DANGER_INK = '#c42f2f';
export const LEGEND_FONT = '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif';
export const SYMBOL_FONT = '"Barlow", system-ui, sans-serif';

export interface LegendArt {
  readonly legend: Legend;
  readonly tone: CapTone;
  /** Fn-layer key that repeats the layer underneath. */
  readonly faded: boolean;
}

/** Draws one legend into the rectangle (x, y, w, h) of a 2D context. */
export const drawLegend = (g: CanvasRenderingContext2D, art: LegendArt, x: number, y: number, w: number, h: number, pad: number): void => {
  const colors = CAP_COLORS[art.tone];
  g.save();
  g.fillStyle = colors.body;
  g.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const danger = art.legend.kind === 'danger';
  const ink = danger ? DANGER_INK : colors.ink;
  g.globalAlpha = art.faded ? 0.3 : 1;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = x + w / 2;
  const maxW = w - h * 0.12;
  const fit = (text: string, size: number, weight: number, family: string) => {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (g.measureText(text).width > maxW && s > 9) {
      s -= 1;
      g.font = `${weight} ${s}px ${family}`;
    }
    return s;
  };
  const lines = art.legend.lines.filter((line, idx) => line.length > 0 || idx > 0);
  if (art.legend.icon) {
    drawIcon(g, art.legend.icon, cx, y + h * 0.5, h * 0.5);
  } else if (lines.length === 1 && lines[0] !== undefined && lines[0].length > 0) {
    const text = lines[0];
    if (text.length === 1) {
      g.font = `500 ${Math.round(h * 0.5)}px ${SYMBOL_FONT}`;
      g.fillText(text, cx, y + h * 0.53);
    } else {
      fit(text, Math.round(h * (text.length <= 4 ? 0.38 : 0.33)), 600, LEGEND_FONT);
      g.fillText(text, cx, y + h * 0.53);
    }
  } else if (lines.length >= 2) {
    const [top = '', bottom = ''] = lines;
    if (top.length === 1 && bottom.length === 1) {
      g.font = `500 ${Math.round(h * 0.34)}px ${SYMBOL_FONT}`;
      g.globalAlpha *= 0.72;
      g.fillText(top, cx, y + h * 0.3);
      g.globalAlpha = art.faded ? 0.3 : 1;
      g.font = `500 ${Math.round(h * 0.42)}px ${SYMBOL_FONT}`;
      g.fillText(bottom, cx, y + h * 0.69);
    } else {
      const size = Math.min(fit(top, Math.round(h * 0.3), 600, LEGEND_FONT), fit(bottom, Math.round(h * 0.3), 600, LEGEND_FONT));
      g.font = `600 ${size}px ${LEGEND_FONT}`;
      g.fillText(top, cx, y + h * 0.33);
      g.fillText(bottom, cx, y + h * 0.69);
    }
  }
  if (danger) {
    g.globalAlpha = 1;
    g.fillStyle = DANGER_INK;
    const barW = w * 0.36;
    g.fillRect(cx - barW / 2, y + h * 0.86, barW, Math.max(2, h * 0.045));
  }
  g.restore();
};

/** Line icons for arrows, media and light keys, drawn around (cx, cy) in a box of size s. */
export const drawIcon = (g: CanvasRenderingContext2D, icon: LegendIcon, cx: number, cy: number, s: number): void => {
  const u = s / 2;
  g.save();
  g.translate(cx, cy);
  g.lineWidth = Math.max(1.5, s * 0.09);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = (points: readonly (readonly [number, number])[], close = false) => {
    g.beginPath();
    points.forEach(([px, py], idx) => (idx === 0 ? g.moveTo(px * u, py * u) : g.lineTo(px * u, py * u)));
    if (close) {
      g.closePath();
    }
  };
  const arrow = (angle: number) => {
    g.rotate(angle);
    path([
      [-0.7, 0],
      [0.7, 0],
    ]);
    g.stroke();
    path([
      [0.2, -0.5],
      [0.7, 0],
      [0.2, 0.5],
    ]);
    g.stroke();
  };
  const speaker = () => {
    path(
      [
        [-0.85, -0.28],
        [-0.45, -0.28],
        [-0.05, -0.62],
        [-0.05, 0.62],
        [-0.45, 0.28],
        [-0.85, 0.28],
      ],
      true,
    );
    g.fill();
  };
  const wave = (radius: number) => {
    g.beginPath();
    g.arc(-0.05 * u, 0, radius * u, -0.7, 0.7);
    g.stroke();
  };
  const triangle = (x0: number, dir: number, size = 0.5) => {
    path(
      [
        [x0 - dir * size * 0.5, -size],
        [x0 + dir * size * 0.9, 0],
        [x0 - dir * size * 0.5, size],
      ],
      true,
    );
    g.fill();
  };
  const sun = (rays: number, length: number) => {
    g.beginPath();
    g.arc(0, 0, u * 0.28, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      path([
        [Math.cos(a) * 0.5, Math.sin(a) * 0.5],
        [Math.cos(a) * (0.5 + length), Math.sin(a) * (0.5 + length)],
      ]);
      g.stroke();
    }
  };
  switch (icon) {
    case 'right':
      arrow(0);
      break;
    case 'left':
      arrow(Math.PI);
      break;
    case 'up':
      arrow(-Math.PI / 2);
      break;
    case 'down':
      arrow(Math.PI / 2);
      break;
    case 'mute':
      speaker();
      path([
        [0.3, -0.3],
        [0.85, 0.3],
      ]);
      g.stroke();
      path([
        [0.85, -0.3],
        [0.3, 0.3],
      ]);
      g.stroke();
      break;
    case 'vol-down':
      speaker();
      wave(0.45);
      break;
    case 'vol-up':
      speaker();
      wave(0.45);
      wave(0.8);
      break;
    case 'play':
      triangle(-0.35, 1, 0.48);
      g.fillRect(0.25 * u, -0.48 * u, 0.16 * u, 0.96 * u);
      g.fillRect(0.55 * u, -0.48 * u, 0.16 * u, 0.96 * u);
      break;
    case 'next':
      triangle(-0.45, 1, 0.42);
      triangle(0.12, 1, 0.42);
      g.fillRect(0.58 * u, -0.42 * u, 0.13 * u, 0.84 * u);
      break;
    case 'prev':
      g.fillRect(-0.71 * u, -0.42 * u, 0.13 * u, 0.84 * u);
      triangle(-0.12, -1, 0.42);
      triangle(0.45, -1, 0.42);
      break;
    case 'bright-down':
      sun(8, 0.12);
      break;
    case 'bright-up':
      sun(8, 0.3);
      break;
    case 'light-down':
    case 'light-up': {
      g.strokeRect(-0.7 * u, 0.1 * u, 1.4 * u, 0.5 * u);
      const rays = icon === 'light-up' ? 5 : 3;
      const reach = icon === 'light-up' ? 0.8 : 0.6;
      for (let i = 0; i < rays; i++) {
        const a = Math.PI + (i + 1) * (Math.PI / (rays + 1));
        path([
          [Math.cos(a) * 0.36, -0.05 + Math.sin(a) * 0.36],
          [Math.cos(a) * reach, -0.05 + Math.sin(a) * reach],
        ]);
        g.stroke();
      }
      break;
    }
    default: {
      const unreachable: never = icon;
      return unreachable;
    }
  }
  g.restore();
};
