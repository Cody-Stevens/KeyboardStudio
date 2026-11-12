/** Legends for every key of the board on one layer, shared by the 3D and flat boards. */
import {isRepeatOfBase, legendFor} from '../logic/legends.ts';
import type {LegendArt} from '../scene/legend-art.ts';
import {legendContext, type SessionView} from './session.ts';

export const keyArts = (session: SessionView, layer: number): LegendArt[] => {
  const ctx = legendContext(session, layer);
  return session.model.keys.map((key) => ({
    legend: legendFor(session.keymap[layer]?.[key.matrix] ?? 0, ctx, {row: key.row, col: key.col}),
    tone: key.tone,
    faded: isRepeatOfBase(session.meta, session.keymap, layer, key.matrix),
  }));
};
