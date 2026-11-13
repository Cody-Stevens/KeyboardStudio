/**
 * The real-time 3D keyboard. Built from the definition's layout:
 * - one InstancedMesh per keycap size (sides and top as two material groups),
 * - one legend atlas texture for every keycap top,
 * - a light field (light-field.ts): the backlight painted into two small
 *   textures that light the plate, the cap skirts and edges, the case and
 *   the desk, so neighbouring colours blend the way real light does,
 * - logo and side strips when the board has those lighting zones, which
 *   also light the case flanks and the desk,
 * - an optional bloom pass, switched off on software renderers and when
 *   frames get slow.
 *
 * It renders on demand: a frame is drawn only when something changed or an
 * animation (camera, key press, intro, an animated lighting preview, a
 * reactive effect after a key press) runs.
 */
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {FullScreenQuad, Pass} from 'three/examples/jsm/postprocessing/Pass.js';
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type {BoardPart} from '../../core/index.ts';
import type {BoardKey, BoardModel} from '../logic/board-model.ts';
import {backlightColor, stillPreview, stripColor, type ZonePreview} from '../logic/lighting.ts';
import {LED_HITS_TO_REMEMBER, hitsStillShowing, ledPoints, type KeyHit, type LedPoint} from '../logic/rgb-matrix.ts';
import {LIGHT_FIELD_GLSL, LightField} from './light-field.ts';
import {CAP_COLORS, LEGEND_FONT, drawLegend, type LegendArt} from './legend-art.ts';

const BG = '#151a2b';
const CAP_H = 0.4;
const CAP_Y = 0.14;
const CASE_TOP = 0.32;
const DESK_Y = -0.92;
const TILT = 0.065;
const PPU = 220;
const ATLAS_W = 2048;
const CELL_PAD = 6;
/** Room around the board on the canvas for the stage's own controls, in CSS pixels. */
const INSET_TOP = 58;
const INSET_BOTTOM = 40;

/** How strongly each surface returns the backlight. Tuned by eye against photos of backlit boards. */
const LIGHT = {
  /** Plate between the caps: the brightest, it sits right on the LEDs. */
  plate: 2.2,
  /** Cap skirts near the plate, fading up the cap wall. */
  skirt: 0.95,
  /** Cap top edges, light scattered through the cap wall. */
  rim: 0.22,
  /** Case lip and walls next to the keys. */
  caseNear: 0.7,
  caseFar: 0.1,
  /** Light spilling onto the desk around the board. */
  desk: 0.42,
  /** Side strips on the case flanks and the desk. */
  strip: 1.5,
} as const;

export interface SceneHooks {
  readonly onKeyClick: (matrix: number) => void;
  readonly onPartClick: (part: BoardPart) => void;
  readonly onHover?: (matrix: number | null, part: BoardPart | null) => void;
  /** Called once if frames are too slow to keep the 3D view usable. */
  readonly onSlow: (fps: number) => void;
  /** Called after a flat/3D transition finishes. */
  readonly onViewSettled?: (flat: boolean) => void;
}

export interface SceneOptions {
  readonly parts: {readonly logo: boolean; readonly side: boolean};
  readonly logoText?: string;
  readonly reducedMotion: boolean;
  /** Bloom on the lights. Defaults to on, except on software renderers. */
  readonly bloom?: boolean;
  readonly hooks: SceneHooks;
}

export interface SceneLights {
  readonly backlight: ZonePreview | null;
  readonly logo: ZonePreview | null;
  readonly side: ZonePreview | null;
}

interface CapGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly topW: number;
  readonly topD: number;
}

interface CapGroup {
  readonly mesh: THREE.InstancedMesh;
  readonly keys: BoardKey[];
  readonly highlight: THREE.InstancedBufferAttribute;
  readonly rect: THREE.InstancedBufferAttribute;
}

interface KeyState {
  readonly key: BoardKey;
  readonly group: CapGroup;
  readonly slot: number;
  readonly cell: {x: number; y: number; w: number; h: number};
  press: number;
  tapUntil: number;
  lift: number;
  drop: number;
  highlight: number;
  swapAt: number | null;
  art: LegendArt | null;
  pendingArt: LegendArt | null;
}

interface View {
  theta: number;
  phi: number;
  r: number;
  ty: number;
  tz: number;
}

/** A key press for the reactive effects: which LED, and when (performance.now ms). */
interface Hit {
  readonly led: LedPoint;
  readonly at: number;
}

/** Uniforms every lit surface shares: the light field and the side strips. */
interface SharedUniforms {
  readonly [name: string]: THREE.IUniform;
}

const ease = (t: number) => 1 - (1 - t) ** 3;
const easeBack = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const damp = (current: number, goal: number, k: number, dt: number) => current + (goal - current) * (1 - Math.exp(-k * dt));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** True for CPU renderers (SwiftShader, llvmpipe, Microsoft Basic Render Driver). */
const isSoftwareRenderer = (renderer: THREE.WebGLRenderer): boolean => {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software|basic render/i.test(name);
};

export class KeyboardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  private readonly board = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-9, -9);
  private readonly keyStates: KeyState[] = [];
  private readonly stateByMatrix = new Map<number, KeyState>();
  private readonly groups: CapGroup[] = [];
  private readonly atlas: HTMLCanvasElement;
  private readonly atlasTexture: THREE.CanvasTexture;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly width: number;
  private readonly height: number;
  private readonly field: LightField;
  private readonly leds: LedPoint[];
  private readonly keyColours: Float32Array;
  private readonly shared: SharedUniforms;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private bloomOn: boolean;
  private bloomReason: string | null = null;
  private caseBox = {x0: 0, x1: 0, z0: 0, z1: 0};
  private logo: {lit: THREE.Mesh; halo: THREE.Mesh; hit: THREE.Mesh; material: THREE.MeshBasicMaterial; haloMaterial: THREE.MeshBasicMaterial} | null = null;
  private side: {strips: THREE.Mesh[]; material: THREE.MeshBasicMaterial; haloMaterial: THREE.MeshBasicMaterial; length: number} | null = null;
  private shadow: THREE.Mesh | null = null;
  private lights: SceneLights = {backlight: null, logo: null, side: null};
  private partGain: Record<BoardPart, number> = {backlight: 1, logo: 1, side: 1};
  private partGoal: Record<BoardPart, number> = {backlight: 1, logo: 1, side: 1};
  private view: View = {theta: -0.12, phi: 0.8, r: 27, ty: -0.5, tz: 0.6};
  private goal: View = {...this.view};
  private home: View = {...this.view};
  private flat = false;
  private flatSettledReported = true;
  private selected: number | null = null;
  private focused: number | null = null;
  private hover: number | null = null;
  private hoverPart: BoardPart | null = null;
  private hits: Hit[] = [];
  private clock = 0;
  private lastFrame = 0;
  private raf = 0;
  private introStart: number | null = null;
  private dragging: {x: number; y: number; moved: boolean} | null = null;
  private frameTimes: number[] = [];
  private slowReported = false;
  private disposed = false;
  private atlasDirty = false;
  private paused = false;
  private ring: THREE.Mesh | null = null;
  private readonly ringMaterial = this.track(new THREE.MeshBasicMaterial({color: '#fbfaf6', transparent: true, toneMapped: false, depthWrite: false}));
  private readonly hooks: SceneHooks;
  private readonly reducedMotion: boolean;
  private viewportW = 1;
  private viewportH = 1;
  /** Last measured frame rate while animating. */
  fps = 0;
  /** Frames drawn since the scene started; tests read it to check nothing draws while idle. */
  framesDrawn = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: BoardModel,
    options: SceneOptions,
  ) {
    this.hooks = options.hooks;
    this.reducedMotion = options.reducedMotion;
    this.width = model.width;
    this.height = model.height;
    this.leds = ledPoints(model.keys.map((key) => ({cx: key.cx, cy: key.cy, isMod: key.tone !== 'alpha'})));
    this.keyColours = new Float32Array(model.keys.length * 3);

    const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance', alpha: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    // Bloom: a half-resolution pass that only picks up light sources (see brightPass below).
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new MultisampledRenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.4, 1.0);
    pickBrightestChannel(this.bloomPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.bloomOn = options.bloom ?? !isSoftwareRenderer(renderer);
    if (!this.bloomOn) {
      this.bloomReason = options.bloom === false ? 'off' : 'software renderer';
    }

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 34, 80);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.textures.push(environment);
    this.scene.environment = environment;
    // A desk at night under one lamp: enough light to read every legend, dim enough for the LEDs to carry.
    this.scene.environmentIntensity = 0.32;
    this.scene.add(new THREE.HemisphereLight('#d5ddff', '#2a2433', 0.5));
    const key = new THREE.DirectionalLight('#fff1e0', 1.35);
    key.position.set(-7, 18, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fb4ff', 0.5);
    rim.position.set(10, 6, -12);
    this.scene.add(rim);

    this.board.rotation.x = TILT;
    this.scene.add(this.board);

    this.field = new LightField(
      model.keys.map((k) => ({x: k.cx - this.width / 2, z: k.cy - this.height / 2, w: k.w - 0.02, d: k.h - 0.02})),
      this.width,
      this.height,
    );
    this.shared = {
      ...this.field.uniforms,
      uStripColor: {value: new THREE.Color(0, 0, 0)},
      uStripL0: {value: new THREE.Vector3()},
      uStripL1: {value: new THREE.Vector3()},
      uStripR0: {value: new THREE.Vector3()},
      uStripR1: {value: new THREE.Vector3()},
    };

    const soft = this.softTexture();
    this.buildCase();
    this.buildDesk(soft);
    const {atlas, texture, cells} = this.buildAtlas();
    this.atlas = atlas;
    this.atlasTexture = texture;
    this.buildCaps(cells);
    if (options.parts.side) {
      this.buildSide(soft);
    }
    if (options.parts.logo) {
      this.buildLogo(soft, options.logoText ?? '');
    }

    this.bindPointer();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Sets every keycap's legend, in model key order. Changed keys flip in a wave when `animate` is true. */
  setLegends(arts: readonly LegendArt[], animate: boolean): void {
    const wave = animate && !this.reducedMotion && this.introStart !== null;
    this.keyStates.forEach((state, idx) => {
      const art = arts[idx];
      if (!art || sameArt(state.art, art)) {
        state.pendingArt = null;
        state.swapAt = null;
        return;
      }
      if (state.pendingArt && sameArt(state.pendingArt, art)) {
        return; // Already on its way.
      }
      if (wave && state.art !== null) {
        state.pendingArt = art;
        state.swapAt = this.clock + state.key.nx * 0.32;
      } else {
        state.art = art;
        state.pendingArt = null;
        state.swapAt = null;
        this.drawCell(state);
      }
    });
    this.invalidate();
  }

  setSelected(matrix: number | null): void {
    this.selected = matrix;
    if (this.ring) {
      this.board.remove(this.ring);
      this.ring.geometry.dispose();
      this.ring = null;
    }
    const state = matrix === null ? undefined : this.stateByMatrix.get(matrix);
    if (state) {
      // A slim ring around the cap, sharing its rounded shape.
      const {w, h} = state.key;
      const pad = 0.035;
      const thickness = 0.055;
      const shape = new THREE.Shape();
      roundRectPath(shape, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, 0.16);
      const hole = new THREE.Path();
      roundRectPath(hole, -w / 2 - pad + thickness, -h / 2 - pad + thickness, w + (pad - thickness) * 2, h + (pad - thickness) * 2, 0.11);
      shape.holes.push(hole);
      const geometry = new THREE.ShapeGeometry(shape, 6);
      geometry.rotateX(-Math.PI / 2);
      this.ring = new THREE.Mesh(geometry, this.ringMaterial);
      this.ring.renderOrder = 2;
      this.board.add(this.ring);
    }
    this.invalidate();
  }

  setFocused(matrix: number | null): void {
    this.focused = matrix;
    this.invalidate();
  }

  /** A short press on one key, as feedback for a click or a change. */
  press(matrix: number): void {
    const state = this.stateByMatrix.get(matrix);
    if (state) {
      state.tapUntil = this.clock + (this.reducedMotion ? 0 : 0.12);
      this.invalidate();
    }
  }

  /**
   * A key press for the reactive backlight effects, as the keyboard records
   * one (rgb_matrix_handle_key_event). With reduced motion, presses are
   * not shown.
   */
  keyHit(matrix: number): void {
    const state = this.stateByMatrix.get(matrix);
    const led = state ? this.leds[state.key.index] : undefined;
    if (!led || this.reducedMotion) {
      return;
    }
    this.hits = [...this.hits, {led, at: performance.now()}].slice(-LED_HITS_TO_REMEMBER);
    this.invalidate();
  }

  setLights(lights: SceneLights): void {
    this.lights = lights;
    this.invalidate();
  }

  /** Brings one part of the board forward by dimming the others. */
  highlightPart(part: BoardPart | null): void {
    for (const name of ['backlight', 'logo', 'side'] as const) {
      this.partGoal[name] = part === null || part === name ? 1 : 0.22;
    }
    this.invalidate();
  }

  /** Tips the board to a straight top-down view, or back. */
  setFlat(flat: boolean, animate: boolean): void {
    this.flat = flat;
    this.flatSettledReported = false;
    this.goal = flat ? this.flatView() : {...this.home};
    if (!animate || this.reducedMotion) {
      this.view = {...this.goal};
    }
    this.invalidate();
  }

  /**
   * Shows the board. With `animate`, it builds itself: the case rises and the
   * keys drop in left to right. Interaction works throughout.
   */
  startIntro(animate: boolean): void {
    this.introStart = this.reducedMotion || !animate ? this.clock - 10 : this.clock;
    this.invalidate();
  }

  /**
   * Fits the board to a new canvas size and draws at once, so a dragged
   * split never shows an empty frame.
   */
  resize(width: number, height: number): void {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
    this.renderer.setSize(this.viewportW, this.viewportH, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.viewportW, this.viewportH);
    this.camera.aspect = this.viewportW / this.viewportH;
    this.camera.fov = this.camera.aspect < 1.2 ? 38 : 30;
    // Keep the board between the stage's top controls and its bottom notes.
    const shift = Math.min(INSET_TOP - INSET_BOTTOM, this.viewportH * 0.05) / 2;
    this.camera.setViewOffset(this.viewportW, this.viewportH, 0, -shift, this.viewportW, this.viewportH);
    this.camera.updateProjectionMatrix();
    this.home = this.homeView();
    this.goal = this.flat ? this.flatView() : {...this.home, theta: this.goal.theta, phi: this.goal.phi};
    if (this.flat) {
      this.view = {...this.goal};
    } else {
      this.goal.r = this.home.r;
      this.view.r = this.home.r;
    }
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = this.home.r + 8;
      fog.far = this.home.r + 55;
    }
    if (!this.paused && !this.disposed && this.introStart !== null) {
      this.update(0, performance.now());
      this.draw();
    }
    this.invalidate();
  }

  /** Puts the camera back to the default working view. */
  resetView(): void {
    if (!this.flat) {
      this.goal = {...this.home};
      this.invalidate();
    }
  }

  /** Stops drawing while the canvas is hidden (flat view); resumes with one frame. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.invalidate();
    }
  }

  invalidate(): void {
    if (this.disposed || this.paused || this.raf !== 0) {
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Where a key's top centre is on the canvas, in CSS pixels. Used by tests to click real keys. */
  keyScreenPosition(matrix: number): {x: number; y: number} | null {
    const state = this.stateByMatrix.get(matrix);
    if (!state) {
      return null;
    }
    this.board.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const point = new THREE.Vector3(state.key.cx - this.width / 2, CAP_Y + CAP_H, state.key.cy - this.height / 2 - 0.03)
      .applyMatrix4(this.board.matrixWorld)
      .project(this.camera);
    return {x: ((point.x + 1) / 2) * this.viewportW, y: ((1 - point.y) / 2) * this.viewportH};
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  /** True while bloom is drawn. */
  get bloomActive(): boolean {
    return this.bloomOn;
  }

  /** Why bloom is off, if it is: "software renderer", "slow frames" or "off". */
  get bloomOffReason(): string | null {
    return this.bloomReason;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.field.dispose();
    this.atlasTexture.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private track<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(item: T): T {
    if (item instanceof THREE.Material) {
      this.materials.push(item);
    } else if (item instanceof THREE.BufferGeometry) {
      this.geometries.push(item);
    } else {
      this.textures.push(item);
    }
    return item;
  }

  private softTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    if (g) {
      const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gradient;
      g.fillRect(0, 0, 128, 128);
    }
    return this.track(new THREE.CanvasTexture(canvas));
  }

  private plane(w: number, d: number, material: THREE.Material): THREE.Mesh {
    const geometry = this.track(new THREE.PlaneGeometry(w, d));
    geometry.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geometry, material);
  }

  private buildDesk(soft: THREE.Texture): void {
    const material = this.track(new THREE.MeshStandardMaterial({color: '#2d3346', roughness: 0.9, metalness: 0}));
    // Light from the board falls on the desk: the backlight escaping around the case, and pools under the side strips.
    lightSurface(material, this.shared, 'desk', `
vec3 boardGlow = farLight(vLitBoard.xz) * ${LIGHT.desk.toFixed(3)} * (diffuseColor.rgb * 2.4 + 0.05);
vec3 strips = stripLight(vLitWorld) * ${LIGHT.strip.toFixed(3)} * (diffuseColor.rgb * 3.0 + 0.16);
totalEmissiveRadiance += boardGlow + strips;`);
    const desk = this.plane(240, 240, material);
    desk.position.y = DESK_Y;
    this.scene.add(desk);
    const shadow = this.plane(
      this.width + 5,
      this.height + 5.5,
      this.track(new THREE.MeshBasicMaterial({map: soft, color: '#000', transparent: true, opacity: 0.7, depthWrite: false})),
    );
    shadow.position.set(0, DESK_Y + 0.006, 0.2);
    this.scene.add(shadow);
    this.shadow = shadow;
  }

  private buildCase(): void {
    const W = this.width;
    const H = this.height;
    const margin = {side: 0.45, front: 0.42, back: 1.0};
    this.caseBox = {x0: -W / 2 - margin.side, x1: W / 2 + margin.side, z0: -H / 2 - margin.back, z1: H / 2 + margin.front};
    const shape = new THREE.Shape();
    roundRectPath(shape, this.caseBox.x0, -this.caseBox.z1, this.caseBox.x1 - this.caseBox.x0, this.caseBox.z1 - this.caseBox.z0, 0.5);
    const hole = new THREE.Path();
    roundRectPath(hole, -W / 2 - 0.06, -H / 2 - 0.06, W + 0.12, H + 0.12, 0.14);
    shape.holes.push(hole);
    const depth = 1.0;
    const bevel = 0.1;
    const geometry = this.track(
      new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.1, bevelSegments: 4, curveSegments: 8}),
    );
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, CASE_TOP - (depth + bevel), 0);
    const caseMaterial = this.track(new THREE.MeshStandardMaterial({color: '#2c3140', roughness: 0.38, metalness: 0.6}));
    // The inner walls and the lip catch the backlight (the outer walls face away from it); the flanks catch the side strips.
    lightSurface(caseMaterial, this.shared, 'case', `
vec2 toCentre = normalize(-vLitBoard.xz + 1e-4);
float inward = max(dot(normalize(vLitNormal.xz + 1e-4), toCentre), 0.0) * (1.0 - abs(vLitNormal.y));
float up = max(vLitNormal.y, 0.0);
vec3 fromKeys = nearLight(vLitBoard.xz) * ${LIGHT.caseNear.toFixed(3)} * (inward + 0.5 * up) + farLight(vLitBoard.xz) * ${LIGHT.caseFar.toFixed(3)} * up;
totalEmissiveRadiance += fromKeys * (diffuseColor.rgb * 3.0 + 0.04) + stripLight(vLitWorld) * ${(LIGHT.strip * 0.18).toFixed(3)} * (1.0 - up);`);
    this.board.add(new THREE.Mesh(geometry, caseMaterial));
    // The plate sits on the LEDs: around and between the caps it glows the most.
    const plateGeometry = this.track(new THREE.BoxGeometry(W + 0.1, 0.04, H + 0.1));
    const plateMaterial = this.track(new THREE.MeshStandardMaterial({color: '#3a3f4c', roughness: 0.45, metalness: 0.55}));
    lightSurface(plateMaterial, this.shared, 'plate', `
totalEmissiveRadiance += nearLight(vLitBoard.xz) * ${LIGHT.plate.toFixed(3)};`);
    this.board.add(new THREE.Mesh(plateGeometry, plateMaterial));
  }

  private buildAtlas(): {atlas: HTMLCanvasElement; texture: THREE.CanvasTexture; cells: {x: number; y: number; w: number; h: number}[]} {
    const cells: {x: number; y: number; w: number; h: number}[] = [];
    let x = CELL_PAD;
    let y = CELL_PAD;
    let rowH = 0;
    for (const key of this.model.keys) {
      const {topW, topD} = capTop(key.w, key.h);
      const w = Math.round(topW * PPU);
      const h = Math.round(topD * PPU);
      if (x + w + CELL_PAD > ATLAS_W) {
        x = CELL_PAD;
        y += rowH + CELL_PAD * 2;
        rowH = 0;
      }
      cells.push({x, y, w, h});
      x += w + CELL_PAD * 2;
      rowH = Math.max(rowH, h);
    }
    const atlas = document.createElement('canvas');
    atlas.width = ATLAS_W;
    atlas.height = y + rowH + CELL_PAD;
    const texture = new THREE.CanvasTexture(atlas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.flipY = false;
    return {atlas, texture, cells};
  }

  private buildCaps(cells: readonly {x: number; y: number; w: number; h: number}[]): void {
    const bySize = new Map<string, BoardKey[]>();
    for (const key of this.model.keys) {
      const signature = `${key.w}x${key.h}`;
      bySize.set(signature, [...(bySize.get(signature) ?? []), key]);
    }
    const sideMaterial = this.track(new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.8, metalness: 0}));
    const topMaterial = this.track(new THREE.MeshStandardMaterial({map: this.atlasTexture, roughness: 0.6, metalness: 0}));
    injectCapShader(sideMaterial, this.shared, false);
    injectCapShader(topMaterial, this.shared, true);
    const matrix = new THREE.Matrix4();
    for (const keys of bySize.values()) {
      const first = keys[0];
      if (!first) {
        continue;
      }
      const cap = capGeometry(first.w, first.h);
      this.track(cap.geometry);
      const tone = new Float32Array(keys.length * 3);
      const highlight = new THREE.InstancedBufferAttribute(new Float32Array(keys.length), 1);
      const rect = new THREE.InstancedBufferAttribute(new Float32Array(keys.length * 4), 4);
      highlight.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.InstancedMesh(cap.geometry, [sideMaterial, topMaterial], keys.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const group: CapGroup = {mesh, keys, highlight, rect};
      keys.forEach((key, slot) => {
        const color = new THREE.Color(CAP_COLORS[key.tone].body).convertSRGBToLinear();
        tone.set([color.r, color.g, color.b], slot * 3);
        const cell = cells[key.index] ?? {x: 0, y: 0, w: 1, h: 1};
        rect.setXYZW(slot, cell.x / ATLAS_W, cell.y / this.atlas.height, cell.w / ATLAS_W, cell.h / this.atlas.height);
        matrix.makeTranslation(key.cx - this.width / 2, CAP_Y, key.cy - this.height / 2);
        mesh.setMatrixAt(slot, matrix);
        const state: KeyState = {key, group, slot, cell, press: 0, tapUntil: 0, lift: 0, drop: 0, highlight: 0, swapAt: null, art: null, pendingArt: null};
        this.keyStates[key.index] = state;
        this.stateByMatrix.set(key.matrix, state);
      });
      cap.geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(tone, 3));
      // Each size has its own geometry, so per-instance attributes can live on it.
      cap.geometry.setAttribute('aHighlight', highlight);
      cap.geometry.setAttribute('aRect', rect);
      // Keys move during the intro and presses; skip culling instead of recomputing bounds.
      mesh.frustumCulled = false;
      this.board.add(mesh);
      this.groups.push(group);
    }
  }

  private buildSide(soft: THREE.Texture): void {
    const material = this.track(new THREE.MeshBasicMaterial({color: '#000', toneMapped: true}));
    const haloMaterial = this.track(
      new THREE.MeshBasicMaterial({map: soft, color: '#000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}),
    );
    const length = this.caseBox.z1 - this.caseBox.z0 - 1.2;
    const geometry = this.track(new THREE.BoxGeometry(0.06, 0.16, length));
    const strips: THREE.Mesh[] = [];
    for (const sideSign of [-1, 1]) {
      const x = sideSign < 0 ? this.caseBox.x0 - 0.12 : this.caseBox.x1 + 0.12;
      const strip = new THREE.Mesh(geometry, material);
      strip.position.set(x, -0.42, (this.caseBox.z0 + this.caseBox.z1) / 2);
      strip.userData['part'] = 'side';
      this.board.add(strip);
      strips.push(strip);
      // A thin bright core on the flank, read as light rather than paint.
      const haloGeometry = this.track(new THREE.PlaneGeometry(length + 1.4, 0.9));
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.rotation.y = (sideSign * Math.PI) / 2;
      halo.position.set(x + sideSign * 0.035, -0.42, strip.position.z);
      this.board.add(halo);
    }
    this.side = {strips, material, haloMaterial, length};
  }

  private buildLogo(soft: THREE.Texture, text: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    if (g) {
      g.font = `600 76px ${LEGEND_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.letterSpacing = '10px';
      g.fillText(text || '●', 256, 68);
    }
    const texture = this.track(new THREE.CanvasTexture(canvas));
    const position = new THREE.Vector3(this.width / 2 - 1.55, CASE_TOP + 0.004, -this.height / 2 - 0.52);
    const etched = this.plane(1.9, 0.475, this.track(new THREE.MeshBasicMaterial({map: texture, transparent: true, color: '#454b5c', depthWrite: false})));
    etched.position.copy(position);
    const material = this.track(new THREE.MeshBasicMaterial({map: texture, transparent: true, color: '#000', depthWrite: false, blending: THREE.AdditiveBlending}));
    const lit = this.plane(1.9, 0.475, material);
    lit.position.copy(position).add(new THREE.Vector3(0, 0.002, 0));
    const haloMaterial = this.track(
      new THREE.MeshBasicMaterial({map: soft, transparent: true, color: '#000', depthWrite: false, blending: THREE.AdditiveBlending}),
    );
    const halo = this.plane(3.4, 1.4, haloMaterial);
    halo.position.copy(position).add(new THREE.Vector3(0, 0.001, 0));
    const hitGeometry = this.track(new THREE.BoxGeometry(2.4, 0.3, 0.9));
    const hit = new THREE.Mesh(hitGeometry, this.track(new THREE.MeshBasicMaterial({visible: false})));
    hit.position.copy(position);
    hit.userData['part'] = 'logo';
    for (const mesh of [etched, halo, lit, hit]) {
      this.board.add(mesh);
    }
    this.logo = {lit, halo, hit, material, haloMaterial};
  }

  private drawCell(state: KeyState): void {
    const g = this.atlas.getContext('2d');
    if (!g || !state.art) {
      return;
    }
    const {x, y, w, h} = state.cell;
    drawLegend(g, state.art, x, y, w, h, CELL_PAD);
    this.atlasDirty = true;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  /** Camera distance that fits a span, inside the area the stage's controls leave free. */
  private fitDistance(spanW: number, spanH: number): number {
    const usable = Math.max(0.4, (this.viewportH - INSET_TOP - INSET_BOTTOM) / this.viewportH);
    const vfov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vfov / 2) * usable;
    const tanH = Math.tan(vfov / 2) * this.camera.aspect;
    return Math.max(spanW / 2 / tanH, spanH / 2 / tanV);
  }

  private homeView(): View {
    // The tilted, slightly turned board needs more room than its footprint.
    const r = this.fitDistance(this.width + 4.5, (this.height + 4) * 0.82) * 1.02;
    return {theta: -0.1, phi: 0.74, r: Math.max(14, r), ty: -0.4, tz: 0.45};
  }

  private flatView(): View {
    const r = this.fitDistance(this.width + 1.6, this.height + 2.4);
    return {theta: 0, phi: 0.0001, r, ty: 0, tz: 0};
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, {passive: false});
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = {x: event.clientX, y: event.clientY, moved: false};
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const drag = this.dragging;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true;
      }
      if (drag.moved && !this.flat) {
        this.goal.theta = clamp(this.goal.theta - event.movementX * 0.005, -0.9, 0.9);
        this.goal.phi = clamp(this.goal.phi - event.movementY * 0.004, 0.25, 1.25);
        if (this.reducedMotion) {
          this.view = {...this.goal};
        }
      }
    }
    this.updateHover();
    this.invalidate();
  };

  private readonly onPointerUp = () => {
    const drag = this.dragging;
    this.dragging = null;
    if (drag && !drag.moved) {
      const hit = this.pick();
      if (hit?.matrix !== undefined) {
        this.hooks.onKeyClick(hit.matrix);
      } else if (hit?.part) {
        this.hooks.onPartClick(hit.part);
      }
    }
  };

  private readonly onPointerLeave = () => {
    this.pointer.set(-9, -9);
    this.updateHover();
    this.invalidate();
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (this.flat) {
      return;
    }
    event.preventDefault();
    this.goal.r = clamp(this.goal.r * (1 + event.deltaY * 0.001), this.home.r * 0.55, this.home.r * 1.4);
    this.invalidate();
  };

  private pick(): {matrix?: number; part?: BoardPart} | null {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [...this.groups.map((group) => group.mesh)];
    if (this.logo) {
      targets.push(this.logo.hit);
    }
    if (this.side) {
      targets.push(...this.side.strips);
    }
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      return null;
    }
    const part = hit.object.userData['part'];
    if (part === 'logo' || part === 'side') {
      return {part};
    }
    const group = this.groups.find((candidate) => candidate.mesh === hit.object);
    const key = hit.instanceId === undefined ? undefined : group?.keys[hit.instanceId];
    return key ? {matrix: key.matrix} : null;
  }

  private updateHover(): void {
    const hit = this.pick();
    const matrix = hit?.matrix ?? null;
    const part = hit?.part ?? (matrix !== null ? 'backlight' : null);
    if (matrix !== this.hover || part !== this.hoverPart) {
      this.hover = matrix;
      this.hoverPart = part;
      this.canvas.style.cursor = hit ? 'pointer' : this.flat ? 'default' : 'grab';
      this.hooks.onHover?.(matrix, hit?.part ?? null);
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private readonly frame = (now: number) => {
    this.raf = 0;
    if (this.disposed) {
      return;
    }
    const dt = this.lastFrame === 0 ? 1 / 60 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.clock += dt;
    const active = this.update(dt, performance.now());
    this.draw();
    if (active) {
      this.measure(dt);
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.lastFrame = 0;
      this.frameTimes = [];
    }
  };

  private draw(): void {
    if (this.atlasDirty) {
      this.atlasTexture.needsUpdate = true;
      this.atlasDirty = false;
    }
    // Count every pass of the frame, not just the last one.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.bloomOn) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.framesDrawn += 1;
  }

  /** Watches frame times while animating; checks each second of continuous animation. */
  private measure(dt: number): void {
    this.frameTimes.push(dt);
    const total = this.frameTimes.reduce((sum, value) => sum + value, 0);
    if (this.frameTimes.length < 8 || total < 1) {
      return;
    }
    this.checkFrameTimes(this.frameTimes);
    this.frameTimes = [];
  }

  /**
   * Bloom goes first: if the median frame takes longer than 1/45 s with
   * bloom on, bloom is switched off. Without bloom, a median frame longer
   * than 1/18 s reports once (onSlow), so the page can switch to the flat
   * board. Public so tests can feed it frame times from a slow machine.
   */
  checkFrameTimes(samples: readonly number[]): void {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1 / 60;
    this.fps = Math.round(1 / median);
    if (this.bloomOn && median > 1 / 45) {
      this.bloomOn = false;
      this.bloomReason = 'slow frames';
      this.invalidate();
      return;
    }
    if (median > 1 / 18 && !this.slowReported) {
      this.slowReported = true;
      this.hooks.onSlow(this.fps);
    }
  }

  /** Where a lit part (logo, side strip) is on the canvas, in CSS pixels. */
  partScreenPosition(part: BoardPart): {x: number; y: number} | null {
    const mesh = part === 'logo' ? this.logo?.hit : part === 'side' ? this.side?.strips[0] : undefined;
    if (!mesh) {
      return null;
    }
    this.board.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const point = mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return {x: ((point.x + 1) / 2) * this.viewportW, y: ((1 - point.y) / 2) * this.viewportH};
  }

  private update(dt: number, nowMs: number): boolean {
    let active = false;
    const t = this.clock;
    const intro = this.introStart === null ? -1 : t - this.introStart;
    if (intro >= 0 && intro < 2.2) {
      active = true;
    }

    // Camera.
    const k = this.reducedMotion ? 1000 : 6.5;
    let cameraMoving = false;
    for (const name of ['theta', 'phi', 'r', 'ty', 'tz'] as const) {
      const next = damp(this.view[name], this.goal[name], k, dt);
      if (Math.abs(next - this.goal[name]) > 0.0005) {
        cameraMoving = true;
        this.view[name] = next;
      } else {
        this.view[name] = this.goal[name];
      }
    }
    active ||= cameraMoving;
    if (!cameraMoving && !this.flatSettledReported) {
      this.flatSettledReported = true;
      this.hooks.onViewSettled?.(this.flat);
    }
    const v = this.view;
    const sp = Math.sin(v.phi);
    this.camera.position.set(v.r * sp * Math.sin(v.theta), v.ty + v.r * Math.cos(v.phi), v.tz + v.r * sp * Math.cos(v.theta));
    this.camera.up.set(0, v.phi < 0.01 ? 0 : 1, v.phi < 0.01 ? -1 : 0);
    this.camera.lookAt(0, v.ty, v.tz);
    // In the flat view, lie the board down so the top of the caps faces the camera.
    this.board.rotation.x = dt === 0 ? this.board.rotation.x : damp(this.board.rotation.x, this.flat ? 0 : TILT, k, dt);

    // Case rises, then keys drop left to right.
    const caseP = this.introStart === null ? 0 : ease(smooth(0, 0.5, intro));
    this.board.position.y = this.introStart === null ? -3 : (1 - caseP) * -1.4;
    this.board.visible = this.introStart !== null;
    if (this.shadow) {
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.7 * caseP;
    }

    // Part emphasis.
    for (const name of ['backlight', 'logo', 'side'] as const) {
      const next = damp(this.partGain[name], this.partGoal[name], this.reducedMotion ? 1000 : 8, dt);
      if (Math.abs(next - this.partGoal[name]) > 0.002) {
        active = true;
      }
      this.partGain[name] = Math.abs(next - this.partGoal[name]) > 0.002 ? next : this.partGoal[name];
    }

    // Backlight: the firmware's own formula per LED, with remembered key presses for reactive effects.
    const lit = this.lights.backlight;
    const back = lit && this.reducedMotion ? stillPreview(lit) : lit;
    const timer = this.reducedMotion ? 0 : nowMs;
    this.hits = this.hits.filter((hit) => nowMs - hit.at < 65_535);
    const hits: KeyHit[] = this.hits.map((hit) => ({x: hit.led.x, y: hit.led.y, index: hit.led.index, tick: Math.max(0, Math.round(nowMs - hit.at))}));
    if (back?.animated || (back?.reactive && hitsStillShowing(back.effect, back.speed, hits))) {
      active = true;
    }
    const lightsWake = this.introStart === null ? 0 : smooth(0.9, 1.6, intro);
    const backGain = lightsWake * this.partGain.backlight;
    const matrix = new THREE.Matrix4();
    for (const state of this.keyStates) {
      const key = state.key;
      if (state.swapAt !== null && state.pendingArt) {
        active = true;
        if (t >= state.swapAt + 0.06) {
          state.art = state.pendingArt;
          state.pendingArt = null;
          state.swapAt = null;
          this.drawCell(state);
        } else if (t >= state.swapAt) {
          state.tapUntil = Math.max(state.tapUntil, state.swapAt + 0.08);
        }
      }
      const delay = 0.1 + key.nx * 0.55 + key.ny * 0.08;
      const dropP = this.introStart === null ? 0 : smooth(0, 1, (intro - delay) / 0.45);
      state.drop = (1 - easeBack(dropP)) * 3;
      if (dropP < 1 && this.introStart !== null) {
        active = true;
      }
      const isSelected = this.selected === key.matrix;
      const pressGoal = t < state.tapUntil ? 1 : isSelected ? 0.45 : 0;
      const pressNext = damp(state.press, pressGoal, pressGoal > state.press ? 45 : 18, dt);
      state.press = dt === 0 ? state.press : Math.abs(pressNext - pressGoal) < 0.002 ? pressGoal : pressNext;
      if (state.press !== pressGoal || t < state.tapUntil) {
        active = true;
      }
      const liftGoal = (this.hover === key.matrix || this.focused === key.matrix) && !isSelected ? 1 : 0;
      const liftNext = damp(state.lift, liftGoal, 16, dt);
      state.lift = dt === 0 ? state.lift : Math.abs(liftNext - liftGoal) < 0.002 ? liftGoal : liftNext;
      if (state.lift !== liftGoal) {
        active = true;
      }
      matrix.makeTranslation(key.cx - this.width / 2, CAP_Y + state.drop - state.press * 0.12 + state.lift * 0.05, key.cy - this.height / 2);
      state.group.mesh.setMatrixAt(state.slot, matrix);
      if (isSelected && this.ring) {
        this.ring.position.set(key.cx - this.width / 2, CAP_Y + state.drop - state.press * 0.12 + CAP_H * 0.62, key.cy - this.height / 2);
      }
      const highlight = isSelected ? 0.35 : this.focused === key.matrix ? 0.7 : this.hover === key.matrix ? 0.25 : 0;
      state.group.highlight.setX(state.slot, highlight);

      const led = this.leds[key.index];
      const rgb = back && led ? backlightColor(back, led, {timer, hits}) : [0, 0, 0];
      // Keys still dropping in are not lit yet.
      const keyGain = backGain * smooth(0.5, 1, dropP);
      this.keyColours[key.index * 3] = (rgb[0] ?? 0) * keyGain;
      this.keyColours[key.index * 3 + 1] = (rgb[1] ?? 0) * keyGain;
      this.keyColours[key.index * 3 + 2] = (rgb[2] ?? 0) * keyGain;
    }
    this.field.update(this.keyColours);
    for (const group of this.groups) {
      group.mesh.instanceMatrix.needsUpdate = true;
      // Keys moved: let picking recompute the bounds from the current positions.
      group.mesh.boundingSphere = null;
      group.mesh.boundingBox = null;
      group.highlight.needsUpdate = true;
    }

    this.board.updateMatrixWorld();
    const stripUniform = this.shared['uStripColor']?.value;
    if (this.side) {
      const preview = this.lights.side;
      const rgb = preview ? stripColor(preview) : [0, 0, 0];
      const gain = lightsWake * this.partGain.side;
      const [r, g, b] = [(rgb[0] ?? 0) * gain, (rgb[1] ?? 0) * gain, (rgb[2] ?? 0) * gain];
      // The strip itself is a light source: bright enough to bloom; unlit it reads as frosted plastic.
      this.side.material.color.setRGB(r * 3.2 + 0.03, g * 3.2 + 0.03, b * 3.2 + 0.035);
      this.side.haloMaterial.color.setRGB(r * 0.7, g * 0.7, b * 0.7);
      if (stripUniform instanceof THREE.Color) {
        stripUniform.setRGB(r, g, b);
      }
      const half = this.side.length / 2;
      const ends: [string, THREE.Mesh | undefined, number][] = [
        ['uStripL', this.side.strips[0], -1],
        ['uStripR', this.side.strips[1], 1],
      ];
      for (const [name, strip] of ends) {
        if (!strip) {
          continue;
        }
        const a = this.shared[`${name}0`]?.value;
        const c = this.shared[`${name}1`]?.value;
        if (a instanceof THREE.Vector3 && c instanceof THREE.Vector3) {
          a.set(strip.position.x, strip.position.y, strip.position.z - half).applyMatrix4(this.board.matrixWorld);
          c.set(strip.position.x, strip.position.y, strip.position.z + half).applyMatrix4(this.board.matrixWorld);
        }
      }
    } else if (stripUniform instanceof THREE.Color) {
      stripUniform.setRGB(0, 0, 0);
    }
    if (this.logo) {
      const preview = this.lights.logo;
      const rgb = preview ? stripColor(preview) : [0, 0, 0];
      const gain = lightsWake * this.partGain.logo;
      this.logo.material.color.setRGB((rgb[0] ?? 0) * gain * 3, (rgb[1] ?? 0) * gain * 3, (rgb[2] ?? 0) * gain * 3);
      this.logo.haloMaterial.color.setRGB((rgb[0] ?? 0) * gain * 0.32, (rgb[1] ?? 0) * gain * 0.32, (rgb[2] ?? 0) * gain * 0.32);
    }
    return active;
  }
}

const sameArt = (a: LegendArt | null, b: LegendArt): boolean =>
  a !== null &&
  a.tone === b.tone &&
  a.faded === b.faded &&
  a.legend.kind === b.legend.kind &&
  a.legend.icon === b.legend.icon &&
  a.legend.lines.length === b.legend.lines.length &&
  a.legend.lines.every((line, idx) => line === b.legend.lines[idx]);

/** GLSL shared by every lit surface: the light field and the side strips as two line lights. */
const SURFACE_LIGHT_GLSL = `${LIGHT_FIELD_GLSL}
uniform vec3 uStripColor;
uniform vec3 uStripL0;
uniform vec3 uStripL1;
uniform vec3 uStripR0;
uniform vec3 uStripR1;
float segmentDistance(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - (a + ab * t));
}
vec3 stripLight(vec3 p) {
  float l = segmentDistance(p, uStripL0, uStripL1);
  float r = segmentDistance(p, uStripR0, uStripR1);
  return uStripColor * (1.0 / (1.0 + l * l * 2.8) + 1.0 / (1.0 + r * r * 2.8));
}
`;

/**
 * Adds the board's own light to a standard material: `body` is GLSL that
 * adds to totalEmissiveRadiance, with vLitBoard (board-space position),
 * vLitWorld (world position) and vLitNormal (object-space normal).
 */
const lightSurface = (material: THREE.MeshStandardMaterial, shared: SharedUniforms, name: string, body: string): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLitBoard;\nvarying vec3 vLitWorld;\nvarying vec3 vLitNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLitBoard = transformed;
vLitWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vLitNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLitBoard;\nvarying vec3 vLitWorld;\nvarying vec3 vLitNormal;\n${SURFACE_LIGHT_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${body}`);
  };
  material.customProgramCacheKey = () => `lit-${name}`;
};

/**
 * Keycaps: per-instance tone, highlight and legend rectangle, and the
 * backlight. Light from the plate glows through the lower cap wall (the
 * skirt) and catches the top edges; it never reaches the legend's middle.
 */
const injectCapShader = (material: THREE.MeshStandardMaterial, shared: SharedUniforms, top: boolean): void => {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aTone;
attribute float aHighlight;
attribute vec4 aRect;
varying vec3 vTone;
varying float vHighlight;
varying float vCapHeight;
varying vec2 vCapUv;
varying vec2 vBoardXZ;`,
      )
      .replace(
        '#include <uv_vertex>',
        top
          ? `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = aRect.xy + uv * aRect.zw;
#endif`
          : '#include <uv_vertex>',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTone = aTone;
vHighlight = aHighlight;
vCapHeight = clamp(position.y / ${CAP_H.toFixed(3)}, 0.0, 1.0);
vCapUv = uv;
#ifdef USE_INSTANCING
vBoardXZ = (instanceMatrix * vec4(transformed, 1.0)).xz;
#else
vBoardXZ = transformed.xz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTone;
varying float vHighlight;
varying float vCapHeight;
varying vec2 vCapUv;
varying vec2 vBoardXZ;
${LIGHT_FIELD_GLSL}`,
      )
      .replace('#include <color_fragment>', top ? '#include <color_fragment>' : '#include <color_fragment>\ndiffuseColor.rgb *= vTone;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 under = nearLight(vBoardXZ);
vec3 tint = mix(vec3(1.0), diffuseColor.rgb, 0.55);
${
  top
    ? `float edge = min(min(vCapUv.x, 1.0 - vCapUv.x), min(vCapUv.y, 1.0 - vCapUv.y));
totalEmissiveRadiance += under * tint * (${LIGHT.rim.toFixed(3)} * (1.0 - smoothstep(0.0, 0.11, edge)) + 0.025);`
    : `totalEmissiveRadiance += under * tint * (${LIGHT.skirt.toFixed(3)} * pow(clamp(1.0 - vCapHeight, 0.0, 1.0), 2.0) + 0.03);`
}
totalEmissiveRadiance += vec3(0.30, 0.42, 0.95) * vHighlight * ${top ? '0.32' : '0.22'};`,
      );
  };
  material.customProgramCacheKey = () => (top ? 'cap-top-lit' : 'cap-side-lit');
};

/**
 * Renders the scene with 4x MSAA into its own target, then copies it into
 * the composer's plain buffer. Rendering straight into a multisampled
 * composer buffer does not work with bloom: three.js invalidates the
 * multisampled colour after resolving it, so bloom's additive blend back
 * into that buffer would land on nothing.
 */
class MultisampledRenderPass extends Pass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4});
  private readonly quad = new FullScreenQuad(new THREE.ShaderMaterial({...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms)}));

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    const material = this.quad.material;
    if (material instanceof THREE.ShaderMaterial) {
      const map = material.uniforms['tDiffuse'];
      if (map) {
        map.value = this.target.texture;
      }
    }
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.quad.dispose();
  }
}

/** Bloom picks up light sources by their brightest channel, so a saturated red LED blooms like a white one. */
const pickBrightestChannel = (pass: UnrealBloomPass): void => {
  const material = pass.materialHighPassFilter;
  material.fragmentShader = `
uniform sampler2D tDiffuse;
uniform vec3 defaultColor;
uniform float defaultOpacity;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = max(texel.r, max(texel.g, texel.b));
  vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
  float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  gl_FragColor = mix(outputColor, texel, alpha);
}`;
  const smoothWidth = material.uniforms['smoothWidth'];
  if (smoothWidth) {
    smoothWidth.value = 0.6;
  }
  material.needsUpdate = true;
};

const capTop = (w: number, h: number) => {
  const gap = 0.06;
  const inset = 0.13;
  return {topW: w - gap - inset * 2, topD: h - gap - inset * 2 - 0.02};
};

function roundRectPath(path: THREE.Path, x: number, y: number, w: number, h: number, r: number): void {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

const ringPoints = (w: number, d: number, radius: number, segments: number): [number, number][] => {
  const hw = w / 2;
  const hd = d / 2;
  const r = Math.min(radius, hw, hd);
  const points: [number, number][] = [];
  const corners: [number, number, number][] = [
    [hw - r, hd - r, 0],
    [-hw + r, hd - r, Math.PI / 2],
    [-hw + r, -hd + r, Math.PI],
    [hw - r, -hd + r, Math.PI * 1.5],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (Math.PI / 2);
      points.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return points;
};

/** A sculpted keycap: tapered, softly rounded sides (group 0) and a flat legend top (group 1) with 0-1 UVs. */
const capGeometry = (w: number, h: number): CapGeometry => {
  const gap = 0.06;
  const bw = w - gap;
  const bd = h - gap;
  const rings = [
    {y: 0, inset: 0, r: 0.07},
    {y: CAP_H * 0.55, inset: 0.06, r: 0.1},
    {y: CAP_H - 0.04, inset: 0.11, r: 0.12},
    {y: CAP_H, inset: 0.13, r: 0.11},
  ];
  const segments = 5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const perRing = 4 * (segments + 1);
  rings.forEach((ring, ri) => {
    const points = ringPoints(bw - ring.inset * 2, bd - ring.inset * 2 - (ri > 0 ? 0.02 : 0), ring.r, segments);
    points.forEach(([x, z], i) => {
      positions.push(x, ring.y, z - (ri === 3 ? 0.03 : ri === 2 ? 0.025 : 0));
      uvs.push(i / perRing, ring.y / CAP_H);
    });
  });
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < perRing; i++) {
      const a = ri * perRing + i;
      const a2 = ri * perRing + ((i + 1) % perRing);
      const b = a + perRing;
      const b2 = a2 + perRing;
      indices.push(a, b, a2, a2, b, b2);
    }
  }
  const sideCount = indices.length;
  const top = rings[3] ?? {y: CAP_H, inset: 0.13, r: 0.11};
  const {topW, topD} = capTop(w, h);
  const base = positions.length / 3;
  positions.push(0, CAP_H, -0.03);
  uvs.push(0.5, 0.5);
  ringPoints(topW, topD, top.r, segments).forEach(([x, z]) => {
    positions.push(x, CAP_H, z - 0.03);
    uvs.push(0.5 + x / topW, 0.5 + z / topD);
  });
  for (let i = 0; i < perRing; i++) {
    indices.push(base, base + 1 + ((i + 1) % perRing), base + 1 + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, sideCount, 0);
  geometry.addGroup(sideCount, indices.length - sideCount, 1);
  geometry.computeVertexNormals();
  return {geometry, topW, topD};
};
