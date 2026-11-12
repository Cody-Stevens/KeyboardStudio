/**
 * The real-time 3D keyboard. Built from the definition's layout:
 * - one InstancedMesh per keycap size (sides and top as two material groups),
 * - one legend atlas texture for every keycap top,
 * - per-instance glow (backlight) and highlight injected into the standard material,
 * - logo and side strips when the board has those lighting zones.
 *
 * It renders on demand: a frame is drawn only when something changed or an
 * animation (camera, key press, intro, an animated lighting preview) runs.
 */
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {BoardPart} from '../../core/index.ts';
import type {BoardKey, BoardModel} from '../logic/board-model.ts';
import {backlightColor, stripColor, type ZonePreview} from '../logic/lighting.ts';
import {CAP_COLORS, LEGEND_FONT, drawLegend, type LegendArt} from './legend-art.ts';

const BG = '#161b2e';
const CAP_H = 0.4;
const CAP_Y = 0.14;
const CASE_TOP = 0.32;
const DESK_Y = -0.92;
const TILT = 0.065;
const PPU = 220;
const ATLAS_W = 2048;
const CELL_PAD = 6;

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
  readonly glow: THREE.InstancedBufferAttribute;
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
  private readonly glowMesh: THREE.InstancedMesh;
  private readonly atlas: HTMLCanvasElement;
  private readonly atlasTexture: THREE.CanvasTexture;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly width: number;
  private readonly height: number;
  private caseBox = {x0: 0, x1: 0, z0: 0, z1: 0};
  private logo: {lit: THREE.Mesh; halo: THREE.Mesh; hit: THREE.Mesh; material: THREE.MeshBasicMaterial; haloMaterial: THREE.MeshBasicMaterial} | null = null;
  private side: {strips: THREE.Mesh[]; material: THREE.MeshBasicMaterial; haloMaterial: THREE.MeshBasicMaterial} | null = null;
  private spill: THREE.MeshBasicMaterial | null = null;
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
  private readonly modByIndex: boolean[];
  private viewportW = 1;
  private viewportH = 1;
  /** Last measured frame rate while animating. */
  fps = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: BoardModel,
    options: SceneOptions,
  ) {
    this.hooks = options.hooks;
    this.reducedMotion = options.reducedMotion;
    this.width = model.width;
    this.height = model.height;
    this.modByIndex = model.keys.map((key) => key.tone !== 'alpha');

    const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance', alpha: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 34, 80);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.textures.push(environment);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.45;

    this.scene.add(new THREE.HemisphereLight('#dfe6ff', '#30283a', 0.75));
    const key = new THREE.DirectionalLight('#fff6ea', 1.55);
    key.position.set(-7, 18, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fb4ff', 0.7);
    rim.position.set(10, 6, -12);
    this.scene.add(rim);

    this.board.rotation.x = TILT;
    this.scene.add(this.board);

    const soft = this.softTexture();
    this.buildDesk(soft);
    this.buildCase();
    const {atlas, texture, cells} = this.buildAtlas();
    this.atlas = atlas;
    this.atlasTexture = texture;
    this.buildCaps(cells);
    this.glowMesh = this.buildGlow(soft);
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

  resize(width: number, height: number): void {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
    this.renderer.setSize(this.viewportW, this.viewportH, false);
    this.camera.aspect = this.viewportW / this.viewportH;
    this.camera.fov = this.camera.aspect < 1.2 ? 38 : 30;
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
    this.atlasTexture.dispose();
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
    const desk = this.plane(240, 240, this.track(new THREE.MeshStandardMaterial({color: '#232a40', roughness: 0.92, metalness: 0})));
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
    this.spill = this.track(
      new THREE.MeshBasicMaterial({map: soft, color: '#000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}),
    );
    const spill = this.plane(this.width + 10, this.height + 9, this.spill);
    spill.position.set(0, DESK_Y + 0.008, 0.6);
    this.scene.add(spill);
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
    const caseMesh = new THREE.Mesh(geometry, this.track(new THREE.MeshStandardMaterial({color: '#2c3140', roughness: 0.38, metalness: 0.6})));
    this.board.add(caseMesh);
    const plateGeometry = this.track(new THREE.BoxGeometry(W + 0.1, 0.04, H + 0.1));
    const plate = new THREE.Mesh(plateGeometry, this.track(new THREE.MeshStandardMaterial({color: '#12141b', roughness: 0.55, metalness: 0.2})));
    this.board.add(plate);
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
    injectCapShader(sideMaterial, false);
    injectCapShader(topMaterial, true);
    const matrix = new THREE.Matrix4();
    for (const keys of bySize.values()) {
      const first = keys[0];
      if (!first) {
        continue;
      }
      const cap = capGeometry(first.w, first.h);
      this.track(cap.geometry);
      const tone = new Float32Array(keys.length * 3);
      const glow = new THREE.InstancedBufferAttribute(new Float32Array(keys.length * 3), 3);
      const highlight = new THREE.InstancedBufferAttribute(new Float32Array(keys.length), 1);
      const rect = new THREE.InstancedBufferAttribute(new Float32Array(keys.length * 4), 4);
      glow.setUsage(THREE.DynamicDrawUsage);
      highlight.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.InstancedMesh(cap.geometry, [sideMaterial, topMaterial], keys.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const group: CapGroup = {mesh, keys, glow, highlight, rect};
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
      cap.geometry.setAttribute('aGlow', glow);
      cap.geometry.setAttribute('aHighlight', highlight);
      cap.geometry.setAttribute('aRect', rect);
      // Keys move during the intro and presses; skip culling instead of recomputing bounds.
      mesh.frustumCulled = false;
      this.board.add(mesh);
      this.groups.push(group);
    }
  }

  private buildGlow(soft: THREE.Texture): THREE.InstancedMesh {
    const geometry = this.track(new THREE.PlaneGeometry(1, 1));
    geometry.rotateX(-Math.PI / 2);
    const material = this.track(
      new THREE.MeshBasicMaterial({map: soft, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}),
    );
    const mesh = new THREE.InstancedMesh(geometry, material, this.model.keys.length);
    mesh.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const black = new THREE.Color(0, 0, 0);
    this.model.keys.forEach((key, idx) => {
      matrix.makeScale(key.w + 0.9, 1, key.h + 0.9);
      matrix.setPosition(key.cx - this.width / 2, 0.03, key.cy - this.height / 2);
      mesh.setMatrixAt(idx, matrix);
      mesh.setColorAt(idx, black);
    });
    this.board.add(mesh);
    return mesh;
  }

  private buildSide(soft: THREE.Texture): void {
    const material = this.track(new THREE.MeshBasicMaterial({color: '#000', toneMapped: false}));
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
      const haloGeometry = this.track(new THREE.PlaneGeometry(length + 2.6, 1.8));
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.rotation.y = (sideSign * Math.PI) / 2;
      halo.position.set(x + sideSign * 0.02, -0.42, strip.position.z);
      this.board.add(halo);
      const pool = this.plane(3.2, length + 3, haloMaterial);
      pool.position.set(x + sideSign * 1.2, DESK_Y + 0.01, strip.position.z);
      this.scene.add(pool);
    }
    this.side = {strips, material, haloMaterial};
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
    const material = this.track(
      new THREE.MeshBasicMaterial({map: texture, transparent: true, color: '#000', depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}),
    );
    const lit = this.plane(1.9, 0.475, material);
    lit.position.copy(position).add(new THREE.Vector3(0, 0.002, 0));
    const haloMaterial = this.track(
      new THREE.MeshBasicMaterial({map: soft, transparent: true, color: '#000', depthWrite: false, blending: THREE.AdditiveBlending}),
    );
    const halo = this.plane(3.8, 1.7, haloMaterial);
    halo.position.copy(position).add(new THREE.Vector3(0, 0.001, 0));
    const hitGeometry = this.track(new THREE.BoxGeometry(2.4, 0.3, 0.9));
    const hit = new THREE.Mesh(hitGeometry, this.track(new THREE.MeshBasicMaterial({visible: false})));
    hit.position.copy(position);
    hit.userData['part'] = 'logo';
    for (const mesh of [etched, lit, halo, hit]) {
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

  private fitDistance(spanW: number, spanH: number): number {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return Math.max(spanW / 2 / Math.tan(hfov / 2), spanH / 2 / Math.tan(vfov / 2));
  }

  private homeView(): View {
    // The tilted, slightly turned board needs more room than its footprint.
    const r = this.fitDistance(this.width + 4.5, (this.height + 4) * 0.82) * 1.06;
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
    const active = this.update(dt, now);
    if (this.atlasDirty) {
      this.atlasTexture.needsUpdate = true;
      this.atlasDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    if (active) {
      this.measure(dt);
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.lastFrame = 0;
      this.frameTimes = [];
    }
  };

  /** Watches frame times while animating; reports once if the GPU cannot keep up. */
  private measure(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) {
      return;
    }
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0.016;
    this.fps = Math.round(1 / median);
    this.frameTimes = [];
    if (median > 1 / 18 && !this.slowReported) {
      this.slowReported = true;
      this.hooks.onSlow(this.fps);
    }
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
    this.board.rotation.x = damp(this.board.rotation.x, this.flat ? 0 : TILT, k, dt);

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

    // Keys.
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const back = this.lights.backlight;
    if (back?.animated) {
      active = true;
    }
    const lightsWake = this.introStart === null ? 0 : smooth(0.9, 1.6, intro);
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
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
      state.press = Math.abs(pressNext - pressGoal) < 0.002 ? pressGoal : pressNext;
      if (state.press !== pressGoal || t < state.tapUntil) {
        active = true;
      }
      const liftGoal = (this.hover === key.matrix || this.focused === key.matrix) && !isSelected ? 1 : 0;
      const liftNext = damp(state.lift, liftGoal, 16, dt);
      state.lift = Math.abs(liftNext - liftGoal) < 0.002 ? liftGoal : liftNext;
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

      const rgb = back ? backlightColor(back, {nx: key.nx, ny: key.ny, isMod: this.modByIndex[key.index] ?? false}, nowMs) : [0, 0, 0];
      const gain = lightsWake * this.partGain.backlight;
      const r = rgb[0] * gain;
      const g = rgb[1] * gain;
      const b = rgb[2] * gain;
      sumR += r;
      sumG += g;
      sumB += b;
      color.setRGB(r * 1.4, g * 1.4, b * 1.4);
      this.glowMesh.setColorAt(key.index, color);
      state.group.glow.setXYZ(state.slot, r * 0.55, g * 0.55, b * 0.55);
    }
    for (const group of this.groups) {
      group.mesh.instanceMatrix.needsUpdate = true;
      group.glow.needsUpdate = true;
      group.highlight.needsUpdate = true;
    }
    if (this.glowMesh.instanceColor) {
      this.glowMesh.instanceColor.needsUpdate = true;
    }
    const n = Math.max(1, this.keyStates.length);
    this.spill?.color.setRGB((sumR / n) * 0.4, (sumG / n) * 0.4, (sumB / n) * 0.4);

    if (this.side) {
      const preview = this.lights.side;
      const rgb = preview ? stripColor(preview) : [0, 0, 0];
      const gain = lightsWake * this.partGain.side;
      this.side.material.color.setRGB(rgb[0] * gain * 1.3 + 0.02, rgb[1] * gain * 1.3 + 0.02, rgb[2] * gain * 1.3 + 0.025);
      this.side.haloMaterial.color.setRGB(rgb[0] * gain * 0.9, rgb[1] * gain * 0.9, rgb[2] * gain * 0.9);
    }
    if (this.logo) {
      const preview = this.lights.logo;
      const rgb = preview ? stripColor(preview) : [0, 0, 0];
      const gain = lightsWake * this.partGain.logo;
      this.logo.material.color.setRGB(rgb[0] * gain * 1.6, rgb[1] * gain * 1.6, rgb[2] * gain * 1.6);
      this.logo.haloMaterial.color.setRGB(rgb[0] * gain * 0.5, rgb[1] * gain * 0.5, rgb[2] * gain * 0.5);
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

/** Adds per-instance tone, glow, highlight and legend rectangle to a standard material. */
const injectCapShader = (material: THREE.MeshStandardMaterial, top: boolean): void => {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aTone;
attribute vec3 aGlow;
attribute float aHighlight;
attribute vec4 aRect;
varying vec3 vTone;
varying vec3 vGlow;
varying float vHighlight;
varying float vCapHeight;`,
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
vGlow = aGlow;
vHighlight = aHighlight;
vCapHeight = clamp(position.y / ${CAP_H.toFixed(3)}, 0.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTone;
varying vec3 vGlow;
varying float vHighlight;
varying float vCapHeight;`,
      )
      .replace('#include <color_fragment>', top ? '#include <color_fragment>' : '#include <color_fragment>\ndiffuseColor.rgb *= vTone;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vGlow * ${top ? '0.08' : 'pow(1.0 - vCapHeight, 2.0)'};
totalEmissiveRadiance += vec3(0.30, 0.42, 0.95) * vHighlight * ${top ? '0.32' : '0.22'};`,
      );
  };
  material.customProgramCacheKey = () => (top ? 'cap-top' : 'cap-side');
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
