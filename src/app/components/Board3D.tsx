import {useEffect, useRef} from 'react';
import type {BoardPart} from '../../core/index.ts';
import {zonePreview, type ZonePreview} from '../logic/lighting.ts';
import type {LegendArt} from '../scene/legend-art.ts';
import type {KeyboardScene, SceneLights} from '../scene/keyboard-scene.ts';
import type {SessionView} from '../state/session.ts';

interface Board3DProps {
  readonly session: SessionView;
  readonly arts: readonly LegendArt[];
  readonly layer: number;
  readonly selected: number | null;
  readonly focused: number | null;
  readonly pulse: {readonly matrix: number; readonly at: number} | null;
  readonly flat: boolean;
  readonly visible: boolean;
  readonly intro: boolean;
  readonly reducedMotion: boolean;
  readonly highlightPart: BoardPart | null;
  readonly onReady: () => void;
  readonly onFail: () => void;
  readonly onSlow: (fps: number) => void;
  readonly onSettled: (flat: boolean) => void;
  readonly onKeyClick: (matrix: number) => void;
  readonly onPartClick: (part: BoardPart) => void;
  readonly onHoverPart: (part: BoardPart | null) => void;
}

export const lightsFor = (session: SessionView): SceneLights => {
  const preview = (part: BoardPart): ZonePreview | null => {
    const zone = session.meta.zones.find((candidate) => candidate.part === part);
    return zone ? zonePreview(zone.zone, session.menuValues) : null;
  };
  return {backlight: preview('backlight'), logo: preview('logo'), side: preview('side')};
};

/**
 * Hosts the 3D scene. three.js and the scene load as their own chunk when
 * this mounts; the flat board stays usable until it is ready.
 */
export function Board3D(props: Board3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<KeyboardScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const {session, arts, layer, selected, focused, pulse, flat, highlightPart, visible} = props;
  const model = session.model;

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const element = canvas.current;
    if (!element) {
      return;
    }
    void (async () => {
      try {
        await document.fonts.load('600 40px "Barlow Semi Condensed"').catch(() => undefined);
        await document.fonts.load('500 40px "Barlow"').catch(() => undefined);
        const {KeyboardScene: Scene} = await import('../scene/keyboard-scene.ts');
        if (cancelled) {
          return;
        }
        const current = latest.current;
        const parts = new Set(current.session.meta.zones.map((zone) => zone.part));
        const logoText = current.session.meta.look.logoText;
        const instance = new Scene(element, model, {
          parts: {logo: parts.has('logo'), side: parts.has('side')},
          ...(logoText ? {logoText} : {}),
          reducedMotion: current.reducedMotion,
          hooks: {
            onKeyClick: (matrix) => latest.current.onKeyClick(matrix),
            onPartClick: (part) => latest.current.onPartClick(part),
            onHover: (_matrix, part) => latest.current.onHoverPart(part),
            onSlow: (fps) => latest.current.onSlow(fps),
            onViewSettled: (isFlat) => latest.current.onSettled(isFlat),
          },
        });
        scene.current = instance;
        const resize = () => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            instance.resize(rect.width, rect.height);
          }
        };
        observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();
        instance.setLegends(current.arts, false);
        instance.setLights(lightsFor(current.session));
        instance.setSelected(current.selected);
        instance.setFlat(current.flat, false);
        instance.setPaused(!current.visible);
        // Reconnects and later mounts skip the assemble animation.
        instance.startIntro(current.intro);
        Object.assign(window, {__keyboardScene: instance});
        current.onReady();
      } catch {
        if (!cancelled) {
          latest.current.onFail();
        }
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [model]);

  useEffect(() => {
    scene.current?.setLegends(arts, true);
  }, [arts, layer]);

  useEffect(() => {
    scene.current?.setSelected(selected);
  }, [selected]);

  useEffect(() => {
    scene.current?.setFocused(focused);
  }, [focused]);

  useEffect(() => {
    if (pulse) {
      scene.current?.press(pulse.matrix);
    }
  }, [pulse]);

  useEffect(() => {
    scene.current?.setLights(lightsFor(session));
  }, [session.menuValues, session]);

  useEffect(() => {
    scene.current?.setFlat(flat, true);
  }, [flat]);

  useEffect(() => {
    scene.current?.highlightPart(highlightPart);
  }, [highlightPart]);

  useEffect(() => {
    scene.current?.setPaused(!visible);
  }, [visible]);

  return <canvas ref={canvas} className={`board-canvas${visible ? '' : ' hidden'}`} aria-hidden="true" data-testid="board-3d" />;
}
