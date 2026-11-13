/**
 * The backlight as light on surfaces. Each key's LED colour is painted into
 * two small textures laid over the board, then blurred:
 *
 * - `near` (8 texels per key unit, a short blur) is the light under and
 *   between the caps: it lights the plate, the cap skirts and the inner lip
 *   of the case, so neighbouring keys of different colours blend in the gaps.
 * - `far` (2 texels per key unit, a wide blur) is the light that escapes the
 *   board: it falls on the desk and the case around it.
 *
 * Shaders read both with `boardLight()` (see LIGHT_FIELD_GLSL) at a
 * fragment's board-space x/z. Values are stored square-root encoded in 8-bit
 * textures, so dim light keeps its gradation.
 */
import * as THREE from 'three';

export interface FieldKey {
  /** Centre and size in key units, relative to the board's centre. */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

interface Grid {
  readonly res: number;
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly data: Float32Array;
  readonly bytes: Uint8Array;
  readonly texture: THREE.DataTexture;
  readonly rect: THREE.Vector4;
}

const makeGrid = (res: number, halfW: number, halfD: number): Grid => {
  const cols = Math.ceil(halfW * 2 * res);
  const rows = Math.ceil(halfD * 2 * res);
  const bytes = new Uint8Array(cols * rows * 4);
  const texture = new THREE.DataTexture(bytes, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  const x0 = -cols / res / 2;
  const z0 = -rows / res / 2;
  return {res, x0, z0, cols, rows, data: new Float32Array(cols * rows * 3), bytes, texture, rect: new THREE.Vector4(x0, z0, res / cols, res / rows)};
};

/** Separable box blur on an RGB float grid, `radius` texels each way, in place. */
const boxBlur = (data: Float32Array, cols: number, rows: number, radius: number, scratch: Float32Array): void => {
  const width = radius * 2 + 1;
  // Horizontal into scratch.
  for (let row = 0; row < rows; row++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let k = 0; k <= radius && k < cols; k++) {
        sum += data[(row * cols + k) * 3 + ch] ?? 0;
      }
      for (let col = 0; col < cols; col++) {
        scratch[(row * cols + col) * 3 + ch] = sum / width;
        const add = col + radius + 1;
        const drop = col - radius;
        sum += add < cols ? (data[(row * cols + add) * 3 + ch] ?? 0) : 0;
        sum -= drop >= 0 ? (data[(row * cols + drop) * 3 + ch] ?? 0) : 0;
      }
    }
  }
  // Vertical back into data.
  for (let col = 0; col < cols; col++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let k = 0; k <= radius && k < rows; k++) {
        sum += scratch[(k * cols + col) * 3 + ch] ?? 0;
      }
      for (let row = 0; row < rows; row++) {
        data[(row * cols + col) * 3 + ch] = sum / width;
        const add = row + radius + 1;
        const drop = row - radius;
        sum += add < rows ? (scratch[(add * cols + col) * 3 + ch] ?? 0) : 0;
        sum -= drop >= 0 ? (scratch[(drop * cols + col) * 3 + ch] ?? 0) : 0;
      }
    }
  }
};

export class LightField {
  readonly near: Grid;
  readonly far: Grid;
  private readonly scratchNear: Float32Array;
  private readonly scratchFar: Float32Array;
  private readonly last: Float32Array;
  private readonly keys: readonly FieldKey[];
  /** Uniforms to share with every material that reads the field. */
  readonly uniforms: {
    readonly uNear: {value: THREE.DataTexture};
    readonly uNearRect: {value: THREE.Vector4};
    readonly uFar: {value: THREE.DataTexture};
    readonly uFarRect: {value: THREE.Vector4};
  };

  constructor(keys: readonly FieldKey[], boardW: number, boardD: number) {
    this.keys = keys;
    this.near = makeGrid(8, boardW / 2 + 1.4, boardD / 2 + 1.4);
    this.far = makeGrid(2, boardW / 2 + 7, boardD / 2 + 7);
    this.scratchNear = new Float32Array(this.near.data.length);
    this.scratchFar = new Float32Array(this.far.data.length);
    this.last = new Float32Array(keys.length * 3).fill(-1);
    this.uniforms = {
      uNear: {value: this.near.texture},
      uNearRect: {value: this.near.rect},
      uFar: {value: this.far.texture},
      uFarRect: {value: this.far.rect},
    };
  }

  /** Repaints the field from per-key colours (linear, 0-1), in key order. Skips the work when nothing changed. */
  update(colours: Float32Array): void {
    let changed = false;
    for (let i = 0; i < colours.length; i++) {
      if (Math.abs((colours[i] ?? 0) - (this.last[i] ?? 0)) > 1 / 512) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
    this.last.set(colours);
    this.paint(this.near, colours);
    this.paint(this.far, colours);
    // Two box passes approximate a Gaussian: about 0.2 key units near, 1.3 far.
    boxBlur(this.near.data, this.near.cols, this.near.rows, 2, this.scratchNear);
    boxBlur(this.near.data, this.near.cols, this.near.rows, 1, this.scratchNear);
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(this.far.data, this.far.cols, this.far.rows, 2, this.scratchFar);
    }
    this.encode(this.near);
    this.encode(this.far);
  }

  dispose(): void {
    this.near.texture.dispose();
    this.far.texture.dispose();
  }

  /** Fills each key's footprint, with partial coverage at the edges so the coarse grid stays smooth. */
  private paint(grid: Grid, colours: Float32Array): void {
    grid.data.fill(0);
    const {res, x0, z0, cols, rows, data} = grid;
    this.keys.forEach((key, idx) => {
      const r = colours[idx * 3] ?? 0;
      const g = colours[idx * 3 + 1] ?? 0;
      const b = colours[idx * 3 + 2] ?? 0;
      if (r + g + b <= 0) {
        return;
      }
      const left = (key.x - key.w / 2 - x0) * res;
      const right = (key.x + key.w / 2 - x0) * res;
      const top = (key.z - key.d / 2 - z0) * res;
      const bottom = (key.z + key.d / 2 - z0) * res;
      for (let row = Math.max(0, Math.floor(top)); row < Math.min(rows, Math.ceil(bottom)); row++) {
        const cover = Math.min(row + 1, bottom) - Math.max(row, top);
        for (let col = Math.max(0, Math.floor(left)); col < Math.min(cols, Math.ceil(right)); col++) {
          const area = cover * (Math.min(col + 1, right) - Math.max(col, left));
          const at = (row * cols + col) * 3;
          data[at] = (data[at] ?? 0) + r * area;
          data[at + 1] = (data[at + 1] ?? 0) + g * area;
          data[at + 2] = (data[at + 2] ?? 0) + b * area;
        }
      }
    });
  }

  private encode(grid: Grid): void {
    const {data, bytes} = grid;
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      bytes[j] = Math.round(Math.sqrt(Math.min(1, data[i] ?? 0)) * 255);
      bytes[j + 1] = Math.round(Math.sqrt(Math.min(1, data[i + 1] ?? 0)) * 255);
      bytes[j + 2] = Math.round(Math.sqrt(Math.min(1, data[i + 2] ?? 0)) * 255);
      bytes[j + 3] = 255;
    }
    grid.texture.needsUpdate = true;
  }
}

/** GLSL for fragment shaders: `nearLight(xz)` and `farLight(xz)` in board units. */
export const LIGHT_FIELD_GLSL = `
uniform sampler2D uNear;
uniform vec4 uNearRect;
uniform sampler2D uFar;
uniform vec4 uFarRect;
vec3 nearLight(vec2 xz) {
  vec3 c = texture2D(uNear, (xz - uNearRect.xy) * uNearRect.zw).rgb;
  return c * c;
}
vec3 farLight(vec2 xz) {
  vec3 c = texture2D(uFar, (xz - uFarRect.xy) * uFarRect.zw).rgb;
  return c * c;
}
`;
